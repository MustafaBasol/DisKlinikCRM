# 53 — KVKK Attachment & Imaging Lifecycle (Physical File Governance)

**Report date:** 2026-07-15
**Branch:** `feature/kvkk-attachment-and-imaging-lifecycle` (based off `main`)
**Status:** Implemented — awaiting deployment/operational verification. No production/browser verification has occurred. Not merged.
**Related tracker:** `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` — see the new remediation row added there (ID `KVKK-ATTACH-IMAGING-001`), which cross-references `KVKK-HIGH-001` (attachment encryption) and `KVKK-HIGH-003` (medical-record retention).

## 1. Why this exists

Prior KVKK remediation work (`ClinicLegalProfile`, `ChannelConsentLog`, `PublicBookingNoticeEvidence`, patient JSON privacy export, patient anonymization, `deletion_review` privacy requests, `dataRetentionCleanupJob.ts`) closed gaps in structured database records and messaging metadata, but none of it touched **physical files**: `PatientAttachment` and `ImagingStudy`/`ImagingImage` rows and the bytes they point to in `fileStorage.ts` (local disk or S3-compatible object storage). `patientAnonymization.ts` redacted every other patient-linked table but never touched attachment/imaging metadata, and no attachment/imaging deletion existed for the `deletion_review` privacy-request flow. This document covers the remediation of that specific gap.

## 2. Storage inventory (as found)

| Item | Location | Notes |
|---|---|---|
| Storage abstraction | `server/src/services/fileStorage.ts` | Single abstraction; local disk under `uploads/` or S3-compatible if `S3_BUCKET` is set. Already had `buildStorageKey(clinicId, originalName)` (tenant-scoped, non-identifying keys), `saveFile`, `openFileStream` (null-safe), `deleteFile` (idempotent). No existence-check-without-open, no metadata/size lookup, no export/zip helper. |
| `PatientAttachment` | `server/prisma/schema.prisma` (~line 950) | clinicId, patientId, fileName, originalName, fileSize, mimeType, filePath, uploadedById, createdAt. No category, no legal-hold field (before this change). |
| `ImagingStudy` | `server/prisma/schema.prisma` (~line 2241) | clinicId, patientId (nullable), modality, status (`active`/`archived` — schema comment: diagnostic data is never hard-deleted). No legal-hold field (before this change). |
| `ImagingImage` | `server/prisma/schema.prisma` (~line 2386) | clinicId, studyId, fileName, originalName, fileSize, mimeType, filePath, sopInstanceUid. No legal-hold field of its own (by design — inherits its study's). |
| Attachment routes | `server/src/routes/attachments.ts` | Full CRUD. Delete already calls `deleteFile` after DB delete (idempotent/non-crashing). |
| Imaging routes | `server/src/routes/imaging.ts` | Download/preview for study images. **No delete route existed** for studies/images (matches "never hard-delete diagnostic data"). |
| Patient privacy routes | `server/src/routes/patientPrivacy.ts` | `POST /patients/:id/privacy/export` returned attachment **metadata only** (no physical files, no imaging at all) as a JSON body. `POST /patients/:id/privacy/anonymize` called `anonymizePatientData()`, which never touched `PatientAttachment`/`ImagingImage`/`ImagingStudy`. |
| Retention job | `server/src/services/privacy/dataRetentionPolicy.ts` | Explicitly documented "What is NOT cleaned: ... Attachment records" — attachments/imaging were out of scope by design; unchanged in scope by this PR (see Section 8 below). |
| Frontend | `src/components/PatientPrivacyPanel.tsx`, `src/services/api.ts` | Existing UI for export/anonymize/privacy-requests; extended (not replaced) by this PR. **Note:** this component does not use `useTranslation`/i18n today — all strings are hardcoded Turkish. New strings added by this PR follow that same existing convention rather than introducing i18n asymmetrically for a single panel; this is a documented, conservative assumption, not an oversight. |

## 3. Confirmed gaps closed by this PR

1. No way to place a legal hold on an attachment or imaging study to block redaction/deletion.
2. No existence/size check on stored files without opening a full stream (needed for orphan detection).
3. No downloadable export package containing actual attachment bytes (only JSON metadata).
4. `anonymizePatientData()` never redacted attachment/imaging metadata, and had no notion of partial failure.
5. No dry-run inventory of what a "deletion review" would actually cover for attachments/imaging.
6. No narrow, auditable, idempotent live-delete path for non-clinical attachments under a confirmed deletion review.
7. No orphan-file visibility (DB row present, physical file missing) at all.

## 4. Architecture implemented

### 4.1 Storage contract extension (`server/src/services/fileStorage.ts`)

- `isSafeStorageKey(ref)` — rejects absolute paths and any `..` path segment (posix or windows separators). This is the security gate for every **new** code path added by this PR; the pre-existing absolute-path fallback (`resolveLocalPath`) is legacy-only and was never extended to any new function.
- `fileExists(ref)` — HEAD/stat existence check without opening a stream; returns `false` for any unsafe key without touching disk/S3.
- `statFile(ref)` — size metadata lookup without opening a stream; returns `null` for unsafe/missing keys.
- `buildExportStorageKey(clinicId, exportId)` — produces `exports/<clinicId>/<uuid>.zip`. `clinicId` comes from the authenticated session's resolved patient scope and `exportId` from `crypto.randomUUID()` — no user input ever feeds a path segment, so path traversal is structurally impossible, mirroring the existing `buildStorageKey` guarantee.

### 4.2 Legal hold

- `PatientAttachment.legalHold` (`Boolean @default(false)`) + `legalHoldReason` (`String?`).
- `ImagingStudy.legalHold` + `legalHoldReason`. **`ImagingImage` has no field of its own** — every image inherits its parent study's hold, checked via a join (`ImagingImage.study.legalHold`) everywhere a legal-hold check is needed (anonymization, deletion-review inventory, orphan-check reporting).
- New PATCH endpoints, both restricted to `OWNER`/`ORG_ADMIN` only (narrower than the general `PRIVACY_MANAGE_ROLES`, which also includes `CLINIC_MANAGER`):
  - `PATCH /api/patients/:patientId/attachments/:id/legal-hold` (`server/src/routes/attachments.ts`)
  - `PATCH /api/imaging/studies/:id/legal-hold` (`server/src/routes/imaging.ts`)
  - Both require `{ legalHold: boolean, reason?: string }`; `reason` (min 3 chars) is required when setting `legalHold: true`, not required when clearing it.
- **No automatic trigger sets legal hold in this PR.** The field/mechanism exists; deciding *who* may invoke it under *what* circumstances (beyond the role restriction already coded) is a remaining legal/operational decision (Section 9).

### 4.3 Privacy export archive

New model `PatientPrivacyExportArchive` (`server/prisma/schema.prisma`), following the exact token-hash + snapshot + expiry pattern already established by `PublicBookingNoticeEvidence`:

- Fields: `id`, `organizationId`, `clinicId`, `patientId`, `requestedByUserId`, `storageKey` (points to the zip via `fileStorage.ts`, **never** serialized to any API response), `manifestJson` (`Json`), `tokenHash` (`@unique`, SHA-256 of a random download token — the raw token is returned once and never persisted), `expiresAt` (1 hour TTL), `downloadedAt` (nullable), `createdAt`.
- New service `server/src/services/privacy/patientPrivacyExportPackage.ts`:
  - `createExportPackage()` — builds a ZIP (via `archiver`, newly added as a direct dependency — it was already resolved transitively in `node_modules` at v5.3.2 but not declared; a minimal ambient `.d.ts` was added since no `@types/archiver` package exists) containing `data.json` (the same structured export payload as the existing JSON export endpoint — factored into a shared `collectStructuredExportData()` helper in `patientPrivacy.ts` so both endpoints stay in sync), `attachments/<fileName>` for every readable `PatientAttachment` (best-effort — a missing/unreadable file is recorded in the manifest, never aborts the export), and `manifest.json`.
  - `validateExportDownloadToken()` — resolves purely by the SHA-256 hash of the client-supplied token, then cross-checks `clinicId`/`organizationId`/`patientId`/`exportId` scope and expiry. Dependency-injectable (`client` param) for unit testing without a real DB.
  - `markExportDownloaded()`, `cleanupExpiredExportArchives()` (dependency-injected `findExpired`/`deleteRow`/`deleteStoredFile`, mirroring the existing `dataRetentionCleanupJob.test.ts` style).
- New routes (`server/src/routes/patientPrivacy.ts`):
  - `POST /api/patients/:id/privacy/export-package` — builds the package, returns `{ exportId, downloadToken, expiresAt, manifest }` (raw token shown once, like the notice-evidence pattern) — **never** the storage key.
  - `GET /api/patients/:id/privacy/export-package/:exportId/download?token=...` — validates token+scope+expiry, streams the zip, sets `downloadedAt`, and writes an `AuditLog` entry (`patient_data_export_package_downloaded`) with no patient name/phone/email/file content in the log metadata.
- Existing `POST /patients/:id/privacy/export` (JSON body) is unchanged/kept for backward compatibility.
- New dedicated cleanup job `server/src/jobs/patientPrivacyExportCleanupJob.ts` (node-cron, every 15 minutes, `withJobLock`-guarded — mirrors `publicBookingNoticeEvidenceCleanupJob.ts` exactly) deletes expired `PatientPrivacyExportArchive` rows **and** their physical zip files, regardless of `downloadedAt` — these are short-lived transfer artifacts, not audit records; the `AuditLog` entry written at download time is the durable record. Registered in `startBackgroundJobs.ts`.

### 4.4 Anonymization extension (`server/src/services/privacy/patientAnonymization.ts`)

Two new steps added to `anonymizePatientData()`:

- `redactPatientAttachments()` — for every `PatientAttachment` of the patient: if `legalHold` is true, **skip entirely** (counted as `skippedLegalHold`, not redacted — legal hold preserves the item as-is for legal review, it does not merely block deletion); if `originalName === '[ANONYMIZED]'` already, skip as a no-op (idempotent re-run safety); otherwise set `originalName` to `'[ANONYMIZED]'`. `fileName`/`filePath` (already non-identifying server-generated storage keys) and the physical bytes are never touched. Each row is wrapped in its own try/catch so one failure never aborts the loop; failures are counted, not swallowed.
- `redactPatientImagingImages()` — identical semantics for `ImagingImage` rows, joined through `ImagingStudy.patientId`, using the parent study's `legalHold` (images have no field of their own).
- `AnonymizePatientResult` now includes `attachmentResults`/`imagingResults` (`{ total, redacted, skippedLegalHold, failed }`) and `partialFailure: boolean` (true if either counter's `failed > 0`).
- The pre-existing `alreadyAnonymized` idempotent early-return path now **also** runs the attachment/imaging redaction pass (so patients anonymized before this feature shipped still get their attachments/imaging redacted on a repeat call) and reports `partialFailure` there too.
- `server/src/routes/patientPrivacy.ts`'s `POST /patients/:id/privacy/anonymize` no longer unconditionally reports `success: true` — the response now includes `partialFailure`, `attachmentResults`, `imagingResults`, and `success` is `!partialFailure`.

### 4.5 Deletion-review inventory (dry-run only)

New service `server/src/services/privacy/deletionReviewInventory.ts` — `buildDeletionReviewInventory({ clinicId, patientId, organizationId })` returns counts (never writes): structured-record counts (appointments, appointment requests, contact requests, treatment cases, payments, payment plans, tooth records), attachment counts + estimated bytes (`total`, `legalHold`, `deletableAdministrative` = all non-legal-hold attachments — **there is no category field distinguishing "administrative" from anything more sensitive**, so this is a conservative, documented limitation, not a real category system), imaging counts + estimated bytes (`total`, `legalHold`, `retainedClinical` = everything, since imaging has no live-delete path at all in this PR), `blockers: string[]`, and `dryRun: true`.

New route: `GET /api/patients/:id/privacy/deletion-review` (`PRIVACY_MANAGE_ROLES`).

**No live-delete endpoint for imaging/clinical data exists in this PR** — the audit task explicitly forbids a one-click irreversible hard-delete of diagnostic data pending legal sign-off, matching the pre-existing schema comment "tanısal veri hiç hard-delete edilmez" ("diagnostic data is never hard-deleted") on `ImagingStudy`.

**Narrow live-delete endpoint** (reuses the existing `PatientPrivacyRequest`/`deletion_review` concept, but does not overload the existing status-PATCH endpoint — a privacy admin PATCHing a `deletion_review` request to `status=completed` does **not** trigger deletion):

- `POST /api/patients/:id/privacy/deletion-review/execute` — requires `{ confirm: true, reason }` (min 3 chars), `PRIVACY_MANAGE_ROLES`. Deletes **only** non-legal-hold `PatientAttachment` rows (DB row + physical file via `deleteFile`), never imaging/clinical records, never legal-hold rows. Idempotent by construction: it re-queries `legalHold: false` rows fresh on every call, so a second call simply finds nothing left to delete (`deletedCount: 0`) rather than erroring. Per-object result list (`{ id, status: 'deleted' | 'failed', error? }`) and an `AuditLog` entry (`patient_deletion_review_executed`) with counts only, no filenames/paths.

### 4.6 Orphan detection (bounded, patient-scoped, dry-run)

New service `server/src/services/privacy/orphanFileInspection.ts` — `inspectOrphans({ clinicId, patientId })`:

- Queries `PatientAttachment` and `ImagingImage` for a **single patient** (bounded — not a clinic-wide sweep), batched at 500 rows, and calls `fileExists()` per row to classify each as `dbRowPhysicalMissing` (row exists, file missing) or `activeLinkedObject` (file present — **never** touched/deleted by this module, regardless of legal-hold status, which is reported alongside the classification for visibility only).
- `markConfirmedMissing()` — the only "live" side effect available: stamps a new `storageVerifiedMissingAt DateTime?` field (added to both `PatientAttachment` and `ImagingImage`) on rows already confirmed missing by a prior `inspectOrphans()` call. There is nothing to physically delete for a `dbRowPhysicalMissing` row (the file is already gone) — this is purely an operator-visible marker, never gated by legal hold (nothing is deleted).
- New route: `GET /api/patients/:id/privacy/orphan-check` (`PRIVACY_MANAGE_ROLES`), patient-scoped only.

**Explicitly NOT implemented in this PR (documented follow-up):** reverse-orphan detection (a physical file exists in storage with no corresponding DB row). This would require an unbounded/unrestricted S3 `ListObjectsV2` or filesystem walk, which the architecture explicitly forbids for safety reasons (a clinic-prefixed, paginated `ListObjectsV2` with `prefix = "${clinicId}/"` would be the correct bounded approach for a future PR). Also not implemented: clinic-wide bulk orphan sweeps (kept patient-scoped to stay simple and bounded for this PR). Expired `PatientPrivacyExportArchive` rows are a separate, already-bounded "temporary expired object" category, fully handled by the dedicated cleanup job in Section 4.3 — not part of this inspection.

## 5. Lifecycle policy matrix

| Category | Chosen policy | Rationale |
|---|---|---|
| Administrative `PatientAttachment` (non-legal-hold) | Retain physical file; redact metadata (`originalName`) on anonymization; live-deletable only via the narrow `deletion-review/execute` endpoint | No category field exists to distinguish "purely administrative" from anything more sensitive — conservatively treated as the deletable set, since the alternative (never deletable) would make the deletion-review flow meaningless |
| Clinical / DICOM `ImagingImage`/`ImagingStudy` (non-legal-hold) | Retain physical file **and** metadata unredacted-by-default on anonymization is **not** the chosen policy — metadata (`originalName`) **is** redacted on anonymization; the physical file is never deleted by any path in this PR | Matches the existing schema comment that diagnostic data is never hard-deleted; retention period itself is an outstanding legal decision (Section 9) |
| `PatientPrivacyExportArchive` | Short-lived (1 hour TTL); physically deleted by a dedicated cron job regardless of download status | It is a transfer artifact, not a record — the `AuditLog` download event is the durable record |
| Legal-hold item (attachment or imaging study) | Blocks **both** anonymization metadata redaction **and** any deletion path entirely | Preserves the item exactly as-is for legal review — legal hold is stronger than "block deletion only" |

## 6. Export behavior

See Section 4.3. Summary: `POST .../export-package` → zip with `data.json` + `attachments/*` + `manifest.json`; manifest fields are `exportVersion`, `patientId`, `clinicId`, `generatedAt`, `includedFiles` (`{ attachmentId, label, sha256, sizeBytes }`), `missingFiles` (`{ attachmentId, reason }`), `skippedFiles` (reserved for future legal-hold-exclusion policy — currently always empty, since the default is to include everything authorized unless a technical failure occurs, per the architecture decision). `GET .../download` is token-gated, audit-logged, never returns a storage key/path in any response body (verified by a source-scan unit test, see Section 10).

## 7. Anonymization behavior

See Section 4.4. Partial-failure semantics: the route response is `{ success: !partialFailure, partialFailure, attachmentResults, imagingResults, ... }` — a caller (UI or API integration) checking only `success` will correctly see `false` when any per-row redaction failed, rather than the previous unconditional `success: true`.

## 8. Deletion-review behavior

See Section 4.5. **Explicitly narrow scope for this PR:** only non-legal-hold `PatientAttachment` rows are live-deletable; imaging/clinical data has no live-delete path at all (dry-run inventory only). This is a deliberate, documented limitation — not an oversight — pending the legal decisions in Section 9.

## 9. Orphan cleanup behavior

See Section 4.6. Patient-scoped, dry-run classification plus an optional missing-file marker stamp; no bulk/clinic-wide sweep; no reverse (bucket-listing) orphan detection.

## 10. Security controls

- Every new/extended route re-derives `clinicId` from an org-scoped patient lookup (`resolvePatient()`) before doing anything else — no client-supplied `clinicId` is ever trusted.
- Export download token is validated purely by its SHA-256 hash, then cross-checked against `clinicId`/`organizationId`/`patientId`/`exportId` — a forged/guessed `exportId` with someone else's real token fails as `not_found` (id mismatch checked explicitly, not just hash lookup); a token replayed against a different clinic/org/patient fails as `wrong_scope`.
- No route added or modified in this PR ever serializes `filePath`/`storageKey` to a JSON response (spot-checked by hand across `patientPrivacy.ts`, `attachments.ts`, `imaging.ts`, and covered by an automated source-scan unit test for the export-package response specifically).
- Legal-hold PATCH endpoints are restricted to `OWNER`/`ORG_ADMIN` — narrower than `PRIVACY_MANAGE_ROLES` used elsewhere in this file (which also includes `CLINIC_MANAGER`).
- `isSafeStorageKey()` rejects absolute paths and `..` segments for every new storage-lookup code path; the legacy absolute-path fallback in `fileStorage.ts` was not extended to any new function.

## 11. Failure handling

- Per-row try/catch everywhere multiple objects are processed (attachment/imaging redaction, deletion-review execute) — one failure never aborts the batch.
- Export package generation treats a missing/unreadable attachment file as a manifest `missingFiles` entry, not a fatal error for the whole export.
- Export cleanup job logs and continues past a single row's delete failure (dependency-injected test asserts this: `count` still reflects only the successful deletions).

## 12. Test commands and results (this session)

Disposable Postgres 16-alpine spun up in Docker (`nmc-kvkk-lifecycle-pg`, matching `server/.env`'s existing `DATABASE_URL` host/port/credentials exactly, migrated with `prisma migrate dev`), used only for schema migration/validation — **all unit tests run without any live DB connection**, following this repository's existing dependency-injected test convention (see `dataRetentionCleanupJob.test.ts`, `publicBookingNoticeEvidence.test.ts`).

- `npx prisma validate` → `The schema at prisma\schema.prisma is valid`
- `npx prisma migrate dev --name add_kvkk_attachment_imaging_lifecycle` → applied cleanly (`server/prisma/migrations/20260715145843_add_kvkk_attachment_imaging_lifecycle/migration.sql`)
- `npx prisma generate` → succeeded
- `npm run typecheck` (server; `prisma generate && tsc --noEmit`) → 0 errors
- `npx tsx src/tests/kvkkAttachmentImagingLifecycle.test.ts` → **39 passed, 0 failed**
- `npm test` (server, full suite — every existing test script plus the new one) → **all suites passed, 0 failures** (36 individual suite runs, cumulative several hundred individual test cases, none regressed)
- `npx tsc -b` (frontend project references) → 0 errors

## 13. Migration details

- `server/prisma/migrations/20260715145843_add_kvkk_attachment_imaging_lifecycle/migration.sql` — adds `legalHold`/`legalHoldReason`/`storageVerifiedMissingAt` to `PatientAttachment`, `legalHold`/`legalHoldReason` to `ImagingStudy`, `storageVerifiedMissingAt` to `ImagingImage`, and creates the `PatientPrivacyExportArchive` table with its indexes/unique constraint. Purely additive — no destructive changes, no data migration required (`legalHold` defaults to `false` for all existing rows).

## 14. Deployment / rollback notes

- **Deploy:** standard `prisma migrate deploy` against the target database, then deploy the updated server/frontend build. The new cron job (`patientPrivacyExportCleanupJob.ts`) starts automatically via `startBackgroundJobs.ts` — no new environment variable is required or gates it (it only ever deletes short-lived export zips, never patient data, so it is safe to run unconditionally, consistent with the existing notice-evidence cleanup job).
- **Rollback:** the new routes/services/UI can be reverted independently of the schema (the new columns/table are additive and inert if unused). If a full schema rollback is ever needed, the added columns can be dropped and the `PatientPrivacyExportArchive` table removed — no other table references it with a required (non-nullable) foreign key, so this is low-risk. No existing data is altered by the migration itself.

## 15. Production verification steps (for a human to run after deployment — not run by this session)

1. Confirm the migration applied: `npx prisma migrate status` shows "Database schema is up to date!" against the production database.
2. As an `OWNER`/`ORG_ADMIN` test user, set and clear a legal hold on a test attachment and a test imaging study; confirm the UI/API round-trips `legalHold`/`legalHoldReason` correctly and that a non-`OWNER`/`ORG_ADMIN` user gets 403.
3. Generate an export package for a test patient with at least one attachment; download it via the returned token; confirm the zip contains `data.json`, `attachments/<file>`, and `manifest.json` with correct sha256 hashes; confirm the token cannot be reused after `expiresAt` (or force-expire in a controlled test).
4. Confirm the export-cleanup cron job is running (log line `[privacy-export-cleanup] Scheduled cleanup job cron="*/15 * * * *".` at startup) and that an expired test export row + its zip file are removed within one tick.
5. Anonymize a test patient with at least one non-legal-hold attachment and one legal-hold attachment; confirm the non-hold attachment's `originalName` becomes `[ANONYMIZED]` and the hold attachment's does not; confirm the response's `partialFailure` is `false` in the normal case.
6. Call `GET .../deletion-review` for a test patient and confirm it performs no writes (inspect application logs / DB write metrics during the call) and reports correct counts/blockers.
7. Call `POST .../deletion-review/execute` twice in a row on a test patient with only non-legal-hold attachments; confirm the second call reports `deletedCount: 0` and does not error.
8. Call `GET .../orphan-check` for a test patient with a manually-removed physical file (simulate by deleting the file directly in a non-production storage bucket/test clinic) and confirm it is classified `dbRowPhysicalMissing`.

## 16. Remaining legal decisions (explicitly not made by this PR)

1. **Clinical image retention period** — how long `ImagingImage`/`ImagingStudy` physical files must/may be retained. Not decided; current behavior is indefinite retention (no automatic deletion of imaging in any code path).
2. **DICOM retention period** — same question specifically for DICOM-sourced studies (`studyInstanceUid`/`sopInstanceUid` populated), which may carry separate regulatory retention requirements from manually-uploaded images.
3. **Hard-deletion-of-medical-records policy** — whether/when medical records (including imaging) may ever be hard-deleted at all, and under what legal process. This PR deliberately implements **no** live-delete path for imaging/clinical data.
4. **Backup deletion expectations** — this PR only affects primary-database/primary-storage state; backup retention/purge policy for deleted attachments or anonymized metadata is out of scope and undecided.
5. **Legal-hold trigger conditions/authority** — who (beyond the coded `OWNER`/`ORG_ADMIN` role restriction) has the legal authority to place a hold, under what circumstances (litigation, regulatory inquiry, etc.), and whether any external/legal-team notification should accompany it. This PR only implements the *mechanism* (the field + a role-gated PATCH endpoint); no automatic trigger, workflow, or notification exists.

## 17. Assumptions made (conservative, documented, reviewable)

- `PatientPrivacyPanel.tsx` has no i18n today; new UI strings were added as hardcoded Turkish, matching the existing pattern, rather than introducing i18n asymmetrically for a single panel.
- `deletableAdministrative` in the deletion-review inventory conservatively equals "all non-legal-hold attachments" since no category field exists yet to separate "purely administrative" uploads from anything more sensitive.
- The narrow `deletion-review/execute` endpoint requires a fresh `{ confirm: true, reason }` on every call (not a stored/approved `PatientPrivacyRequest` id) — deliberately decoupled from the existing `PATCH /privacy-requests/:reqId/status` endpoint so that marking a request `completed` administratively can never silently trigger deletion as a side effect.

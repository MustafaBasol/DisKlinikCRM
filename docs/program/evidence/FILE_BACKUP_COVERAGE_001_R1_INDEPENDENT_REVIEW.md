# FILE-BACKUP-COVERAGE-001 — R1 Independent Review (PR #247)

Reviewed: `feature/file-backup-coverage-001` @ `835d9798fb124b35d578df9eac5b1096806bf925` (PR #247), against `origin/main` @ `26c6c339a7cd8db06b1707c059f7f27857f45e6`.
Fixes branch: `review/pr247-file-backup-fixes`, opened as a PR against `feature/file-backup-coverage-001` (not `main`).

**Status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`** even with this review's fixes applied — see `FILE_BACKUP_COVERAGE_001.md` §11. Nothing in this document is a production-verification claim; it is a code-review-time verification pass run in an isolated git worktree against disposable Postgres 16 and disposable MinIO, neither of which is production infrastructure.

## 0. Method

Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\review-pr247-file-backup` (isolated from the primary tree). Disposable infrastructure: Postgres 16 (`docker run postgres:16`) and MinIO (`docker run minio/minio`), both destroyed after this review. New DB-backed + S3-backed integration test: `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` (`npm run test:file-backup-db-integration`) — the PR's own `fileBackupService.test.ts` is entirely DB-independent (disclosed as such in its own header comment and in §7 of `FILE_BACKUP_COVERAGE_001.md`), so it never exercised `runFileBackup`'s row iteration/ledger writes, `runFileBackupRestoreRehearsal`, or any S3-compatible destination before this pass.

Required checks run: `npx prisma validate` (pass), `npm run typecheck` (pass, 0 errors), `npm run test:file-backup` (15/15 pass), `npm run test:file-backup-db-integration` (21/21 pass after fixes below — 19/21 with 2 confirmed failures before), `git diff --check` (clean, no whitespace errors), fresh-migration deploy against an empty disposable Postgres 16 (pass), migration rollback + reapply against a populated schema with representative `Organization`/`Clinic`/`Patient` rows (pass, confirmed unaffected data).

## 1. Findings and fixes

### 1.1 [HIGH — fixed] Restore safety check bypassable via a pre-existing symlink

`fileBackupService.ts`'s `isSafeRestoreOutputDir()` compared `path.resolve(outputDir)` against the primary uploads root as plain strings, never resolving symlinks. A pre-existing symlink at, e.g., `/tmp/looks-safe -> uploads/` would pass the check (the string `/tmp/looks-safe` doesn't look like it's inside `uploads/`), and the subsequent `fs.createWriteStream` would then write straight through the symlink into primary storage — the exact outcome the code's own header comment and the task brief explicitly forbid ("Restore only ever writes to an operator-supplied, non-primary output directory — it never writes back into primary storage automatically").

Confirmed live: `fileBackupDbIntegration.test.ts`'s symlink test created a real symlink to the primary uploads directory and called `restoreFileToPath` through it; before the fix, the restore **succeeded**, writing bytes into primary storage's own directory tree.

**Fix**: `isSafeRestoreOutputDir` now resolves the real path of whatever prefix of `outputDir` already exists on disk (`resolveRealExistingPrefix`) before the containment check, so a symlink pointing at (or inside) primary storage is caught. A second, authoritative check runs again immediately after `mkdir` (using `fs.promises.realpath` on the now-guaranteed-to-exist directory), closing the narrow TOCTOU window where `outputDir` could be swapped for a symlink between the pre-check and the `mkdir`. Both checks and the final write now operate against the resolved real path, not the possibly-symlinked one.

Re-verified: the same symlink test now asserts `success: false`.

### 1.2 [MEDIUM — fixed] Manual backup trigger bypassed the cross-process lock

The scheduled cron tick (`fileBackupJob.ts`) wrapped `runFileBackup()` in `withJobLock('file-backup', ...)`, a DB-backed lease lock that is cross-process/cross-replica safe (`server/src/utils/jobLock.ts`, pre-existing utility used elsewhere in this codebase). The manual admin route (`POST /api/platform/file-backups/run`, `platformAdmin.ts`) called `runFileBackup()` directly, guarded only by the in-process `backupRunning` boolean — which does nothing across replicas or separate processes.

Consequence: on any multi-replica deployment, a manual trigger hitting one replica could run concurrently with the scheduled job (or another manual trigger) on a different replica. Confirmed at the DB layer: `FileBackupEntry` has no unique constraint on `(sourceModel, sourceRecordId, status)`, so two racing runs' check-then-insert (`findFirst` then `create`) can both pass the check and both insert a `verified` row for the same source record — duplicate ledger rows and duplicate redundant destination writes, violating the review's "overlapping scheduled/manual runs" and "duplicate/retried runs" requirements even though the deterministic key/atomic-rename design keeps it from being data-corrupting.

**Fix**: the `withJobLock` acquisition moved from the cron-job call site into `runFileBackup()` itself (`FILE_BACKUP_JOB_LOCK_NAME`/`FILE_BACKUP_JOB_LOCK_TTL_MS`, exported for reuse), so every caller — cron, the manual route, and any future caller — shares the exact same cross-process guard with no way to forget it at a new call site. `fileBackupJob.ts` no longer wraps the call in its own lock (that would double-acquire the same lock name and make every scheduled run fail against itself).

Re-verified: a new test claims the shared `JobLock` row directly (simulating another replica, bypassing this process's own `backupRunning` flag entirely) and confirms `runFileBackup` now refuses to run with "already in progress on another process/replica".

### 1.3 [MEDIUM — documentation fix] Evidence doc undercounted live physical-delete paths

`FILE_BACKUP_COVERAGE_001.md` §8 named `DELETE /api/patients/:patientId/attachments/:id` as "the one live physical-delete path" for the three backed-up models. `DELETE /api/lab-orders/:id/attachments/:attId` (`server/src/routes/labOrders.ts`) also hard-deletes a `LabOrderAttachment` row and its physical file — and, unlike the patient-attachment path, has **no legal-hold gate at all**. `ImagingImage` genuinely has no delete/update endpoint (confirmed by existing regression tests asserting as much), so the "immutable by design" framing is correct only for that one model.

Both delete paths leave the corresponding off-host backup copy and `FileBackupEntry` row orphaned indefinitely — the same disclosed consequence the original document names for the one path it does mention, just with one more path and one more (missing) safeguard than disclosed. This matters because the document's own recommended follow-up (`FILE-BACKUP-RETENTION-POLICY-001`) will use this document as its scoping input.

**Fix**: `FILE_BACKUP_COVERAGE_001.md` §8 corrected in place to name both paths and the legal-hold asymmetry.

### 1.4 [confirmed by design, not changed] Once `verified`, a `FileBackupEntry` is never re-checked

By design (idempotency for immutable sources), a source record with any `copied`/`verified` entry is skipped by all future runs without re-reading the source or re-verifying the destination object. Confirmed live: after out-of-band tampering with a MinIO object whose entry was already `verified`, a subsequent `runFileBackup()` did not create a new entry or notice the tampering — only `restoreFileToPath`/`runFileBackupRestoreRehearsal` (checksum re-compared against the destination) catches it. Since restore rehearsal is not itself scheduled (only callable on demand), a corrupted or tampered off-host copy could sit "verified" indefinitely with no automatic signal. Not fixed here (would require either periodic re-verification of a sample of already-verified entries, or scheduling the restore rehearsal itself) — recommended as a follow-up alongside the already-tracked `FILE-BACKUP-RETENTION-POLICY-001`.

## 2. Confirmed correct (not just claimed)

- **Tenant isolation**: destination keys are `file-backups/<domain>/<clinicId>/<sourceRecordId>.bin`; `PatientAttachment`/`LabOrderAttachment`/`ImagingImage` IDs are all globally-unique `uuid()` (schema-verified), so two clinics cannot collide on `sourceRecordId`, and every seeded cross-org entry in the integration test kept its own `clinicId` and a non-overlapping key. `GET /file-backups/status` returns only global aggregates behind `authenticatePlatformAdmin`, never a per-clinic breakdown — no leak surface between clinics via this route.
- **Idempotent re-runs**: a second `runFileBackup()` over unchanged data copies nothing new and creates no duplicate ledger rows (single-process, non-racing case).
- **Missing source handling**: a source DB row whose physical file is absent is recorded `missing_source`, never silently dropped or crashes the run.
- **Checksum/corruption detection at restore time**: destination bytes tampered with after a successful backup (both local-disk and MinIO) are caught by `restoreFileToPath`'s independent re-hash and reported as `checksumMatch: false`, not silently accepted.
- **Missing-object detection**: a destination object deleted out-of-band produces a clean `success: false` restore result, not a crash or false success.
- **Fail-closed defaults**: `FILE_BACKUP_ENABLED` defaults false; the job is not scheduled at all when disabled or when no destination is configured (verified via `startFileBackupJob()`'s own early returns).
- **Migration safety**: fresh-deploy on an empty disposable Postgres 16 succeeds; the migration is additive-only (`CREATE TABLE`/`CREATE INDEX`/`ADD FOREIGN KEY`, no `ALTER`/`DROP` of anything pre-existing); rollback (`DROP TABLE` both new tables) and reapply against a schema already populated with representative `Organization`/`Clinic`/`Patient`/`User` rows leaves that data untouched; `FileBackupEntry.runId → FileBackupRun.id` cascade-deletes correctly.
- **S3-compatible destination (MinIO)**: bucket creation, upload, independent read-back via a separate S3 client, and manifest writes all work as designed against a real disposable S3-compatible endpoint — this had never been exercised against any S3-compatible destination before this review (the PR's own tests only cover local mode).
- **No credential/path leakage in the ledger**: `errorSummary`/`errorMessage` fields only ever store `safeErrorFields()`'s sanitized `{errorName, errorCode}`, never raw exception messages that could embed a local path or S3 endpoint.

## 3. Not fixed, disclosed as residual (unchanged from the original evidence doc's own honest gap list)

No application-layer encryption of backup bytes; no retention/lifecycle policy for backup objects or the `FileBackupRun`/`FileBackupEntry` ledger; no metrics/alerting on backup failure or staleness; no object-lock/ransomware-immutability; restore rehearsal is on-demand only, not scheduled. All pre-existing, author-disclosed gaps in `FILE_BACKUP_COVERAGE_001.md` §11, not introduced or resolved by this review.

## 4. Verdict

**REQUEST_CHANGES → fixes applied on `review/pr247-file-backup-fixes`, PR opened against `feature/file-backup-coverage-001`.** Once merged into the feature branch, this task's overall status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` — this review exercised disposable infrastructure only. No production system was touched, migrated, or configured; the backup job was not enabled anywhere; nothing was merged to `main`.

# FILE-BACKUP-COVERAGE-001 — Off-Host Backup Coverage for Filesystem-Backed Clinical Artifacts

Task ID: `FILE-BACKUP-COVERAGE-001` (Parallel Task E)
Baseline: `origin/main` @ `26c6c339a7cd8db06b1707c059f7f27857f45e6` (PR #240 merge commit, "docs(kvkk): http log privacy production closeout")
Branch: `feature/file-backup-coverage-001`
Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\file-backup-coverage-001` (isolated — see §0)

**Status: `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.** Code is written, typechecked, and covered by DB-independent unit tests in this environment. It has **not** been deployed to production, has **not** been run against a live Postgres database, and has **no** production off-host backup or restore evidence. Do not read any part of this document as a closure claim — see §11 for the exact, honest gap list.

---

## 0. Working-environment note (read before anything else)

This task's working directory was shared with at least one other concurrently-running task (`audit/infra-encryption-residency-evidence-001`, observed live-switching the primary tree's branch mid-session and creating untracked `docs/compliance/56-60` files). This task's own uncommitted schema edit was found sitting on top of that other branch after the collision; it was recovered by hand (copied to a scratch file, the primary tree's `schema.prisma` restored to its committed state, and this task moved into its own isolated `git worktree` — `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\file-backup-coverage-001`, branch `feature/file-backup-coverage-001`, mirroring this program's own established convention of one worktree per parallel task) before any further work happened. No file belonging to that other task was read, modified, or committed by this task. All work described below happened exclusively inside the isolated worktree from that point forward.

## 1. Scope decision relative to the KVKK architecture freeze boundary

Before writing any code, this task read [`docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md), [`docs/architecture/object-storage-backup-migration-design.md`](../../architecture/object-storage-backup-migration-design.md) (F0-011, the prior design-only task covering this exact area), and [`docs/program/evidence/KVKK_FINAL_RECONCILIATION_20260726.md`](KVKK_FINAL_RECONCILIATION_20260726.md) (the most recent program reconciliation, 2026-07-26/28).

**Why implementation is authorized here despite the freeze:**

- `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 18 ("Backup and restore") lists its own, decoupled exit condition: **"separate user decision to begin F0-011"** — distinct from the general "KVKK baseline stabilization" condition (§5 condition 5) that gates most other frozen areas. This task's direct dispatch (a fully-specified brief naming exact requirements: checksums, off-host replication, tenant-scoped keys, encrypted transport, Turkey-hosted S3-compatible provider option, explicit prohibition on silent production migration) is that decision.
- `KVKK_FINAL_RECONCILIATION_20260726.md` names `FILE-BACKUP-COVERAGE-001` verbatim as prioritized next-task item 6 ("establish backup coverage for attachments/imaging files; evaluate offsite copy") and lists "no backup coverage exists for attachments/imaging files at all" as onboarding blocker #4 — this task closes exactly that documented gap.
- **What remains frozen and is NOT touched by this task:** storage-key migration (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 8), attachment physical-deletion redesign (§3 item 9), imaging storage lifecycle redesign (§3 item 10). No `PatientAttachment`, `LabOrderAttachment`, `ImagingImage`, or `ImagingStudy` row or column is added, modified, or renamed by this task. No existing `fileStorage.ts` storage key is renamed or moved. Primary storage remains exactly what it is today (local disk in production, per `PRODUCTION_TOPOLOGY.md` §6) — this task adds an **off-host copy**, not a storage migration. This is the "local-primary with reliable off-host replication" pattern the task brief itself names as the preferred architecture for a fleet of thousands of single-VPS clinics.
- The two new database tables (`FileBackupRun`, `FileBackupEntry`) are purely additive — no existing table, column, index, or constraint is altered. This mirrors how other net-new capabilities were added during the same freeze period in this program (e.g. `SecurityIncident`/`SecurityIncidentActivity`, `ClinicBulkExportArchive`).

**What this task does not authorize** (restated, matching F0-011's own non-authorization statement): storage-provider selection as a KVKK data-processing decision, a data-residency/subprocessor legal determination, enabling `FILE_BACKUP_ENABLED=true` in production, or any production deployment. Those remain separate, explicit, operator-controlled decisions — see §10.

## 2. Storage inventory (current state, unchanged by this task)

| Domain | Model | Physical location | Primary-storage backend | Encryption at rest | Checksum on write |
|---|---|---|---|---|---|
| Patient attachments | `PatientAttachment.filePath` | `uploads/<clinicId>/...` (production: `/var/www/noramedi/server/uploads`) | Local disk (S3-compatible code path exists, dormant — `S3_BUCKET` unset in production) | None at the application layer | None |
| Lab-order attachments | `LabOrderAttachment.filePath` | Same convention as above | Same | None | None |
| Imaging images | `ImagingImage.filePath` | Same convention as above | Same | None | None |
| Imaging/DICOM metadata | `ImagingStudy` | DB row only (no separate physical DICOM sidecar file) | Postgres (covered by the existing DB backup) | N/A | N/A |
| Structured clinic bulk exports | `ClinicBulkExportArchive.storageKey` | `uploads/exports/<clinicId>/<uuid>.zip` | Same fileStorage.ts abstraction; short-TTL, cleaned up by an existing cron job | None | Per-file sha256 in `manifestJson` (existing, unrelated to this task) |
| Patient privacy export packages | `PatientPrivacyExportArchive.storageKey` | Same convention | Same | None | Same manifest pattern |
| Database (all of the above tables' own rows) | — | `/root/noramedi-backups` (same host as the DB it backs up) | External `pg_dump`-based script, not in this repository | Unknown/unverified (script not inspected) | N/A |

All figures corroborated by direct source read of `server/src/services/fileStorage.ts`, `server/prisma/schema.prisma`, and the F0-011 design document's own evidence (`docs/architecture/evidence/f0-011-storage-flow-inventory.json`), independently re-confirmed by this task's own `Grep`/`Read` pass rather than merely cited.

Export ZIPs (`ClinicBulkExportArchive`, `PatientPrivacyExportArchive`) are explicitly **out of scope for backup**: they are short-lived transfer artifacts on an existing TTL/cleanup cron, not durable clinical records — backing them up would be backing up something designed to be deleted within hours.

## 3. Coverage matrix — before vs. after this task

| Requirement | Before this task | After this task (code state, not yet deployed) |
|---|---|---|
| Off-host copy of patient attachments | None | `FileBackupRun`/`FileBackupEntry` ledger + `fileBackupService.ts`, gated by `FILE_BACKUP_ENABLED` (default `false`) |
| Off-host copy of lab-order attachments | None | Same job, same code path |
| Off-host copy of imaging images | None | Same job, same code path |
| Off-host copy of DICOM sidecar files | N/A (none exist as separate files — see §2) | N/A, unchanged |
| Checksums on backup write | None | SHA-256 computed while streaming to the destination, then independently re-computed by reading the destination back and compared (`fileBackupService.ts`'s two-pass verify) |
| Manifest per backup run | None | JSON manifest written to the destination (`file-backups/manifests/<runId>.json`) via `writeBackupManifest()` |
| Versioning | Not implemented (see §11 — provider-native versioning is a documented future option, not built) | Not implemented |
| Retention/lifecycle policy for backup copies | N/A (nothing exists to retain) | Not implemented — every successful backup is kept indefinitely; no expiry logic exists yet (see §11) |
| Tenant-scoped backup keys | N/A | `file-backups/<domain>/<clinicId>/<sourceRecordId>.bin` — `clinicId` is the second path segment, mirrors `fileStorage.ts`'s own existing tenant-key convention |
| Encrypted transport to backup destination | N/A | HTTPS via `@aws-sdk/client-s3`/`@aws-sdk/lib-storage` in S3 mode (same TLS the AWS SDK already enforces); local mode has no network transport |
| Encrypted storage at backup destination | N/A | Provider-dependent (S3-compatible provider's own at-rest encryption) — this task does not implement application-layer encryption of backup bytes; see §11 |
| Ransomware resistance (immutability/object-lock) | N/A | Not implemented — no object-lock/legal-hold applied to backup copies yet; documented as a future hardening item (§11) |
| Restore tooling | None (files have never had any restore path) | `restoreFileToPath()` (service function) + `fileBackupRestoreCli.ts` (operator CLI) + `runFileBackupRestoreRehearsal()` (automated sampled restore-and-verify, mirrors `backupService.ts`'s `runRestoreTest()` for the DB) |
| Deletion/anonymization interaction | N/A | Backup copies are **not** deleted or updated when a source row is deleted/anonymized — see §8 for the explicit, documented consequence and why it is not resolved by this task |
| DICOM size/streaming | N/A | All I/O is stream-based throughout (never buffers a full file in memory) — see §5 |
| Auditability | Attachment delete already writes an activity-log-adjacent record (unrelated); nothing for backup | Every run and every per-file outcome is a durable, queryable DB row (`FileBackupRun`/`FileBackupEntry`) — append-only, never mutated in place |
| Monitoring | DB backup has `GET /api/platform/backups/status`; nothing for files | `GET /api/platform/file-backups/status` (mirrors the DB backup route's shape) |
| Cost controls | N/A | Sequential (not parallel) copy loop, bounded batch size (`FILE_BACKUP_BATCH_SIZE`, default 100); no automatic destination lifecycle/cost-tiering implemented (§11) |
| Production off-host copy exists today | **No** | **Still no** — this task ships code; it does not deploy or enable it (§10) |

## 4. Architecture

```
PatientAttachment / LabOrderAttachment / ImagingImage (DB rows, unchanged)
        │  (read-only: id, clinicId, filePath, fileSize)
        ▼
fileBackupService.ts — runFileBackup()
        │  openFileStream(filePath)   ← existing fileStorage.ts, works
        │                                transparently whether primary
        │                                storage is local disk or S3
        ▼
fileBackupDestination.ts — writeToBackupDestination(key, stream)
        │  streams once, hashing as it writes (Transform stage, never
        │  buffers the whole file in memory)
        ▼
Backup destination: EITHER
   FILE_BACKUP_LOCAL_DIR (local secondary path — dev/test only, NOT
   off-host by itself)
   OR
   FILE_BACKUP_S3_BUCKET (separate S3-compatible bucket/provider/
   credentials from primary storage's own S3_* vars — the off-host-
   capable option; works with AWS S3, MinIO, Cloudflare R2, or a
   Turkey-hosted S3-compatible provider)
        │
        ▼
Verify: read the just-written object back, re-hash, compare to the
write-time hash → FileBackupEntry.status = 'verified' | 'failed'
        │
        ▼
FileBackupRun / FileBackupEntry (Postgres — durable, append-only ledger)
```

Key design choices and why:

- **Primary storage is completely untouched.** `fileBackupService.ts` only calls `openFileStream()` (read) from `fileStorage.ts` — it never calls `saveFile`, `deleteFile`, or anything that mutates primary storage. This is what makes the feature safe to ship without touching the frozen storage-key-migration/attachment-deletion/imaging-lifecycle areas.
- **Separate environment-variable namespace** (`FILE_BACKUP_*` vs. `fileStorage.ts`'s `S3_*`). This deliberately decouples "where a file is served from" (primary) from "where its off-host copy lives" (backup), so a clinic can run local-primary + off-host-S3-backup — the exact pattern this program's own architecture task (F0-011) and this task's brief both recommend as the default for a fleet of single-VPS clinics, without requiring a full storage migration first.
- **Deterministic, non-content-addressed destination keys** (`file-backups/<domain>/<clinicId>/<sourceRecordId>.bin`). Attachments/lab-attachments/imaging images have no update endpoint anywhere in this codebase (immutable by design, `docs/compliance/53`), so a record-id key is already stable — this lets the backup write be a single streaming pass instead of needing the checksum known before the key can be built, which matters for large imaging/DICOM files that must never be fully buffered in memory.
- **Idempotent re-runs without re-reading unchanged files.** Once a record has one `verified`/`copied` `FileBackupEntry`, later runs skip it without opening the source file again — correct only because the source is immutable, and documented as such in the code.
- **Two-pass checksum verification.** The write-time hash (computed while streaming to the destination) is compared against a **second, independent read-back** of the destination. This catches corruption introduced by the write/storage layer itself, not just a source-read error — matching the "scheduled inventory/backup verification" requirement in the task brief.
- **Fail-closed everywhere.** `FILE_BACKUP_ENABLED` defaults to `false` (the job is not even scheduled unless explicitly turned on — mirrors `CLINIC_BULK_EXPORT_ENABLED`'s existing convention in this codebase). `runFileBackup()` refuses to start at all if no destination is configured, rather than silently "succeeding" with zero real copies made. Restore refuses to write inside the primary `uploads/` directory under any circumstances.

## 5. Implementation — files changed

All new files are additive; all edits to existing files are narrow, single-purpose insertions.

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | + `FileBackupRun`, `FileBackupEntry` models (additive only) |
| `server/prisma/migrations/20260728120000_add_file_backup_coverage/migration.sql` | New migration (hand-authored, matching this repo's existing convention — `CREATE TABLE` only, no `ALTER`/`DROP` of anything existing) |
| `server/src/services/fileBackupDestination.ts` | New — off-host destination abstraction (local dir + S3-compatible), separate env namespace from `fileStorage.ts` |
| `server/src/services/fileBackupService.ts` | New — inventory/copy/verify orchestration, status, restore, restore rehearsal |
| `server/src/jobs/fileBackupJob.ts` | New — cron wrapper (`withJobLock` singleton, fail-closed) |
| `server/src/jobs/startBackgroundJobs.ts` | + one line wiring `startFileBackupJob()` alongside the other existing jobs |
| `server/src/scripts/fileBackupRestoreCli.ts` | New — operator CLI for `restore` and `rehearsal` modes |
| `server/src/routes/platformAdmin.ts` | + three routes: `GET /file-backups/status`, `POST /file-backups/run`, `POST /file-backups/restore-rehearsal` (mirrors the existing DB-backup routes' shape and auth — inherits the router-level `authenticatePlatformAdmin` + CSRF middleware already applied to every route in this file) |
| `server/src/tests/fileBackupService.test.ts` | New — 15 unit tests (see §7) |
| `server/package.json` | + `test:file-backup` script, appended to the main `test` chain |
| `server/.env.example` | + documented `FILE_BACKUP_*` variables (all commented out / off by default) |

DICOM-specific note: there is no separate DICOM sidecar file format in this codebase today — `ImagingImage.filePath` is the same kind of opaque blob storage key as an attachment (see §2), so no DICOM-specific code path was needed. If/when true DICOM Part-10 files or larger CBCT studies are introduced, the existing streaming design (never buffers a full file in memory) is expected to scale to them without a rewrite, but this has not been tested against a large file in this pass — see §11.

## 6. Manifest / checksum model

- **Per-file**: `FileBackupEntry.sourceChecksumSha256` (computed while streaming from primary storage to the backup destination) and `FileBackupEntry.destinationChecksumSha256` (computed by an independent second read of the destination object). `status = 'verified'` only when both match.
- **Per-run**: a JSON manifest written to the backup destination itself at `file-backups/manifests/<runId>.json`, containing the run's aggregate counts (`filesScanned`, `filesCopied`, `filesVerified`, `filesSkipped`, `filesFailed`, `filesMissing`) and its destination kind. Manifest write failure is logged but never fails the underlying file backups it describes (the per-file DB ledger is the durable source of truth; the manifest is a convenience artifact at the destination itself).
- **Durable ledger**: every run and every per-file outcome is a Postgres row (`FileBackupRun`/`FileBackupEntry`), append-only. This is itself the auditability requirement — an operator or a future automated check can query "was record X ever successfully backed up, and when, and with what checksum" without needing to inspect the backup destination directly.

## 7. Tests

`server/src/tests/fileBackupService.test.ts` — **15/15 passing** in this environment (`npx tsx src/tests/fileBackupService.test.ts`).

This environment has no live Postgres connection available (confirmed: `npx prisma validate` succeeds, but no `DATABASE_URL`/local Postgres is configured — the same documented limitation several other tasks in this program have recorded, e.g. `KVKK-HIGH-006`'s early batches). Coverage is therefore honestly scoped to what is genuinely DB-independent:

- `fileBackupDestination.ts`'s **local-mode round trip is exercised against real filesystem I/O** (a disposable `os.tmpdir()` directory, not a mock): write → destination-exists check → read back → checksum match → manifest write/read.
- `fileBackupService.ts`'s fail-closed gates (`isFileBackupEnabled` default/toggle, `runFileBackup` refusing to start when disabled or when no destination is configured, `restoreFileToPath` refusing to write inside the primary `uploads/` directory) are all exercised for real — every one of these returns/throws **before** any Prisma call, so they are not mocked, they are genuinely executed.
- What is **not** covered by this pass: the DB-backed parts of `runFileBackup` (row iteration, `FileBackupEntry` creation, idempotent-skip logic, run finalization) and `runFileBackupRestoreRehearsal`. These require a live Postgres database. `npx tsc --noEmit` passes with zero errors across the whole `server/` package, which does verify the DB-facing code is type-correct against the generated Prisma client, but type-correctness is not behavioral verification.
- **Explicitly not run in this pass**: the full `npm test` chain (every other suite in this program also requires a live Postgres and was not exercised), any S3-compatible destination (no test credentials/endpoint available in this environment — only local-mode was exercised), and any test against a real multi-megabyte or DICOM-scale file.

**Required before this can be called `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` → verified**: a disposable-PostgreSQL DB-backed integration pass (mirroring this program's existing convention, e.g. `KVKK-HIGH-006`'s PR #203) covering `runFileBackup` end-to-end against seeded `PatientAttachment`/`LabOrderAttachment`/`ImagingImage` rows, ideally against both `local` and a real (or MinIO-emulated) `s3` destination.

## 8. Restore procedure

Two ways to restore, both **read-only against primary storage** and both refuse to write inside the primary `uploads/` directory:

**Single record, operator-invoked:**
```
cd server
npx tsx src/scripts/fileBackupRestoreCli.ts restore \
  --model PatientAttachment --record <recordId> --out /path/outside/uploads
```
Looks up the latest `verified` `FileBackupEntry` for that record, streams the backup object to `<out>/<model>-<recordId>.bin`, re-hashes it, and reports `checksumMatch: true/false`. Exit code `0` only on a verified match.

**Automated restore rehearsal (sampled, disposable):**
```
npx tsx src/scripts/fileBackupRestoreCli.ts rehearsal --sample 5
```
or via the platform-admin route: `POST /api/platform/file-backups/restore-rehearsal`. Restores the `N` most-recently-verified backup entries into a disposable `os.tmpdir()` directory (mode `0700`), checksum-verifies each, then deletes the directory in `finally` regardless of outcome. This is the file-backup equivalent of `backupService.ts`'s existing `runRestoreTest()` for the database — it produces durable, re-runnable evidence that restore actually works, not merely that a backup copy exists somewhere. **Like the DB's own `runRestoreTest()`, this has real, non-trivial implementation but no evidence in this pass that it has ever been executed against production data** — see §11 (this mirrors R-032's exact shape, applied to files).

**Deletion/anonymization interaction (explicitly unresolved by this task, disclosed rather than glossed over):** `patientAnonymization.ts` never touches physical file bytes (by existing, documented design — `docs/compliance/53`), so an anonymized attachment's *backup* copy is equally never touched; there is no leak introduced by backup that anonymization doesn't already accept for primary storage. The one live physical-delete path (`DELETE /api/patients/:patientId/attachments/:id`) **does** delete the primary file — but this task's backup job does **not** delete the corresponding backup copy when that happens. A deleted attachment's bytes therefore persist in the backup destination indefinitely, restorable, until a future task adds delete-propagation or a retention/lifecycle policy. **This is a real, disclosed gap, not a silent one** — it is the direct file-backup analogue of the DB-side gap this program's own reconciliation already names ("Backup purge policy for deleted/anonymized data... explicitly undecided in code comments," `KVKK_FINAL_RECONCILIATION_20260726.md` §8 item 5) and requires the same legal-review input before it can be closed correctly (a naive immediate-delete-on-backup would defeat backup's own ransomware/accidental-deletion protection purpose; a naive never-delete approach conflicts with a future KVKK retention-period decision). Recommended follow-up task: `FILE-BACKUP-RETENTION-POLICY-001`, blocked on the same legal retention-period decision already named in `KVKK_FINAL_RECONCILIATION_20260726.md` §8 item 5.

## 9. Monitoring

`GET /api/platform/file-backups/status` (platform-admin auth required, same as every other route in `platformAdmin.ts`) returns: whether the feature is enabled, which destination kind is configured (`none`/`local`/`s3`), whether that destination counts as off-host, the most recent run's full summary (status, counts, byte total), and aggregate totals across all runs (`verified`/`failed`/`missingSource` entry counts). This mirrors the shape of the existing `GET /api/platform/backups/status` (DB backup) route so an operator dashboard can present both consistently.

**Not implemented in this pass** (documented, not silently skipped): alerting/paging on backup failure or staleness, a metrics/observability integration (this program has no observability standard yet — ADR-012 remains `DEFERRED`, per `object-storage-backup-migration-design.md` §14), and a frontend UI panel (only the backend route exists; no admin-panel screen was added — out of this task's stated scope, which named backend backup/replication coverage, not a UI).

## 10. Production rollout plan (not executed by this task)

1. **Provider decision** (external, legal/business — not this task's to make, per ADR-008's own `NEEDS EXTERNAL VENDOR/LEGAL DECISION` marking, restated in `object-storage-backup-migration-design.md` §13/§18): select a Turkey-hosted S3-compatible provider (or another category per that document's provider comparison) for `FILE_BACKUP_S3_*`, with a data-processing agreement covering its status as a KVKK subprocessor.
2. **Staging verification**: deploy this code to a non-production environment, set `FILE_BACKUP_S3_BUCKET`/credentials to a disposable staging bucket, `FILE_BACKUP_ENABLED=true`, run `npm run test:file-backup` plus a disposable-Postgres integration pass (§7's open item), then trigger one manual run (`POST /file-backups/run`) against seeded, synthetic (never real-patient) attachment/imaging rows, and one restore rehearsal.
3. **Production migration application**: `prisma migrate deploy` applies only the new, additive `FileBackupRun`/`FileBackupEntry` tables — no existing table is touched, so this step carries the same low blast-radius as the other additive migrations this program has already shipped under the freeze (e.g. `SecurityIncident`).
4. **Production enable, monitored**: set `FILE_BACKUP_S3_*` and `FILE_BACKUP_ENABLED=true` in production, restart the worker process only (this job runs under `startBackgroundJobs()`, same as every other cron job — no API-process-only code path exists), and observe `GET /file-backups/status` after the first scheduled run (default cron `0 3 * * *`, configurable via `FILE_BACKUP_CRON`).
5. **First production restore rehearsal**: once at least one production `FileBackupEntry` is `verified`, run `POST /file-backups/restore-rehearsal` against production and record the result as a new, dated evidence file (mirroring this document's own convention) — this is the step that would finally close R-032's file-backup analogue with real production evidence, not just repository-verified capability.
6. **Only after steps 1-5 are complete and evidenced**, this task's status may be reconsidered for a stronger claim than `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`. None of steps 1-5 were performed by this task.

## 11. Honest status and explicit gap list

**Status: `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.**

- `ARCHITECTURE_READY` — satisfied and exceeded (working code exists, not just a design document).
- `IMPLEMENTED_NOT_DEPLOYED` — satisfied (code is implemented; nothing has been deployed).
- `IMPLEMENTED_NOT_PRODUCTION_VERIFIED` — this is the accurate label: implemented, typechecked, unit-tested to the extent this environment allows, but **not run against a live database, not deployed, not enabled, and with zero production off-host backup or restore evidence.**

**This task does not claim, and explicitly disclaims:**

- That any file has ever actually been copied off-host in production. It has not — `FILE_BACKUP_ENABLED` defaults to `false` and no destination was ever configured or exercised against real infrastructure in this pass.
- That a restore has ever been rehearsed against production data. It has not.
- That the DB-backed code paths (`runFileBackup`'s row iteration/ledger writes, `runFileBackupRestoreRehearsal`) have been exercised against a real database at all, in any environment, in this pass — only DB-independent gates and local-filesystem round trips were exercised (§7).
- That an S3-compatible destination (the actually off-host-capable option) has been exercised at all — only `local` mode was tested, which this document itself states does not satisfy an off-host requirement.
- That deletion/anonymization-vs-backup-retention is resolved — it is explicitly not (§8), and requires the same external legal retention-period decision this program has already identified as outstanding elsewhere.
- That versioning, object-lock/ransomware-immutability, backup-destination lifecycle/cost controls, or application-layer encryption of backup bytes are implemented — none of them are (§3's coverage matrix marks each "Not implemented" plainly).
- That this closes any tracked risk or blocker in `RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `LAUNCH_GATES.md`, or any other central tracker — **no central tracker file was read for the purpose of editing, and none was edited, per this task's explicit instruction.** Whoever reconciles those trackers next should treat this document as the evidence input, not as a self-declared closure.

**Recommended follow-up tasks** (not performed by this task): `FILE-BACKUP-DB-INTEGRATION-VERIFICATION-001` (disposable-Postgres pass, §7), `FILE-BACKUP-S3-DESTINATION-VERIFICATION-001` (exercise against a real or MinIO-emulated S3-compatible destination), `FILE-BACKUP-RETENTION-POLICY-001` (§8's deletion/anonymization gap, blocked on the same external legal decision named in `KVKK_FINAL_RECONCILIATION_20260726.md` §8 item 5), `FILE-BACKUP-PRODUCTION-ROLLOUT-001` (§10's five steps, requiring an external provider/DPA decision first).

## 12. Migration and rollback plan

- **Migration**: `server/prisma/migrations/20260728120000_add_file_backup_coverage/migration.sql` — two `CREATE TABLE` statements, four `CREATE INDEX` statements, one `ADD FOREIGN KEY` (the new `FileBackupEntry.runId → FileBackupRun.id` relation, `ON DELETE CASCADE`). **No existing table, column, index, or constraint is altered, dropped, or renamed.** This is the lowest-blast-radius category of migration this program's own convention distinguishes (matches e.g. the `PlatformAdminAuditEvent` and `SecurityIncident` migrations, both shipped during the same freeze period).
- **Rollback**: dropping both new tables (`DROP TABLE "FileBackupEntry"; DROP TABLE "FileBackupRun";`, in that order for the FK) is fully safe and reversible — nothing else in the schema references them, and no existing data is affected either way. No data migration/backfill of any kind is performed by this migration, so there is no "undo a backfill" step to reason about.
- **Feature rollback (if enabled and something goes wrong)**: set `FILE_BACKUP_ENABLED=false` and restart the worker process — the cron job is not even scheduled when disabled (checked at process-startup in `startFileBackupJob()`), so this is an immediate, complete kill switch requiring no code change or migration rollback. Existing backup copies at the destination are untouched by disabling the feature (by design — disabling must never be interpreted as "also delete what was already backed up").
- **No production data migration is performed anywhere in this task.** Per the task brief's explicit instruction, "any production migration must remain a separate operator-controlled phase" — this task ships the tooling to perform an off-host copy; it does not perform one against production, and does not silently start doing so merely by being merged (the fail-closed `FILE_BACKUP_ENABLED=false` default is exactly this guarantee).

## 13. Central trackers

Per this task's explicit instruction, **no central tracker file was touched** (`NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `LAUNCH_GATES.md`, `CURRENT_PHASE.md`, `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`, or any file under `docs/program/phases/`). This document is the evidence input for whoever performs that reconciliation next, consistent with how this program has handled every other parallel task's evidence output.

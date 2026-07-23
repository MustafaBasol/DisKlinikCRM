# PILOT_BACKUP_RESTORE_AND_FILE_COVERAGE_AUDIT

**Task ID:** PILOT-RESILIENCE-001
**Title:** Backup, Restore, and File-Tree Coverage Audit
**Phase:** F0 — Controlled Pilot Readiness
**Type:** Read-only repository audit (no production access, no SSH, no restore execution, no runtime/shared-tracker changes)
**Worktree:** `.claude/worktrees/pilot-backup-restore-coverage`
**Branch:** `audit/pilot-backup-restore-coverage` (base: freshly-fetched `origin/main`)
**Evidence-gathering date:** 2026-07-23

## 0. Scope and method statement

This document is a **repository-only synthesis and gap audit**. No SSH connection was attempted, no production command was executed, no restore was run, and no file in `server/`, `src/`, `scripts/`, or any shared tracker (`docs/program/RISK_REGISTER.md`, `docs/program/LAUNCH_GATES.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, etc.) was modified by this task.

Almost every fact below is not newly discovered — it is already recorded, independently, across `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`, `docs/architecture/object-storage-backup-migration-design.md`, `docs/architecture/f0-011-storage-backup-test-matrix.md`, `docs/architecture/evidence/f0-011-backup-restore-gap-matrix.json`, `docs/program/RISK_REGISTER.md` (R-029…R-032, R-046, R-062), and `docs/program/LAUNCH_GATES.md` §2.E. This task's contribution is: (a) verifying those claims still hold at current `origin/main` by reading the actual source files they cite, (b) assembling them into the single pilot-facing coverage matrix and rehearsal plan the task brief calls for, which did not previously exist in one place, and (c) resolving one open ambiguity those documents left implicit — whether the existing `runRestoreTest()` capability restores to a genuinely *isolated* destination (see §13, "same-host caveat").

Per the task brief: **backup scripts/services existing in code is not treated as evidence that backups exist or work.** **`runRestoreTest()` existing in code is not treated as evidence a restore has ever succeeded.** Every claim below is tagged with an evidence class (adapted from `f0-011-backup-restore-gap-matrix.json`'s legend):

| Class | Meaning |
|---|---|
| `VERIFIED_PRODUCTION_OBSERVED` | Directly observed in a documented production evidence-gathering pass (F0-002/F0-006), cited here, not re-executed |
| `VERIFIED_REPOSITORY` | Confirmed present/absent by reading current repository source in this task |
| `UNVERIFIED_PRODUCTION` | Neither confirmed present nor absent in production; no fresh production check was performed by this task |
| `NOT_FOUND` | Actively searched for, not found |
| `DESIGN_ONLY` | Exists as a design/specification document; explicitly not implemented or executed |

## 1. PostgreSQL backup coverage

**Mechanism:** An external, host-level cron unit (`/etc/cron.d/noramedi-db-backup`) invokes `/usr/local/sbin/noramedi-db-backup.sh`, which is **not part of this repository** — the repo only contains a client wrapper, `server/src/services/backupService.ts:9-14`, which hardcodes the paths (`BACKUP_DIR = '/root/noramedi-backups'`, `BACKUP_SCRIPT = '/usr/local/sbin/noramedi-db-backup.sh'`, `RETENTION_DAYS = 7`, filename pattern `noramedi_crm-\d{8}-\d{6}\.dump`) and exposes `runBackup()` (`backupService.ts:128-131`, an `execFile` of the external script), `listBackupFiles()`, and `runRestoreTest()` (`backupService.ts:167-277`) via authenticated platform-admin routes (`server/src/routes/platformAdmin.ts:1211-1268`) and a functional admin UI (`src/pages/platform/PlatformBackups.tsx`).

- **Evidence class:** `VERIFIED_PRODUCTION_OBSERVED` for the mechanism's existence and cadence (per `docs/program/PRODUCTION_TOPOLOGY.md` §"Backups" and `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`) — the shell script's actual content was never inspected by any task, because it is not in the repository. Its encryption behavior, exact `pg_dump` flags, and error handling are `UNVERIFIED_PRODUCTION` (`f0-011-backup-restore-gap-matrix.json` GAP-A: `"backup_encryption_status": "UNVERIFIED_PRODUCTION — backup script itself not in repository, could not be inspected"`).
- **Scope:** PostgreSQL only. Nothing in `backupService.ts` touches `uploads/`, `.env`, or any non-database path (confirmed by reading the file in full — every external call is `createdb`/`pg_restore`/`psql`/`dropdb` against a database, never a filesystem copy).
- **Location:** `/root/noramedi-backups`, on the **same VPS** as the PostgreSQL instance it backs up. No offsite copy has ever been found or supplied (`RISK_REGISTER.md` R-030, `OPEN`).
- **Retention:** 7 days declared (`backupService.ts:13`), matching `docs/program/PRODUCTION_TOPOLOGY.md`'s observed 7 retained files at evidence time.
- **What this does NOT cover:** attachments, imaging/DICOM files, `.env`/secrets, and (per §8 below) nothing beyond what already lives in the same Postgres instance for audit logs and message data — those are covered by this same mechanism *because* they are ordinary Postgres tables, not because of any dedicated treatment.

## 2. Backup freshness/integrity evidence available in repo

- **Freshness:** The only freshness figure in the repository is a single point-in-time observation — "latest backup ~10.6h old at evidence time" (`docs/program/PRODUCTION_TOPOLOGY.md`, echoed as "~11 hours observed" in `RISK_REGISTER.md` R-031). This is a one-time snapshot from a prior task, **not a current or recurring measurement** — this audit did not re-check it (no production access permitted).
- **Integrity:** `listBackupFiles()`/`getBackupStatus()`/`getBackupLogs()` (`backupService.ts`, wired to `PlatformBackups.tsx`) surface file size and log-tail output, which is monitoring/visibility, not an integrity proof (no checksum of backup files is computed or stored anywhere in the repository).
- **No monitoring/alerting exists** for backup job failure — ADR-012 (observability) is `DEFERRED` (`LAUNCH_GATES.md` §1 table); a failed cron run would only be noticed by an operator manually opening the admin UI.
- **Verdict:** freshness and file-presence are observable via the admin UI; **byte-level integrity of any specific backup file has never been verified** (no checksum/verification step exists in `backupService.ts` or elsewhere).

## 3. Restore procedure completeness

- **Automated capability exists:** `runRestoreTest()` (`backupService.ts:167-277`) picks the newest (or a named) `.dump` file, creates a uniquely-named temporary database (`createdb`), runs `pg_restore --no-privileges --no-owner`, executes sanity queries (table count, `PlatformAdmin`/`Plan`/`_prisma_migrations` row counts), and drops the temp database — a real, non-trivial implementation, not a stub.
- **Test coverage of this code is validation-only, not a round-trip proof:** `server/src/tests/platformBackup.test.ts` (per its own header, line 1-24, and `section('runRestoreTest — input validation (no DB calls, no file creation)')` at line 217) tests filename-regex validation, auth-guard behavior, and rejection of path-traversal/injection input — **it never calls `createdb`/`pg_restore` against a real database.** Passing this suite proves the guard logic works; it proves nothing about whether an actual restore has ever succeeded.
- **No durable evidence a restore has ever been executed, successfully or otherwise, exists anywhere in this repository** — this is `RISK_REGISTER.md` R-032, status `OPEN`, unchanged as of this audit.
- **Completeness gaps in the procedure itself, independent of whether it's ever been run:**
  1. **Same-host restore target (see §13).** `runRestoreTest()` connects using the same `DATABASE_URL` as production (`backupService.ts:195-214`) and creates the temp database on that same Postgres server. It verifies the backup *file* restores cleanly; it does not verify recovery is possible if the Postgres **host** itself is lost — a distinct, and for a single-host topology (§12) more consequential, scenario.
  2. **No file-tree restore procedure exists at all** (see §5/§6) — there is nothing to restore because there is nothing backed up.
  3. **No documented step-by-step operator runbook** for restore exists outside the code itself — `docs/program/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` and `docs/22-hostinger-vps-postgres-deploy-plan.md`/`docs/35-docker-deploy-runbook.md` mention backup/restore only as unelaborated checklist bullets ("Configure backups for PostgreSQL" — doc 22 line 146; "[ ] Automated PostgreSQL backups configured" — doc 35 line 141), with no restore steps, destination, or verification method spelled out.

## 4. PITR availability

**Not configured. Confirmed absent, not merely undocumented.** `docs/program/PRODUCTION_TOPOLOGY.md` records `wal_level=replica, archive_mode=off` — i.e., WAL archiving is explicitly off, so point-in-time recovery is not possible at any resolution finer than the backup interval itself (§2's ~11-hour single observation). `RISK_REGISTER.md` R-031 status is `NOT_CONFIGURED (doğrulandı / verified)`, `OPEN`. `f0-011-backup-restore-gap-matrix.json` GAP-B independently confirms the same: `"current_coverage": "None — archive_mode=off"`. `ADR-013` (backup/PITR/DR) is `NEEDS_POC` (`ARCHITECTURE_DECISIONS.md`, echoed in `LAUNCH_GATES.md` §1). No `archive_command` value, WAL shipping target, or PITR tooling exists anywhere in the repository.

## 5. Attachment physical-file coverage

- **Storage layer:** `server/src/services/fileStorage.ts` is a genuine dual-mode abstraction — local disk (`BASE_UPLOAD_DIR`) by default, or S3-compatible object storage if `S3_BUCKET` is set (real `@aws-sdk/client-s3`/`@aws-sdk/lib-storage` usage, not a stub). `server/src/routes/attachments.ts` uses it for patient/lab attachment upload and retrieval.
- **Production configuration:** `S3_BUCKET` and sibling env vars are confirmed **absent** from both production (`ENVIRONMENT_MATRIX.md`) and `server/.env.example` (`f0-011-backup-restore-gap-matrix.json` GAP-E). Production runs **local-disk-only**: `docs/program/PRODUCTION_TOPOLOGY.md` records the path `/var/www/noramedi/server/uploads` (~3.1 MB observed).
- **Backup coverage: none.** `backupService.ts` never references `uploads/` or any file-tree path (confirmed by reading the full file — every external call is a Postgres client tool). `docs/program/PRODUCTION_TOPOLOGY.md` itself flags this explicitly: the uploads path is "NOT confirmed to be included in the database backup pipeline." `f0-011-backup-restore-gap-matrix.json` GAP-C calls this "the single largest gap identified" by the prior F0-011 task, at evidence class `NOT_FOUND_IN_BOUNDED_SCOPE` (a targeted, not exhaustive, search of the relevant storage/backup/attachment/job paths).
- **No inventory/checksum baseline exists either** — GAP-D notes that even a one-time snapshot of the current `uploads/` tree (a stage-1 precondition of the F0-011 migration design) has not been created.
- **Retention/deletion interaction:** `server/src/jobs/dataRetentionCleanupJob.ts` explicitly never touches `Attachment` rows or files (`dataRetentionCleanupJob.ts` header, line ~9) — the only physical-file deletions in the codebase are interactive, single-row, upload-rollback or explicit-delete paths (`attachments.ts` lines ~175, ~358-442), not a batch job. This means a DB-only restore after a filesystem loss would resurrect `PatientAttachment` rows whose `filePath` values point at bytes that no longer exist anywhere — a broken-reference outcome, not merely a stale-but-consistent one.
- **Verdict: files exist in production; no backup mechanism of any kind covers them.**

## 6. Imaging/DICOM/CBCT coverage

- **Storage model:** Imaging (`server/src/routes/imaging.ts`, `imagingBridgePublic.ts`) uses the **same** `fileStorage.ts` local-disk-or-S3 path as ordinary attachments — there is no separate PACS/DIMSE system in production today. `src/components/imaging/DicomViewer.tsx` is a pure in-browser viewer (cornerstone/dicom-parser) that streams blobs from the app's own authenticated API; it has no independent storage or backup implication of its own.
- **Phase status:** `docs/program/phases/F10_IMAGING_DICOM_AND_AI.md` is `Faz durumu: TODO` — full enterprise PACS/AI-scale imaging is a **future phase**, gated on F4 (Storage & Backup) exiting first. This does not mean today's basic imaging upload/view feature is absent — it is live — but the enterprise-hardened version of it is not yet built.
- **Backup coverage: none**, same finding as attachments, at higher sensitivity. `f0-011-backup-restore-gap-matrix.json` GAP-G: `"gap": "Complete — no backup of imaging binaries exists"`, and separately notes that `ImagingStudy` rows are application-designed to be **immutable and never hard-deleted** — meaning the application's own design assumes this data persists indefinitely, while nothing backs up the files that data references.
- **KVKK lifecycle vs. backup:** `docs/compliance/53-kvkk-attachment-imaging-lifecycle.md` (a real, production-deployed control for consent/legal-hold/redaction/export) explicitly scopes itself away from backup: §16 item 4 states verbatim that "backup retention/purge policy for deleted attachments or anonymized metadata is out of scope and undecided" for that document.
- **Verdict: same as attachments — files exist, zero backup coverage, and the gap is more severe given imaging's `VERY_HIGH` sensitivity classification and indefinite-retention design.**

## 7. Configuration/secrets backup treatment

**No evidence of any backup, versioning, or secrets-manager treatment for configuration/secrets was found.** `.env`/`server/.env` exist only on the single production host, managed through PM2 (`pm2 reload noramedi-api --update-env`, `docs/program/PRODUCTION_TOPOLOGY.md`; `scripts/noramedi-deploy.sh:55-93`). No Vault/AWS Secrets Manager/1Password or equivalent integration exists anywhere in the repository. `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` itself lists `.env` file permissions and `ENCRYPTION_KEY` fail-closed behavior as an outstanding/unverified production control (not a backup control, but adjacent). Because `backupService.ts`'s pipeline is Postgres-only (§1), losing the single production host would likely mean losing `.env`/`ENCRYPTION_KEY`/other secrets with **no backup copy anywhere** unless one exists entirely out-of-band and undocumented in this repository.

## 8. Audit-log and message-data coverage

- **Audit logs (`AuditLog`, `server/prisma/schema.prisma:1532-1548`) and message data (`WhatsAppConversationMessage`, `SentMessage`, `MessagingInboundEvent`) are ordinary tables in the single shared PostgreSQL database** — no separate store, no file-based logging, no dedicated backup mechanism beyond the DB-wide `pg_dump` in §1. Their coverage is therefore exactly as good, and exactly as gapped (same-host, no offsite, no PITR, unverified restore), as the rest of the database — no better, no worse.
- **Retention tension, already documented, not resolved:** `dataRetentionCleanupJob.ts` runs daily (default `0 3 * * *`, `dataRetentionPolicy.ts:34,91`), automatically wired into both the API and worker process at startup (`server/src/jobs/startBackgroundJobs.ts:24`, called from `server/src/index.ts:265` and `server/src/worker.ts:24`) — it hard-deletes/anonymizes several message-adjacent categories (`WhatsAppConversationMessage`, `WhatsAppConversationState`, `OperationalEvent`, `MessagingInboundEvent`, etc., per `dataRetentionCleanupJob.ts:77-251`) on independent thresholds, while `AuditLog` and `SentMessage` are explicitly never touched (`dataRetentionPolicy.ts:15-30`, "immutable compliance trail"). `docs/architecture/f0-011-storage-backup-test-matrix.md` Experiment 35 names the exact unresolved question this creates: restoring a pre-cleanup backup reintroduces rows the retention job would already have deleted, and reconciling that depends on re-running the (idempotent) retention job against the restored environment — a dependency this program has specified but never tested. `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` lists this same tension as an explicit, still-open item.

## 9. Encryption-at-rest/in-transit evidence

| Layer | Status | Evidence |
|---|---|---|
| Postgres storage-level/disk encryption | **No evidence found** | No `pgcrypto` usage in `server/src`; `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` lists VPS disk/volume encryption and Postgres storage-level encryption as outstanding/unverified |
| Backup file encryption | `UNVERIFIED_PRODUCTION` | Backup script is external to the repo and was never inspected (`f0-011-backup-restore-gap-matrix.json` GAP-A) |
| Field-level encryption | Present, narrow scope | `server/src/utils/encryption.ts` (AES-256-GCM) — used only to encrypt WhatsApp provider API keys/tokens before persisting, **not** patient PII, message text, or names |
| DB connection TLS (in-transit) | Not set in code | `server/src/db.ts` builds the connection pool from `DATABASE_URL` with pool/timeout options only — no `ssl`/`sslmode` option is set in code; whether TLS is enforced depends entirely on the connection string's own content in production, which this audit did not check |
| Client-facing TLS | Out of repo scope by design | `nginx.conf:1-8`'s own comment states TLS termination/HSTS is the outer reverse proxy's responsibility, not this repo's in-container config |

**Verdict: no confirmed encryption-at-rest for the database or its backups; a narrow, unrelated field-level encryption exists for provider credentials only; in-transit encryption to the database is unverified from the repository alone.**

## 10. Retention/deletion interaction

Consolidating §5 and §8: the only automated, scheduled deletion in the system (`dataRetentionCleanupJob.ts`) never touches Patient/Appointment/Treatment/Payment/Insurance/Attachment/imaging rows or files, and never touches `AuditLog`. It only removes a bounded set of messaging/operational-event categories on independent day-thresholds. This narrows the restore-vs-retention conflict to those categories specifically: restoring an old backup would reintroduce WhatsApp messages/operational events/etc. that had aged out, and the fix this program has specified (re-run the idempotent cleanup job post-restore) has never been exercised. For attachments/imaging/patient-clinical data, there is no competing deletion job to conflict with a restore in the first place — the open problem there is that nothing has ever backed those files up at all (§5/§6), not a retention/restore conflict.

## 11. RPO/RTO

| | Documented | Inferred | Missing |
|---|---|---|---|
| **Database RPO** | None formally adopted | ~11 hours, from a single historical backup-age observation (§2); not a monitored/recurring SLO | A committed, monitored RPO target |
| **Database RTO** | Design-doc proposal only: "≤4h" (`object-storage-backup-migration-design.md` §9.4, explicitly a "PoC/business-approval proposal, not an established fact" per the gap matrix's own schema note) | — | Any RTO figure ever measured against a real restore |
| **File/imaging RPO** | None | — | Entirely missing — there is no backup to have an RPO from |
| **File/imaging RTO** | Design-doc proposal only: "≤4h" (same source, same non-authoritative status) | — | Entirely missing |
| **PITR-based RPO** | Proposed "≤15min" (same design doc, same non-authoritative status) | — | PITR itself is not configured (§4), so this is aspirational only |

**No RPO/RTO figure in this program has ever been measured against an executed restore.** Every number above traces back to one design document's own proposal section, which that document itself labels non-authoritative.

## 12. Single-host failure exposure

**Confirmed: production is a single bare-metal/VPS host (`disklinik-prod-01`) running everything** — PM2-managed app processes (`noramedi-api`, `noramedi-worker`), self-hosted PostgreSQL 16.14, Redis, local file storage, host Nginx, and the database backup directory itself, with **no confirmed second host, no off-host replica, and no offsite backup copy** (`docs/program/PRODUCTION_TOPOLOGY.md`: "every component above runs on the same VPS... no confirmed off-host component anywhere in the current production topology"). `docs/35-docker-deploy-runbook.md`'s container-based topology is confirmed **stale/aspirational** — no `Dockerfile`/`docker-compose*` exists in the repository, and it does not describe what actually runs. `RISK_REGISTER.md` R-003 (single-server failure) and R-004 (single-DB failure) are both `OPEN`, `UNVERIFIED`/scoped to future F7/F11 HA work. `docs/program/phases/F11_ENTERPRISE_SCALE_AND_DR.md` confirms disaster recovery is explicitly a future phase (`Faz durumu: TODO`), requiring F7 (HA) to exit first.

**Practical consequence:** loss of this one host (hardware failure, provider incident, disk corruption) would simultaneously take out the running application, the database, the file storage, the backup directory itself (same host, §1), and any un-backed-up `.env`/secrets (§7) — with no confirmed off-host copy of any of those to recover from except the last cron-produced `pg_dump` file, if that file also happened to survive whatever took the host down (it would not, if the failure is disk-level rather than process-level, since it lives on the same disk).

## 13. Exact restore rehearsal plan (proposed — not executed by this task)

This plan operationalizes `docs/architecture/f0-011-storage-backup-test-matrix.md` Experiments 25-27 (already-specified but never-executed designs) into a concrete, one-time runbook satisfying the brief's requirements: isolated destination, no production overwrite, verification queries, file hash/sample verification, and cleanup. **No step below has been executed by this task.**

**Same-host caveat (see §3):** the existing `runRestoreTest()` creates its temporary database on the *same* Postgres server as production (via the same `DATABASE_URL` host). That is a legitimate backup-file-integrity check, but it does **not** demonstrate recovery is possible independent of that specific host — which matters precisely because §12 establishes that host as a single point of failure. The rehearsal below therefore uses a **separate disposable environment**, not `runRestoreTest()`'s in-place temp-database pattern, to close that specific gap.

**Step 1 — Provision an isolated destination.**
Stand up a disposable PostgreSQL 16.14 instance (matching production's version) with no network path to the production database and no production credentials — e.g. a throwaway container or VM, consistent with this program's existing pattern for disposable-Postgres rehearsals elsewhere (KVKK-HIGH-006/008 migration rehearsals).

**Step 2 — Obtain the backup artifact via read-only means only.**
Copy (not move) the most recent `noramedi_crm-*.dump` file from `/root/noramedi-backups` to the disposable environment. No write operation touches the production backup directory or the production database at any point.

**Step 3 — Restore into the disposable instance.**
`pg_restore --no-privileges --no-owner -d <disposable_db> <copied_dump_file>` — the same flags `runRestoreTest()` already uses (`backupService.ts:220-226`), applied against the new instance instead of a same-host temp database.

**Step 4 — Verification queries** (extend, do not replace, `runRestoreTest()`'s existing three checks):
- `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';` (existing check)
- `SELECT COUNT(*) FROM "PlatformAdmin";`, `SELECT COUNT(*) FROM "Plan";`, `SELECT COUNT(*) FROM "_prisma_migrations";` (existing checks)
- Add: a referential-integrity spot check across a sample of PHI-bearing tables (e.g. `Patient` → `Appointment` → `Treatment` foreign-key consistency for a handful of rows), per Experiment 27's "expanded integrity check." **Evidence-capture constraint:** record only row counts, boolean pass/fail per foreign-key relationship, and internal surrogate IDs (`uuid` primary/foreign keys) — never patient names, contact details, clinical notes, or other PHI field values — in any rehearsal log, ticket, or evidence artifact this step produces.
- Add: row counts for `PatientAttachment` and `ImagingImage` compared against the same counts in a freshly-taken production read-only query, to quantify (not fix) the file/DB mismatch described in §5/§6 — again, counts only, no filenames or file content in evidence output.

**Step 5 — File hash/sample verification (the part current tooling does not do at all).**
Because no attachment/imaging backup exists (§5/§6), this step can only rehearse the DB-restore side end-to-end and **separately document, as its own explicit finding**, that the restored `PatientAttachment.filePath`/`ImagingImage` rows reference files that do not exist anywhere outside the live production `uploads/` directory — i.e., rehearsing "restore the database" today cannot be extended into "restore the patient's files" for anything beyond what still happens to be live on the single production host. If/when a file-tree backup mechanism is implemented, this step should be extended to: pick N sample files present at backup time, compute their SHA-256 before backup and after restore, and require an exact match — mirroring Experiment 25/26's checksum-match acceptance criterion.

**Step 6 — Tenant-isolation check.**
Confirm the disposable restore target exposes no data beyond what the backup snapshot itself contained, and that it is not reachable from any network path used by production or other tenants (Experiment 27's tenant-isolation note: a full-database restore doesn't change tenant isolation *within* the data, but the restore target itself must not become a new exposure surface).

**Step 7 — Record RTO.**
Time from "restore initiated" to "all verification queries pass" is the first real, measured database RTO this program will have — to be compared against the design document's proposed "≤4h" (§11), which until this step runs is unverified.

**Step 8 — Cleanup.**
Destroy the disposable database/environment entirely. Confirm (by absence of the environment, not merely a `dropdb`) that no copy of the restored data persists anywhere after the rehearsal.

**This plan requires no production access to execute** — steps 2 (copying the dump file off the backup directory) is the only step that touches the production host at all, and it is a read-only copy, not a restore-in-place or overwrite of anything.

## 14. Pilot gate classification

This audit intentionally does **not** collapse the database tier and the file/imaging tier into one label — they are in materially different states (per this document's own house rule against collapsing distinct states, matching `LAUNCH_GATES.md` §0):

- **PostgreSQL tier: `READY_FOR_REHEARSAL`.** A real backup artifact exists (§1), a disposable-Postgres rehearsal pattern is already established elsewhere in this program, and §13 above is directly executable today with no missing prerequisite. Nothing needs to be *built* before this specific rehearsal could run — it only needs to be *authorized and performed*.
- **Attachment/imaging (file-tree) tier: `BLOCKED_BY_MISSING_COVERAGE`.** There is nothing to rehearse restoring, because nothing has ever been backed up (§5/§6) — nothing in a `PILOT-RESILIENCE-001`-scoped task can close this; it requires the object-storage/file-backup implementation work `docs/architecture/object-storage-backup-migration-design.md` specifies and F4 (`docs/program/phases/F4_STORAGE_AND_BACKUP.md`, `Faz durumu: TODO`) owns.
- **PITR: `BLOCKED_BY_MISSING_COVERAGE`.** `archive_mode=off` (§4); there is no PITR to rehearse until it is configured, which this audit does not authorize.
- **Program-level (`LAUNCH_GATES.md` §2.E) framing, unchanged by this audit:** the PostgreSQL-only restore rehearsal is already named there as the one item "promoted from design to mandatory rehearsal for G1" — this document's §13 is that rehearsal's exact procedure, not a new requirement. Offsite backup and PITR remain accepted-temporary-risks for G1 only, and mandatory before G2, exactly as `LAUNCH_GATES.md` §2/§3 §E already states — this audit finds no reason to change that classification and surfaces no new blocker beyond what `RISK_REGISTER.md` R-029…R-032 already track.

**Overall: `BLOCKED_BY_MISSING_COVERAGE` at the program level (file-tree/imaging backup does not exist at all), with the narrower and separately actionable finding that the PostgreSQL-tier restore rehearsal specifically is `READY_FOR_REHEARSAL` today and is the correct next concrete step, independent of when the file-tree gap gets addressed.**

## 15. R1 reconciliation and drift check (2026-07-23, PILOT-RESILIENCE-001-R1)

This section records a finalization pass over the audit above. It does not re-open or re-litigate any finding — it confirms whether the finding still holds against a freshly-fetched `origin/main` and corrects wording where needed.

- **Drift assessment:** `origin/main` fetched at commit `9e80571cf78a0e83e0f5219e09223011fddf1955`, 4 commits ahead of this audit's base (`8906e66`). All 4 are documentation-only commits unrelated to backup/restore/storage/imaging/PITR: an R-061 Package A production-execution record, an independent DATA-INTEGRITY-001 conversion-verification record, and their merge commits. None touch `server/src/services/backupService.ts`, `server/src/services/fileStorage.ts`, `server/src/routes/attachments.ts`, `server/src/routes/imaging.ts`, `server/prisma/schema.prisma`, `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/RISK_REGISTER.md`'s R-029…R-032 rows, `docs/program/LAUNCH_GATES.md`, or any architecture/design doc this audit cites. **No documentation drift materially affecting this audit's findings or classification was found.**
- **Repository re-verification performed by this pass:** direct re-reads (not re-assertion) of `backupService.ts` (full file — `BACKUP_DIR`, `BACKUP_SCRIPT`, `RETENTION_DAYS=7`, filename regex, `runBackup()`, `runRestoreTest()` line ranges all confirmed as cited), `platformAdmin.ts` backup route wiring, `PRODUCTION_TOPOLOGY.md` (`wal_level=replica, archive_mode=off` confirmed verbatim), `RISK_REGISTER.md` (R-003, R-004, R-029, R-030, R-031, R-032 text confirmed, all still `OPEN`), `LAUNCH_GATES.md`/`ARCHITECTURE_DECISIONS.md` (ADR-012 `DEFERRED`, ADR-013 `NEEDS_POC` confirmed), `fileStorage.ts` header (dual local/S3 mode confirmed), `ENVIRONMENT_MATRIX.md` and `server/.env.example` (S3_BUCKET/S3_REGION/S3_ENDPOINT confirmed absent from both), `server/prisma/schema.prisma` (`AuditLog` model confirmed org-scoped, no dedicated backup), `src/pages/platform/PlatformBackups.tsx` (confirmed exists), `server/src/tests/platformBackup.test.ts` (header and validation-only test scope confirmed), `server/src/utils/encryption.ts` usage sites (confirmed limited to provider API keys/tokens, never patient PII), `server/src/db.ts` (confirmed no `ssl`/`sslmode` option set in code), `nginx.conf` (TLS-out-of-scope comment confirmed), `docs/22-hostinger-vps-postgres-deploy-plan.md`/`docs/35-docker-deploy-runbook.md` (backup mentioned only as unelaborated checklist bullets, confirmed), `docs/compliance/53-kvkk-attachment-imaging-lifecycle.md` §16 item 4 (confirmed verbatim), and `f0-011-backup-restore-gap-matrix.json` GAP-A through GAP-G (confirmed verbatim, including the exact `backup_encryption_status: "UNVERIFIED_PRODUCTION"` field). All cross-referenced document paths in §"Cross-references" below were confirmed to resolve. **Every citation checked resolved to matching current-repository content; none required correction.**
- **Wording correction applied:** §13 Step 4's referential-integrity and row-count checks were tightened to state explicitly that only counts, pass/fail booleans, and surrogate IDs may be recorded in rehearsal evidence — never PHI field values, filenames, or file content — closing an implicit gap against this task's evidence-capture requirement. No other incomplete or truncated wording was found in the document; no other correction was necessary.
- **Classification confirmed unchanged:** PostgreSQL tier `READY_FOR_REHEARSAL`; attachment/imaging (file-tree) tier `BLOCKED_BY_MISSING_COVERAGE`; PITR `BLOCKED_BY_MISSING_COVERAGE`; **overall `BLOCKED_BY_MISSING_COVERAGE`** — unchanged from §14, because the file-tree/imaging backup gap that drives the overall classification has not been closed by any commit on `origin/main` since the original audit.

## Cross-references

[PRODUCTION_TOPOLOGY.md](../../program/PRODUCTION_TOPOLOGY.md), [RISK_REGISTER.md](../../program/RISK_REGISTER.md) (R-003, R-004, R-029–R-032), [LAUNCH_GATES.md](../../program/LAUNCH_GATES.md) §2.E/§3.E, [object-storage-backup-migration-design.md](../../architecture/object-storage-backup-migration-design.md), [f0-011-storage-backup-test-matrix.md](../../architecture/f0-011-storage-backup-test-matrix.md) (Experiments 25-28, 35), [f0-011-backup-restore-gap-matrix.json](../../architecture/evidence/f0-011-backup-restore-gap-matrix.json), [F4_STORAGE_AND_BACKUP.md](../../program/phases/F4_STORAGE_AND_BACKUP.md), [F10_IMAGING_DICOM_AND_AI.md](../../program/phases/F10_IMAGING_DICOM_AND_AI.md), [53-kvkk-attachment-imaging-lifecycle.md](../../compliance/53-kvkk-attachment-imaging-lifecycle.md), [PILOT_PRODUCTION_READINESS_EVIDENCE.md](PILOT_PRODUCTION_READINESS_EVIDENCE.md), [PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md).

## Non-authorization statement

This document defines a coverage assessment and a proposed rehearsal plan. It does not itself execute any backup, restore, PITR configuration, or file-tree backup implementation, and it does not modify `RISK_REGISTER.md`, `LAUNCH_GATES.md`, or any other shared tracker — those remain owned by their own program tasks. No status in this document upgrades any existing risk-register entry; where this document's findings match an existing `OPEN` risk, that risk remains `OPEN` until closed through its own program process.

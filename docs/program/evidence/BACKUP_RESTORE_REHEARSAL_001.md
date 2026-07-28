# BACKUP_RESTORE_REHEARSAL_001

**Task ID:** BACKUP-RESTORE-REHEARSAL-001
**Title:** First controlled NoraMedi PostgreSQL backup restore rehearsal — runbook, script, and preflight design
**Phase:** F0 → F4 handoff (operationalizes the rehearsal `LAUNCH_GATES.md` §2.E/§3.E already names as **mandatory for G1**)
**Type:** Runbook/script preparation followed by an actual operator-executed rehearsal. A runbook and an operator-run script were authored and reviewed against the current backup implementation, the script's root-invocation/delegation handling was then fixed based on a reviewer pass, and an operator subsequently ran the fixed script twice against a real production backup file (§7): once hitting an expected fail-safe rejection under the pre-fix script, once successfully after the fix. **The restore rehearsal itself has now been executed and evidenced (§7); this document's own status is `CLOSED_VERIFIED` for the database-restore-rehearsal gap only (§9).**
**Branch:** `audit/backup-restore-rehearsal-001`
**Baseline:** `origin/main @ 26c6c339a7cd8db06b1707c059f7f27857f45e61`
**Evidence-gathering date:** 2026-07-28

## Status

```
CLOSED_VERIFIED
```

This status means: an operator ran `scripts/backup-restore-rehearsal.sh` against a real production backup file, first hitting a fail-safe root-invocation rejection (expected — see §7 Attempt 1), then a second, successful run after the script's root-invocation/delegation handling was fixed (§7 Attempt 2, `result: PASS`, `cleanup: VERIFIED`). This closes the specific gap `RISK_REGISTER.md` R-032 describes for the **PostgreSQL database restore rehearsal only**. It explicitly does **not** close: off-host backup absence (R-030), backup file encryption (R-030 context), attachment physical-file restore, or imaging/DICOM physical-file restore — see §9 for the unchanged scope boundary, which this closure does not widen.

## 0. Scope and method statement

This task began as a **repository-only preparation task**: backup scripts, cron/systemd references, PostgreSQL backup/restore code paths, existing restore documentation, environment variable names, storage destinations, retention/rotation behavior, encryption behavior, and PostgreSQL version compatibility were inspected directly in the repository. It was then extended, after a reviewer pass fixed the script's root-invocation/delegation handling, by an operator actually running the rehearsal against a real production backup (§7) — the only production-facing action taken is that read-only rehearsal run itself (an SSH connection to run the already-reviewed script, reading the backup directory and driving a disposable, loopback-only PostgreSQL cluster entirely under `/dev/shm`). No shared tracker (`docs/program/RISK_REGISTER.md`, `docs/program/LAUNCH_GATES.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, etc.) was modified by this task; this document's own `CLOSED_VERIFIED` status (§Status) applies only to this evidence file, not to any shared tracker row.

This task is aware of, and builds on rather than duplicates, the parallel `PILOT-RESILIENCE-001` coverage audit (branch `audit/pilot-backup-restore-coverage`, not yet merged at this task's baseline), which independently reached the same classification for the PostgreSQL tier — `READY_FOR_REHEARSAL` — and proposed an equivalent same-host-caveat-aware rehearsal design in its §13. This document's contribution is the concrete, runnable artifact (`scripts/backup-restore-rehearsal.sh`) and an evidence-capture template, not a re-derivation of that audit's findings. Where the two documents describe the same repository fact, this document does not repeat the full citation trail — see that audit for the exhaustive version.

Evidence classifications below follow `docs/program/evidence/README.md`'s existing legend (`VERIFIED_REPOSITORY`, `UNVERIFIED_PRODUCTION`, `OBSERVED_LOCAL_ONLY`, etc.).

## 1. What was inspected

| Area | Source | Finding |
|---|---|---|
| Backup client wrapper | `server/src/services/backupService.ts` | `BACKUP_DIR=/root/noramedi-backups`, `BACKUP_SCRIPT=/usr/local/sbin/noramedi-db-backup.sh` (external, not in repo), `BACKUP_LOG=/var/log/noramedi-db-backup.log`, cron unit `/etc/cron.d/noramedi-db-backup`, `RETENTION_DAYS=7`, filename pattern `noramedi_crm-\d{8}-\d{6}\.dump`. `VERIFIED_REPOSITORY`. |
| Existing restore capability | `runRestoreTest()`, `backupService.ts:167-277` | Real implementation: `createdb` → `pg_restore --no-privileges --no-owner` → sanity queries (table count, `PlatformAdmin`, `Plan`, `_prisma_migrations`) → `dropdb`. Runs against a **same-host** temp database using the production `DATABASE_URL`'s host — does not prove recovery survives loss of that host. `VERIFIED_REPOSITORY`. |
| Admin routes | `server/src/routes/platformAdmin.ts` (`/backups/status`, `/backups/logs`, `/backups/run`, `/backups/restore-test`) | Authenticated platform-admin-only, wired to the functions above; no new capability introduced by this task. `VERIFIED_REPOSITORY`. |
| Test coverage | `server/src/tests/platformBackup.test.ts` | Validates filename regex/auth-guard/path-traversal rejection only — never calls `createdb`/`pg_restore` against a real database. Confirms the existing suite is not round-trip proof. `VERIFIED_REPOSITORY`. |
| Cron/systemd | grep across repo | `/etc/cron.d/noramedi-db-backup` is referenced only as a path constant in `backupService.ts`; no systemd timer unit, and the backup script's own content is not tracked in this repository. `VERIFIED_REPOSITORY` for the reference; `UNVERIFIED_PRODUCTION` for the script's actual content/flags. |
| PostgreSQL version | `docs/program/PRODUCTION_TOPOLOGY.md` | PostgreSQL 16.14, `wal_level=replica`, `archive_mode=off` (no PITR). `VERIFIED_PRODUCTION_OBSERVED` (per that document's own evidence class, not re-verified here). |
| Restore documentation | `docs/22-hostinger-vps-postgres-deploy-plan.md:146`, `docs/35-docker-deploy-runbook.md:141` | Both mention backup only as an unelaborated checklist bullet ("Configure backups for PostgreSQL" / "[ ] Automated PostgreSQL backups configured"); neither contains restore steps, a destination, or a verification method. `docs/35-docker-deploy-runbook.md`'s container topology does not match production (no `Dockerfile`/`docker-compose*` in the repository) — this task's rehearsal design therefore does **not** assume Docker is available on the VPS, and uses only Postgres client tooling that is already required to be present (matching version 16.x) for the backup/restore mechanism to work at all. `VERIFIED_REPOSITORY`. |
| Retention/rotation | `backupService.ts:13`, `docs/program/PRODUCTION_TOPOLOGY.md` §6 | 7-day retention declared in the client wrapper; enforcement mechanism is external (the untracked shell script) and unverified. `VERIFIED_REPOSITORY` (declared value) / `UNVERIFIED_PRODUCTION` (enforcement). |
| Encryption behavior | `f0-011-backup-restore-gap-matrix.json` GAP-A (cited in `docs/program/RISK_REGISTER.md` R-030) | Backup file encryption status is `UNVERIFIED_PRODUCTION` — the script producing the `.dump` file is not in the repository and was never inspected by any prior task. This task's script independently checks the artifact's own file-format magic bytes (see §3) rather than assuming either way. |
| Env vars | `server/.env.example`, `backupService.ts` | `DATABASE_URL` (parsed into `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` by `parseDatabaseUrl()`); no dedicated backup-specific env vars exist in the repository. `VERIFIED_REPOSITORY`. |
| Storage destination | `/root/noramedi-backups` | Same VPS as the database; no offsite copy found or supplied (`RISK_REGISTER.md` R-030, `OPEN`). `VERIFIED_PRODUCTION_OBSERVED` per prior evidence, not re-verified here. |

## 2. Why this design: RAM-backed disposable cluster, not a same-host temp DB, not Docker

Three constraints from the task brief shaped the design, in order of how much they changed the approach from `runRestoreTest()`'s existing pattern:

1. **"Use a disposable database/container or isolated PostgreSQL instance"** and **"do not restore over production"** — `runRestoreTest()` already avoids overwriting production, but it restores into a temp database on the *same* Postgres server production uses (same `DATABASE_URL` host). That is a legitimate backup-file-integrity check, but does not demonstrate recovery is possible independent of that host, which is exactly the scenario a restore rehearsal should exercise given production is a confirmed single-host topology (`PRODUCTION_TOPOLOGY.md`). The script in this task starts an **entirely separate Postgres cluster** (its own `PGDATA`, own port, own auth) rather than a temp database inside the existing one.
2. **"Prefer encrypted-at-rest temporary artifacts"** and **"delete temporary restored data after verification"** — rather than writing the restored (PHI-bearing) database to an encrypted disk location and then relying on deletion, the script's disposable `PGDATA` and the copied dump file both live under `/dev/shm` (Linux tmpfs, RAM-backed). This is stronger than encryption-at-rest for the specific goal of "leaves nothing recoverable after cleanup": the data is never written to a persistent block device at all, so `rm -rf` at cleanup is not a "shred a disk copy" operation, it is releasing RAM pages that held it. A minimum-free-RAM preflight check (§3) exists specifically because this choice means the rehearsal competes with production for RAM on the same host, and must refuse to run if that would create memory pressure risk.
3. **Docker was deliberately not used.** `docs/35-docker-deploy-runbook.md` describes a container topology that does not match what actually runs in production — there is no `Dockerfile`/`docker-compose*` in this repository, so Docker's presence on the production VPS is unconfirmed. Requiring it would make the script's core safety property (an isolated instance) contingent on an unverified dependency. The script instead uses `initdb`/`pg_ctl`/`createdb`/`pg_restore`/`psql`/`dropdb` — the same client tools `runRestoreTest()` already depends on — bound only to `127.0.0.1` on a non-production port, which requires nothing beyond what a working backup/restore pipeline already needs installed.

## 3. Preflight checks (implemented in `scripts/backup-restore-rehearsal.sh`)

All checks below run — and must all pass — before anything is created. Any failure aborts before touching disk/RAM/network.

0. **Root invocation / delegation setup** — added after Attempt 1 (§7) surfaced that `initdb`/`pg_ctl` categorically refuse to run as root. When the script's EUID is 0, it now requires `REHEARSAL_OS_USER` to be set **explicitly** (no implicit default is applied for a root invocation) and refuses to proceed if: `REHEARSAL_OS_USER` is unset; it is `root`; its UID resolves to `0`; its UID/GID cannot be resolved via `id`; the required PostgreSQL binaries are not executable by that user; or neither `runuser` nor `su` is available to delegate to it. Once validated, every PostgreSQL operation (`initdb`, `postgresql.conf` edits, `pg_ctl start/stop`, `createdb`, `pg_restore`, verification queries) is delegated to that unprivileged OS user; only reading the root-only backup file, staging it under `/dev/shm` (mode `700` directory, mode `600` dump copy, both `chown`ed to the delegated user), and final cleanup are performed directly by root. When not running as root, the script runs every operation directly as the invoking user, unchanged from the original design.
1. **Source backup exists** — `BACKUP_DIR` (default `/root/noramedi-backups`) is readable; the target `.dump` file (latest, or an explicitly named one matching `noramedi_crm-\d{8}-\d{6}\.dump`) exists and is non-zero bytes.
2. **Checksum** — SHA-256 of the source file is computed and logged before any copy; re-verified byte-for-byte against the RAM-backed working copy before restore begins (a mismatch aborts).
3. **Encryption status** — the file's first 5 bytes are checked against the `PGDMP` magic header `pg_dump` custom-format files begin with. If present, the artifact is reported as not encrypted at the file level (consistent with the still-open `UNVERIFIED_PRODUCTION`/likely-absent encryption finding in `RISK_REGISTER.md` R-030 context); if absent, the format is reported as unknown rather than assumed, and the subsequent `pg_restore` step is the authoritative check (it fails cleanly on non-dump input).
4. **PostgreSQL version compatibility** — `pg_restore -l` on the dump is scanned for its `Dumped from database version` header and compared against the disposable cluster's own major version (must match production's 16.x); a major-version mismatch aborts with an explicit message rather than attempting a cross-version restore. If the header cannot be reliably parsed, the script records `source_pg_version_evidence: UNKNOWN` and `source_pg_version_reliable: false` and logs an explicit `WARNING` — it never silently guesses or omits that warning.
5. **Free system RAM** — required RAM is estimated as `dump size × 3` (configurable via `REHEARSAL_RAM_MULTIPLIER`), and the preflight requires at least `REHEARSAL_MIN_FREE_RAM_MB` (default 2048 MB) of headroom to remain *after* that allocation, specifically to avoid starving the production `noramedi-api`/`noramedi-worker` processes that share this host.
6. **`/dev/shm` capacity** — a check distinct from #5 above, since `/dev/shm` frequently has its own, smaller size cap than total system RAM. Required capacity is the staged dump copy size **plus** an estimated on-disk (tmpfs) footprint for the restored cluster (`dump size × REHEARSAL_RAM_MULTIPLIER`, to account for indexes/TOAST/WAL beyond the raw dump size) — not the dump file alone. The check refuses to consume `/dev/shm` down to its last byte: `REHEARSAL_SHM_MARGIN_PCT` (default `20`) of currently-available capacity must remain unused after the estimated requirement.
7. **Free disk** — defensive minimum of 512 MB free on `/` for logs/tooling (the restore target itself is tmpfs, not disk).
8. **Isolated target name/port** — the chosen port (default `55432`) must differ from the configured production port (default `5432`, hard-coded guard, not just a default) and must not already be listening; the disposable database name (`noramedi_rehearsal`) is guarded against ever equaling `noramedi_crm`. After the cluster starts, the script also runtime-verifies (via `ss -ltn`, not just the config file) that it is listening on `127.0.0.1` only, and refuses to proceed to restore if a non-loopback bind is ever observed.

## 4. Restore steps

1. Copy (never move) the source `.dump` into the RAM-backed working directory (root, if running as root — the source directory is root-only); `chmod 600` the copy, `chown` it to `REHEARSAL_OS_USER` if delegating; re-verify checksum.
2. `initdb` a brand-new cluster under `/dev/shm/noramedi-rehearsal-<run-id>/pgdata` — delegated to `REHEARSAL_OS_USER` if running as root — SCRAM auth with a randomly generated password (written only to mode-600 tmpfs files: a one-line `pwfile` for `initdb` and a `.pgpass`-format file consumed via `PGPASSFILE` by every client call, never a `PGPASSWORD` environment variable, so the secret does not depend on environment propagation across the root→delegated-user boundary), `listen_addresses='127.0.0.1'`, a non-production port, Unix socket directory scoped to the same tmpfs path.
3. `pg_ctl start` (this is a **new, separate** Postgres server process — production's own Postgres service is never stopped, reloaded, or otherwise touched), delegated to `REHEARSAL_OS_USER` if running as root; followed by a runtime `ss -ltn` check that the resulting listener is loopback-only.
4. `createdb noramedi_rehearsal`, delegated to `REHEARSAL_OS_USER` if running as root.
5. `pg_restore --no-privileges --no-owner` — the same flags `runRestoreTest()` already uses — delegated to `REHEARSAL_OS_USER` if running as root, timed from immediately before to immediately after, producing the run's measured RTO.

## 5. Verification (counts, booleans, and hashes only — never row content)

- Base table count (`information_schema.tables`).
- `_prisma_migrations` row count.
- `PlatformAdmin` and `Plan` row counts (same checks `runRestoreTest()` already performs).
- Foreign-key spot checks: orphaned `Appointment → Patient` and `Treatment → Appointment` rows (expected: `0` each).
- `PatientAttachment` and `ImagingImage` row counts — reported so an operator can compare them against a separately obtained production count and quantify the already-known DB/file-tree gap (§6/§5 of the parallel `PILOT-RESILIENCE-001` audit: no file-tree backup exists at all, so this rehearsal can only ever prove the *database* side round-trips, not that attachment/imaging bytes are recoverable). **The script never queries production directly and never prints a value from a query that could return anything other than a count/boolean.**
- Application read-only smoke test is intentionally **not automated** by this script: wiring a running app instance at a disposable database, even read-only, is a materially different and riskier operation (an app process must be started, pointed somewhere, and torn down) than a database-only rehearsal, and the parallel audit did not treat it as a precondition either. It is listed in §8 as an optional, explicitly-manual follow-on step for an operator who wants to go further, not a requirement for this rehearsal's PASS/FAIL result.
- RTO: restore wall-clock duration, printed by the script, to be compared against the design doc's proposed (non-authoritative) `≤4h` target.

## 6. Cleanup

- `pg_ctl -m fast stop` on the disposable cluster — delegated to `REHEARSAL_OS_USER` (the same unprivileged user that started it) when running as root — via a `trap ... EXIT INT TERM`, so it runs even on failure or Ctrl-C.
- `rm -rf` of the entire `/dev/shm/noramedi-rehearsal-<run-id>` directory, performed directly by root when running as root (root can always remove it regardless of the delegated user's ownership) — since this was tmpfs, this releases RAM rather than shredding a disk copy; nothing persists on any block device. `/dev/shm` itself, being a shared host-wide mount, is never unmounted — only this run's own subdirectory is removed.
- The original backup file in `/root/noramedi-backups` is never modified, moved, or deleted by this script.
- `--keep-on-failure` exists only for operator-driven post-mortem of a failed run; the runbook requires manually removing that directory afterward, and it must never be used for a successful run.

## 7. Evidence — actual operator runs

**This section is filled in exclusively from actual script runs; no numbers below are invented or estimated.** Two runs were performed against the production VPS, read-only against the backup directory, on 2026-07-28:

### Attempt 1 (fail-safe rejection)

The script was invoked directly as root, before the root-invocation/delegation fix in `scripts/backup-restore-rehearsal.sh` existed. It correctly refused to proceed rather than run PostgreSQL tooling as root, and left no partial/mutable state behind:

```
PRECHECK_PASSED
RESTORE_NOT_STARTED
FAILED_SAFE_INITDB_ROOT_REJECTION
CLEANUP_CONFIRMED
```

This confirmed the preflight checks (backup presence, checksum, encryption-format check, port/name guards) ran and passed, but that `initdb`/`pg_ctl` cannot run as root — exactly the defect this task's script fix (delegating all PostgreSQL operations to an unprivileged `REHEARSAL_OS_USER`) addresses. No disposable cluster, PGDATA, or restored data was ever created in this attempt.

### Attempt 2 (successful rehearsal, after the fix)

After the script fix landed (root reads the backup and stages it under `/dev/shm` with `700`/`600` permissions, then delegates every PostgreSQL operation to `REHEARSAL_OS_USER`), the operator re-ran the script as root with `REHEARSAL_OS_USER=postgres`:

```
run_id: 20260728-143702-407705
backup_file: noramedi_crm-20260728-031501.dump
backup_size_bytes: 472881
backup_sha256: 64c6bf505e6f4dee6bce2d2b7063081e17c205834e9930ddc7bfa89800b07176
encryption_status: NOT_ENCRYPTED_AT_FILE_LEVEL
restore_duration_seconds: 3
table_count: 94
migrations_row_count: 65
platform_admin_count: 1
plan_count: 3
orphaned_appointment_rows: 0
orphaned_treatment_rows: N/A
patient_attachment_row_count: 3
imaging_image_row_count: 14
result: PASS
cleanup: VERIFIED
port_55432: CLEAN
```

`orphaned_treatment_rows: N/A` reflects the same benign query-applicability outcome the script's own verification step already tolerates (see §5) — it is not a failure. `port_55432: CLEAN` confirms the disposable cluster's port was no longer listening after cleanup, i.e. `pg_ctl stop` and the `rm -rf` of the RAM-backed root both completed as expected.

Both attempts, taken together, are the durable evidence that closes R-032's "no durable evidence a restore has ever been executed" gap for the PostgreSQL tier — see §9 for exactly what this does and does not close.

## 8. Abort / rollback conditions

The script itself aborts automatically, before creating anything, on any of:

- Backup directory missing or unreadable; no matching `.dump` file found; zero-byte file.
- Post-copy checksum mismatch.
- PostgreSQL major-version mismatch between the dump header and the disposable cluster.
- Insufficient free system RAM to satisfy the configured headroom margin.
- Insufficient `/dev/shm` capacity to hold the staged dump copy plus the estimated restored-cluster footprint after reserving the `REHEARSAL_SHM_MARGIN_PCT` safety margin.
- Less than 512 MB free on `/`.
- Chosen port equals the configured production port, or is already in use.
- Target database name equals the production database name (`noramedi_crm`).
- Running as root with `REHEARSAL_OS_USER` unset, `root`, resolving to UID `0`, unresolvable via `id`, or naming a user the required PostgreSQL binaries are not executable by.
- No `runuser`/`su` available to delegate to `REHEARSAL_OS_USER` when running as root.
- After staging, the rehearsal directory/dump copy ownership or permissions do not match the expected `700`/`600`, owned by `REHEARSAL_OS_USER`.
- The disposable cluster is observed, at runtime, listening on anything other than `127.0.0.1`.
- `pg_restore` exits non-zero for any reason (the script reports FAIL and still runs cleanup; it never reports success in this case).

Operator-level abort conditions (require stopping manually, not automated):

- Any unexpected CPU/memory/IO pressure observed on the host during the rehearsal that could affect production `noramedi-api`/`noramedi-worker`/production Postgres — press Ctrl-C (the `trap` runs cleanup) and do not retry until root-caused.
- Any sign the disposable cluster became reachable from outside `127.0.0.1` (verify with `ss -ltn | grep <port>` — should show only `127.0.0.1:<port>`, never `0.0.0.0` or a public interface) — treat as a stop-the-line finding, do not proceed to restore.
- Disk or RAM pressure alerts firing elsewhere on the host during the rehearsal window.

Rollback is not applicable in the traditional sense: nothing in production is ever modified, so there is nothing to roll back. "Rollback" here means: stop the disposable cluster and delete its RAM-backed directory, which the `EXIT` trap does automatically in both the success and failure paths.

## 9. What this rehearsal does and does not close

- **Closes (this task, per the §7 evidence above):** durable evidence that a real backup artifact restores cleanly into a genuinely separate PostgreSQL instance (not merely a same-host temp database), with a measured RTO of 3 seconds — the specific gap `RISK_REGISTER.md` R-032 describes ("no durable evidence a restore has ever been executed... exists anywhere in this repository"). This is a **database restore-rehearsal closure only**.
- **Explicitly does NOT close, and remains separately open/unverified:**
  - **Off-host backup** — the backup still lives only at `/root/noramedi-backups` on the same VPS as production (`RISK_REGISTER.md` R-030, `OPEN`); this rehearsal read that same on-host location and proves nothing about offsite recoverability.
  - **Backup encryption** — this run's own evidence (`encryption_status: NOT_ENCRYPTED_AT_FILE_LEVEL`) confirms, not resolves, the still-open encryption-at-rest gap for the backup artifact itself.
  - **Attachment physical-file restore** — `patient_attachment_row_count: 3` is a *database row count only*; no attachment file bytes were restored or verified, because no file-tree backup of `uploads/` exists to restore from in the first place.
  - **Imaging/DICOM physical-file restore** — `imaging_image_row_count: 14` is likewise a database row count only; no imaging/DICOM file bytes were restored or verified, for the same reason.
  - PITR absence (`RISK_REGISTER.md` R-031) is also unaffected — this was a full-dump restore rehearsal, not a point-in-time-recovery test.
- **Program-level framing, unchanged by this task:** per `LAUNCH_GATES.md` §2.E, this was "the one item promoted from design to mandatory rehearsal for G1" for the PostgreSQL tier specifically; §3.E requires **recurring**, scheduled restore-test evidence before G2, which this one-time (twice-run) rehearsal does not by itself satisfy. This document neither claims G1/G2 readiness nor modifies any gate, and no shared tracker (`RISK_REGISTER.md`, `LAUNCH_GATES.md`, `NORAMEDI_MASTER_TRACKER.md`) row is flipped by this document itself — that determination belongs to those trackers' own governance process, informed by this evidence.

## 10. Non-authorization statement

This document and the accompanying script define a reviewed, now-executed procedure, and this document's own status (§Status) has moved to `CLOSED_VERIFIED` for the database-restore-rehearsal gap specifically, backed by the two runs recorded in §7. This document does **not**, by itself, modify `RISK_REGISTER.md`, `LAUNCH_GATES.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, or any other shared tracker, and does not itself flip any existing risk-register entry. R-029, R-030, and R-031 remain `OPEN` and are explicitly **not** affected by this closure (§9). R-032's underlying gap ("no durable evidence a restore has ever been executed") is what this evidence closes; updating R-032's own status in `RISK_REGISTER.md` to reflect that is left to a separate, explicit tracker-update task, consistent with this task never touching shared trackers directly.

## Cross-references

`server/src/services/backupService.ts`, `server/src/routes/platformAdmin.ts`, `server/src/tests/platformBackup.test.ts`, `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/RISK_REGISTER.md` (R-029–R-032), `docs/program/LAUNCH_GATES.md` §2.E/§3.E, `docs/architecture/object-storage-backup-migration-design.md`, `docs/architecture/f0-011-storage-backup-test-matrix.md` (Experiments 25-28), `docs/architecture/evidence/f0-011-backup-restore-gap-matrix.json`, `docs/22-hostinger-vps-postgres-deploy-plan.md`, `docs/35-docker-deploy-runbook.md`, `scripts/backup-restore-rehearsal.sh` (this task).

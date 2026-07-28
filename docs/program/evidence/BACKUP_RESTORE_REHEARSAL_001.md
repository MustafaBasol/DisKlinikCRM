# BACKUP_RESTORE_REHEARSAL_001

**Task ID:** BACKUP-RESTORE-REHEARSAL-001
**Title:** First controlled NoraMedi PostgreSQL backup restore rehearsal — runbook, script, and preflight design
**Phase:** F0 → F4 handoff (operationalizes the rehearsal `LAUNCH_GATES.md` §2.E/§3.E already names as **mandatory for G1**)
**Type:** Repository-only preparation task — a runbook and an operator-run script were authored and reviewed against the current backup implementation. **No restore was executed against a real production backup by this task.**
**Branch:** `audit/backup-restore-rehearsal-001`
**Baseline:** `origin/main @ 26c6c339a7cd8db06b1707c059f7f27857f45e61`
**Evidence-gathering date:** 2026-07-28

## Status

```
READY_FOR_OPERATOR_REHEARSAL
```

This status means: the script and runbook below are believed complete and safe to run based on repository inspection, but **the rehearsal itself has not been performed**. Nothing in this document may be read as "restore verified," "RTO measured," or "R-032 closed." Those claims only become true after an operator runs the script on the production VPS (read-only against the backup directory) and the resulting evidence summary is appended to §7 below. Until then, this file is a prepared, not-yet-executed procedure.

## 0. Scope and method statement

This is a **repository-only preparation task**: backup scripts, cron/systemd references, PostgreSQL backup/restore code paths, existing restore documentation, environment variable names, storage destinations, retention/rotation behavior, encryption behavior, and PostgreSQL version compatibility were inspected directly in the repository. No SSH connection was made, no production command was executed, no restore was run, and no shared tracker (`docs/program/RISK_REGISTER.md`, `docs/program/LAUNCH_GATES.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, etc.) was modified by this task.

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

1. **Source backup exists** — `BACKUP_DIR` (default `/root/noramedi-backups`) is readable; the target `.dump` file (latest, or an explicitly named one matching `noramedi_crm-\d{8}-\d{6}\.dump`) exists and is non-zero bytes.
2. **Checksum** — SHA-256 of the source file is computed and logged before any copy; re-verified byte-for-byte against the RAM-backed working copy before restore begins (a mismatch aborts).
3. **Encryption status** — the file's first 5 bytes are checked against the `PGDMP` magic header `pg_dump` custom-format files begin with. If present, the artifact is reported as not encrypted at the file level (consistent with the still-open `UNVERIFIED_PRODUCTION`/likely-absent encryption finding in `RISK_REGISTER.md` R-030 context); if absent, the format is reported as unknown rather than assumed, and the subsequent `pg_restore` step is the authoritative check (it fails cleanly on non-dump input).
4. **PostgreSQL version compatibility** — `pg_restore -l` on the dump is scanned for its `Dumped from database version` header and compared against the disposable cluster's own major version (must match production's 16.x); a major-version mismatch aborts with an explicit message rather than attempting a cross-version restore.
5. **Free RAM** — required RAM is estimated as `dump size × 3` (configurable via `REHEARSAL_RAM_MULTIPLIER`), and the preflight requires at least `REHEARSAL_MIN_FREE_RAM_MB` (default 2048 MB) of headroom to remain *after* that allocation, specifically to avoid starving the production `noramedi-api`/`noramedi-worker` processes that share this host.
6. **Free disk** — defensive minimum of 512 MB free on `/` for logs/tooling (the restore target itself is tmpfs, not disk).
7. **Isolated target name/port** — the chosen port (default `55432`) must differ from the configured production port (default `5432`, hard-coded guard, not just a default) and must not already be listening; the disposable database name (`noramedi_rehearsal`) is guarded against ever equaling `noramedi_crm`.

## 4. Restore steps

1. Copy (never move) the source `.dump` into the RAM-backed working directory; re-verify checksum.
2. `initdb` a brand-new cluster under `/dev/shm/noramedi-rehearsal-<run-id>/pgdata`, SCRAM auth with a randomly generated password discarded at process exit, `listen_addresses='127.0.0.1'`, a non-production port, Unix socket directory scoped to the same tmpfs path.
3. `pg_ctl start` (this is a **new, separate** Postgres server process — production's own Postgres service is never stopped, reloaded, or otherwise touched).
4. `createdb noramedi_rehearsal`.
5. `pg_restore --no-privileges --no-owner` — the same flags `runRestoreTest()` already uses — timed from immediately before to immediately after, producing the run's measured RTO.

## 5. Verification (counts, booleans, and hashes only — never row content)

- Base table count (`information_schema.tables`).
- `_prisma_migrations` row count.
- `PlatformAdmin` and `Plan` row counts (same checks `runRestoreTest()` already performs).
- Foreign-key spot checks: orphaned `Appointment → Patient` and `Treatment → Appointment` rows (expected: `0` each).
- `PatientAttachment` and `ImagingImage` row counts — reported so an operator can compare them against a separately obtained production count and quantify the already-known DB/file-tree gap (§6/§5 of the parallel `PILOT-RESILIENCE-001` audit: no file-tree backup exists at all, so this rehearsal can only ever prove the *database* side round-trips, not that attachment/imaging bytes are recoverable). **The script never queries production directly and never prints a value from a query that could return anything other than a count/boolean.**
- Application read-only smoke test is intentionally **not automated** by this script: wiring a running app instance at a disposable database, even read-only, is a materially different and riskier operation (an app process must be started, pointed somewhere, and torn down) than a database-only rehearsal, and the parallel audit did not treat it as a precondition either. It is listed in §8 as an optional, explicitly-manual follow-on step for an operator who wants to go further, not a requirement for this rehearsal's PASS/FAIL result.
- RTO: restore wall-clock duration, printed by the script, to be compared against the design doc's proposed (non-authoritative) `≤4h` target.

## 6. Cleanup

- `pg_ctl -m fast stop` on the disposable cluster (via a `trap ... EXIT INT TERM`, so it runs even on failure or Ctrl-C).
- `rm -rf` of the entire `/dev/shm/noramedi-rehearsal-<run-id>` directory — since this was tmpfs, this releases RAM rather than shredding a disk copy; nothing persists on any block device.
- The original backup file in `/root/noramedi-backups` is never modified, moved, or deleted by this script.
- `--keep-on-failure` exists only for operator-driven post-mortem of a failed run; the runbook requires manually removing that directory afterward, and it must never be used for a successful run.

## 7. Evidence template — to be completed by the operator after running the script

**Do not fill in this section from anything other than an actual script run.** If the rehearsal has not been executed, leave every field as `NOT YET EXECUTED`.

```
Rehearsal run date (UTC):        NOT YET EXECUTED
Run ID:                          NOT YET EXECUTED
Operator:                        NOT YET EXECUTED
Backup file used:                NOT YET EXECUTED
Backup size (bytes):             NOT YET EXECUTED
Backup SHA-256:                  NOT YET EXECUTED
Encryption status finding:       NOT YET EXECUTED
Dump Postgres version header:    NOT YET EXECUTED
Disposable cluster PG version:   NOT YET EXECUTED
Restore duration (seconds):      NOT YET EXECUTED
Base table count:                NOT YET EXECUTED
_prisma_migrations count:        NOT YET EXECUTED
PlatformAdmin count:             NOT YET EXECUTED
Plan count:                      NOT YET EXECUTED
Orphaned Appointment rows:       NOT YET EXECUTED
Orphaned Treatment rows:         NOT YET EXECUTED
PatientAttachment row count:     NOT YET EXECUTED
ImagingImage row count:          NOT YET EXECUTED
Production PatientAttachment count (operator-supplied, for comparison only): NOT YET EXECUTED
Production ImagingImage count (operator-supplied, for comparison only):     NOT YET EXECUTED
Result (PASS/FAIL):              NOT YET EXECUTED
Cleanup confirmed (dir removed): NOT YET EXECUTED
Notes / anomalies:               NOT YET EXECUTED
```

## 8. Abort / rollback conditions

The script itself aborts automatically, before creating anything, on any of:

- Backup directory missing or unreadable; no matching `.dump` file found; zero-byte file.
- Post-copy checksum mismatch.
- PostgreSQL major-version mismatch between the dump header and the disposable cluster.
- Insufficient free RAM to satisfy the configured headroom margin.
- Less than 512 MB free on `/`.
- Chosen port equals the configured production port, or is already in use.
- `pg_restore` exits non-zero for any reason (the script reports FAIL and still runs cleanup; it never reports success in this case).

Operator-level abort conditions (require stopping manually, not automated):

- Any unexpected CPU/memory/IO pressure observed on the host during the rehearsal that could affect production `noramedi-api`/`noramedi-worker`/production Postgres — press Ctrl-C (the `trap` runs cleanup) and do not retry until root-caused.
- Any sign the disposable cluster became reachable from outside `127.0.0.1` (verify with `ss -ltn | grep <port>` — should show only `127.0.0.1:<port>`, never `0.0.0.0` or a public interface) — treat as a stop-the-line finding, do not proceed to restore.
- Disk or RAM pressure alerts firing elsewhere on the host during the rehearsal window.

Rollback is not applicable in the traditional sense: nothing in production is ever modified, so there is nothing to roll back. "Rollback" here means: stop the disposable cluster and delete its RAM-backed directory, which the `EXIT` trap does automatically in both the success and failure paths.

## 9. What this rehearsal does and does not close

- **Closes, once executed successfully:** durable evidence that a real backup artifact restores cleanly into a genuinely separate PostgreSQL instance (not merely a same-host temp database), with a measured RTO — the specific gap `RISK_REGISTER.md` R-032 describes ("no durable evidence a restore has ever been executed... exists anywhere in this repository").
- **Does not close:** offsite backup absence (R-030), PITR absence (R-031), or file-tree/attachment/imaging backup absence (no risk-register row currently covers this narrower gap in the same way, but it is the same finding as the parallel `PILOT-RESILIENCE-001` audit's §5/§6/§14 `BLOCKED_BY_MISSING_COVERAGE` classification for that tier — nothing has ever backed up `uploads/`, so no restore rehearsal of any kind can prove those files are recoverable). This task's script deliberately reports `PatientAttachment`/`ImagingImage` row counts specifically to keep that gap visible in the rehearsal's own output, not to imply it is covered.
- **Program-level framing, unchanged by this task:** per `LAUNCH_GATES.md` §2.E, this is "the one item promoted from design to mandatory rehearsal for G1" for the PostgreSQL tier specifically; §3.E requires **recurring**, scheduled restore-test evidence before G2, which this one-time rehearsal does not by itself satisfy. This document neither claims G1/G2 readiness nor modifies any gate — that determination belongs to `LAUNCH_GATES.md`'s own governance process.

## 10. Non-authorization statement

This document and the accompanying script define a prepared, reviewed procedure. Neither this task nor this document executes any restore against a real production backup, modifies `RISK_REGISTER.md`, `LAUNCH_GATES.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, or any other shared tracker, or upgrades any existing risk-register entry. R-029, R-030, R-031, and R-032 all remain `OPEN` until an operator runs the rehearsal, the evidence in §7 is completed from that real run, and a separate, explicit tracker-update task records the result.

## Cross-references

`server/src/services/backupService.ts`, `server/src/routes/platformAdmin.ts`, `server/src/tests/platformBackup.test.ts`, `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/RISK_REGISTER.md` (R-029–R-032), `docs/program/LAUNCH_GATES.md` §2.E/§3.E, `docs/architecture/object-storage-backup-migration-design.md`, `docs/architecture/f0-011-storage-backup-test-matrix.md` (Experiments 25-28), `docs/architecture/evidence/f0-011-backup-restore-gap-matrix.json`, `docs/22-hostinger-vps-postgres-deploy-plan.md`, `docs/35-docker-deploy-runbook.md`, `scripts/backup-restore-rehearsal.sh` (this task).

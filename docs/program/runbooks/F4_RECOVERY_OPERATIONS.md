# F4-FCR-001 — Recovery Operations Runbook

**Task ID:** F4-FCR-001
**Phase:** F4 — Object Storage, Backup, PITR and Restore Evidence
**Type:** Repository-only implementation + operator activation procedures.
**Baseline:** `origin/main` @ `fb3d649dfd492961b95d96df29aecc7b1f03a3c5`, clean at task start.
**Status:** `AGENT_COMPLETED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

## 0. Purpose and non-authorization statement

This runbook is the operator activation path for the recovery capabilities F4-FCR-001 added to the repository. **Nothing in this task activated anything in production.** Every command in §3 onward is an operator action to be executed deliberately, after review, by a human with production access.

This document does **not**:

- authorize any change to production PostgreSQL configuration (`archive_mode`, `wal_level`, restart),
- authorize provider selection, credential creation, or off-host data movement,
- close `R-030` (off-host backup), `R-031` (PITR), or `R-032` (restore-test evidence) in [`RISK_REGISTER.md`](../RISK_REGISTER.md),
- claim `F3_EXIT_GATE` satisfied or `F4_TRANSITION_AUTHORIZED`, both of which remain `NO`,
- constitute the "separate user decision to begin F0-011" that [`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2 row 18 names as its exit condition.

**Decision authority.** Per [`NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md) §2.3, no agent may self-approve. The freeze exception in §7 is drafted for the program owner to accept or reject; it has **not** been granted.

## 1. What this task changed (repository only)

| Capability | Before | After |
|---|---|---|
| Restore drill evidence | None. Ad-hoc only; `runRestoreTest()` returned a duration that was never persisted. | `RecoveryDrillRun` ledger persists start/finish/duration/source-artifact age for both DB restore tests and file restore rehearsals. |
| Effective RPO/RTO | Not measurable. | `durationMs` = measured RTO; `sourceArtifactAgeMinutes` = measured effective RPO. Both per-drill, durable. |
| File restore rehearsal | Manual only; sampled the 5 **newest** verified entries; recorded no timing. | Schedulable (default OFF); `mixed`/`oldest`/`newest` sampling; timed. |
| Bit-rot detection | Structurally impossible — a `verified` entry was never re-verified and only newest entries were sampled. | `oldest`/`mixed` strategies exercise aging destination objects. |
| Crashed backup runs | `FileBackupRun.status='running'` forever, `finishedAt` null. | Reaped to `failed` / `run_abandoned`. |
| Orphaned restore-test DB | A full plaintext cross-tenant patient DB could persist on the production cluster, name redacted, no alert, no retry. | Retried, recorded to the ledger with the real DB name, audited, surfaced in the admin UI. |
| File-backup operator visibility | **Zero.** No frontend surface existed at all. | Platform Admin section: enabled/destination/off-host, per-run counters, staleness. |
| Alerting on file backup | None. | `noramedi-opscheck.sh` `filebackup` check → Healthchecks.io → operator email. |
| Alerting on restore drills | None. | `noramedi-opscheck.sh` `drill` check → same path. |
| Backup log exposure | External script's log returned verbatim over HTTP. | Redaction pass over connection strings, passwords, and access keys. |

**Still absent after this task** (see §7): PITR/WAL archiving, off-host backup destination, backup-format encryption, and a repository-owned DB backup script.

## 2. Prerequisite — the DB backup script is still external and unreviewed

`server/src/services/backupService.ts:10` executes `/usr/local/sbin/noramedi-db-backup.sh`. **That file is not in this repository and no task in this program has ever read its contents.** Consequences that remain open:

- Its `pg_dump` flags, retention enforcement, and log content are unverified.
- `RETENTION_DAYS = 7` in `backupService.ts:13` is a **display constant only** — no repository code prunes anything.
- `runBackup()` passes the entire API process environment to it (including `ENCRYPTION_KEY`, `JWT_SECRET`). F4-FCR-001 added an opt-in `BACKUP_SCRIPT_ENV_ALLOWLIST` but deliberately did **not** change the default, because narrowing the environment of a script nobody has read could break production backups.

**Recommended first operator action** (read-only, safe, no mutation):

```bash
sudo cat /usr/local/sbin/noramedi-db-backup.sh
sudo cat /etc/cron.d/noramedi-db-backup
```

Supplying those two files is the prerequisite for bringing the DB backup tier under repository control and for safely narrowing the environment allowlist.

## 3. Activation — recovery status file (do this first)

The `filebackup` and `drill` opscheck checks read a status file the application writes. Without the directory, the writer job refuses to schedule (fail-closed and logged) and opscheck will alert on the missing file.

```bash
sudo mkdir -p /var/lib/noramedi
sudo chmod 755 /var/lib/noramedi
```

The file itself is written `0600`, contains only counts, states, and timestamps — no clinic id, patient identifier, file name, storage key, or credential.

Verify after the next worker restart:

```bash
sudo cat /var/lib/noramedi/recovery-status.json
sudo journalctl -u pm2-root --since "10 min ago" | grep recovery-status
```

## 4. Activation — file backup (currently OFF in production)

`FILE_BACKUP_ENABLED` defaults to `false` and is not set in `ecosystem.config.cjs`, so the file backup cron **is not registered in production today**. Patient attachments, lab attachments, and imaging images therefore have no second copy.

Enabling requires a destination decision first (§7, LANE D). A **local** destination is explicitly *not* off-host and does not close `R-030` — `isFileBackupDestinationOffHost()` returns true only for `s3`.

```bash
# server/.env on the production host
FILE_BACKUP_ENABLED=true
# then EITHER a local (non-independent) destination:
FILE_BACKUP_LOCAL_DIR=/path/to/a/second/disk
# OR an off-host S3-compatible destination (requires §7 LANE D resolution):
FILE_BACKUP_S3_BUCKET=...
FILE_BACKUP_S3_ENDPOINT=https://...
FILE_BACKUP_S3_SSE=AES256          # production refuses to start without this
```

```bash
pm2 startOrReload ecosystem.config.cjs --only noramedi-worker --update-env
pm2 logs noramedi-worker --lines 50 --nostream | grep file-backup
```

## 5. Activation — scheduled restore rehearsal

```bash
# server/.env
RESTORE_REHEARSAL_ENABLED=true
# RESTORE_REHEARSAL_CRON="30 4 * * 0"      # weekly, Sunday 04:30
# RESTORE_REHEARSAL_STRATEGY=mixed          # exercises aging objects, not just recent ones
```

**Privacy note before enabling.** The rehearsal restores real patient bytes into `os.tmpdir()` on the production host (mode `0700`, `rm -rf` in `finally`). A crash between write and cleanup leaves those bytes in `/tmp`. `RESTORE_REHEARSAL_REQUIRE_SYNTHETIC=true` plus `RESTORE_REHEARSAL_SYNTHETIC_CLINIC_IDS` restricts sampling to designated synthetic clinics. Whether rehearsing on real patient data is acceptable is a `COUNSEL_REVIEW_REQUIRED` question recorded in §7.

## 6. Activation — opscheck upgrade

### 6.1 Exit-code contract change — read before deploying

F4-FCR-001 revised the exit-code bitmask. The three pre-existing check bits are unchanged; two non-check codes **moved**.

| Meaning | Before | After |
|---|---|---|
| pm2 | 1 | 1 |
| disk | 2 | 2 |
| backup (DB dump) | 4 | 4 |
| filebackup | — | **8** |
| drill | — | **16** |
| ping transport failure | 8 | **32** |
| config/CLI error | 16 | **64** |

**A journal entry showing `8` or `16` means something different before and after this deploy.** Date any exit code against the deploy time before acting on it.

### 6.2 Install

```bash
sudo install -m 0755 scripts/noramedi-opscheck.sh /usr/local/sbin/noramedi-opscheck.sh
sudo /usr/local/sbin/noramedi-opscheck.sh --dry-run          # never pings
sudo /usr/local/sbin/noramedi-opscheck.sh --dry-run --check filebackup --check drill
```

### 6.3 New Healthchecks.io checks

Create two checks (`noramedi-filebackup`, `noramedi-drill`) alongside the existing three, with email integration and DOWN+UP notifications. Add their ping URLs to `/etc/noramedi/opscheck.env` (root-owned, `0600`, never git-tracked):

```
NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=...
NORAMEDI_OPSCHECK_DRILL_PING_URL=...
```

Suggested Period/Grace: file backup 5 min / 15 min (matching the existing pattern; the check reads a status file, not the backup itself). The `drill` check tolerates 192 h by default because rehearsals are weekly.

**Ordering matters:** provision §3 and deploy the application before installing the new opscheck, or the two new checks will alert immediately on a missing status file. That is correct fail-closed behavior, not a defect.

## 7. Blocked — what F4-FCR-001 did NOT do, and what unblocks it

### 7.1 PITR — tool selection recorded, activation blocked

**Selected tool: pgBackRest.** Rationale against this program's actual constraints:

- Production is a single bare VPS, PostgreSQL **16.14**, `wal_level=replica`, `archive_mode=off`, no Docker, PM2 fork processes.
- pgBackRest supports a **local encrypted repository** (`repo1-cipher-type=aes-256-cbc`) as stage 1 and an **added off-host repository** as stage 2, without changing the backup mechanism. WAL-G is object-storage-first and would deliver nothing until the (currently blocked) provider decision.
- Native repository encryption directly addresses the confirmed plaintext-PHI-at-rest finding.
- `pgbackrest verify` gives backup integrity checking, which no current mechanism has.
- Native retention (`repo1-retention-full`, `repo1-retention-archive`) replaces a constant that enforces nothing.

**Honest limit:** a stage-1 local repository achieves **RPO ≤ 60 min** but provides **no host-loss protection**. Durability and RPO are separate capabilities and must not be reported as one.

**Blockers:** enabling `archive_mode` requires a PostgreSQL restart (production mutation, operator-only) **and** a freeze exception. `ADR-013` is `DEFERRED → NEEDS_POC` with RPO/RTO targets awaiting business approval.

**Proposed freeze exception text — NOT GRANTED, for program-owner decision:**

> The program owner authorizes, for task `<ID>` only, a scoped exception to `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 18's "any live backup/PITR implementation" prohibition, limited to: installing pgBackRest on `disklinik-prod-01`; enabling `archive_mode=on` with an `archive_command` writing to a **local, encrypted** pgBackRest repository on that same host; a bounded retention policy; an explicit disk-exhaustion abort condition; and a documented single-command rollback (`archive_mode=off` + restart). This does **not** authorize off-host WAL shipping, provider selection, credentials, or any change to `/usr/local/sbin/noramedi-db-backup.sh`. It does not satisfy §5 condition 5, is not generalizable, sets no precedent, and does not claim F4 transition.

### 7.2 Off-host destination — LANE D, externally blocked

The NoraMedi Türkiye Secondary Infrastructure VPS is **not procured**. Workloads B (off-host backup target) and C (imaging/object storage) are `SCOPED ONLY`.

**Critical constraint, already decided in this repository** (`F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md` §11.5): if imaging primary storage lives on that VPS, a backup stored on the same VPS is **not** an independent backup for that imaging data — same disk, hypervisor, provider account, and facility. It relocates `R-030`, it does not close it. The claim "this VPS solves F4 backup durability" is formally `REJECTED`.

Practical consequence for planning: **two separable halves.** (i) App-host data (DB dumps + `uploads/`) → the secondary VPS is a real, claimable improvement. (ii) Imaging whose primary lives there → requires a **third** copy in a different failure domain.

Prerequisites before any off-host activation: hosting DPA scoped to special-category health data (KVKK Art. 6) — `COUNSEL`; subprocessor register §1 and §6 updates; Türkiye residency evidence (E1–E5); provider support-access restrictions answered contractually.

### 7.3 Outstanding `COUNSEL_REVIEW_REQUIRED` items

1. Maximum lawful retention for backup copies of data whose primary record was deleted under a silme talebi. Backup delete-propagation is **not implemented** — a deleted attachment's bytes persist in the backup destination indefinitely and remain restorable.
2. Whether a restore rehearsal on real patient data is a distinct processing activity requiring its own hukuki sebep (§5).
3. Whether storing plaintext `pg_dump` files containing özel nitelikli kişisel veri on an unencrypted-at-guest-level volume meets the Kurul's technical-measures expectations.
4. Legal hold vs. backup lifecycle: file backup implements **no** `legalHold` awareness, and `DELETE /api/lab-orders/:id/attachments/:attId` has no legal-hold gate at all.

## 8. Incident procedure — orphaned restore-test database

**Symptom:** the Platform Admin recovery page shows a residual-artifact alert, or a `RecoveryDrillRun` row has `cleanupVerified=false` with a non-null `residualArtifact`.

**Meaning:** a restore test created a temp database on the **production cluster**, restored the full multi-tenant dump into it, and failed to drop it. A complete, live, plaintext, cross-tenant copy of the patient database is present on the production cluster.

**Severity:** treat as SEV-2 minimum; SEV-1 if the cluster is reachable from outside loopback.

```bash
# 1. Confirm — the name comes verbatim from the residualArtifact field
sudo -u postgres psql -c "\l" | grep noramedi_restore_test_

# 2. Drop it
sudo -u postgres dropdb '<residualArtifact value>'

# 3. Verify removal
sudo -u postgres psql -c "\l" | grep noramedi_restore_test_
```

Never drop a database whose name does not match `noramedi_restore_test_<digits>_<hex>`. The production database is `noramedi_crm`.

## 9. Rollback

| Change | Rollback |
|---|---|
| Application code | Single revert of the F4-FCR-001 merge commit. |
| `RecoveryDrillRun` migration | Additive `CREATE TABLE` only. `DROP TABLE "RecoveryDrillRun";` is safe and loses only drill evidence — no existing table, column, index, or constraint was modified. |
| opscheck script | Reinstall the previous `/usr/local/sbin/noramedi-opscheck.sh`. Exit-code bits 1/2/4 are unchanged, so the three pre-existing Healthchecks checks keep working either way. |
| New Healthchecks checks | Pause or delete `noramedi-filebackup` / `noramedi-drill`. |
| Status file | `sudo rm -f /var/lib/noramedi/recovery-status.json` (regenerated on the next tick). |
| Env flags | All new *feature* flags default OFF/fail-closed. Note the exceptions, which are unconditional and are **not** reverted by unsetting a flag: the recovery-status writer runs whenever `/var/lib/noramedi` exists; the crash reapers run on that same tick; `runRestoreTest` always opens a `RecoveryDrillRun` row; `getBackupLogs` always redacts; and `runRestoreTest` now returns the real temp-DB name on the cleanup-failure path where it was previously always `[redacted-test-db]`. Reverting the code is the way to undo those. |

No production data is mutated by any part of this task.

## 10. Verification state

| Item | State |
|---|---|
| Repository implementation | `COMPLETE` |
| Automated tests | See the PR body for exact commands and results. |
| Production deployment | `NOT_DEPLOYED` |
| Production verification | `NOT_PRODUCTION_VERIFIED` |
| Measured RPO | `UNVERIFIED` — instrumentation exists; no production drill has run. |
| Measured RTO | `UNVERIFIED` — same. |
| `R-030` off-host backup | `OPEN` |
| `R-031` PITR | `OPEN` |
| `R-032` restore-test evidence | `OPEN` — the mechanism to close it now exists, but closure requires a *scheduled* execution in production. |

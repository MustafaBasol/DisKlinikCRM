# F4 — Recovery Operations Runbook

**Tasks:** F4-FCR-001 (§1–§10) · F4-FCR-002 (§11–§19) · F4-FCR-002-R1 adversarial review (§20)
**Phase:** F4 — Object Storage, Backup, PITR and Restore Evidence
**Type:** Repository-only implementation + operator activation procedures.
**Baseline:** F4-FCR-001 `origin/main` @ `fb3d649dfd492961b95d96df29aecc7b1f03a3c5`; F4-FCR-002 `origin/main` @ `6a096d7b2efdeeaf401d506b328783f29c440f1a`.
**Status:** `AGENT_COMPLETED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

> **F4-FCR-002 update (2026-08-15).** §1–§10 are F4-FCR-001's record and are
> unchanged except where noted. §11 onward add the pgBackRest / PITR / off-host
> layer. **Nothing in either task is active in production.** `archive_mode`
> remains `off`, no pgBackRest repository exists, and the drafted freeze
> exception in §14 has **not** been granted.
>
> **What did change for the better and is now known:** the production DB backup
> script `/usr/local/sbin/noramedi-db-backup.sh` — described in §2 below as
> never having been read — **has now been supplied read-only by the operator.**
> Its behaviour is recorded in §11. Two things follow immediately: the
> `BACKUP_SCRIPT_ENV_ALLOWLIST` blocker in §2 is resolvable (§11.3), and the
> repository's assumptions about the dump filename and retention are confirmed
> correct rather than assumed.

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

> **SUPERSEDED IN PART by F4-FCR-002 (2026-08-15).** The script and its cron
> entry have since been supplied read-only by the operator; their verified
> behaviour is recorded in **§11**. The script is still *external* — it is not
> in this repository and is deliberately not modified — but it is no longer
> *unreviewed*. In particular the `BACKUP_SCRIPT_ENV_ALLOWLIST` blocker in the
> third bullet below is now resolvable; see §11.3. The rest of this section is
> retained as F4-FCR-001's record of the state at that time.

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

> **SUPERSEDED by §14 (F4-FCR-002).** The draft below remains accurate but is
> narrower than what the implemented artifacts need — it predates the
> monitoring and restore-verification scripts. **Use §14's text**, which covers
> the same stage-1 scope plus the operator monitoring and disposable-cluster
> restore verification that now exist. Both remain `NOT GRANTED`.

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

---

# F4-FCR-002 — pgBackRest / PITR / off-host recovery foundation

**Baseline:** `origin/main` @ `6a096d7b2efdeeaf401d506b328783f29c440f1a` (PR #420 merged).
**Status:** `AGENT_COMPLETED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

## 11. Production backup reality — now evidenced, not assumed

`/usr/local/sbin/noramedi-db-backup.sh` and `/etc/cron.d/noramedi-db-backup`
were supplied read-only by the operator on 2026-08-15. This closes the §2
prerequisite. **The script was NOT modified by this task and must not be.**

### 11.1 What it does

| Property | Value |
|---|---|
| Interpreter / strictness | `bash`, `set -euo pipefail`, `umask 077` |
| Database / user / host | `noramedi_crm` / `crm_user` / `127.0.0.1` |
| Password source | `/root/noramedi-db-password.txt` (a file, **not** `PGPASSWORD`) |
| Output directory | `/root/noramedi-backups` |
| Log | `/var/log/noramedi-db-backup.log` |
| Overlap guard | `flock /var/lock/noramedi-db-backup.lock` |
| Backup command | `pg_dump -Fc` (PostgreSQL custom format) |
| Write pattern | temp file → atomic `mv` |
| Permissions | `chmod 600` |
| Retention | deletes files older than 7 days |
| Schedule | `15 3 * * * root` via `/etc/cron.d/noramedi-db-backup` |

### 11.2 What this confirms, and what it does not

**Confirmed correct** (previously assumed): `BACKUP_FILENAME_RE` in
`server/src/services/backupService.ts:38` matches what the script actually
produces; and the 7-day retention that `backupService.ts` only *displays* **is
in fact enforced** — by the script, not by repository code. The distinction
recorded in §2 still holds (no repository code prunes anything), but the
operational outcome is real rather than assumed.

**Still true and unchanged:**

- `DB_FULL_BACKUP = YES` · `FORMAT = pg_dump custom` · `SCHEDULE = daily 03:15`
- `RETENTION = 7 days` · `OVERLAP_GUARD = flock` · `LOCAL_FILE_PERMISSIONS = 0600`
- `SAME_HOST_ONLY = YES` · `OFF_HOST_COPY = NO` · `WAL_ARCHIVE = NO` · `PITR = NO`
- `BACKUP_FORMAT_ENCRYPTION = NOT_VERIFIED` — the artifact is a plain `pg_dump`
  custom-format archive with a `PGDMP` magic header. `chmod 600` is a
  filesystem permission, not encryption.
- `RPO_WORST_CASE ≈ 24 HOURS`. The first-customer target of ≤ 60 minutes is
  **NOT MET**, and no schedule change to this mechanism can meet it — only
  continuous WAL archiving closes that gap.

### 11.3 One blocker this unblocks — `BACKUP_SCRIPT_ENV_ALLOWLIST`

§2 records that `runBackup()` hands the script the entire API process
environment, including `ENCRYPTION_KEY`, `JWT_SECRET` and
`PLATFORM_JWT_SECRET`, and that F4-FCR-001 deliberately did **not** narrow the
default because nobody had read the script.

That reason no longer applies. The script takes its password from a file and
hardcodes the database name, user and host; it reads **no** application
environment variable. Narrowing is now a safe, evidence-backed operator change:

```bash
# server/.env on the production host
BACKUP_SCRIPT_ENV_ALLOWLIST=PATH,HOME,LANG,LC_ALL
```

`PATH`, `HOME`, `LANG` and `LC_ALL` are always included when the allowlist is
set, so this value means "pass nothing else". Restart the API process, then
confirm a manual backup still succeeds before leaving it in place.
**F4-FCR-002 did not change the default** — flipping it is a production
behaviour change and belongs to the operator.

## 12. What F4-FCR-002 added to the repository

| Artifact | Purpose |
|---|---|
| `ops/pgbackrest/pgbackrest.conf.example` | Annotated repository config. Local encrypted `repo1`; `repo2` present but commented out and explicitly unauthorized. |
| `ops/pgbackrest/postgresql-pitr.conf.example` | The additive PostgreSQL drop-in: `archive_mode`, `archive_command`, `archive_timeout`. |
| `ops/pgbackrest/noramedi-pgbackrest.cron.example` | Daily full 02:30, weekly `verify` Sunday 02:00. Restore drill commented out until a human has watched one run. |
| `ops/pgbackrest/pgbackrest-status.env.example` | Name-only tuning template for the status writer. Carries no secret, by design. |
| `ops/systemd/noramedi-pgbackrest-status.{service,timer}` | Runs the status writer every 15 min, isolated from the opscheck unit. |
| `scripts/noramedi-pgbackrest-preflight.sh` | Validates every precondition, reads the four host facts the repository cannot know, prints the intended change, writes the drop-in only with `--apply`. **Never restarts PostgreSQL.** |
| `scripts/noramedi-pgbackrest-backup.sh` | Backup / expire / verify wrapper with the disk-exhaustion abort the freeze exception requires. |
| `scripts/noramedi-pgbackrest-status.sh` | Publishes `/var/lib/noramedi/pitr-status.json`. |
| `scripts/noramedi-pgbackrest-restore-drill.sh` | PITR restore into a disposable RAM-backed **socket-only** cluster, plus structural, application and tenant-isolation smoke checks, migration-set comparison against the deployed release, mandatory RPO/RTO evidence, and a verified fail-closed teardown. See §14.1. |
| `scripts/noramedi-pitr-app-smoke.mjs` | Loads the **deployed** generated Prisma client and issues typed queries against the restored database over the drill socket. Must be installed next to the drill script. |
| `scripts/noramedi-pgbackrest.test.sh` | 141 assertions, including canary-token secret-leak tests and mutation tests that reintroduce each F4-FCR-002A defect to prove the guards can fail. |
| `scripts/noramedi-opscheck.sh` | New **opt-in** `pitr` check, exit bit **128**. |
| `server/src/services/pitrStatusFile.ts` | Fail-closed reader; extends `GET /api/platform/recovery/status`. |
| `src/pages/platform/PlatformBackups.tsx` | PITR panel with tri-state off-host rendering. |

### 12.1 Why the status writer is a separate process from the monitor

`noramedi-opscheck.sh` runs under `TimeoutStartSec=60` and monitors five
subsystems. Had it called `pgbackrest info` itself and that call hung — entirely
possible against a network-backed repository — systemd would kill the **whole**
opscheck run. pm2, disk, backup, filebackup and drill would all stop pinging,
and roughly twenty minutes later the operator would receive five simultaneous
DOWN emails, none describing a real problem.

So the slow, dependency-heavy work runs on its own timer and publishes a file;
opscheck only reads it. The monitor keeps its two load-bearing properties — it
carries no credentials, and it keeps working when the app is down — and if the
writer dies, the document goes stale and the `pitr` check fails closed on its
2-hour freshness gate. A slow backup repository cannot take out unrelated
monitoring.

### 12.2 Two defects fixed on the way

1. **`redactBackupLogLine()` did not redact the pgBackRest passphrase.** Every
   spelling — `repo1-cipher-pass=`, `cipher_pass=`, `--repo-cipher-pass=`,
   `"cipherPass":` — passed through **completely unchanged** and was served
   verbatim by `GET /api/platform/backups/logs`. None of the existing
   alternatives could match it: `pgpass`, `password`, `passwd` and `pwd` all
   require more than the bare substring `pass`, and the key-prefix pattern
   cannot cross a hyphen. This was the one secret shape not covered, and it is
   the secret whose loss makes every backup permanently unrecoverable.
   Verified empirically before and after; 9 regression cases added. PEM
   private-key blocks are now redacted too, since SSH becomes a realistic shape
   in this log once `repo2` exists.
2. **Shell scripts had no automated enforcement whatsoever.** Not
   `log-privacy-guard` (wrong root, wrong extension), not
   `adminScriptsLogPrivacy.test.ts` (three hardcoded `.ts` paths), not CI
   (`bash -n` scoped to `scripts/test-runtime/*.sh`), and no secret scanner
   exists anywhere in the repository. `npm run test:shell` now runs both suites
   and is wired into CI Layer 1, and the syntax check was widened to all of
   `scripts/*.sh`.

### 12.3 The off-host claim is deliberately hard to make

`offHost` is a **tri-state** — `no` / `unproven` / `yes` — never a boolean.

- The status writer **can never emit `yes` from its own observations.** A
  remote-looking hostname can still resolve to this machine, and an existing
  repository is not evidence that anything can be restored from it.
- `yes` requires a **passing restore drill sourced from repo2**, recorded as a
  proof marker by `noramedi-pgbackrest-restore-drill.sh --record --repo 2`.
- The proof **expires after 30 days** and decays back to `unproven`. A single
  successful restore in January must not justify a green tick in December.
- A drill from **repo1** never counts: the local repository is not an
  independent failure domain.
- Rejected as off-host, each with an explicit machine-readable reason: `repo2`
  as a local path, a `repo2-host` equal to this hostname, a loopback S3
  endpoint, and any plaintext repository however remote.

## 13. Production activation sequence — NOT EXECUTED

**Prerequisite: the §14 freeze exception must be granted first.** Every step
below is an operator action. Steps 0–10 are the stage-1 (local, encrypted)
scope; off-host is **separately blocked** — see §16.

```bash
# 0. Host facts this repository cannot know. Run these FIRST — the pgdg apt
#    component is derived from the release codename and must not be guessed.
lsb_release -a
nproc
sudo -u postgres psql -Atc "SHOW data_directory;"

# 1. Install pgBackRest from PGDG (the distro package may lag).
sudo apt-get install -y pgbackrest
pgbackrest version           # gates repo1-bundle (>= 2.41) and compress-type=zst

# 2. Repository directory and config.
sudo install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest
sudo install -d -o postgres -g postgres -m 0750 /etc/pgbackrest
sudo install -o postgres -g postgres -m 0600 /dev/null /etc/pgbackrest/pgbackrest.conf
sudo -u postgres $EDITOR /etc/pgbackrest/pgbackrest.conf   # paste .example, fill the 4 host values

# 3. ⚠ ESCROW THE PASSPHRASE OFF-HOST NOW, BEFORE stanza-create.
#    It cannot be rotated in place and it cannot be recovered. See §15.

# 4. Create the stanza BEFORE touching archive_mode. If archive_command points
#    at a stanza that does not exist, every push fails, pg_wal grows without
#    bound, and the cluster eventually stops on a full disk.
sudo -u postgres pgbackrest --stanza=noramedi stanza-create

# 5. Preflight. Read-only by default; prints the exact change it would make.
sudo install -m 0755 scripts/noramedi-pgbackrest-preflight.sh /usr/local/sbin/
sudo /usr/local/sbin/noramedi-pgbackrest-preflight.sh              # dry-run
sudo /usr/local/sbin/noramedi-pgbackrest-preflight.sh --apply      # writes the drop-in ONLY

# 6. THE RESTART. Deliberate, in an approved maintenance window.
sudo systemctl restart postgresql
sudo -u postgres psql -Atc "SHOW archive_mode;"        # expect: on
sudo -u postgres psql -Atc "SHOW archive_timeout;"     # expect: 5min

# 7. THE GATE. Do not proceed on failure.
sudo -u postgres pgbackrest --stanza=noramedi check
sudo -u postgres pgbackrest --stanza=noramedi --type=full backup
sudo -u postgres pgbackrest --stanza=noramedi info

# 8. Scheduling and monitoring.
sudo install -m 0755 scripts/noramedi-pgbackrest-backup.sh /usr/local/sbin/
sudo install -m 0755 scripts/noramedi-pgbackrest-status.sh /usr/local/sbin/
sudo install -m 0644 ops/pgbackrest/noramedi-pgbackrest.cron.example /etc/cron.d/noramedi-pgbackrest
sudo install -m 0644 ops/systemd/noramedi-pgbackrest-status.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/noramedi-pgbackrest-status.timer  /etc/systemd/system/
sudo /usr/local/sbin/noramedi-pgbackrest-status.sh --stdout --no-check   # smoke test, writes nothing
sudo systemctl daemon-reload && sudo systemctl enable --now noramedi-pgbackrest-status.timer

# 9. Enable the opt-in opscheck check LAST, once the status file exists.
#    One line in /etc/noramedi/opscheck.env; no unit edit, no redeploy needed.
#      NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup,filebackup,drill,pitr
#      NORAMEDI_OPSCHECK_PITR_PING_URL=<new Healthchecks check>
#      NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=false   # stage 1 only — read below
sudo /usr/local/sbin/noramedi-opscheck.sh --dry-run --check pitr

# 10. First restore drill, watched by a human.
#     Install the application-smoke helper NEXT TO the drill script first; the
#     drill refuses to run without it.
sudo install -m 0755 scripts/noramedi-pitr-app-smoke.mjs /usr/local/sbin/
#     NORAMEDI_APP_SERVER_DIR is mandatory: the application smoke and the
#     migration-set comparison both read the DEPLOYED release from it. Without
#     it the drill aborts, because a run that only proves a cluster starts is
#     not R-032 evidence. Point it at the server directory PM2 actually runs.
#     The drill OS user must be able to READ that directory — the drill checks
#     this before restoring rather than after.
sudo REHEARSAL_OS_USER=postgres \
     NORAMEDI_APP_SERVER_DIR=/path/to/deployed/server \
     /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh --port 55433
```

**`NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=false` is a knowing, temporary
acceptance for stage 1.** With `repo1` local, the off-host assertion fails by
design; `false` makes the check pass with a WARNING. **Set it back to `true`
the moment repo2 exists** — otherwise the one control that would tell you the
off-host copy has stopped working is disabled.

**Ordering note.** Create the `noramedi-pitr` check on the monitoring provider
at step 9, not earlier. Until WAL archiving is on, the local check fails by
design and a provider-side check created early just sits DOWN.

## 14. `F4-FCR-002_PITR_SCOPED_FREEZE_EXCEPTION` — GRANTED 2026-08-15

**Status: `AUTHORIZED_BY_PROGRAM_OWNER_2026-08-15`.** Recorded in
[`phases/F4_STORAGE_AND_BACKUP.md`](../phases/F4_STORAGE_AND_BACKUP.md) §F4-FCR-002,
which is the location [`NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md)
§2.3 requires; the declaration below is the text that was granted, not a
self-approval by an agent. This supersedes the narrower draft at §7.1,
extending it only by naming the monitoring and restore-verification artifacts
explicitly.

**The grant is permission, not activation.** At the time of writing pgBackRest
is still not installed, `archive_mode` is still `off`, no repository exists, no
credential has been generated, and `R-030`/`R-031`/`R-032` are all still `OPEN`.
Every "nothing has been activated" statement elsewhere in this runbook remains
accurate.

**The scope below has not been widened.** It authorizes pgBackRest installation
and configuration, `archive_mode`/`archive_command` activation, an encrypted
local recovery repository, continuous WAL archival, recovery verification, an
isolated non-production restore drill, operator monitoring, and a separately
approved off-host repository connection — and nothing else. It does not
authorize RLS changes, tenant extension, storage-key migration, imaging
relocation, physical-deletion redesign, unrelated Prisma/schema changes,
unrelated infrastructure redesign, replacing the existing `pg_dump` chain, or
broad KVKK architecture changes.

**Blocking precondition for the first drill (F4-FCR-002A, 2026-08-15).** The
first controlled restore drill must NOT be run with the F4-FCR-002 version of
`scripts/noramedi-pgbackrest-restore-drill.sh`. That version synthesised
`host all all 127.0.0.1/32 trust`, which exposed every tenant's patient rows to
any local account for the drill's duration; its teardown was
`rm -rf … 2>/dev/null || true` with no verification; and it had no `/dev/shm`
capacity preflight, no application smoke and no tenant-isolation smoke, so its
output could never have been honest R-032 evidence. The hardened version is
required first — see §14.1.

> **F4-FCR-002_PITR_SCOPED_FREEZE_EXCEPTION**
>
> The program owner authorizes, for task `F4-FCR-002` only, a scoped exception
> to [`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md)
> §2 row 18's prohibition on "any live backup/PITR implementation", limited
> strictly to the following on the production PostgreSQL host
> `disklinik-prod-01`:
>
> 1. installation and configuration of **pgBackRest**;
> 2. enabling `archive_mode=on` with an `archive_command` writing to a
>    **local, encrypted** pgBackRest repository on that same host, together
>    with an `archive_timeout` sized for the first-customer RPO target;
> 3. an encrypted repository (`repo1-cipher-type=aes-256-cbc`) with a bounded
>    retention policy and an explicit disk-exhaustion abort condition;
> 4. continuous WAL archival to that local repository;
> 5. first-customer recovery verification — scheduled backups, `pgbackrest
>    check`, `pgbackrest verify`, and restore drills executed into a
>    **disposable, non-production** cluster;
> 6. operator monitoring of the above through the existing
>    `noramedi-opscheck.sh` → Healthchecks.io path and the Platform Admin
>    recovery page;
> 7. connection of an **approved** off-host repository, if and when one is
>    separately authorized under §16.2's prerequisites.
>
> It does **NOT** authorize: RLS rollout; Prisma tenant-extension rollout;
> storage-key migration; attachment physical-deletion redesign; imaging storage
> relocation or lifecycle redesign; any unrelated schema migration or broad
> Prisma schema refactoring; queue/outbox implementation; message-delivery or
> recall refactors; provider selection, procurement, credential creation, or
> any movement of data off the production host under item 7 absent that
> separate authorization; or any modification to
> `/usr/local/sbin/noramedi-db-backup.sh`, its cron entry, or
> `/root/noramedi-backups`.
>
> It does not satisfy §5 condition 5 (external "KVKK baseline stable"
> declaration), is not generalizable, sets no precedent, does not authorize F4
> phase transition, and does not itself close `R-030`, `R-031` or `R-032` —
> each requires its own production evidence.
>
> Rollback is a single documented command pair: remove the PostgreSQL drop-in
> and restart (§17).

**Recorded.** Written to
[`phases/F4_STORAGE_AND_BACKUP.md`](../phases/F4_STORAGE_AND_BACKUP.md) in the
form F4-1A used:
`F4-FCR-002_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_2026-08-15`.
Declaring it satisfied in an evidence file only — the governance gap recorded
at `F4_STORAGE_AND_BACKUP.md:21` — is exactly what did not happen this time.

### 14.1 Restore-drill safety contract (F4-FCR-002A)

The drill script is the only artifact that can produce `R-032` evidence, so its
failure modes are program-level, not script-level. These properties are
enforced in code and asserted by `scripts/noramedi-pgbackrest.test.sh`; treat a
change that removes any of them as a change to the program's recovery claim.

| Property | Enforcement |
|---|---|
| No unauthenticated access to the restored PHI | Cluster starts with `listen_addresses=''`; `pg_hba.conf` contains a single `local … peer map=…` line and **no** `host` and **no** `trust` rule. Asserted after start via `pg_hba_file_rules` and `ss`. |
| No credential to leak | `peer` is authenticated by kernel UID over a mode-0700 socket directory. There is no password, no `PGPASSWORD`, no pgpass file. |
| Startup cannot be redirected | `data_directory`, `hba_file`, `ident_file`, `listen_addresses`, `unix_socket_directories`, `port`, `archive_mode=off` and `archive_command=''` are all pinned via `pg_ctl -o`, which outranks both `postgresql.conf` and `postgresql.auto.conf`. |
| Never production PGDATA | Determined from the live cluster, `pg_lsclusters`, or an explicit override — and the drill **refuses to run** if none of them answers. The guard never fails open. |
| Never persistent disk | The drill root's filesystem must be `tmpfs`; overriding that requires `NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS=1` and is loudly warned. |
| Capacity is checked before the restore | `/dev/shm` free space and `MemAvailable`, against base size read from `pgbackrest info` + a WAL-replay allowance + overhead. Free space on `/` is irrelevant — the target is RAM. |
| The port is free, then closed again | `ss` preflight before the restore, `ss` assertion during teardown. `ss` is a hard requirement, not a best-effort check. |
| Teardown is fail-closed | `trap … EXIT INT TERM HUP`; stop escalates fast → immediate → `SIGTERM` → `SIGKILL` with liveness verification; removal is verified; any unverified step exits **5**, prints operator instructions, and writes an incident marker. |
| A stale restore fails | The restored `_prisma_migrations` set is compared against the deployed release's `prisma/migrations` directory. Missing **or** extra migrations fail the drill. |
| The application is proven, not assumed | `noramedi-pitr-app-smoke.mjs` loads the **deployed** generated Prisma client and issues typed queries over the drill socket. It never starts the app, never writes, never prints a row. |
| Tenant scoping is proven | `Appointment.clinicId = Patient.clinicId` and no orphan clinic references. This domain does **not** use RLS; the policy count is recorded (expected 0) so a green line cannot be misread as RLS coverage. |
| RPO and RTO are mandatory | An unmeasurable RPO fails the drill. RTO is measured to **application/tenant smoke completion**, not to postmaster readiness. Both are compared to targets in the result document. |
| Evidence cannot be over-claimed | `r032Eligible` is true only when the application smoke, the tenant smoke, the migration comparison and both objectives all pass. `--record` refuses to write the off-host proof marker otherwise. |

`--allow-missing-app-smoke` exists for triage only: it disables the application
and tenant stages, forces `r032Eligible=false`, and blocks `--record`.

## 15. Key escrow — the highest-severity availability risk in this change

**pgBackRest cannot decrypt a repository without `repo1-cipher-pass`. There is
no escrow, no recovery, and no vendor. Losing it destroys every backup and
every archived WAL segment simultaneously.**

It is fixed at `stanza-create` and **cannot be rotated in place**; rotation
means a new full backup under a new passphrase, plus a window in which *both*
passphrases stay escrowed.

**Anti-pattern, stated plainly: storing the passphrase only on the host being
backed up.** If `disklinik-prod-01` is lost — the exact scenario an off-host
repository exists for — the passphrase is lost with it and repo2 becomes
permanently unreadable. An off-host encrypted copy whose only key lived on the
destroyed host is not a backup.

**Two independent secrets must be escrowed, in a location outside the failure
domain of both the production host and any repository host:**

| Secret | Where it lives | What its loss costs |
|---|---|---|
| `repo1-cipher-pass` (and `repo2-` if used) | `/etc/pgbackrest/pgbackrest.conf`, `0600 postgres` | Every pgBackRest backup and WAL segment becomes permanently unrecoverable. |
| `ENCRYPTION_KEY` | `server/.env`, root-owned | A restored cluster's integration-credential columns (`totpSecretEncrypted`, `metaAccessTokenEncrypted`, `clientSecretEncrypted`, `webhookSecretEncrypted`, …) become permanently undecryptable. Patient data restores fine; the integrations do not. |

Neither may be committed, placed in `ecosystem.config.cjs`, passed as a
command-line argument, or recorded in an evidence file, PR body, screenshot or
chat message. Record variable **names**, never values.

**What repository encryption does and does not protect against.** It defends
against media loss, stolen snapshots, and off-host provider staff. It does
**not** defend against compromise of this host: both PM2 processes already run
as `root`, and root can read the passphrase file. Any claim broader than that
is false.

## 16. Off-host — architecture decided, activation externally blocked

**Recommendation: pgBackRest `repo2` on the secondary Türkiye VPS over SSH,
with a Türkiye S3-compatible repository as the promote-on-clearance
alternative.**

This inverts the intuitively better answer, on procurement evidence rather than
elegance:

| | repo2 = TR VPS over SSH | repo2 = TR S3-compatible |
|---|---|---|
| pgBackRest-native | Yes | Yes |
| Operator burden | Higher (a second OS to run) | **Lowest** |
| Path to immutability / object-lock | No | **Yes** (provider-dependent) |
| **Procurement evidenced in this repository** | **Yes** — Türkiye IaaS is recorded as market-available, "a procurement and documentation step, not a feasibility question" | **No** — no Türkiye-resident S3-compatible provider is evidenced anywhere as a procurable product |
| Rides an already-decided legal workstream | **Yes** (workload A's DPA) | No — new vendor category, new DPA, new residency pack |

Recommending S3 as primary would make the pilot's recovery posture depend on a
vendor this program has no evidence exists. Promote it the moment a named
provider clears E1–E5 and counsel; the two options differ only in the value of
`repo2-type` and its sibling keys, which is precisely why the config interface
treats the switch as a config change rather than a redesign.

**Rejected: copying the repository with `rsync`/`rclone`.** It needs the same
unprocured host, is not a supported pgBackRest workflow, and risks a torn copy —
a repository whose manifest and data disagree, which passes existence checks and
fails at restore. That is the worst available failure mode for a backup.

### 16.1 R-030 splits in two, and only one half is closable here

Independence is decided by where the **primary** lives:

- **`R-030-DB`** — the PostgreSQL primary lives on `disklinik-prod-01`, so a
  repository on the secondary VPS **is** an independent failure domain for it.
  This half is genuinely closable, and `F3-C2-ERR-002` §11.5 pre-authorizes
  claiming it.
- **`R-030-FILES`** — if imaging primary storage later lives on that same VPS,
  a backup there is **not** independent for that data: same disk, hypervisor,
  provider account and facility. It **relocates** R-030, it does not close it,
  and imaging then needs a **third** copy elsewhere.

Reporting one global "off-host ✓" for a host that is simultaneously the backup
target and another data class's primary would be a false claim. This is why the
status document reports a per-repository tri-state and an independence tier
instead of a single boolean.

**Do not couple the DB repo2 to the shared-VPS sizing question.** The database
is ~16 MB; the shared-host sizing has nine unresolved inputs dominated by
imaging volume. Land the DB repository as a small, separately-volumed slice on
the workload-A host as soon as that host exists.

### 16.2 Prerequisites before any byte leaves the production host

All currently **unmet**:

1. Hosting DPA scoped to **special categories of personal data (health data)
   under KVKK Art. 6** — not to "a backup host". `COUNSEL_REVIEW_REQUIRED`
2. Türkiye residency evidence pack **E1–E5**, including **E5 (backup/snapshot
   storage region stated explicitly)** — snapshots are a separate storage
   location from the volume, and E5 is the item most likely to be skipped.
3. Subprocessor register §1 **and** §6 updated. `62-kvkk-subprocessor-register.md`
   currently states that the database backup destination "is **not** a
   third-party subprocessor relationship distinct from §1 (Hosting), since it
   is the same VPS" — **that sentence's reasoning is invalidated the moment a
   repo2 exists**, and it must be corrected *before*, not after.
4. Provider support-access restrictions answered **contractually**.
5. Encryption at rest recorded as three separate rows — provider-side,
   guest-side, and pgBackRest application-level — with which are actually in
   force.
6. Provider replication regions Türkiye-scoped or disabled.
7. The four roles kept distinct: pgBackRest the **software** is not a
   subprocessor (the same reasoning already accepted for GlitchTip); the
   hosting provider is a **new** infrastructure provider and `LIKELY YES` a
   data processor (`COUNSEL_REVIEW_REQUIRED`); cross-border transfer is engaged
   by destination country, not by vendor existence.

**Armed stop condition:** if E1–E5 cannot be obtained, **stop** — do not fall
back to an unevidenced provider without escalation and counsel.

### 16.3 New `COUNSEL_REVIEW_REQUIRED` items raised by PITR itself

These are in addition to the four already open at §7.3, none of which this task
resolves.

5. Whether a **continuous WAL archive**, which preserves the pre-image of every
   anonymized and erased row for the whole retention window, is lawful where
   the erasure was performed to satisfy a data-subject right — and what
   post-restore reconciliation is mandatory. Today the exposure window is
   bounded by 7-day dump retention; continuous archiving converts that into the
   ability to reconstruct the database at an arbitrary instant, including
   instants before an erasure was executed. **No reconciliation logic exists.**
6. Whether PITR's ability to reconstruct the database at an arbitrary instant
   is a distinct processing activity requiring its own basis and disclosure,
   separate from "backup".
7. Whether loss of the cipher passphrase — rendering all patient-data backups
   unrecoverable — is a reportable **availability** incident under the breach
   procedure, which currently addresses confidentiality.
8. Whether a cross-tenant restore into a non-production environment is a
   personal-data breach per se, and which clinics would be notifiable.

### 16.4 Legal hold and retention must not share a mechanism

`repo1-retention-full` and `repo1-retention-archive` are **age/count-based and
cannot be database-state-aware**. They must never be documented, named, or
configured as a legal-hold mechanism: extending a retention window to preserve
held records would retain *every* tenant's *every* record rather than the held
ones, and would still silently expire them later. The database-row `legalHold`
check remains authoritative.

Carried forward unresolved from §7.3, and **not** changed by this task: legal
hold has **no** backup awareness, backup delete-propagation is **not
implemented**, and `LabOrderAttachment` has no legal-hold field at all.

Three retention concepts stay distinct and must not be conflated:

| Concept | Value | Status |
|---|---|---|
| `pg_dump` fallback retention | 7 days | Enforced by the production script (§11.1) |
| pgBackRest operational recovery retention | proposed `repo1-retention-full=7`, `repo1-retention-archive=7` | **PROPOSED, NOT APPROVED** |
| Legal retention | — | **Undetermined.** KVKK-HIGH-003 is awaiting legal review; every retention cell in the DPA's Annex B is `TO BE VERIFIED`. |

## 17. Rollback

| Change | Rollback | Notes |
|---|---|---|
| `archive_mode=on` | `rm /etc/postgresql/16/main/conf.d/10-noramedi-pitr.conf && systemctl restart postgresql` | The single documented command pair. This is why the preflight refuses to append to `postgresql.conf` and insists on a drop-in: an append cannot be undone by deleting a file, and reconstructing prior state from memory during an incident is the failure this design exists to prevent. |
| `archive_command` / `archive_timeout` alone | Same file; `systemctl reload postgresql` suffices (SIGHUP-level). | |
| pgBackRest repository | `rm -rf /var/lib/pgbackrest` | Destroys backups only. **Production data is untouched.** |
| Backup cron | `rm /etc/cron.d/noramedi-pgbackrest` | |
| Status writer | `systemctl disable --now noramedi-pgbackrest-status.timer`, remove the units, `rm /var/lib/noramedi/pitr-status.json` | Stops PITR *reporting*; does **not** stop WAL archiving. |
| opscheck `pitr` check | Remove `pitr` from `NORAMEDI_OPSCHECK_CHECKS`; pause the provider-side check. | Bits 1/2/4/8/16/32/64 are unchanged, so the five pre-existing checks keep working either way. |
| Application code | Single revert of the F4-FCR-002 merge commit. | **No migration. No schema change.** Nothing to undo in the database. |

**After any rollback the 03:15 `pg_dump` chain is still running and still the
fallback.** It was never modified, disabled, or depended upon by any of the
above. That is the entire point of the coexistence design.

**Do not "roll back" by reverting to a pre-gate commit.** Reverting application
code does not turn off `archive_mode`, which is PostgreSQL configuration. The
two are independent and must be rolled back independently.

## 18. Required production read-only evidence — commands, NOT EXECUTED

Collect **before** the activation sequence. Every command is read-only; none
mutates configuration, data, or service state.

```bash
# ── Host ────────────────────────────────────────────────────────────────
lsb_release -a                      # release codename -> the pgdg apt component
uname -r
nproc                               # -> process-max
free -m
df -h /                             # a single 76 GB filesystem is the documented state
lsblk
findmnt -no SOURCE,TARGET,FSTYPE /var/lib /root /var/lib/postgresql

# ── PostgreSQL ──────────────────────────────────────────────────────────
# NOTE: the application connects as crm_user over TCP with a password FILE, but
# pgBackRest and the SHOW queries below need the CLUSTER OWNER over the local
# socket. `sudo -u postgres psql` relies on peer authentication; if it fails,
# capture the error rather than switching to a password — never put a password
# on a command line.
sudo -u postgres psql -Atc "SHOW server_version;"
sudo -u postgres psql -Atc "SHOW data_directory;"     # -> pg1-path; never assume
sudo -u postgres psql -Atc "SHOW config_file;"
sudo -u postgres psql -Atc "SHOW hba_file;"
sudo -u postgres psql -Atc "SHOW include_dir;"        # empty => no conf.d drop-in yet
sudo -u postgres psql -Atc "SHOW wal_level;"          # expect: replica
sudo -u postgres psql -Atc "SHOW archive_mode;"       # expect: off
sudo -u postgres psql -Atc "SHOW archive_command;"    # expect: empty / (disabled)
sudo -u postgres psql -Atc "SHOW archive_timeout;"
sudo -u postgres psql -Atc "SELECT * FROM pg_stat_archiver;"
sudo -u postgres psql -Atc "SELECT pg_size_pretty(pg_database_size('noramedi_crm'));"
sudo -u postgres psql -Atc "SELECT count(*) FROM pg_ls_waldir();"
systemctl status postgresql --no-pager

# ── pgBackRest (expected ABSENT today) ──────────────────────────────────
command -v pgbackrest && pgbackrest version || echo "pgbackrest NOT INSTALLED"
ls -la /etc/pgbackrest/ 2>/dev/null || echo "no /etc/pgbackrest"
ls -la /var/lib/pgbackrest/ 2>/dev/null || echo "no /var/lib/pgbackrest"

# ── Existing pg_dump tier (confirm untouched) ───────────────────────────
sudo ls -la /root/noramedi-backups | head -20
sudo du -sh /root/noramedi-backups
cat /etc/cron.d/noramedi-db-backup
sudo tail -n 30 /var/log/noramedi-db-backup.log     # REVIEW BY EYE before pasting anywhere
sudo systemctl status cron --no-pager

# ── Monitoring ──────────────────────────────────────────────────────────
systemctl status noramedi-opscheck.timer --no-pager
sudo /usr/local/sbin/noramedi-opscheck.sh --dry-run   # never pings
sudo ls -la /var/lib/noramedi/
```

⚠ **Before pasting any of this into an evidence file, PR, screenshot or chat:**
the backup log tail is the one output above that can contain a secret — it is
produced by a script whose logging this program does not control, and the
application-side redactor does **not** apply to a manual `tail`. Review it by
eye first.

⚠ **`pg_stat_archiver` on a cluster with `archive_mode=off`** returns a row of
zeros and nulls. That is the expected reading, not an error.

## 19. Verification state (F4-FCR-002)

| Item | State |
|---|---|
| Repository implementation | `COMPLETE` |
| Automated tests | See the PR body for exact commands and results. |
| pgBackRest installed in production | `NO` |
| `archive_mode` | `off` — unchanged |
| Repository created | `NO` |
| Freeze exception | `AUTHORIZED_BY_PROGRAM_OWNER_2026-08-15` — **GRANTED** (permission only; nothing below has changed as a result) |
| Off-host repository host | **NOT PROCURED** |
| Credentials created | `NO` |
| Data moved off-host | `NO` |
| Production deployment | `NOT_DEPLOYED` |
| Production verification | `NOT_PRODUCTION_VERIFIED` |
| Measured RPO | `UNVERIFIED` — the mechanism to measure it exists; no production drill has run. |
| Measured RTO | `UNVERIFIED` — same. |
| `R-030` off-host backup | `OPEN` |
| `R-031` PITR | `OPEN` |
| `R-032` restore-test evidence | `OPEN` |
| `FIRST_CUSTOMER_RECOVERY_GATE` | `NOT_SATISFIED` |

## 20. F4-FCR-002-R1 — adversarial review findings and resolutions

An adversarial pass over the implementation found defects the green test suite
did not catch. All CRITICAL and HIGH findings are resolved. They are recorded
here rather than silently fixed, because two of them would have made the whole
capability inert on the real host while every gate stayed green — which is
exactly the class of failure this task exists to prevent.

**The common cause: every "healthy" path in the original suite was
fixture-built.** Each side was tested against its own hand-written inputs, so
nothing exercised the code paths that only execute on a real cluster.

### CRITICAL

**C1 — the cron entry self-deadlocked; scheduled backups would never have run.**
The `flock -n /var/lock/… <script>` wrapper and the script's own internal lock
used the same path. `flock(2)` locks belong to the open file description, not
the process, so the child's independent `open()` conflicted with its own
parent. Every scheduled run would have exited 5 and never invoked pgBackRest.
The failure mode was the dangerous kind: cron mails *"another pgBackRest run
holds the lock — skipping this run"*, which reads as benign overlap, while the
repository accumulates nothing and — with `archive_mode=on` — WAL grows on a
single 76 GB disk with no backup ever expiring it. The disk-exhaustion abort
would never have been reached either, because the lock check precedes it.
*Resolved:* the outer `flock` is removed from both cron lines, with the reason
recorded in the file so it is not "fixed" back. The script owns its lock, which
is why exit 5 is a documented code, and the existing pg_dump entry has no outer
flock for the same reason.

**C2 — the `pg_stat_archiver` query was corrupted in transit, killing the WAL
freshness signal.** The delegation helper built a command *string* and then
re-parsed it through a second shell, so one layer of escaping faced two layers
of parsing and every embedded double quote was eaten. The format
`'YYYY-MM-DD"T"HH24:MI:SS"Z"'` arrived as `'YYYY-MM-DDTHH24:MI:SSZ'`, in which
`TH` is `to_char`'s **ordinal-suffix** directive — so the output was not
ISO-8601, the writer's own validator discarded it, `lastArchivedAgeMinutes` was
omitted from every document, and the monitor failed permanently with *"no WAL
segment has ever been archived"* on a perfectly healthy cluster. Fail-closed,
but permanently and falsely — which trains an operator to ignore the one check
that detects a broken WAL archive. Reproduced empirically before fixing.
*Resolved:* the delegation helper now takes an **argument vector**, so there is
no second parse; and the SQL is built by concatenation so it contains no double
quote at all and survives even the `su -c` fallback. The test fake now
**inspects the SQL it receives** instead of echoing a fixture, and a new
assertion requires a healthy run to actually *emit* `lastArchivedAgeMinutes`.
Mutation-tested: reintroducing the old form fails three assertions.

### HIGH

**H1 — the ordering guard trusted an exit code `pgbackrest info` does not set.**
`info` is informational and exits 0 for a stanza that does not exist, reporting
the absence in its JSON body. So `--apply` could have written an
`archive_command` pointing at a non-existent stanza — the exact sequence the
script's own header describes as ending in *"pg_wal grows without bound, and
the cluster shuts down on a full disk"*. *Resolved:* both the preflight and the
backup wrapper now check for the `archive/<stanza>` and `backup/<stanza>`
directories that `stanza-create` builds. That is directly observable and
version-independent, unlike pgBackRest's numeric status codes.

**H2 — the new PEM private-key redaction could never fire in production.**
`getBackupLogs()` split the log into lines *before* redacting, and a PEM block
spans at least three lines whose middle lines — the ones carrying the key
material — contain neither the BEGIN nor the END marker. Every one of them was
served verbatim over `GET /api/platform/backups/logs`. The test passed because
it called `redactBackupLogLine` directly on a `\n`-joined fixture, asserting a
property the production path did not have. *Resolved:* a new `redactBackupLog()`
applies whole-text rules **before** splitting and is what `getBackupLogs()`
calls; a bounded lone-base64-line rule catches blocks truncated by `tail -n`;
and the tests now go through the real entry point.

**H3 — the restore drill could not have started a cluster on this host.** On
Debian/Ubuntu, `postgresql.conf`, `pg_hba.conf` and `pg_ident.conf` live in
`/etc/postgresql/<ver>/<cluster>/`, while pgBackRest backs up `pg1-path` only —
so a restored PGDATA contains none of them and the postmaster fails with
*"could not open configuration file"*. The generic diagnostic would have blamed
recovery. *Resolved:* the drill now synthesises a minimal `pg_hba.conf` and
`pg_ident.conf`, passes `hba_file`/`ident_file` explicitly (so a restored
`postgresql.conf` cannot override them), and verifies all three files exist
before starting — failing with the real cause if not.

**This finding proves the drill had never been executed end to end.** It has
still not been, and cannot be until the freeze exception is granted. §19 records
Measured RPO and RTO as `UNVERIFIED` for that reason.

### MEDIUM (resolved)

- **A false green in Platform Admin.** A stalled archiver keeps `failedCount`
  at 0 and leaves `archive_mode`/`commandOk` healthy, so the page showed
  "PITR active ✓ / archive_command OK ✓ / Archive failures 0 / Last archived
  WAL: 3d" in neutral grey while opscheck was red on bit 128. The WAL age is
  now evaluated against the **same 120-minute threshold the monitor uses**,
  coloured, and raises its own alarm banner. Five UI tests pin it, including
  the never-archived case and the exact boundary.
- **`PrivateTmp=yes` defeated pgBackRest's own lock.** Its default `lock-path`
  is `/tmp/pgbackrest`, so a private `/tmp` made the unit's hourly `check`
  invisible to the cron backup's lock. `lock-path=/var/lib/pgbackrest/lock` is
  now set explicitly and added to `ReadWritePaths`.
- **`ProtectSystem=strict` made `/var/log/pgbackrest` read-only** while the
  config sets `log-level-file=detail`, which could have pinned `checkStatus` to
  `failed` permanently — a false RED. Added to `ReadWritePaths`.
- **`TimeoutStartSec=120` was smaller than the script's own worst case** (~7
  minutes of individually-bounded calls). Raised to 480s, still far under the
  15-minute timer interval.
- **The writer's self-check did not verify what its comment claimed.** It
  counted `schemaVersion` but never checked flatness — the property the
  consumer's parser actually depends on. Flatness is now asserted before
  publishing, and braces are stripped from `statusMessage` so an upstream error
  message cannot break the extraction.
- **`SHOW include_dir` is not a GUC** (`include_dir` is a postgresql.conf
  preprocessor directive), so that branch was dead code hidden by `|| true`.
  The file is now parsed directly, which is what the script claimed to be doing.
- **A documented `--print-config` flag did not exist.** The doc now describes
  the read-only default, which is what actually exists.
- **`--set` rejected every real differential/incremental label** — their suffix
  contains a hyphen the pattern disallowed. Latent until `--type diff` is
  adopted; fixed now.
- **The drill sampled `pg_is_in_recovery()` immediately after `pg_ctl -w`**,
  which returns while recovery is still replaying on PostgreSQL 16 — a spurious
  RED on a good restore. Now polls, bounded.

### LOW (resolved)

Off-host proof markers are now **bound to the repo2 target** they were earned
against and refuse a symlinked proof file, so repointing repo2 cannot inherit a
stale proof; a proof with no binding is refused. A missing `flock` binary is now
a precondition failure rather than being misreported as "lock busy". An
unreachable `exit 3` behind `exec` was made reachable. A conflicting
`ProtectHome` comment, a drop-in ownership mismatch between code and docs, and
one over-firm RPO claim in a config template were corrected.

### Accepted, not fixed

- **Exit codes 128–191 overlap the shell "killed by signal N−128" convention**
  (e.g. pitr+disk = 130, the SIGINT value). Disclosed in the opscheck header.
  systemd distinguishes `code=exited` from `code=killed`, and the deployed
  runner is a systemd oneshot. The alternative — moving the config-error code —
  would re-date every historical `64` for the second time in two tasks.
- **`walMin`/`walMax` are reported but continuity between them is not
  asserted.** A gap *inside* the range is not detected by any consumer. Closing
  this needs `pgbackrest verify` output parsing; recorded as future work rather
  than claimed.
- **The drill does not assert the age of the backup set it restored.** Backup
  freshness is asserted separately by the monitor.

### What this does not change

No finding altered the program state. `archive_mode` is still `off`, nothing is
installed, and `R-030`/`R-031`/`R-032` remain `OPEN`. (The freeze exception was
`DRAFT_PENDING_PROGRAM_OWNER` when this section was written and was granted on
2026-08-15 — see §14. That changed what is *permitted*, not what has been
*done*: every statement in this section still holds.) The honest status of this work is
**repository-complete and never executed against a real cluster** — H3 is
direct evidence of that, and it is why §13's activation sequence ends with a
human-watched first drill rather than a scheduled one.

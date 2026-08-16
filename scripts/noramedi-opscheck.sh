#!/usr/bin/env bash
# noramedi-opscheck.sh — F3-OBS-002
# Deploy to: /usr/local/sbin/noramedi-opscheck.sh
# chmod +x /usr/local/sbin/noramedi-opscheck.sh
# Intended runner: ops/systemd/noramedi-opscheck.{service,timer} (root, oneshot,
# independent of the noramedi-api/noramedi-worker processes it monitors — a
# dead-man's-switch monitor that runs inside the API process cannot report
# when the whole process/host is down).
#
# Five independent local checks, each pinging its own dead-man's-switch URL
# (Healthchecks.io-style: a plain GET on success, GET "$URL/fail" on a known
# local failure; no ping at all — the provider's own grace-period timeout is
# the signal — on a host/network outage that prevents this script from
# running or from reaching the network at all):
#
#   pm2         noramedi-api AND noramedi-worker both PM2 status == "online"
#   disk        filesystem usage at NORAMEDI_OPSCHECK_DISK_PATH under threshold
#   backup      newest file in the DB backup directory younger than max age
#   filebackup  the file-backup (patient attachment) sweep is enabled, ran
#               recently, and completed with zero failed/missing files
#   drill       a restore rehearsal ran recently and passed
#   pitr        (F4-FCR-002, OPT-IN — not in the default set) WAL archiving is
#               on, the archive_command is unaltered, no archiver failures, the
#               newest archived WAL and the newest pgBackRest backup are fresh,
#               the repository is encrypted and reports ok, `pgbackrest check`
#               passed recently, and the repository is in an independent
#               failure domain
#
# The last two read the application-written recovery status file (F4-FCR-001,
# default /var/lib/noramedi/recovery-status.json). Their subsystem state
# actually lives in PostgreSQL, but this script deliberately does NOT query
# the database: adding psql + DB credentials here would destroy the two
# properties that make this monitor trustworthy — it must keep working when
# the app is down, and it must not carry any application secret. The
# application writes a small status file; this script only consumes it.
# A missing, stale, or unparseable status file FAILS the check (fail closed)
# — "the worker that writes this died" must never read as healthy.
#
# Ping URLs are secret operational credentials (anyone with a ping URL can
# spoof a "healthy" signal to suppress a real alert). This script:
#   - never accepts a ping URL as a CLI argument (would appear in `ps`/history)
#   - never echoes a ping URL to stdout/stderr under any code path, including
#     curl failure — only the check's fixed label is ever printed
#   - reads ping URLs only from environment variables, which the deployed
#     systemd unit populates via `EnvironmentFile=` pointing at a root-owned,
#     0600, NOT-git-tracked file (see ops/systemd/noramedi-opscheck.env.example
#     for the variable names this script reads — values only ever exist on
#     the production host, never in this repository).
#
# Exit code, once startup configuration validation has passed, is a bitmask
# (0 = fully healthy):
#   bit 0 (1):  pm2 check failed (either process not "online")
#   bit 1 (2):  disk check failed (usage >= threshold, or df unreadable)
#   bit 2 (4):  backup check failed — DB dump staleness (missing dir, no
#               matching file, stale, or a future-dated newest backup —
#               clock skew fails closed, not silently "healthy")
#   bit 3 (8):  filebackup check failed (status file missing/stale/
#               unparseable, file backup disabled, sweep not "completed", or
#               any failed/missing file)
#   bit 4 (16): drill check failed (restore rehearsal missing, stale, or not
#               "passed")
#   bit 5 (32): a ping transport failed, OR a check ran without its ping URL
#               configured (local check result is still computed/reported;
#               only the *ping* is affected)
#   bit 7 (128): pitr check failed (F4-FCR-002 — see the ADDITION note below)
#
# This bitmask applies ONLY once the script has started running checks.
# Startup/CLI configuration errors (an invalid *_THRESHOLD_PERCENT or
# *_MAX_AGE_HOURS value, an unknown flag, an unrecognized --check name) exit
# 64 instead — a fixed value outside the 0-63 bitmask range, so a nonzero
# exit is never ambiguous between "a check failed" and "the script never
# ran any check because it was misconfigured".
#
# ⚠ EXIT-CODE CONTRACT REVISION (F4-FCR-001) — READ BEFORE INTERPRETING AN
# OLD JOURNAL ENTRY. Two codes MOVED when the filebackup and drill checks
# were added, because the original 4-bit layout had no free bit:
#
#   meaning                        | was | is now
#   -------------------------------+-----+-------
#   pm2 check failed               |   1 |   1   (unchanged)
#   disk check failed              |   2 |   2   (unchanged)
#   backup (DB dump) check failed  |   4 |   4   (unchanged)
#   ping transport / URL missing   |   8 |  32   (MOVED)
#   config/CLI error               |  16 |  64   (MOVED)
#
# The three pre-existing CHECK bits deliberately keep their values so every
# existing operator runbook and every historical journal line about pm2/
# disk/backup stays correct as written. Only the two non-check codes moved.
# The trap to avoid: an exit code of 16 in a journal entry from BEFORE this
# revision means "misconfigured, no check ran"; an exit code of 16 AFTER it
# means "the restore-rehearsal drill check failed" — two completely
# different situations. Likewise 8 was "ping transport failure" and is now
# "filebackup check failed". Date the journal entry against the deploy of
# F4-FCR-001 before acting on a 8 or a 16. Config errors remain strictly
# outside the bitmask range (now 0-63), so that distinction still holds.
#
# ✅ EXIT-CODE CONTRACT *ADDITION* (F4-FCR-002) — NOTHING MOVED THIS TIME.
# The pitr check was assigned bit 7 (128). Every pre-existing value keeps its
# meaning exactly, so unlike the F4-FCR-001 revision above, NO historical
# journal entry changes interpretation and no operator runbook needs re-dating.
#
#   meaning                        | before | after
#   -------------------------------+--------+-------
#   pm2 / disk / backup            | 1/2/4  | 1/2/4  (unchanged)
#   filebackup / drill             | 8/16   | 8/16   (unchanged)
#   ping transport / URL missing   |  32    |  32    (unchanged)
#   config/CLI error               |  64    |  64    (unchanged)
#   pitr check failed              |   —    | 128    (NEW)
#
# The alternative considered and rejected was giving pitr bit 6 (64) and moving
# the config-error code to 128. That keeps the check bits contiguous, but it
# would re-date every historical `64` for the second contract change in two
# tasks. Bit 128 costs only the loss of the "checks are contiguous and the
# config code sits above them" wording; the property that actually matters
# operationally is preserved, and provably so: the check bits can sum to at
# most 1+2+4+8+16+32 = 63, so 64 remains UNREACHABLE by any combination of
# check failures and therefore still means, unambiguously, "misconfigured, no
# check ran". Combined check failures now range over 0-63 and 128-191.
#
# Note for whoever reads a raw `$?` in a shell: values >= 128 are also the
# convention for "killed by signal N-128". systemd does not have this ambiguity
# (journalctl distinguishes `code=exited, status=191` from `code=killed`), and
# the deployed runner is a systemd oneshot — but if you are running this by
# hand and see 128-191, it is a pitr failure, not a signal.
#
# Restart-count / crash-loop signal: pm2_env.restart_time is read and its
# delta since the previous run is logged as an informational line — it does
# NOT affect the exit code. A legitimate `pm2 startOrReload` deploy also
# increments this counter, so treating any increase as a hard failure would
# false-positive on every routine deploy; a real threshold-based crash-loop
# detector needs a time-windowed count this script deliberately does not
# attempt to keep (out of scope — see the F3-OBS-002 evidence doc).
#
# Usage:
#   noramedi-opscheck.sh [--dry-run]
#                        [--check pm2|disk|backup|filebackup|drill|pitr]
#                        [-h|--help]
#
# Options:
#   --dry-run   Run all local checks; never invoke curl. Prints what would
#               have been pinged (label + outcome only, never a URL).
#   --check X   Run only the named check (repeatable). Default: the five
#               always-on checks (pm2, disk, backup, filebackup, drill).
#               `pitr` is opt-in and must be requested explicitly, either with
#               --check pitr or by setting NORAMEDI_OPSCHECK_CHECKS.
#
# Test-only overrides (do not set these in production — they exist solely so
# noramedi-opscheck.test.sh can inject fixtures without touching real paths):
#   NORAMEDI_OPSCHECK_BACKUP_DIR       default: /root/noramedi-backups
#   NORAMEDI_OPSCHECK_STATE_DIR        default: /var/lib/noramedi-opscheck
#
# Operational tuning (safe to set in production via the env file):
#   NORAMEDI_OPSCHECK_DISK_PATH                default: / — this IS a real
#     production knob, not test-only: it names the mount the disk check
#     measures. Default is "/" because PRODUCTION_TOPOLOGY.md documents a
#     single-disk host (app, uploads, DB, and /root/noramedi-backups all on
#     the same filesystem, no confirmed second mount) — verify this still
#     holds at install time and override if a separate data/backup volume
#     is ever introduced; checking the wrong mount would silently miss it
#     filling up independently.
#   NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT   default: 90 (integer 1-100;
#     invalid values are rejected at startup — fail closed, not ignored)
#   NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS     default: 30 (positive integer;
#     invalid values are rejected at startup — fail closed, not ignored)
#   NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE     default:
#     /var/lib/noramedi/recovery-status.json — the application-written status
#     file the filebackup and drill checks read. This is a real production
#     knob (it must match the app's NORAMEDI_RECOVERY_STATUS_FILE), not a
#     test-only override.
#   NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS  default: 30 (positive
#     integer). Max age of the status file's own `generatedAt` before the
#     filebackup check fails. This is the "did the writer itself die?"
#     guard: a status file that stopped being refreshed still contains its
#     last-known-good contents, and must NOT read as healthy.
#   NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS  default: 30 (positive
#     integer) — max age of fileBackup.lastRunAt. Sized like the DB-dump
#     equivalent: a daily sweep plus 6h of margin.
#   NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST  default: true — when true,
#     a file-backup destination that is not in an independent failure domain
#     (fileBackup.destinationOffHost=false) FAILS the check. A copy on the
#     same disk as the primary does not survive the disk loss it exists to
#     protect against, so reporting it healthy is the more dangerous default.
#     Set to exactly "false" to accept a same-host copy knowingly; the check
#     then emits a WARNING line and passes.
#   NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS      default: 192 (positive
#     integer) — max age of drill.lastRunAt. 192h = 8 days: one weekly
#     restore rehearsal plus a day of margin, so a single skipped or
#     slightly-late rehearsal does not alert.
#
#   ── PITR / WAL archive (F4-FCR-002, all opt-in with the pitr check) ──
#   NORAMEDI_OPSCHECK_CHECKS                   comma-separated check names,
#     overriding the default set. This is how the opt-in pitr check is
#     switched on at activation time, with no unit-file edit and no redeploy:
#       NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup,filebackup,drill,pitr
#   NORAMEDI_OPSCHECK_PITR_STATUS_FILE         default:
#     /var/lib/noramedi/pitr-status.json — written by
#     noramedi-pgbackrest-status.sh under its own systemd timer. A SEPARATE
#     document from the recovery status file, with its own writer, cadence and
#     schema version. This script never invokes pgbackrest itself.
#   NORAMEDI_OPSCHECK_PITR_STATUS_MAX_AGE_HOURS  default: 2 (positive integer)
#     — the "did the PITR writer itself die?" guard. Much tighter than the
#     recovery status file's 30h because its writer runs every 15 minutes and
#     because a stale PITR document hides exactly the fast-moving signal
#     (archived-WAL age) it exists to carry.
#   NORAMEDI_OPSCHECK_PITR_MAX_WAL_AGE_MINUTES   default: 120 (positive int)
#     — max age of the newest ARCHIVED WAL segment. This is the assertion that
#     catches a broken archive hiding behind a fresh backup. With
#     archive_timeout=300 a healthy cluster archives at least every ~5 min, so
#     120m alerts well before the <= 60 min RPO target is actually at risk.
#   NORAMEDI_OPSCHECK_PITR_MAX_BACKUP_AGE_HOURS  default: 30 (positive int)
#     — max age of the newest pgBackRest backup. Independent of WAL age: they
#     fail separately and are both asserted.
#   NORAMEDI_OPSCHECK_PITR_CHECK_MAX_AGE_HOURS   default: 30 (positive int)
#     — max age of the last `pgbackrest check` result, the only command that
#     validates the whole archive_command -> repository path end to end.
#   NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST       default: true
#     — whether a repository that is not in an independent failure domain
#     fails the check. Fail-closed by default: a stage-1 LOCAL pgBackRest repo
#     improves RPO and provides NO host-loss protection, and reporting it
#     green would merge two separate capabilities into one light. Set to
#     exactly "false" to accept that knowingly during the stage-1 pilot; the
#     check then emits a WARNING and passes.
#
#   ── WAL BACKLOG (F4-FCR-003-R1, additive; needed BEFORE repo2) ──────
#   Gate 0 established that an unreachable repo2 does not degrade gracefully:
#   `archive-push` fails as a whole, so the LOCAL archive chain stops too and
#   PostgreSQL retains every segment. The failure therefore arrives as DISK
#   growth, and nothing here measured disk growth attributable to WAL:
#   `lastArchivedAgeMinutes` measures time, not volume, and the `disk` check
#   measures `/` as a percentage — by the time it trips, the operator is told
#   "disk", not "your archive stopped", and the backlog has usually been
#   dangerous for a while. These two limits close that gap.
#
#   BOTH DEFAULT TO 0, MEANING NOT EVALUATED. That is deliberate and is the
#   backward-compatibility contract: production today runs a single repo1 and
#   a status writer that may predate these fields, and inventing an absolute
#   byte or segment limit for a host whose WAL rate has never been measured
#   would manufacture false alerts. Where a limit IS configured, a MISSING
#   measurement is a FAILURE, never a pass — enabling a check and then being
#   unable to take its measurement is exactly the state that must not read
#   green.
#
#   NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT   default: 0 (0 = off)
#     — max `.ready` markers in pg_wal/archive_status, i.e. how many segments
#     are waiting to be archived. This is the DIRECT backlog signal: it rises
#     the moment archive-push stops succeeding and falls as the backlog
#     drains. Suggested starting value 32 (≈512 MiB at the 16 MiB default
#     segment size); see runbook §22.4a for the derivation and confirm it
#     against the host's measured WAL rate before activation.
#   NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES         default: 0 (0 = off)
#     — max total bytes in pg_wal. Deliberately has NO non-zero default: the
#     safe value is a function of free space on the PGDATA filesystem, which
#     is a per-host fact this repository cannot know. §22.4a requires the
#     operator to set it from a measured `df` before repo2 activation.
#   NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG   default: false
#     — the activation gate. Set to exactly "true" when repo2 goes live. It
#     makes both limits mandatory (a startup configuration error otherwise)
#     and makes both measurements mandatory in the document. The invariant it
#     enforces is that repo2 activation cannot proceed with no way to observe
#     WAL backlog accumulation.
#
#   NORAMEDI_OPSCHECK_SUPPRESS_PING            comma-separated check names
#                                               (pm2,disk,backup,filebackup,
#                                               drill,pitr) to skip pinging for —
#                                               local check still runs and is
#                                               still reported. Used only for
#                                               the controlled DRILL B
#                                               (see F3-OBS-002 evidence doc);
#                                               unset in normal operation.
#
# All *_MAX_AGE_HOURS and *_THRESHOLD_PERCENT values are validated at startup
# with the same fail-closed discipline: a malformed value exits with the
# config-error code rather than being ignored (an invalid value silently
# falling through to a false "healthy" is the failure mode being prevented).
#
# Secret ping-URL variables (see ops/systemd/noramedi-opscheck.env.example):
#   NORAMEDI_OPSCHECK_PM2_PING_URL
#   NORAMEDI_OPSCHECK_DISK_PING_URL
#   NORAMEDI_OPSCHECK_BACKUP_PING_URL
#   NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL
#   NORAMEDI_OPSCHECK_DRILL_PING_URL
#   NORAMEDI_OPSCHECK_PITR_PING_URL            (F4-FCR-002; only needed once
#                                               the opt-in pitr check is on)
#
# Recovery status file contract (schemaVersion 1) — written by the app, read
# here. Every field except schemaVersion is optional in the JSON sense; a
# field this script needs but does not find is a check FAILURE, never a pass:
#
#   {
#     "schemaVersion": 1,
#     "generatedAt": "2026-08-14T03:05:00Z",
#     "fileBackup": { "lastRunAt": "...", "status": "completed",
#                     "filesFailed": 0, "filesMissing": 0, "enabled": true },
#     "drill":      { "lastRunAt": "...", "kind": "file_restore_rehearsal",
#                     "status": "passed" }
#   }
#
# The file is parsed WITHOUT jq (not a dependency anywhere in this repo, and
# this monitor must not grow install-time requirements) using a scoped
# grep/sed extraction over that known flat shape. Any extraction that does
# not match — truncated file, nested/unexpected structure, wrong types — is
# treated as a check FAILURE. The file's raw contents are never echoed; only
# fixed labels, computed ages, and short validated tokens are printed. The
# file is assumed to contain neither secrets nor PHI, and this script still
# treats it as untrusted input.
#
# PITR status file contract (schemaVersion 1, F4-FCR-002) — a SEPARATE
# document with its own writer (noramedi-pgbackrest-status.sh, root, own
# systemd timer), its own path, and its own schema version. Same parsing
# rules, same fail-closed handling:
#
#   {
#     "schemaVersion": 1,
#     "generatedAt": "2026-08-15T10:00:00Z",
#     "archive": { "mode": "on", "commandOk": true, "walLevel": "replica",
#                  "timeoutSeconds": 300, "failedCount": 0,
#                  "archivedCount": 128, "lastArchivedAt": "...",
#                  "lastArchivedAgeMinutes": 3 },
#     "repo":    { "installed": true, "stanza": "noramedi", "statusOk": true,
#                  "cipherType": "aes-256-cbc", "checkStatus": "ok",
#                  "checkAt": "...", "checkAgeMinutes": 12,
#                  "lastBackupAt": "...", "lastBackupAgeMinutes": 480,
#                  "lastBackupType": "full", "backupCount": 7,
#                  "walMin": "...", "walMax": "...",
#                  "offHost": "no", "tier": "T1",
#                  "offHostReason": "NO_REPO2_CONFIGURED" }
#   }
#
# WHY A SEPARATE FILE RATHER THAN A THIRD OBJECT IN THE RECOVERY STATUS FILE:
# different writer (a root shell script vs. the Node application), different
# cadence (15 min vs. 10 min), and different staleness tolerance (2h vs. 30h).
# Folding PITR into the app-written document would also mean the app had to
# learn about pgBackRest, and would layer one document's staleness on top of
# another's. Critically, it would NOT have allowed a schemaVersion bump: the
# opscheck already installed in production hard-fails any recovery-status
# document whose schemaVersion is not 1, so changing that number would make
# the live monitor fail every check the moment the app deployed.
#
# `offHost` is a TRI-STATE string — "no" | "unproven" | "yes" — not a boolean.
# "unproven" means a remote repository is configured but no restore has ever
# been performed from it. Configuration is not proof: a remote-looking
# hostname can still resolve to this machine, and an existing repository is
# no evidence that anything is recoverable from it. Only "yes" passes, and
# only a successful restore drill sourced from that repository produces it.

set -euo pipefail

# Force a fixed locale so df/stat/awk number formatting (thousands
# separators, decimal points) can never vary by host locale — the integer
# parsing below assumes plain ASCII digits.
export LC_ALL=C

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# Configuration/CLI errors (invalid threshold values, unknown flags, an
# unrecognized --check name) exit with this fixed code, deliberately OUTSIDE
# the 0-63 range the check bitmask occupies (bits 0-5, see header comment).
# These failures happen before any check runs, so they are not expressible
# as "which checks failed" — reusing exit 1 for them would collide with the
# pm2-check-failed bit and make a bare nonzero exit ambiguous between "pm2
# is down" and "the script was misconfigured and never ran any check".
#
# This was 16 before F4-FCR-001 added the filebackup (8) and drill (16)
# bits; see the EXIT-CODE CONTRACT REVISION table in the header before
# interpreting an exit code from an old journal entry.
CONFIG_ERROR_EXIT_CODE=64

# Bit set when a ping could not be delivered (transport error, or no ping URL
# configured for a check that ran). Was 8 before F4-FCR-001; moved to 32 so
# the three pre-existing CHECK bits could keep their historical values.
PING_FAILURE_BIT=32

# ── config ───────────────────────────────────────────────────────────────
DISK_PATH="${NORAMEDI_OPSCHECK_DISK_PATH:-/}"
BACKUP_DIR="${NORAMEDI_OPSCHECK_BACKUP_DIR:-/root/noramedi-backups}"
STATE_DIR="${NORAMEDI_OPSCHECK_STATE_DIR:-/var/lib/noramedi-opscheck}"
DISK_THRESHOLD="${NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT:-90}"
BACKUP_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS:-30}"
RECOVERY_STATUS_FILE="${NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE:-/var/lib/noramedi/recovery-status.json}"
RECOVERY_STATUS_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS:-30}"
FILEBACKUP_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS:-30}"
# Whether a file-backup destination that is NOT in an independent failure
# domain fails the check. Defaults to true (fail closed): a same-host copy is
# not a backup. Set to exactly "false" to accept a same-host copy knowingly.
FILEBACKUP_REQUIRE_OFFHOST="${NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST:-true}"
DRILL_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS:-192}"
# ── PITR / WAL archive (F4-FCR-002) ──────────────────────────────────────
# A SEPARATE document from the recovery status file, written by
# noramedi-pgbackrest-status.sh under its own systemd timer. This script must
# not talk to pgBackRest itself: `pgbackrest info` against a network-backed
# repository can outlast the unit's TimeoutStartSec=60, and systemd would then
# kill the WHOLE run — so pm2, disk, backup, filebackup and drill would all
# stop pinging and the operator would get five simultaneous FALSE alerts. One
# slow backup repository must never be able to take out unrelated monitoring.
PITR_STATUS_FILE="${NORAMEDI_OPSCHECK_PITR_STATUS_FILE:-/var/lib/noramedi/pitr-status.json}"
PITR_STATUS_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_PITR_STATUS_MAX_AGE_HOURS:-2}"
# Worst-case data loss is bounded by archive_timeout (recommended 300s) plus
# push latency. 2h therefore alerts long before the <= 60 min RPO target is at
# risk, while tolerating a couple of missed 15-minute writer ticks.
PITR_MAX_WAL_AGE_MINUTES="${NORAMEDI_OPSCHECK_PITR_MAX_WAL_AGE_MINUTES:-120}"
PITR_MAX_BACKUP_AGE_HOURS="${NORAMEDI_OPSCHECK_PITR_MAX_BACKUP_AGE_HOURS:-30}"
PITR_CHECK_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_PITR_CHECK_MAX_AGE_HOURS:-30}"
# Whether a repository that is not in an independent failure domain fails the
# check. Defaults to true (fail closed), matching FILEBACKUP_REQUIRE_OFFHOST.
# A local-only pgBackRest repository is a real RPO improvement and NO host-loss
# protection at all; reporting it healthy would merge two separate capabilities
# into one green light. Set to exactly "false" to accept that knowingly during
# the stage-1 pilot, which emits a WARNING and passes.
PITR_REQUIRE_OFFHOST="${NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST:-true}"
# WAL backlog limits (F4-FCR-003-R1). 0 means NOT EVALUATED, and that is the
# default for both: see the header block. A non-zero value turns the
# corresponding assertion on, and from that point a missing measurement is a
# failure rather than a pass.
PITR_MAX_WAL_READY_COUNT="${NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT:-0}"
PITR_MAX_WAL_BYTES="${NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES:-0}"
PITR_REQUIRE_WAL_BACKLOG="${NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG:-false}"
SUPPRESS_PING="${NORAMEDI_OPSCHECK_SUPPRESS_PING:-}"
CURL_MAX_TIME=5
CURL_CONNECT_TIMEOUT=3
PM2_TIMEOUT_SECONDS=10

# Fail closed on malformed tuning values instead of letting an invalid
# comparison silently fall through to "healthy" (bash's `[[ N -ge X ]]`
# with a non-numeric X returns false without tripping `set -e` when it is
# the direct condition of an `if`, which would otherwise make the disk/
# backup check report OK regardless of actual usage/age).
if ! [[ "$DISK_THRESHOLD" =~ ^[0-9]+$ ]] || [[ "$DISK_THRESHOLD" -lt 1 ]] || [[ "$DISK_THRESHOLD" -gt 100 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT='$DISK_THRESHOLD' is not an integer in 1-100" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$BACKUP_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$BACKUP_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS='$BACKUP_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$RECOVERY_STATUS_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$RECOVERY_STATUS_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS='$RECOVERY_STATUS_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$FILEBACKUP_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$FILEBACKUP_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS='$FILEBACKUP_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$DRILL_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$DRILL_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS='$DRILL_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$PITR_STATUS_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$PITR_STATUS_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_STATUS_MAX_AGE_HOURS='$PITR_STATUS_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$PITR_MAX_WAL_AGE_MINUTES" =~ ^[0-9]+$ ]] || [[ "$PITR_MAX_WAL_AGE_MINUTES" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_MAX_WAL_AGE_MINUTES='$PITR_MAX_WAL_AGE_MINUTES' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$PITR_MAX_BACKUP_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$PITR_MAX_BACKUP_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_MAX_BACKUP_AGE_HOURS='$PITR_MAX_BACKUP_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$PITR_CHECK_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$PITR_CHECK_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_CHECK_MAX_AGE_HOURS='$PITR_CHECK_MAX_AGE_HOURS' is not a positive integer" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
# Validated as a strict enum rather than tested with `== "true"` at the point
# of use. The older FILEBACKUP_REQUIRE_OFFHOST knob treats ANY value that is
# not exactly "true" as an opt-out, so a typo — `FALSE`, `0`, `no`, a stray
# space — silently disables a durability guard and the check goes green. That
# is fail-OPEN on a misconfiguration, which is the one direction this script
# refuses to fail everywhere else. Rejecting anything outside {true,false}
# here keeps the deliberate opt-out available while making a typo loud.
if [[ "$PITR_REQUIRE_OFFHOST" != "true" ]] && [[ "$PITR_REQUIRE_OFFHOST" != "false" ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST='$PITR_REQUIRE_OFFHOST' is not exactly 'true' or 'false'" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
# 0 IS allowed for these two — unlike every threshold above — because 0 is how
# "not evaluated" is expressed. A negative or non-numeric value is still fatal.
if ! [[ "$PITR_MAX_WAL_READY_COUNT" =~ ^[0-9]+$ ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT='$PITR_MAX_WAL_READY_COUNT' is not a non-negative integer (0 disables the check)" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if ! [[ "$PITR_MAX_WAL_BYTES" =~ ^[0-9]+$ ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES='$PITR_MAX_WAL_BYTES' is not a non-negative integer (0 disables the check)" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
if [[ "$PITR_REQUIRE_WAL_BACKLOG" != "true" ]] && [[ "$PITR_REQUIRE_WAL_BACKLOG" != "false" ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG='$PITR_REQUIRE_WAL_BACKLOG' is not exactly 'true' or 'false'" >&2
  exit "$CONFIG_ERROR_EXIT_CODE"
fi
# The activation gate, enforced at STARTUP rather than at check time. Gate 0
# showed that an unreachable repo2 stops the whole archive chain and turns the
# outage into WAL disk growth, so switching repo2 on while the two backlog
# limits are still 0 would activate the risk together with a monitor that
# cannot see it. Refusing to start is louder than a failing check and cannot be
# mistaken for a transient alert.
if [[ "$PITR_REQUIRE_WAL_BACKLOG" == "true" ]]; then
  if [[ "$PITR_MAX_WAL_READY_COUNT" -eq 0 ]] || [[ "$PITR_MAX_WAL_BYTES" -eq 0 ]]; then
    echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG=true but NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT='$PITR_MAX_WAL_READY_COUNT' and/or NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES='$PITR_MAX_WAL_BYTES' is 0 (not evaluated). An unreachable repo2 suspends the ENTIRE archive chain and the failure arrives as pg_wal growth; set both from this host's measured capacity before activating repo2 (runbook 22.4a)." >&2
    exit "$CONFIG_ERROR_EXIT_CODE"
  fi
fi
PITR_STATUS_SCHEMA_VERSION=1
# Mirrors server/src/services/backupService.ts BACKUP_FILENAME_RE exactly —
# intentionally NOT importing/duplicating business logic, just the one
# filename shape needed to identify a real backup file on disk.
BACKUP_FILENAME_RE='^noramedi_crm-[0-9]{8}-[0-9]{6}\.dump$'
PM2_APPS=(noramedi-api noramedi-worker)

# The only recovery-status-file schema version this script understands. A
# file declaring any other version FAILS the checks that read it, rather
# than being interpreted on a guess about what its fields now mean.
RECOVERY_STATUS_SCHEMA_VERSION=1

# Accepted timestamp shape inside the recovery status file: ISO-8601 with an
# explicit UTC 'Z' or a numeric offset. Anything else is a check failure and
# is never handed to `date -d`, which would otherwise happily interpret
# loose input like "now" or "yesterday" as a valid — and always fresh — time.
ISO8601_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$'

DRY_RUN=false
CHECKS_TO_RUN=()

# ── argument parsing ────────────────────────────────────────────────────
usage() {
  grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --check)
      CHECKS_TO_RUN+=("$2")
      shift 2
      ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$CONFIG_ERROR_EXIT_CODE" ;;
  esac
done

if [[ ${#CHECKS_TO_RUN[@]} -eq 0 ]]; then
  # `pitr` is deliberately NOT in this default set.
  #
  # F4-FCR-001 added filebackup and drill to the default and documented an
  # install ordering so they would not alert on a missing status file. That was
  # right for those two: the subsystems existed and only needed provisioning.
  # PITR is different. WAL archiving cannot be switched on without a granted
  # freeze exception AND a production PostgreSQL restart, so a defaulted-on
  # pitr check would fail on EVERY five-minute run, indefinitely, for as long
  # as that decision takes. A check that is guaranteed red for weeks does not
  # protect anything — it teaches the operator that red is the normal colour,
  # which is precisely how a real alert gets ignored later.
  #
  # It is therefore opt-in, enabled in one line of /etc/noramedi/opscheck.env
  # at the moment PITR is actually activated:
  #     NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup,filebackup,drill,pitr
  # No unit file edit and no redeploy is needed — systemd re-reads
  # EnvironmentFile= on every ExecStart.
  if [[ -n "${NORAMEDI_OPSCHECK_CHECKS:-}" ]]; then
    IFS=',' read -r -a CHECKS_TO_RUN <<<"$NORAMEDI_OPSCHECK_CHECKS"
    # Trim whitespace; reject empties rather than silently skipping them, so a
    # trailing comma cannot quietly shrink the monitored set.
    _cleaned=()
    for _c in "${CHECKS_TO_RUN[@]}"; do
      _c="${_c#"${_c%%[![:space:]]*}"}"; _c="${_c%"${_c##*[![:space:]]}"}"
      if [[ -z "$_c" ]]; then
        echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_CHECKS contains an empty entry" >&2
        exit "$CONFIG_ERROR_EXIT_CODE"
      fi
      _cleaned+=("$_c")
    done
    CHECKS_TO_RUN=("${_cleaned[@]}")
  else
    CHECKS_TO_RUN=(pm2 disk backup filebackup drill)
  fi
fi

# Ping suppression, by check name: pm2, disk, backup, filebackup, drill.
# The name matched here is the check's LABEL (identical to its --check name),
# so NORAMEDI_OPSCHECK_SUPPRESS_PING=filebackup,drill suppresses exactly
# those two pings while their local checks still run and still report — the
# controlled-drill mechanism from F3-OBS-002, unchanged. Suppression affects
# only the ping; it never changes a check's local result or its exit bit.
is_suppressed() {
  local name="$1"
  [[ ",${SUPPRESS_PING}," == *",${name},"* ]]
}

# ping OUTCOME LABEL URL_VAR_NAME — OUTCOME is "success" or "fail". Never
# prints the URL itself, on any path (success, failure, or missing-config).
ping_result() {
  local outcome="$1" label="$2" url_var="$3"
  local url="${!url_var:-}"

  if is_suppressed "$label"; then
    echo "[opscheck] $(timestamp) ping suppressed for '$label' (NORAMEDI_OPSCHECK_SUPPRESS_PING) — local result only"
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[opscheck] $(timestamp) DRY-RUN: would ping '$label' outcome=$outcome"
    return 0
  fi

  if [[ -z "$url" ]]; then
    echo "[opscheck] $(timestamp) WARNING: no ping URL configured for '$label' ($url_var unset) — skipping ping" >&2
    return 1
  fi

  local target="$url"
  [[ "$outcome" == "fail" ]] && target="${url%/}/fail"

  if curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" -o /dev/null "$target" 2>/dev/null; then
    echo "[opscheck] $(timestamp) ping ok for '$label' (outcome=$outcome)"
    return 0
  else
    echo "[opscheck] $(timestamp) ping FAILED (transport error) for '$label'" >&2
    return 1
  fi
}

# ── check: pm2 ───────────────────────────────────────────────────────────
check_pm2() {
  local jlist
  # `timeout` bounds this independently of systemd's TimeoutStartSec=60 —
  # that unit-level bound only applies when run via the timer; this keeps
  # the same guarantee for a manual/interactive invocation (e.g. a drill).
  if ! jlist="$(timeout "$PM2_TIMEOUT_SECONDS" pm2 jlist 2>/dev/null)"; then
    echo "[opscheck] $(timestamp) pm2 check: FAIL — 'pm2 jlist' did not run within ${PM2_TIMEOUT_SECONDS}s (pm2 unavailable or hung?)" >&2
    return 1
  fi

  local report
  if ! report="$(node -e '
    let raw = "";
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      let apps;
      try { apps = JSON.parse(raw); } catch { process.stdout.write("PARSE_ERROR\n"); return; }
      const names = process.argv.slice(1);
      for (const name of names) {
        const app = apps.find(a => a.name === name);
        const status = app && app.pm2_env ? String(app.pm2_env.status) : "missing";
        const restarts = app && app.pm2_env && typeof app.pm2_env.restart_time === "number" ? app.pm2_env.restart_time : -1;
        process.stdout.write(`${name} ${status} ${restarts}\n`);
      }
    });
  ' "${PM2_APPS[@]}" <<<"$jlist")"; then
    echo "[opscheck] $(timestamp) pm2 check: FAIL — status extraction errored" >&2
    return 1
  fi

  if [[ "$report" == "PARSE_ERROR" ]]; then
    echo "[opscheck] $(timestamp) pm2 check: FAIL — could not parse 'pm2 jlist' output as JSON" >&2
    return 1
  fi

  mkdir -p "$STATE_DIR" 2>/dev/null || true
  local state_file="$STATE_DIR/pm2-restarts.state"
  local ok=true
  local line name status restarts prev

  while read -r line; do
    [[ -z "$line" ]] && continue
    read -r name status restarts <<<"$line"
    if [[ "$status" != "online" ]]; then
      echo "[opscheck] $(timestamp) pm2 check: '$name' status='$status' (expected online)" >&2
      ok=false
    else
      echo "[opscheck] $(timestamp) pm2 check: '$name' online"
    fi
    if [[ "$restarts" != "-1" ]] && [[ -f "$state_file" ]]; then
      prev="$(grep -m1 "^${name}=" "$state_file" 2>/dev/null | cut -d= -f2 || true)"
      if [[ -n "$prev" ]] && [[ "$restarts" -gt "$prev" ]]; then
        echo "[opscheck] $(timestamp) INFO: '$name' restart_time increased $prev -> $restarts since last check (informational only; a routine deploy also increments this)"
      fi
    fi
  done <<<"$report"

  # Persist current restart counts for next run's delta (best-effort; state
  # loss just means one skipped delta comparison, not a false failure).
  {
    while read -r name status restarts; do
      [[ -z "${name:-}" ]] && continue
      echo "${name}=${restarts}"
    done <<<"$report"
  } > "${state_file}.tmp" 2>/dev/null && mv -f "${state_file}.tmp" "$state_file" 2>/dev/null || true

  [[ "$ok" == "true" ]]
}

# ── check: disk ──────────────────────────────────────────────────────────
check_disk() {
  local line usage
  if ! line="$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2')"; then
    echo "[opscheck] $(timestamp) disk check: FAIL — 'df -P $DISK_PATH' did not run" >&2
    return 1
  fi
  if [[ -z "$line" ]]; then
    echo "[opscheck] $(timestamp) disk check: FAIL — no df output for '$DISK_PATH'" >&2
    return 1
  fi
  usage="$(awk '{ gsub("%","",$5); print $5 }' <<<"$line")"
  if ! [[ "$usage" =~ ^[0-9]+$ ]]; then
    echo "[opscheck] $(timestamp) disk check: FAIL — could not parse usage from df output" >&2
    return 1
  fi
  if [[ "$usage" -ge "$DISK_THRESHOLD" ]]; then
    echo "[opscheck] $(timestamp) disk check: FAIL — ${usage}% used at '$DISK_PATH' (threshold ${DISK_THRESHOLD}%)" >&2
    return 1
  fi
  echo "[opscheck] $(timestamp) disk check: OK — ${usage}% used at '$DISK_PATH' (threshold ${DISK_THRESHOLD}%)"
  return 0
}

# ── check: backup freshness ─────────────────────────────────────────────
check_backup() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "[opscheck] $(timestamp) backup check: FAIL — backup directory '$BACKUP_DIR' does not exist/is not accessible" >&2
    return 1
  fi

  local newest_epoch=0 newest_name="" f base epoch
  for f in "$BACKUP_DIR"/*; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" =~ $BACKUP_FILENAME_RE ]] || continue
    epoch="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    if [[ "$epoch" -gt "$newest_epoch" ]]; then
      newest_epoch="$epoch"
      newest_name="$base"
    fi
  done

  if [[ -z "$newest_name" ]]; then
    echo "[opscheck] $(timestamp) backup check: FAIL — no file matching the expected backup filename pattern in '$BACKUP_DIR'" >&2
    return 1
  fi

  local now
  now="$(date +%s)"

  # A future mtime (clock skew, a bad `touch`, a restored/replayed file) must
  # never be treated as "fresh" — the naive `(now - newest_epoch) / 3600`
  # computation goes negative in that case, which compares as "not > max"
  # and would fail OPEN (report healthy) instead of failing closed. Reject
  # it outright rather than picking a clock-skew tolerance.
  if [[ "$newest_epoch" -gt "$now" ]]; then
    echo "[opscheck] $(timestamp) backup check: FAIL — newest backup timestamp is in the future" >&2
    return 1
  fi

  # Compared in MINUTES, not truncated hours. Truncating to hours made an age
  # of 30h30m compare as "30" and pass a 30h threshold, while the application
  # (which compares minutes) called the same backup stale — so the admin UI
  # and this monitor disagreed for a whole hour on every threshold boundary.
  local age_min age_hours
  age_min=$(( (now - newest_epoch) / 60 ))
  age_hours=$(( age_min / 60 ))

  if [[ "$age_min" -gt $(( BACKUP_MAX_AGE_HOURS * 60 )) ]]; then
    echo "[opscheck] $(timestamp) backup check: FAIL — newest backup is ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h)" >&2
    return 1
  fi

  echo "[opscheck] $(timestamp) backup check: OK — newest backup is ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h)"
  return 0
}

# ── recovery status file: parsing helpers (F4-FCR-001) ───────────────────
#
# Minimal, deliberately unambitious JSON extraction for ONE known document
# shape. This is not a JSON parser and does not try to be: `jq` is not a
# dependency anywhere in this repository and this monitor must not acquire
# install-time requirements, while `psql` (where the real state lives) would
# additionally drag DB credentials into a script whose whole value is that it
# keeps working when the app is down and carries no application secret.
#
# The safety property that matters is one-directional: every helper below
# returns NON-ZERO when it cannot extract exactly what it expected, and every
# caller turns that into a check FAILURE. A malformed, truncated, nested, or
# otherwise surprising document therefore alerts. There is no path on which
# a failed extraction becomes a pass.

# safe_token VALUE — renders a value parsed out of the status file for
# logging. Only a short, plain token is ever printed verbatim; anything
# longer or containing unexpected characters is replaced by a fixed
# placeholder, so no raw file content can reach stdout/stderr via a
# diagnostic line.
safe_token() {
  local v="$1"
  if [[ "$v" =~ ^[A-Za-z0-9_.:+-]{1,40}$ ]]; then
    printf '%s' "$v"
  else
    printf '%s' '<unexpected>'
  fi
}

# json_object_body BLOB KEY — prints the inner text of a flat JSON object
# member. `[^{}]*` is load-bearing: it matches only an object with no nested
# object inside, which is exactly the documented shape. A truncated member
# (no closing brace) or an unexpectedly nested one simply does not match, and
# the caller fails the check.
json_object_body() {
  local blob="$1" key="$2" match
  match="$(grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*\{[^{}]*\}" <<<"$blob" | head -n 1 || true)"
  [[ -n "$match" ]] || return 1
  match="${match#*\{}"
  match="${match%\}}"
  printf '%s' "$match"
}

# json_string BODY KEY — prints a string-valued field's contents.
json_string() {
  local body="$1" key="$2" match
  match="$(grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" <<<"$body" | head -n 1 || true)"
  [[ -n "$match" ]] || return 1
  sed -E 's/^.*:[[:space:]]*"(.*)"$/\1/' <<<"$match"
}

# json_uint BODY KEY — prints a non-negative integer field. A negative or
# non-integer value does not match and is therefore a check failure, not a
# silently-coerced zero.
json_uint() {
  local body="$1" key="$2" match
  match="$(grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*[0-9]+" <<<"$body" | head -n 1 || true)"
  [[ -n "$match" ]] || return 1
  match="$(sed -E 's/^.*:[[:space:]]*//' <<<"$match")"
  [[ "$match" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$match"
}

# json_bool BODY KEY — prints exactly "true" or "false".
json_bool() {
  local body="$1" key="$2" match
  match="$(grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*(true|false)" <<<"$body" | head -n 1 || true)"
  [[ -n "$match" ]] || return 1
  sed -E 's/^.*:[[:space:]]*//' <<<"$match"
}

# iso_to_epoch TIMESTAMP — validates the timestamp's shape first, then
# converts. Shape validation is not cosmetic: `date -d` accepts relative
# English ("now", "yesterday"), so passing an unvalidated field through would
# let a garbage value resolve to a always-fresh time and mask a dead worker.
iso_to_epoch() {
  local ts="$1" epoch
  [[ "$ts" =~ $ISO8601_RE ]] || return 1
  epoch="$(date -u -d "$ts" +%s 2>/dev/null || true)"
  [[ "$epoch" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$epoch"
}

# load_status_document LABEL FILE SCHEMA_VERSION MAX_AGE_HOURS NOUN
#
# Reads and sanity-checks ONE status document into the STATUS_BLOB global.
# Returns non-zero, with a LABEL-prefixed diagnostic on stderr, on any
# problem. The blob is returned via a global rather than stdout specifically
# so that there is no code path on which the file's contents could be printed.
#
# Generalized in F4-FCR-002 so the pitr check gets the SAME gates —
# existence, readability, JSON-object shape, exactly-one-schemaVersion, a
# known schema version, and writer liveness — instead of a second,
# subtly-weaker implementation. The two callers below preserve their own
# nouns so every pre-existing diagnostic string is byte-identical.
STATUS_BLOB=""
STATUS_GENERATED_AGE_MIN=0
RECOVERY_STATUS_BLOB=""
RECOVERY_STATUS_GENERATED_AGE_MIN=0
PITR_STATUS_BLOB=""

load_status_document() {
  local label="$1" file="$2" want_version="$3" max_age_hours="$4" noun="$5"
  local raw blob occurrences schema_version

  if [[ ! -e "$file" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun '$file' does not exist (never written, or the writer is not running)" >&2
    return 1
  fi
  if [[ ! -f "$file" ]] || [[ ! -r "$file" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun '$file' is not a readable regular file" >&2
    return 1
  fi
  if ! raw="$(cat "$file" 2>/dev/null)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — could not read $noun '$file'" >&2
    return 1
  fi

  # Normalize to a single whitespace-collapsed line so the extraction regexes
  # below do not have to care whether the writer emitted pretty-printed or
  # compact JSON.
  blob="$(tr -s '\n\r\t ' ' ' <<<"$raw")"
  blob="${blob#"${blob%%[![:space:]]*}"}"
  blob="${blob%"${blob##*[![:space:]]}"}"

  if [[ -z "$blob" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun is empty" >&2
    return 1
  fi
  if [[ "${blob:0:1}" != "{" ]] || [[ "${blob: -1}" != "}" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun is not a JSON object (unparseable)" >&2
    return 1
  fi

  # Exactly one schemaVersion key must exist. Zero means it is not the
  # document this script understands; more than one means the extraction
  # below would be picking arbitrarily between them.
  occurrences="$(grep -oE '"schemaVersion"' <<<"$blob" | wc -l | tr -d ' ')"
  if [[ "$occurrences" != "1" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun does not contain exactly one 'schemaVersion' field (found ${occurrences})" >&2
    return 1
  fi
  if ! schema_version="$(json_uint "$blob" schemaVersion)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'schemaVersion' is missing or is not a non-negative integer" >&2
    return 1
  fi
  if [[ "$schema_version" != "$want_version" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun declares schemaVersion=$(safe_token "$schema_version"), this script understands only ${want_version}" >&2
    return 1
  fi

  # The status file's OWN freshness, validated HERE rather than inside a
  # single check, because its contents are last-known-good values that keep
  # looking healthy forever once the writer dies. This gate previously lived
  # only in check_filebackup, which left `--check drill` reporting OK off a
  # status file that had not been refreshed for weeks — a dead worker reading
  # as a healthy dead-man's switch. Every consumer of the blob must clear it.
  local generated_at generated_epoch now
  now="$(date +%s)"
  if ! generated_at="$(json_string "$blob" generatedAt)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'generatedAt' is missing or is not a string" >&2
    return 1
  fi
  if ! generated_epoch="$(iso_to_epoch "$generated_at")"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'generatedAt' is not a valid ISO-8601 timestamp" >&2
    return 1
  fi
  if [[ "$generated_epoch" -gt "$now" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'generatedAt' is in the future (clock skew fails closed)" >&2
    return 1
  fi
  STATUS_GENERATED_AGE_MIN=$(( (now - generated_epoch) / 60 ))
  if [[ "$STATUS_GENERATED_AGE_MIN" -gt $(( max_age_hours * 60 )) ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — $noun was last refreshed $(( STATUS_GENERATED_AGE_MIN / 60 ))h ago (max ${max_age_hours}h) — the writer is not running" >&2
    return 1
  fi

  STATUS_BLOB="$blob"
  return 0
}

# Thin wrappers. Each keeps its own noun so every diagnostic string that
# existed before F4-FCR-002 is unchanged, and each publishes to the global its
# own consumers already read.
load_recovery_status() {
  load_status_document "$1" "$RECOVERY_STATUS_FILE" "$RECOVERY_STATUS_SCHEMA_VERSION" \
    "$RECOVERY_STATUS_MAX_AGE_HOURS" "recovery status file" || return 1
  RECOVERY_STATUS_BLOB="$STATUS_BLOB"
  RECOVERY_STATUS_GENERATED_AGE_MIN="$STATUS_GENERATED_AGE_MIN"
  return 0
}

load_pitr_status() {
  load_status_document "$1" "$PITR_STATUS_FILE" "$PITR_STATUS_SCHEMA_VERSION" \
    "$PITR_STATUS_MAX_AGE_HOURS" "PITR status file" || return 1
  PITR_STATUS_BLOB="$STATUS_BLOB"
  return 0
}

# ── check: file backup (patient attachment off-host copies) ──────────────
check_filebackup() {
  local label="filebackup"
  load_recovery_status "$label" || return 1

  local now generated_age
  now="$(date +%s)"
  # Freshness of the status file itself is enforced by load_recovery_status()
  # for every consumer; this is only for the human-readable OK line.
  generated_age=$(( RECOVERY_STATUS_GENERATED_AGE_MIN / 60 ))

  local body
  if ! body="$(json_object_body "$RECOVERY_STATUS_BLOB" fileBackup)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — no readable 'fileBackup' object in the recovery status file" >&2
    return 1
  fi

  local enabled
  if ! enabled="$(json_bool "$body" enabled)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.enabled' is missing or is not a boolean" >&2
    return 1
  fi
  # Switched-off file backup is itself an alertable first-customer condition,
  # not a reason to skip the check: with it off, patient attachments have no
  # second copy anywhere, which is precisely what this check exists to catch.
  if [[ "$enabled" != "true" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — file backup is DISABLED (fileBackup.enabled=false); patient attachments have no second copy" >&2
    return 1
  fi

  # A destination on the SAME failure domain is not a backup. Without this,
  # a local-directory destination on the documented single-disk production VPS
  # completes cleanly, reports status=completed, and this dead-man's switch
  # pings healthy every 5 minutes while the "second copy" shares a disk with
  # the primary — a disk loss destroys both. Alarming on `enabled=false` alone
  # is strictly weaker than alarming on the condition that actually matters.
  # An operator who has deliberately accepted a same-host copy can opt out.
  local off_host
  if ! off_host="$(json_bool "$body" destinationOffHost)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.destinationOffHost' is missing or is not a boolean" >&2
    return 1
  fi
  if [[ "$off_host" != "true" ]] && [[ "$FILEBACKUP_REQUIRE_OFFHOST" == "true" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — file backup destination is NOT in an independent failure domain (fileBackup.destinationOffHost=false); a same-host copy does not survive host or disk loss. Set NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST=false to accept this deliberately." >&2
    return 1
  fi
  if [[ "$off_host" != "true" ]]; then
    echo "[opscheck] $(timestamp) $label check: WARNING — file backup destination is NOT off-host; this is an accepted risk (NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST=false)" >&2
  fi

  local status
  if ! status="$(json_string "$body" status)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.status' is missing or is not a string" >&2
    return 1
  fi
  if [[ "$status" != "completed" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last file-backup run status='$(safe_token "$status")' (expected completed)" >&2
    return 1
  fi

  local files_failed files_missing
  if ! files_failed="$(json_uint "$body" filesFailed)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.filesFailed' is missing or is not a non-negative integer" >&2
    return 1
  fi
  if ! files_missing="$(json_uint "$body" filesMissing)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.filesMissing' is missing or is not a non-negative integer" >&2
    return 1
  fi
  if [[ "$files_failed" -gt 0 ]] || [[ "$files_missing" -gt 0 ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last file-backup run reported ${files_failed} failed and ${files_missing} missing file(s)" >&2
    return 1
  fi

  local last_run_at last_run_epoch age_hours
  if ! last_run_at="$(json_string "$body" lastRunAt)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.lastRunAt' is missing or is not a string" >&2
    return 1
  fi
  if ! last_run_epoch="$(iso_to_epoch "$last_run_at")"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.lastRunAt' is not a valid ISO-8601 timestamp" >&2
    return 1
  fi
  # Mirrors check_backup's future-timestamp guard for the same reason: a
  # future timestamp makes the age arithmetic go negative, which compares as
  # "not older than max" and would fail OPEN.
  if [[ "$last_run_epoch" -gt "$now" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'fileBackup.lastRunAt' is in the future (clock skew fails closed)" >&2
    return 1
  fi
  # Minutes, not truncated hours — see check_backup for why.
  local age_min
  age_min=$(( (now - last_run_epoch) / 60 ))
  age_hours=$(( age_min / 60 ))
  if [[ "$age_min" -gt $(( FILEBACKUP_MAX_AGE_HOURS * 60 )) ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last successful file backup was ${age_hours}h ago (max ${FILEBACKUP_MAX_AGE_HOURS}h)" >&2
    return 1
  fi

  echo "[opscheck] $(timestamp) $label check: OK — last file backup completed ${age_hours}h ago (max ${FILEBACKUP_MAX_AGE_HOURS}h), 0 failed, 0 missing; status file refreshed ${generated_age}h ago"
  return 0
}

# ── check: restore rehearsal (drill) ─────────────────────────────────────
# A backup nobody has ever restored is a hope, not a recovery capability.
# This check asserts that a rehearsal actually ran recently and passed.
check_drill() {
  local label="drill"
  load_recovery_status "$label" || return 1

  local body
  if ! body="$(json_object_body "$RECOVERY_STATUS_BLOB" drill)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — no readable 'drill' object in the recovery status file (no restore rehearsal has ever been recorded)" >&2
    return 1
  fi

  local now last_run_at last_run_epoch age_hours status
  now="$(date +%s)"

  if ! last_run_at="$(json_string "$body" lastRunAt)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'drill.lastRunAt' is missing or is not a string" >&2
    return 1
  fi
  if ! last_run_epoch="$(iso_to_epoch "$last_run_at")"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'drill.lastRunAt' is not a valid ISO-8601 timestamp" >&2
    return 1
  fi
  if [[ "$last_run_epoch" -gt "$now" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'drill.lastRunAt' is in the future (clock skew fails closed)" >&2
    return 1
  fi
  # Minutes, not truncated hours — see check_backup for why.
  local age_min
  age_min=$(( (now - last_run_epoch) / 60 ))
  age_hours=$(( age_min / 60 ))
  if [[ "$age_min" -gt $(( DRILL_MAX_AGE_HOURS * 60 )) ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last restore rehearsal was ${age_hours}h ago (max ${DRILL_MAX_AGE_HOURS}h)" >&2
    return 1
  fi

  if ! status="$(json_string "$body" status)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'drill.status' is missing or is not a string" >&2
    return 1
  fi
  if [[ "$status" != "passed" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last restore rehearsal status='$(safe_token "$status")' (expected passed)" >&2
    return 1
  fi

  echo "[opscheck] $(timestamp) $label check: OK — last restore rehearsal passed ${age_hours}h ago (max ${DRILL_MAX_AGE_HOURS}h)"
  return 0
}

# ── check: PITR / WAL archive (F4-FCR-002) ───────────────────────────────
#
# Reads ONLY the PITR status document. It never invokes pgbackrest, never
# opens a database connection, and carries no credential — see the note at
# PITR_STATUS_FILE for why that separation is load-bearing.
#
# All five signals ride this ONE exit bit deliberately. Giving each its own bit
# would exhaust the mask and create five provider-side checks for a single
# subsystem, which is how an operator learns to ignore a check.
#
# The ordering below matters. Assertions 3 and 4 exist because a monitor that
# only checks last-BACKUP age reports green straight through a total WAL-archive
# outage: scheduled backups keep succeeding (each needs only the couple of
# segments spanning its own start and stop) while inter-backup archiving is
# broken and the continuous PITR chain has a hole. Backup freshness and archive
# freshness are independent failures and are both asserted.
check_pitr() {
  local label="pitr" body body_archive mode value age check_status offhost tier

  load_pitr_status "$label" || return 1

  if ! body="$(json_object_body "$PITR_STATUS_BLOB" archive)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'archive' object is missing or not a flat object" >&2
    return 1
  fi
  # `body` is reused for the repo object further down; the archive body is kept
  # so the closing OK line can still report the backlog figure.
  body_archive="$body"

  # 1. archive_mode. `off` is the CURRENT production state, so this check
  #    correctly fails until PITR is actually activated. That is not a false
  #    alarm — it is the check refusing to report a capability that does not
  #    exist. Do not install the provider-side check before activating.
  if ! mode="$(json_string "$body" mode)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'archive.mode' is missing or is not a string" >&2
    return 1
  fi
  if [[ "$mode" != "on" ]] && [[ "$mode" != "always" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — archive_mode='$(safe_token "$mode")' (expected on) — WAL archiving is NOT active and there is no PITR capability" >&2
    return 1
  fi

  # 2. archive_command integrity. A command wrapped in `|| true` or otherwise
  #    swallowing its exit status makes PostgreSQL mark segments archived and
  #    recycle them while nothing reaches the repository — backups keep
  #    succeeding and every dashboard stays green. The writer compares against
  #    the exact expected string; anything else is reported as not ok.
  if ! value="$(json_bool "$body" commandOk)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'archive.commandOk' is missing or is not a boolean" >&2
    return 1
  fi
  if [[ "$value" != "true" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — archive_command does not exactly match the expected pgbackrest archive-push invocation (a wrapped or altered command can silently discard WAL while reporting success)" >&2
    return 1
  fi

  # 3. Archiver failures reported by PostgreSQL itself.
  if ! value="$(json_uint "$body" failedCount)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'archive.failedCount' is missing or is not a non-negative integer" >&2
    return 1
  fi
  if [[ "$value" -gt 0 ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — pg_stat_archiver reports ${value} failed archive attempt(s)" >&2
    return 1
  fi

  # 4. Newest archived WAL age — the assertion that catches a broken archive
  #    behind a fresh backup.
  if ! age="$(json_uint "$body" lastArchivedAgeMinutes)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — no WAL segment has ever been archived, or its timestamp is missing/in the future (clock skew fails closed)" >&2
    return 1
  fi
  if [[ "$age" -gt "$PITR_MAX_WAL_AGE_MINUTES" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — newest archived WAL is ${age}m old (max ${PITR_MAX_WAL_AGE_MINUTES}m) — the recoverable point is falling behind the RPO target" >&2
    return 1
  fi

  # 4b. WAL BACKLOG — volume, not time (F4-FCR-003-R1).
  #
  #     Assertions 3 and 4 both measure the archive as a RATE or an AGE. Gate 0
  #     showed the repo2 failure mode is neither: `archive-push` fails as a
  #     whole, PostgreSQL retains every segment, and the cluster keeps
  #     accepting writes. Under bulk load pg_wal can exhaust the filesystem
  #     long before a 120-minute age threshold trips, and when the `disk` check
  #     finally fires at 90% it names the wrong subsystem.
  #
  #     Both limits are off by default (0). Once a limit IS set, an absent or
  #     unreadable measurement FAILS: the operator asked for this assertion, so
  #     "I could not measure it" must not render as "there is no backlog" —
  #     that is the exact silent-green this whole document exists to prevent.
  if [[ "$PITR_REQUIRE_WAL_BACKLOG" == "true" ]] || [[ "$PITR_MAX_WAL_READY_COUNT" -gt 0 ]]; then
    if ! value="$(json_uint "$body" readyCount)"; then
      echo "[opscheck] $(timestamp) $label check: FAIL — 'archive.readyCount' is missing or is not a non-negative integer, but a WAL backlog limit is configured. The status writer could not count pg_wal/archive_status/*.ready; refusing to assume the backlog is empty. Deploy the F4-FCR-003-R1 noramedi-pgbackrest-status.sh, or unset NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT." >&2
      return 1
    fi
    if [[ "$PITR_MAX_WAL_READY_COUNT" -gt 0 ]] && [[ "$value" -gt "$PITR_MAX_WAL_READY_COUNT" ]]; then
      echo "[opscheck] $(timestamp) $label check: FAIL — ${value} WAL segment(s) are waiting to be archived (max ${PITR_MAX_WAL_READY_COUNT}). archive-push is not keeping up; if a repo2 is configured and unreachable this ALSO suspends archiving to repo1, and pg_wal will keep growing until the filesystem fills." >&2
      return 1
    fi
  fi
  if [[ "$PITR_REQUIRE_WAL_BACKLOG" == "true" ]] || [[ "$PITR_MAX_WAL_BYTES" -gt 0 ]]; then
    if ! value="$(json_uint "$body" walBytes)"; then
      echo "[opscheck] $(timestamp) $label check: FAIL — 'archive.walBytes' is missing or is not a non-negative integer, but a pg_wal size limit is configured. Refusing to assume pg_wal is small. Deploy the F4-FCR-003-R1 noramedi-pgbackrest-status.sh, or unset NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES." >&2
      return 1
    fi
    if [[ "$PITR_MAX_WAL_BYTES" -gt 0 ]] && [[ "$value" -gt "$PITR_MAX_WAL_BYTES" ]]; then
      echo "[opscheck] $(timestamp) $label check: FAIL — pg_wal holds $(( value / 1048576 )) MiB (max $(( PITR_MAX_WAL_BYTES / 1048576 )) MiB). WAL is accumulating faster than it is being archived and this filesystem also holds PGDATA." >&2
      return 1
    fi
  fi

  # ── repository ─────────────────────────────────────────────────────────
  if ! body="$(json_object_body "$PITR_STATUS_BLOB" repo)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'repo' object is missing or not a flat object" >&2
    return 1
  fi

  if ! value="$(json_bool "$body" statusOk)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'repo.statusOk' is missing or is not a boolean" >&2
    return 1
  fi
  if [[ "$value" != "true" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — pgbackrest reports the stanza as not ok" >&2
    return 1
  fi

  # 5. Repository encryption. The repository holds a physical copy of every
  #    table, including special-category health data, and no patient column is
  #    encrypted at column level — so this is the only confidentiality control
  #    on the artifact. An unencrypted repo is a failure, not a warning.
  if ! value="$(json_string "$body" cipherType)" || [[ "$value" != "aes-256-cbc" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — repository cipherType='$(safe_token "${value:-missing}")' (expected aes-256-cbc); an unencrypted repository holds cleartext special-category health data" >&2
    return 1
  fi

  # 6. `pgbackrest check` — the only command that validates the whole
  #    archive_command -> repository path end to end.
  if ! check_status="$(json_string "$body" checkStatus)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'repo.checkStatus' is missing or is not a string" >&2
    return 1
  fi
  if [[ "$check_status" != "ok" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last 'pgbackrest check' result is '$(safe_token "$check_status")' (expected ok)" >&2
    return 1
  fi
  if ! age="$(json_uint "$body" checkAgeMinutes)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'repo.checkAgeMinutes' is missing or in the future (clock skew fails closed)" >&2
    return 1
  fi
  if [[ "$age" -gt $(( PITR_CHECK_MAX_AGE_HOURS * 60 )) ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — last 'pgbackrest check' was $(( age / 60 ))h ago (max ${PITR_CHECK_MAX_AGE_HOURS}h)" >&2
    return 1
  fi

  # 7. Backup freshness — independent of WAL freshness (see the header note).
  if ! age="$(json_uint "$body" lastBackupAgeMinutes)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — no pgBackRest backup exists, or its timestamp is missing/in the future" >&2
    return 1
  fi
  if [[ "$age" -gt $(( PITR_MAX_BACKUP_AGE_HOURS * 60 )) ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — newest pgBackRest backup is $(( age / 60 ))h old (max ${PITR_MAX_BACKUP_AGE_HOURS}h)" >&2
    return 1
  fi

  # 8. Independent failure domain. Tri-state, and only "yes" counts: "unproven"
  #    means a remote repository is configured but no restore has ever been
  #    performed from it, which is exactly the state that must not be allowed
  #    to render as a green off-host tick.
  if ! offhost="$(json_string "$body" offHost)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'repo.offHost' is missing or is not a string" >&2
    return 1
  fi
  tier="$(json_string "$body" tier 2>/dev/null || echo '?')"
  if [[ "$offhost" != "yes" ]]; then
    if [[ "$PITR_REQUIRE_OFFHOST" == "true" ]]; then
      echo "[opscheck] $(timestamp) $label check: FAIL — repository off-host state is '$(safe_token "$offhost")' (tier $(safe_token "$tier")); the backup does not survive loss of this host. Set NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=false to accept a same-host repository knowingly during the stage-1 pilot." >&2
      return 1
    fi
    echo "[opscheck] $(timestamp) $label check: WARNING — repository off-host state is '$(safe_token "$offhost")' (tier $(safe_token "$tier")); accepted because NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=false. RPO is improved; host-loss durability is NOT." >&2
  fi

  # 9. The off-host repository must be RECEIVING BACKUPS, not merely proven
  #    once. Check 7 above measures repo1; a starving repo2 leaves it green.
  #
  #    This is the failure this check exists for: the proof marker behind
  #    offHost="yes" stays valid for 30 days, so a repo2 that stopped
  #    receiving backups the day after its drill would report a proven,
  #    healthy off-host repository for a month. "A restore worked once" is
  #    not "a restore would work now" — the newest thing recoverable from
  #    repo2 is whatever it last received. Reuses the same backup-age
  #    threshold as repo1 rather than inventing a second knob.
  if repo2_count="$(json_uint "$body" repo2BackupCount 2>/dev/null)"; then
    if [[ "$repo2_count" -eq 0 ]]; then
      echo "[opscheck] $(timestamp) $label check: FAIL — a repo2 is configured but holds ZERO backups. It receives WAL and cannot restore: a base backup is required before any recovery from it is possible. Run noramedi-pgbackrest-backup.sh --repo 2." >&2
      return 1
    fi
    if repo2_age="$(json_uint "$body" repo2LastBackupAgeMinutes 2>/dev/null)"; then
      if [[ "$repo2_age" -gt $(( PITR_MAX_BACKUP_AGE_HOURS * 60 )) ]]; then
        echo "[opscheck] $(timestamp) $label check: FAIL — newest repo2 (off-host) backup is $(( repo2_age / 60 ))h old (max ${PITR_MAX_BACKUP_AGE_HOURS}h). The local repository may be current; the off-host copy is not, and only the off-host copy survives loss of this host." >&2
        return 1
      fi
    else
      # Configured, non-empty, but no readable age. Fails closed for the same
      # reason every other age in this script does: an unmeasurable backup
      # must never be treated as a fresh one.
      echo "[opscheck] $(timestamp) $label check: FAIL — a repo2 is configured with ${repo2_count} backup(s) but 'repo.repo2LastBackupAgeMinutes' is missing or unreadable; refusing to assume it is fresh" >&2
      return 1
    fi
  fi

  # The backlog figure is reported on the OK line too, not only on failure: an
  # operator watching an activation needs to see the number trending, and a
  # check that only speaks when it is already too late teaches nobody the shape
  # of normal. Omitted entirely when the writer did not measure it, so a
  # pre-F4-FCR-003-R1 producer changes nothing about this line.
  local backlog=""
  if value="$(json_uint "$body_archive" readyCount 2>/dev/null)"; then
    backlog=", waiting-to-archive=${value}"
  fi
  echo "[opscheck] $(timestamp) $label check: OK — archive_mode=$(safe_token "$mode"), newest WAL fresh, repo encrypted, check ok, off-host=$(safe_token "$offhost")${backlog}"
  return 0
}

# ── run ──────────────────────────────────────────────────────────────────
EXIT_CODE=0
PM2_LABEL="pm2"
DISK_LABEL="disk"
BACKUP_LABEL="backup"
FILEBACKUP_LABEL="filebackup"
DRILL_LABEL="drill"
PITR_LABEL="pitr"

run_check() {
  local name="$1" fn="$2" label="$3" ping_var="$4" bit="$5"
  local local_ok=true

  if ! "$fn"; then
    local_ok=false
    EXIT_CODE=$(( EXIT_CODE | bit ))
  fi

  if [[ "$local_ok" == "true" ]]; then
    ping_result "success" "$label" "$ping_var" || EXIT_CODE=$(( EXIT_CODE | PING_FAILURE_BIT ))
  else
    ping_result "fail" "$label" "$ping_var" || EXIT_CODE=$(( EXIT_CODE | PING_FAILURE_BIT ))
  fi
}

for c in "${CHECKS_TO_RUN[@]}"; do
  case "$c" in
    pm2)        run_check "pm2"        check_pm2        "$PM2_LABEL"        NORAMEDI_OPSCHECK_PM2_PING_URL         1 ;;
    disk)       run_check "disk"       check_disk       "$DISK_LABEL"       NORAMEDI_OPSCHECK_DISK_PING_URL        2 ;;
    backup)     run_check "backup"     check_backup     "$BACKUP_LABEL"     NORAMEDI_OPSCHECK_BACKUP_PING_URL      4 ;;
    filebackup) run_check "filebackup" check_filebackup "$FILEBACKUP_LABEL" NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL  8 ;;
    drill)      run_check "drill"      check_drill      "$DRILL_LABEL"      NORAMEDI_OPSCHECK_DRILL_PING_URL      16 ;;
    # 128, not 64. See the EXIT-CODE CONTRACT ADDITION note in the header: 64
    # is CONFIG_ERROR_EXIT_CODE, and no combination of check bits can reach it
    # (1+2+4+8+16+32 = 63), so it stays unambiguous while nothing moves.
    pitr)       run_check "pitr"       check_pitr       "$PITR_LABEL"       NORAMEDI_OPSCHECK_PITR_PING_URL      128 ;;
    *) echo "Unknown --check value: $c (expected pm2|disk|backup|filebackup|drill|pitr)" >&2; exit "$CONFIG_ERROR_EXIT_CODE" ;;
  esac
done

echo "[opscheck] $(timestamp) summary: checks=[${CHECKS_TO_RUN[*]}] exit=$EXIT_CODE"
exit "$EXIT_CODE"

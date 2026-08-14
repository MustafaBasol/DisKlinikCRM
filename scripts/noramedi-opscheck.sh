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
#                        [--check pm2|disk|backup|filebackup|drill]
#                        [-h|--help]
#
# Options:
#   --dry-run   Run all local checks; never invoke curl. Prints what would
#               have been pinged (label + outcome only, never a URL).
#   --check X   Run only the named check (repeatable). Default: all five.
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
#   NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS      default: 192 (positive
#     integer) — max age of drill.lastRunAt. 192h = 8 days: one weekly
#     restore rehearsal plus a day of margin, so a single skipped or
#     slightly-late rehearsal does not alert.
#   NORAMEDI_OPSCHECK_SUPPRESS_PING            comma-separated check names
#                                               (pm2,disk,backup,filebackup,
#                                               drill) to skip pinging for —
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
DRILL_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS:-192}"
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
  CHECKS_TO_RUN=(pm2 disk backup filebackup drill)
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

  local age_hours
  age_hours=$(( (now - newest_epoch) / 3600 ))

  if [[ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]]; then
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

# load_recovery_status LABEL — reads and sanity-checks the status file into
# the RECOVERY_STATUS_BLOB global. Returns non-zero, with a LABEL-prefixed
# diagnostic on stderr, on any problem. The blob is returned via a global
# rather than stdout specifically so that there is no code path on which the
# file's contents could be printed.
RECOVERY_STATUS_BLOB=""

load_recovery_status() {
  local label="$1" raw blob occurrences schema_version

  if [[ ! -e "$RECOVERY_STATUS_FILE" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file '$RECOVERY_STATUS_FILE' does not exist (never written, or the writer is not running)" >&2
    return 1
  fi
  if [[ ! -f "$RECOVERY_STATUS_FILE" ]] || [[ ! -r "$RECOVERY_STATUS_FILE" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file '$RECOVERY_STATUS_FILE' is not a readable regular file" >&2
    return 1
  fi
  if ! raw="$(cat "$RECOVERY_STATUS_FILE" 2>/dev/null)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — could not read recovery status file '$RECOVERY_STATUS_FILE'" >&2
    return 1
  fi

  # Normalize to a single whitespace-collapsed line so the extraction regexes
  # below do not have to care whether the writer emitted pretty-printed or
  # compact JSON.
  blob="$(tr -s '\n\r\t ' ' ' <<<"$raw")"
  blob="${blob#"${blob%%[![:space:]]*}"}"
  blob="${blob%"${blob##*[![:space:]]}"}"

  if [[ -z "$blob" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file is empty" >&2
    return 1
  fi
  if [[ "${blob:0:1}" != "{" ]] || [[ "${blob: -1}" != "}" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file is not a JSON object (unparseable)" >&2
    return 1
  fi

  # Exactly one schemaVersion key must exist. Zero means it is not the
  # document this script understands; more than one means the extraction
  # below would be picking arbitrarily between them.
  occurrences="$(grep -oE '"schemaVersion"' <<<"$blob" | wc -l | tr -d ' ')"
  if [[ "$occurrences" != "1" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file does not contain exactly one 'schemaVersion' field (found ${occurrences})" >&2
    return 1
  fi
  if ! schema_version="$(json_uint "$blob" schemaVersion)"; then
    echo "[opscheck] $(timestamp) $label check: FAIL — 'schemaVersion' is missing or is not a non-negative integer" >&2
    return 1
  fi
  if [[ "$schema_version" != "$RECOVERY_STATUS_SCHEMA_VERSION" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file declares schemaVersion=$(safe_token "$schema_version"), this script understands only ${RECOVERY_STATUS_SCHEMA_VERSION}" >&2
    return 1
  fi

  RECOVERY_STATUS_BLOB="$blob"
  return 0
}

# ── check: file backup (patient attachment off-host copies) ──────────────
check_filebackup() {
  local label="filebackup"
  load_recovery_status "$label" || return 1

  local now
  now="$(date +%s)"

  # The status file's OWN freshness first. Its contents are last-known-good
  # values that keep looking healthy forever once the writer dies, so a file
  # that stopped being refreshed must fail before any field inside it is
  # believed.
  local generated_at generated_epoch generated_age
  if ! generated_at="$(json_string "$RECOVERY_STATUS_BLOB" generatedAt)"; then
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
  generated_age=$(( (now - generated_epoch) / 3600 ))
  if [[ "$generated_age" -gt "$RECOVERY_STATUS_MAX_AGE_HOURS" ]]; then
    echo "[opscheck] $(timestamp) $label check: FAIL — recovery status file was last refreshed ${generated_age}h ago (max ${RECOVERY_STATUS_MAX_AGE_HOURS}h) — the writer is not running" >&2
    return 1
  fi

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
  age_hours=$(( (now - last_run_epoch) / 3600 ))
  if [[ "$age_hours" -gt "$FILEBACKUP_MAX_AGE_HOURS" ]]; then
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
  age_hours=$(( (now - last_run_epoch) / 3600 ))
  if [[ "$age_hours" -gt "$DRILL_MAX_AGE_HOURS" ]]; then
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

# ── run ──────────────────────────────────────────────────────────────────
EXIT_CODE=0
PM2_LABEL="pm2"
DISK_LABEL="disk"
BACKUP_LABEL="backup"
FILEBACKUP_LABEL="filebackup"
DRILL_LABEL="drill"

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
    *) echo "Unknown --check value: $c (expected pm2|disk|backup|filebackup|drill)" >&2; exit "$CONFIG_ERROR_EXIT_CODE" ;;
  esac
done

echo "[opscheck] $(timestamp) summary: checks=[${CHECKS_TO_RUN[*]}] exit=$EXIT_CODE"
exit "$EXIT_CODE"

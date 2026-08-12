#!/usr/bin/env bash
# noramedi-opscheck.sh — F3-OBS-002
# Deploy to: /usr/local/sbin/noramedi-opscheck.sh
# chmod +x /usr/local/sbin/noramedi-opscheck.sh
# Intended runner: ops/systemd/noramedi-opscheck.{service,timer} (root, oneshot,
# independent of the noramedi-api/noramedi-worker processes it monitors — a
# dead-man's-switch monitor that runs inside the API process cannot report
# when the whole process/host is down).
#
# Three independent local checks, each pinging its own dead-man's-switch URL
# (Healthchecks.io-style: a plain GET on success, GET "$URL/fail" on a known
# local failure; no ping at all — the provider's own grace-period timeout is
# the signal — on a host/network outage that prevents this script from
# running or from reaching the network at all):
#
#   pm2     noramedi-api AND noramedi-worker both PM2 status == "online"
#   disk    filesystem usage at NORAMEDI_OPSCHECK_DISK_PATH under threshold
#   backup  newest file in the DB backup directory younger than max age
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
# Exit code is a bitmask (0 = fully healthy):
#   bit 0 (1): pm2 check failed (either process not "online")
#   bit 1 (2): disk check failed (usage >= threshold, or df unreadable)
#   bit 2 (4): backup check failed (missing dir, no matching file, or stale)
#   bit 3 (8): a ping transport failed, OR a check ran without its ping URL
#              configured (local check result is still computed/reported;
#              only the *ping* is affected)
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
#   noramedi-opscheck.sh [--dry-run] [--check pm2|disk|backup] [-h|--help]
#
# Options:
#   --dry-run   Run all local checks; never invoke curl. Prints what would
#               have been pinged (label + outcome only, never a URL).
#   --check X   Run only the named check (repeatable). Default: all three.
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
#   NORAMEDI_OPSCHECK_SUPPRESS_PING            comma-separated check names
#                                               (pm2,disk,backup) to skip
#                                               pinging for — local check
#                                               still runs/reports. Used only
#                                               for the controlled DRILL B
#                                               (see F3-OBS-002 evidence doc);
#                                               unset in normal operation.
#
# Secret ping-URL variables (see ops/systemd/noramedi-opscheck.env.example):
#   NORAMEDI_OPSCHECK_PM2_PING_URL
#   NORAMEDI_OPSCHECK_DISK_PING_URL
#   NORAMEDI_OPSCHECK_BACKUP_PING_URL

set -euo pipefail

# Force a fixed locale so df/stat/awk number formatting (thousands
# separators, decimal points) can never vary by host locale — the integer
# parsing below assumes plain ASCII digits.
export LC_ALL=C

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# ── config ───────────────────────────────────────────────────────────────
DISK_PATH="${NORAMEDI_OPSCHECK_DISK_PATH:-/}"
BACKUP_DIR="${NORAMEDI_OPSCHECK_BACKUP_DIR:-/root/noramedi-backups}"
STATE_DIR="${NORAMEDI_OPSCHECK_STATE_DIR:-/var/lib/noramedi-opscheck}"
DISK_THRESHOLD="${NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT:-90}"
BACKUP_MAX_AGE_HOURS="${NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS:-30}"
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
  exit 1
fi
if ! [[ "$BACKUP_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || [[ "$BACKUP_MAX_AGE_HOURS" -lt 1 ]]; then
  echo "[opscheck] $(timestamp) FATAL: NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS='$BACKUP_MAX_AGE_HOURS' is not a positive integer" >&2
  exit 1
fi
# Mirrors server/src/services/backupService.ts BACKUP_FILENAME_RE exactly —
# intentionally NOT importing/duplicating business logic, just the one
# filename shape needed to identify a real backup file on disk.
BACKUP_FILENAME_RE='^noramedi_crm-[0-9]{8}-[0-9]{6}\.dump$'
PM2_APPS=(noramedi-api noramedi-worker)

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
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 1 ;;
  esac
done

if [[ ${#CHECKS_TO_RUN[@]} -eq 0 ]]; then
  CHECKS_TO_RUN=(pm2 disk backup)
fi

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

  local now age_hours
  now="$(date +%s)"
  age_hours=$(( (now - newest_epoch) / 3600 ))

  if [[ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]]; then
    echo "[opscheck] $(timestamp) backup check: FAIL — newest backup is ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h)" >&2
    return 1
  fi

  echo "[opscheck] $(timestamp) backup check: OK — newest backup is ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h)"
  return 0
}

# ── run ──────────────────────────────────────────────────────────────────
EXIT_CODE=0
PM2_LABEL="pm2"
DISK_LABEL="disk"
BACKUP_LABEL="backup"

run_check() {
  local name="$1" fn="$2" label="$3" ping_var="$4" bit="$5"
  local local_ok=true

  if ! "$fn"; then
    local_ok=false
    EXIT_CODE=$(( EXIT_CODE | bit ))
  fi

  if [[ "$local_ok" == "true" ]]; then
    ping_result "success" "$label" "$ping_var" || EXIT_CODE=$(( EXIT_CODE | 8 ))
  else
    ping_result "fail" "$label" "$ping_var" || EXIT_CODE=$(( EXIT_CODE | 8 ))
  fi
}

for c in "${CHECKS_TO_RUN[@]}"; do
  case "$c" in
    pm2)    run_check "pm2"    check_pm2    "$PM2_LABEL"    NORAMEDI_OPSCHECK_PM2_PING_URL    1 ;;
    disk)   run_check "disk"   check_disk   "$DISK_LABEL"   NORAMEDI_OPSCHECK_DISK_PING_URL   2 ;;
    backup) run_check "backup" check_backup "$BACKUP_LABEL" NORAMEDI_OPSCHECK_BACKUP_PING_URL 4 ;;
    *) echo "Unknown --check value: $c (expected pm2|disk|backup)" >&2; exit 1 ;;
  esac
done

echo "[opscheck] $(timestamp) summary: checks=[${CHECKS_TO_RUN[*]}] exit=$EXIT_CODE"
exit "$EXIT_CODE"

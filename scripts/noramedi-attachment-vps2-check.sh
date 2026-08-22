#!/usr/bin/env bash
# noramedi-attachment-vps2-check.sh — F4-ATTACH-001-R1
# Deploy to: /usr/local/sbin/noramedi-attachment-vps2-check.sh (NOT installed by this task)
# Intended runner: ops/systemd/noramedi-attachment-vps2-check.{service,timer}
#   (weekly — mirrors scripts/noramedi-pgbackrest-backup.sh's --verify cadence,
#   which also runs weekly rather than on every backup, because `restic check`
#   with `--read-data-subset` reads real ciphertext back from VPS2 and costs
#   real bandwidth/IO on both hosts.)
#
# Runs `restic check` against the attachment-vps2 repository and merges the
# result into the SAME status file noramedi-attachment-vps2-backup.sh writes
# (read-modify-write under a SEPARATE, shared status-write lock — never this
# script's own operation lock — so a concurrent backup/restore-proof run
# cannot interleave a partial write; see with_status_lock() below).
#
# WHY THIS IS A SEPARATE UNIT FROM THE BACKUP SCRIPT (same reasoning as
# ops/systemd/noramedi-pgbackrest-status.service's header comment): `restic
# check` reads real data back from a network-backed repository and can be
# slow or hang independently of whether a backup itself is healthy. Coupling
# it to the daily backup run would let a slow/stuck integrity check delay or
# starve the actual backup, and a single combined unit's timeout would have to
# be sized for the slower of the two operations every single day.
#
# Never logs a patient filename, clinic id, storage key, or file path — only
# restic's own aggregate pass/fail verdict and error COUNT (not error detail
# text, which can echo an object key) are recorded.
#
# Usage:
#   noramedi-attachment-vps2-check.sh [--read-data-subset FRACTION] [--dry-run] [-h|--help]
#
# Options:
#   --read-data-subset F  Forwarded to `restic check --read-data-subset=F`.
#                         Default: NORAMEDI_ATTACHMENT_VPS2_CHECK_SUBSET
#                         (default "5%") — a full `--read-data` pass on every
#                         run re-downloads and re-decrypts the ENTIRE
#                         repository weekly, which does not scale past a
#                         handful of clinics; a rotating subset still
#                         guarantees full coverage over ~20 weeks while
#                         keeping each run's cost bounded. Pass "" to run the
#                         cheaper structure-only check with no data read.
#   --dry-run             Print the exact restic command, invoke nothing.
#
# Environment (optional; defaults shown):
#   NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE       /var/lock/noramedi-attachment-vps2-check.lock
#                                             (deliberately a DIFFERENT lock
#                                             file from the backup script's —
#                                             see §5 of the discovery document
#                                             for why check and backup must be
#                                             allowed to run concurrently
#                                             rather than serialize behind one
#                                             lock)
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE     /var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE /var/lock/noramedi-attachment-vps2-status.lock
#                                             A SEPARATE, short-lived lock held
#                                             only while merging this run's
#                                             result into the status document —
#                                             shared with backup.sh/
#                                             restore-proof.sh against the SAME
#                                             file so a concurrent writer never
#                                             loses the other's fields.
#   NORAMEDI_ATTACHMENT_VPS2_CHECK_SUBSET    5%
#   NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT     3600
#   NORAMEDI_ATTACHMENT_VPS2_CHECK_PING_URL  Healthchecks.io-style heartbeat,
#                                             same convention as the backup
#                                             script — a SEPARATE check/URL
#                                             from the backup ping so an
#                                             operator dashboard can tell "no
#                                             backup ran" apart from "backups
#                                             are running but integrity was
#                                             never verified".
#   RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE / RESTIC_CACHE_DIR — same as the
#     backup script; read directly by restic, never printed by this wrapper.
#
# Exit codes (same convention as the backup script):
#   0  restic check reported no errors
#   1  restic check reported errors — repository integrity is suspect
#   2  usage / CLI error, or an invalid environment value
#   3  precondition failure
#   5  another check run holds the lock
#   124 the restic call exceeded NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
LOCKED_EXIT_CODE=5

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[attachment-vps2-check] $(timestamp) $*"; }
fail() { echo "[attachment-vps2-check] $(timestamp) FAIL — $*" >&2; }

SUBSET="${NORAMEDI_ATTACHMENT_VPS2_CHECK_SUBSET:-5%}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --read-data-subset) SUBSET="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-check.lock}"
STATUS_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE:-/var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json}"
STATUS_LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-status.lock}"
CMD_TIMEOUT="${NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT:-3600}"
PING_URL="${NORAMEDI_ATTACHMENT_VPS2_CHECK_PING_URL:-}"

[[ "$CMD_TIMEOUT" =~ ^[0-9]+$ ]] && [[ "$CMD_TIMEOUT" -gt 0 ]] || {
  echo "Invalid NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT '$CMD_TIMEOUT'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

ping_ok()   { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL"      || true; }
ping_fail() { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL/fail" || true; }

# ── status-write lock — SEPARATE from this script's own operation lock above,
#    and SHARED with noramedi-attachment-vps2-backup.sh/-restore-proof.sh
#    against the same status document. See noramedi-attachment-vps2-backup.sh
#    for the full rationale (unsynchronized read-modify-write can otherwise
#    silently drop another job's fields).
with_status_lock() {
  local lock_dir rc
  lock_dir="$(dirname "$STATUS_LOCK_FILE")"
  mkdir -p "$lock_dir" 2>/dev/null || true
  # `flock FILE COMMAND [ARGS...]` — see noramedi-attachment-vps2-backup.sh's
  # own with_status_lock() for why this form (flock opens/locks/execs/
  # releases entirely in its own C code) replaced an earlier `exec N>FILE`
  # + subshell design that hit two separate bash pitfalls in turn (a bare
  # `exec` permanently redirecting this script's own stderr, then — even
  # once subshell-scoped — a bare subshell statement aborting the whole
  # script under `set -e` before its exit status could ever be captured).
  flock -w 10 "$STATUS_LOCK_FILE" "$@" && rc=0 || rc=$?
  # `if`, not a bare `[[ ]] && fail` — see noramedi-attachment-vps2-backup.sh's
  # own comment: under `set -e`, a bare `test && action` line is ITSELF a
  # "failing command" whenever the test is false (i.e. on the success path),
  # which would abort this function before it ever reaches `return` below.
  if [[ "$rc" -ne 0 ]]; then
    fail "status-write lock could not be acquired within 10s, or the status write itself failed (exit ${rc}) — status may be left unchanged this run"
  fi
  return "$rc"
}

if [[ "$DRY_RUN" != true ]]; then
  command -v flock >/dev/null 2>&1 || {
    fail "flock is not available; refusing to run without an overlap guard"
    exit "$PRECONDITION_EXIT_CODE"
  }
  LOCK_DIR="$(dirname "$LOCK_FILE")"
  [[ -d "$LOCK_DIR" ]] && [[ -w "$LOCK_DIR" ]] || {
    fail "lock directory '$LOCK_DIR' does not exist or is not writable"
    exit "$PRECONDITION_EXIT_CODE"
  }
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    fail "another attachment-vps2 check run holds $LOCK_FILE — skipping this run"
    exit "$LOCKED_EXIT_CODE"
  fi
fi

command -v restic >/dev/null 2>&1 || { fail "restic is not installed"; exit "$PRECONDITION_EXIT_CODE"; }
command -v node    >/dev/null 2>&1 || { fail "node is not available (required to merge the status JSON document)"; exit "$PRECONDITION_EXIT_CODE"; }
command -v timeout >/dev/null 2>&1 || { fail "timeout is not available"; exit "$PRECONDITION_EXIT_CODE"; }

# See noramedi-attachment-vps2-backup.sh's identical check for why this is a
# plain [[ -n ]] test and not bash's ${VAR:?msg} form.
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { fail "RESTIC_REPOSITORY is not set"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" ]] || { fail "RESTIC_PASSWORD_FILE is not set"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -r "$RESTIC_PASSWORD_FILE" ]] || {
  fail "RESTIC_PASSWORD_FILE is not readable by this process"; exit "$PRECONDITION_EXIT_CODE"; }

STATUS_DIR="$(dirname "$STATUS_FILE")"
if [[ "$DRY_RUN" != true ]]; then
  mkdir -p "$STATUS_DIR" 2>/dev/null || { fail "cannot create status directory '$STATUS_DIR'"; exit "$PRECONDITION_EXIT_CODE"; }
fi

RESTIC_ARGS=(check)
[[ -n "$SUBSET" ]] && RESTIC_ARGS+=(--read-data-subset="$SUBSET")

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would run: timeout ${CMD_TIMEOUT}s restic ${RESTIC_ARGS[*]}"
  log "DRY-RUN: nothing was invoked"
  exit 0
fi

log "starting restic check (read-data-subset='${SUBSET:-none}')"
START_EPOCH="$(date -u +%s)"

set +e
CHECK_OUT="$(timeout "${CMD_TIMEOUT}s" restic "${RESTIC_ARGS[@]}" 2>&1)"
RESTIC_EXIT=$?
set -e

DURATION=$(( $(date -u +%s) - START_EPOCH ))
# Aggregate only: how many lines restic printed, never the lines themselves —
# a `check` failure message can embed an object key.
ERROR_LINE_COUNT="$(printf '%s\n' "$CHECK_OUT" | grep -c . || true)"

STATUS="passed"
[[ "$RESTIC_EXIT" -ne 0 ]] && STATUS="failed"

with_status_lock node -e '
  const fs = require("fs");
  const [, , statusFile, generatedAt, status, exitCode, durationStr, subset, lineCount] = process.argv;
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { doc = {}; }
  doc.schemaVersion = 1;
  doc.generatedAt = generatedAt;
  doc.check = {
    lastRunAt: generatedAt,
    lastRunStatus: status,
    lastRunExitCode: Number(exitCode),
    lastRunDurationSeconds: Number(durationStr),
    readDataSubset: subset || null,
    outputLineCount: Number(lineCount),
  };
  const tmp = statusFile + ".tmp." + process.pid;
  const fd = fs.openSync(tmp, "w");
  fs.writeSync(fd, JSON.stringify(doc, null, 2) + "\n");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, statusFile);
' "$STATUS_FILE" "$(timestamp)" "$STATUS" "$RESTIC_EXIT" "$DURATION" "$SUBSET" "$ERROR_LINE_COUNT"

if [[ "$RESTIC_EXIT" -ne 0 ]]; then
  fail "restic check reported errors (exit ${RESTIC_EXIT}, ${ERROR_LINE_COUNT} output lines, no line content logged) after ${DURATION}s"
  ping_fail
  exit 1
fi

log "restic check passed in ${DURATION}s"
ping_ok
log "done"
exit 0

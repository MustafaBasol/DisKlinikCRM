#!/usr/bin/env bash
# noramedi-pgbackrest-backup.sh — F4-FCR-002
# Deploy to: /usr/local/sbin/noramedi-pgbackrest-backup.sh
# chmod +x /usr/local/sbin/noramedi-pgbackrest-backup.sh
# Intended runner: /etc/cron.d/noramedi-pgbackrest (see
#                  ops/pgbackrest/noramedi-pgbackrest.cron.example)
#
# Wrapper around `pgbackrest backup` / `expire` / `verify` that adds the one
# thing the drafted freeze exception explicitly requires and pgBackRest does
# not provide: an EXPLICIT DISK-EXHAUSTION ABORT CONDITION.
#
# ⚠ THIS SCRIPT DOES NOT TOUCH /usr/local/sbin/noramedi-db-backup.sh, its
# 03:15 cron entry, /root/noramedi-backups, /root/noramedi-db-password.txt,
# or /var/log/noramedi-db-backup.log. The pg_dump chain keeps running exactly
# as before and remains the fallback for the whole transition. Nothing here
# replaces it, and no task has authorized removing it.
#
# WHY AN ABORT AND NOT AN ALERT:
# Production is a single ~76 GB filesystem shared by PGDATA, pg_wal, the
# application, uploads, and /root/noramedi-backups. If the pgBackRest repo
# fills it, archive_command starts failing, pg_wal grows without bound, and
# PostgreSQL shuts down. An alert notifies someone after the fact; an abort
# refuses to make it worse. The freeze exception asks for an abort condition,
# so this script exits without invoking pgBackRest when free space is under
# the floor.
#
# Usage:
#   noramedi-pgbackrest-backup.sh [--type full|diff|incr] [--verify]
#                                 [--stanza NAME] [--dry-run] [-h|--help]
#
# Options:
#   --type X     Backup type. Default: full.
#                full is the right default here: the database is ~16 MB, a
#                full costs seconds, and a full-only chain makes restore a
#                single step with no dependency graph to reason about during
#                an incident. Revisit around ~1 GB, not before.
#   --verify     Run `pgbackrest verify` INSTEAD of a backup. Intended for a
#                separate, less frequent cron entry. verify is the only
#                mechanism that checks repository integrity; nothing in the
#                pre-existing pg_dump tier has an equivalent.
#   --stanza N   Default: noramedi
#   --dry-run    Run every precondition, print the exact pgBackRest command,
#                invoke nothing. Safe to run on production at any time.
#
# Environment (optional; defaults shown):
#   NORAMEDI_PGBACKREST_REPO_PATH    /var/lib/pgbackrest
#   NORAMEDI_PGBACKREST_MIN_FREE_MB  10240   abort floor, MiB
#   NORAMEDI_PG_SUPERUSER            postgres
#   NORAMEDI_PGBACKREST_EXPIRE       true    run expire after a successful backup
#
# Exit codes (distinct on purpose — cron mail and journald must be able to
# tell "the disk is nearly full" apart from "pgBackRest failed"):
#   0  success
#   1  pgBackRest reported a failure
#   2  usage / CLI error, or an invalid environment value (fail closed)
#   3  precondition failure (not installed, no stanza, no config)
#   4  ABORTED: free space below the floor. pgBackRest was NOT invoked.
#   5  another run holds the lock (not an error; cron overlap)

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
DISK_ABORT_EXIT_CODE=4
LOCKED_EXIT_CODE=5

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[pgbackrest-backup] $(timestamp) $*"; }
fail() { echo "[pgbackrest-backup] $(timestamp) FAIL — $*" >&2; }

BACKUP_TYPE="full"
STANZA="noramedi"
DRY_RUN=false
DO_VERIFY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)    BACKUP_TYPE="${2:-}"; shift 2 ;;
    --verify)  DO_VERIFY=true; shift ;;
    --stanza)  STANZA="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

case "$BACKUP_TYPE" in
  full|diff|incr) ;;
  *) echo "Invalid --type '$BACKUP_TYPE' (expected full|diff|incr)" >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
esac
if [[ ! "$STANZA" =~ ^[a-z0-9][a-z0-9_]{0,31}$ ]]; then
  echo "Invalid --stanza '$STANZA'" >&2; exit "$USAGE_ERROR_EXIT_CODE"
fi

REPO_PATH="${NORAMEDI_PGBACKREST_REPO_PATH:-/var/lib/pgbackrest}"
MIN_FREE_MB="${NORAMEDI_PGBACKREST_MIN_FREE_MB:-10240}"
PG_SUPERUSER="${NORAMEDI_PG_SUPERUSER:-postgres}"
RUN_EXPIRE="${NORAMEDI_PGBACKREST_EXPIRE:-true}"

[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] && [[ "$MIN_FREE_MB" -gt 0 ]] || {
  echo "Invalid NORAMEDI_PGBACKREST_MIN_FREE_MB '$MIN_FREE_MB'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

# Root is required only to delegate to the PostgreSQL OS user, which --dry-run
# never does: it evaluates the preconditions and prints the command it would
# have run. Requiring sudo merely to preview an action discourages previewing
# it, so the check is scoped to the modes that actually need the privilege.
if [[ "$DRY_RUN" != true ]] && [[ "$(id -u)" -ne 0 ]]; then
  echo "Must run as root (delegates to the $PG_SUPERUSER OS user). Use --dry-run to preview without privileges." >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi

# ── overlap guard ────────────────────────────────────────────────────────
# Mirrors the flock convention the existing pg_dump script already uses
# (/var/lock/noramedi-db-backup.lock). pgBackRest takes its own per-stanza
# lock too, but that one makes the second run ERROR; this makes it exit 5,
# which keeps cron mail honest about why a run was skipped.
#
# Held on a file descriptor for this process's lifetime, deliberately NOT via
# `flock -n <file> <command>`: that form exits 1 when the lock is busy, which
# is indistinguishable from the wrapped command itself exiting 1. Since the
# whole point of the exit codes above is that cron mail can tell "skipped, a
# run was already going" apart from "the backup failed", an ambiguous 1 would
# defeat the contract. The fd form lets us return 5 unambiguously.
# Skipped in --dry-run: there is nothing to serialise against when the run
# invokes nothing, and taking the lock would make a harmless preview able to
# block (or be blocked by) a real backup.
LOCK_FILE="${NORAMEDI_PGBACKREST_LOCK_FILE:-/var/lock/noramedi-pgbackrest.lock}"
if [[ "$DRY_RUN" != true ]]; then
  exec 9>"$LOCK_FILE" || { fail "cannot open lock file $LOCK_FILE"; exit "$PRECONDITION_EXIT_CODE"; }
  if ! flock -n 9; then
    fail "another pgBackRest run holds $LOCK_FILE — skipping this run"
    exit "$LOCKED_EXIT_CODE"
  fi
fi

as_pg() {
  local cmd="$1"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$PG_SUPERUSER" -- /bin/bash -c "$cmd"
  else
    su -s /bin/bash "$PG_SUPERUSER" -c "$cmd"
  fi
}

# ── preconditions ────────────────────────────────────────────────────────
command -v pgbackrest >/dev/null 2>&1 || { fail "pgbackrest is not installed"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -d "$REPO_PATH" ]] || { fail "repo path '$REPO_PATH' does not exist"; exit "$PRECONDITION_EXIT_CODE"; }

if ! as_pg "pgbackrest --stanza=$(printf '%q' "$STANZA") info --output=json" >/dev/null 2>&1; then
  fail "stanza '$STANZA' is not readable — run stanza-create first, and never enable archive_mode before it exists"
  exit "$PRECONDITION_EXIT_CODE"
fi

# ── DISK-EXHAUSTION ABORT (freeze-exception requirement) ─────────────────
FREE_MB="$(df -Pm "$REPO_PATH" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ ! "$FREE_MB" =~ ^[0-9]+$ ]]; then
  # Unreadable free space fails CLOSED. "We could not measure the disk" must
  # never be treated as "the disk is fine".
  fail "could not determine free space on '$REPO_PATH' — aborting rather than assuming it is safe"
  exit "$DISK_ABORT_EXIT_CODE"
fi
if [[ "$FREE_MB" -lt "$MIN_FREE_MB" ]]; then
  fail "ABORT: ${FREE_MB} MB free on '$REPO_PATH', floor is ${MIN_FREE_MB} MB. pgBackRest was NOT invoked."
  fail "  A full filesystem breaks archive_command, which grows pg_wal, which stops PostgreSQL."
  fail "  Free space or lower retention (repo1-retention-full / repo1-retention-archive), then re-run."
  exit "$DISK_ABORT_EXIT_CODE"
fi
log "free space OK: ${FREE_MB} MB (floor ${MIN_FREE_MB} MB)"

# ── build the command ────────────────────────────────────────────────────
Q_STANZA="$(printf '%q' "$STANZA")"
if [[ "$DO_VERIFY" == true ]]; then
  PGBR_CMD="pgbackrest --stanza=${Q_STANZA} verify"
  ACTION="verify"
else
  PGBR_CMD="pgbackrest --stanza=${Q_STANZA} --type=${BACKUP_TYPE} backup"
  ACTION="backup(${BACKUP_TYPE})"
fi

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would run as ${PG_SUPERUSER}: ${PGBR_CMD}"
  [[ "$DO_VERIFY" != true ]] && [[ "$RUN_EXPIRE" == "true" ]] && \
    log "DRY-RUN: would then run as ${PG_SUPERUSER}: pgbackrest --stanza=${Q_STANZA} expire"
  log "DRY-RUN: nothing was invoked"
  exit 0
fi

log "starting ${ACTION} for stanza '${STANZA}'"
START_EPOCH="$(date -u +%s)"

if ! as_pg "$PGBR_CMD"; then
  fail "${ACTION} failed for stanza '${STANZA}' (see /var/log/pgbackrest)"
  exit 1
fi

DURATION=$(( $(date -u +%s) - START_EPOCH ))
log "${ACTION} completed in ${DURATION}s"

# ── expire ───────────────────────────────────────────────────────────────
# Recent pgBackRest runs expire automatically after a successful backup, but
# that default is version-dependent. expire is idempotent, so calling it
# explicitly costs nothing and removes the dependence on a default we have
# not verified against the installed binary.
if [[ "$DO_VERIFY" != true ]] && [[ "$RUN_EXPIRE" == "true" ]]; then
  if ! as_pg "pgbackrest --stanza=${Q_STANZA} expire"; then
    # A failed expire is a retention problem, not a backup problem. The
    # backup above succeeded and is restorable; saying otherwise would be a
    # false negative that erodes trust in the alert.
    fail "expire failed (the ${ACTION} itself SUCCEEDED and is restorable; retention is now unenforced — investigate before the disk fills)"
    exit 1
  fi
  log "expire completed"
fi

log "done"
exit 0

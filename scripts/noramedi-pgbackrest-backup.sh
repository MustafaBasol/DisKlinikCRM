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
#                                 [--stanza NAME] [--repo N] [--dry-run]
#                                 [-h|--help]
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
#   --repo N     Repository to back up TO (1-4). Default: 1 (local).
#                pgBackRest's backup/verify/expire commands operate on ONE
#                repository. Without this flag every run targets the default
#                repository, so an off-host repo2 would be configured,
#                archived to by archive-push, and never receive a base backup
#                — a repository that looks alive and cannot restore. See
#                F4_RECOVERY_OPERATIONS.md §16.
#                ⚠ --repo 1 is byte-for-byte the previous behaviour: the flag
#                is appended to the pgBackRest command ONLY when N != 1, so a
#                build without multi-repo support is unaffected by default.
#   --dry-run    Run every precondition, print the exact pgBackRest command,
#                invoke nothing. Safe to run on production at any time.
#
# Environment (optional; defaults shown):
#   NORAMEDI_PGBACKREST_REPO_PATH    /var/lib/pgbackrest   (repo1 only)
#   NORAMEDI_PGBACKREST_CONF         /etc/pgbackrest/pgbackrest.conf
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
REPO_NUM=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)    BACKUP_TYPE="${2:-}"; shift 2 ;;
    --verify)  DO_VERIFY=true; shift ;;
    --stanza)  STANZA="${2:-}"; shift 2 ;;
    --repo)    REPO_NUM="${2:-}"; shift 2 ;;
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
# Range mirrors the restore drill's --repo validation. pgBackRest supports
# repo1-repo4; anything else is a typo, and a typo that silently fell back to
# repo1 would take a LOCAL backup while the operator believed it was off-host.
if [[ ! "$REPO_NUM" =~ ^[1-4]$ ]]; then
  echo "Invalid --repo '$REPO_NUM' (expected 1-4)" >&2; exit "$USAGE_ERROR_EXIT_CODE"
fi

REPO_PATH="${NORAMEDI_PGBACKREST_REPO_PATH:-/var/lib/pgbackrest}"
PGBACKREST_CONF="${NORAMEDI_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}"
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
#
# ⚠ DO NOT WRAP THIS SCRIPT IN `flock -n <same path> …` FROM CRON.
# flock(2) locks belong to the OPEN FILE DESCRIPTION, not the process, so an
# outer `flock -n /var/lock/noramedi-pgbackrest.lock <this script>` holds the
# lock on its own fd and this script's independent open() then conflicts with
# its own parent — every scheduled run would exit 5 "another run holds the
# lock" and never invoke pgBackRest at all, while cron mail reported a benign
# overlap. The existing pg_dump cron entry has no outer flock for the same
# reason: the script owns its lock.
LOCK_FILE="${NORAMEDI_PGBACKREST_LOCK_FILE:-/var/lock/noramedi-pgbackrest.lock}"
if [[ "$DRY_RUN" != true ]]; then
  # Verified BEFORE the lock attempt. Without this, a missing flock binary
  # makes `flock -n 9` exit 127, which the check below would report as "lock
  # busy" — silently skipping every backup forever behind a reassuring
  # message. An absent locking tool is a precondition failure, not an overlap.
  command -v flock >/dev/null 2>&1 || {
    fail "flock is not available; refusing to run without an overlap guard"
    exit "$PRECONDITION_EXIT_CODE"
  }
  # `exec` on a failed redirection terminates a non-interactive shell before
  # any `||` runs, so the directory is checked first to make the diagnostic
  # reachable rather than dying silently on exit 1.
  LOCK_DIR="$(dirname "$LOCK_FILE")"
  [[ -d "$LOCK_DIR" ]] && [[ -w "$LOCK_DIR" ]] || {
    fail "lock directory '$LOCK_DIR' does not exist or is not writable"
    exit "$PRECONDITION_EXIT_CODE"
  }
  exec 9>"$LOCK_FILE"
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

# Read one `repoN-<key>` out of the config. Same shape as the status writer's
# reader: first match wins, inline comments and surrounding whitespace dropped.
repo_conf_value() {
  grep -oE "^[[:space:]]*$1[[:space:]]*=[[:space:]]*[^[:space:]#;]+" "$PGBACKREST_CONF" 2>/dev/null \
    | sed -E 's/.*=[[:space:]]*//' | head -n1
}

# ── is the TARGET repository local to this host? ─────────────────────────
# This decides which preconditions are meaningful, and nothing else. It is
# deliberately NOT an off-host judgement: `repo2-path=/mnt/other-disk` is
# local by this test AND not off-host, while a remote-looking host that
# resolves back here is remote by this test AND still not off-host. The
# off-host determination lives in noramedi-pgbackrest-status.sh, which is the
# only component allowed to make that claim. See §12.3 of the runbook.
#
# repo1 keeps using NORAMEDI_PGBACKREST_REPO_PATH verbatim so the default path
# through this script is unchanged, including for hosts with no config file.
REPO_IS_LOCAL=true
REPO_LOCAL_PATH="$REPO_PATH"
if [[ "$REPO_NUM" -ne 1 ]]; then
  _rtype="$(repo_conf_value "repo${REPO_NUM}-type" || true)"
  _rhost="$(repo_conf_value "repo${REPO_NUM}-host" || true)"
  _rsftp="$(repo_conf_value "repo${REPO_NUM}-sftp-host" || true)"
  _rpath="$(repo_conf_value "repo${REPO_NUM}-path" || true)"
  if [[ -n "$_rhost" ]] || [[ -n "$_rsftp" ]] \
     || { [[ -n "$_rtype" ]] && [[ "$_rtype" != "posix" ]]; }; then
    REPO_IS_LOCAL=false
  else
    # A repoN with neither a host nor a non-posix type nor a path is not
    # configured at all. Failing here beats letting pgBackRest fall back to
    # some default and reporting success for a repository that does not exist.
    [[ -n "$_rpath" ]] || {
      fail "repo${REPO_NUM} is not configured in '$PGBACKREST_CONF' (no repo${REPO_NUM}-host, repo${REPO_NUM}-sftp-host, repo${REPO_NUM}-type or repo${REPO_NUM}-path)"
      exit "$PRECONDITION_EXIT_CODE"
    }
    REPO_LOCAL_PATH="$_rpath"
  fi

  # Encryption gate for every repository except repo1. This is the ONE
  # prohibition the program states absolutely — "encryption is REQUIRED before
  # any byte leaves this host" — and until now nothing on the write path
  # enforced it. noramedi-pgbackrest-preflight.sh validates it, but preflight
  # is a separate operator step ordered by prose in runbook §16.5, not a gate:
  # `--repo 2` invoked without it wrote a physical copy of every table,
  # including special-category health data under KVKK Art. 6, in plaintext to
  # infrastructure this program does not operate. The status writer's
  # REPO2_PLAINTEXT verdict is the only other backstop and it lands AFTER the
  # bytes are gone, which is exactly one config line too late.
  #
  # Scoped to REPO_NUM != 1 deliberately: it sits inside the existing branch,
  # so the repo1 path that runs in production today is byte-for-byte unchanged.
  # The passphrase is never read, compared, or printed here — only the cipher
  # TYPE is inspected.
  _rcipher="$(repo_conf_value "repo${REPO_NUM}-cipher-type" || true)"
  if [[ "$_rcipher" != "aes-256-cbc" ]]; then
    fail "repo${REPO_NUM}-cipher-type is '${_rcipher:-unset}', not aes-256-cbc — refusing to write a physical copy of every table, including special-category health data, in plaintext to infrastructure this program does not operate. pgBackRest was NOT invoked. Fix the repository config and re-run scripts/noramedi-pgbackrest-preflight.sh before retrying."
    exit "$PRECONDITION_EXIT_CODE"
  fi
fi

if [[ "$REPO_IS_LOCAL" == true ]]; then
  [[ -d "$REPO_LOCAL_PATH" ]] || { fail "repo path '$REPO_LOCAL_PATH' does not exist"; exit "$PRECONDITION_EXIT_CODE"; }

  # Filesystem check, not `info`'s exit status: `pgbackrest info` is
  # informational and exits 0 for a stanza that does not exist, reporting the
  # absence in its JSON body. `stanza-create` builds these two directories, so
  # their presence is the version-independent signal. See the longer note in
  # noramedi-pgbackrest-preflight.sh.
  if [[ ! -d "$REPO_LOCAL_PATH/archive/$STANZA" ]] || [[ ! -d "$REPO_LOCAL_PATH/backup/$STANZA" ]]; then
    fail "stanza '$STANZA' does not exist under '$REPO_LOCAL_PATH' — run stanza-create first, and never enable archive_mode before it exists"
    exit "$PRECONDITION_EXIT_CODE"
  fi

  # ── DISK-EXHAUSTION ABORT (freeze-exception requirement) ───────────────
  FREE_MB="$(df -Pm "$REPO_LOCAL_PATH" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  if [[ ! "$FREE_MB" =~ ^[0-9]+$ ]]; then
    # Unreadable free space fails CLOSED. "We could not measure the disk" must
    # never be treated as "the disk is fine".
    fail "could not determine free space on '$REPO_LOCAL_PATH' — aborting rather than assuming it is safe"
    exit "$DISK_ABORT_EXIT_CODE"
  fi
  if [[ "$FREE_MB" -lt "$MIN_FREE_MB" ]]; then
    fail "ABORT: ${FREE_MB} MB free on '$REPO_LOCAL_PATH', floor is ${MIN_FREE_MB} MB. pgBackRest was NOT invoked."
    fail "  A full filesystem breaks archive_command, which grows pg_wal, which stops PostgreSQL."
    fail "  Free space or lower retention (repo${REPO_NUM}-retention-full / repo${REPO_NUM}-retention-archive), then re-run."
    exit "$DISK_ABORT_EXIT_CODE"
  fi
  log "free space OK: ${FREE_MB} MB (floor ${MIN_FREE_MB} MB)"
else
  # The abort exists to stop THIS host's filesystem from filling. A remote or
  # object-store repository does not consume it, and `df` on the local repo
  # path would measure a disk the backup is not being written to — a check
  # that reads as reassurance while measuring the wrong thing. pgBackRest
  # fails closed on a full or unreachable remote repository, and the stanza
  # existence check there is `pgbackrest check`'s job, not a directory test we
  # cannot perform across the transport.
  log "repo${REPO_NUM} is remote — skipping the local stanza-directory and free-space preconditions (they measure this host, not the target)"
  log "repo${REPO_NUM} reachability and stanza existence are enforced by pgBackRest itself, which fails closed"
fi

# ── build the command ────────────────────────────────────────────────────
# --repo is appended ONLY for N != 1. pgBackRest gained multi-repository
# support in 2.33, and passing --repo=1 to an older build is an option-invalid
# error, not a no-op. Since repo1 is the only repository this program has ever
# run in production, the default path must not acquire a new version
# dependency to gain a capability it does not use.
Q_STANZA="$(printf '%q' "$STANZA")"
REPO_ARG=""
[[ "$REPO_NUM" -ne 1 ]] && REPO_ARG=" --repo=${REPO_NUM}"
if [[ "$DO_VERIFY" == true ]]; then
  PGBR_CMD="pgbackrest --stanza=${Q_STANZA}${REPO_ARG} verify"
  ACTION="verify(repo${REPO_NUM})"
else
  PGBR_CMD="pgbackrest --stanza=${Q_STANZA}${REPO_ARG} --type=${BACKUP_TYPE} backup"
  ACTION="backup(${BACKUP_TYPE},repo${REPO_NUM})"
fi

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would run as ${PG_SUPERUSER}: ${PGBR_CMD}"
  [[ "$DO_VERIFY" != true ]] && [[ "$RUN_EXPIRE" == "true" ]] && \
    log "DRY-RUN: would then run as ${PG_SUPERUSER}: pgbackrest --stanza=${Q_STANZA}${REPO_ARG} expire"
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
  if ! as_pg "pgbackrest --stanza=${Q_STANZA}${REPO_ARG} expire"; then
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

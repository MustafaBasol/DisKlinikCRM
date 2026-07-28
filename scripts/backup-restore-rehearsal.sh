#!/usr/bin/env bash
# backup-restore-rehearsal.sh — BACKUP-RESTORE-REHEARSAL-001
# Deploy to: /usr/local/sbin/noramedi-restore-rehearsal.sh (operator-run, not scheduled)
# chmod +x /usr/local/sbin/noramedi-restore-rehearsal.sh
#
# Restores the most recent NoraMedi PostgreSQL backup (produced by
# /usr/local/sbin/noramedi-db-backup.sh into /root/noramedi-backups) into a
# throwaway, RAM-backed, loopback-only PostgreSQL cluster for verification —
# never into production, never onto persistent disk, never reachable from any
# network interface other than 127.0.0.1 on this same host.
#
# Design constraints (see docs/program/evidence/BACKUP_RESTORE_REHEARSAL_001.md):
#   - Never touches the production database, production PGDATA, or the
#     production Postgres service (no stop/restart/reload of anything).
#   - Never writes restored (PHI-bearing) rows to persistent disk: the
#     disposable cluster's PGDATA lives under /dev/shm (tmpfs / RAM-backed),
#     so a `rm -rf` at cleanup leaves nothing recoverable on disk.
#   - Only reads the source backup file; never moves, renames, or deletes it.
#   - Binds only to 127.0.0.1 on a non-production port; refuses to run if
#     that port collides with the configured production port, and verifies
#     at runtime (not just via config) that the started cluster is actually
#     loopback-only.
#   - Prints only counts, booleans, hashes, and durations to stdout/log —
#     never row contents. Do not redirect full `psql` result sets elsewhere.
#   - Root invocation: the source backup directory (/root/noramedi-backups)
#     is root-only. When this script is run as root it reads the backup
#     file and stages a copy under the RAM-backed rehearsal root itself
#     (mode 700 dir, mode 600 dump copy, owned by the delegated user below),
#     but every actual PostgreSQL operation — initdb, postgresql.conf
#     edits, pg_ctl start/stop, createdb, pg_restore, verification
#     queries — is delegated to an unprivileged OS user (REHEARSAL_OS_USER,
#     see below). This is not optional: PostgreSQL's own tooling refuses to
#     initdb or start a postmaster as root, and delegating everything else
#     too keeps a single, uniformly-tested code path. Client authentication
#     to the disposable cluster uses a one-off PGPASSFILE written alongside
#     the staged dump (never a PGPASSWORD environment variable), so the
#     generated password never has to survive privilege-dropping via
#     su/runuser environment propagation.
#
# Usage:
#   noramedi-restore-rehearsal.sh [OPTIONS]
#
# Options:
#   --backup-file NAME   Specific backup filename under BACKUP_DIR (default: latest)
#   --port PORT          Loopback port for the disposable cluster (default: 55432)
#   --keep-on-failure     Do not clean up the disposable cluster if a step fails
#                          (for operator post-mortem inspection; clean up manually after)
#   -h, --help            Show this help
#
# Environment overrides:
#   BACKUP_DIR            Default /root/noramedi-backups
#   PROD_PG_PORT          Default 5432 (used only for the port-collision guard)
#   REHEARSAL_MIN_FREE_RAM_MB   Default 2048 — required free system RAM
#                                headroom after the tmpfs allocation, so the
#                                rehearsal cannot starve production on the
#                                shared host
#   REHEARSAL_RAM_MULTIPLIER    Default 3 — used both to estimate RAM needed
#                                for the restore and to estimate the restored
#                                cluster's on-disk (tmpfs) footprint for the
#                                /dev/shm capacity check below (dump size *
#                                this, to account for indexes/TOAST/WAL/etc.
#                                beyond the raw dump size)
#   REHEARSAL_SHM_MARGIN_PCT    Default 20 — percent of currently-available
#                                /dev/shm capacity that must remain free
#                                after accounting for the staged dump copy
#                                AND the estimated restored-cluster footprint;
#                                the rehearsal refuses to consume /dev/shm
#                                down to this margin
#   REHEARSAL_OS_USER      Required when this script is run as root (EUID 0).
#                          Names the unprivileged OS user that ALL PostgreSQL
#                          operations (initdb, pg_ctl, createdb, pg_restore,
#                          psql) are delegated to. Suggested/typical value:
#                          postgres. Must exist on this host, must not be
#                          "root", and must not resolve to UID 0. There is no
#                          implicit default applied for a root invocation —
#                          it must be set explicitly by the operator/caller.
#                          Ignored (no delegation, no requirement to be set)
#                          when this script is not running as root.
#   PG_BINDIR              Optional explicit path to initdb/pg_ctl/psql/etc.
#                          (default: resolved from PATH, falling back to
#                          /usr/lib/postgresql/<matching-major>/bin)

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/root/noramedi-backups}"
BACKUP_FILENAME_RE='^noramedi_crm-[0-9]{8}-[0-9]{6}\.dump$'
PROD_PG_PORT="${PROD_PG_PORT:-5432}"
REHEARSAL_PORT=55432
REHEARSAL_MIN_FREE_RAM_MB="${REHEARSAL_MIN_FREE_RAM_MB:-2048}"
REHEARSAL_RAM_MULTIPLIER="${REHEARSAL_RAM_MULTIPLIER:-3}"
REHEARSAL_SHM_MARGIN_PCT="${REHEARSAL_SHM_MARGIN_PCT:-20}"
BACKUP_FILE_ARG=""
KEEP_ON_FAILURE=false
PG_BINDIR="${PG_BINDIR:-}"

# Delegation state — initialized to safe "no delegation" defaults up front so
# that `set -u` and an early cleanup() invocation never see an unset variable,
# regardless of how early a fail() might fire.
DELEGATE=false
REHEARSAL_OS_USER_WAS_SET=false
if [[ -n "${REHEARSAL_OS_USER+x}" ]]; then
  REHEARSAL_OS_USER_WAS_SET=true
fi
REHEARSAL_OS_USER="${REHEARSAL_OS_USER:-}"
REHEARSAL_OS_UID=""
REHEARSAL_OS_GID=""
SU_TOOL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file) BACKUP_FILE_ARG="$2"; shift 2 ;;
    --port) REHEARSAL_PORT="$2"; shift 2 ;;
    --keep-on-failure) KEEP_ON_FAILURE=true; shift ;;
    -h|--help) sed -n '2,81p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
REHEARSAL_ROOT="/dev/shm/noramedi-rehearsal-${RUN_ID}"
PGDATA="${REHEARSAL_ROOT}/pgdata"
DUMP_COPY="${REHEARSAL_ROOT}/restore.dump"
LOG_PREFIX="[restore-rehearsal ${RUN_ID}]"
REHEARSAL_DB="noramedi_rehearsal"
REHEARSAL_ROLE="rehearsal_admin"
CLUSTER_STARTED=false
ABORTED=false

log()  { echo "${LOG_PREFIX} $*"; }
fail() {
  echo "${LOG_PREFIX} ABORT: $*" >&2
  ABORTED=true
  exit 1
}

# ── Hard guards (never allowed regardless of arguments) ─────────────────────
if [[ "$REHEARSAL_PORT" == "$PROD_PG_PORT" ]]; then
  fail "REHEARSAL_PORT ($REHEARSAL_PORT) must not equal PROD_PG_PORT ($PROD_PG_PORT)."
fi
if [[ "$REHEARSAL_DB" == "noramedi_crm" ]]; then
  fail "Refusing to use the production database name for the rehearsal target."
fi

# ── build_cmd / as_rehearsal_user — shared privilege-delegation helpers ────
# build_cmd assembles a shell-safe, space-separated command string from an
# argv array (each element individually %q-escaped) suitable for passing to
# as_rehearsal_user. Multi-statement snippets can also be built by hand as
# plain (unquoted-heredoc) multi-line strings, since script-controlled paths
# here (RUN_ID-derived, no user input) never contain characters that need
# escaping in that context.
build_cmd() {
  local out=() a
  for a in "$@"; do
    out+=("$(printf '%q' "$a")")
  done
  printf '%s' "${out[*]}"
}

# as_rehearsal_user executes its single string argument as a bash command.
# When DELEGATE is true (always true for a root invocation, never true
# otherwise — see the ROOT / DELEGATION SETUP section) it runs under the
# unprivileged REHEARSAL_OS_USER via runuser/su; otherwise it runs directly
# as the invoking user, identical to this script's pre-delegation behavior.
as_rehearsal_user() {
  local snippet="$1"
  if [[ "$DELEGATE" == true ]]; then
    if [[ "$SU_TOOL" == "runuser" ]]; then
      runuser -u "$REHEARSAL_OS_USER" -- /bin/bash -c "$snippet"
    else
      su -s /bin/bash "$REHEARSAL_OS_USER" -c "$snippet"
    fi
  else
    /bin/bash -c "$snippet"
  fi
}

cleanup() {
  local exit_code=$?
  if [[ "$CLUSTER_STARTED" == true ]]; then
    log "Stopping disposable cluster$( [[ "$DELEGATE" == true ]] && echo " (as OS user $REHEARSAL_OS_USER)" )..."
    STOP_CMD="$(build_cmd "${PG_BINDIR}/pg_ctl" -D "$PGDATA" -m fast stop)"
    as_rehearsal_user "$STOP_CMD" >/dev/null 2>&1 || true
  fi
  if [[ "$ABORTED" == true && "$KEEP_ON_FAILURE" == true ]]; then
    log "KEEP_ON_FAILURE set — leaving $REHEARSAL_ROOT in place for inspection. Remove it manually when done: rm -rf '$REHEARSAL_ROOT'"
  else
    # Final cleanup: remove every staged file/dir under the RAM-backed root.
    # /dev/shm itself is a shared, host-wide tmpfs mount and is deliberately
    # never unmounted here — only this run's own subdirectory is removed.
    # Because it was tmpfs, this releases RAM pages rather than shredding a
    # disk copy, so nothing persists on any block device either way.
    if [[ -d "$REHEARSAL_ROOT" ]]; then
      rm -rf "$REHEARSAL_ROOT"
      log "Removed disposable RAM-backed directory $REHEARSAL_ROOT"
    fi
  fi
  if [[ $exit_code -ne 0 ]]; then
    log "Rehearsal ended with FAILURE (exit $exit_code). No success should be recorded in evidence."
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ═════════════════════════════════════════════════════════════════════════
# ROOT / DELEGATION SETUP
# ═════════════════════════════════════════════════════════════════════════
RUNNING_AS_ROOT=false
if [[ "$EUID" -eq 0 ]]; then
  RUNNING_AS_ROOT=true
fi

if [[ "$RUNNING_AS_ROOT" == true ]]; then
  if [[ "$REHEARSAL_OS_USER_WAS_SET" != true || -z "$REHEARSAL_OS_USER" ]]; then
    fail "Running as root (EUID 0): REHEARSAL_OS_USER must be set explicitly to the unprivileged OS user PostgreSQL operations will be delegated to (e.g. REHEARSAL_OS_USER=postgres). Refusing to fall back to an implicit default for a root invocation. No staging has occurred; nothing to clean up."
  fi
  if [[ "$REHEARSAL_OS_USER" == "root" ]]; then
    fail "REHEARSAL_OS_USER=root is not permitted. PostgreSQL operations must never be delegated to root."
  fi
  REHEARSAL_OS_UID="$(id -u "$REHEARSAL_OS_USER" 2>/dev/null || true)"
  REHEARSAL_OS_GID="$(id -g "$REHEARSAL_OS_USER" 2>/dev/null || true)"
  if [[ -z "$REHEARSAL_OS_UID" || -z "$REHEARSAL_OS_GID" ]]; then
    fail "Could not resolve a UID/GID for REHEARSAL_OS_USER='$REHEARSAL_OS_USER' via 'id'. Ensure the user exists on this host before rehearsing."
  fi
  if [[ "$REHEARSAL_OS_UID" -eq 0 ]]; then
    fail "REHEARSAL_OS_USER='$REHEARSAL_OS_USER' resolves to UID 0 (root-equivalent). Refusing to delegate PostgreSQL operations to a root-equivalent account."
  fi
  if command -v runuser >/dev/null 2>&1; then
    SU_TOOL="runuser"
  elif command -v su >/dev/null 2>&1; then
    SU_TOOL="su"
  else
    fail "Neither 'runuser' nor 'su' is available on this host to delegate PostgreSQL operations to REHEARSAL_OS_USER='$REHEARSAL_OS_USER'."
  fi
  DELEGATE=true
  log "Running as root: PostgreSQL operations (initdb, pg_ctl, createdb, pg_restore, psql) will be delegated to OS user '$REHEARSAL_OS_USER' (uid=$REHEARSAL_OS_UID gid=$REHEARSAL_OS_GID) via $SU_TOOL. Only reading the source backup and staging/final cleanup of the RAM-backed root are performed directly as root."
else
  DELEGATE=false
  log "Not running as root — running PostgreSQL operations directly as the invoking user ($(id -un)). REHEARSAL_OS_USER is not required outside of a root invocation."
fi

# ── Resolve Postgres client binaries ────────────────────────────────────────
if [[ -z "$PG_BINDIR" ]]; then
  if command -v initdb >/dev/null 2>&1; then
    PG_BINDIR="$(dirname "$(command -v initdb)")"
  else
    for d in /usr/lib/postgresql/*/bin; do
      [[ -x "$d/initdb" ]] && PG_BINDIR="$d" && break
    done
  fi
fi
[[ -n "$PG_BINDIR" && -x "${PG_BINDIR}/initdb" ]] || fail "Could not locate initdb (set PG_BINDIR explicitly)."
log "Using Postgres binaries from: $PG_BINDIR"

if [[ "$DELEGATE" == true ]]; then
  for bin in initdb pg_ctl createdb pg_restore psql; do
    BIN_PATH_Q="$(printf '%q' "${PG_BINDIR}/${bin}")"
    if ! as_rehearsal_user "test -x $BIN_PATH_Q"; then
      fail "PostgreSQL binary ${PG_BINDIR}/${bin} is not accessible/executable by REHEARSAL_OS_USER='$REHEARSAL_OS_USER'. Fix binary permissions or choose a different REHEARSAL_OS_USER before rehearsing."
    fi
  done
  log "Confirmed all required PostgreSQL binaries in $PG_BINDIR are executable by REHEARSAL_OS_USER='$REHEARSAL_OS_USER'."
fi

# ═════════════════════════════════════════════════════════════════════════
# PREFLIGHT CHECKS — every check must pass before anything is created
# ═════════════════════════════════════════════════════════════════════════
log "=== Preflight ==="

# 1. Source backup exists
[[ -d "$BACKUP_DIR" ]] || fail "BACKUP_DIR does not exist or is not readable: $BACKUP_DIR"

if [[ -n "$BACKUP_FILE_ARG" ]]; then
  [[ "$BACKUP_FILE_ARG" =~ $BACKUP_FILENAME_RE ]] || fail "Backup filename does not match expected pattern: $BACKUP_FILE_ARG"
  SOURCE_DUMP="${BACKUP_DIR}/${BACKUP_FILE_ARG}"
  [[ -f "$SOURCE_DUMP" ]] || fail "Requested backup file not found: $SOURCE_DUMP"
else
  SOURCE_DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'noramedi_crm-*.dump' -printf '%T@ %p\n' \
    | sort -rn | head -n1 | cut -d' ' -f2-)"
  [[ -n "$SOURCE_DUMP" ]] || fail "No backup files matching noramedi_crm-*.dump found in $BACKUP_DIR"
fi
log "Source backup: $(basename "$SOURCE_DUMP")"

DUMP_SIZE_BYTES=$(stat -c%s "$SOURCE_DUMP")
[[ "$DUMP_SIZE_BYTES" -gt 0 ]] || fail "Source backup file is zero bytes: $SOURCE_DUMP"
log "Source backup size: ${DUMP_SIZE_BYTES} bytes"

# 2. Checksum (recorded now, re-verified after copy in the restore section)
SOURCE_SHA256="$(sha256sum "$SOURCE_DUMP" | cut -d' ' -f1)"
log "Source SHA-256: $SOURCE_SHA256"

# 3. Encryption status of the artifact itself
#    pg_dump custom-format files begin with the 5-byte magic "PGDMP" and are
#    NOT separately encrypted at the file level. Anything else is reported,
#    not assumed, and pg_restore will fail cleanly on it in the restore step.
MAGIC="$(head -c5 "$SOURCE_DUMP" | tr -d '\0')"
if [[ "$MAGIC" == "PGDMP" ]]; then
  ENCRYPTION_STATUS="NOT_ENCRYPTED_AT_FILE_LEVEL (pg_dump custom format, PGDMP magic header)"
else
  ENCRYPTION_STATUS="UNKNOWN_FORMAT (magic bytes: ${MAGIC:-<unreadable>}) — restore step will confirm or fail"
fi
log "Encryption status: $ENCRYPTION_STATUS"

# 4. PostgreSQL version compatibility
DUMP_HEADER="$("${PG_BINDIR}/pg_restore" -l "$SOURCE_DUMP" 2>/dev/null | head -n5 || true)"
DUMP_PG_VERSION_LINE="$(echo "$DUMP_HEADER" | grep -i 'Dumped from database version' || true)"
LOCAL_PG_VERSION="$("${PG_BINDIR}/pg_ctl" --version | awk '{print $NF}')"
log "Local disposable Postgres version: $LOCAL_PG_VERSION"

if [[ -n "$DUMP_PG_VERSION_LINE" ]]; then
  DUMP_MAJOR="$(echo "$DUMP_PG_VERSION_LINE" | grep -oE '[0-9]+' | head -n1)"
  LOCAL_MAJOR="$(echo "$LOCAL_PG_VERSION" | grep -oE '^[0-9]+')"
  # Evidence string: everything after the "...version:" label, trimmed. Built
  # with a single parameter expansion (no hand-assembled parens) specifically
  # to avoid a stray trailing character creeping into this field.
  SOURCE_PG_VERSION_EVIDENCE="$(echo "$DUMP_PG_VERSION_LINE" | sed -E 's/^;?[[:space:]]*Dumped from database version:?[[:space:]]*//I')"
  SOURCE_PG_VERSION_RELIABLE=true
  log "Dump header: ${DUMP_PG_VERSION_LINE}"
  if [[ -n "$DUMP_MAJOR" && -n "$LOCAL_MAJOR" && "$DUMP_MAJOR" != "$LOCAL_MAJOR" ]]; then
    fail "Postgres major version mismatch: dump was produced by major $DUMP_MAJOR, disposable cluster is major $LOCAL_MAJOR. Install matching major before rehearsing."
  fi
else
  SOURCE_PG_VERSION_EVIDENCE="UNKNOWN"
  SOURCE_PG_VERSION_RELIABLE=false
  log "WARNING: source Postgres version could not be reliably derived from pg_restore -l output; proceeding, restore step is the authoritative compatibility check. This is recorded as UNKNOWN in the evidence summary below — not guessed, not omitted."
fi

# 5. Free system RAM (restore target is tmpfs, i.e. RAM — must not starve production)
REQUIRED_MB=$(( (DUMP_SIZE_BYTES / 1024 / 1024) * REHEARSAL_RAM_MULTIPLIER ))
[[ "$REQUIRED_MB" -lt 512 ]] && REQUIRED_MB=512
AVAILABLE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
log "Estimated RAM needed for restore: ${REQUIRED_MB} MB; currently available: ${AVAILABLE_MB} MB; required headroom after use: ${REHEARSAL_MIN_FREE_RAM_MB} MB"
if (( AVAILABLE_MB - REQUIRED_MB < REHEARSAL_MIN_FREE_RAM_MB )); then
  fail "Insufficient free RAM to safely run this rehearsal without risking production memory pressure on this shared host. Available=${AVAILABLE_MB}MB, needed=${REQUIRED_MB}MB, required headroom=${REHEARSAL_MIN_FREE_RAM_MB}MB."
fi

# 6. /dev/shm capacity — distinct from overall system RAM above: /dev/shm is
#    frequently mounted with its own size cap (e.g. 50% of RAM, or smaller).
#    Must cover BOTH the staged dump copy AND the estimated on-disk (tmpfs)
#    footprint of the restored cluster — not the dump file alone — and must
#    leave REHEARSAL_SHM_MARGIN_PCT of currently-available capacity unused.
SHM_MOUNT="$(dirname "$REHEARSAL_ROOT")"
SHM_AVAILABLE_MB=$(df -Pm "$SHM_MOUNT" | awk 'NR==2 {print $4}')
DUMP_COPY_MB=$(( (DUMP_SIZE_BYTES / 1024 / 1024) + 1 ))
ESTIMATED_RESTORE_FOOTPRINT_MB=$(( DUMP_COPY_MB * REHEARSAL_RAM_MULTIPLIER ))
REQUIRED_SHM_MB=$(( DUMP_COPY_MB + ESTIMATED_RESTORE_FOOTPRINT_MB ))
USABLE_SHM_MB=$(( SHM_AVAILABLE_MB * (100 - REHEARSAL_SHM_MARGIN_PCT) / 100 ))
log "${SHM_MOUNT} available: ${SHM_AVAILABLE_MB} MB; required = dump copy (${DUMP_COPY_MB} MB) + estimated restored-cluster footprint (${ESTIMATED_RESTORE_FOOTPRINT_MB} MB) = ${REQUIRED_SHM_MB} MB; usable after ${REHEARSAL_SHM_MARGIN_PCT}% safety margin: ${USABLE_SHM_MB} MB"
if (( REQUIRED_SHM_MB > USABLE_SHM_MB )); then
  fail "Insufficient ${SHM_MOUNT} capacity for this rehearsal: need ~${REQUIRED_SHM_MB}MB (dump copy + estimated restored-cluster footprint) but only ${USABLE_SHM_MB}MB usable after reserving a ${REHEARSAL_SHM_MARGIN_PCT}% safety margin of the ${SHM_AVAILABLE_MB}MB currently available on ${SHM_MOUNT}. Free space there, reduce REHEARSAL_RAM_MULTIPLIER's implied footprint, or grow the tmpfs mount before retrying."
fi

# 7. Free disk (defensive only — PGDATA itself is tmpfs, but logs/temp files
#    outside /dev/shm should not fill the root filesystem)
ROOT_FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
[[ "$ROOT_FREE_MB" -gt 512 ]] || fail "Less than 512MB free on / — aborting defensively (root filesystem is not the restore target, but logging/tooling needs headroom)."

# 8. Isolated target name/port — port must be free and loopback-only
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${REHEARSAL_PORT}\$"; then
  fail "Port $REHEARSAL_PORT is already in use on this host. Pick a different --port."
fi
mkdir -p "$REHEARSAL_ROOT"
chmod 700 "$REHEARSAL_ROOT"
if [[ "$DELEGATE" == true ]]; then
  chown "${REHEARSAL_OS_UID}:${REHEARSAL_OS_GID}" "$REHEARSAL_ROOT"
fi
log "Disposable RAM-backed root: $REHEARSAL_ROOT (mode 700$( [[ "$DELEGATE" == true ]] && echo ", owned by uid:gid ${REHEARSAL_OS_UID}:${REHEARSAL_OS_GID} [$REHEARSAL_OS_USER]" ))"

log "=== Preflight PASSED ==="

# ═════════════════════════════════════════════════════════════════════════
# RESTORE — into the disposable cluster only
# ═════════════════════════════════════════════════════════════════════════
log "=== Restore ==="
RESTORE_START_EPOCH=$(date +%s)

cp "$SOURCE_DUMP" "$DUMP_COPY"
chmod 600 "$DUMP_COPY"
if [[ "$DELEGATE" == true ]]; then
  chown "${REHEARSAL_OS_UID}:${REHEARSAL_OS_GID}" "$DUMP_COPY"
fi
COPY_SHA256="$(sha256sum "$DUMP_COPY" | cut -d' ' -f1)"
[[ "$COPY_SHA256" == "$SOURCE_SHA256" ]] || fail "Checksum mismatch after copying dump into RAM-backed working directory. Source=$SOURCE_SHA256 Copy=$COPY_SHA256"
log "Post-copy checksum verified: $COPY_SHA256 (staged copy mode 600$( [[ "$DELEGATE" == true ]] && echo ", owned by uid:gid ${REHEARSAL_OS_UID}:${REHEARSAL_OS_GID}" ))"

if [[ "$DELEGATE" == true ]]; then
  DIR_OWNER="$(stat -c '%u' "$REHEARSAL_ROOT")"
  DIR_MODE="$(stat -c '%a' "$REHEARSAL_ROOT")"
  FILE_OWNER="$(stat -c '%u' "$DUMP_COPY")"
  FILE_MODE="$(stat -c '%a' "$DUMP_COPY")"
  if [[ "$DIR_OWNER" != "$REHEARSAL_OS_UID" || "$DIR_MODE" != "700" ]]; then
    fail "Staged rehearsal directory ownership/permissions are unsafe: owner uid=$DIR_OWNER mode=$DIR_MODE (expected owner uid=$REHEARSAL_OS_UID mode=700). Refusing to proceed."
  fi
  if [[ "$FILE_OWNER" != "$REHEARSAL_OS_UID" || "$FILE_MODE" != "600" ]]; then
    fail "Staged dump file ownership/permissions are unsafe: owner uid=$FILE_OWNER mode=$FILE_MODE (expected owner uid=$REHEARSAL_OS_UID mode=600). Refusing to proceed."
  fi
  log "Verified staged directory (700) and dump copy (600) are owned by REHEARSAL_OS_USER='$REHEARSAL_OS_USER' (uid $REHEARSAL_OS_UID)."
fi

# Credentials: a random password is generated once and written to two
# tmpfs-only, mode-600 files — never exported as a PGPASSWORD environment
# variable, so it never has to survive privilege-dropping via su/runuser
# environment propagation (which is not guaranteed) and is never visible in
# any process's environment listing.
#   pwfile — raw password, one line, consumed once by `initdb --pwfile`.
#   pgpass — libpq ".pgpass" format, consumed by every client tool below via
#            PGPASSFILE so no interactive password prompt is ever possible.
REHEARSAL_PWFILE="${REHEARSAL_ROOT}/pwfile"
REHEARSAL_PGPASS="${REHEARSAL_ROOT}/pgpass"
if command -v openssl >/dev/null 2>&1; then
  REHEARSAL_PASSWORD="$(openssl rand -base64 24)"
else
  REHEARSAL_PASSWORD="$(head -c32 /dev/urandom | base64)"
fi
printf '%s\n' "$REHEARSAL_PASSWORD" > "$REHEARSAL_PWFILE"
printf '127.0.0.1:%s:*:%s:%s\n' "$REHEARSAL_PORT" "$REHEARSAL_ROLE" "$REHEARSAL_PASSWORD" > "$REHEARSAL_PGPASS"
unset REHEARSAL_PASSWORD
chmod 600 "$REHEARSAL_PWFILE" "$REHEARSAL_PGPASS"
if [[ "$DELEGATE" == true ]]; then
  chown "${REHEARSAL_OS_UID}:${REHEARSAL_OS_GID}" "$REHEARSAL_PWFILE" "$REHEARSAL_PGPASS"
fi
PGPASS_EXPORT="export PGPASSFILE=$(printf '%q' "$REHEARSAL_PGPASS")"

INITDB_CMD="$(build_cmd "${PG_BINDIR}/initdb" -D "$PGDATA" --auth=scram-sha-256 --username="$REHEARSAL_ROLE" --pwfile="$REHEARSAL_PWFILE")"
as_rehearsal_user "$INITDB_CMD >/dev/null"
log "Initialized disposable cluster (tmpfs-backed PGDATA)$( [[ "$DELEGATE" == true ]] && echo ", initdb run as OS user $REHEARSAL_OS_USER" )"

CONFIG_SNIPPET="printf '%s\n' \"listen_addresses = '127.0.0.1'\" >> $(printf '%q' "$PGDATA/postgresql.conf")
printf '%s\n' \"port = ${REHEARSAL_PORT}\" >> $(printf '%q' "$PGDATA/postgresql.conf")
printf '%s\n' \"unix_socket_directories = '${PGDATA}'\" >> $(printf '%q' "$PGDATA/postgresql.conf")"
as_rehearsal_user "$CONFIG_SNIPPET"

START_CMD="$(build_cmd "${PG_BINDIR}/pg_ctl" -D "$PGDATA" -l "${PGDATA}/rehearsal-postgres.log" -w start)"
as_rehearsal_user "$START_CMD >/dev/null"
CLUSTER_STARTED=true
log "Disposable cluster started$( [[ "$DELEGATE" == true ]] && echo " (as OS user $REHEARSAL_OS_USER)" ), intended to listen on 127.0.0.1:${REHEARSAL_PORT} only"

# Runtime (not just config-file) verification that the cluster is actually
# loopback-only. Refuses to proceed to restore if it is not.
if command -v ss >/dev/null 2>&1; then
  LISTEN_ADDRS="$(ss -ltn 2>/dev/null | awk -v p=":${REHEARSAL_PORT}\$" '$4 ~ p {print $4}')"
  [[ -n "$LISTEN_ADDRS" ]] || fail "Could not confirm the disposable cluster is listening on port ${REHEARSAL_PORT} at all after start."
  while IFS= read -r addr; do
    if [[ "$addr" != "127.0.0.1:${REHEARSAL_PORT}" && "$addr" != "[::1]:${REHEARSAL_PORT}" ]]; then
      fail "Disposable cluster is listening on a non-loopback address ($addr). Refusing to proceed with restore — this cluster must bind only to 127.0.0.1."
    fi
  done <<< "$LISTEN_ADDRS"
  log "Confirmed disposable cluster binds only to loopback (127.0.0.1:${REHEARSAL_PORT})."
else
  log "WARNING: 'ss' not available — could not runtime-verify the disposable cluster is loopback-only. Relying on postgresql.conf's listen_addresses='127.0.0.1' setting alone."
fi

PSQL_ARGS=(-h 127.0.0.1 -p "$REHEARSAL_PORT" -U "$REHEARSAL_ROLE")

CREATEDB_CMD="$(build_cmd "${PG_BINDIR}/createdb" "${PSQL_ARGS[@]}" "$REHEARSAL_DB")"
as_rehearsal_user "$PGPASS_EXPORT
$CREATEDB_CMD"
log "Created disposable database: $REHEARSAL_DB"

PG_RESTORE_STDERR="${REHEARSAL_ROOT}/pg_restore.stderr"
PG_RESTORE_CMD="$(build_cmd "${PG_BINDIR}/pg_restore" "${PSQL_ARGS[@]}" -d "$REHEARSAL_DB" --no-privileges --no-owner "$DUMP_COPY")"
if ! as_rehearsal_user "$PGPASS_EXPORT
$PG_RESTORE_CMD 2> $(printf '%q' "$PG_RESTORE_STDERR")"; then
  log "pg_restore reported errors (last 20 lines, no row data expected in this stream):"
  tail -n20 "$PG_RESTORE_STDERR" >&2 || true
  fail "pg_restore did not complete cleanly. See stderr above. Not recording a successful rehearsal."
fi
RESTORE_END_EPOCH=$(date +%s)
RESTORE_DURATION_S=$(( RESTORE_END_EPOCH - RESTORE_START_EPOCH ))
log "Restore completed in ${RESTORE_DURATION_S}s (this is the measured RTO for this run)"

# ═════════════════════════════════════════════════════════════════════════
# VERIFICATION — counts, booleans, and hashes ONLY. Never row contents.
# ═════════════════════════════════════════════════════════════════════════
log "=== Verification (counts/booleans only — no patient data is printed) ==="

q() {
  local sql="$1" cmd
  cmd="$(build_cmd "${PG_BINDIR}/psql" "${PSQL_ARGS[@]}" -d "$REHEARSAL_DB" -t -A -c "$sql")"
  as_rehearsal_user "$PGPASS_EXPORT
$cmd"
}

TABLE_COUNT=$(q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
log "Base table count: $TABLE_COUNT"

MIGRATIONS_COUNT=$(q "SELECT COUNT(*) FROM \"_prisma_migrations\";" 2>/dev/null || echo "N/A")
log "_prisma_migrations row count: $MIGRATIONS_COUNT"

PLATFORM_ADMIN_COUNT=$(q "SELECT COUNT(*) FROM \"PlatformAdmin\";" 2>/dev/null || echo "N/A")
PLAN_COUNT=$(q "SELECT COUNT(*) FROM \"Plan\";" 2>/dev/null || echo "N/A")
log "PlatformAdmin count: $PLATFORM_ADMIN_COUNT | Plan count: $PLAN_COUNT"

# Foreign-key integrity spot checks — pass/fail booleans only, no IDs printed beyond counts.
ORPHAN_APPOINTMENTS=$(q "SELECT COUNT(*) FROM \"Appointment\" a LEFT JOIN \"Patient\" p ON a.\"patientId\" = p.id WHERE p.id IS NULL;" 2>/dev/null || echo "N/A")
ORPHAN_TREATMENTS=$(q "SELECT COUNT(*) FROM \"Treatment\" t LEFT JOIN \"Appointment\" a ON t.\"appointmentId\" = a.id WHERE t.\"appointmentId\" IS NOT NULL AND a.id IS NULL;" 2>/dev/null || echo "N/A")
log "Orphaned Appointment->Patient rows: $ORPHAN_APPOINTMENTS (expect 0)"
log "Orphaned Treatment->Appointment rows: $ORPHAN_TREATMENTS (expect 0)"

ATTACHMENT_ROW_COUNT=$(q "SELECT COUNT(*) FROM \"PatientAttachment\";" 2>/dev/null || echo "N/A")
IMAGING_ROW_COUNT=$(q "SELECT COUNT(*) FROM \"ImagingImage\";" 2>/dev/null || echo "N/A")
log "PatientAttachment row count (file-tree NOT restored — DB rows only): $ATTACHMENT_ROW_COUNT"
log "ImagingImage row count (file-tree NOT restored — DB rows only): $IMAGING_ROW_COUNT"
log "NOTE: compare the two counts above against a separately-obtained production count to quantify (not fix) the known DB/file-tree gap. Do not paste production query output containing anything beyond a count into evidence."

log "=== Verification complete ==="

# ═════════════════════════════════════════════════════════════════════════
# SUMMARY — this block is what should be copied into the evidence file
# ═════════════════════════════════════════════════════════════════════════
cat <<SUMMARY

${LOG_PREFIX} ===== EVIDENCE SUMMARY (safe to copy verbatim — no PII) =====
run_id: ${RUN_ID}
backup_file: $(basename "$SOURCE_DUMP")
backup_size_bytes: ${DUMP_SIZE_BYTES}
backup_sha256: ${SOURCE_SHA256}
encryption_status: ${ENCRYPTION_STATUS}
source_pg_version_evidence: ${SOURCE_PG_VERSION_EVIDENCE}
source_pg_version_reliable: ${SOURCE_PG_VERSION_RELIABLE}
disposable_pg_version: ${LOCAL_PG_VERSION}
restore_duration_seconds: ${RESTORE_DURATION_S}
table_count: ${TABLE_COUNT}
migrations_row_count: ${MIGRATIONS_COUNT}
platform_admin_count: ${PLATFORM_ADMIN_COUNT}
plan_count: ${PLAN_COUNT}
orphaned_appointment_rows: ${ORPHAN_APPOINTMENTS}
orphaned_treatment_rows: ${ORPHAN_TREATMENTS}
patient_attachment_row_count: ${ATTACHMENT_ROW_COUNT}
imaging_image_row_count: ${IMAGING_ROW_COUNT}
result: PASS
${LOG_PREFIX} ===============================================================

SUMMARY

log "Rehearsal succeeded. Cleanup will now run automatically (trap on EXIT)."
exit 0

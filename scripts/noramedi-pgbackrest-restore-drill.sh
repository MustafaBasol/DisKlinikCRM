#!/usr/bin/env bash
# noramedi-pgbackrest-restore-drill.sh — F4-FCR-002 / hardened for F4-FCR-002A
# Deploy to: /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh
# chmod +x /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh
#
# Restores a pgBackRest backup — optionally to an arbitrary point in time —
# into a DISPOSABLE, RAM-BACKED, SOCKET-ONLY PostgreSQL cluster, runs
# structural, application-level and tenant-isolation smoke checks against it,
# measures effective RPO and RTO against explicit program targets, and destroys
# it with a verified, fail-closed teardown.
#
# This is the only thing that can produce R-032 evidence. `pgbackrest verify`
# checks repository integrity; it is NOT a restore test and must never be
# reported as one. And unlike scripts/backup-restore-rehearsal.sh (which
# restores a pg_dump artifact), this proves recovery TO AN ARBITRARY INSTANT,
# which is the capability R-031 is about.
#
# ═════════════════════════════════════════════════════════════════════════
# ⚠ WHAT THIS SCRIPT REFUSES TO DO
#
#   - restore into the production data directory (checked against the live
#     `SHOW data_directory`, and REFUSING TO RUN AT ALL if it cannot determine
#     what production's data directory is — the guard never fails open)
#   - accept ANY TCP connection: the disposable cluster is started with
#     listen_addresses='' and its pg_hba.conf contains NO `host` line, so
#     there is no TCP listener to reach and no TCP rule that could authorise
#     one. Verified at RUNTIME after start, not merely configured.
#   - accept `trust` authentication anywhere. The only accepted client is the
#     drill OS user itself, over a mode-0700 unix socket, authenticated by
#     `peer` (kernel-verified UID) through an explicit pg_ident map.
#   - listen on the production PostgreSQL port
#   - create or touch a database named noramedi_crm on the production cluster
#   - run any PostgreSQL operation as root or as any UID 0 account
#   - write restored patient bytes to persistent disk (the drill root must be
#     on tmpfs; verified, not assumed)
#   - leave a started postmaster or a populated drill root behind: cleanup is
#     verified at every step and a cleanup failure is a non-zero, loud,
#     incident-raising outcome — never a silent `rm -rf ... || true`
#
# A physical PostgreSQL backup is CLUSTER-WIDE and therefore CROSS-TENANT:
# it contains every clinic's patients, appointments, imaging metadata,
# attachments, audit log and financial records, in cleartext — no column-level
# encryption of patient data exists anywhere in the schema. There is no
# per-tenant restore. Restoring one of these into any environment other than a
# disposable cluster like this one is a disclosure of every tenant's
# special-category health data to everyone with access to that environment.
# ═════════════════════════════════════════════════════════════════════════
#
# ── WHY SOCKET-ONLY + peer INSTEAD OF SCRAM OVER LOOPBACK ────────────────
# The superseded version of this script synthesised `host all all 127.0.0.1/32
# trust`, which let ANY local account on the host read every tenant's patient
# rows for the lifetime of the drill. The obvious repair is the sibling
# rehearsal's pattern — a random SCRAM password in a mode-600 PGPASSFILE — but
# that pattern is not directly transplantable here and is not the strongest
# option available:
#
#   - backup-restore-rehearsal.sh runs `initdb --auth=scram-sha-256
#     --pwfile=...`, so it OWNS the role it authenticates as. A PHYSICAL
#     restore does not: the restored cluster arrives with production's roles
#     and production's password hashes, which this script does not know and
#     must not attempt to change before it has proven the restore is intact.
#   - A SCRAM secret still has to exist somewhere — a pgpass file, an
#     environment, a connection URI — and a loopback TCP port is still a port
#     any local process may connect to and attack.
#
# Removing the TCP surface entirely is strictly stronger than protecting it:
# there is no listener, so there is nothing to authenticate to, guess at, or
# race. The remaining unix socket lives in a mode-0700 directory owned by the
# drill user, and `peer` authenticates by kernel-verified UID, which cannot be
# stolen, logged, or replayed the way a password can. Both properties are
# asserted at runtime before the first query touches patient data.
#
# Usage:
#   noramedi-pgbackrest-restore-drill.sh [--target "YYYY-MM-DD HH:MM:SS+03"]
#                                        [--set BACKUP_LABEL] [--repo N]
#                                        [--stanza NAME] [--port PORT]
#                                        [--result-file PATH] [--record]
#                                        [--keep-on-failure]
#                                        [--allow-missing-app-smoke] [-h|--help]
#
# Options:
#   --target TS       PITR target timestamp, fractional seconds allowed. Omit
#                     to restore the latest backup with no recovery target.
#                     An explicit UTC offset is MANDATORY with --pitr-run-id:
#                     a bare target resolves in the drill cluster's timezone
#                     while the markers it is checked against were written in
#                     production's, and the mismatch stops the recovery hours
#                     from the intended point without erroring.
#   --set LABEL       Restore a specific backup label instead of the latest.
#   --repo N          Repository to restore FROM (1 = local, 2 = off-host).
#                     Default 1. Restoring from repo 2 is the ONLY thing that
#                     can prove off-host recoverability — see --record.
#   --port PORT       Scratch port. Default 55433 (backup-restore-rehearsal.sh
#                     already uses 55432; they must not collide). With
#                     listen_addresses='' this names the unix socket file
#                     (.s.PGSQL.<port>) rather than a TCP port, but it is
#                     still checked for collisions and still asserted unbound.
#   --result-file P   Where to write the machine-readable result JSON.
#                     Default /var/lib/noramedi/pitr-drill-result.json
#   --pitr-run-id ID  Verify the recovery STOP POINT against the controlled
#                     marker pair written to production under this run id
#                     before the restore (see the F4-FCR-002A runbook).
#                     Requires --target. Asserts marker A present (exactly 1)
#                     and marker B absent (exactly 0) in the RESTORED cluster,
#                     and that the replay point is at or before --target.
#                     WITHOUT it a --target run is recorded as `not_verified`
#                     and can never be R-031/R-032 evidence: passing --target
#                     to pgbackrest proves a restore ran, not that recovery
#                     stopped where it was told to.
#   --marker-seg SEG  WAL segment that carried the marker pair, recorded as
#                     evidence in the result document (24 hex characters).
#   --marker-b-at TS  Marker B's production timestamp. It does not exist in a
#                     correctly stopped restore, so it cannot be measured
#                     there — it is recorded from the marker procedure so the
#                     target window can be re-derived from the artifact alone.
#                     Marker timestamps read out of OperationalEvent are UTC;
#                     see the timezone rule at the verification block below.
#   --record          After a PASS, additionally write the off-host proof
#                     marker (only meaningful with --repo 2). This marker is
#                     what upgrades the reported off-host state from
#                     "unproven" to "yes" — configuration alone never does.
#                     Refused unless the run is R-032 eligible (see below).
#   --keep-on-failure Leave the scratch cluster for post-mortem. It contains
#                     REAL PATIENT DATA; delete it manually and promptly.
#   --allow-missing-app-smoke
#                     Run WITHOUT the application and tenant smoke stages.
#                     The run can then never be R-032 evidence: the result
#                     document is stamped r032Eligible=false and --record is
#                     refused. This exists so a repository/infrastructure
#                     problem can still be triaged, NOT as a normal mode.
#
# Environment:
#   REHEARSAL_OS_USER   REQUIRED when invoked as root. No implicit default:
#                       silently picking `postgres` would be a privilege
#                       decision made by a script instead of an operator.
#   NORAMEDI_APP_SERVER_DIR  REQUIRED unless --allow-missing-app-smoke. The
#                       deployed server directory (the one containing
#                       package.json, prisma/migrations and node_modules).
#                       Both the application smoke and the migration-set
#                       comparison read the DEPLOYED RELEASE from here — that
#                       is what makes "compatible with the running code" a
#                       measurement instead of an assumption.
#   NORAMEDI_PGBACKREST_DRILL_ROOT   default /dev/shm/noramedi-pitr-drill
#   NORAMEDI_PITR_DRILL_RESULT_FILE  default /var/lib/noramedi/pitr-drill-result.json
#   NORAMEDI_PGBACKREST_OFFHOST_PROOF default /var/lib/noramedi/pitr-offhost-proof.json
#   NORAMEDI_PG_SUPERUSER            default postgres
#   PROD_PG_PORT                     default 5432
#   PG_BINDIR                        auto-detected
#   NORAMEDI_PITR_DRILL_PROD_PGDATA  explicit production PGDATA, used only when
#                                    it cannot be read from the live cluster.
#                                    Without one of the two the drill REFUSES
#                                    to run — the anti-production guard is
#                                    never allowed to fail open.
#   NORAMEDI_PITR_RPO_MAX_MINUTES    default 60   — program RPO target
#   NORAMEDI_PITR_RTO_MAX_SECONDS    default 14400 — program RTO target (4h)
#   NORAMEDI_PITR_DRILL_MIN_FREE_RAM_MB   default 2048
#   NORAMEDI_PITR_DRILL_SHM_MARGIN_PCT    default 20
#   NORAMEDI_PITR_DRILL_WAL_ALLOWANCE_MB  default 1024 — WAL replayed into the
#                                    drill PGDATA before promotion; roughly
#                                    bounded by production's max_wal_size, and
#                                    the reason root-filesystem free space is
#                                    irrelevant to this script's capacity.
#   NORAMEDI_PITR_DRILL_ASSUMED_DB_MB     default 2048 — fallback base size
#                                    used only when pgbackrest info cannot be
#                                    parsed for the selected backup.
#   NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS   set to 1 to permit a drill root that
#                                    is NOT on tmpfs. Doing so writes cleartext
#                                    cross-tenant patient data to a block
#                                    device, where `rm -rf` does not erase it.
#
# Exit codes:
#   0  PASS
#   1  FAIL (the drill ran and did not prove recoverability)
#   2  usage/CLI error
#   3  precondition failure (nothing was restored)
#   5  CLEANUP INCIDENT — a disposable cluster or its PHI-bearing directory
#      could not be verifiably destroyed. Requires operator action.

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
CLEANUP_INCIDENT_EXIT_CODE=5
PROD_DB_NAME="noramedi_crm"

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }

RUN_ID="$(date -u '+%Y%m%d-%H%M%S')-$$"
LOG_PREFIX="[pitr-drill ${RUN_ID}]"
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "${LOG_PREFIX} $(timestamp) $*"; }
ABORTED=false
FAIL_REASON=""
fail() { ABORTED=true; [[ -n "$FAIL_REASON" ]] || FAIL_REASON="${1}"; echo "${LOG_PREFIX} $(timestamp) FAIL — $*" >&2; }

TARGET_TS=""
BACKUP_SET=""
REPO_NUM=1
STANZA="noramedi"
DRILL_PORT=55433
RESULT_FILE_OVERRIDE=""
DO_RECORD=false
KEEP_ON_FAILURE=false
ALLOW_MISSING_APP_SMOKE=false
PITR_RUN_ID=""
MARKER_SEG=""
MARKER_B_AT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)          TARGET_TS="${2:-}"; shift 2 ;;
    --set)             BACKUP_SET="${2:-}"; shift 2 ;;
    --repo)            REPO_NUM="${2:-}"; shift 2 ;;
    --stanza)          STANZA="${2:-}"; shift 2 ;;
    --port)            DRILL_PORT="${2:-}"; shift 2 ;;
    --result-file)     RESULT_FILE_OVERRIDE="${2:-}"; shift 2 ;;
    --pitr-run-id)     PITR_RUN_ID="${2:-}"; shift 2 ;;
    --marker-seg)      MARKER_SEG="${2:-}"; shift 2 ;;
    --marker-b-at)     MARKER_B_AT="${2:-}"; shift 2 ;;
    --record)          DO_RECORD=true; shift ;;
    --keep-on-failure) KEEP_ON_FAILURE=true; shift ;;
    --allow-missing-app-smoke) ALLOW_MISSING_APP_SMOKE=true; shift ;;
    -h|--help)         usage ;;
    *) echo "Unknown option: $1" >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

# The run id is interpolated into a SQL string literal that crosses as_drill's
# build_cmd and a far-side `sh -c`. Constrain it to the shape the marker
# procedure actually emits (F4-FCR-002A-20260815-01) rather than trusting the
# caller — the same discipline --target and --stanza already apply.
if [[ -n "$PITR_RUN_ID" ]] && [[ ! "$PITR_RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "Invalid --pitr-run-id '$PITR_RUN_ID' (expected [A-Za-z0-9._-], max 64)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi
if [[ -n "$MARKER_SEG" ]] && [[ ! "$MARKER_SEG" =~ ^[0-9A-F]{24}$ ]]; then
  echo "Invalid --marker-seg '$MARKER_SEG' (expected a 24-hex-character WAL segment name)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi
if [[ -n "$MARKER_B_AT" ]] && [[ ! "$MARKER_B_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[\ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([+-][0-9]{2}(:?[0-9]{2})?|Z)?$ ]]; then
  echo "Invalid --marker-b-at '$MARKER_B_AT' (expected 'YYYY-MM-DD HH:MM:SS[.ffffff][+TZ]')" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi
if [[ -n "$PITR_RUN_ID" ]] && [[ -z "$TARGET_TS" ]]; then
  echo "--pitr-run-id requires --target: marker verification is meaningless without a recovery target" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi

[[ "$STANZA" =~ ^[a-z0-9][a-z0-9_]{0,31}$ ]] || { echo "Invalid --stanza" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
[[ "$REPO_NUM" =~ ^[1-4]$ ]] || { echo "Invalid --repo '$REPO_NUM' (expected 1-4)" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
[[ "$DRILL_PORT" =~ ^[0-9]+$ ]] && [[ "$DRILL_PORT" -ge 1024 ]] && [[ "$DRILL_PORT" -le 65535 ]] \
  || { echo "Invalid --port '$DRILL_PORT'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
# The target string is interpolated into a pgbackrest argument. Constrain it to
# a timestamp shape instead of trusting the caller.
#
# Fractional seconds are accepted deliberately. The marker procedure derives the
# target as the MIDPOINT of two createdAt values, which is fractional whenever
# their difference is an odd number of seconds — 12:59:26.405500 in the first
# real run. Rejecting it would have failed the drill at argument parsing, and
# rounding it away would move the stop point by up to a second in whichever
# direction the operator happened to round. PostgreSQL accepts fractional
# recovery_target_time, so it is passed through unchanged.
if [[ -n "$TARGET_TS" ]] && [[ ! "$TARGET_TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[\ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([+-][0-9]{2}(:?[0-9]{2})?|Z)?$ ]]; then
  echo "Invalid --target '$TARGET_TS' (expected 'YYYY-MM-DD HH:MM:SS[.ffffff][+TZ]')" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi
# A bare --target carries no offset, so PostgreSQL resolves recovery_target_time
# in the DRILL cluster's timezone while the marker timestamps it is compared
# against come from PRODUCTION. When those two zones differ the run does not
# error — it stops hours away from where it was told to, silently. The offset is
# therefore mandatory for a verified run, and optional only for an unverified
# triage restore that claims no R-031/R-032 evidence.
if [[ -n "$PITR_RUN_ID" ]] && [[ ! "$TARGET_TS" =~ ([+-][0-9]{2}(:?[0-9]{2})?|Z)$ ]]; then
  echo "--pitr-run-id requires an explicit UTC offset on --target (e.g. '2026-08-15 12:59:26.405500+00'), got '$TARGET_TS': a bare target is resolved in the drill cluster's timezone, not production's" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi
# pgBackRest labels are `<full>` for a full, and `<full>_<stamp><D|I>` for a
# differential or incremental — e.g. 20260815-023000F_20260815-133000I. The
# suffix contains a HYPHEN, which an earlier `[_0-9]*` character class rejected,
# so every real diff/incr label was refused. Harmless while the wrapper defaults
# to --type full, latent the moment --type diff is adopted.
if [[ -n "$BACKUP_SET" ]] && [[ ! "$BACKUP_SET" =~ ^[0-9]{8}-[0-9]{6}F(_[0-9]{8}-[0-9]{6}[DI])?$ ]]; then
  echo "Invalid --set '$BACKUP_SET' (expected e.g. 20260815-023000F or 20260815-023000F_20260815-133000I)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi

DRILL_ROOT_BASE="${NORAMEDI_PGBACKREST_DRILL_ROOT:-/dev/shm/noramedi-pitr-drill}"
DRILL_ROOT="${DRILL_ROOT_BASE}-${RUN_ID}"
PGDATA_DIR="${DRILL_ROOT}/pgdata"
SOCK_DIR="${DRILL_ROOT}/sock"
HBA_FILE="${PGDATA_DIR}/pg_hba.conf"
IDENT_FILE="${PGDATA_DIR}/pg_ident.conf"
RESULT_FILE="${RESULT_FILE_OVERRIDE:-${NORAMEDI_PITR_DRILL_RESULT_FILE:-/var/lib/noramedi/pitr-drill-result.json}}"
OFFHOST_PROOF="${NORAMEDI_PGBACKREST_OFFHOST_PROOF:-/var/lib/noramedi/pitr-offhost-proof.json}"
PG_SUPERUSER="${NORAMEDI_PG_SUPERUSER:-postgres}"
PROD_PG_PORT="${PROD_PG_PORT:-5432}"
APP_SERVER_DIR="${NORAMEDI_APP_SERVER_DIR:-}"
RPO_MAX_MINUTES="${NORAMEDI_PITR_RPO_MAX_MINUTES:-60}"
RTO_MAX_SECONDS="${NORAMEDI_PITR_RTO_MAX_SECONDS:-14400}"
MIN_FREE_RAM_MB="${NORAMEDI_PITR_DRILL_MIN_FREE_RAM_MB:-2048}"
SHM_MARGIN_PCT="${NORAMEDI_PITR_DRILL_SHM_MARGIN_PCT:-20}"
WAL_ALLOWANCE_MB="${NORAMEDI_PITR_DRILL_WAL_ALLOWANCE_MB:-1024}"
ASSUMED_DB_MB="${NORAMEDI_PITR_DRILL_ASSUMED_DB_MB:-2048}"
# Sentinel tenant used by the controlled PITR marker procedure. It is a literal
# that belongs to no organization: OperationalEvent.organizationId carries no
# foreign key, so the marker rows are attached to no clinic and no patient.
PITR_MARKER_ORG="${NORAMEDI_PITR_MARKER_ORG:-__noramedi_pitr_drill__}"
PITR_MARKER_TASK="${NORAMEDI_PITR_MARKER_TASK:-F4-FCR-002A}"

for _n in RPO_MAX_MINUTES RTO_MAX_SECONDS MIN_FREE_RAM_MB SHM_MARGIN_PCT WAL_ALLOWANCE_MB ASSUMED_DB_MB; do
  if [[ ! "${!_n}" =~ ^[0-9]+$ ]]; then
    echo "Invalid ${_n}='${!_n}' (expected a non-negative integer)" >&2; exit "$USAGE_ERROR_EXIT_CODE"
  fi
done
[[ "$SHM_MARGIN_PCT" -lt 100 ]] || { echo "Invalid SHM margin percentage" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

# PG_SUPERUSER is written verbatim into pg_hba.conf and pg_ident.conf below.
[[ "$PG_SUPERUSER" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] \
  || { echo "Invalid NORAMEDI_PG_SUPERUSER '$PG_SUPERUSER'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

[[ "$DRILL_PORT" != "$PROD_PG_PORT" ]] || {
  echo "Refusing: --port equals PROD_PG_PORT ($PROD_PG_PORT)" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

# ── privilege delegation ─────────────────────────────────────────────────
DRILL_USER=""
if [[ "$(id -u)" -eq 0 ]]; then
  DRILL_USER="${REHEARSAL_OS_USER:-}"
  [[ -n "$DRILL_USER" ]] || {
    echo "REHEARSAL_OS_USER must be set explicitly when running as root." >&2
    echo "There is deliberately no default: choosing the account that will hold a" >&2
    echo "full cross-tenant copy of the patient database is an operator decision." >&2
    exit "$USAGE_ERROR_EXIT_CODE"; }
  [[ "$DRILL_USER" != "root" ]] || { echo "REHEARSAL_OS_USER must not be root" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
  DRILL_UID="$(id -u "$DRILL_USER" 2>/dev/null || echo -1)"
  [[ "$DRILL_UID" -gt 0 ]] || { echo "REHEARSAL_OS_USER '$DRILL_USER' is invalid or resolves to UID 0" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
else
  DRILL_USER="$(id -un)"
fi
# Written verbatim into pg_ident.conf as the SYSTEM-USERNAME column.
[[ "$DRILL_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] \
  || { echo "Drill OS user '$DRILL_USER' has a name this script will not write into pg_ident.conf" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

build_cmd() { local out=""; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "$out"; }
as_drill() {
  local cmd; cmd="$(build_cmd "$@")"
  if [[ "$(id -u)" -eq 0 ]]; then
    if command -v runuser >/dev/null 2>&1; then runuser -u "$DRILL_USER" -- /bin/bash -c "$cmd"
    else su -s /bin/bash "$DRILL_USER" -c "$cmd"; fi
  else
    /bin/bash -c "$cmd"
  fi
}

# ── cleanup — FAIL CLOSED ────────────────────────────────────────────────
#
# The superseded version ran `pg_ctl -m immediate stop || true` followed by
# `rm -rf "$DRILL_ROOT" 2>/dev/null || true` and then reported the drill's own
# result. Every failure mode of the teardown was therefore invisible: a stop
# that did not take left a postmaster serving a full cross-tenant copy of the
# patient database out of tmpfs, and the `rm -rf` that followed ran against a
# LIVE data directory. Nothing checked, nothing logged, exit 0.
#
# This version verifies each step, escalates on a bounded schedule, and treats
# any unverified step as an incident: exit 5, an explicit operator instruction
# on stderr, and an incident marker written next to the result document.
CLEANUP_DONE=false
STARTED=false
CLEANUP_INCIDENT=""

postmaster_pid() {
  local pidfile="${PGDATA_DIR}/postmaster.pid" pid=""
  [[ -f "$pidfile" ]] || return 1
  pid="$(head -n1 "$pidfile" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

pid_alive() { kill -0 "$1" 2>/dev/null; }

# Waits up to $2 seconds for pid $1 to disappear. Returns 0 if it did.
wait_pid_gone() {
  local pid="$1" limit="$2" waited=0
  while [[ "$waited" -lt "$limit" ]]; do
    pid_alive "$pid" || return 0
    sleep 1
    waited=$(( waited + 1 ))
  done
  ! pid_alive "$pid"
}

port_listener_present() {
  # Returns 0 if something is listening on $1, 1 if nothing is, 2 if unknown.
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"; then return 0; else return 1; fi
  fi
  return 2
}

record_incident() {
  CLEANUP_INCIDENT="${CLEANUP_INCIDENT}${CLEANUP_INCIDENT:+; }$1"
  echo "${LOG_PREFIX} CLEANUP INCIDENT — $1" >&2
}

# Bounded escalation: fast → immediate → SIGTERM → SIGKILL, verifying after
# each step. Returns non-zero only if the postmaster is still alive at the end.
stop_cluster() {
  local pid=""
  pid="$(postmaster_pid || true)"

  as_drill "${PG_CTL}" -D "$PGDATA_DIR" -m fast -t 30 -w stop >/dev/null 2>&1 || true
  if [[ -z "$pid" ]] || ! pid_alive "$pid"; then return 0; fi

  log "cleanup: fast stop did not complete — escalating to immediate"
  as_drill "${PG_CTL}" -D "$PGDATA_DIR" -m immediate -t 20 -w stop >/dev/null 2>&1 || true
  if ! pid_alive "$pid"; then return 0; fi

  log "cleanup: immediate stop did not complete — sending SIGTERM to postmaster ${pid}"
  kill -TERM "$pid" 2>/dev/null || true
  if wait_pid_gone "$pid" 15; then return 0; fi

  log "cleanup: SIGTERM did not end postmaster ${pid} — sending SIGKILL"
  kill -KILL "$pid" 2>/dev/null || true
  if wait_pid_gone "$pid" 10; then return 0; fi

  return 1
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [[ "$CLEANUP_DONE" == true ]]; then exit "$rc"; fi
  CLEANUP_DONE=true

  # 1. Stop the postmaster, with verification.
  if [[ "$STARTED" == true ]]; then
    if ! stop_cluster; then
      record_incident "the disposable postmaster is STILL RUNNING and could not be killed; it is serving a complete cross-tenant copy of the patient database from ${PGDATA_DIR}"
    fi
    local still=""
    still="$(postmaster_pid || true)"
    if [[ -n "$still" ]] && pid_alive "$still"; then
      record_incident "postmaster pid ${still} is still alive after full escalation"
    fi
  fi

  # 2. The drill port must be free again.
  if [[ "$STARTED" == true ]]; then
    local pstate=0
    port_listener_present "$DRILL_PORT" || pstate=$?
    if [[ "$pstate" -eq 0 ]]; then
      record_incident "something is still listening on port ${DRILL_PORT} after teardown"
    elif [[ "$pstate" -eq 2 ]]; then
      record_incident "could not verify that port ${DRILL_PORT} is closed ('ss' unavailable)"
    fi
  fi

  # 3. Remove the drill root, with verification — or deliberately keep it.
  if [[ "$ABORTED" == true ]] && [[ "$KEEP_ON_FAILURE" == true ]]; then
    echo "${LOG_PREFIX} KEEPING ${DRILL_ROOT} for post-mortem." >&2
    echo "${LOG_PREFIX} ⚠ IT CONTAINS A COMPLETE CROSS-TENANT COPY OF THE PATIENT DATABASE." >&2
    echo "${LOG_PREFIX} ⚠ Remove it as soon as the post-mortem is done: rm -rf ${DRILL_ROOT}" >&2
  elif [[ -e "$DRILL_ROOT" ]]; then
    rm -rf "$DRILL_ROOT" || record_incident "rm -rf '${DRILL_ROOT}' returned an error"
    if [[ -e "$DRILL_ROOT" ]]; then
      record_incident "'${DRILL_ROOT}' STILL EXISTS after removal; cleartext patient data remains on this host"
    else
      log "cleanup: ${DRILL_ROOT} removed and verified gone"
    fi
  fi

  # 4. An unverified teardown is an incident, and outranks the drill's own
  #    result: a green drill that left a PHI-bearing cluster running is not a
  #    successful drill.
  if [[ -n "$CLEANUP_INCIDENT" ]]; then
    echo "" >&2
    echo "${LOG_PREFIX} ═══════════════ CLEANUP INCIDENT — OPERATOR ACTION REQUIRED ═══════════════" >&2
    echo "${LOG_PREFIX} ${CLEANUP_INCIDENT}" >&2
    echo "${LOG_PREFIX} Inspect and remediate NOW:" >&2
    echo "${LOG_PREFIX}   ps -o pid,user,args -p \$(head -n1 ${PGDATA_DIR}/postmaster.pid 2>/dev/null || echo 1)" >&2
    echo "${LOG_PREFIX}   ss -ltnp | grep ${DRILL_PORT}" >&2
    echo "${LOG_PREFIX}   ls -la ${DRILL_ROOT}" >&2
    echo "${LOG_PREFIX} Then stop the process and remove the directory by hand." >&2
    echo "${LOG_PREFIX} Record this as an incident: a disposable cluster holding every tenant's" >&2
    echo "${LOG_PREFIX} special-category health data outlived its drill." >&2
    echo "${LOG_PREFIX} ═════════════════════════════════════════════════════════════════════════" >&2
    write_incident_marker
    exit "$CLEANUP_INCIDENT_EXIT_CODE"
  fi
  exit "$rc"
}

write_incident_marker() {
  local dir marker
  dir="$(dirname "$RESULT_FILE")"
  [[ -d "$dir" ]] || return 0
  marker="${dir}/pitr-drill-cleanup-incident-${RUN_ID}.json"
  printf '{\n  "schemaVersion": 1,\n  "kind": "pgbackrest_pitr_cleanup_incident",\n  "runId": "%s",\n  "at": "%s",\n  "drillRoot": "%s",\n  "port": %s,\n  "detail": "%s"\n}\n' \
    "$RUN_ID" "$(timestamp)" "$DRILL_ROOT" "$DRILL_PORT" \
    "$(printf '%s' "$CLEANUP_INCIDENT" | tr -d '"\\' | tr '\n' ' ' | cut -c1-400)" \
    > "$marker" 2>/dev/null || return 0
  chmod 0600 "$marker" 2>/dev/null || true
  echo "${LOG_PREFIX} incident marker written to ${marker}" >&2
}

# HUP is trapped as well: without it an SSH disconnection mid-replay orphaned a
# running postmaster holding every tenant's patient data in tmpfs.
trap cleanup EXIT INT TERM HUP

# ── preconditions ────────────────────────────────────────────────────────
command -v pgbackrest >/dev/null 2>&1 || { fail "pgbackrest is not installed"; exit "$PRECONDITION_EXIT_CODE"; }
command -v node >/dev/null 2>&1 || { fail "node is not installed (required for result serialisation and the application smoke)"; exit "$PRECONDITION_EXIT_CODE"; }

# `ss` is required, not optional. It is the only thing that can answer "is the
# drill port free" before the restore and "is it closed again" after teardown,
# and both of those are safety assertions rather than diagnostics. Continuing
# without it would mean reporting an unverifiable claim as verified.
command -v ss >/dev/null 2>&1 || {
  fail "'ss' (iproute2) is not available; the drill cannot verify that port ${DRILL_PORT} is free before starting or closed after teardown"
  exit "$PRECONDITION_EXIT_CODE"; }

PG_BINDIR="${PG_BINDIR:-}"
if [[ -z "$PG_BINDIR" ]]; then
  if command -v pg_ctl >/dev/null 2>&1; then PG_BINDIR="$(dirname "$(command -v pg_ctl)")"
  else
    for d in /usr/lib/postgresql/*/bin; do [[ -x "$d/pg_ctl" ]] && PG_BINDIR="$d"; done
  fi
fi
PG_CTL="${PG_BINDIR}/pg_ctl"
PSQL="${PG_BINDIR}/psql"
[[ -x "$PG_CTL" ]] || { fail "pg_ctl not found (set PG_BINDIR)"; exit "$PRECONDITION_EXIT_CODE"; }

# ── the application smoke inputs must exist BEFORE anything is restored ──
APP_SMOKE_ENABLED=true
if [[ "$ALLOW_MISSING_APP_SMOKE" == true ]]; then
  APP_SMOKE_ENABLED=false
  log "⚠ --allow-missing-app-smoke: the application and tenant smoke stages are DISABLED."
  log "⚠ This run cannot be R-032 evidence and --record will be refused."
else
  [[ -n "$APP_SERVER_DIR" ]] || {
    fail "NORAMEDI_APP_SERVER_DIR is not set. The application smoke and the migration-set comparison both read the DEPLOYED RELEASE from it; without it this drill can only prove that a cluster starts, which is not R-032 evidence. Set it, or pass --allow-missing-app-smoke to run a non-evidential triage drill."
    exit "$PRECONDITION_EXIT_CODE"; }
  [[ -d "$APP_SERVER_DIR/prisma/migrations" ]] || {
    fail "NORAMEDI_APP_SERVER_DIR='${APP_SERVER_DIR}' does not contain prisma/migrations — it does not look like the deployed server directory"
    exit "$PRECONDITION_EXIT_CODE"; }
  [[ -d "$APP_SERVER_DIR/node_modules/@prisma/client" ]] || {
    fail "NORAMEDI_APP_SERVER_DIR='${APP_SERVER_DIR}' has no node_modules/@prisma/client — the application smoke must load the DEPLOYED generated client, not a freshly installed one"
    exit "$PRECONDITION_EXIT_CODE"; }
  # The smoke runs as the drill OS user, which is typically `postgres` and
  # frequently cannot read the deploy directory. Finding that out AFTER a full
  # restore has been written into tmpfs wastes the expensive part of the drill.
  if ! as_drill test -r "$APP_SERVER_DIR/package.json"; then
    fail "the drill OS user '${DRILL_USER}' cannot read '${APP_SERVER_DIR}/package.json'; the application smoke would fail after the restore. Grant read access to the deployed server directory, or choose a REHEARSAL_OS_USER that already has it."
    exit "$PRECONDITION_EXIT_CODE"
  fi
fi

APP_SMOKE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/noramedi-pitr-app-smoke.mjs"
if [[ "$APP_SMOKE_ENABLED" == true ]] && [[ ! -f "$APP_SMOKE_SCRIPT" ]]; then
  fail "the application smoke helper '${APP_SMOKE_SCRIPT}' is missing; deploy it alongside this script"
  exit "$PRECONDITION_EXIT_CODE"
fi

# ── REFUSAL 1: never the production data directory — and never fail open ─
#
# The superseded guard only attempted the lookup when EUID was 0 AND runuser
# existed, and merely logged a warning otherwise. A non-root invocation
# therefore skipped the single check that stands between this script and
# production's PGDATA. It now tries every avenue and REFUSES TO RUN if none of
# them answers.
PROD_PGDATA="${NORAMEDI_PITR_DRILL_PROD_PGDATA:-}"
PROD_PGDATA_SOURCE="env"
if [[ -z "$PROD_PGDATA" ]]; then
  if [[ "$(id -u)" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    PROD_PGDATA="$(runuser -u "$PG_SUPERUSER" -- /bin/bash -c "psql -p ${PROD_PG_PORT} -Atc \"SHOW data_directory;\"" 2>/dev/null || true)"
    PROD_PGDATA_SOURCE="live_query_as_${PG_SUPERUSER}"
  fi
fi
if [[ -z "$PROD_PGDATA" ]]; then
  PROD_PGDATA="$("$PSQL" -p "$PROD_PG_PORT" -Atc "SHOW data_directory;" 2>/dev/null || true)"
  PROD_PGDATA_SOURCE="live_query_as_$(id -un)"
fi
if [[ -z "$PROD_PGDATA" ]] && command -v pg_lsclusters >/dev/null 2>&1; then
  # Column 6 of pg_lsclusters is the data directory; select the row whose port
  # matches production rather than assuming a single cluster.
  PROD_PGDATA="$(pg_lsclusters --no-header 2>/dev/null | awk -v p="$PROD_PG_PORT" '$3 == p {print $6; exit}' || true)"
  PROD_PGDATA_SOURCE="pg_lsclusters"
fi
if [[ -z "$PROD_PGDATA" ]]; then
  fail "REFUSING TO RUN: could not determine the PRODUCTION data directory by any means (live query, pg_lsclusters, or NORAMEDI_PITR_DRILL_PROD_PGDATA). The guard that keeps this drill out of production PGDATA must never be skipped. Set NORAMEDI_PITR_DRILL_PROD_PGDATA explicitly if the cluster is not reachable from this account."
  exit "$PRECONDITION_EXIT_CODE"
fi
REAL_DRILL="$(readlink -f "$PGDATA_DIR" 2>/dev/null || echo "$PGDATA_DIR")"
REAL_PROD="$(readlink -f "$PROD_PGDATA" 2>/dev/null || echo "$PROD_PGDATA")"
if [[ "$REAL_DRILL" == "$REAL_PROD" ]] || [[ "$REAL_DRILL" == "$REAL_PROD"/* ]] || [[ "$REAL_PROD" == "$REAL_DRILL"/* ]]; then
  fail "REFUSING: the drill path resolves inside the PRODUCTION data directory"
  exit "$PRECONDITION_EXIT_CODE"
fi
log "production PGDATA is '${REAL_PROD}' (source: ${PROD_PGDATA_SOURCE}) — drill path is disjoint"

# ── REFUSAL 2: the drill root must be RAM-backed ─────────────────────────
# The header has always claimed restored patient bytes never reach persistent
# disk. That claim was never enforced: overriding the drill root to a path on
# the root filesystem silently wrote a cleartext cross-tenant copy of the
# patient database to a block device, where `rm -rf` does not erase it.
DRILL_PARENT="$(dirname "$DRILL_ROOT")"
[[ -d "$DRILL_PARENT" ]] || { fail "the drill root's parent directory '${DRILL_PARENT}' does not exist"; exit "$PRECONDITION_EXIT_CODE"; }
DRILL_FSTYPE="$(df -PT "$DRILL_PARENT" 2>/dev/null | awk 'NR==2 {print $2}' || true)"
if [[ "$DRILL_FSTYPE" != "tmpfs" ]]; then
  if [[ "${NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS:-0}" == "1" ]]; then
    log "⚠ drill root '${DRILL_PARENT}' is on '${DRILL_FSTYPE}', NOT tmpfs — proceeding only because NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS=1."
    log "⚠ Cleartext cross-tenant patient data WILL be written to a persistent block device. 'rm -rf' does not erase it."
  else
    fail "REFUSING: the drill root '${DRILL_PARENT}' is on filesystem type '${DRILL_FSTYPE:-<unknown>}', not tmpfs. A physical restore writes every tenant's patient rows in cleartext; on a block device those bytes survive the drill. Point NORAMEDI_PGBACKREST_DRILL_ROOT at /dev/shm, or set NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS=1 to accept the consequence deliberately."
    exit "$PRECONDITION_EXIT_CODE"
  fi
fi

# ── REFUSAL 3: the drill port must be free BEFORE anything is restored ───
# A collision used to surface as an opaque pg_ctl start failure after a full
# restore had already been written into tmpfs.
if port_listener_present "$DRILL_PORT"; then
  fail "port ${DRILL_PORT} is already in use on this host. Pick a different --port. (Nothing has been restored.)"
  exit "$PRECONDITION_EXIT_CODE"
fi
if [[ -e "${SOCK_DIR}/.s.PGSQL.${DRILL_PORT}" ]]; then
  fail "a unix socket for port ${DRILL_PORT} already exists under ${SOCK_DIR}"
  exit "$PRECONDITION_EXIT_CODE"
fi
log "port ${DRILL_PORT} is free"

# ── REFUSAL 4: capacity — /dev/shm and RAM, not the root filesystem ──────
#
# The restore target is tmpfs. Free space on / is IRRELEVANT to this script:
# the ceiling is the /dev/shm mount (commonly 50% of RAM) shared with the live
# postmaster and the Node processes. Running out mid-replay produces ENOSPC →
# PANIC → and the generic start-failure diagnostic then blames recovery for a
# capacity problem, sending the operator to look in the wrong place.
#
# The requirement is base data + WAL replayed before promotion + overhead, and
# the base figure is read from the repository rather than guessed.
BACKUP_INFO_JSON="$(pgbackrest --stanza="$STANZA" --repo="$REPO_NUM" --output=json info 2>/dev/null || true)"
SELECTED_JSON="$(
  BI_JSON="$BACKUP_INFO_JSON" BI_STANZA="$STANZA" BI_SET="$BACKUP_SET" node -e '
    const E = process.env;
    let out = { sizeMb: "", stopEpoch: "", label: "" };
    try {
      const info = JSON.parse(E.BI_JSON || "[]");
      const st = Array.isArray(info) ? info.find(s => s && s.name === E.BI_STANZA) : null;
      const backups = (st && Array.isArray(st.backup)) ? st.backup : [];
      let b = null;
      if (E.BI_SET) b = backups.find(x => x && x.label === E.BI_SET) || null;
      if (!b && backups.length) b = backups[backups.length - 1];
      if (b) {
        out.label = String(b.label || "");
        const bytes = b.info && Number(b.info.size);
        if (Number.isFinite(bytes) && bytes > 0) out.sizeMb = String(Math.ceil(bytes / 1048576));
        const stop = b.timestamp && Number(b.timestamp.stop);
        if (Number.isFinite(stop) && stop > 0) out.stopEpoch = String(Math.floor(stop));
      }
    } catch (_) { /* fall through to the conservative default below */ }
    process.stdout.write([out.sizeMb, out.stopEpoch, out.label].join("|"));
  ' 2>/dev/null || printf '||'
)"
BASE_DB_MB="$(cut -d'|' -f1 <<<"$SELECTED_JSON")"
BACKUP_STOP_EPOCH="$(cut -d'|' -f2 <<<"$SELECTED_JSON")"
SELECTED_LABEL="$(cut -d'|' -f3 <<<"$SELECTED_JSON")"
BASE_SIZE_SOURCE="pgbackrest_info"
if [[ ! "$BASE_DB_MB" =~ ^[0-9]+$ ]] || [[ "$BASE_DB_MB" -le 0 ]]; then
  BASE_DB_MB="$ASSUMED_DB_MB"
  BASE_SIZE_SOURCE="assumed_default"
  log "WARNING: could not read the selected backup's size from 'pgbackrest info'; using the conservative default of ${BASE_DB_MB} MB for the capacity gate"
fi
OVERHEAD_MB=$(( BASE_DB_MB / 4 + 1 ))
REQUIRED_SHM_MB=$(( BASE_DB_MB + WAL_ALLOWANCE_MB + OVERHEAD_MB ))
[[ "$REQUIRED_SHM_MB" -ge 512 ]] || REQUIRED_SHM_MB=512

SHM_AVAILABLE_MB="$(df -Pm "$DRILL_PARENT" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
[[ "$SHM_AVAILABLE_MB" =~ ^[0-9]+$ ]] || {
  fail "could not measure available space on '${DRILL_PARENT}' — refusing to restore into a filesystem of unknown capacity"
  exit "$PRECONDITION_EXIT_CODE"; }
USABLE_SHM_MB=$(( SHM_AVAILABLE_MB * (100 - SHM_MARGIN_PCT) / 100 ))
log "capacity: base ${BASE_DB_MB} MB (${BASE_SIZE_SOURCE}) + WAL allowance ${WAL_ALLOWANCE_MB} MB + overhead ${OVERHEAD_MB} MB = ${REQUIRED_SHM_MB} MB required; ${DRILL_PARENT} has ${SHM_AVAILABLE_MB} MB available, ${USABLE_SHM_MB} MB usable after a ${SHM_MARGIN_PCT}% margin"
if [[ "$REQUIRED_SHM_MB" -gt "$USABLE_SHM_MB" ]]; then
  fail "insufficient ${DRILL_PARENT} capacity: need ~${REQUIRED_SHM_MB} MB but only ${USABLE_SHM_MB} MB is usable after reserving a ${SHM_MARGIN_PCT}% margin of the ${SHM_AVAILABLE_MB} MB available. Free space there or grow the tmpfs mount. (Free space on / is not the constraint — the restore target is RAM.) Nothing has been restored."
  exit "$PRECONDITION_EXIT_CODE"
fi

MEM_AVAILABLE_MB="$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || true)"
[[ "$MEM_AVAILABLE_MB" =~ ^[0-9]+$ ]] || {
  fail "could not read MemAvailable from /proc/meminfo — refusing to allocate a tmpfs cluster of unknown affordability"
  exit "$PRECONDITION_EXIT_CODE"; }
log "memory: ${MEM_AVAILABLE_MB} MB available; ${REQUIRED_SHM_MB} MB will be consumed; ${MIN_FREE_RAM_MB} MB must remain"
if (( MEM_AVAILABLE_MB - REQUIRED_SHM_MB < MIN_FREE_RAM_MB )); then
  fail "insufficient free RAM: ${MEM_AVAILABLE_MB} MB available, ~${REQUIRED_SHM_MB} MB needed, ${MIN_FREE_RAM_MB} MB headroom required. tmpfs pages are RAM; proceeding would put memory pressure on the live production postmaster on this same host. Nothing has been restored."
  exit "$PRECONDITION_EXIT_CODE"
fi

# ── prepare scratch space ────────────────────────────────────────────────
mkdir -p "$DRILL_ROOT"
chmod 700 "$DRILL_ROOT"
if [[ "$(id -u)" -eq 0 ]]; then chown "$DRILL_USER" "$DRILL_ROOT"; fi
as_drill mkdir -p "$PGDATA_DIR" "$SOCK_DIR"
as_drill chmod 700 "$PGDATA_DIR" "$SOCK_DIR"

# ── restore ──────────────────────────────────────────────────────────────
T_START="$(date -u +%s)"
RESTORE_ARGS=(pgbackrest --stanza="$STANZA" --repo="$REPO_NUM" --pg1-path="$PGDATA_DIR")
if [[ -n "$BACKUP_SET" ]]; then RESTORE_ARGS+=(--set="$BACKUP_SET"); fi
if [[ -n "$TARGET_TS" ]]; then RESTORE_ARGS+=(--type=time --target="$TARGET_TS" --target-action=promote); fi
RESTORE_ARGS+=(restore)

log "restoring from repo${REPO_NUM}${SELECTED_LABEL:+ (backup ${SELECTED_LABEL})}${TARGET_TS:+ to target '${TARGET_TS}'}"
if ! as_drill "${RESTORE_ARGS[@]}"; then
  fail "pgbackrest restore failed"
  exit 1
fi
T_RESTORE_DONE="$(date -u +%s)"
log "restore completed in $(( T_RESTORE_DONE - T_START ))s"

# ── synthesise the configuration the backup does not contain ─────────────
#
# ⚠ ON DEBIAN/UBUNTU THE CONFIG FILES DO NOT LIVE IN PGDATA.
# postgresql.conf, pg_hba.conf and pg_ident.conf are in
# /etc/postgresql/<ver>/<cluster>/, while pgBackRest backs up pg1-path only.
# A restored PGDATA therefore contains NONE of them, and a postmaster started
# against it fails with `could not open configuration file ".../pg_hba.conf"` —
# which the generic start-failure diagnostic below would have blamed on
# recovery not reaching a consistent point, sending the operator to look in
# entirely the wrong place. (This behaviour is correct for Ubuntu noble +
# PostgreSQL 16 and is deliberately preserved.)
#
# AUTHENTICATION. There is no `trust` line and no `host` line. The only way in
# is the unix socket in a mode-0700 directory, as the drill OS user, mapped by
# an explicit pg_ident entry onto the restored cluster's superuser role. `peer`
# is authenticated by the kernel: it cannot be guessed, sniffed, replayed, or
# reached from anywhere but this host's own process table.
as_drill /bin/bash -c "cat > $(printf '%q' "$HBA_FILE") <<'HBA'
# noramedi PITR drill — disposable cluster, unix socket only, destroyed on exit.
# No 'host' line exists on purpose: the cluster runs with listen_addresses=''
# so there is no TCP listener, and no TCP rule that could authorise one.
# No 'trust' line exists on purpose: peer authentication is verified by the
# kernel against the connecting process's UID.
local   all   ${PG_SUPERUSER}   peer map=noramedidrill
HBA"
as_drill /bin/bash -c "cat > $(printf '%q' "$IDENT_FILE") <<'IDENT'
# MAPNAME            SYSTEM-USERNAME     PG-USERNAME
noramedidrill        ${DRILL_USER}       ${PG_SUPERUSER}
IDENT"
as_drill chmod 600 "$HBA_FILE" "$IDENT_FILE"

# Appended (not overwritten) because pgbackrest restore writes recovery
# settings into postgresql.auto.conf and may have left a postgresql.conf.
as_drill /bin/bash -c "cat >> $(printf '%q' "$PGDATA_DIR")/postgresql.conf <<'CONF'

# --- noramedi PITR drill overrides (appended by the drill script) ---
listen_addresses = ''
port = ${DRILL_PORT}
unix_socket_directories = '${SOCK_DIR}'
unix_socket_permissions = 0700
hba_file = '${HBA_FILE}'
ident_file = '${IDENT_FILE}'
archive_mode = off
archive_command = ''
CONF"

# Fail with the RIGHT diagnostic if the synthesis did not take effect, rather
# than letting a missing auth file masquerade as a recovery problem.
for required in postgresql.conf pg_hba.conf pg_ident.conf; do
  if ! as_drill test -f "$PGDATA_DIR/$required"; then
    fail "'$required' is missing from the restored data directory — on Debian/Ubuntu these live outside PGDATA and are not part of the backup; the drill synthesises them, so this means the synthesis step failed"
    exit 1
  fi
done

# ── start, with every safety-relevant GUC pinned on the command line ─────
#
# `-o` beats both postgresql.conf and postgresql.auto.conf, so a config file
# restored from the backup cannot redirect any of these. data_directory is
# included because it was the one remaining setting a restored postgresql.conf
# could have used to point the postmaster at PRODUCTION's PGDATA — harmless
# while production is running (postmaster.pid stops it) and catastrophic while
# production is down, which is exactly when a PITR drill gets run.
# archive_mode/archive_command are pinned off so a restored configuration can
# never make the disposable cluster push WAL into the real repository.
PG_OPTS=""
PG_OPTS+=" -c logging_collector=off"
PG_OPTS+=" -c data_directory=$(printf '%q' "$PGDATA_DIR")"
PG_OPTS+=" -c hba_file=$(printf '%q' "$HBA_FILE")"
PG_OPTS+=" -c ident_file=$(printf '%q' "$IDENT_FILE")"
PG_OPTS+=" -c listen_addresses=''"
PG_OPTS+=" -c unix_socket_directories=$(printf '%q' "$SOCK_DIR")"
PG_OPTS+=" -c unix_socket_permissions=0700"
PG_OPTS+=" -c port=${DRILL_PORT}"
PG_OPTS+=" -c archive_mode=off"
PG_OPTS+=" -c archive_command=''"

log "starting disposable cluster — unix socket only, no TCP listener"
if ! as_drill "$PG_CTL" -D "$PGDATA_DIR" -o "$PG_OPTS" -w -t 120 start; then
  fail "the restored cluster did not start — check the postmaster log under ${PGDATA_DIR}/log (recovery may not have reached a consistent point, or a config file is missing)"
  exit 1
fi
STARTED=true
T_CONNECTIONS_READY="$(date -u +%s)"

PSQL_BASE=("$PSQL" -h "$SOCK_DIR" -p "$DRILL_PORT" -U "$PG_SUPERUSER")

# ── RUNTIME verification of the isolation claims, before any query that
#    touches patient data ───────────────────────────────────────────────
BOUND="$(as_drill "${PSQL_BASE[@]}" -d postgres -Atc "SHOW listen_addresses;" 2>/dev/null || true)"
if [[ -n "$BOUND" ]]; then
  fail "REFUSING to continue: restored cluster reports listen_addresses='${BOUND}', expected it to be empty. A TCP listener must not exist for a cluster holding every tenant's patient data."
  exit 1
fi
if port_listener_present "$DRILL_PORT"; then
  fail "REFUSING to continue: a TCP listener appeared on port ${DRILL_PORT} after start"
  exit 1
fi
# Assert the negative directly rather than inferring it: no pg_hba rule may
# authorise a non-local connection, and none may use trust.
HBA_HOST_RULES="$(as_drill "${PSQL_BASE[@]}" -d postgres -Atc "SELECT count(*) FROM pg_hba_file_rules WHERE type <> 'local';" 2>/dev/null || echo "")"
HBA_TRUST_RULES="$(as_drill "${PSQL_BASE[@]}" -d postgres -Atc "SELECT count(*) FROM pg_hba_file_rules WHERE auth_method = 'trust';" 2>/dev/null || echo "")"
if [[ "$HBA_HOST_RULES" != "0" ]] || [[ "$HBA_TRUST_RULES" != "0" ]]; then
  fail "REFUSING to continue: the active pg_hba has ${HBA_HOST_RULES:-<unknown>} non-local rule(s) and ${HBA_TRUST_RULES:-<unknown>} trust rule(s); both must be 0"
  exit 1
fi
SOCK_MODE="$(stat -c '%a' "$SOCK_DIR" 2>/dev/null || echo "")"
if [[ "$SOCK_MODE" != "700" ]]; then
  fail "REFUSING to continue: the unix socket directory '${SOCK_DIR}' is mode ${SOCK_MODE:-<unknown>}, expected 700"
  exit 1
fi
log "isolation verified at runtime: no TCP listener, no non-local pg_hba rule, no trust rule, socket directory 0700"

# ── wait for promotion ───────────────────────────────────────────────────
# `pg_ctl -w` returns as soon as the postmaster ACCEPTS CONNECTIONS, which on
# PostgreSQL 16 (hot_standby defaults to on) happens while recovery is still
# replaying. Sampling pg_is_in_recovery() immediately would therefore report
# `t` on a perfectly good restore and fail the drill for a reason that is not
# true — a false RED on the one artifact that produces R-032 evidence.
RECOVERY_WAIT_SECONDS="${NORAMEDI_PITR_DRILL_RECOVERY_WAIT_SECONDS:-180}"
[[ "$RECOVERY_WAIT_SECONDS" =~ ^[0-9]+$ ]] || RECOVERY_WAIT_SECONDS=180
log "waiting up to ${RECOVERY_WAIT_SECONDS}s for recovery to reach its target and promote"
IN_RECOVERY=""
_waited=0
while [[ "$_waited" -lt "$RECOVERY_WAIT_SECONDS" ]]; do
  IN_RECOVERY="$(as_drill "${PSQL_BASE[@]}" -d postgres -Atc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "")"
  [[ "$IN_RECOVERY" == "f" ]] && break
  sleep 2
  _waited=$(( _waited + 2 ))
done
[[ "$IN_RECOVERY" == "f" ]] && log "recovery completed after ${_waited}s" \
  || log "still in recovery after ${_waited}s — the smoke checks below will fail this drill"
T_PROMOTED="$(date -u +%s)"

# Built by concatenation rather than to_char's double-quoted literals: this
# string passes through as_drill's build_cmd and then a shell -c on the far
# side, and a stripped `"T"` would silently turn into to_char's ordinal-suffix
# pattern rather than an ISO separator.
RECOVERY_POINT="$(as_drill "${PSQL_BASE[@]}" -d postgres -Atc "SELECT to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC','HH24:MI:SS') || 'Z';" 2>/dev/null || echo "")"
RPO_SOURCE="pg_last_xact_replay_timestamp"
if [[ -z "$RECOVERY_POINT" ]] && [[ "$BACKUP_STOP_EPOCH" =~ ^[0-9]+$ ]]; then
  # A backup with no WAL to replay leaves pg_last_xact_replay_timestamp() NULL.
  # The backup's own stop time is then the honest recovery point — derived, and
  # labelled as derived, rather than silently reported as unknown.
  RECOVERY_POINT="$(date -u -d "@${BACKUP_STOP_EPOCH}" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "")"
  RPO_SOURCE="backup_stop_time"
fi
[[ -n "$RECOVERY_POINT" ]] || RPO_SOURCE="none"

# ── structural verification ──────────────────────────────────────────────
# Counts and booleans only. No row content is ever printed — the whole point
# of the disposable cluster is that patient bytes stay inside it.
q() { as_drill "${PSQL_BASE[@]}" -d "$PROD_DB_NAME" -Atc "$1" 2>/dev/null || echo ""; }

TABLE_COUNT="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
MIGRATION_COUNT="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")"
FAILED_MIGRATIONS="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;")"
ROLLED_BACK_MIGRATIONS="$(q "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL;")"
CLINIC_COUNT="$(q "SELECT count(*) FROM \"Clinic\";")"
PATIENT_COUNT="$(q "SELECT count(*) FROM \"Patient\";")"
APPOINTMENT_COUNT="$(q "SELECT count(*) FROM \"Appointment\";")"
ORPHAN_APPTS="$(q "SELECT count(*) FROM \"Appointment\" a LEFT JOIN \"Patient\" p ON a.\"patientId\"=p.id WHERE p.id IS NULL;")"

RESULT="passed"
# A restore that produces an empty or structurally broken database must FAIL.
# "pg_ctl start returned 0" is not evidence of recoverability — measuring only
# command completion instead of application health is precisely how a drill
# reports a green result over an unusable backup.
[[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] && [[ "$TABLE_COUNT" -gt 0 ]]        || { fail "no tables in the restored public schema"; RESULT="failed"; }
[[ "$MIGRATION_COUNT" =~ ^[0-9]+$ ]] && [[ "$MIGRATION_COUNT" -gt 0 ]] || { fail "no applied Prisma migrations found"; RESULT="failed"; }
[[ "$FAILED_MIGRATIONS" == "0" ]]                                      || { fail "restored database has unfinished migrations ($FAILED_MIGRATIONS)"; RESULT="failed"; }
[[ "$ROLLED_BACK_MIGRATIONS" == "0" ]]                                 || { fail "restored database has rolled-back migrations ($ROLLED_BACK_MIGRATIONS)"; RESULT="failed"; }
[[ "$CLINIC_COUNT" =~ ^[0-9]+$ ]]                                      || { fail "Clinic table unreadable"; RESULT="failed"; }
[[ "$PATIENT_COUNT" =~ ^[0-9]+$ ]]                                     || { fail "Patient table unreadable"; RESULT="failed"; }
[[ "$ORPHAN_APPTS" == "0" ]]                                           || { fail "referential integrity broken: $ORPHAN_APPTS appointments without a patient"; RESULT="failed"; }
[[ "$IN_RECOVERY" == "f" ]]                                            || { fail "cluster is still in recovery — the target was not reached"; RESULT="failed"; }

# ── deterministic PITR stop-point verification ───────────────────────────
#
# Everything above proves a cluster STARTED. None of it proves recovery
# stopped where it was told to: a replay that ignored recovery_target_time and
# ran to the end of the WAL produces exactly the same tables, migrations and
# counts. Without this stage a --target run could report `passed` while having
# silently recovered to `latest`, which is not R-031 evidence.
#
# The proof is a controlled marker pair written to production BEFORE the
# restore (see the F4-FCR-002A runbook): marker A committed before the target,
# marker B after it. A correct stop yields A present and B absent. Overshoot
# shows B; undershoot loses A. Both markers are non-clinical rows on a
# sentinel organizationId, and only COUNTS are read here — never row content.
PITR_VERIFY_STATUS="not_applicable"
PITR_MARKER_A_COUNT=""
PITR_MARKER_B_COUNT=""
PITR_MARKER_A_AT=""
PITR_REPLAY_EPOCH=""
PITR_TARGET_EPOCH=""

pitr_marker_count() {
  q "SELECT count(*) FROM \"OperationalEvent\" WHERE \"organizationId\"='${PITR_MARKER_ORG}' AND \"metadata\"->>'task'='${PITR_MARKER_TASK}' AND \"metadata\"->>'runId'='${PITR_RUN_ID}' AND \"metadata\"->>'marker'='${1}';"
}

if [[ -n "$TARGET_TS" ]] && [[ -z "$PITR_RUN_ID" ]]; then
  # Fail closed, but do not fail the drill: a targeted run without a marker id
  # is a legitimate triage restore. It simply cannot claim a verified stop
  # point, so R-032 eligibility is withheld below.
  PITR_VERIFY_STATUS="not_verified"
  log "WARNING: --target was given without --pitr-run-id — the recovery stop point is NOT verified; this run cannot be R-031/R-032 evidence"
elif [[ -n "$PITR_RUN_ID" ]]; then
  PITR_MARKER_A_COUNT="$(pitr_marker_count A)"
  PITR_MARKER_B_COUNT="$(pitr_marker_count B)"
  # TIMEZONE RULE FOR THIS COLUMN — read this before changing the query below.
  #
  # OperationalEvent.createdAt is `timestamp without time zone`, so the value
  # carries no offset of its own and the naive reading is ambiguous. It is NOT
  # ambiguous in practice: the application writes it through Prisma, which
  # serialises to UTC, so the stored wall clock IS UTC regardless of the
  # server's or the session's TimeZone. Established empirically against
  # production on 2026-08-15 — session TimeZone `Europe/Istanbul`, stored value
  # 12:57:29.852, and only the UTC reading is consistent with the archive
  # timings for that segment. The `+03` reading was rejected on that evidence.
  #
  # Consequences, both load-bearing:
  #   1. The value is emitted with a literal `Z` — a LABEL of the zone it is
  #      already in, not a shift. A conversion here would move it by the
  #      server's offset and corrupt the record.
  #   2. The `--target` derived from these markers must therefore carry `+00`.
  #      That is enforced at argument parsing, not trusted.
  PITR_MARKER_A_AT="$(q "SELECT to_char(max(\"createdAt\"),'YYYY-MM-DD') || 'T' || to_char(max(\"createdAt\"),'HH24:MI:SS.US') || 'Z' FROM \"OperationalEvent\" WHERE \"organizationId\"='${PITR_MARKER_ORG}' AND \"metadata\"->>'task'='${PITR_MARKER_TASK}' AND \"metadata\"->>'runId'='${PITR_RUN_ID}' AND \"metadata\"->>'marker'='A';")"

  PITR_VERIFY_STATUS="passed"
  if [[ "$PITR_MARKER_A_COUNT" != "1" ]]; then
    fail "PITR verification: expected exactly 1 marker A row for runId '${PITR_RUN_ID}', found '${PITR_MARKER_A_COUNT:-<unreadable>}' — recovery undershot the target or the marker was never archived"
    PITR_VERIFY_STATUS="failed"
  fi
  if [[ "$PITR_MARKER_B_COUNT" != "0" ]]; then
    fail "PITR verification: expected 0 marker B rows for runId '${PITR_RUN_ID}', found '${PITR_MARKER_B_COUNT:-<unreadable>}' — recovery OVERSHOT the target, so recovery_target_time was not honoured"
    PITR_VERIFY_STATUS="failed"
  fi

  # Independent second check. A marker pair alone cannot distinguish "stopped
  # at the target" from "stopped somewhere between A and B for an unrelated
  # reason"; the replay clock can. Both must agree.
  PITR_REPLAY_EPOCH="$(date -u -d "${RECOVERY_POINT:-}" +%s 2>/dev/null || echo "")"
  PITR_TARGET_EPOCH="$(date -u -d "${TARGET_TS}" +%s 2>/dev/null || echo "")"
  if [[ ! "$PITR_REPLAY_EPOCH" =~ ^[0-9]+$ ]] || [[ ! "$PITR_TARGET_EPOCH" =~ ^[0-9]+$ ]]; then
    fail "PITR verification: could not compare replay point '${RECOVERY_POINT:-<none>}' against target '${TARGET_TS}' — an unverifiable stop point is not a verified one"
    PITR_VERIFY_STATUS="failed"
  elif [[ "$PITR_REPLAY_EPOCH" -gt "$PITR_TARGET_EPOCH" ]]; then
    fail "PITR verification: replay reached ${RECOVERY_POINT} which is AFTER the requested target ${TARGET_TS}"
    PITR_VERIFY_STATUS="failed"
  fi

  if [[ "$PITR_VERIFY_STATUS" == "passed" ]]; then
    log "PITR stop point VERIFIED for runId ${PITR_RUN_ID}: marker A=1, marker B=0, replay ${RECOVERY_POINT} <= target ${TARGET_TS}"
  else
    RESULT="failed"
  fi
fi

T_DB_VERIFY_DONE="$(date -u +%s)"

# ── migration-set comparison against the DEPLOYED RELEASE ────────────────
#
# Counting rows in _prisma_migrations only proves that SOME migrations ran. A
# structurally healthy restore taken before the last few migrations were
# applied passes every check above and is still incompatible with the code
# currently running in production. The comparison below is what makes a stale
# restore fail.
MIGRATIONS_MISSING=0
MIGRATIONS_AHEAD=0
MIGRATIONS_EXPECTED=0
MIGRATION_COMPARE_DONE=false
if [[ "$APP_SMOKE_ENABLED" == true ]] && [[ "$RESULT" == "passed" ]]; then
  EXPECTED_MIGRATIONS="$(cd "$APP_SERVER_DIR/prisma/migrations" && find . -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort || true)"
  MIGRATIONS_EXPECTED="$(printf '%s\n' "$EXPECTED_MIGRATIONS" | grep -c . || true)"
  if [[ "$MIGRATIONS_EXPECTED" -eq 0 ]]; then
    fail "no migration directories found under ${APP_SERVER_DIR}/prisma/migrations — cannot compare the restore against the deployed release"
    RESULT="failed"
  else
    RESTORED_MIGRATIONS="$(q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;")"
    # Blank lines are stripped from both sides: `printf '%s\n' ""` yields one
    # empty line, which comm would otherwise count as a real element and report
    # as a phantom missing/ahead migration.
    MIGRATIONS_MISSING="$(comm -23 <(printf '%s\n' "$EXPECTED_MIGRATIONS" | sed '/^$/d') <(printf '%s\n' "$RESTORED_MIGRATIONS" | sed '/^$/d' | sort) | grep -c . || true)"
    MIGRATIONS_AHEAD="$(comm -13 <(printf '%s\n' "$EXPECTED_MIGRATIONS" | sed '/^$/d') <(printf '%s\n' "$RESTORED_MIGRATIONS" | sed '/^$/d' | sort) | grep -c . || true)"
    MIGRATION_COMPARE_DONE=true
    log "migration set: ${MIGRATIONS_EXPECTED} expected by the deployed release, ${MIGRATIONS_MISSING} missing from the restore, ${MIGRATIONS_AHEAD} present in the restore but not in the release"
    if [[ "$MIGRATIONS_MISSING" -ne 0 ]]; then
      fail "the restore is STALE: ${MIGRATIONS_MISSING} migration(s) that the deployed release requires are not applied in it. A structurally healthy restore that predates the running code is not a usable recovery point."
      RESULT="failed"
    fi
    if [[ "$MIGRATIONS_AHEAD" -ne 0 ]]; then
      fail "the restore is AHEAD of the deployed release by ${MIGRATIONS_AHEAD} migration(s); the running code does not match this schema"
      RESULT="failed"
    fi
  fi
fi

# ── application-level smoke, through the DEPLOYED Prisma layer ───────────
#
# Not "does psql work" — does the code that production actually runs load its
# generated Prisma client, connect, and execute typed queries against the
# restored schema. A column the client expects and the restore does not have
# surfaces here and nowhere else. The application is never started: only the
# Prisma client module is loaded, and only over the drill's unix socket.
APP_SMOKE_STATUS="skipped"
TENANT_SMOKE_STATUS="skipped"
TENANT_CROSS_CLINIC_APPTS=""
TENANT_ORPHAN_CLINIC_REFS=""
RLS_POLICY_COUNT=""
T_APP_SMOKE_DONE=""
T_TENANT_SMOKE_DONE=""

if [[ "$APP_SMOKE_ENABLED" == true ]] && [[ "$RESULT" == "passed" ]]; then
  log "running the application smoke through the deployed Prisma client in ${APP_SERVER_DIR}"
  APP_SMOKE_OUT="$(
    as_drill env \
      NORAMEDI_SMOKE_APP_DIR="$APP_SERVER_DIR" \
      NORAMEDI_SMOKE_SOCKET_DIR="$SOCK_DIR" \
      NORAMEDI_SMOKE_PORT="$DRILL_PORT" \
      NORAMEDI_SMOKE_DB="$PROD_DB_NAME" \
      NORAMEDI_SMOKE_USER="$PG_SUPERUSER" \
      node "$APP_SMOKE_SCRIPT" 2>&1 || true
  )"
  # The helper prints exactly one machine-readable line; anything else it wrote
  # is diagnostic. Neither ever contains row content.
  APP_SMOKE_LINE="$(grep -m1 '^APP_SMOKE_RESULT ' <<<"$APP_SMOKE_OUT" || true)"
  if [[ -z "$APP_SMOKE_LINE" ]]; then
    fail "the application smoke produced no result line — the deployed Prisma client could not be loaded or could not connect to the restored database"
    APP_SMOKE_STATUS="failed"
    RESULT="failed"
    echo "$APP_SMOKE_OUT" | tail -n 20 >&2
  else
    APP_SMOKE_STATUS="$(awk '{print $2}' <<<"$APP_SMOKE_LINE")"
    if [[ "$APP_SMOKE_STATUS" != "passed" ]]; then
      fail "the deployed application layer could not use the restored database (application smoke: ${APP_SMOKE_STATUS})"
      RESULT="failed"
      echo "$APP_SMOKE_OUT" | tail -n 20 >&2
    else
      log "application smoke passed: the deployed Prisma client connected and queried the restored schema"
    fi
  fi
  T_APP_SMOKE_DONE="$(date -u +%s)"

  # ── tenant-isolation smoke ─────────────────────────────────────────────
  #
  # This domain does NOT use PostgreSQL row-level security. Tenant separation
  # is a schema invariant — every tenant-scoped row carries a clinicId, and
  # related rows must agree on it — enforced in the application layer. So the
  # honest assertion is that invariant, not an RLS check that would be
  # inventing a control the system does not have. The RLS policy count is
  # recorded explicitly (expected 0) so that a future reader cannot mistake a
  # green tenant line for RLS coverage.
  TENANT_CROSS_CLINIC_APPTS="$(q "SELECT count(*) FROM \"Appointment\" a JOIN \"Patient\" p ON a.\"patientId\" = p.id WHERE a.\"clinicId\" <> p.\"clinicId\";")"
  TENANT_ORPHAN_CLINIC_REFS="$(q "SELECT (SELECT count(*) FROM \"Patient\" x LEFT JOIN \"Clinic\" c ON x.\"clinicId\"=c.id WHERE c.id IS NULL) + (SELECT count(*) FROM \"Appointment\" y LEFT JOIN \"Clinic\" c2 ON y.\"clinicId\"=c2.id WHERE c2.id IS NULL);")"
  RLS_POLICY_COUNT="$(q "SELECT count(*) FROM pg_policies;")"

  TENANT_SMOKE_STATUS="passed"
  if [[ ! "$TENANT_CROSS_CLINIC_APPTS" =~ ^[0-9]+$ ]] || [[ ! "$TENANT_ORPHAN_CLINIC_REFS" =~ ^[0-9]+$ ]]; then
    fail "the tenant-isolation smoke could not be evaluated against the restored database"
    TENANT_SMOKE_STATUS="failed"; RESULT="failed"
  else
    if [[ "$TENANT_CROSS_CLINIC_APPTS" -ne 0 ]]; then
      fail "tenant scoping is broken in the restore: ${TENANT_CROSS_CLINIC_APPTS} appointment(s) belong to a different clinic than their patient"
      TENANT_SMOKE_STATUS="failed"; RESULT="failed"
    fi
    if [[ "$TENANT_ORPHAN_CLINIC_REFS" -ne 0 ]]; then
      fail "tenant scoping is broken in the restore: ${TENANT_ORPHAN_CLINIC_REFS} tenant-scoped row(s) reference a clinic that does not exist"
      TENANT_SMOKE_STATUS="failed"; RESULT="failed"
    fi
  fi
  [[ "$TENANT_SMOKE_STATUS" == "passed" ]] && log "tenant-isolation smoke passed (clinic scoping invariants hold; RLS policies in this schema: ${RLS_POLICY_COUNT:-<unknown>}, expected 0 — this domain does not use RLS)"
  T_TENANT_SMOKE_DONE="$(date -u +%s)"
fi

# ── RPO — measured, mandatory, and compared to the program target ────────
#
# `effective_RPO_minutes: <unknown>` used to be compatible with a PASS, which
# made the single number the recovery objective is written in optional. It is
# now an assertion.
RPO_MINUTES=""
if [[ -n "$RECOVERY_POINT" ]]; then
  RP_EPOCH="$(date -u -d "$RECOVERY_POINT" +%s 2>/dev/null || echo "")"
  if [[ "$RP_EPOCH" =~ ^[0-9]+$ ]] && [[ "$RP_EPOCH" -le "$T_START" ]]; then
    RPO_MINUTES=$(( (T_START - RP_EPOCH) / 60 ))
  fi
fi
RPO_WITHIN_TARGET=false
if [[ ! "$RPO_MINUTES" =~ ^[0-9]+$ ]]; then
  fail "RPO could not be measured: no usable recovery point was obtained from the restored cluster (source: ${RPO_SOURCE}). A recovery drill that cannot state how much data would have been lost is not recovery evidence."
  RESULT="failed"
elif [[ "$RPO_MINUTES" -le "$RPO_MAX_MINUTES" ]]; then
  RPO_WITHIN_TARGET=true
  log "RPO ${RPO_MINUTES} min (source: ${RPO_SOURCE}) — WITHIN the ${RPO_MAX_MINUTES} min target"
else
  fail "RPO ${RPO_MINUTES} min exceeds the ${RPO_MAX_MINUTES} min program target (source: ${RPO_SOURCE})"
  RESULT="failed"
fi

# ── RTO — measured to the program's endpoint, not to postmaster readiness ─
#
# The superseded script computed READY_EPOCH (connections accepted) and never
# used it, then reported whole-script runtime as "RTO". The program's recovery
# objective is the point at which the SERVICE is usable, so the endpoint here
# is the completion of the application and tenant smokes. Every intermediate
# instant is preserved so that a slow stage can be identified without rerunning
# a drill that costs a full restore.
T_RTO_END="$T_DB_VERIFY_DONE"
RTO_ENDPOINT="db_verification"
if [[ -n "$T_TENANT_SMOKE_DONE" ]]; then
  T_RTO_END="$T_TENANT_SMOKE_DONE"; RTO_ENDPOINT="tenant_smoke_complete"
elif [[ -n "$T_APP_SMOKE_DONE" ]]; then
  T_RTO_END="$T_APP_SMOKE_DONE"; RTO_ENDPOINT="app_smoke_complete"
fi
RTO_SECONDS=$(( T_RTO_END - T_START ))
RTO_WITHIN_TARGET=false
if [[ "$RTO_SECONDS" -le "$RTO_MAX_SECONDS" ]]; then
  RTO_WITHIN_TARGET=true
  log "RTO ${RTO_SECONDS}s to ${RTO_ENDPOINT} — WITHIN the ${RTO_MAX_SECONDS}s target"
else
  fail "RTO ${RTO_SECONDS}s to ${RTO_ENDPOINT} exceeds the ${RTO_MAX_SECONDS}s program target"
  RESULT="failed"
fi

# ── R-032 eligibility ────────────────────────────────────────────────────
# A run only counts as first-customer restore evidence if it actually
# exercised the application and the tenant invariants against the restored
# data, and stated both objectives as numbers.
# A PITR run whose stop point was never verified is explicitly excluded: it
# proves a restore, not a point-in-time recovery, and letting it through would
# be the same class of error as accepting "pg_ctl start returned 0" as proof.
R032_ELIGIBLE=false
if [[ "$RESULT" == "passed" ]] \
   && [[ "$APP_SMOKE_STATUS" == "passed" ]] \
   && [[ "$TENANT_SMOKE_STATUS" == "passed" ]] \
   && [[ "$MIGRATION_COMPARE_DONE" == true ]] \
   && [[ "$RPO_WITHIN_TARGET" == true ]] \
   && [[ "$RTO_WITHIN_TARGET" == true ]] \
   && [[ "$PITR_VERIFY_STATUS" == "passed" || "$PITR_VERIFY_STATUS" == "not_applicable" ]]; then
  R032_ELIGIBLE=true
fi

FINISH_EPOCH="$(date -u +%s)"

# ── result document ──────────────────────────────────────────────────────
RESULT_DIR="$(dirname "$RESULT_FILE")"
if [[ -d "$RESULT_DIR" ]]; then
  RESULT_JSON="$(
    R_RESULT="$RESULT" R_REPO="$REPO_NUM" R_STANZA="$STANZA" R_RUNID="$RUN_ID" \
    R_START="$(date -u -d "@$T_START" '+%Y-%m-%dT%H:%M:%SZ')" \
    R_FINISH="$(date -u -d "@$FINISH_EPOCH" '+%Y-%m-%dT%H:%M:%SZ')" \
    R_RTO="$RTO_SECONDS" R_RPO="${RPO_MINUTES:-}" R_POINT="${RECOVERY_POINT:-}" \
    R_RPO_SOURCE="$RPO_SOURCE" R_RPO_MAX="$RPO_MAX_MINUTES" R_RPO_OK="$RPO_WITHIN_TARGET" \
    R_RTO_MAX="$RTO_MAX_SECONDS" R_RTO_OK="$RTO_WITHIN_TARGET" R_RTO_ENDPOINT="$RTO_ENDPOINT" \
    R_TARGET="${TARGET_TS:-}" R_TABLES="${TABLE_COUNT:-}" R_MIGRATIONS="${MIGRATION_COUNT:-}" \
    R_CLINICS="${CLINIC_COUNT:-}" R_PATIENTS="${PATIENT_COUNT:-}" R_APPTS="${APPOINTMENT_COUNT:-}" \
    R_APP_SMOKE="$APP_SMOKE_STATUS" R_TENANT_SMOKE="$TENANT_SMOKE_STATUS" \
    R_MIG_EXPECTED="$MIGRATIONS_EXPECTED" R_MIG_MISSING="$MIGRATIONS_MISSING" R_MIG_AHEAD="$MIGRATIONS_AHEAD" \
    R_RLS="${RLS_POLICY_COUNT:-}" R_R032="$R032_ELIGIBLE" R_LABEL="${SELECTED_LABEL:-}" \
    R_T_RESTORE_DONE="$T_RESTORE_DONE" R_T_READY="$T_CONNECTIONS_READY" R_T_PROMOTED="$T_PROMOTED" \
    R_T_DBVERIFY="$T_DB_VERIFY_DONE" R_T_APP="${T_APP_SMOKE_DONE:-}" R_T_TENANT="${T_TENANT_SMOKE_DONE:-}" \
    R_REASON="${FAIL_REASON:-}" \
    R_PITR_STATUS="$PITR_VERIFY_STATUS" R_PITR_RUNID="${PITR_RUN_ID:-}" \
    R_PITR_A="${PITR_MARKER_A_COUNT:-}" R_PITR_B="${PITR_MARKER_B_COUNT:-}" \
    R_PITR_A_AT="${PITR_MARKER_A_AT:-}" R_PITR_B_AT="${MARKER_B_AT:-}" \
    R_PITR_SEG="${MARKER_SEG:-}" R_PITR_MARKER_ORG="$PITR_MARKER_ORG" \
    R_PITR_MARKER_TASK="$PITR_MARKER_TASK" \
    node -e '
      const E = process.env;
      const uint = v => (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : undefined;
      const put = (o,k,v) => { if (v !== undefined && v !== "") o[k] = v; };
      const iso = v => { const n = uint(v); return n === undefined ? undefined : new Date(n*1000).toISOString().replace(/\.\d{3}Z$/,"Z"); };
      const d = { schemaVersion: 2, runId: E.R_RUNID, kind: "pgbackrest_pitr",
                  result: E.R_RESULT, r032Eligible: E.R_R032 === "true",
                  repo: Number(E.R_REPO), stanza: E.R_STANZA,
                  startedAt: E.R_START, finishedAt: E.R_FINISH,
                  durationMs: (uint(E.R_RTO) ?? 0) * 1000 };
      put(d, "backupLabel", E.R_LABEL);
      put(d, "sourceArtifactAt", E.R_POINT);
      put(d, "sourceArtifactAgeMinutes", uint(E.R_RPO));
      put(d, "recoveryTarget", E.R_TARGET);
      // RPO and RTO are recorded as contracts — measured value, target, and
      // an explicit verdict — so no consumer has to re-derive the comparison
      // or treat a missing number as acceptable.
      d.rpo = { minutes: uint(E.R_RPO) ?? null, source: E.R_RPO_SOURCE,
                targetMinutes: uint(E.R_RPO_MAX) ?? null, withinTarget: E.R_RPO_OK === "true" };
      d.rto = { seconds: uint(E.R_RTO) ?? null, endpoint: E.R_RTO_ENDPOINT,
                targetSeconds: uint(E.R_RTO_MAX) ?? null, withinTarget: E.R_RTO_OK === "true" };
      d.timeline = {};
      const tl = { restoreStartedAt: E.R_START };
      put(tl, "restoreCompletedAt", iso(E.R_T_RESTORE_DONE));
      put(tl, "connectionsReadyAt", iso(E.R_T_READY));
      put(tl, "promotedAt", iso(E.R_T_PROMOTED));
      put(tl, "dbVerificationCompletedAt", iso(E.R_T_DBVERIFY));
      put(tl, "appSmokeCompletedAt", iso(E.R_T_APP));
      put(tl, "tenantSmokeCompletedAt", iso(E.R_T_TENANT));
      d.timeline = tl;
      d.smoke = { application: E.R_APP_SMOKE, tenantIsolation: E.R_TENANT_SMOKE,
                  rlsPolicies: uint(E.R_RLS) ?? null, rlsUsedByDomain: false };
      d.migrations = { expectedFromDeployedRelease: uint(E.R_MIG_EXPECTED) ?? null,
                       missingFromRestore: uint(E.R_MIG_MISSING) ?? null,
                       aheadOfRelease: uint(E.R_MIG_AHEAD) ?? null };
      d.counts = { tables: uint(E.R_TABLES) ?? 0, migrations: uint(E.R_MIGRATIONS) ?? 0,
                   clinics: uint(E.R_CLINICS) ?? 0, patients: uint(E.R_PATIENTS) ?? 0,
                   appointments: uint(E.R_APPTS) ?? 0 };
      // Durable PITR proof. Every field is a count, a timestamp, a WAL segment
      // name or a sentinel literal — no tenant, patient or clinical value can
      // reach this document. `verified` is the single boolean a reader should
      // trust; the operands are recorded so the verdict can be re-derived
      // without rerunning a drill that costs a full restore.
      const p = { status: E.R_PITR_STATUS,
                  verified: E.R_PITR_STATUS === "passed" };
      put(p, "runId", E.R_PITR_RUNID);
      put(p, "markerOrganizationId", E.R_PITR_MARKER_ORG);
      put(p, "markerTask", E.R_PITR_MARKER_TASK);
      if (E.R_PITR_STATUS === "passed" || E.R_PITR_STATUS === "failed") {
        p.markerACount = uint(E.R_PITR_A) ?? null;
        p.markerBCount = uint(E.R_PITR_B) ?? null;
        p.expected = { markerACount: 1, markerBCount: 0 };
      }
      put(p, "markerAAt", E.R_PITR_A_AT);
      put(p, "markerBAt", E.R_PITR_B_AT);
      // Stated, not implied. OperationalEvent.createdAt is a naive column, so a
      // future reader comparing markerAAt against recoveryTarget has no way to
      // know which zone it is in — and guessing wrong shifts the comparison by
      // whole hours. Recording the rule alongside the values is what stops that
      // question from being re-litigated from an artifact nobody can re-run.
      p.markerTimestampZone = "UTC";
      put(p, "markerWalSegment", E.R_PITR_SEG);
      put(p, "recoveryTarget", E.R_TARGET);
      put(p, "replayedTo", E.R_POINT);
      d.pitrVerification = p;
      // Bounded and shape-checked: a failure reason must never carry restore
      // stderr, which can embed row values (e.g. `Key (email)=(...)`).
      if (E.R_REASON) d.failureSummary = String(E.R_REASON).slice(0,160).replace(/[^\x20-\x7E]/g," ");
      process.stdout.write(JSON.stringify(d, null, 2) + "\n");
    '
  )"
  TMP_RESULT="$(mktemp "${RESULT_DIR}/.pitr-drill.XXXXXX")"
  printf '%s' "$RESULT_JSON" > "$TMP_RESULT"
  chmod 0600 "$TMP_RESULT"
  mv -f "$TMP_RESULT" "$RESULT_FILE"
  log "result written to ${RESULT_FILE}"
else
  log "WARNING: '${RESULT_DIR}' does not exist — result JSON not written"
fi

# ── off-host proof marker ────────────────────────────────────────────────
# Written ONLY on a pass, ONLY from repo >= 2, ONLY when explicitly asked, and
# ONLY when the run is R-032 eligible. This marker is the sole thing that lets
# the reported off-host state reach "yes". A configured remote repository
# proves nothing: a remote-looking host can still be this machine, and an
# existing repository is not evidence that anything can be restored from it.
if [[ "$DO_RECORD" == true ]]; then
  if [[ "$RESULT" != "passed" ]]; then
    log "not writing the off-host proof marker: the drill did not pass"
  elif [[ "$R032_ELIGIBLE" != true ]]; then
    log "not writing the off-host proof marker: this run is not R-032 eligible (application smoke='${APP_SMOKE_STATUS}', tenant smoke='${TENANT_SMOKE_STATUS}', migration comparison=${MIGRATION_COMPARE_DONE}). A restore nobody proved the application can use is not proof of recoverability."
  elif [[ "$REPO_NUM" -lt 2 ]]; then
    log "not writing the off-host proof marker: repo${REPO_NUM} is the LOCAL repository, which is not an independent failure domain"
  else
    PROOF_DIR="$(dirname "$OFFHOST_PROOF")"
    if [[ -d "$PROOF_DIR" ]]; then
      # The proof records WHICH target it was earned against, so that
      # repointing repo2 at a different host cannot inherit it. The status
      # writer compares this against the currently-configured repo2 and
      # discards a proof that does not match. Without the binding, a 29-day-old
      # proof would keep a brand-new, never-restored-from destination showing a
      # green "off-host" tick.
      PROOF_TARGET="$(grep -oE '^[[:space:]]*repo2-(host|s3-endpoint|path)[[:space:]]*=[[:space:]]*[^[:space:]]+' "${NORAMEDI_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}" 2>/dev/null \
        | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
      TMP_PROOF="$(mktemp "${PROOF_DIR}/.pitr-proof.XXXXXX")"
      printf '{\n  "schemaVersion": 1,\n  "result": "passed",\n  "repo": %s,\n  "stanza": "%s",\n  "target": "%s",\n  "runId": "%s",\n  "finishedAt": "%s"\n}\n' \
        "$REPO_NUM" "$STANZA" "${PROOF_TARGET:-unknown}" "$RUN_ID" "$(date -u -d "@$FINISH_EPOCH" '+%Y-%m-%dT%H:%M:%SZ')" > "$TMP_PROOF"
      chmod 0600 "$TMP_PROOF"
      mv -f "$TMP_PROOF" "$OFFHOST_PROOF"
      log "off-host proof marker written to ${OFFHOST_PROOF}"
    else
      log "WARNING: '${PROOF_DIR}' does not exist — proof marker not written"
    fi
  fi
fi

# ── evidence summary ─────────────────────────────────────────────────────
S_APP_SMOKE="<skipped>"; [[ -n "$T_APP_SMOKE_DONE" ]] && S_APP_SMOKE="$(( T_APP_SMOKE_DONE - T_START ))"
S_TENANT_SMOKE="<skipped>"; [[ -n "$T_TENANT_SMOKE_DONE" ]] && S_TENANT_SMOKE="$(( T_TENANT_SMOKE_DONE - T_START ))"
cat <<EOF

===== PITR DRILL EVIDENCE SUMMARY (safe to copy verbatim — no PII) =====
run_id:                     ${RUN_ID}
stanza:                     ${STANZA}
repository:                 repo${REPO_NUM} $( [[ "$REPO_NUM" -eq 1 ]] && echo "(LOCAL — not an independent failure domain)" || echo "(off-host candidate)" )
backup_label:               ${SELECTED_LABEL:-<latest>}
recovery_target:            ${TARGET_TS:-<latest, no target>}
recovery_point_reached:     ${RECOVERY_POINT:-<unknown>}
recovery_point_source:      ${RPO_SOURCE}
still_in_recovery:          ${IN_RECOVERY:-<unknown>}
effective_RPO_minutes:      ${RPO_MINUTES:-<unmeasured — this fails the drill>}
RPO_target_minutes:         ${RPO_MAX_MINUTES}
RPO_within_target:          ${RPO_WITHIN_TARGET}
measured_RTO_seconds:       ${RTO_SECONDS}
RTO_endpoint:               ${RTO_ENDPOINT}
RTO_target_seconds:         ${RTO_MAX_SECONDS}
RTO_within_target:          ${RTO_WITHIN_TARGET}
  restore_seconds:          $(( T_RESTORE_DONE - T_START ))
  to_connections_ready_s:   $(( T_CONNECTIONS_READY - T_START ))
  to_promotion_s:           $(( T_PROMOTED - T_START ))
  to_db_verification_s:     $(( T_DB_VERIFY_DONE - T_START ))
  to_app_smoke_s:           ${S_APP_SMOKE}
  to_tenant_smoke_s:        ${S_TENANT_SMOKE}
public_tables:              ${TABLE_COUNT:-<unknown>}
applied_migrations:         ${MIGRATION_COUNT:-<unknown>}
unfinished_migrations:      ${FAILED_MIGRATIONS:-<unknown>}
rolled_back_migrations:     ${ROLLED_BACK_MIGRATIONS:-<unknown>}
migrations_expected:        ${MIGRATIONS_EXPECTED} (from the deployed release)
migrations_missing:         ${MIGRATIONS_MISSING}
migrations_ahead:           ${MIGRATIONS_AHEAD}
application_smoke:          ${APP_SMOKE_STATUS}
tenant_isolation_smoke:     ${TENANT_SMOKE_STATUS}
cross_clinic_appointments:  ${TENANT_CROSS_CLINIC_APPTS:-<not evaluated>}
orphan_clinic_references:   ${TENANT_ORPHAN_CLINIC_REFS:-<not evaluated>}
rls_policies:               ${RLS_POLICY_COUNT:-<not evaluated>} (expected 0 — this domain does NOT use RLS)
clinics:                    ${CLINIC_COUNT:-<unknown>}
patients:                   ${PATIENT_COUNT:-<unknown>}
appointments:               ${APPOINTMENT_COUNT:-<unknown>}
orphaned_appointments:      ${ORPHAN_APPTS:-<unknown>}
result:                     $( [[ "$RESULT" == "passed" ]] && echo PASS || echo FAIL )
R032_eligible:              ${R032_ELIGIBLE}
========================================================================
EOF

if [[ "$RESULT" != "passed" ]]; then
  echo "${LOG_PREFIX} No success may be recorded in evidence for this run." >&2
  exit 1
fi
if [[ "$R032_ELIGIBLE" != true ]]; then
  echo "${LOG_PREFIX} This run PASSED but is NOT R-032 evidence: the application/tenant smoke stages did not both run and pass." >&2
fi
exit 0

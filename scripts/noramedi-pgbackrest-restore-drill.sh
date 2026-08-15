#!/usr/bin/env bash
# noramedi-pgbackrest-restore-drill.sh — F4-FCR-002
# Deploy to: /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh
# chmod +x /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh
#
# Restores a pgBackRest backup — optionally to an arbitrary point in time —
# into a DISPOSABLE, RAM-BACKED, LOOPBACK-ONLY PostgreSQL cluster, runs
# structural and application smoke checks against it, measures effective RPO
# and RTO, and destroys it.
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
#     `SHOW data_directory`, not against a hardcoded path)
#   - listen on the production PostgreSQL port
#   - create or touch a database named noramedi_crm
#   - run any PostgreSQL operation as root or as any UID 0 account
#   - bind to anything other than 127.0.0.1 (verified at RUNTIME, after the
#     postmaster is up, not merely configured)
#   - write restored patient bytes to persistent disk
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
# Usage:
#   noramedi-pgbackrest-restore-drill.sh [--target "YYYY-MM-DD HH:MM:SS+03"]
#                                        [--set BACKUP_LABEL] [--repo N]
#                                        [--stanza NAME] [--port PORT]
#                                        [--result-file PATH] [--record]
#                                        [--keep-on-failure] [-h|--help]
#
# Options:
#   --target TS       PITR target timestamp. Omit to restore the latest
#                     backup with no recovery target.
#   --set LABEL       Restore a specific backup label instead of the latest.
#   --repo N          Repository to restore FROM (1 = local, 2 = off-host).
#                     Default 1. Restoring from repo 2 is the ONLY thing that
#                     can prove off-host recoverability — see --record.
#   --port PORT       Scratch port. Default 55433 (backup-restore-rehearsal.sh
#                     already uses 55432; they must not collide).
#   --result-file P   Where to write the machine-readable result JSON.
#                     Default /var/lib/noramedi/pitr-drill-result.json
#   --record          After a PASS, additionally write the off-host proof
#                     marker (only meaningful with --repo 2). This marker is
#                     what upgrades the reported off-host state from
#                     "unproven" to "yes" — configuration alone never does.
#   --keep-on-failure Leave the scratch cluster for post-mortem. It contains
#                     REAL PATIENT DATA; delete it manually and promptly.
#
# Environment:
#   REHEARSAL_OS_USER   REQUIRED when invoked as root. No implicit default:
#                       silently picking `postgres` would be a privilege
#                       decision made by a script instead of an operator.
#   NORAMEDI_PGBACKREST_DRILL_ROOT   default /dev/shm/noramedi-pitr-drill
#   NORAMEDI_PITR_DRILL_RESULT_FILE  default /var/lib/noramedi/pitr-drill-result.json
#   NORAMEDI_PGBACKREST_OFFHOST_PROOF default /var/lib/noramedi/pitr-offhost-proof.json
#   NORAMEDI_PG_SUPERUSER            default postgres
#   PROD_PG_PORT                     default 5432
#   PG_BINDIR                        auto-detected
#
# Exit codes:
#   0  PASS   1  FAIL   2  usage/CLI error   3  precondition failure

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
PROD_DB_NAME="noramedi_crm"

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }

RUN_ID="$(date -u '+%Y%m%d-%H%M%S')-$$"
LOG_PREFIX="[pitr-drill ${RUN_ID}]"
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "${LOG_PREFIX} $(timestamp) $*"; }
ABORTED=false
FAIL_REASON=""
fail() { ABORTED=true; FAIL_REASON="${1}"; echo "${LOG_PREFIX} $(timestamp) FAIL — $*" >&2; }

TARGET_TS=""
BACKUP_SET=""
REPO_NUM=1
STANZA="noramedi"
DRILL_PORT=55433
RESULT_FILE_OVERRIDE=""
DO_RECORD=false
KEEP_ON_FAILURE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)          TARGET_TS="${2:-}"; shift 2 ;;
    --set)             BACKUP_SET="${2:-}"; shift 2 ;;
    --repo)            REPO_NUM="${2:-}"; shift 2 ;;
    --stanza)          STANZA="${2:-}"; shift 2 ;;
    --port)            DRILL_PORT="${2:-}"; shift 2 ;;
    --result-file)     RESULT_FILE_OVERRIDE="${2:-}"; shift 2 ;;
    --record)          DO_RECORD=true; shift ;;
    --keep-on-failure) KEEP_ON_FAILURE=true; shift ;;
    -h|--help)         usage ;;
    *) echo "Unknown option: $1" >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

[[ "$STANZA" =~ ^[a-z0-9][a-z0-9_]{0,31}$ ]] || { echo "Invalid --stanza" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
[[ "$REPO_NUM" =~ ^[1-4]$ ]] || { echo "Invalid --repo '$REPO_NUM' (expected 1-4)" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
[[ "$DRILL_PORT" =~ ^[0-9]+$ ]] && [[ "$DRILL_PORT" -ge 1024 ]] && [[ "$DRILL_PORT" -le 65535 ]] \
  || { echo "Invalid --port '$DRILL_PORT'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
# The target string is interpolated into a pgbackrest argument. Constrain it to
# a timestamp shape instead of trusting the caller.
if [[ -n "$TARGET_TS" ]] && [[ ! "$TARGET_TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[\ T][0-9]{2}:[0-9]{2}:[0-9]{2}([+-][0-9]{2}(:?[0-9]{2})?|Z)?$ ]]; then
  echo "Invalid --target '$TARGET_TS' (expected 'YYYY-MM-DD HH:MM:SS[+TZ]')" >&2
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
RESULT_FILE="${RESULT_FILE_OVERRIDE:-${NORAMEDI_PITR_DRILL_RESULT_FILE:-/var/lib/noramedi/pitr-drill-result.json}}"
OFFHOST_PROOF="${NORAMEDI_PGBACKREST_OFFHOST_PROOF:-/var/lib/noramedi/pitr-offhost-proof.json}"
PG_SUPERUSER="${NORAMEDI_PG_SUPERUSER:-postgres}"
PROD_PG_PORT="${PROD_PG_PORT:-5432}"

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

# ── cleanup ──────────────────────────────────────────────────────────────
STARTED=false
cleanup() {
  if [[ "$STARTED" == true ]]; then
    as_drill "${PG_CTL}" -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ "$ABORTED" == true ]] && [[ "$KEEP_ON_FAILURE" == true ]]; then
    echo "${LOG_PREFIX} KEEPING ${DRILL_ROOT} for post-mortem." >&2
    echo "${LOG_PREFIX} ⚠ IT CONTAINS A COMPLETE CROSS-TENANT COPY OF THE PATIENT DATABASE." >&2
    echo "${LOG_PREFIX} ⚠ Remove it as soon as the post-mortem is done: rm -rf ${DRILL_ROOT}" >&2
  else
    rm -rf "$DRILL_ROOT" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── preconditions ────────────────────────────────────────────────────────
command -v pgbackrest >/dev/null 2>&1 || { fail "pgbackrest is not installed"; exit "$PRECONDITION_EXIT_CODE"; }

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

# ── REFUSAL 1: never the production data directory ───────────────────────
# Read from the live cluster rather than compared against a hardcoded path, so
# this stays correct if PGDATA is ever moved.
PROD_PGDATA=""
if command -v runuser >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
  PROD_PGDATA="$(runuser -u "$PG_SUPERUSER" -- /bin/bash -c "psql -Atc \"SHOW data_directory;\"" 2>/dev/null || true)"
fi
if [[ -n "$PROD_PGDATA" ]]; then
  REAL_DRILL="$(readlink -f "$PGDATA_DIR" 2>/dev/null || echo "$PGDATA_DIR")"
  REAL_PROD="$(readlink -f "$PROD_PGDATA" 2>/dev/null || echo "$PROD_PGDATA")"
  if [[ "$REAL_DRILL" == "$REAL_PROD" ]] || [[ "$REAL_DRILL" == "$REAL_PROD"/* ]] || [[ "$REAL_PROD" == "$REAL_DRILL"/* ]]; then
    fail "REFUSING: the drill path resolves inside the PRODUCTION data directory"
    exit "$PRECONDITION_EXIT_CODE"
  fi
  log "production PGDATA is '${REAL_PROD}' — drill path is disjoint"
else
  log "WARNING: could not read the production data_directory; relying on the scratch path and port guards alone"
fi

# ── prepare scratch space ────────────────────────────────────────────────
mkdir -p "$DRILL_ROOT"
chmod 700 "$DRILL_ROOT"
if [[ "$(id -u)" -eq 0 ]]; then chown "$DRILL_USER" "$DRILL_ROOT"; fi
as_drill mkdir -p "$PGDATA_DIR"
as_drill chmod 700 "$PGDATA_DIR"

# ── restore ──────────────────────────────────────────────────────────────
START_EPOCH="$(date -u +%s)"
RESTORE_ARGS=(pgbackrest --stanza="$STANZA" --repo="$REPO_NUM" --pg1-path="$PGDATA_DIR")
if [[ -n "$BACKUP_SET" ]]; then RESTORE_ARGS+=(--set="$BACKUP_SET"); fi
if [[ -n "$TARGET_TS" ]]; then RESTORE_ARGS+=(--type=time --target="$TARGET_TS" --target-action=promote); fi
RESTORE_ARGS+=(restore)

log "restoring from repo${REPO_NUM}${TARGET_TS:+ to target '${TARGET_TS}'}"
if ! as_drill "${RESTORE_ARGS[@]}"; then
  fail "pgbackrest restore failed"
  exit 1
fi
RESTORE_DONE_EPOCH="$(date -u +%s)"
log "restore completed in $(( RESTORE_DONE_EPOCH - START_EPOCH ))s"

# ── REFUSAL 2: loopback-only, scratch port ───────────────────────────────
#
# ⚠ ON DEBIAN/UBUNTU THE CONFIG FILES DO NOT LIVE IN PGDATA.
# postgresql.conf, pg_hba.conf and pg_ident.conf are in
# /etc/postgresql/<ver>/<cluster>/, while pgBackRest backs up pg1-path only.
# A restored PGDATA therefore contains NONE of them, and a postmaster started
# against it fails with `could not open configuration file ".../pg_hba.conf"` —
# which the generic start-failure diagnostic below would have blamed on
# recovery not reaching a consistent point, sending the operator to look in
# entirely the wrong place.
#
# So the drill SYNTHESISES the three files it needs. They are deliberately
# minimal and deliberately trust-auth: the cluster is RAM-backed, bound to
# loopback only, on a scratch port, and destroyed on exit — there is no
# network path to it, and adding password auth would mean inventing a
# credential for a cluster that lives for seconds.
as_drill /bin/bash -c "cat > $(printf '%q' "$PGDATA_DIR")/pg_hba.conf <<'HBA'
# noramedi PITR drill — disposable cluster, loopback only, destroyed on exit.
local   all   all                  trust
host    all   all   127.0.0.1/32   trust
host    all   all   ::1/128        trust
HBA"
as_drill /bin/bash -c ": > $(printf '%q' "$PGDATA_DIR")/pg_ident.conf"
as_drill chmod 600 "$PGDATA_DIR/pg_hba.conf" "$PGDATA_DIR/pg_ident.conf"

# Appended (not overwritten) because pgbackrest restore writes recovery
# settings into postgresql.auto.conf and may have left a postgresql.conf.
as_drill /bin/bash -c "cat >> $(printf '%q' "$PGDATA_DIR")/postgresql.conf <<'CONF'

# --- noramedi PITR drill overrides (appended by the drill script) ---
listen_addresses = '127.0.0.1'
port = ${DRILL_PORT}
unix_socket_directories = '${DRILL_ROOT}'
hba_file = '${PGDATA_DIR}/pg_hba.conf'
ident_file = '${PGDATA_DIR}/pg_ident.conf'
CONF"

# Fail with the RIGHT diagnostic if the synthesis did not take effect, rather
# than letting a missing auth file masquerade as a recovery problem.
for required in postgresql.conf pg_hba.conf pg_ident.conf; do
  if ! as_drill test -f "$PGDATA_DIR/$required"; then
    fail "'$required' is missing from the restored data directory — on Debian/Ubuntu these live outside PGDATA and are not part of the backup; the drill synthesises them, so this means the synthesis step failed"
    exit 1
  fi
done

log "starting disposable cluster on 127.0.0.1:${DRILL_PORT}"
# hba_file/ident_file are ALSO passed on the command line: a postgresql.conf
# restored from the backup could contain its own absolute hba_file pointing at
# /etc/postgresql/..., and -o wins over the file.
if ! as_drill "$PG_CTL" -D "$PGDATA_DIR" \
     -o "-c logging_collector=off -c hba_file=$PGDATA_DIR/pg_hba.conf -c ident_file=$PGDATA_DIR/pg_ident.conf" \
     -w -t 120 start; then
  fail "the restored cluster did not start — check the postmaster log under ${PGDATA_DIR}/log (recovery may not have reached a consistent point, or a config file is missing)"
  exit 1
fi
STARTED=true

# RUNTIME verification, not a config assertion: confirm nothing outside
# loopback was actually bound before any query touches patient data.
BOUND="$(as_drill "$PSQL" -h 127.0.0.1 -p "$DRILL_PORT" -d postgres -Atc "SHOW listen_addresses;" 2>/dev/null || true)"
if [[ "$BOUND" != "127.0.0.1" ]]; then
  fail "REFUSING to continue: restored cluster reports listen_addresses='${BOUND}', expected exactly 127.0.0.1"
  exit 1
fi
log "loopback binding verified at runtime"

READY_EPOCH="$(date -u +%s)"

# ── smoke checks ─────────────────────────────────────────────────────────
# Counts and booleans only. No row content is ever printed — the whole point
# of the disposable cluster is that patient bytes stay inside it.
q() { as_drill "$PSQL" -h 127.0.0.1 -p "$DRILL_PORT" -d "$PROD_DB_NAME" -Atc "$1" 2>/dev/null || echo ""; }

# `pg_ctl -w` returns as soon as the postmaster ACCEPTS CONNECTIONS, which on
# PostgreSQL 16 (hot_standby defaults to on) happens while recovery is still
# replaying. Sampling pg_is_in_recovery() immediately would therefore report
# `t` on a perfectly good restore and fail the drill for a reason that is not
# true — a false RED on the one artifact that produces R-032 evidence.
# Poll until promotion completes, bounded.
RECOVERY_WAIT_SECONDS="${NORAMEDI_PITR_DRILL_RECOVERY_WAIT_SECONDS:-180}"
[[ "$RECOVERY_WAIT_SECONDS" =~ ^[0-9]+$ ]] || RECOVERY_WAIT_SECONDS=180
log "waiting up to ${RECOVERY_WAIT_SECONDS}s for recovery to reach its target and promote"
IN_RECOVERY=""
_waited=0
while [[ "$_waited" -lt "$RECOVERY_WAIT_SECONDS" ]]; do
  IN_RECOVERY="$(as_drill "$PSQL" -h 127.0.0.1 -p "$DRILL_PORT" -d postgres -Atc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "")"
  [[ "$IN_RECOVERY" == "f" ]] && break
  sleep 2
  _waited=$(( _waited + 2 ))
done
[[ "$IN_RECOVERY" == "f" ]] && log "recovery completed after ${_waited}s" \
  || log "still in recovery after ${_waited}s — the smoke checks below will fail this drill"

# Built by concatenation rather than to_char's double-quoted literals: this
# string passes through as_drill's build_cmd and then a shell -c on the far
# side, and a stripped `"T"` would silently turn into to_char's ordinal-suffix
# pattern rather than an ISO separator.
RECOVERY_POINT="$(as_drill "$PSQL" -h 127.0.0.1 -p "$DRILL_PORT" -d postgres -Atc "SELECT to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC','HH24:MI:SS') || 'Z';" 2>/dev/null || echo "")"

TABLE_COUNT="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
MIGRATION_COUNT="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")"
FAILED_MIGRATIONS="$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;")"
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
[[ "$CLINIC_COUNT" =~ ^[0-9]+$ ]]                                      || { fail "Clinic table unreadable"; RESULT="failed"; }
[[ "$PATIENT_COUNT" =~ ^[0-9]+$ ]]                                     || { fail "Patient table unreadable"; RESULT="failed"; }
[[ "$ORPHAN_APPTS" == "0" ]]                                           || { fail "referential integrity broken: $ORPHAN_APPTS appointments without a patient"; RESULT="failed"; }
[[ "$IN_RECOVERY" == "f" ]]                                            || { fail "cluster is still in recovery — the target was not reached"; RESULT="failed"; }

FINISH_EPOCH="$(date -u +%s)"
RTO_SECONDS=$(( FINISH_EPOCH - START_EPOCH ))

# Effective RPO: how far behind the recovery point is from the drill start.
RPO_MINUTES=""
if [[ -n "$RECOVERY_POINT" ]]; then
  RP_EPOCH="$(date -u -d "$RECOVERY_POINT" +%s 2>/dev/null || echo "")"
  if [[ "$RP_EPOCH" =~ ^[0-9]+$ ]] && [[ "$RP_EPOCH" -le "$START_EPOCH" ]]; then
    RPO_MINUTES=$(( (START_EPOCH - RP_EPOCH) / 60 ))
  fi
fi

# ── result document ──────────────────────────────────────────────────────
RESULT_DIR="$(dirname "$RESULT_FILE")"
if [[ -d "$RESULT_DIR" ]]; then
  RESULT_JSON="$(
    R_RESULT="$RESULT" R_REPO="$REPO_NUM" R_STANZA="$STANZA" R_RUNID="$RUN_ID" \
    R_START="$(date -u -d "@$START_EPOCH" '+%Y-%m-%dT%H:%M:%SZ')" \
    R_FINISH="$(date -u -d "@$FINISH_EPOCH" '+%Y-%m-%dT%H:%M:%SZ')" \
    R_RTO="$RTO_SECONDS" R_RPO="${RPO_MINUTES:-}" R_POINT="${RECOVERY_POINT:-}" \
    R_TARGET="${TARGET_TS:-}" R_TABLES="${TABLE_COUNT:-}" R_MIGRATIONS="${MIGRATION_COUNT:-}" \
    R_CLINICS="${CLINIC_COUNT:-}" R_PATIENTS="${PATIENT_COUNT:-}" R_APPTS="${APPOINTMENT_COUNT:-}" \
    R_REASON="${FAIL_REASON:-}" \
    node -e '
      const E = process.env;
      const uint = v => (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : undefined;
      const put = (o,k,v) => { if (v !== undefined && v !== "") o[k] = v; };
      const d = { schemaVersion: 1, runId: E.R_RUNID, kind: "pgbackrest_pitr",
                  result: E.R_RESULT, repo: Number(E.R_REPO), stanza: E.R_STANZA,
                  startedAt: E.R_START, finishedAt: E.R_FINISH,
                  durationMs: (uint(E.R_RTO) ?? 0) * 1000 };
      put(d, "sourceArtifactAt", E.R_POINT);
      put(d, "sourceArtifactAgeMinutes", uint(E.R_RPO));
      put(d, "recoveryTarget", E.R_TARGET);
      d.counts = { tables: uint(E.R_TABLES) ?? 0, migrations: uint(E.R_MIGRATIONS) ?? 0,
                   clinics: uint(E.R_CLINICS) ?? 0, patients: uint(E.R_PATIENTS) ?? 0,
                   appointments: uint(E.R_APPTS) ?? 0 };
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
# Written ONLY on a pass, ONLY from repo >= 2, and ONLY when explicitly asked.
# This marker is the sole thing that lets the reported off-host state reach
# "yes". A configured remote repository proves nothing: a remote-looking host
# can still be this machine, and an existing repository is not evidence that
# anything can be restored from it.
if [[ "$DO_RECORD" == true ]]; then
  if [[ "$RESULT" != "passed" ]]; then
    log "not writing the off-host proof marker: the drill did not pass"
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
cat <<EOF

===== PITR DRILL EVIDENCE SUMMARY (safe to copy verbatim — no PII) =====
run_id:                     ${RUN_ID}
stanza:                     ${STANZA}
repository:                 repo${REPO_NUM} $( [[ "$REPO_NUM" -eq 1 ]] && echo "(LOCAL — not an independent failure domain)" || echo "(off-host candidate)" )
recovery_target:            ${TARGET_TS:-<latest, no target>}
recovery_point_reached:     ${RECOVERY_POINT:-<unknown>}
still_in_recovery:          ${IN_RECOVERY:-<unknown>}
measured_RTO_seconds:       ${RTO_SECONDS}
effective_RPO_minutes:      ${RPO_MINUTES:-<unknown>}
public_tables:              ${TABLE_COUNT:-<unknown>}
applied_migrations:         ${MIGRATION_COUNT:-<unknown>}
unfinished_migrations:      ${FAILED_MIGRATIONS:-<unknown>}
clinics:                    ${CLINIC_COUNT:-<unknown>}
patients:                   ${PATIENT_COUNT:-<unknown>}
appointments:               ${APPOINTMENT_COUNT:-<unknown>}
orphaned_appointments:      ${ORPHAN_APPTS:-<unknown>}
result:                     $( [[ "$RESULT" == "passed" ]] && echo PASS || echo FAIL )
========================================================================
EOF

if [[ "$RESULT" != "passed" ]]; then
  echo "${LOG_PREFIX} No success may be recorded in evidence for this run." >&2
  exit 1
fi
exit 0

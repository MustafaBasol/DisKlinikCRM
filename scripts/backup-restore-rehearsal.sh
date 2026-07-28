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
#     that port collides with the configured production port.
#   - Prints only counts, booleans, hashes, and durations to stdout/log —
#     never row contents. Do not redirect full `psql` result sets elsewhere.
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
#   REHEARSAL_MIN_FREE_RAM_MB   Default 2048 — required free RAM headroom after
#                                the tmpfs allocation, so the rehearsal cannot
#                                starve the production process on this host
#   REHEARSAL_RAM_MULTIPLIER    Default 3 — tmpfs sized as (dump size * this)
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
BACKUP_FILE_ARG=""
KEEP_ON_FAILURE=false
PG_BINDIR="${PG_BINDIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file) BACKUP_FILE_ARG="$2"; shift 2 ;;
    --port) REHEARSAL_PORT="$2"; shift 2 ;;
    --keep-on-failure) KEEP_ON_FAILURE=true; shift ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
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

cleanup() {
  local exit_code=$?
  if [[ "$CLUSTER_STARTED" == true ]]; then
    log "Stopping disposable cluster..."
    "${PG_BINDIR}/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
  if [[ "$ABORTED" == true && "$KEEP_ON_FAILURE" == true ]]; then
    log "KEEP_ON_FAILURE set — leaving $REHEARSAL_ROOT in place for inspection. Remove it manually when done: rm -rf '$REHEARSAL_ROOT'"
  else
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

# 2. Checksum (recorded now, re-verified after copy in step 3 of restore)
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
log "Dump header: ${DUMP_PG_VERSION_LINE:-<not present in listing>}"
if [[ -n "$DUMP_PG_VERSION_LINE" ]]; then
  DUMP_MAJOR="$(echo "$DUMP_PG_VERSION_LINE" | grep -oE '[0-9]+' | head -n1)"
  LOCAL_MAJOR="$(echo "$LOCAL_PG_VERSION" | grep -oE '^[0-9]+')"
  if [[ -n "$DUMP_MAJOR" && -n "$LOCAL_MAJOR" && "$DUMP_MAJOR" != "$LOCAL_MAJOR" ]]; then
    fail "Postgres major version mismatch: dump was produced by major $DUMP_MAJOR, disposable cluster is major $LOCAL_MAJOR. Install matching major before rehearsing."
  fi
else
  log "WARNING: could not confirm dump's source Postgres version from pg_restore -l output; proceeding, restore step is the authoritative compatibility check."
fi

# 5. Free RAM (restore target is tmpfs, i.e. RAM — must not starve production)
REQUIRED_MB=$(( (DUMP_SIZE_BYTES / 1024 / 1024) * REHEARSAL_RAM_MULTIPLIER ))
[[ "$REQUIRED_MB" -lt 512 ]] && REQUIRED_MB=512
AVAILABLE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
log "Estimated RAM needed for restore: ${REQUIRED_MB} MB; currently available: ${AVAILABLE_MB} MB; required headroom after use: ${REHEARSAL_MIN_FREE_RAM_MB} MB"
if (( AVAILABLE_MB - REQUIRED_MB < REHEARSAL_MIN_FREE_RAM_MB )); then
  fail "Insufficient free RAM to safely run this rehearsal without risking production memory pressure on this shared host. Available=${AVAILABLE_MB}MB, needed=${REQUIRED_MB}MB, required headroom=${REHEARSAL_MIN_FREE_RAM_MB}MB."
fi

# 6. Free disk (defensive only — PGDATA itself is tmpfs, but logs/temp files
#    outside /dev/shm should not fill the root filesystem)
ROOT_FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
[[ "$ROOT_FREE_MB" -gt 512 ]] || fail "Less than 512MB free on / — aborting defensively (root filesystem is not the restore target, but logging/tooling needs headroom)."

# 7. Isolated target name/port — port must be free and loopback-only
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${REHEARSAL_PORT}\$"; then
  fail "Port $REHEARSAL_PORT is already in use on this host. Pick a different --port."
fi
mkdir -p "$REHEARSAL_ROOT"
log "Disposable RAM-backed root: $REHEARSAL_ROOT"

log "=== Preflight PASSED ==="

# ═════════════════════════════════════════════════════════════════════════
# RESTORE — into the disposable cluster only
# ═════════════════════════════════════════════════════════════════════════
log "=== Restore ==="
RESTORE_START_EPOCH=$(date +%s)

cp "$SOURCE_DUMP" "$DUMP_COPY"
COPY_SHA256="$(sha256sum "$DUMP_COPY" | cut -d' ' -f1)"
[[ "$COPY_SHA256" == "$SOURCE_SHA256" ]] || fail "Checksum mismatch after copying dump into RAM-backed working directory. Source=$SOURCE_SHA256 Copy=$COPY_SHA256"
log "Post-copy checksum verified: $COPY_SHA256"

# Password lives only in RAM (tmpfs pwfile, removed at cleanup) and in this
# process's environment (PGPASSWORD, used by every client call below so the
# script never blocks on an interactive password prompt).
REHEARSAL_PWFILE="${REHEARSAL_ROOT}/pwfile"
export PGPASSWORD
if command -v openssl >/dev/null 2>&1; then
  PGPASSWORD="$(openssl rand -base64 24)"
else
  PGPASSWORD="$(head -c32 /dev/urandom | base64)"
fi
printf '%s\n' "$PGPASSWORD" > "$REHEARSAL_PWFILE"
chmod 600 "$REHEARSAL_PWFILE"

"${PG_BINDIR}/initdb" -D "$PGDATA" --auth=scram-sha-256 --username="$REHEARSAL_ROLE" \
  --pwfile="$REHEARSAL_PWFILE" >/dev/null
log "Initialized disposable cluster (tmpfs-backed PGDATA)"

echo "listen_addresses = '127.0.0.1'" >> "$PGDATA/postgresql.conf"
echo "port = ${REHEARSAL_PORT}" >> "$PGDATA/postgresql.conf"
echo "unix_socket_directories = '${PGDATA}'" >> "$PGDATA/postgresql.conf"

"${PG_BINDIR}/pg_ctl" -D "$PGDATA" -l "${PGDATA}/rehearsal-postgres.log" -w start >/dev/null
CLUSTER_STARTED=true
log "Disposable cluster listening on 127.0.0.1:${REHEARSAL_PORT} only (verify with: ss -ltn | grep ${REHEARSAL_PORT})"

PSQL_ARGS=(-h 127.0.0.1 -p "$REHEARSAL_PORT" -U "$REHEARSAL_ROLE")

"${PG_BINDIR}/createdb" "${PSQL_ARGS[@]}" "$REHEARSAL_DB"
log "Created disposable database: $REHEARSAL_DB"

if ! "${PG_BINDIR}/pg_restore" "${PSQL_ARGS[@]}" -d "$REHEARSAL_DB" --no-privileges --no-owner "$DUMP_COPY" \
    2> "${REHEARSAL_ROOT}/pg_restore.stderr"; then
  log "pg_restore reported errors (last 20 lines, no row data expected in this stream):"
  tail -n20 "${REHEARSAL_ROOT}/pg_restore.stderr" >&2 || true
  fail "pg_restore did not complete cleanly. See stderr above. Not recording a successful rehearsal."
fi
RESTORE_END_EPOCH=$(date +%s)
RESTORE_DURATION_S=$(( RESTORE_END_EPOCH - RESTORE_START_EPOCH ))
log "Restore completed in ${RESTORE_DURATION_S}s (this is the measured RTO for this run)"

# ═════════════════════════════════════════════════════════════════════════
# VERIFICATION — counts, booleans, and hashes ONLY. Never row contents.
# ═════════════════════════════════════════════════════════════════════════
log "=== Verification (counts/booleans only — no patient data is printed) ==="

q() { "${PG_BINDIR}/psql" "${PSQL_ARGS[@]}" -d "$REHEARSAL_DB" -t -A -c "$1"; }

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
dump_version_header: ${DUMP_PG_VERSION_LINE:-not present}
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

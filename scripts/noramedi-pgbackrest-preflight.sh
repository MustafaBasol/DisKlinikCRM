#!/usr/bin/env bash
# noramedi-pgbackrest-preflight.sh — F4-FCR-002
# Deploy to: /usr/local/sbin/noramedi-pgbackrest-preflight.sh
# chmod +x /usr/local/sbin/noramedi-pgbackrest-preflight.sh
#
# Validates every precondition for turning on continuous WAL archiving, reads
# the four host facts this repository cannot know, prints the exact
# configuration change it would make, and — only with --apply — writes the
# PostgreSQL drop-in file.
#
# THIS SCRIPT NEVER RESTARTS, RELOADS, OR STOPS POSTGRESQL. Not with --apply,
# not ever. archive_mode is a postmaster-level setting, so a restart is
# required to activate it, and that restart is a deliberate operator action
# taken during an approved maintenance window. The script prints the command;
# a human runs it.
#
# THIS SCRIPT NEVER CREATES THE STANZA AND NEVER RUNS A BACKUP. It only
# checks, reports, and (with --apply) writes one config file.
#
# DEFAULT MODE IS DRY-RUN. Running it with no arguments mutates nothing.
#
# ⚠ AUTHORIZATION. Applying WAL archiving to production requires the scoped
# freeze exception drafted in docs/program/runbooks/F4_RECOVERY_OPERATIONS.md
# §12, whose status is DRAFT_PENDING_PROGRAM_OWNER. This script does not
# grant, imply, or check that authorization — it is the operator's
# responsibility, and no agent may self-approve (NORAMEDI_MASTER_TRACKER.md
# §2.3).
#
# WHY A PREFLIGHT SCRIPT EXISTS AT ALL:
# Four facts required to configure pgBackRest correctly are NOT recorded
# anywhere in this repository and cannot be inferred safely:
#
#   pg1-path       the real PostgreSQL data directory
#   process-max    the host vCPU count
#   repo1-bundle   requires pgbackrest >= 2.41
#   compress-type  zst requires a libzstd-enabled build
#
# Guessing any of them produces a config that either fails at first backup or,
# worse, appears to work. This script reads them from the host and REFUSES to
# proceed when the answer is ambiguous rather than picking a plausible value.
#
# ORDERING THIS SCRIPT ENFORCES:
#   The stanza must exist BEFORE archive_mode is turned on. If archive_command
#   points at a stanza that does not exist, every push fails, PostgreSQL
#   retries forever, pg_wal grows without bound, and the cluster shuts down on
#   a full disk. Production is a single 76 GB filesystem shared with PGDATA,
#   uploads and /root/noramedi-backups — nothing absorbs that.
#   --apply refuses unless `pgbackrest info` already reports the stanza.
#
# Usage:
#   noramedi-pgbackrest-preflight.sh [--apply] [--stanza NAME] [--force-major N]
#                                    [-h|--help]
#
# Options:
#   --apply          Write the PostgreSQL drop-in after ALL checks pass.
#                    Without it the script is strictly read-only and only
#                    prints what it would write. Never restarts anything.
#   --stanza NAME    pgBackRest stanza name. Default: noramedi
#   --force-major N  Accept PostgreSQL major version N instead of the expected
#                    16. Use only when production has genuinely been upgraded
#                    and the repository evidence is stale. Recorded loudly in
#                    the output so it cannot be mistaken for a normal run.
#
# Environment (all optional; defaults shown):
#   NORAMEDI_PGBACKREST_CONF        /etc/pgbackrest/pgbackrest.conf
#   NORAMEDI_PGBACKREST_REPO_PATH   /var/lib/pgbackrest
#   NORAMEDI_PGBACKREST_MIN_FREE_MB 10240   (10 GiB free required on the repo
#                                            filesystem before activation)
#   NORAMEDI_PGBACKREST_ARCHIVE_TIMEOUT 300
#   NORAMEDI_PG_SUPERUSER           postgres
#
# Exit codes:
#   0  all checks passed (and, with --apply, the drop-in was written)
#   1  at least one check FAILED — do not proceed
#   2  usage / CLI error, or an invalid environment value (fail closed)
#   3  AMBIGUOUS host state — the script refuses to decide. Not a failure of
#      the host, a refusal to guess. Resolve the ambiguity and re-run.

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
AMBIGUOUS_EXIT_CODE=3

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[pgbackrest-preflight] $(timestamp) $*"; }
ok()   { echo "[pgbackrest-preflight] $(timestamp) OK   — $*"; }
bad()  { echo "[pgbackrest-preflight] $(timestamp) FAIL — $*" >&2; FAILED=$((FAILED + 1)); }
warn() { echo "[pgbackrest-preflight] $(timestamp) WARN — $*" >&2; }
ambiguous() {
  echo "[pgbackrest-preflight] $(timestamp) AMBIGUOUS — $*" >&2
  echo "[pgbackrest-preflight] $(timestamp) refusing to guess; resolve the above and re-run" >&2
  exit "$AMBIGUOUS_EXIT_CODE"
}

APPLY=false
STANZA="noramedi"
EXPECTED_PG_MAJOR=16
FORCED_MAJOR=""
FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)        APPLY=true; shift ;;
    --stanza)       STANZA="${2:-}"; shift 2 ;;
    --force-major)  FORCED_MAJOR="${2:-}"; shift 2 ;;
    -h|--help)      usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

# Stanza name is interpolated into archive_command, a shell string PostgreSQL
# executes. Constrain it hard rather than trusting the caller.
if [[ ! "$STANZA" =~ ^[a-z0-9][a-z0-9_]{0,31}$ ]]; then
  echo "Invalid --stanza '$STANZA' (expected ^[a-z0-9][a-z0-9_]{0,31}$)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi

PGBACKREST_CONF="${NORAMEDI_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}"
REPO_PATH="${NORAMEDI_PGBACKREST_REPO_PATH:-/var/lib/pgbackrest}"
MIN_FREE_MB="${NORAMEDI_PGBACKREST_MIN_FREE_MB:-10240}"
ARCHIVE_TIMEOUT="${NORAMEDI_PGBACKREST_ARCHIVE_TIMEOUT:-300}"
PG_SUPERUSER="${NORAMEDI_PG_SUPERUSER:-postgres}"

# Fail closed on malformed tuning values rather than letting an invalid
# comparison fall through to "healthy" — same discipline as opscheck.
[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] && [[ "$MIN_FREE_MB" -gt 0 ]] || {
  echo "Invalid NORAMEDI_PGBACKREST_MIN_FREE_MB '$MIN_FREE_MB' (expected positive integer)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"; }
[[ "$ARCHIVE_TIMEOUT" =~ ^[0-9]+$ ]] && [[ "$ARCHIVE_TIMEOUT" -gt 0 ]] || {
  echo "Invalid NORAMEDI_PGBACKREST_ARCHIVE_TIMEOUT '$ARCHIVE_TIMEOUT' (expected positive integer seconds)" >&2
  exit "$USAGE_ERROR_EXIT_CODE"; }
if [[ -n "$FORCED_MAJOR" ]]; then
  [[ "$FORCED_MAJOR" =~ ^[0-9]{1,2}$ ]] || {
    echo "Invalid --force-major '$FORCED_MAJOR'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
  EXPECTED_PG_MAJOR="$FORCED_MAJOR"
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Must run as root: it reads PostgreSQL configuration as the $PG_SUPERUSER OS user" >&2
  exit "$USAGE_ERROR_EXIT_CODE"
fi

log "mode=$([[ "$APPLY" == true ]] && echo APPLY || echo DRY-RUN) stanza=$STANZA"
[[ -n "$FORCED_MAJOR" ]] && warn "PostgreSQL major expectation OVERRIDDEN to $EXPECTED_PG_MAJOR via --force-major"

# ── privilege delegation ─────────────────────────────────────────────────
# PostgreSQL client tooling must not run as root. Mirrors the delegation
# helper already proven in scripts/backup-restore-rehearsal.sh.
as_pg() {
  local cmd="$1"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$PG_SUPERUSER" -- /bin/bash -c "$cmd"
  else
    su -s /bin/bash "$PG_SUPERUSER" -c "$cmd"
  fi
}

# psql_show GUC — prints the value, or returns non-zero. Never interpolates
# caller data: the GUC name is matched against a strict allowlist pattern
# first, so this cannot become an SQL injection point.
psql_show() {
  local guc="$1"
  [[ "$guc" =~ ^[a-z_]+$ ]] || return 1
  as_pg "psql -Atc \"SHOW $guc;\"" 2>/dev/null
}

# ═════════════════════════════════════════════════════════════════════════
# 1. pgBackRest binary
# ═════════════════════════════════════════════════════════════════════════
log "── 1. pgBackRest binary ──"
PGBR_VERSION=""
PGBR_MAJOR=0
PGBR_MINOR=0
if ! command -v pgbackrest >/dev/null 2>&1; then
  bad "pgbackrest is not installed or not on PATH. Install from the PGDG apt repository; the distro package may lag."
  log  "     the correct pgdg component needs the release codename, which this repository does not record:"
  log  "       lsb_release -cs"
else
  # `pgbackrest version` prints e.g. "pgBackRest 2.54.2"
  PGBR_VERSION="$(pgbackrest version 2>/dev/null | awk '{print $2}' || true)"
  if [[ ! "$PGBR_VERSION" =~ ^([0-9]+)\.([0-9]+) ]]; then
    ambiguous "could not parse a version out of 'pgbackrest version' (got: '${PGBR_VERSION:-<empty>}'). Every capability gate below depends on it."
  fi
  PGBR_MAJOR="${BASH_REMATCH[1]}"
  PGBR_MINOR="${BASH_REMATCH[2]}"
  ok "pgbackrest $PGBR_VERSION"
fi

# repo1-bundle requires >= 2.41; compress-type=zst requires a libzstd build.
BUNDLE_SUPPORTED=false
ZSTD_SUPPORTED=false
if [[ "$PGBR_MAJOR" -gt 2 ]] || { [[ "$PGBR_MAJOR" -eq 2 ]] && [[ "$PGBR_MINOR" -ge 41 ]]; }; then
  BUNDLE_SUPPORTED=true
  ok "repo1-bundle=y supported (>= 2.41)"
elif [[ -n "$PGBR_VERSION" ]]; then
  warn "repo1-bundle NOT supported on $PGBR_VERSION (needs >= 2.41) — the generated config omits it"
fi
if [[ -n "$PGBR_VERSION" ]]; then
  # `pgbackrest help archive-push compress-type` lists the accepted values for
  # this build. Absence of "zst" means the binary was not linked against
  # libzstd; falling back is correct, guessing is not.
  if pgbackrest help backup compress-type 2>/dev/null | grep -qw 'zst'; then
    ZSTD_SUPPORTED=true
    ok "compress-type=zst supported"
  else
    warn "compress-type=zst NOT supported by this build — the generated config falls back to lz4/gz"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════
# 2. PostgreSQL: reachable, version, and the four host facts
# ═════════════════════════════════════════════════════════════════════════
log "── 2. PostgreSQL ──"
if ! id -u "$PG_SUPERUSER" >/dev/null 2>&1; then
  bad "OS user '$PG_SUPERUSER' does not exist"
fi

PG_VERSION_RAW=""
if ! PG_VERSION_RAW="$(psql_show server_version)"; then
  bad "cannot query PostgreSQL as '$PG_SUPERUSER' (is the cluster running? is peer auth configured?)"
else
  ok "server_version = $PG_VERSION_RAW"
fi

PG_MAJOR=""
if [[ "$PG_VERSION_RAW" =~ ^([0-9]+) ]]; then
  PG_MAJOR="${BASH_REMATCH[1]}"
  if [[ "$PG_MAJOR" -ne "$EXPECTED_PG_MAJOR" ]]; then
    bad "PostgreSQL major is $PG_MAJOR but this task's evidence says $EXPECTED_PG_MAJOR. A pgBackRest stanza is bound to a cluster version; re-verify before proceeding (or pass --force-major $PG_MAJOR if the upgrade is real and the evidence is stale)."
  fi
fi

DATA_DIRECTORY="$(psql_show data_directory || true)"
CONFIG_FILE="$(psql_show config_file || true)"
CURRENT_ARCHIVE_MODE="$(psql_show archive_mode || true)"
CURRENT_ARCHIVE_COMMAND="$(psql_show archive_command || true)"
CURRENT_WAL_LEVEL="$(psql_show wal_level || true)"
CURRENT_ARCHIVE_TIMEOUT="$(psql_show archive_timeout || true)"

[[ -n "$DATA_DIRECTORY" ]] || ambiguous "SHOW data_directory returned nothing — pg1-path cannot be determined and must never be assumed from the Debian convention"
[[ -n "$CONFIG_FILE" ]]    || ambiguous "SHOW config_file returned nothing — the file to modify cannot be located"

ok "data_directory  = $DATA_DIRECTORY"
ok "config_file     = $CONFIG_FILE"
ok "wal_level       = ${CURRENT_WAL_LEVEL:-<unknown>}"
ok "archive_mode    = ${CURRENT_ARCHIVE_MODE:-<unknown>}"
ok "archive_timeout = ${CURRENT_ARCHIVE_TIMEOUT:-<unknown>}"

[[ -d "$DATA_DIRECTORY" ]] || bad "data_directory '$DATA_DIRECTORY' is not a directory on this host"

# wal_level must be at least replica. `minimal` cannot support archiving.
case "$CURRENT_WAL_LEVEL" in
  replica|logical) ok "wal_level '$CURRENT_WAL_LEVEL' is sufficient for WAL archiving (no change needed)" ;;
  minimal)         bad "wal_level=minimal cannot support WAL archiving; raising it is a SECOND restart-requiring change and is outside the drafted freeze exception" ;;
  "")              bad "wal_level could not be read" ;;
  *)               ambiguous "unrecognized wal_level '$CURRENT_WAL_LEVEL'" ;;
esac

# ── the ambiguity that matters most ──────────────────────────────────────
# archive_mode already on, pointing somewhere else, means another archiving
# mechanism owns this cluster. Overwriting its archive_command would silently
# break whatever that is. Refuse.
INTENDED_ARCHIVE_COMMAND="pgbackrest --stanza=${STANZA} archive-push %p"
case "$CURRENT_ARCHIVE_MODE" in
  off)
    ok "archive_mode is off — this is the expected starting state"
    ;;
  on|always)
    if [[ "$CURRENT_ARCHIVE_COMMAND" == "$INTENDED_ARCHIVE_COMMAND" ]]; then
      warn "archive_mode is already '$CURRENT_ARCHIVE_MODE' with exactly the intended archive_command — already activated; this run is a no-op re-validation"
    else
      ambiguous "archive_mode is already '$CURRENT_ARCHIVE_MODE' with a DIFFERENT archive_command. Another archiving mechanism owns this cluster. Overwriting it would break that mechanism and could strand WAL. Inspect it, decide deliberately, then re-run."
    fi
    ;;
  "") bad "archive_mode could not be read" ;;
  *)  ambiguous "unrecognized archive_mode '$CURRENT_ARCHIVE_MODE'" ;;
esac

# An archive_command that already exists while archive_mode=off is still a
# signal that someone configured something. Surface it rather than silently
# replacing it.
if [[ "$CURRENT_ARCHIVE_MODE" == "off" ]] && [[ -n "$CURRENT_ARCHIVE_COMMAND" ]] \
   && [[ "$CURRENT_ARCHIVE_COMMAND" != "(disabled)" ]] \
   && [[ "$CURRENT_ARCHIVE_COMMAND" != "$INTENDED_ARCHIVE_COMMAND" ]]; then
  warn "archive_mode is off but a non-empty archive_command is already set; it will be replaced by the drop-in. Existing value recorded above — save it before applying."
fi

# ═════════════════════════════════════════════════════════════════════════
# 3. Where the drop-in goes — conf.d include, or append
# ═════════════════════════════════════════════════════════════════════════
log "── 3. configuration target ──"
CONFIG_DIR="$(dirname "$CONFIG_FILE")"
DROPIN_DIR=""
DROPIN_PATH=""

# ⚠ `include_dir` IS NOT A GUC — do not add `psql_show include_dir` here.
# `include`, `include_if_exists` and `include_dir` are postgresql.conf
# PREPROCESSOR DIRECTIVES, not settings, so `SHOW include_dir` returns
# "unrecognized configuration parameter". An earlier revision queried it and
# swallowed the error with `|| true`, which made that branch dead code and left
# the grep below doing all the real work while the script claimed to be reading
# rather than guessing. The file is the only authority here.
INCLUDE_DIR_RAW="$(grep -oE "^[[:space:]]*include_dir[[:space:]]*=[[:space:]]*'[^']+'" "$CONFIG_FILE" 2>/dev/null \
  | tail -n1 | sed -E "s/.*=[[:space:]]*'//; s/'$//" || true)"
if [[ -z "$INCLUDE_DIR_RAW" ]]; then
  # Unquoted form: include_dir = conf.d
  INCLUDE_DIR_RAW="$(grep -oE "^[[:space:]]*include_dir[[:space:]]*=[[:space:]]*[^'#[:space:]]+" "$CONFIG_FILE" 2>/dev/null \
    | tail -n1 | sed -E 's/.*=[[:space:]]*//' || true)"
fi

if [[ -n "$INCLUDE_DIR_RAW" ]]; then
  # A relative include_dir resolves against the config file's own directory.
  if [[ "$INCLUDE_DIR_RAW" == /* ]]; then DROPIN_DIR="$INCLUDE_DIR_RAW"; else DROPIN_DIR="$CONFIG_DIR/$INCLUDE_DIR_RAW"; fi
fi

if [[ -n "$DROPIN_DIR" ]]; then
  if [[ ! -d "$DROPIN_DIR" ]]; then
    ambiguous "include_dir resolves to '$DROPIN_DIR' but that directory does not exist"
  fi
  DROPIN_PATH="$DROPIN_DIR/10-noramedi-pitr.conf"
  ok "drop-in target: $DROPIN_PATH (include_dir is active — rollback is deleting one file)"
else
  ambiguous "no active include_dir was found, so there is no drop-in directory to write to. Appending directly to '$CONFIG_FILE' is possible but this script will NOT do it: an append cannot be rolled back by deleting a file, and reconstructing the previous state from memory during an incident is exactly the failure this task exists to prevent. Enable an include_dir (add \"include_dir = 'conf.d'\" to postgresql.conf, create the directory, reload) and re-run."
fi

# ═════════════════════════════════════════════════════════════════════════
# 4. pgBackRest configuration file
# ═════════════════════════════════════════════════════════════════════════
log "── 4. pgbackrest.conf ──"
CIPHER_TYPE=""
if [[ ! -f "$PGBACKREST_CONF" ]]; then
  bad "$PGBACKREST_CONF does not exist. Copy ops/pgbackrest/pgbackrest.conf.example and fill in the four host-derived values printed by this script."
else
  ok "$PGBACKREST_CONF exists"

  CONF_MODE="$(stat -c '%a' "$PGBACKREST_CONF" 2>/dev/null || echo '?')"
  CONF_OWNER="$(stat -c '%U' "$PGBACKREST_CONF" 2>/dev/null || echo '?')"
  if [[ "$CONF_MODE" != "600" ]] && [[ "$CONF_MODE" != "640" ]]; then
    bad "$PGBACKREST_CONF mode is $CONF_MODE; it holds repo1-cipher-pass and must be 0600 (or 0640 root:$PG_SUPERUSER)"
  else
    ok "mode $CONF_MODE"
  fi
  if [[ "$CONF_OWNER" != "$PG_SUPERUSER" ]] && [[ "$CONF_OWNER" != "root" ]]; then
    bad "$PGBACKREST_CONF is owned by '$CONF_OWNER'; expected $PG_SUPERUSER or root"
  fi

  # Encryption is a fail-closed requirement. A repo holding a physical copy of
  # every table — including özel nitelikli sağlık verisi — must not be written
  # in plaintext. NEVER print the passphrase itself; only whether it is set.
  CIPHER_TYPE="$(grep -oE '^[[:space:]]*repo1-cipher-type[[:space:]]*=[[:space:]]*[A-Za-z0-9-]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
  case "$CIPHER_TYPE" in
    aes-256-cbc)
      ok "repo1-cipher-type=aes-256-cbc"
      if grep -qE '^[[:space:]]*repo1-cipher-pass[[:space:]]*=[[:space:]]*.+' "$PGBACKREST_CONF" 2>/dev/null; then
        if grep -qE '^[[:space:]]*repo1-cipher-pass[[:space:]]*=[[:space:]]*<REPLACE' "$PGBACKREST_CONF" 2>/dev/null; then
          bad "repo1-cipher-pass is still the '<REPLACE ...>' placeholder from the template"
        else
          ok "repo1-cipher-pass is set (value never read, printed, or logged by this script)"
        fi
      else
        bad "repo1-cipher-type is aes-256-cbc but repo1-cipher-pass is not set — stanza-create will fail"
      fi
      ;;
    none|"")
      bad "repo1-cipher-type is '${CIPHER_TYPE:-unset}'. Repository encryption is REQUIRED: the repo holds a physical copy of every table, including special-category health data, and the production pg_dump is already confirmed plaintext. Set repo1-cipher-type=aes-256-cbc."
      ;;
    *)
      ambiguous "unrecognized repo1-cipher-type '$CIPHER_TYPE'"
      ;;
  esac

  # A committed template must never reach a host with its placeholders intact.
  if grep -q '<REPLACE' "$PGBACKREST_CONF" 2>/dev/null; then
    bad "$PGBACKREST_CONF still contains '<REPLACE' placeholders"
  fi

  # Stage 2 guard. A repo2 whose path is on this host is not off-host, and
  # activating one is outside the drafted freeze exception.
  if grep -qE '^[[:space:]]*repo2-' "$PGBACKREST_CONF" 2>/dev/null; then
    warn "repo2-* options are present. Off-host activation is a SEPARATE authorization (R-030, F4_RECOVERY_OPERATIONS.md §7.2) and requires verifying, on a scratch host first, whether an unreachable repo2 stalls archive-push and fills pg_wal."

    # Encryption is fail-closed for repo2 for a STRICTER reason than for
    # repo1. repo1's bytes never leave a host we control; repo2's bytes are
    # written to infrastructure operated by someone else, which is the entire
    # point of it. A plaintext repo2 would place özel nitelikli sağlık verisi
    # on a third party's disk in the clear.
    #
    # This is defence in depth, not the only gate: the status writer already
    # refuses to report a plaintext repo2 as off-host (REPO2_PLAINTEXT). But
    # that refusal is discovered AFTER the bytes have been written. Preflight
    # runs BEFORE, which is the only point at which the mistake is still
    # cheap. NEVER print the passphrase; only whether it is set.
    REPO2_CIPHER_TYPE="$(grep -oE '^[[:space:]]*repo2-cipher-type[[:space:]]*=[[:space:]]*[A-Za-z0-9-]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
    case "$REPO2_CIPHER_TYPE" in
      aes-256-cbc)
        ok "repo2-cipher-type=aes-256-cbc"
        if grep -qE '^[[:space:]]*repo2-cipher-pass[[:space:]]*=[[:space:]]*.+' "$PGBACKREST_CONF" 2>/dev/null; then
          if grep -qE '^[[:space:]]*repo2-cipher-pass[[:space:]]*=[[:space:]]*<REPLACE' "$PGBACKREST_CONF" 2>/dev/null; then
            bad "repo2-cipher-pass is still the '<REPLACE ...>' placeholder from the template"
          else
            ok "repo2-cipher-pass is set (value never read, printed, or logged by this script)"
            # Distinctness is required by the template and by key-escrow
            # design: one compromised passphrase must not open both copies.
            # Compared by hash so neither value is ever held or printed.
            _r1p="$(grep -oE '^[[:space:]]*repo1-cipher-pass[[:space:]]*=[[:space:]]*.+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 | sha256sum | cut -d' ' -f1 || true)"
            _r2p="$(grep -oE '^[[:space:]]*repo2-cipher-pass[[:space:]]*=[[:space:]]*.+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 | sha256sum | cut -d' ' -f1 || true)"
            if [[ -n "$_r1p" ]] && [[ "$_r1p" == "$_r2p" ]]; then
              bad "repo2-cipher-pass is IDENTICAL to repo1-cipher-pass — one compromised passphrase would open both the local and the off-host copy; they must be distinct and separately escrowed"
            fi
            unset _r1p _r2p
          fi
        else
          bad "repo2-cipher-type is aes-256-cbc but repo2-cipher-pass is not set — stanza-create for repo2 will fail"
        fi
        ;;
      none|"")
        bad "repo2-cipher-type is '${REPO2_CIPHER_TYPE:-unset}'. Encryption is REQUIRED before any byte leaves this host: repo2 places a physical copy of every table, including special-category health data, on infrastructure this program does not operate. Set repo2-cipher-type=aes-256-cbc."
        ;;
      *)
        ambiguous "unrecognized repo2-cipher-type '$REPO2_CIPHER_TYPE'"
        ;;
    esac

    # Retention. Configured by convention only until now: the SSH template
    # block carries both keys, the S3 block did not, and no code path failed
    # when they were absent. pgBackRest does not expire what it is not told to
    # expire, so a repo2 activated without them grows without bound — on
    # infrastructure this program does not operate, does not monitor for disk,
    # and cannot free space on during an incident. repo1 is covered by the
    # local disk check; repo2 has no equivalent, which is precisely why the
    # config must carry the bound instead.
    for _rk in repo2-retention-full repo2-retention-archive; do
      _rv="$(grep -oE "^[[:space:]]*${_rk}[[:space:]]*=[[:space:]]*[0-9]+" "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
      if [[ -z "$_rv" ]]; then
        bad "${_rk} is not set. An off-host repository with no retention bound grows without limit on infrastructure this program neither monitors nor controls; pgBackRest expires nothing it was not configured to expire."
      elif [[ "$_rv" -lt 1 ]]; then
        bad "${_rk}=${_rv} is not a usable retention count (expected >= 1)"
      else
        ok "${_rk}=${_rv}"
      fi
    done
    unset _rk _rv

    # SFTP host-key verification — the accepted contract, ENFORCED:
    #
    #   repo2-sftp-host-key-check-type=fingerprint
    #   repo2-sftp-host-key-hash-type=sha256
    #   repo2-sftp-host-fingerprint=<64 lowercase hex chars, no separators>
    #
    # Verified against the PINNED production build (pgBackRest 2.50), not
    # assumed and not carried back from a newer release. Runbook §22.4c holds
    # the citation table; the facts this code turns on are:
    #
    #   - repo2-sftp-host-key-check-type accepts strict|accept-new|fingerprint|
    #     none and DEFAULTS TO strict (src/build/config/config.yaml @ 2.50).
    #   - src/storage/sftp/storage.c compares repo2-sftp-host-fingerprint ONLY
    #     when the check type is exactly `fingerprint`. Every other non-`none`
    #     value falls through to known_hosts checking and the pin is never read.
    #   - the comparison is strcmp() against encodeToStr(encodingHex, ...),
    #     whose alphabet is "0123456789abcdef" at two chars per digest byte
    #     (src/common/encode.c @ 2.50).
    #
    # So "a fingerprint is pinned" is NOT the same claim as "the fingerprint is
    # verified". A config carrying a pin but no check type runs under the
    # default `strict` and verifies against a known_hosts file this program has
    # no procedure for distributing -- populated in practice by ssh-keyscan,
    # which records whatever answers. That shape reads as pinned in review
    # while verifying something else entirely. Refusing only `none`, as this
    # gate did before F4-FCR-004-R1, could not tell the two apart.
    #
    # With verification off altogether, backups are written to whatever answers
    # on that address. Contents stay AES-256, but object and backup NAMES are
    # not encrypted, and a durability claim earned against an unauthenticated
    # endpoint is not a durability claim at all.
    #
    # The fingerprint is PUBLIC metadata -- a digest of the endpoint's public
    # host key, handed to every client on connect -- so pinning it in this file
    # discloses nothing. This script still never echoes the value: not because
    # it is secret, but because a preflight that prints config values is one
    # edit away from printing the ones that are.
    REPO2_TYPE_VAL="$(grep -oE '^[[:space:]]*repo2-type[[:space:]]*=[[:space:]]*[A-Za-z0-9-]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
    if [[ "$REPO2_TYPE_VAL" == "sftp" ]]; then
      # `-` is inside the class deliberately: `accept-new` is a valid value and
      # a [A-Za-z]+ class would silently read it as "accept".
      _hkc="$(grep -oE '^[[:space:]]*repo2-sftp-host-key-check-type[[:space:]]*=[[:space:]]*[A-Za-z-]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
      case "$_hkc" in
        fingerprint)
          ok "repo2-sftp-host-key-check-type=fingerprint"
          ;;
        none)
          bad "repo2-sftp-host-key-check-type=none disables SSH host-key verification on the transport that carries every tenant's backup off this host — backups would be written to whatever answers on that address. Set repo2-sftp-host-key-check-type=fingerprint (runbook §22.4c)."
          ;;
        accept-new)
          bad "repo2-sftp-host-key-check-type=accept-new is trust-on-first-use: it accepts whatever host answers first and only notices a change afterwards, so the very first backup — the one that carries the data off this host — is unverified. Set repo2-sftp-host-key-check-type=fingerprint (runbook §22.4c)."
          ;;
        strict)
          bad "repo2-sftp-host-key-check-type=strict verifies against ~postgres/.ssh/known_hosts, NOT against repo2-sftp-host-fingerprint: on pgBackRest 2.50 the pinned fingerprint is compared only when the check type is exactly 'fingerprint'. As configured the pin is inert. Set repo2-sftp-host-key-check-type=fingerprint (runbook §22.4c)."
          ;;
        "")
          bad "repo2-sftp-host-key-check-type is not set. pgBackRest defaults it to 'strict', which verifies against known_hosts and NEVER compares repo2-sftp-host-fingerprint — so a fingerprint pinned here would verify nothing while reading as pinned. Set repo2-sftp-host-key-check-type=fingerprint explicitly (runbook §22.4c)."
          ;;
        *)
          bad "unrecognized repo2-sftp-host-key-check-type '${_hkc}' — pgBackRest 2.50 accepts strict|accept-new|fingerprint|none, and this program requires fingerprint (runbook §22.4c)"
          ;;
      esac

      # Hash type selects the digest the pin is compared against, and fixes its
      # expected length. md5/sha1 are accepted by pgBackRest and rejected here.
      _hkh="$(grep -oE '^[[:space:]]*repo2-sftp-host-key-hash-type[[:space:]]*=[[:space:]]*[A-Za-z0-9]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/.*=[[:space:]]*//' | head -n1 || true)"
      _fp_len=0
      case "$_hkh" in
        sha256)
          ok "repo2-sftp-host-key-hash-type=sha256"
          _fp_len=64
          ;;
        md5|sha1)
          bad "repo2-sftp-host-key-hash-type=${_hkh} is a broken digest to hang an endpoint's identity on — both have practical collision attacks. pgBackRest 2.50 still accepts it; this program does not. Set repo2-sftp-host-key-hash-type=sha256 and RE-DERIVE the fingerprint (runbook §22.4c)."
          ;;
        "")
          bad "repo2-sftp-host-key-hash-type is not set. It selects the digest repo2-sftp-host-fingerprint is compared against, so without it the pin is ambiguous. Set repo2-sftp-host-key-hash-type=sha256 (runbook §22.4c)."
          ;;
        *)
          bad "unrecognized repo2-sftp-host-key-hash-type '${_hkh}' — pgBackRest 2.50 accepts md5|sha1|sha256, and this program requires sha256 (runbook §22.4c)"
          ;;
      esac

      # Syntax is decided by strcmp() against a lowercase hex digest, so
      # uppercase hex, colon-separated hex, and ssh-keygen's "SHA256:<base64>"
      # form can NEVER match. Each of those fails at RUN time — after the
      # operator believes the endpoint is pinned — with:
      #   host [...] and configured fingerprint (repo2-sftp-host-fingerprint)
      #   [...] do not match
      # Catching it here is the difference between a config review and an
      # outage during the first off-host backup.
      # Split on the FIRST `=`, not the last. The usual `s/.*=//` idiom is
      # greedy, and a fingerprint pasted in ssh-keygen's base64 form ends in
      # `=` padding -- which that idiom truncates to the empty string, turning
      # a malformed pin into "no fingerprint pinned". Still fail-closed, but it
      # sends the operator to add a value they had already added.
      _fp="$(grep -oE '^[[:space:]]*repo2-sftp-host-fingerprint[[:space:]]*=[[:space:]]*[^[:space:]]+' "$PGBACKREST_CONF" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*//' | head -n1 || true)"
      _fp_re="^[0-9a-f]{${_fp_len}}\$"
      if [[ -z "$_fp" ]]; then
        bad "repo2-type=sftp but no repo2-sftp-host-fingerprint is pinned — the endpoint's identity is unverified, so a backup could be written to any host answering on that address"
      elif [[ "$_fp" == "<REPLACE"* ]]; then
        bad "repo2-sftp-host-fingerprint is still the '<REPLACE ...>' placeholder from the template"
      elif [[ "$_fp_len" -eq 0 ]]; then
        # The hash type already failed, so the expected length is undecidable.
        # Emitting a second "malformed" failure for the same root cause would
        # send the operator to re-derive against a digest that is itself wrong.
        :
      elif [[ "$_fp" =~ $_fp_re ]]; then
        ok "repo2-sftp-host-fingerprint is pinned (${_fp_len} lowercase hex characters; value never printed by this script)"
      elif [[ "$_fp" =~ ^(SHA256|SHA1|MD5|sha256|sha1|md5): ]]; then
        bad "repo2-sftp-host-fingerprint is in ssh-keygen's '<HASH>:<base64>' form. pgBackRest compares against a BARE lowercase hex digest, so this can never match and repo2 would fail at run time rather than here. Re-derive it per runbook §22.4c."
      elif [[ "$_fp" == *:* ]]; then
        bad "repo2-sftp-host-fingerprint is colon-separated. pgBackRest compares it byte-for-byte against lowercase hex with NO separators, so this value can never match and repo2 would fail at run time rather than here. Re-derive it per runbook §22.4c."
      elif [[ "$_fp" =~ ^[0-9a-fA-F]+$ ]]; then
        if [[ "${#_fp}" -ne "$_fp_len" ]]; then
          bad "repo2-sftp-host-fingerprint is ${#_fp} hex characters but repo2-sftp-host-key-hash-type=${_hkh} requires exactly ${_fp_len}. A wrong-length pin can never match (runbook §22.4c)."
        else
          bad "repo2-sftp-host-fingerprint contains uppercase hex. pgBackRest compares with strcmp() against a LOWERCASE hex digest, so an uppercase pin never matches and fails at run time. Lowercase it (runbook §22.4c)."
        fi
      else
        bad "repo2-sftp-host-fingerprint is malformed — expected exactly ${_fp_len} lowercase hex characters with no separators. Note that 'ssh-keygen -l' prints the base64 'SHA256:...' form, which pgBackRest never matches; derive it per runbook §22.4c."
      fi
      unset _hkc _hkh _fp _fp_len _fp_re
    elif grep -qE '^[[:space:]]*repo2-sftp-' "$PGBACKREST_CONF" 2>/dev/null; then
      # The two files must not disagree about what shape this is. The status
      # writer classifies a repo2 as SFTP from repo2-sftp-host ALONE, because
      # SELECTED TOPOLOGY = C sets no repo2-host; this gate keys on repo2-type,
      # because that is what actually selects pgBackRest's SFTP driver. A
      # config carrying repo2-sftp-* without repo2-type=sftp lands between
      # them: pgBackRest ignores the SFTP settings entirely, while the status
      # writer reports the shape as off-host SFTP and none of the host-key
      # checks above ever run.
      bad "repo2-sftp-* options are set but repo2-type is '${REPO2_TYPE_VAL:-unset}', not 'sftp'. pgBackRest would not use the SFTP driver at all, yet the status writer classifies this shape as SFTP from repo2-sftp-host — set repo2-type=sftp, or remove the repo2-sftp-* keys."
    fi
    unset REPO2_TYPE_VAL
  fi
fi

# ═════════════════════════════════════════════════════════════════════════
# 5. Repository path, ownership, and free space
# ═════════════════════════════════════════════════════════════════════════
log "── 5. repository path ──"
if [[ ! -d "$REPO_PATH" ]]; then
  bad "repo path '$REPO_PATH' does not exist. Create it: install -d -o $PG_SUPERUSER -g $PG_SUPERUSER -m 0750 $REPO_PATH"
else
  REPO_OWNER="$(stat -c '%U' "$REPO_PATH" 2>/dev/null || echo '?')"
  REPO_MODE="$(stat -c '%a' "$REPO_PATH" 2>/dev/null || echo '?')"
  [[ "$REPO_OWNER" == "$PG_SUPERUSER" ]] && ok "repo path owned by $PG_SUPERUSER" \
    || bad "repo path '$REPO_PATH' is owned by '$REPO_OWNER'; pgBackRest runs as $PG_SUPERUSER and must own it"
  [[ "$REPO_MODE" == "750" || "$REPO_MODE" == "700" ]] && ok "repo path mode $REPO_MODE" \
    || warn "repo path mode is $REPO_MODE; 0750 expected"
fi

# The repo must not be under /root: that directory is root-only, so the
# postgres user cannot use it, and colocating with the existing pg_dump chain
# risks this task disturbing a backup mechanism it is required to leave alone.
case "$REPO_PATH" in
  /root|/root/*) bad "repo path '$REPO_PATH' is under /root — unreadable by $PG_SUPERUSER, and it must stay clear of the existing /root/noramedi-backups pg_dump chain" ;;
esac

# Same-filesystem-as-PGDATA is expected on this single-disk host and is not a
# failure, but it IS the disk-exhaustion risk the freeze exception names.
if [[ -d "$REPO_PATH" ]] && [[ -d "$DATA_DIRECTORY" ]]; then
  REPO_DEV="$(stat -c '%d' "$REPO_PATH" 2>/dev/null || echo 'r')"
  PGDATA_DEV="$(stat -c '%d' "$DATA_DIRECTORY" 2>/dev/null || echo 'p')"
  if [[ "$REPO_DEV" == "$PGDATA_DEV" ]]; then
    warn "repo and PGDATA are on the SAME filesystem. Expected on this single-disk host, but it means a runaway WAL archive can fill the disk and take PostgreSQL down. This is why noramedi-pgbackrest-backup.sh aborts below a free-space floor, and it is a reason NOT to shorten archive_timeout below 300s."
  fi
fi

FREE_MB=0
if [[ -d "$REPO_PATH" ]]; then
  FREE_MB="$(df -Pm "$REPO_PATH" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"
  if [[ ! "$FREE_MB" =~ ^[0-9]+$ ]]; then
    bad "could not read free space for '$REPO_PATH'"
  elif [[ "$FREE_MB" -lt "$MIN_FREE_MB" ]]; then
    bad "only ${FREE_MB} MB free on the repo filesystem; ${MIN_FREE_MB} MB required before activating WAL archiving"
  else
    ok "${FREE_MB} MB free (floor ${MIN_FREE_MB} MB)"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════
# 6. Stanza must already exist  (ordering guard)
# ═════════════════════════════════════════════════════════════════════════
log "── 6. stanza ──"
# ⚠ DO NOT REDUCE THIS TO `pgbackrest info >/dev/null; then`.
#
# `pgbackrest info` is an INFORMATIONAL command: it exits 0 for a stanza that
# does not exist and reports the absence inside the JSON body instead. Trusting
# its exit status therefore reports "stanza exists" on a host where none was
# ever created — and this is the guard that stops --apply from writing an
# archive_command pointing at a non-existent stanza, which is the exact
# sequence this script's header describes as ending in "pg_wal grows without
# bound, and the cluster shuts down on a full disk".
#
# The authoritative signal used here is the FILESYSTEM: `stanza-create` builds
# <repo>/archive/<stanza> and <repo>/backup/<stanza>. That is directly
# observable, needs no JSON parsing, and — unlike pgBackRest's numeric status
# codes, which Agent A flagged as version-dependent and not safe to hard-code —
# does not change between releases. The `info` body is then read as a
# cross-check and reported, but never as the sole basis for the decision.
STANZA_EXISTS=false
if [[ -n "$PGBR_VERSION" ]] && [[ -f "$PGBACKREST_CONF" ]]; then
  ARCHIVE_DIR="$REPO_PATH/archive/$STANZA"
  BACKUP_DIR_STANZA="$REPO_PATH/backup/$STANZA"
  if [[ -d "$ARCHIVE_DIR" ]] && [[ -d "$BACKUP_DIR_STANZA" ]]; then
    STANZA_EXISTS=true
    ok "stanza '$STANZA' exists (archive/ and backup/ present under $REPO_PATH)"

    # Cross-check the body. A stanza directory that exists while info reports a
    # problem is worth surfacing, but it does not by itself block: a freshly
    # created stanza legitimately has no backups yet, and that condition is
    # reported as a non-zero status code by design.
    INFO_BODY="$(as_pg "pgbackrest --stanza=$(printf '%q' "$STANZA") info --output=json" 2>/dev/null || true)"
    if [[ -z "$INFO_BODY" ]] || [[ "$INFO_BODY" == "[]" ]]; then
      warn "'pgbackrest info' returned nothing for stanza '$STANZA' even though its repository directories exist — inspect before proceeding"
    fi
  else
    bad "stanza '$STANZA' does not exist yet (expected $ARCHIVE_DIR and $BACKUP_DIR_STANZA). Create it BEFORE enabling archive_mode, or every WAL push will fail and pg_wal will grow until the disk is full:"
    log  "     sudo -u $PG_SUPERUSER pgbackrest --stanza=$STANZA stanza-create"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════
# 7. Intended change
# ═════════════════════════════════════════════════════════════════════════
NPROC="$(nproc 2>/dev/null || echo 1)"
[[ "$NPROC" =~ ^[0-9]+$ ]] || NPROC=1
PROCESS_MAX=$(( NPROC < 2 ? NPROC : 2 ))

COMPRESS_TYPE="gz"
if [[ "$ZSTD_SUPPORTED" == true ]]; then COMPRESS_TYPE="zst"
elif [[ -n "$PGBR_VERSION" ]] && pgbackrest help backup compress-type 2>/dev/null | grep -qw 'lz4'; then COMPRESS_TYPE="lz4"; fi

echo
echo "════════════════════════════════════════════════════════════════════════"
echo " HOST-DERIVED VALUES for ops/pgbackrest/pgbackrest.conf"
echo "════════════════════════════════════════════════════════════════════════"
echo "  pg1-path      = $DATA_DIRECTORY"
echo "  process-max   = $PROCESS_MAX          (nproc = $NPROC)"
echo "  repo1-bundle  = $([[ "$BUNDLE_SUPPORTED" == true ]] && echo 'y' || echo '(omit — needs pgbackrest >= 2.41)')"
echo "  compress-type = $COMPRESS_TYPE"
echo
echo "════════════════════════════════════════════════════════════════════════"
echo " INTENDED POSTGRESQL CHANGE"
echo "   target : ${DROPIN_PATH:-<undetermined>}"
echo "   restart: REQUIRED (archive_mode is postmaster-level)"
echo "════════════════════════════════════════════════════════════════════════"
cat <<EOF
# 10-noramedi-pitr.conf — written by noramedi-pgbackrest-preflight.sh
# Task F4-FCR-002. Rollback: delete this file and restart PostgreSQL.
archive_mode = on
archive_command = '${INTENDED_ARCHIVE_COMMAND}'
archive_timeout = ${ARCHIVE_TIMEOUT}
EOF
echo "════════════════════════════════════════════════════════════════════════"
echo

# ═════════════════════════════════════════════════════════════════════════
# 8. Apply
# ═════════════════════════════════════════════════════════════════════════
if [[ "$FAILED" -gt 0 ]]; then
  log "$FAILED check(s) FAILED — nothing was written"
  exit 1
fi

if [[ "$APPLY" != true ]]; then
  ok "all checks passed (dry-run: nothing was written)"
  log "re-run with --apply to write ${DROPIN_PATH}"
  exit 0
fi

if [[ "$STANZA_EXISTS" != true ]]; then
  bad "--apply refused: the stanza must exist before archive_mode is enabled"
  exit 1
fi

if [[ -e "$DROPIN_PATH" ]]; then
  ambiguous "'$DROPIN_PATH' already exists. Refusing to overwrite — inspect it, and delete it deliberately if it is stale."
fi

TMP_DROPIN="$(mktemp)"
trap 'rm -f "$TMP_DROPIN"' EXIT
cat > "$TMP_DROPIN" <<EOF
# 10-noramedi-pitr.conf — written by noramedi-pgbackrest-preflight.sh
# Task F4-FCR-002 on $(timestamp)
#
# Rollback: delete this file and restart PostgreSQL.
#   rm ${DROPIN_PATH} && systemctl restart postgresql
archive_mode = on
archive_command = '${INTENDED_ARCHIVE_COMMAND}'
archive_timeout = ${ARCHIVE_TIMEOUT}
EOF
install -o root -g root -m 0644 "$TMP_DROPIN" "$DROPIN_PATH"
ok "wrote $DROPIN_PATH"

echo
warn "NOT ACTIVE YET. archive_mode is postmaster-level; this script does not and will not restart PostgreSQL."
cat <<EOF

  Next, during an approved maintenance window:

    systemctl restart postgresql
    sudo -u ${PG_SUPERUSER} psql -Atc "SHOW archive_mode;"      # expect: on
    sudo -u ${PG_SUPERUSER} pgbackrest --stanza=${STANZA} check  # THE GATE — do not proceed on failure
    sudo -u ${PG_SUPERUSER} pgbackrest --stanza=${STANZA} --type=full backup
    sudo -u ${PG_SUPERUSER} pgbackrest --stanza=${STANZA} info

  Rollback, at any point:

    rm ${DROPIN_PATH} && systemctl restart postgresql

  The 03:15 pg_dump chain (/usr/local/sbin/noramedi-db-backup.sh) is untouched
  by all of the above and remains the fallback throughout.
EOF
exit 0

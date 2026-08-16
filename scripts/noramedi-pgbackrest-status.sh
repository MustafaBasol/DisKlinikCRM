#!/usr/bin/env bash
# noramedi-pgbackrest-status.sh — F4-FCR-002
# Deploy to: /usr/local/sbin/noramedi-pgbackrest-status.sh
# chmod +x /usr/local/sbin/noramedi-pgbackrest-status.sh
# Intended runner: ops/systemd/noramedi-pgbackrest-status.{service,timer}
#                  (root, oneshot, every 15 minutes)
#
# Collects PITR / WAL-archive health and publishes it as a small, flat JSON
# document at /var/lib/noramedi/pitr-status.json.
#
# READ-ONLY WITH RESPECT TO PRODUCTION DATA. It runs `SHOW`/`SELECT` against
# pg_catalog, `pgbackrest info`, and (rate-limited) `pgbackrest check`. It
# never backs up, restores, expires, starts, stops, or reloads anything, and
# it never reads a patient row.
#
# ── WHY THIS SCRIPT EXISTS SEPARATELY FROM noramedi-opscheck.sh ───────────
# opscheck is the production dead-man's-switch monitor. Two properties make
# it trustworthy and both would be destroyed by making it talk to pgBackRest
# directly:
#
#   1. It carries no credentials and has no install-time dependencies beyond
#      coreutils + node. Adding `runuser -u postgres pgbackrest` would make
#      the monitor depend on the very subsystem it monitors.
#   2. Its systemd unit sets TimeoutStartSec=60. `pgbackrest info` against a
#      network-backed repository can exceed that. If it did, systemd would
#      kill the WHOLE opscheck run — so pm2, disk, backup, filebackup and
#      drill would all stop pinging, and ~20 minutes later the operator would
#      receive five simultaneous FALSE alerts. One slow backup repository
#      must not be able to take out unrelated monitoring.
#
# So the slow, dependency-heavy work happens here, on its own timer, and
# opscheck's `pitr` check only reads the resulting file — bounded, fast, and
# fail-closed if this writer dies (the generatedAt staleness gate catches it).
#
# ── WHAT THIS SCRIPT WILL NEVER CLAIM ────────────────────────────────────
# offHost is emitted as "no" or "unproven" ONLY. This script cannot emit
# "yes" from its own observations, because configuration is not proof:
# a remote-looking target may still be this machine, and an existing repo2 is
# not evidence that a restore from it has ever worked. "yes" requires a
# recorded, successful restore drill sourced from repo2, which
# noramedi-pgbackrest-restore-drill.sh writes as a separate proof marker.
# See --help of that script.
#
# Usage:
#   noramedi-pgbackrest-status.sh [--stanza NAME] [--out PATH] [--stdout]
#                                 [--no-check] [-h|--help]
#
# Options:
#   --stanza NAME  Default: noramedi
#   --out PATH     Default: /var/lib/noramedi/pitr-status.json
#   --stdout       Print the document instead of writing it. Nothing is
#                  written to disk. Safe on production; useful for a smoke
#                  test before installing the timer.
#   --no-check     Skip `pgbackrest check` entirely this run.
#
# Environment (optional; defaults shown):
#   NORAMEDI_PGBACKREST_STANZA           noramedi   (--stanza overrides)
#   NORAMEDI_PITR_STATUS_FILE            /var/lib/noramedi/pitr-status.json
#   NORAMEDI_PGBACKREST_CONF             /etc/pgbackrest/pgbackrest.conf
#   NORAMEDI_PGBACKREST_REPO_PATH        /var/lib/pgbackrest
#   NORAMEDI_PGBACKREST_STATE_DIR        /var/lib/noramedi-pgbackrest
#   NORAMEDI_PGBACKREST_OFFHOST_PROOF    /var/lib/noramedi/pitr-offhost-proof.json
#   NORAMEDI_PGBACKREST_CHECK_MIN_INTERVAL_SECONDS  3600
#       `pgbackrest check` forces a WAL segment switch. Running it every tick
#       would generate a segment every 15 minutes purely for monitoring, so
#       it is rate-limited and its last result is cached in the state dir.
#   NORAMEDI_PGBACKREST_OFFHOST_PROOF_MAX_AGE_HOURS 720   (30 days)
#   NORAMEDI_PG_SUPERUSER                postgres
#   NORAMEDI_PGBACKREST_CMD_TIMEOUT      60   seconds, per pgbackrest call
#
# Exit codes:
#   0  the document was written (or printed). NOTE: exit 0 does NOT mean PITR
#      is healthy — it means the status was successfully COLLECTED. Health is
#      the consumer's judgement, made by opscheck's `pitr` check against the
#      document's contents. Conflating "I measured it" with "it is fine" is
#      exactly how a monitor reports false green.
#   1  the document could not be written
#   2  usage / CLI error, or an invalid environment value (fail closed)

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
SCHEMA_VERSION=1

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
warn() { echo "[pgbackrest-status] $(timestamp) WARN — $*" >&2; }
fail() { echo "[pgbackrest-status] $(timestamp) FAIL — $*" >&2; }

# Env default so the systemd EnvironmentFile can set the stanza without the
# unit's ExecStart line needing an argument; --stanza still overrides it.
STANZA="${NORAMEDI_PGBACKREST_STANZA:-noramedi}"
OUT_OVERRIDE=""
TO_STDOUT=false
SKIP_CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stanza)   STANZA="${2:-}"; shift 2 ;;
    --out)      OUT_OVERRIDE="${2:-}"; shift 2 ;;
    --stdout)   TO_STDOUT=true; shift ;;
    --no-check) SKIP_CHECK=true; shift ;;
    -h|--help)  usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

[[ "$STANZA" =~ ^[a-z0-9][a-z0-9_]{0,31}$ ]] || {
  echo "Invalid --stanza '$STANZA'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

OUT_FILE="${OUT_OVERRIDE:-${NORAMEDI_PITR_STATUS_FILE:-/var/lib/noramedi/pitr-status.json}}"
PGBACKREST_CONF="${NORAMEDI_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}"
REPO_PATH="${NORAMEDI_PGBACKREST_REPO_PATH:-/var/lib/pgbackrest}"
STATE_DIR="${NORAMEDI_PGBACKREST_STATE_DIR:-/var/lib/noramedi-pgbackrest}"
OFFHOST_PROOF="${NORAMEDI_PGBACKREST_OFFHOST_PROOF:-/var/lib/noramedi/pitr-offhost-proof.json}"
CHECK_MIN_INTERVAL="${NORAMEDI_PGBACKREST_CHECK_MIN_INTERVAL_SECONDS:-3600}"
PROOF_MAX_AGE_HOURS="${NORAMEDI_PGBACKREST_OFFHOST_PROOF_MAX_AGE_HOURS:-720}"
PG_SUPERUSER="${NORAMEDI_PG_SUPERUSER:-postgres}"
CMD_TIMEOUT="${NORAMEDI_PGBACKREST_CMD_TIMEOUT:-60}"

for pair in "CHECK_MIN_INTERVAL:$CHECK_MIN_INTERVAL" "PROOF_MAX_AGE_HOURS:$PROOF_MAX_AGE_HOURS" "CMD_TIMEOUT:$CMD_TIMEOUT"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -gt 0 ]] || {
    echo "Invalid $name '$value' (expected positive integer)" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }
done

command -v node >/dev/null 2>&1 || {
  fail "node is required to parse 'pgbackrest info --output=json' safely"
  exit 1; }

# build_cmd — per-argument %q escaping, for the one delegation form that can
# only take a string.
build_cmd() { local out=""; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "$out"; }

# as_pg ARGV... — runs a command as the PostgreSQL OS user.
#
# ⚠ TAKES AN ARGUMENT VECTOR, NOT A COMMAND STRING, AND THAT IS LOAD-BEARING.
# The earlier string form built `bash -c "... as_pg <escaped string>"` and then
# `as_pg` re-parsed its argument through another `bash -c`. That is TWO parse
# layers against ONE layer of escaping, so every embedded double quote was
# silently eaten. Concretely: the pg_stat_archiver query's
# `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` arrived at PostgreSQL as
# `'YYYY-MM-DDTHH24:MI:SSZ'`, in which `TH` is to_char's ORDINAL-SUFFIX
# pattern — so the result was not ISO-8601, the writer's own validator
# discarded it, `lastArchivedAgeMinutes` was omitted from every document, and
# the monitor failed permanently with "no WAL segment has ever been archived"
# on a perfectly healthy cluster. Fail-closed, but permanently and falsely —
# which trains an operator to ignore the one check that detects a broken WAL
# archive. Keep the argv form.
#
# Only the `su` fallback must flatten to a string; build_cmd escapes each
# argument for exactly the one parse `su -c` performs.
as_pg() {
  if [[ "$(id -un 2>/dev/null || echo '')" == "$PG_SUPERUSER" ]]; then
    timeout "$CMD_TIMEOUT" "$@"
  elif command -v runuser >/dev/null 2>&1; then
    timeout "$CMD_TIMEOUT" runuser -u "$PG_SUPERUSER" -- "$@"
  elif command -v su >/dev/null 2>&1; then
    timeout "$CMD_TIMEOUT" su -s /bin/bash "$PG_SUPERUSER" -c "$(build_cmd "$@")"
  else
    return 127
  fi
}

psql_one() {
  as_pg psql -Atc "$1" 2>/dev/null || true
}

Q_STANZA="$(printf '%q' "$STANZA")"

# ── PostgreSQL side ──────────────────────────────────────────────────────
ARCHIVE_MODE="$(psql_one 'SHOW archive_mode;')"
WAL_LEVEL="$(psql_one 'SHOW wal_level;')"
ARCHIVE_COMMAND="$(psql_one 'SHOW archive_command;')"
ARCHIVE_TIMEOUT_RAW="$(psql_one 'SHOW archive_timeout;')"

# pg_stat_archiver is the ONLY source of a real timestamp for WAL archiving.
# `pgbackrest info` reports WHICH segments exist but carries no time for
# them, so without this a stale archive is indistinguishable from an idle
# cluster. Emitted as ISO-8601 UTC with a trailing Z to match the parser
# contract every other status file in this program uses.
# Built by CONCATENATION rather than with to_char's double-quoted literals
# (`'YYYY-MM-DD"T"HH24:MI:SS"Z"'`). Belt and braces alongside the argv fix in
# as_pg: this SQL contains no double quote at all, so it survives intact even
# through the `su -c` fallback, which is the one delegation path that still
# has to flatten to a string. `TH` in a to_char pattern is the ordinal-suffix
# directive, so a stripped `"T"` does not merely look wrong — it changes the
# meaning of the format and silently produces a non-ISO value.
ARCHIVER_SQL="SELECT COALESCE(to_char(last_archived_time AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(last_archived_time AT TIME ZONE 'UTC','HH24:MI:SS') || 'Z','') || '|' || COALESCE(to_char(last_failed_time AT TIME ZONE 'UTC','YYYY-MM-DD') || 'T' || to_char(last_failed_time AT TIME ZONE 'UTC','HH24:MI:SS') || 'Z','') || '|' || failed_count || '|' || archived_count FROM pg_stat_archiver;"
ARCHIVER_ROW="$(psql_one "$ARCHIVER_SQL")"

LAST_ARCHIVED_AT=""; LAST_FAILED_AT=""; FAILED_COUNT=""; ARCHIVED_COUNT=""
if [[ "$ARCHIVER_ROW" == *"|"*"|"*"|"* ]]; then
  IFS='|' read -r LAST_ARCHIVED_AT LAST_FAILED_AT FAILED_COUNT ARCHIVED_COUNT <<<"$ARCHIVER_ROW"
fi

# archive_timeout is reported by SHOW with a unit suffix (e.g. "5min", "300s").
# Normalise to seconds; an unparseable value is emitted as absent rather than
# silently coerced to 0, which would read as "no forced switch configured".
ARCHIVE_TIMEOUT_SECONDS=""
if [[ "$ARCHIVE_TIMEOUT_RAW" =~ ^([0-9]+)(s|min|ms|h)?$ ]]; then
  _n="${BASH_REMATCH[1]}"; _u="${BASH_REMATCH[2]:-s}"
  case "$_u" in
    s)   ARCHIVE_TIMEOUT_SECONDS="$_n" ;;
    min) ARCHIVE_TIMEOUT_SECONDS="$(( _n * 60 ))" ;;
    h)   ARCHIVE_TIMEOUT_SECONDS="$(( _n * 3600 ))" ;;
    ms)  ARCHIVE_TIMEOUT_SECONDS="$(( _n / 1000 ))" ;;
  esac
fi

# An archive_command is "ok" only if it actually invokes pgbackrest archive-push
# for THIS stanza. A command that has been wrapped in `|| true`, `; exit 0`, or
# any other status-swallowing construct is treated as NOT ok: PostgreSQL would
# mark segments archived and recycle them while nothing reached the repository,
# and every dashboard would stay green. This is the single most destructive
# misconfiguration available here, so the test is deliberately strict —
# an exact match, not a substring search.
ARCHIVE_COMMAND_OK=false
if [[ "$ARCHIVE_COMMAND" == "pgbackrest --stanza=${STANZA} archive-push %p" ]]; then
  ARCHIVE_COMMAND_OK=true
fi

# ── pgBackRest side ──────────────────────────────────────────────────────
PGBR_INSTALLED=false
PGBR_VERSION=""
if command -v pgbackrest >/dev/null 2>&1; then
  PGBR_INSTALLED=true
  PGBR_VERSION="$(pgbackrest version 2>/dev/null | awk '{print $2}' || true)"
fi

INFO_JSON=""
if [[ "$PGBR_INSTALLED" == true ]]; then
  INFO_JSON="$(as_pg pgbackrest --stanza="$STANZA" info --output=json 2>/dev/null || true)"
fi

# ── pgbackrest check, rate-limited ───────────────────────────────────────
# `check` is the only command that validates the whole archive_command -> repo
# path end to end, which is why it is worth running at all; but it forces a WAL
# segment switch, so running it every tick would manufacture a 16 MB segment
# every 15 minutes purely for monitoring.
mkdir -p "$STATE_DIR" 2>/dev/null || true
CHECK_STATE_FILE="$STATE_DIR/last-check.state"
CHECK_STATUS="not_run"
CHECK_AT=""
NOW_EPOCH="$(date -u +%s)"

if [[ -f "$CHECK_STATE_FILE" ]]; then
  _prev="$(cat "$CHECK_STATE_FILE" 2>/dev/null || true)"
  if [[ "$_prev" =~ ^(ok|failed)\ ([0-9]+)$ ]]; then
    CHECK_STATUS="${BASH_REMATCH[1]}"
    _prev_epoch="${BASH_REMATCH[2]}"
    CHECK_AT="$(date -u -d "@${_prev_epoch}" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)"
  else
    _prev_epoch=0
  fi
else
  _prev_epoch=0
fi

if [[ "$SKIP_CHECK" != true ]] && [[ "$PGBR_INSTALLED" == true ]] \
   && [[ "$ARCHIVE_MODE" == "on" || "$ARCHIVE_MODE" == "always" ]] \
   && [[ $(( NOW_EPOCH - _prev_epoch )) -ge "$CHECK_MIN_INTERVAL" ]]; then
  if as_pg pgbackrest --stanza="$STANZA" check >/dev/null 2>&1; then
    CHECK_STATUS="ok"
  else
    CHECK_STATUS="failed"
  fi
  CHECK_AT="$(timestamp)"
  echo "$CHECK_STATUS $NOW_EPOCH" > "${CHECK_STATE_FILE}.tmp" 2>/dev/null \
    && mv -f "${CHECK_STATE_FILE}.tmp" "$CHECK_STATE_FILE" 2>/dev/null || true
fi

# ── off-host independence ────────────────────────────────────────────────
# Emits "no" or "unproven" only — never "yes". See the header.
OFFHOST="no"
OFFHOST_REASON="NO_REPO2_CONFIGURED"
OFFHOST_TIER="T0"

repo_conf_value() {
  local key="$1"
  [[ -f "$PGBACKREST_CONF" ]] || return 1
  grep -oE "^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]]+" "$PGBACKREST_CONF" 2>/dev/null \
    | sed -E 's/.*=[[:space:]]*//' | head -n1
}

CIPHER_TYPE="$(repo_conf_value 'repo1-cipher-type' || true)"
REPO2_TYPE="$(repo_conf_value 'repo2-type' || true)"
REPO2_HOST="$(repo_conf_value 'repo2-host' || true)"
REPO2_PATH="$(repo_conf_value 'repo2-path' || true)"
REPO2_S3_ENDPOINT="$(repo_conf_value 'repo2-s3-endpoint' || true)"
REPO2_CIPHER_TYPE="$(repo_conf_value 'repo2-cipher-type' || true)"

# Whether a repo2 exists AT ALL — deliberately the same test the block below
# uses to begin classifying one. It gates the repo2 backup-age fields, and is
# NOT an off-host claim: a configured repo2 may still be a local path, this
# host, or plaintext. Those verdicts are the classifier's job, immediately
# below; this flag only answers "is there a second repository to report on".
REPO2_CONFIGURED=false

# A repo1 that is on the same filesystem as PGDATA is, by definition, T0/T1.
if [[ -n "$REPO2_HOST" || -n "$REPO2_TYPE" || -n "$REPO2_PATH" ]]; then
  REPO2_CONFIGURED=true
  OFFHOST_TIER="T1"
  OFFHOST_REASON="REPO2_NOT_INDEPENDENT"

  _independent=false
  if [[ "$REPO2_TYPE" == "s3" ]]; then
    # A loopback S3 endpoint is this machine wearing an S3 costume.
    _host="${REPO2_S3_ENDPOINT#*://}"; _host="${_host%%/*}"; _host="${_host%%:*}"
    _host="${_host#[}"; _host="${_host%]}"
    case "$(printf '%s' "$_host" | tr 'A-Z' 'a-z')" in
      localhost|::1|0:0:0:0:0:0:0:1|::|0.0.0.0|127.*) _independent=false; OFFHOST_REASON="REPO2_LOOPBACK_ENDPOINT" ;;
      "") _independent=false; OFFHOST_REASON="REPO2_ENDPOINT_UNPARSEABLE" ;;
      *)  _independent=true ;;
    esac
    # Plaintext leaving the host is never off-host-ready, however remote it is.
    if [[ "$REPO2_CIPHER_TYPE" != "aes-256-cbc" ]]; then
      _independent=false; OFFHOST_REASON="REPO2_PLAINTEXT"
    fi
  elif [[ -n "$REPO2_HOST" ]]; then
    _lower="$(printf '%s' "$REPO2_HOST" | tr 'A-Z' 'a-z')"
    _self="$(hostname 2>/dev/null | tr 'A-Z' 'a-z' || true)"
    _selffqdn="$(hostname -f 2>/dev/null | tr 'A-Z' 'a-z' || true)"
    case "$_lower" in
      localhost|127.*|::1|0.0.0.0) _independent=false; OFFHOST_REASON="REPO2_LOOPBACK_HOST" ;;
      *)
        if [[ -n "$_self" && "$_lower" == "$_self" ]] || [[ -n "$_selffqdn" && "$_lower" == "$_selffqdn" ]]; then
          _independent=false; OFFHOST_REASON="REPO2_IS_THIS_HOST"
        else
          _independent=true
        fi
        ;;
    esac
    if [[ "$REPO2_CIPHER_TYPE" != "aes-256-cbc" ]]; then
      _independent=false; OFFHOST_REASON="REPO2_PLAINTEXT"
    fi
  elif [[ -n "$REPO2_PATH" ]]; then
    # A path is never off-host, however different the disk. Recorded as an
    # explicit reason because "we added a second directory" is the single most
    # likely way someone accidentally claims R-030 is closed.
    _independent=false
    OFFHOST_REASON="REPO2_IS_A_LOCAL_PATH"
  fi

  if [[ "$_independent" == true ]]; then
    OFFHOST="unproven"
    OFFHOST_TIER="T2"
    OFFHOST_REASON="NO_RESTORE_PROOF_FROM_REPO2"
    # A successful restore drill sourced from repo2 is the only thing that
    # upgrades this to "yes". Configuration is not proof.
    # The currently-configured repo2 target, so a proof earned against a
    # DIFFERENT target cannot be inherited by a newly-repointed repository.
    CURRENT_TARGET="${REPO2_HOST:-${REPO2_S3_ENDPOINT:-${REPO2_PATH:-}}}"
    # -f, not -e: a symlink pointing at an attacker-writable location must not
    # be able to manufacture off-host readiness.
    if [[ -f "$OFFHOST_PROOF" ]] && [[ ! -L "$OFFHOST_PROOF" ]]; then
      # No top-level `return` here: `node -e` compiles its argument as a
      # script, not a function body, so a bare `return` is a SyntaxError and
      # the whole snippet would fail — silently yielding 0 and making the
      # off-host state permanently unprovable. An IIFE gives a real function
      # scope to return from.
      _proof_epoch="$(node -e '
        const fs = require("fs");
        const epoch = (() => {
          try {
            const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            // Every field is checked: a proof from repo1 (the LOCAL
            // repository) or from a failed drill must never count.
            if (d && d.result === "passed" && Number(d.repo) >= 2 && typeof d.finishedAt === "string") {
              // The proof must have been earned against the CURRENTLY
              // configured target. argv[2] is that target; a proof written
              // before this binding existed carries "unknown" and is refused,
              // which is the correct direction to fail.
              const want = process.argv[2] || "";
              if (want !== "" && d.target !== want) return 0;
              const t = Date.parse(d.finishedAt);
              if (Number.isFinite(t)) return Math.floor(t / 1000);
            }
          } catch { /* missing, unreadable, or malformed => no proof */ }
          return 0;
        })();
        process.stdout.write(String(epoch));
      ' "$OFFHOST_PROOF" "$CURRENT_TARGET" 2>/dev/null || echo 0)"
      [[ "$_proof_epoch" =~ ^[0-9]+$ ]] || _proof_epoch=0
      if [[ "$_proof_epoch" -gt 0 ]] \
         && [[ $(( NOW_EPOCH - _proof_epoch )) -le $(( PROOF_MAX_AGE_HOURS * 3600 )) ]] \
         && [[ "$_proof_epoch" -le "$NOW_EPOCH" ]]; then
        OFFHOST="yes"
        OFFHOST_TIER="T2"
        OFFHOST_REASON="RESTORE_PROVEN_FROM_REPO2"
      else
        OFFHOST_REASON="RESTORE_PROOF_STALE_OR_FUTURE"
      fi
    fi
  fi
fi

# ── assemble ─────────────────────────────────────────────────────────────
# Node builds the JSON so quoting and escaping are correct by construction,
# following the `node -e` precedent already used by opscheck's check_pm2().
DOC="$(
  SV="$SCHEMA_VERSION" GEN="$(timestamp)" \
  A_MODE="${ARCHIVE_MODE:-}" A_WAL="${WAL_LEVEL:-}" A_CMDOK="$ARCHIVE_COMMAND_OK" \
  A_TIMEOUT="${ARCHIVE_TIMEOUT_SECONDS:-}" A_FAILED="${FAILED_COUNT:-}" \
  A_ARCHIVED="${ARCHIVED_COUNT:-}" A_LASTOK="${LAST_ARCHIVED_AT:-}" A_LASTFAIL="${LAST_FAILED_AT:-}" \
  R_INSTALLED="$PGBR_INSTALLED" R_VERSION="${PGBR_VERSION:-}" R_STANZA="$STANZA" \
  R_CIPHER="${CIPHER_TYPE:-none}" R_CHECK="$CHECK_STATUS" R_CHECKAT="${CHECK_AT:-}" \
  R_OFFHOST="$OFFHOST" R_TIER="$OFFHOST_TIER" R_REASON="$OFFHOST_REASON" \
  R_REPO2_CONFIGURED="$REPO2_CONFIGURED" \
  node -e '
    let raw = "";
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      const E = process.env;
      const now = Date.now();
      const iso = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) ? v : undefined;
      const uint = v => (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : undefined;
      // Ages fail closed: a FUTURE timestamp (clock skew) yields undefined
      // rather than a negative age that would read as "brand new".
      const ageMin = v => { const t = iso(v) ? Date.parse(v) : NaN;
        if (!Number.isFinite(t) || t > now) return undefined;
        return Math.floor((now - t) / 60000); };
      const put = (o, k, v) => { if (v !== undefined && v !== "") o[k] = v; };

      const archive = { mode: E.A_MODE || "unknown", commandOk: E.A_CMDOK === "true" };
      put(archive, "walLevel", E.A_WAL);
      put(archive, "timeoutSeconds", uint(E.A_TIMEOUT));
      put(archive, "failedCount", uint(E.A_FAILED));
      put(archive, "archivedCount", uint(E.A_ARCHIVED));
      put(archive, "lastArchivedAt", iso(E.A_LASTOK));
      put(archive, "lastArchivedAgeMinutes", ageMin(E.A_LASTOK));
      put(archive, "lastFailedAt", iso(E.A_LASTFAIL));

      const repo = {
        installed: E.R_INSTALLED === "true",
        stanza: E.R_STANZA,
        cipherType: E.R_CIPHER || "none",
        checkStatus: E.R_CHECK || "not_run",
        offHost: E.R_OFFHOST || "no",
        tier: E.R_TIER || "T0",
        offHostReason: E.R_REASON || "UNKNOWN",
        statusOk: false,
      };
      put(repo, "version", E.R_VERSION);
      put(repo, "checkAt", iso(E.R_CHECKAT));
      put(repo, "checkAgeMinutes", ageMin(E.R_CHECKAT));

      // `pgbackrest info --output=json` is a deeply nested array. opscheck s
      // grep-based helpers structurally cannot read it, and jq is not a
      // dependency anywhere in this repo — hence node, per check_pm2().
      let info = null;
      try { info = JSON.parse(raw); } catch { /* absent or unparseable */ }
      if (Array.isArray(info) && info.length > 0) {
        const s = info.find(x => x && x.name === E.R_STANZA) || info[0];
        if (s && s.status && typeof s.status.code === "number") {
          // Only 0 is documented as "ok". Non-zero code VALUES are
          // version-dependent, so nothing else is hard-coded: anything that
          // is not 0 is a failure and the message is carried verbatim.
          repo.statusOk = s.status.code === 0;
          if (!repo.statusOk && typeof s.status.message === "string") {
            // Braces are stripped ALONG WITH control characters. They are
            // printable ASCII, so the [\x20-\x7E] filter alone would let a
            // pgBackRest error message containing a brace through, and a brace
            // inside this string breaks the flat-object extraction the
            // consumer performs over the whole "repo" object.
            // (No apostrophes in this block: it lives inside node -e in a
            // single-quoted shell string.)
            repo.statusMessage = s.status.message
              .slice(0, 120)
              .replace(/[^\x20-\x7E]/g, " ")
              .replace(/[{}]/g, " ");
          }
        }
        if (typeof s?.cipher === "string") repo.cipherType = s.cipher;

        // ── PER-REPOSITORY, not aggregate ──────────────────────────────
        // `pgbackrest info` reports EVERY configured repository in one flat
        // backup[]. Taking max() across the whole array was correct while
        // repo1 was the only repository and becomes a false green the moment
        // a repo2 exists: the fresh nightly backups of repo1 keep the
        // aggregate young while repo2 receives nothing, and the document
        // reports a healthy backup age for a repository that is starving.
        // (No apostrophes in this block: single-quoted shell string.)
        //
        // Multi-repo builds tag each entry with database["repo-key"]. When
        // that tag is absent (single-repo build, or an older pgBackRest)
        // every entry belongs to repo1, which makes the repo1 figures below
        // byte-for-byte what this script published before.
        const repoKeyOf = b => {
          const k = b?.database?.["repo-key"];
          return (typeof k === "number") ? k : undefined;
        };
        const backupsFor = key => (Array.isArray(s?.backup) ? s.backup : [])
          .filter(b => { const k = repoKeyOf(b); return k === undefined ? key === 1 : k === key; });
        const newestOf = list => {
          // max() over every entry rather than indexing [-1]: ordering of
          // backup[] is not guaranteed by any documented contract.
          let newest = null;
          for (const b of list) {
            const stop = b?.timestamp?.stop;
            if (typeof stop === "number" && (newest === null || stop > newest.stop)) {
              newest = { stop, type: b.type, label: b.label };
            }
          }
          return newest;
        };

        const repo1Backups = backupsFor(1);
        const newest1 = newestOf(repo1Backups);
        if (newest1) {
          const at = new Date(newest1.stop * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
          put(repo, "lastBackupAt", at);
          put(repo, "lastBackupAgeMinutes", ageMin(at));
          put(repo, "lastBackupType", typeof newest1.type === "string" ? newest1.type : undefined);
        }
        repo.backupCount = repo1Backups.length;

        // repo2 figures are emitted ONLY when a repo2 is configured, so a
        // single-repo host publishes exactly the document it published
        // before. Emitted even when the count is zero — "configured and
        // empty" is precisely the state that must be distinguishable from
        // "not configured", and it is the state an operator lands in after
        // adding repo2 and forgetting to back up to it.
        if (E.R_REPO2_CONFIGURED === "true") {
          const repo2Backups = backupsFor(2);
          const newest2 = newestOf(repo2Backups);
          if (newest2) {
            const at2 = new Date(newest2.stop * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
            put(repo, "repo2LastBackupAt", at2);
            put(repo, "repo2LastBackupAgeMinutes", ageMin(at2));
          }
          repo.repo2BackupCount = repo2Backups.length;
        }

        if (Array.isArray(s?.archive) && s.archive.length > 0) {
          // One entry per database history; after a PITR promote there can be
          // more than one, so take the last rather than assuming [0].
          const a = s.archive[s.archive.length - 1];
          if (typeof a?.min === "string") put(repo, "walMin", a.min);
          if (typeof a?.max === "string") put(repo, "walMax", a.max);
        }
      }

      const doc = { schemaVersion: Number(E.SV), generatedAt: E.GEN, archive, repo };
      process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    });
  ' <<<"$INFO_JSON"
)" || { fail "could not assemble the status document"; exit 1; }

# The consumer contract requires exactly one "schemaVersion" in the whole
# document and no nested objects inside `archive`/`repo`. Verify our own
# output before publishing rather than trusting it — a writer that emits an
# unparseable document would make every downstream check fail closed, which is
# safe but indistinguishable from a real outage.
if [[ "$(grep -c '"schemaVersion"' <<<"$DOC")" -ne 1 ]]; then
  fail "assembled document does not contain exactly one schemaVersion"
  exit 1
fi

# FLATNESS, checked rather than merely asserted in a comment. The consumer
# extracts these with `\{[^{}]*\}`, so a nested object — or a brace that leaked
# into a string value — makes the extraction silently not match, and the check
# fails closed with a diagnostic pointing at the wrong thing. Verified against
# the same whitespace-collapsed form the consumer builds.
_FLAT="$(tr -s '\n\r\t ' ' ' <<<"$DOC")"
for _obj in archive repo; do
  if ! grep -qE "\"${_obj}\"[[:space:]]*:[[:space:]]*\{[^{}]*\}" <<<"$_FLAT"; then
    fail "assembled document's '${_obj}' object is not flat — the consumer's parser cannot read it"
    exit 1
  fi
done

if [[ "$TO_STDOUT" == true ]]; then
  printf '%s' "$DOC"
  exit 0
fi

OUT_DIR="$(dirname "$OUT_FILE")"
if [[ ! -d "$OUT_DIR" ]]; then
  # Deliberately not created here: provisioning is an install step, and a
  # writer that silently creates its own directory hides a misconfigured path.
  fail "directory '$OUT_DIR' does not exist — create it as part of installation (install -d -o root -g root -m 0755 $OUT_DIR)"
  exit 1
fi

TMP_OUT="$(mktemp "${OUT_DIR}/.pitr-status.XXXXXX")"
trap 'rm -f "$TMP_OUT"' EXIT
printf '%s' "$DOC" > "$TMP_OUT"
chmod 0600 "$TMP_OUT"
mv -f "$TMP_OUT" "$OUT_FILE"
trap - EXIT
exit 0

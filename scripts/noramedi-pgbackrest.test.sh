#!/usr/bin/env bash
# noramedi-pgbackrest.test.sh — F4-FCR-002
#
# Run with: bash scripts/noramedi-pgbackrest.test.sh
#
# Covers the four pgBackRest shell scripts added by F4-FCR-002. It exists
# because of a concrete gap, not as a formality:
#
#   - scripts/log-privacy-guard scans server/src/{routes,services,jobs,
#     middleware,utils} and only `.ts` files, so a `.sh` file under scripts/
#     is invisible to it;
#   - server/src/tests/adminScriptsLogPrivacy.test.ts names three `.ts` paths
#     literally, not a glob;
#   - the only shell step in CI is `bash -n` over scripts/test-runtime/*.sh;
#   - there is no shellcheck step and no secret scanner anywhere in the repo.
#
# So without this file the new scripts would have NO automated guard at all.
# The canary-token sections below follow the precedent already established in
# noramedi-opscheck.test.sh ("No secret leakage"): inject a unique token as the
# secret, force the code down its failure paths, capture merged stdout+stderr,
# and assert the token never appears.
#
# Deliberately `set -uo pipefail` WITHOUT -e, matching noramedi-opscheck.test.sh:
# a failing assertion must record a failure and continue, not abort the run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$SCRIPT_DIR/noramedi-pgbackrest-preflight.sh"
BACKUP="$SCRIPT_DIR/noramedi-pgbackrest-backup.sh"
STATUS="$SCRIPT_DIR/noramedi-pgbackrest-status.sh"
DRILL="$SCRIPT_DIR/noramedi-pgbackrest-restore-drill.sh"
ALL_SCRIPTS=("$PREFLIGHT" "$BACKUP" "$STATUS" "$DRILL")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKEBIN="$WORK/bin"
mkdir -p "$FAKEBIN"

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); echo "  ok - $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL - $1"; }
section() { echo; echo "$1"; }

# The one token that must never be printed by anything, on any code path.
CANARY="cipherpass-CANARY-d0-n0t-pr1nt-th1s-t0ken"

OUT=""
CODE=0
run() {
  set +e
  OUT="$(PATH="$FAKEBIN:$PATH" env "${EXTRA_ENV[@]}" "$@" 2>&1)"
  CODE=$?
  set -e
  EXTRA_ENV=()
}
EXTRA_ENV=()

# ── fakes ────────────────────────────────────────────────────────────────
# runuser is faked so delegation works without root: it strips `-u USER --`
# and runs the rest. This mirrors what the real command does for our purposes
# and lets every delegated code path execute under the test user.
write_fake_runuser() {
  cat > "$FAKEBIN/runuser" <<'EOF'
#!/usr/bin/env bash
while [[ $# -gt 0 ]]; do
  case "$1" in
    -u) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
EOF
  chmod +x "$FAKEBIN/runuser"
}

# psql fake: answers `SHOW <guc>;` and the pg_stat_archiver row from env.
write_fake_psql() {
  cat > "$FAKEBIN/psql" <<'EOF'
#!/usr/bin/env bash
sql=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -Atc) sql="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$sql" in
  *"SHOW archive_mode"*)    echo "${FAKE_ARCHIVE_MODE:-off}" ;;
  *"SHOW wal_level"*)       echo "${FAKE_WAL_LEVEL:-replica}" ;;
  *"SHOW archive_command"*) echo "${FAKE_ARCHIVE_COMMAND:-}" ;;
  *"SHOW archive_timeout"*) echo "${FAKE_ARCHIVE_TIMEOUT:-300s}" ;;
  # `-` not `:-` on purpose: a test needs to simulate a cluster that answers
  # with NOTHING, which is the input the production-PGDATA guard must fail
  # closed on. `:-` would silently substitute the default and the guard would
  # look like it passed.
  *"SHOW data_directory"*)  echo "${FAKE_DATA_DIRECTORY-/var/lib/postgresql/16/main}" ;;
  *"SHOW config_file"*)     echo "${FAKE_CONFIG_FILE:-/etc/postgresql/16/main/postgresql.conf}" ;;
  *"SHOW include_dir"*)     echo "${FAKE_INCLUDE_DIR:-}" ;;
  *"SHOW server_version"*)  echo "${FAKE_SERVER_VERSION:-16.14}" ;;
  # WAL backlog (F4-FCR-003-R1). `-` not `:-`: a test needs to simulate a
  # cluster that answers with NOTHING, which is the input the writer must omit
  # the fields for rather than reporting an empty backlog.
  *pg_ls_waldir*)           echo "${FAKE_WAL_BACKLOG_ROW-268435456|3}" ;;
  *pg_stat_archiver*)
    # This fake DELIBERATELY inspects the SQL it received rather than blindly
    # echoing a fixture.
    #
    # The previous version matched `*pg_stat_archiver*` and printed
    # $FAKE_ARCHIVER_ROW regardless of what actually arrived, which made it
    # structurally incapable of noticing that the query had been mangled in
    # transit. It was: the delegation used to re-parse the command string, so
    # every embedded quote was eaten and the ISO format directive silently
    # became something else. A test that ignores its input cannot catch that.
    #
    # The writer now builds the timestamp by concatenation and must therefore
    # send `|| 'T' ||`. If any future refactor reintroduces a parse layer that
    # strips quoting, this returns the CORRUPT marker instead of a timestamp,
    # the writer's ISO validator discards it, and the "healthy run emits
    # lastArchivedAgeMinutes" assertion fails loudly.
    if [[ "$sql" == *"|| 'T' ||"* ]] && [[ "$sql" == *"'Z'"* ]]; then
      echo "${FAKE_ARCHIVER_ROW:-|||}"
    else
      echo "SQL-QUOTING-CORRUPTED-IN-TRANSIT|||"
    fi
    ;;
  *) echo "" ;;
esac
exit 0
EOF
  chmod +x "$FAKEBIN/psql"
}

# pgbackrest fake: `version`, `info --output=json`, `check`, `restore`.
# Every invocation is appended to $WORK/pgbackrest.log so a test can assert that
# a precondition failure happened BEFORE anything was restored — "it exited 3"
# and "it exited 3 without writing a cross-tenant copy of the patient database
# into tmpfs first" are different claims.
write_fake_pgbackrest() {
  cat > "$FAKEBIN/pgbackrest" <<EOF
#!/usr/bin/env bash
echo "pgbackrest \$*" >> "${WORK}/pgbackrest.log"
for a in "\$@"; do
  case "\$a" in
    version) echo "pgBackRest \${FAKE_PGBR_VERSION:-2.54.2}"; exit 0 ;;
  esac
done
case "\$*" in
  # The wrapper always ends the backup/expire command with the subcommand word,
  # so anchor on that rather than on a bare *backup* — repository paths such as
  # /root/noramedi-backups would otherwise match and silently swallow a run.
  *" backup")
    [[ -n "\${FAKE_BACKUP_STDERR:-}" ]] && echo "\${FAKE_BACKUP_STDERR}" >&2
    exit "\${FAKE_BACKUP_RC:-0}" ;;
  *" expire") exit "\${FAKE_EXPIRE_RC:-0}" ;;
  *info*) printf '%s' "\${FAKE_INFO_JSON:-[]}"; exit "\${FAKE_INFO_RC:-0}" ;;
  *check*) exit "\${FAKE_CHECK_RC:-0}" ;;
  *restore*) exit "\${FAKE_RESTORE_RC:-0}" ;;
  *help*) echo "zst lz4 gz none"; exit 0 ;;
esac
exit 0
EOF
  chmod +x "$FAKEBIN/pgbackrest"
}

# df fake: -Pm output with a controllable free-MB figure, and -PT output with a
# controllable filesystem type (the drill refuses a non-tmpfs drill root).
write_fake_df() {
  cat > "$FAKEBIN/df" <<'EOF'
#!/usr/bin/env bash
want_type=false
for a in "$@"; do case "$a" in -*T*) want_type=true ;; esac; done
if [[ "$want_type" == true ]]; then
  echo "Filesystem Type 1024-blocks Used Available Capacity Mounted on"
  echo "/dev/fake ${FAKE_FSTYPE:-tmpfs} 76000000 7600000 65000000 11% /dev/shm"
else
  echo "Filesystem 1M-blocks Used Available Use% Mounted on"
  echo "/dev/fake 76000 7600 ${FAKE_FREE_MB:-65000} 11% /"
fi
EOF
  chmod +x "$FAKEBIN/df"
}

# ss fake: the drill treats `ss` as a hard requirement because it is the only
# thing that can prove the drill port is free before a restore and closed again
# after teardown. FAKE_LISTEN_PORT simulates a collision.
write_fake_ss() {
  cat > "$FAKEBIN/ss" <<'EOF'
#!/usr/bin/env bash
echo "State  Recv-Q Send-Q Local-Address:Port Peer-Address:Port"
if [[ -n "${FAKE_LISTEN_PORT:-}" ]]; then
  echo "LISTEN 0      128    127.0.0.1:${FAKE_LISTEN_PORT} 0.0.0.0:*"
fi
EOF
  chmod +x "$FAKEBIN/ss"
}

# pg_ctl fake: records every invocation and fails to start by default, so the
# precondition tests below can assert exactly how far the drill got.
write_fake_pg_ctl() {
  cat > "$FAKEBIN/pg_ctl" <<EOF
#!/usr/bin/env bash
echo "pg_ctl \$*" >> "${WORK}/pgctl.log"
exit "\${FAKE_PGCTL_RC:-1}"
EOF
  chmod +x "$FAKEBIN/pg_ctl"
}

# pg_lsclusters fake: silent by default. Present so the production-PGDATA guard
# behaves identically whether or not the CI image happens to ship the real one.
write_fake_pg_lsclusters() {
  cat > "$FAKEBIN/pg_lsclusters" <<'EOF'
#!/usr/bin/env bash
printf '%s' "${FAKE_LSCLUSTERS:-}"
EOF
  chmod +x "$FAKEBIN/pg_lsclusters"
}

write_fake_runuser
write_fake_psql
write_fake_pgbackrest
write_fake_df
write_fake_ss
write_fake_pg_ctl
write_fake_pg_lsclusters

# ════════════════════════════════════════════════════════════════════════
section "Syntax"
for s in "${ALL_SCRIPTS[@]}"; do
  if bash -n "$s"; then pass "$(basename "$s") parses (bash -n)"; else fail "$(basename "$s") has a syntax error"; fi
done

# ════════════════════════════════════════════════════════════════════════
section "Static secret-handling invariants"
for s in "${ALL_SCRIPTS[@]}"; do
  b="$(basename "$s")"

  grep -q 'set -euo pipefail' "$s" \
    && pass "$b uses 'set -euo pipefail'" \
    || fail "$b does not set strict mode"

  # `set -x` would trace every command, including any that carries a secret.
  if grep -qE '^[[:space:]]*set[[:space:]]+(-x|-o[[:space:]]+xtrace)' "$s"; then
    fail "$b enables shell tracing (set -x), which would print secret-bearing commands"
  else
    pass "$b does not enable shell tracing"
  fi

  # PGPASSWORD is visible in `ps` and propagates through su/sudo environments;
  # the established convention is a mode-600 PGPASSFILE instead.
  if grep -q 'PGPASSWORD' "$s"; then
    fail "$b references PGPASSWORD (use a mode-600 PGPASSFILE instead)"
  else
    pass "$b never uses PGPASSWORD"
  fi

  # The repository passphrase must never reach argv, where it would be visible
  # to every user on the host via `ps` and land in shell history.
  if grep -qE '(--repo[0-9]?-cipher-pass|--cipher-pass)' "$s"; then
    fail "$b passes a cipher passphrase on the command line"
  else
    pass "$b never passes a cipher passphrase on the command line"
  fi
done

# ════════════════════════════════════════════════════════════════════════
section "No committed secret material"
if grep -rqE '^[[:space:]]*repo[0-9]?-cipher-pass[[:space:]]*=[[:space:]]*[^<[:space:]]' \
     "$SCRIPT_DIR/../ops/pgbackrest/" 2>/dev/null; then
  fail "a committed pgbackrest template contains a real-looking cipher passphrase"
else
  pass "no committed template contains a cipher passphrase value"
fi

# ════════════════════════════════════════════════════════════════════════
section "Status writer: healthy document"
STATUS_DIR="$(mktemp -d "$WORK/status.XXXXXX")"
CONF="$WORK/pgbackrest.conf"
cat > "$CONF" <<EOF
[global]
repo1-path=/var/lib/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${CANARY}
EOF
chmod 600 "$CONF"

INFO_ONE_BACKUP='[{"name":"noramedi","cipher":"aes-256-cbc","status":{"code":0,"message":"ok"},"backup":[{"label":"20260815-023000F","type":"full","timestamp":{"start":1786000000,"stop":1786000012}}],"archive":[{"id":"16-1","min":"000000010000000000000002","max":"0000000100000000000000A7"}]}]'

EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state1"
  FAKE_ARCHIVE_MODE=on
  FAKE_ARCHIVE_COMMAND="pgbackrest --stanza=noramedi archive-push %p"
  FAKE_ARCHIVER_ROW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')||0|128"
  FAKE_INFO_JSON="$INFO_ONE_BACKUP"
)
run bash "$STATUS" --stdout --no-check
[[ "$CODE" -eq 0 ]] && pass "status writer exits 0 on a healthy host" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *'"schemaVersion": 1'* ]] && pass "emits schemaVersion 1" || fail "missing schemaVersion ($OUT)"
[[ "$(grep -c '"schemaVersion"' <<<"$OUT")" -eq 1 ]] && pass "emits schemaVersion exactly once (the consumer's parse gate)" || fail "schemaVersion is not unique"
[[ "$OUT" == *'"mode": "on"'* ]] && pass "reports archive.mode from PostgreSQL" || fail "archive.mode missing ($OUT)"
[[ "$OUT" == *'"commandOk": true'* ]] && pass "recognises the exact expected archive_command" || fail "commandOk not true ($OUT)"
[[ "$OUT" == *'"statusOk": true'* ]] && pass "maps pgbackrest status.code 0 to statusOk" || fail "statusOk not true ($OUT)"
[[ "$OUT" == *'"lastBackupType": "full"'* ]] && pass "extracts the newest backup type from nested info JSON" || fail "lastBackupType missing ($OUT)"
[[ "$OUT" == *'"walMax": "0000000100000000000000A7"'* ]] && pass "extracts the newest archived WAL segment name" || fail "walMax missing ($OUT)"

# The flat-object requirement is a hard constraint of the consumer's grep-based
# parser: `json_object_body` matches `\{[^{}]*\}` and a nested object simply
# does not match, which the consumer treats as a check failure.
# Collapse whitespace exactly as the consumer does before extracting, so this
# asserts the same thing opscheck's json_object_body will see.
FLAT="$(tr -s '\n\r\t ' ' ' <<<"$OUT")"
archive_body="$(grep -oE '"archive"[[:space:]]*:[[:space:]]*\{[^{}]*\}' <<<"$FLAT" || true)"
repo_body="$(grep -oE '"repo"[[:space:]]*:[[:space:]]*\{[^{}]*\}' <<<"$FLAT" || true)"
[[ -n "$archive_body" ]] && pass "'archive' is a FLAT object (opscheck's parser rejects nesting)" || fail "'archive' is nested or unmatched"
[[ -n "$repo_body" ]] && pass "'repo' is a FLAT object" || fail "'repo' is nested or unmatched"

section "Status writer: a healthy run EMITS the WAL-freshness fields"
# The assertion that was missing. Every other WAL test asserted the field's
# ABSENCE on a failure path, which passes both when the feature works and when
# the field is never emitted at all — precisely the state a quoting bug in the
# pg_stat_archiver query produced. `lastArchivedAgeMinutes` is the input to
# opscheck's only check for "archiving stopped while backups kept succeeding";
# if it is missing, that check fails permanently for a false reason.
[[ "$OUT" == *'"lastArchivedAt"'* ]] \
  && pass "a healthy run emits lastArchivedAt (the pg_stat_archiver query survived delegation intact)" \
  || fail "lastArchivedAt MISSING — the archiver query was mangled or rejected ($OUT)"
[[ "$OUT" == *'"lastArchivedAgeMinutes"'* ]] \
  && pass "a healthy run emits lastArchivedAgeMinutes (the field opscheck's stale-WAL assertion consumes)" \
  || fail "lastArchivedAgeMinutes MISSING — opscheck's stale-WAL check would fail permanently for a false reason ($OUT)"
[[ "$OUT" != *"SQL-QUOTING-CORRUPTED-IN-TRANSIT"* ]] \
  && pass "the archiver SQL reached psql with its quoting intact" \
  || fail "the archiver SQL was CORRUPTED IN TRANSIT — a parse layer is eating quotes ($OUT)"
[[ "$OUT" == *'"failedCount": 0'* ]] \
  && pass "archiver failure count is parsed from the query result" \
  || fail "failedCount not parsed ($OUT)"

section "Status writer: the WAL BACKLOG signals (F4-FCR-003-R1)"
# This section re-runs the writer, so the healthy run's output is preserved and
# restored: the sections below still mean what their labels say.
HEALTHY_OUT="$OUT"
# Gate 0 established that an unreachable repo2 stops the WHOLE archive chain
# and makes PostgreSQL retain every segment, so the failure lands as disk
# growth. Every other field here measures time or a rate; these two measure
# volume, and without them repo2 cannot be activated with a monitor that can
# see the failure coming.
[[ "$OUT" == *'"walBytes": 268435456'* ]] \
  && pass "a healthy run emits archive.walBytes (total bytes in pg_wal)" \
  || fail "walBytes MISSING — WAL backlog cannot be observed ($OUT)"
[[ "$OUT" == *'"readyCount": 3'* ]] \
  && pass "a healthy run emits archive.readyCount (segments waiting to be archived)" \
  || fail "readyCount MISSING — the .ready backlog cannot be observed ($OUT)"

# The measurement must come from pg_catalog functions that resolve against the
# data directory PostgreSQL is ACTUALLY running on. A hardcoded
# /var/lib/postgresql/<major>/main would silently measure the wrong cluster —
# or nothing — on any host whose PGDATA moved, and would report an empty
# backlog while pg_wal filled.
grep -q 'pg_ls_waldir()' "$STATUS" \
  && pass "pg_wal size is read via pg_ls_waldir(), not from a hardcoded PGDATA path" \
  || fail "no pg_ls_waldir() in the status writer"
grep -q "pg_ls_dir('pg_wal/archive_status')" "$STATUS" \
  && pass "the .ready backlog is read via pg_ls_dir('pg_wal/archive_status'), relative to the live data directory" \
  || fail "no archive_status listing in the status writer"
grep -qE '(du|ls)[^|]*-[^|]*/pg_wal' "$STATUS" \
  && fail "the writer shells out to the filesystem for pg_wal instead of asking PostgreSQL" \
  || pass "no filesystem walk of pg_wal — nothing can read a WAL segment's contents through this path"

# UNMEASURABLE MUST MEAN ABSENT, NOT ZERO. A 0 would read as "no backlog"
# during exactly the outage these fields exist to detect, and opscheck would
# report green. The consumer fails closed on absence; it cannot fail closed on
# a confident, wrong 0.
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state-walbacklog"
  FAKE_ARCHIVE_MODE=on
  FAKE_ARCHIVE_COMMAND="pgbackrest --stanza=noramedi archive-push %p"
  FAKE_ARCHIVER_ROW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')||0|128"
  FAKE_INFO_JSON="$INFO_ONE_BACKUP"
  FAKE_WAL_BACKLOG_ROW=""
)
run bash "$STATUS" --stdout --no-check
[[ "$CODE" -eq 0 ]] && pass "an unmeasurable WAL backlog does not fail the writer (collection is not judgement)" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" != *'"walBytes"'* ]] \
  && pass "an unmeasurable pg_wal size is OMITTED, not reported as 0" \
  || fail "walBytes was emitted despite no measurement ($OUT)"
[[ "$OUT" != *'"readyCount"'* ]] \
  && pass "an unmeasurable .ready count is OMITTED, not reported as 0" \
  || fail "readyCount was emitted despite no measurement ($OUT)"
[[ "$OUT" == *'"mode": "on"'* ]] \
  && pass "the rest of the document is unaffected by an unmeasurable backlog" \
  || fail "an unmeasurable backlog damaged the rest of the document ($OUT)"

# A non-numeric answer must be refused rather than coerced.
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state-walgarbage"
  FAKE_ARCHIVE_MODE=on
  FAKE_ARCHIVE_COMMAND="pgbackrest --stanza=noramedi archive-push %p"
  FAKE_ARCHIVER_ROW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')||0|128"
  FAKE_INFO_JSON="$INFO_ONE_BACKUP"
  FAKE_WAL_BACKLOG_ROW="ERROR:  permission denied for function pg_ls_waldir"
)
run bash "$STATUS" --stdout --no-check
[[ "$OUT" != *'"walBytes"'* ]] && [[ "$OUT" != *'"readyCount"'* ]] \
  && pass "an error string from psql is not coerced into a backlog figure" \
  || fail "a psql error was parsed as a backlog measurement ($OUT)"
[[ "$OUT" != *"permission denied"* ]] \
  && pass "the raw psql error is not copied into the published document" \
  || fail "a raw psql error string leaked into the document ($OUT)"
OUT="$HEALTHY_OUT"

section "Status writer: the canary never appears"
[[ "$OUT" != *"$CANARY"* ]] && pass "the repository passphrase never reaches stdout/stderr on the healthy path" || fail "CANARY LEAKED on the healthy path"

# Force every failure branch and re-check.
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state2"
  FAKE_ARCHIVE_MODE=on
  FAKE_INFO_JSON='not json at all'
  FAKE_INFO_RC=1
  FAKE_CHECK_RC=1
)
run bash "$STATUS" --stdout
[[ "$OUT" != *"$CANARY"* ]] && pass "the passphrase never appears when pgbackrest info is unparseable and check fails" || fail "CANARY LEAKED on the failure path"

EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$WORK/does-not-exist.conf" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state3")
run bash "$STATUS" --stdout --no-check
[[ "$OUT" != *"$CANARY"* ]] && pass "the passphrase never appears when the config file is missing" || fail "CANARY LEAKED on the missing-config path"

section "Status writer: unparseable pgbackrest info fails closed"
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state4"
  FAKE_ARCHIVE_MODE=on
  FAKE_INFO_JSON='}{ broken'
)
run bash "$STATUS" --stdout --no-check
[[ "$OUT" == *'"statusOk": false'* ]] && pass "unparseable info JSON yields statusOk=false, never an optimistic default" || fail "expected statusOk false ($OUT)"

section "Status writer: a tampered archive_command is not commandOk"
for bad in "pgbackrest --stanza=noramedi archive-push %p || true" \
           "pgbackrest --stanza=other archive-push %p" \
           "/bin/true"; do
  EXTRA_ENV=(
    NORAMEDI_PGBACKREST_CONF="$CONF"
    NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state5"
    FAKE_ARCHIVE_MODE=on
    FAKE_ARCHIVE_COMMAND="$bad"
    FAKE_INFO_JSON="$INFO_ONE_BACKUP"
  )
  run bash "$STATUS" --stdout --no-check
  [[ "$OUT" == *'"commandOk": false'* ]] \
    && pass "commandOk=false for a tampered archive_command: ${bad:0:42}" \
    || fail "expected commandOk false for '$bad' ($OUT)"
done

section "Status writer: future timestamps fail closed (no negative ages)"
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/state6"
  FAKE_ARCHIVE_MODE=on
  FAKE_ARCHIVER_ROW="$(date -u -d '+3 hours' '+%Y-%m-%dT%H:%M:%SZ')||0|5"
  FAKE_INFO_JSON="$INFO_ONE_BACKUP"
)
run bash "$STATUS" --stdout --no-check
[[ "$OUT" != *'"lastArchivedAgeMinutes"'* ]] \
  && pass "a future-dated last_archived_time omits the age rather than reporting a negative (which would read as brand new)" \
  || fail "a future timestamp produced an age field ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "Status writer: off-host is never claimed from configuration alone"

offhost_of() { grep -o '"offHost": "[a-z]*"' <<<"$1" | head -n1 | sed 's/.*: "//;s/"//'; }

# 1. No repo2 at all.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s7" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && pass "no repo2 configured -> offHost='no'" || fail "expected no ($OUT)"

# 2. repo2 as a local PATH. This is the single most likely way someone
#    accidentally believes R-030 is closed: a second directory is not a second
#    failure domain, however different the disk.
CONF2="$WORK/pgbackrest-path.conf"
cp "$CONF" "$CONF2"; printf 'repo2-path=/mnt/other-disk/pgbackrest\nrepo2-cipher-type=aes-256-cbc\n' >> "$CONF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF2" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s8" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && pass "repo2 as a local path -> offHost='no' (a second directory is not a second failure domain)" || fail "expected no for a local repo2 path ($OUT)"
[[ "$OUT" == *"REPO2_IS_A_LOCAL_PATH"* ]] && pass "records the explicit reason REPO2_IS_A_LOCAL_PATH" || fail "missing reason ($OUT)"

# 3. repo2 host pointing at THIS machine.
CONF3="$WORK/pgbackrest-self.conf"
cp "$CONF" "$CONF3"; printf 'repo2-host=%s\nrepo2-cipher-type=aes-256-cbc\n' "$(hostname)" >> "$CONF3"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF3" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s9" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && pass "repo2-host equal to this hostname -> offHost='no'" || fail "expected no for a self-referencing repo2 host ($OUT)"

# 4. Loopback S3 endpoint — this machine wearing an S3 costume.
CONF4="$WORK/pgbackrest-loopback.conf"
cp "$CONF" "$CONF4"; printf 'repo2-type=s3\nrepo2-s3-endpoint=http://127.0.0.1:9000\nrepo2-cipher-type=aes-256-cbc\n' >> "$CONF4"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF4" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s10" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && pass "a loopback S3 endpoint -> offHost='no' ('s3' is not evidence of off-host)" || fail "expected no for a loopback endpoint ($OUT)"

# 5. Genuinely remote repo2, but no restore has ever been done from it.
CONF5="$WORK/pgbackrest-remote.conf"
cp "$CONF" "$CONF5"; printf 'repo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' >> "$CONF5"
PROOF="$WORK/proof.json"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s11" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a remote, encrypted repo2 with no restore proof -> offHost='unproven', NOT 'yes'" || fail "expected unproven ($OUT)"

# 6. Remote repo2 but PLAINTEXT. Independence without confidentiality is not
#    readiness: the repo holds cleartext special-category health data.
CONF6="$WORK/pgbackrest-remote-plain.conf"
cp "$CONF" "$CONF6"; printf 'repo2-host=backup.example.tr\nrepo2-cipher-type=none\n' >> "$CONF6"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF6" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s12" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && pass "a remote but UNENCRYPTED repo2 -> offHost='no' (REPO2_PLAINTEXT)" || fail "expected no for a plaintext repo2 ($OUT)"

# 7. With a fresh, valid restore proof from repo2 -> yes.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s13" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "yes" ]] && pass "a fresh restore proof from repo2 upgrades offHost to 'yes'" || fail "expected yes with a valid proof ($OUT)"

# 8. A proof from repo1 must NOT count — the local repo is not independent.
printf '{"schemaVersion":1,"result":"passed","repo":1,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s14" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a restore proof from repo1 does NOT prove off-host recoverability" || fail "expected unproven for a repo1 proof ($OUT)"

# 9. A stale proof must not keep claiming success forever.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u -d '-100 days' '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s15" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a 100-day-old restore proof expires back to 'unproven'" || fail "expected unproven for a stale proof ($OUT)"

# 10. A FAILED drill must never count as proof.
printf '{"schemaVersion":1,"result":"failed","repo":2,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s16" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a FAILED restore drill is not proof" || fail "expected unproven for a failed drill ($OUT)"

# 11. A proof earned against a DIFFERENT repo2 target must not be inherited.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"some-other-host.example","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s17" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] \
  && pass "a proof earned against a DIFFERENT repo2 target is not inherited when repo2 is repointed" \
  || fail "expected unproven for a target-mismatched proof ($OUT)"

# 12. A legacy proof with no target binding at all must also be refused.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] \
  && pass "a proof with no target binding is refused (fails toward unproven, never toward yes)" \
  || fail "expected unproven for an unbound proof ($OUT)"

# 12b. The SFTP shape of SELECTED TOPOLOGY = C. It carries repo2-path (which is
#      meaningful only on the REMOTE endpoint) and NO repo2-host, so before
#      F4-FCR-004 the classifier fell through to the repo2-path branch and
#      reported a Turkiye VPS as REPO2_IS_A_LOCAL_PATH -- offHost could never
#      reach 'yes' on the transport the program selected as procurement-ready.
CONF_SFTP="$WORK/pgbackrest-sftp.conf"
cp "$CONF" "$CONF_SFTP"
printf 'repo2-type=sftp\nrepo2-path=/var/lib/pgbackrest\nrepo2-sftp-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' >> "$CONF_SFTP"
PROOF_SFTP="$WORK/proof-sftp.json"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SFTP" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18b" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF_SFTP" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] \
  && pass "an SFTP repo2 with a remote sftp-host -> offHost='unproven' (not 'no'), so a drill can still earn it" \
  || fail "expected unproven for a remote SFTP repo2 ($OUT)"
[[ "$OUT" != *"REPO2_IS_A_LOCAL_PATH"* ]] \
  && pass "an SFTP repo2 is NOT misclassified as REPO2_IS_A_LOCAL_PATH" \
  || fail "SFTP repo2 still classified as a local path ($OUT)"

# 12c. The drill's PROOF_TARGET and the status writer's CURRENT_TARGET must
#      derive the SAME key for SFTP. If the drill recorded repo2-path instead,
#      the proof would say /var/lib/pgbackrest -- identical on every SFTP
#      endpoint -- and repointing repo2 would inherit the old host's proof.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF_SFTP"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SFTP" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18c" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF_SFTP" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "yes" ]] \
  && pass "an SFTP proof bound to repo2-sftp-host is accepted (drill and status writer agree on the target key)" \
  || fail "expected yes for an sftp-host-bound proof ($OUT)"
grep -q '_pt_sftp' "$DRILL" \
  && pass "the restore drill derives PROOF_TARGET from repoN-sftp-host too" \
  || fail "the restore drill has no sftp-host in its PROOF_TARGET precedence"

# 12d. A proof bound to the SFTP repo2-path must NOT be accepted -- that is the
#      exact inheritance the target binding exists to prevent.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"/var/lib/pgbackrest","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF_SFTP"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SFTP" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18d" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF_SFTP" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] \
  && pass "an SFTP proof bound to the repo2-path is refused (a path is identical on every endpoint)" \
  || fail "expected unproven for a path-bound SFTP proof ($OUT)"

# 12e. An SFTP repo2 whose sftp-host is THIS machine is not a failure domain.
CONF_SFTP_SELF="$WORK/pgbackrest-sftp-self.conf"
cp "$CONF" "$CONF_SFTP_SELF"
printf 'repo2-type=sftp\nrepo2-path=/var/lib/pgbackrest\nrepo2-sftp-host=%s\nrepo2-cipher-type=aes-256-cbc\n' "$(hostname)" >> "$CONF_SFTP_SELF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SFTP_SELF" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18e" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && [[ "$OUT" == *"REPO2_IS_THIS_HOST"* ]] \
  && pass "an SFTP repo2 pointing at this host -> offHost='no' (REPO2_IS_THIS_HOST)" \
  || fail "expected no/REPO2_IS_THIS_HOST for a self-referencing sftp-host ($OUT)"

# 12f. A remote SFTP repo2 that is PLAINTEXT is still refused.
CONF_SFTP_PLAIN="$WORK/pgbackrest-sftp-plain.conf"
cp "$CONF" "$CONF_SFTP_PLAIN"
printf 'repo2-type=sftp\nrepo2-path=/var/lib/pgbackrest\nrepo2-sftp-host=backup.example.tr\nrepo2-cipher-type=none\n' >> "$CONF_SFTP_PLAIN"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SFTP_PLAIN" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s18f" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "no" ]] && [[ "$OUT" == *"REPO2_PLAINTEXT"* ]] \
  && pass "a remote but UNENCRYPTED SFTP repo2 -> offHost='no' (REPO2_PLAINTEXT)" \
  || fail "expected no/REPO2_PLAINTEXT for a plaintext SFTP repo2 ($OUT)"

# 13. Refusal reasons are DISTINCT. A target mismatch is neither stale nor
#     future-dated, and reporting it as one sent the operator after proof
#     ageing while the real cause was that the drill and this writer derived
#     the repo2 target differently. Every refusal still yields "unproven".
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"some-other-host.example","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s19" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$OUT" == *"RESTORE_PROOF_TARGET_MISMATCH"* ]] \
  && pass "a target-mismatched proof reports RESTORE_PROOF_TARGET_MISMATCH, not a staleness reason" \
  || fail "target mismatch is still reported as staleness ($OUT)"

printf '{"schemaVersion":1,"result":"passed","repo":1,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s20" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$OUT" == *"RESTORE_PROOF_NOT_FROM_REPO2"* ]] && [[ "$(offhost_of "$OUT")" == "unproven" ]] \
  && pass "a proof from repo1 reports RESTORE_PROOF_NOT_FROM_REPO2 and stays unproven" \
  || fail "expected a repo1-sourced proof to be named as such ($OUT)"

# 14. THE DRILL/STATUS HANDOFF. Tests 10-12 hand-write the proof, so they
#     validate this writer's comparison and never the drill's extraction —
#     which is precisely where the two disagreed. An SSH repo2 legitimately
#     carries BOTH repo2-host and repo2-path, and pgBackRest attaches no
#     meaning to their order; the drill took the first key in FILE ORDER while
#     this writer applies host -> s3-endpoint -> path. Writing them in the
#     other order therefore made a PASSING off-host drill produce a proof this
#     writer discarded, leaving offHost stuck at "unproven" with no diagnostic.
CONF_ORDER="$WORK/pgbackrest-key-order.conf"
cp "$CONF" "$CONF_ORDER"
printf 'repo2-path=/var/lib/pgbackrest\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' >> "$CONF_ORDER"

# The contract the drill must satisfy: the HOST wins regardless of key order.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"backup.example.tr","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_ORDER" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s21" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "yes" ]] \
  && pass "with repo2-path listed BEFORE repo2-host, the host is still the bound target" \
  || fail "key order changed the target this writer derives ($OUT)"

# And the value the OLD drill would have recorded (the path, first in file
# order) must be refused — otherwise the two could disagree undetected.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","target":"/var/lib/pgbackrest","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_ORDER" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s22" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$OUT" == *"RESTORE_PROOF_TARGET_MISMATCH"* ]] \
  && pass "the first-key-in-file-order value the old drill recorded is refused and named" \
  || fail "a path-derived proof was accepted against a host-derived target ($OUT)"

# Static guard: the drill must derive its proof target the same way. A
# behavioural test cannot reach that code without a live cluster, so the
# regression is pinned at the source. Both halves matter — per-key lookup
# (not one alternation) and keyed on the repo actually restored from.
grep -q "repo\${REPO_NUM}-host" "$DRILL" \
  && pass "the drill derives its proof target per-key, keyed on the repo it restored from" \
  || fail "the drill no longer keys its proof target on REPO_NUM — the repo3-earns-repo2-proof false green is back"
grep -qE "repo2-\(host\|s3-endpoint\|path\)" "$DRILL" \
  && fail "the drill has reverted to a single first-match-in-file-order alternation for the proof target" \
  || pass "the drill does not take whichever repo2 key appears first in file order"

# ════════════════════════════════════════════════════════════════════════
section "Status writer: repo2 backup freshness is reported SEPARATELY from repo1"
# `pgbackrest info` returns every repository in one flat backup[]. Reporting a
# single aggregate age was correct while repo1 was the only repository and
# becomes a FALSE GREEN once repo2 exists: repo1 keeps backing up nightly, the
# aggregate stays young, and a repo2 that receives nothing still reads as
# healthy. The proof marker behind offHost="yes" lasts 30 days, so that state
# could persist for a month. These fields exist to make it visible.
num_of() { grep -o "\"$2\": [0-9-]*" <<<"$1" | head -n1 | sed 's/.*: //'; }

_NOW_EPOCH="$(date -u +%s)"
_FRESH=$(( _NOW_EPOCH - 600 ))          # 10 minutes ago
_STALE=$(( _NOW_EPOCH - 10 * 86400 ))   # 10 days ago

# repo1 fresh, repo2 ten days stale — the exact shape of the false green.
INFO_MULTIREPO="$(printf '[{"name":"noramedi","cipher":"aes-256-cbc","status":{"code":0,"message":"ok"},"backup":[{"label":"20260815-023000F","type":"full","database":{"id":1,"repo-key":1},"timestamp":{"start":%d,"stop":%d}},{"label":"20260805-023000F","type":"full","database":{"id":1,"repo-key":2},"timestamp":{"start":%d,"stop":%d}}],"archive":[{"id":"16-1","min":"000000010000000000000002","max":"0000000100000000000000A7"}]}]' \
  "$_FRESH" "$_FRESH" "$_STALE" "$_STALE")"

EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s20" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_MULTIREPO")
run bash "$STATUS" --stdout --no-check
[[ "$(num_of "$OUT" backupCount)" == "1" ]] \
  && pass "backupCount counts repo1 ONLY (it no longer blends repositories)" \
  || fail "expected repo1 backupCount=1, got '$(num_of "$OUT" backupCount)' ($OUT)"
[[ "$(num_of "$OUT" repo2BackupCount)" == "1" ]] \
  && pass "repo2BackupCount is reported separately" \
  || fail "expected repo2BackupCount=1, got '$(num_of "$OUT" repo2BackupCount)' ($OUT)"
_R2AGE="$(num_of "$OUT" repo2LastBackupAgeMinutes)"
[[ "$_R2AGE" =~ ^[0-9]+$ ]] && [[ "$_R2AGE" -gt 10000 ]] \
  && pass "repo2LastBackupAgeMinutes reports the STALE off-host age (${_R2AGE}m), not the fresh repo1 one" \
  || fail "expected a large repo2 age, got '$_R2AGE' ($OUT)"
_R1AGE="$(num_of "$OUT" lastBackupAgeMinutes)"
[[ "$_R1AGE" =~ ^[0-9]+$ ]] && [[ "$_R1AGE" -lt 60 ]] \
  && pass "lastBackupAgeMinutes still reports repo1 as fresh (${_R1AGE}m) — the two ages are independent" \
  || fail "expected a small repo1 age, got '$_R1AGE' ($OUT)"

# Configured but EMPTY: a repo2 that exists, receives WAL, and has never had a
# base backup cannot restore. It must be distinguishable from "no repo2".
INFO_REPO2_EMPTY="$(printf '[{"name":"noramedi","cipher":"aes-256-cbc","status":{"code":0,"message":"ok"},"backup":[{"label":"20260815-023000F","type":"full","database":{"id":1,"repo-key":1},"timestamp":{"start":%d,"stop":%d}}],"archive":[{"id":"16-1","min":"000000010000000000000002","max":"0000000100000000000000A7"}]}]' \
  "$_FRESH" "$_FRESH")"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s21" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_REPO2_EMPTY")
run bash "$STATUS" --stdout --no-check
[[ "$(num_of "$OUT" repo2BackupCount)" == "0" ]] \
  && pass "a configured repo2 holding zero backups reports repo2BackupCount=0 (it archives WAL and cannot restore)" \
  || fail "expected repo2BackupCount=0, got '$(num_of "$OUT" repo2BackupCount)' ($OUT)"

# Back-compat 1: no repo2 configured -> the repo2 fields are absent entirely,
# so a single-repo host publishes exactly the document it published before.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s22" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$OUT" != *"repo2BackupCount"* ]] \
  && pass "no repo2 configured -> no repo2 fields emitted (unchanged document for a single-repo host)" \
  || fail "repo2 fields leaked into a single-repo document ($OUT)"
[[ "$(num_of "$OUT" backupCount)" == "1" ]] \
  && pass "the single-repo backupCount is unchanged" \
  || fail "expected backupCount=1, got '$(num_of "$OUT" backupCount)' ($OUT)"

# Back-compat 2: entries with NO repo-key at all (single-repo or older
# pgBackRest builds) must all count as repo1 rather than vanishing.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s23" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(num_of "$OUT" backupCount)" == "1" ]] \
  && pass "backup entries carrying no repo-key are attributed to repo1, not dropped" \
  || fail "expected backupCount=1 for untagged entries, got '$(num_of "$OUT" backupCount)' ($OUT)"

section "Status writer: emitted objects are verified flat before publishing"
# The writer checks its OWN output against the consumer's flat-object rule
# rather than merely asserting flatness in a comment. A brace arriving inside
# a pgBackRest error message would otherwise break the consumer's extraction.
EXTRA_ENV=(
  NORAMEDI_PGBACKREST_CONF="$CONF"
  NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s19"
  FAKE_ARCHIVE_MODE=on
  FAKE_INFO_JSON='[{"name":"noramedi","status":{"code":3,"message":"repo path {broken} unreachable"},"backup":[],"archive":[]}]'
)
run bash "$STATUS" --stdout --no-check
[[ "$CODE" -eq 0 ]] && pass "a brace inside a pgbackrest error message does not break publishing" || fail "expected exit 0, got $CODE ($OUT)"
FLAT_OUT="$(tr -s '\n\r\t ' ' ' <<<"$OUT")"
grep -qE '"repo"[[:space:]]*:[[:space:]]*\{[^{}]*\}' <<<"$FLAT_OUT" \
  && pass "the repo object stays flat even when the upstream message contained braces" \
  || fail "a brace leaked into repo and broke flatness ($OUT)"

section "Status writer: malformed tuning values fail closed"
for bad in NORAMEDI_PGBACKREST_CHECK_MIN_INTERVAL_SECONDS NORAMEDI_PGBACKREST_CMD_TIMEOUT NORAMEDI_PGBACKREST_OFFHOST_PROOF_MAX_AGE_HOURS; do
  EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" "$bad=abc")
  run bash "$STATUS" --stdout --no-check
  [[ "$CODE" -eq 2 ]] && pass "$bad=abc exits 2 (fail closed)" || fail "expected exit 2 for $bad=abc, got $CODE"
done
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF")
run bash "$STATUS" --stanza "Bad Stanza!" --stdout
[[ "$CODE" -eq 2 ]] && pass "an invalid stanza name exits 2 (it is interpolated into archive_command)" || fail "expected exit 2, got $CODE"

section "Status writer: refuses to create its own output directory"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s17")
run bash "$STATUS" --out "$WORK/no-such-dir/pitr-status.json" --no-check
[[ "$CODE" -eq 1 ]] && pass "a missing output directory is an error, not silently created (a self-creating writer hides a misconfigured path)" || fail "expected exit 1, got $CODE ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "Backup wrapper: stanza must exist before anything else"
# `stanza-create` builds archive/<stanza> and backup/<stanza>. The wrapper
# checks for those DIRECTORIES rather than trusting `pgbackrest info`'s exit
# status, because info is informational and exits 0 for a stanza that does not
# exist — reporting the absence only in its JSON body.
mkdir -p "$WORK/repo"
EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_FREE_MB=65000)
run bash "$BACKUP" --dry-run
[[ "$CODE" -eq 3 ]] && pass "a repo with no stanza directories is a precondition failure (exit 3), not a silent success" || fail "expected exit 3, got $CODE ($OUT)"

# Everything below needs a stanza that actually exists.
mkdir -p "$WORK/repo/archive/noramedi" "$WORK/repo/backup/noramedi"

section "Backup wrapper: disk-exhaustion abort"
# Required explicitly by the drafted freeze exception. An alert notifies
# someone after the fact; an abort refuses to make it worse.
EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=10240 FAKE_FREE_MB=500)
run bash "$BACKUP" --dry-run
[[ "$CODE" -eq 4 ]] && pass "aborts with the dedicated code 4 when free space is under the floor" || fail "expected exit 4, got $CODE ($OUT)"
[[ "$OUT" == *"NOT invoked"* ]] && pass "states explicitly that pgBackRest was not invoked" || fail "missing the not-invoked statement ($OUT)"

EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=1000 FAKE_FREE_MB=65000)
run bash "$BACKUP" --dry-run
[[ "$CODE" -eq 0 ]] && pass "proceeds when free space clears the floor" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"DRY-RUN"* ]] && pass "--dry-run prints the intended command and invokes nothing" || fail "missing DRY-RUN output ($OUT)"

section "Backup wrapper: unreadable free space fails closed"
cat > "$FAKEBIN/df" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$FAKEBIN/df"
EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo")
run bash "$BACKUP" --dry-run
[[ "$CODE" -eq 4 ]] && pass "'could not measure the disk' aborts rather than assuming it is fine" || fail "expected exit 4, got $CODE ($OUT)"
write_fake_df

section "Backup wrapper: argument validation"
EXTRA_ENV=(); run bash "$BACKUP" --type bogus
[[ "$CODE" -eq 2 ]] && pass "an invalid --type exits 2" || fail "expected exit 2, got $CODE"
EXTRA_ENV=(); run bash "$BACKUP" --stanza "../../etc"
[[ "$CODE" -eq 2 ]] && pass "a path-traversal stanza name exits 2" || fail "expected exit 2, got $CODE"
EXTRA_ENV=(); run bash "$BACKUP" --repo 9
[[ "$CODE" -eq 2 ]] && pass "an out-of-range --repo exits 2 (a typo must never silently fall back to the LOCAL repo1)" || fail "expected exit 2, got $CODE"
EXTRA_ENV=(); run bash "$BACKUP" --repo two
[[ "$CODE" -eq 2 ]] && pass "a non-numeric --repo exits 2" || fail "expected exit 2, got $CODE"

# ════════════════════════════════════════════════════════════════════════
section "Backup wrapper: --repo targets a specific repository"
# Without this, `pgbackrest backup` always writes to the default repository,
# so an off-host repo2 would receive WAL via archive-push and never a base
# backup — a repository that looks alive and cannot restore. R-030 / §16.

# repo1 must be byte-for-byte the previous behaviour: NO --repo is passed, so
# a build predating multi-repo support (< 2.33) is unaffected by default.
EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=1000 FAKE_FREE_MB=65000)
run bash "$BACKUP" --dry-run
[[ "$CODE" -eq 0 ]] && [[ "$OUT" != *"--repo="* ]] \
  && pass "the default run passes NO --repo (no new pgBackRest version dependency for repo1)" \
  || fail "expected exit 0 and no --repo= in the command ($OUT)"

EXTRA_ENV=(NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=1000 FAKE_FREE_MB=65000)
run bash "$BACKUP" --repo 1 --dry-run
[[ "$CODE" -eq 0 ]] && [[ "$OUT" != *"--repo="* ]] \
  && pass "an explicit --repo 1 is also emitted without --repo= (identical to the default path)" \
  || fail "expected exit 0 and no --repo= ($OUT)"

# A repo2 that is not configured at all must fail closed. Falling through to
# pgBackRest's default repository would take a LOCAL backup while the operator
# believed an off-host one had been taken — the exact false claim R-030 is about.
CONF_NOREPO2="$WORK/pgbackrest-norepo2.conf"
printf '[global]\nrepo1-path=%s\nrepo1-cipher-type=aes-256-cbc\n' "$WORK/repo" > "$CONF_NOREPO2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_NOREPO2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_FREE_MB=65000)
run bash "$BACKUP" --repo 2 --dry-run
[[ "$CODE" -eq 3 ]] && pass "--repo 2 with no repo2 in the config is a precondition failure, not a silent repo1 backup" || fail "expected exit 3, got $CODE ($OUT)"

# A REMOTE repo2 must skip the local filesystem preconditions. Proven by
# making both of them impossible to satisfy: the local repo path does not
# exist and free space is far under the floor. A run that still succeeds can
# only have skipped them.
CONF_REMOTE2="$WORK/pgbackrest-remote2.conf"
printf '[global]\nrepo1-path=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' "$WORK/repo" > "$CONF_REMOTE2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_REMOTE2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/no-such-repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=999999 FAKE_FREE_MB=10)
run bash "$BACKUP" --repo 2 --dry-run
[[ "$CODE" -eq 0 ]] && pass "a remote repo2 skips the local stanza-directory and free-space checks (they measure this host, not the target)" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"--repo=2"* ]] && pass "the pgBackRest command carries --repo=2" || fail "missing --repo=2 ($OUT)"
[[ "$OUT" == *"expire"* ]] && [[ "$OUT" == *"--repo=2 expire"* ]] \
  && pass "expire also carries --repo=2 (retention must be applied to the repository actually written)" \
  || fail "expire missing --repo=2 — retention would be enforced on the wrong repository ($OUT)"

# An S3 repo2 is remote by the same rule, via repo2-type rather than a host.
CONF_S32="$WORK/pgbackrest-s32.conf"
printf '[global]\nrepo1-path=%s\nrepo2-type=s3\nrepo2-s3-bucket=b\nrepo2-cipher-type=aes-256-cbc\n' "$WORK/repo" > "$CONF_S32"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_S32" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/no-such-repo" NORAMEDI_PGBACKREST_MIN_FREE_MB=999999 FAKE_FREE_MB=10)
run bash "$BACKUP" --repo 2 --dry-run
[[ "$CODE" -eq 0 ]] && [[ "$OUT" == *"--repo=2"* ]] && pass "an S3 repo2 is treated as remote via repo2-type" || fail "expected exit 0 with --repo=2, got $CODE ($OUT)"

# A repo2 that is a LOCAL PATH still gets the disk abort. It is not off-host,
# but it does consume this filesystem, which is what the abort protects.
CONF_LOCAL2="$WORK/pgbackrest-local2.conf"
printf '[global]\nrepo1-path=%s\nrepo2-path=%s\nrepo2-cipher-type=aes-256-cbc\n' "$WORK/repo" "$WORK/repo" > "$CONF_LOCAL2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_LOCAL2" NORAMEDI_PGBACKREST_MIN_FREE_MB=999999 FAKE_FREE_MB=500)
run bash "$BACKUP" --repo 2 --dry-run
[[ "$CODE" -eq 4 ]] && pass "a local-path repo2 still triggers the disk-exhaustion abort (it shares this filesystem)" || fail "expected exit 4, got $CODE ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "repo2 topology: ERROR [072] must surface, not be masked (F4-FCR-003-R2)"

# Production runs pgBackRest 2.50, where `backup --repo=2` is REFUSED on the
# PostgreSQL host when repo2-host is set:
#   ERROR: [072]: backup command must be run on the repository host
# The runbook now publishes the no-repo-host shape (§22.4b) precisely so this
# cannot happen. But if a repo2-host ever creeps back into the config, the
# operator must SEE the refusal. The wrapper must not swallow it, must not
# report success, and must not silently fall back to repo1.
CONF_072="$WORK/pgbackrest-072.conf"
printf '[global]\nrepo1-path=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' \
  "$WORK/repo" > "$CONF_072"
ERR_072='ERROR: [072]: backup command must be run on the repository host'

# These assertions need the REAL invocation path, not --dry-run, because the
# behaviour under test is what the wrapper does with pgBackRest's exit status.
# That path requires root in order to delegate to the postgres OS user, so `id`
# is faked for this section only and removed immediately afterwards — a global
# fake would silently disable the root check in every later test.
cat > "$FAKEBIN/id" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "-u" ]] && { echo 0; exit 0; }
exec /usr/bin/id "$@"
EOF
chmod +x "$FAKEBIN/id"

# The wrapper also refuses to run without an overlap guard, and flock is absent
# on Git Bash. Faking it keeps this section deterministic on both platforms;
# the overlap guard has its own coverage and is not what these assertions test.
# Removed together with `id` at the end of the section.
cat > "$FAKEBIN/flock" <<'FLOCKEOF'
#!/usr/bin/env bash
exit 0
FLOCKEOF
chmod +x "$FAKEBIN/flock"
mkdir -p "$WORK/lockdir"
LOCK_072="$WORK/lockdir/pgbackrest.lock"

EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_072" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" \
           NORAMEDI_PGBACKREST_LOCK_FILE="$LOCK_072" \
           FAKE_FREE_MB=65000 FAKE_BACKUP_RC=72 FAKE_BACKUP_STDERR="$ERR_072")
run bash "$BACKUP" --repo 2 --type full
[[ "$CODE" -eq 1 ]] \
  && pass "a repo2 backup refused with ERROR [072] exits non-zero (the refusal is not swallowed)" \
  || fail "expected exit 1 on a 072 refusal, got $CODE ($OUT)"
[[ "$OUT" == *"072"* ]] \
  && pass "the ERROR [072] text reaches the operator's output verbatim" \
  || fail "the 072 refusal was masked — an operator would not learn why repo2 failed ($OUT)"
[[ "$OUT" != *"completed in"* ]] \
  && pass "a refused repo2 backup is never reported as completed" \
  || fail "a refused backup reported completion ($OUT)"

# NON-VACUOUS CONTROL. The same config and the same wrapper, with the refusal
# removed, must succeed — otherwise the three assertions above would also pass
# on a wrapper that simply always fails, and would prove nothing.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_072" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" \
           NORAMEDI_PGBACKREST_LOCK_FILE="$LOCK_072" \
           FAKE_FREE_MB=65000 FAKE_BACKUP_RC=0)
run bash "$BACKUP" --repo 2 --type full
[[ "$CODE" -eq 0 ]] \
  && pass "control: the identical invocation succeeds when pgBackRest does not refuse (the 072 assertions are non-vacuous)" \
  || fail "control failed — the 072 assertions above cannot be trusted (exit $CODE: $OUT)"

# A refused repo2 must NOT be retried against repo1. Writing repo1 and calling
# it done would report a green off-host backup that never left the host.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_072" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" \
           NORAMEDI_PGBACKREST_LOCK_FILE="$LOCK_072" \
           FAKE_FREE_MB=65000 FAKE_BACKUP_RC=72 FAKE_BACKUP_STDERR="$ERR_072")
: > "$WORK/pgbackrest.log"
run bash "$BACKUP" --repo 2 --type full
if grep -q -- '--repo=2' "$WORK/pgbackrest.log" \
   && ! grep -E 'pgbackrest --stanza=[^ ]+ --type=[a-z]+ backup$' "$WORK/pgbackrest.log" >/dev/null; then
  pass "a refused repo2 backup is not retried against repo1 (no repo-less backup invocation follows)"
else
  fail "a repo1 fallback was attempted after a repo2 refusal: $(cat "$WORK/pgbackrest.log")"
fi

# Root is required only by the real invocation path above; restore the genuine
# `id` before the shape checks so nothing downstream inherits the bypass.
rm -f "$FAKEBIN/id" "$FAKEBIN/flock"

# The published shapes must be usable on 2.50, which means no repo2-host. Both
# no-repo-host transports were verified end to end on a pinned 2.50 by
# scripts/noramedi-gate0-repo2-topology.sh; here we only assert the wrapper
# drives them without reintroducing a repository host.
for shape_conf in \
  "s3:repo2-type=s3\nrepo2-s3-bucket=b\nrepo2-s3-endpoint=obj.example.tr\nrepo2-s3-uri-style=path" \
  "sftp:repo2-type=sftp\nrepo2-sftp-host=backup.example.tr\nrepo2-sftp-host-user=pgbackrest"
do
  shape="${shape_conf%%:*}"
  body="${shape_conf#*:}"
  CONF_SHAPE="$WORK/pgbackrest-${shape}-topology.conf"
  # shellcheck disable=SC2059
  printf "[global]\nrepo1-path=%s\n${body}\nrepo2-cipher-type=aes-256-cbc\n" "$WORK/repo" > "$CONF_SHAPE"
  [[ "$(grep -c '^repo2-host' "$CONF_SHAPE")" -eq 0 ]] \
    && pass "the ${shape} repo2 shape declares no repo2-host (the ERROR [072] trigger)" \
    || fail "the ${shape} shape reintroduced repo2-host"
  EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_SHAPE" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/no-such-repo" \
             NORAMEDI_PGBACKREST_MIN_FREE_MB=999999 FAKE_FREE_MB=10)
  run bash "$BACKUP" --repo 2 --dry-run
  [[ "$CODE" -eq 0 ]] && [[ "$OUT" == *"--repo=2"* ]] \
    && pass "the wrapper drives a ${shape} repo2 from this host without local-disk preconditions" \
    || fail "expected exit 0 with --repo=2 for the ${shape} shape, got $CODE ($OUT)"
done

# The published config example must not publish the shape production refuses.
CONF_EXAMPLE="$SCRIPT_DIR/../ops/pgbackrest/pgbackrest.conf.example"
[[ "$(grep -cE '^[[:space:]]*repo2-host[[:space:]]*=' "$CONF_EXAMPLE")" -eq 0 ]] \
  && pass "pgbackrest.conf.example publishes no active repo2-host line (§22.4b removed the repo-host shape)" \
  || fail "pgbackrest.conf.example still publishes an active repo2-host — that shape is refused on production's 2.50"

# ════════════════════════════════════════════════════════════════════════
section "Restore drill: refuses unsafe targets"
EXTRA_ENV=(PROD_PG_PORT=5432); run bash "$DRILL" --port 5432
[[ "$CODE" -eq 2 ]] && pass "refuses a drill port equal to the production PostgreSQL port" || fail "expected exit 2, got $CODE ($OUT)"

EXTRA_ENV=(); run bash "$DRILL" --repo 9
[[ "$CODE" -eq 2 ]] && pass "rejects an out-of-range --repo" || fail "expected exit 2, got $CODE"

EXTRA_ENV=(); run bash "$DRILL" --target "yesterday"
[[ "$CODE" -eq 2 ]] && pass "rejects a non-timestamp --target (it is interpolated into a pgbackrest argument)" || fail "expected exit 2, got $CODE"

EXTRA_ENV=(); run bash "$DRILL" --set "'; rm -rf /"
[[ "$CODE" -eq 2 ]] && pass "rejects a --set value that is not a pgBackRest backup label" || fail "expected exit 2, got $CODE"

section "Restore drill: production-safety statements are present"
grep -q 'noramedi_crm' "$DRILL" && pass "names the production database it must never create" || fail "production database name absent"
grep -q 'listen_addresses' "$DRILL" && pass "verifies the bound address at runtime, not just in config" || fail "no runtime bind verification"
grep -q 'REHEARSAL_OS_USER' "$DRILL" && pass "requires an explicit unprivileged OS user" || fail "no privilege delegation"

# ════════════════════════════════════════════════════════════════════════
# F4-FCR-002A HARDENING GUARDS
#
# Each guard below is a predicate over a script file, so it can be run twice:
# once against the real script (must hold) and once against a deliberately
# MUTATED copy that reintroduces the original defect (must not hold). A guard
# that cannot fail is not a test, and every one of these defects shipped once
# already.
# ════════════════════════════════════════════════════════════════════════

# The synthesised pg_hba block, extracted from the heredoc rather than grepped
# out of the whole file — this asserts what the disposable cluster is actually
# configured with, not what the surrounding prose says about it.
hba_block() { awk "/<<'HBA'/{f=1;next} /^HBA\"/{f=0} f" "$1"; }

# absent_in / present_in — the ONE way this file asks "does this text contain
# this pattern", and the reason it is a function rather than a pipeline.
#
# F4-FCR-003-R1. Every guard below used to be written `producer | grep -q …`,
# and three of them negated the whole pipeline with a leading `!`. That shape
# is UNSOUND under this file's `set -o pipefail`:
#
#   * `grep -q` exits 0 the instant it matches, without draining stdin;
#   * the producer upstream then takes SIGPIPE on its next write and exits 141;
#   * pipefail makes 141 — not grep's 0 — the pipeline's status;
#   * the leading `!` turns that into SUCCESS, i.e. "pattern NOT found".
#
# So a negated guard reports CLEAN on precisely the input that contains the
# defect, and only on that input: with no match, `grep -q` reads to EOF, the
# producer exits 0, and the guard behaves. It is a race on how much the
# producer still had to flush when grep left, which is why the pgBackRest suite
# was green on a developer machine and red on ubuntu-latest with the identical
# tree (PR #433, run 31952565128: "no 'rm -rf ... 2>/dev/null || true'
# anywhere — the guard still PASSES on a mutant that reintroduces the defect").
#
# Materialising the haystack removes the pipeline, so the answer is grep's own
# exit status and nothing else. `<<<` feeds grep from a temporary file, not a
# pipe, so there is no reader/writer race left to lose.
haystack_has() { grep -qE "$2" <<<"$1"; }
absent_in()    { ! haystack_has "$1" "$2"; }
present_in()   {   haystack_has "$1" "$2"; }

guard_no_trust_auth() {
  absent_in "$(hba_block "$1")" '^[[:space:]]*(local|host|hostssl|hostnossl)[[:space:]].*[[:space:]]trust[[:space:]]*$'
}
guard_no_tcp_rule() {
  absent_in "$(hba_block "$1")" '^[[:space:]]*host(ssl|nossl)?[[:space:]]'
}
guard_peer_auth_present() {
  present_in "$(hba_block "$1")" '^[[:space:]]*local[[:space:]].*[[:space:]]peer([[:space:]]|$)'
}
guard_no_tcp_listener() { grep -qE "^PG_OPTS\+=\" -c listen_addresses=''\"" "$1"; }
guard_pinned_startup_gucs() {
  local f="$1" g
  for g in data_directory hba_file ident_file listen_addresses unix_socket_directories archive_mode archive_command; do
    grep -qE "^PG_OPTS\+=\" -c ${g}=" "$f" || return 1
  done
}
guard_trap_covers_hup() { grep -qE '^trap cleanup EXIT INT TERM HUP[[:space:]]*$' "$1"; }
# Comment lines are stripped first: the script QUOTES the defect it replaced in
# order to explain why, and a guard that cannot tell code from prose would
# either fail on the real file or have to be weakened until it caught nothing.
SILENT_RM_RE='rm -rf[^|]*2>/dev/null[[:space:]]*\|\|[[:space:]]*true'
guard_no_silent_rm() {
  absent_in "$(grep -vE '^[[:space:]]*#' "$1")" "$SILENT_RM_RE"
}
guard_kill_escalation() { grep -q 'kill -KILL' "$1" && grep -q 'kill -TERM' "$1"; }
guard_cleanup_verified() { grep -q 'STILL EXISTS after removal' "$1"; }
guard_shm_preflight() { grep -q 'MemAvailable' "$1" && grep -qE 'df -Pm "\$DRILL_PARENT"' "$1"; }
guard_port_preflight() { grep -q 'port_listener_present' "$1"; }
guard_rpo_mandatory() { grep -q 'RPO could not be measured' "$1"; }
guard_rto_endpoint() { grep -q 'tenant_smoke_complete' "$1"; }
guard_migration_compare() { grep -q 'the restore is STALE' "$1"; }
guard_r032_gate() { grep -q 'R032_ELIGIBLE=true' "$1" && grep -q 'not R-032 eligible' "$1"; }

# Runs a guard against the real script and against a mutated copy.
# $1 guard  $2 description  $3 sed program that reintroduces the defect
mutate_and_check() {
  local guard="$1" desc="$2" mutation="$3"
  if "$guard" "$DRILL"; then pass "$desc"; else fail "$desc — the real script does NOT satisfy this guard"; fi
  local mutant="$WORK/mutant-$$.sh"
  sed "$mutation" "$DRILL" > "$mutant"
  if cmp -s "$mutant" "$DRILL"; then
    fail "$desc — MUTATION WAS A NO-OP; this guard is untested and may be incapable of failing"
  elif "$guard" "$mutant"; then
    fail "$desc — the guard still PASSES on a mutant that reintroduces the defect"
  else
    pass "$desc — and the guard fails on a mutant that reintroduces it"
  fi
  rm -f "$mutant"
}

section "Restore drill (HIGH): no trust authentication, no TCP rule"
mutate_and_check guard_no_trust_auth \
  "the synthesised pg_hba grants no 'trust' anywhere" \
  "s|^local   all   \\\${PG_SUPERUSER}   peer map=noramedidrill\$|host    all   all   127.0.0.1/32   trust|"
mutate_and_check guard_no_tcp_rule \
  "the synthesised pg_hba contains no 'host' rule at all" \
  "s|^local   all   \\\${PG_SUPERUSER}   peer map=noramedidrill\$|host    all   all   127.0.0.1/32   scram-sha-256|"
guard_peer_auth_present "$DRILL" \
  && pass "the only accepted client is peer-authenticated over the unix socket" \
  || fail "no peer authentication rule in the synthesised pg_hba"
grep -q 'unix_socket_permissions = 0700' "$DRILL" \
  && pass "the unix socket directory is mode 0700 (the socket is the only way in)" \
  || fail "the unix socket permissions are not pinned to 0700"
grep -q 'pg_hba_file_rules' "$DRILL" \
  && pass "asserts the ABSENCE of non-local and trust rules against the live cluster, not just the file it wrote" \
  || fail "no runtime pg_hba assertion"
if grep -q 'PGPASSWORD' "$DRILL"; then
  fail "the drill introduces a PGPASSWORD"
else
  pass "no password exists to leak — peer auth needs none"
fi

section "Restore drill (HIGH): no TCP listener at all"
mutate_and_check guard_no_tcp_listener \
  "the disposable cluster is started with listen_addresses=''" \
  "s|^PG_OPTS+=\" -c listen_addresses=''\"\$|PG_OPTS+=\" -c listen_addresses=127.0.0.1\"|"

section "Restore drill (HIGH/MEDIUM): startup GUCs are pinned on the command line"
mutate_and_check guard_pinned_startup_gucs \
  "data_directory, hba_file, ident_file, listen_addresses, socket dir, archive_mode and archive_command are all pinned via pg_ctl -o" \
  "/^PG_OPTS+=\" -c data_directory=/d"
grep -q 'archive_command=' "$DRILL" \
  && pass "a restored configuration cannot make the disposable cluster push WAL into the real repository" \
  || fail "archive_command is not neutralised"

section "Restore drill (HIGH): cleanup is fail-closed"
mutate_and_check guard_trap_covers_hup \
  "cleanup traps EXIT, INT, TERM and HUP (an SSH drop must not orphan a PHI-bearing cluster)" \
  "s|^trap cleanup EXIT INT TERM HUP\$|trap cleanup EXIT INT TERM|"
mutate_and_check guard_no_silent_rm \
  "no 'rm -rf ... 2>/dev/null || true' anywhere" \
  "s|^    rm -rf \"\$DRILL_ROOT\" .*\$|    rm -rf \"\$DRILL_ROOT\" 2>/dev/null \|\| true|"

# ── Control on the GUARD itself, not on the drill (F4-FCR-003-R1) ────────
# The mutant above is a poor stress case for the guard: the drill's non-comment
# body is ~50 KB and the defect lands two thirds of the way down, so it fits in
# one 64 KiB pipe buffer and a pipeline-shaped guard usually wins the SIGPIPE
# race by luck. It won here and lost on ubuntu-latest against the identical
# tree. This control removes the luck rather than relying on the mutant to
# happen to expose it: the defect is the FIRST line, followed by megabytes of
# filler, so any guard that answers from a pipeline's exit status under
# `set -o pipefail` reports CLEAN every single time, on every machine.
BIGHAY="$WORK/silent-rm-bighay.sh"
awk 'BEGIN {
  printf "    rm -rf \"$DRILL_ROOT\" 2>/dev/null || true\n";
  for (i = 0; i < 20000; i++)
    printf "echo \"filler %d ------------------------------------------------------\"\n", i;
}' > "$BIGHAY"
if guard_no_silent_rm "$BIGHAY"; then
  fail "guard_no_silent_rm reports CLEAN on a file whose FIRST line is the forbidden cleanup — it is answering from a pipeline exit status and SIGPIPE, not from grep"
else
  pass "guard_no_silent_rm detects the defect even when the haystack is far larger than one pipe buffer (the exact shape that was green here and red on CI)"
fi
# Non-vacuity: the same oversized haystack minus the one defect line must pass,
# so the control above discriminates rather than merely rejecting large files.
grep -v 'rm -rf' "$BIGHAY" > "${BIGHAY}.clean"
if guard_no_silent_rm "${BIGHAY}.clean"; then
  pass "…and reports CLEAN on the same oversized haystack once the forbidden line is removed"
else
  fail "guard_no_silent_rm rejects an oversized haystack that does NOT contain the defect — the control is vacuous"
fi
rm -f "$BIGHAY" "${BIGHAY}.clean"

guard_kill_escalation "$DRILL" \
  && pass "stop escalates through SIGTERM to SIGKILL rather than assuming pg_ctl worked" \
  || fail "no bounded kill escalation"
guard_cleanup_verified "$DRILL" \
  && pass "removal is verified and an unremoved drill root is reported, not assumed" \
  || fail "removal is not verified"
grep -q 'CLEANUP_INCIDENT_EXIT_CODE=5' "$DRILL" \
  && pass "a cleanup failure has its own non-zero exit code (5)" \
  || fail "cleanup failure has no dedicated exit code"
grep -q 'incident marker written to' "$DRILL" \
  && pass "a cleanup failure writes explicit operator incident evidence" \
  || fail "no incident evidence is written on cleanup failure"

section "Restore drill (MEDIUM): preflights that must run BEFORE the restore"
guard_port_preflight "$DRILL" && pass "the drill port is checked for a collision before restoring" || fail "no port preflight"
guard_shm_preflight "$DRILL" && pass "/dev/shm capacity and MemAvailable are both checked" || fail "no capacity preflight"
grep -q "Free space on / is not the constraint" "$DRILL" \
  && pass "records that root-filesystem free space is not the constraint (the target is RAM)" \
  || fail "the capacity message does not distinguish RAM from disk"
grep -q 'not tmpfs' "$DRILL" \
  && pass "refuses a drill root that would write cleartext patient data to a block device" \
  || fail "no tmpfs enforcement"

section "Restore drill: R-032 evidence contract"
guard_rpo_mandatory "$DRILL" && pass "an unmeasurable RPO FAILS the drill (it can no longer be '<unknown>' and pass)" || fail "RPO is still optional"
guard_rto_endpoint "$DRILL" && pass "RTO is measured to smoke completion, not to postmaster readiness" || fail "RTO endpoint is still postmaster readiness"
guard_migration_compare "$DRILL" && pass "a structurally healthy but STALE restore fails" || fail "no migration-set comparison"
guard_r032_gate "$DRILL" && pass "r032Eligible requires the application and tenant smokes to have run and passed" || fail "no R-032 eligibility gate"
grep -q 'rlsUsedByDomain: false' "$DRILL" \
  && pass "records explicitly that this domain does NOT use RLS, so a green tenant line cannot be misread as RLS coverage" \
  || fail "RLS status is not recorded"
grep -q 'not writing the off-host proof marker: this run is not R-032 eligible' "$DRILL" \
  && pass "--record refuses to write an off-host proof for a run that proved nothing about the application" \
  || fail "--record is not gated on R-032 eligibility"

# ════════════════════════════════════════════════════════════════════════
section "Restore drill: deterministic PITR stop-point verification (R-031)"
# Before this, the drill passed --target to pgbackrest and recorded
# pg_last_xact_replay_timestamp(), but asserted nothing about where replay
# actually stopped. A recovery that ignored recovery_target_time and ran to the
# end of the WAL produced identical tables, migrations and counts — so the
# drill would report `passed` over an unproven PITR.
grep -q "PITR_MARKER_A_COUNT\" != \"1\"" "$DRILL" \
  && pass "asserts exactly one marker A row (undershoot is caught)" \
  || fail "no marker A assertion"
grep -q "PITR_MARKER_B_COUNT\" != \"0\"" "$DRILL" \
  && pass "asserts zero marker B rows (OVERSHOOT is caught)" \
  || fail "no marker B assertion"
grep -q 'recovery OVERSHOT the target, so recovery_target_time was not honoured' "$DRILL" \
  && pass "names overshoot explicitly, so the failure is actionable" \
  || fail "overshoot is not named"
grep -q 'PITR_REPLAY_EPOCH" -gt "\$PITR_TARGET_EPOCH' "$DRILL" \
  && pass "independently asserts replay point <= recovery target" \
  || fail "no replay-vs-target comparison"
grep -q 'an unverifiable stop point is not a verified one' "$DRILL" \
  && pass "an unparseable replay/target pair FAILS closed rather than passing silently" \
  || fail "the comparison can fail open"
grep -q 'PITR_VERIFY_STATUS" == "passed" || "\$PITR_VERIFY_STATUS" == "not_applicable"' "$DRILL" \
  && pass "r032Eligible additionally requires a verified (or not-applicable) PITR stop point" \
  || fail "R-032 eligibility ignores PITR verification"
grep -q 'the recovery stop point is NOT verified' "$DRILL" \
  && pass "a --target run without --pitr-run-id is marked not_verified instead of silently trusted" \
  || fail "an unverified targeted run is indistinguishable from a verified one"
grep -q 'd.pitrVerification = p;' "$DRILL" \
  && pass "the durable result artifact carries the PITR verification block" \
  || fail "PITR evidence is not written to the result document"
for _f in markerACount markerBCount markerWalSegment markerAAt markerBAt; do
  grep -q "$_f" "$DRILL" \
    && pass "result artifact records ${_f}" \
    || fail "result artifact is missing ${_f}"
done
# Deliberately NOT a bare `runId` grep: the result document already carries the
# drill's own runId, so that pattern matches the pre-change script and proves
# nothing. Only the PITR block's own runId is evidence of this feature.
grep -q 'put(p, "runId", E.R_PITR_RUNID)' "$DRILL" \
  && pass "result artifact records the PITR marker runId (distinct from the drill's own runId)" \
  || fail "the PITR verification block does not record its marker runId"
# Written as an explicit presence check FIRST. The obvious form —
# `grep -q 'AT TIME ZONE' <<<"$(...)" && fail || pass` — passes vacuously when
# the PITR block does not exist at all, i.e. it would have gone green against
# the very version this section was written to catch.
_PITR_BLOCK="$(sed -n '/deterministic PITR stop-point/,/^T_DB_VERIFY_DONE/p' "$DRILL")"
if ! grep -q 'PITR_MARKER_A_AT=' <<<"$_PITR_BLOCK"; then
  fail "the marker-A timestamp query is missing from the PITR verification block"
elif grep 'createdAt' <<<"$_PITR_BLOCK" | grep -q 'AT TIME ZONE'; then
  fail "marker timestamps are silently converted to a timezone the script cannot know"
else
  pass "marker timestamps are recorded verbatim, with no assumed timezone conversion"
fi
# The naive column is UTC — established against production, not assumed. The
# value must therefore be LABELLED `Z`, never shifted: an unlabelled timestamp
# in the artifact is what let a +03 reading be derived and accepted once
# already, and that target was three hours from where it was meant to be.
if ! grep -q 'PITR_MARKER_A_AT=' <<<"$_PITR_BLOCK"; then
  fail "the marker-A timestamp query is missing, so its zone labelling cannot be checked"
elif grep -q "|| 'Z' FROM" <<<"$_PITR_BLOCK"; then
  pass "the marker-A timestamp is emitted with an explicit Z, so the artifact is unambiguous"
else
  fail "the marker-A timestamp is emitted with no zone label — a future reader cannot tell UTC from local"
fi
grep -q 'TIMEZONE RULE FOR THIS COLUMN' "$DRILL" \
  && pass "the createdAt timezone rule is stated in the script, not left to be re-derived" \
  || fail "the timezone rule is undocumented, so the next drill can repeat the +03 mistake"
grep -q 'p.markerTimestampZone = "UTC"' "$DRILL" \
  && pass "the result artifact states the zone of its own marker timestamps" \
  || fail "the artifact records marker timestamps without saying what zone they are in"
grep -q 'explicit UTC offset on --target' "$DRILL" \
  && pass "a verified run refuses a --target with no explicit offset" \
  || fail "a bare --target can still be paired with marker verification"

# ════════════════════════════════════════════════════════════════════════
# Behavioural: the preconditions actually fire, and they fire BEFORE the
# restore. Static greps cannot distinguish "checked" from "checked too late".
# ════════════════════════════════════════════════════════════════════════
DRILL_SHM="$WORK/shm"
mkdir -p "$DRILL_SHM"
APP_DIR="$WORK/app"
mkdir -p "$APP_DIR/prisma/migrations/20260101000000_init" "$APP_DIR/node_modules/@prisma/client"
echo '{"name":"server"}' > "$APP_DIR/package.json"

drill_env() {
  EXTRA_ENV=(
    PG_BINDIR="$FAKEBIN"
    NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill"
    NORAMEDI_APP_SERVER_DIR="$APP_DIR"
    NORAMEDI_PITR_DRILL_RESULT_FILE="$WORK/result.json"
    PROD_PG_PORT=5432
    "$@"
  )
}

section "Restore drill (behaviour): a port collision aborts before anything is restored"
: > "$WORK/pgbackrest.log"
drill_env FAKE_LISTEN_PORT=55433
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "a busy drill port is a precondition failure (exit 3)" || fail "expected exit 3, got $CODE ($OUT)"
grep -q 'restore' "$WORK/pgbackrest.log" \
  && fail "pgbackrest restore ran despite the port collision" \
  || pass "pgbackrest restore was never invoked — nothing was written to tmpfs"

section "Restore drill (behaviour): a Prisma 7 release without @prisma/adapter-pg is refused up front"
# F4-FCR-002A-R4. The second real drill restored production, verified the PITR
# stop point, matched 74/74 migrations and passed tenant isolation — and then
# could not construct PrismaClient, because the deployed release is Prisma 7
# (driver-adapter only) and the smoke helper was on the Prisma 6 contract. A
# release that cannot satisfy the smoke must be caught before a restore is
# spent on it, not after.
APP_DIR_V7="$WORK/app-v7-no-adapter"
mkdir -p "$APP_DIR_V7/prisma/migrations/20260101000000_init" "$APP_DIR_V7/node_modules/@prisma/client"
echo '{"name":"server"}' > "$APP_DIR_V7/package.json"
echo '{"name":"@prisma/client","version":"7.9.1"}' > "$APP_DIR_V7/node_modules/@prisma/client/package.json"
: > "$WORK/pgbackrest.log"
EXTRA_ENV=(
  PG_BINDIR="$FAKEBIN"
  NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill"
  NORAMEDI_APP_SERVER_DIR="$APP_DIR_V7"
  NORAMEDI_PITR_DRILL_RESULT_FILE="$WORK/result.json"
  PROD_PG_PORT=5432
)
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] \
  && pass "a v7 deployed client with no @prisma/adapter-pg is a precondition failure (exit 3)" \
  || fail "expected exit 3, got $CODE ($OUT)"
[[ "$OUT" == *"adapter-pg"* ]] \
  && pass "the refusal names @prisma/adapter-pg so the operator knows what is missing" \
  || fail "the refusal does not identify the missing package ($OUT)"
grep -q 'restore' "$WORK/pgbackrest.log" \
  && fail "pgbackrest restore ran despite an unusable deployed release" \
  || pass "pgbackrest restore was never invoked — no restore was spent on a release that cannot be smoked"

# The same check must NOT fire for a pre-7 release, which needs no adapter.
APP_DIR_V6="$WORK/app-v6"
mkdir -p "$APP_DIR_V6/prisma/migrations/20260101000000_init" "$APP_DIR_V6/node_modules/@prisma/client"
echo '{"name":"server"}' > "$APP_DIR_V6/package.json"
echo '{"name":"@prisma/client","version":"6.14.0"}' > "$APP_DIR_V6/node_modules/@prisma/client/package.json"
EXTRA_ENV=(
  PG_BINDIR="$FAKEBIN"
  NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill"
  NORAMEDI_APP_SERVER_DIR="$APP_DIR_V6"
  NORAMEDI_PITR_DRILL_RESULT_FILE="$WORK/result.json"
  PROD_PG_PORT=5432
)
run bash "$DRILL"
[[ "$OUT" != *"adapter-pg"* ]] \
  && pass "a pre-7 deployed release is not asked for a driver adapter it does not use" \
  || fail "the adapter requirement leaked onto a Prisma 6 release ($OUT)"

section "Restore drill (behaviour): the anti-production guard fails CLOSED"
# The superseded version only attempted this lookup as root and merely logged a
# warning otherwise, so a non-root invocation skipped the one check standing
# between the drill and production's PGDATA.
: > "$WORK/pgbackrest.log"
drill_env FAKE_DATA_DIRECTORY="" FAKE_LSCLUSTERS=""
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "an undeterminable production PGDATA REFUSES TO RUN rather than warning and continuing" || fail "expected exit 3, got $CODE ($OUT)"
[[ "$OUT" == *"REFUSING TO RUN"* ]] && pass "says plainly that it refused" || fail "no refusal message ($OUT)"
grep -q 'restore' "$WORK/pgbackrest.log" && fail "restore ran without the production guard" || pass "nothing was restored"

section "Restore drill (behaviour): a drill path inside production PGDATA is refused"
drill_env FAKE_DATA_DIRECTORY="$DRILL_SHM"
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "a drill root inside the production data directory is refused" || fail "expected exit 3, got $CODE ($OUT)"

section "Restore drill (behaviour): a non-tmpfs drill root is refused"
: > "$WORK/pgbackrest.log"
drill_env FAKE_FSTYPE=ext4
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "refuses to write cleartext cross-tenant patient data to a block device" || fail "expected exit 3, got $CODE ($OUT)"
grep -q 'restore' "$WORK/pgbackrest.log" && fail "restore ran onto a non-tmpfs root" || pass "nothing was restored"
drill_env FAKE_FSTYPE=ext4 NORAMEDI_PITR_DRILL_ALLOW_NON_TMPFS=1
run bash "$DRILL"
# Asserted on the log rather than the exit code: later preconditions differ by
# host, but "did the tmpfs gate let this through, and did it say so" does not.
[[ "$OUT" == *"NOT tmpfs — proceeding only because"* ]] && [[ "$OUT" == *"port ${DRILL_PORT_UNDER_TEST:-55433} is free"* ]] \
  && pass "the deliberate override is honoured, loudly warned, and execution continues past the gate" \
  || fail "the override did not take effect ($OUT)"

section "Restore drill (behaviour): capacity is checked before the restore"
: > "$WORK/pgbackrest.log"
drill_env FAKE_FREE_MB=100
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "insufficient tmpfs capacity aborts (exit 3)" || fail "expected exit 3, got $CODE ($OUT)"
grep -q 'restore' "$WORK/pgbackrest.log" \
  && fail "restore ran into a filesystem too small to hold it — the ENOSPC-mid-replay failure this check exists to prevent" \
  || pass "restore was never invoked"

if awk '/^MemAvailable:/ {found=1} END {exit !found}' /proc/meminfo 2>/dev/null; then
  section "Restore drill (behaviour): RAM headroom is enforced"
  drill_env NORAMEDI_PITR_DRILL_MIN_FREE_RAM_MB=999999999
  run bash "$DRILL"
  [[ "$CODE" -eq 3 ]] && pass "refuses to starve the live production postmaster of RAM" || fail "expected exit 3, got $CODE ($OUT)"
else
  section "Restore drill (behaviour): an unreadable MemAvailable fails CLOSED"
  # This host has no MemAvailable in /proc/meminfo. That is exactly the
  # fail-closed path: the drill must refuse rather than allocate a tmpfs
  # cluster of unknown affordability.
  drill_env
  run bash "$DRILL"
  [[ "$CODE" -eq 3 ]] && pass "an unreadable MemAvailable is a precondition failure, not an assumption that memory is fine" || fail "expected exit 3, got $CODE ($OUT)"
  [[ "$OUT" == *"MemAvailable"* ]] && pass "names the missing input" || fail "no diagnostic naming MemAvailable ($OUT)"
fi

section "Restore drill (behaviour): the application smoke is mandatory by default"
EXTRA_ENV=(PG_BINDIR="$FAKEBIN" NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill" PROD_PG_PORT=5432)
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "an unset NORAMEDI_APP_SERVER_DIR aborts (a drill that only proves a cluster starts is not R-032 evidence)" || fail "expected exit 3, got $CODE ($OUT)"
[[ "$OUT" == *"not R-032 evidence"* ]] && pass "explains why, in R-032 terms" || fail "no R-032 explanation ($OUT)"

EXTRA_ENV=(PG_BINDIR="$FAKEBIN" NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill" NORAMEDI_APP_SERVER_DIR="$WORK/not-an-app" PROD_PG_PORT=5432)
run bash "$DRILL"
[[ "$CODE" -eq 3 ]] && pass "a NORAMEDI_APP_SERVER_DIR without prisma/migrations aborts" || fail "expected exit 3, got $CODE ($OUT)"

section "Restore drill (behaviour): --record is refused for a non-evidential run"
EXTRA_ENV=(PG_BINDIR="$FAKEBIN" NORAMEDI_PGBACKREST_DRILL_ROOT="$DRILL_SHM/drill" PROD_PG_PORT=5432)
run bash "$DRILL" --allow-missing-app-smoke
[[ "$OUT" == *"cannot be R-032 evidence"* ]] \
  && pass "--allow-missing-app-smoke states up front that the run cannot be R-032 evidence" \
  || fail "the triage mode does not disclaim its own evidence value ($OUT)"

section "Restore drill (behaviour): positive control — the gates are not simply always-failing"
# Without this, every assertion above would also pass on a script that exited 3
# unconditionally.
if awk '/^MemAvailable:/ {found=1} END {exit !found}' /proc/meminfo 2>/dev/null; then
  : > "$WORK/pgbackrest.log"
  : > "$WORK/pgctl.log"
  drill_env NORAMEDI_PITR_DRILL_MIN_FREE_RAM_MB=0 NORAMEDI_PITR_DRILL_ASSUMED_DB_MB=1 \
            NORAMEDI_PITR_DRILL_WAL_ALLOWANCE_MB=1 FAKE_PGCTL_RC=1
  run bash "$DRILL"
  grep -q 'restore' "$WORK/pgbackrest.log" \
    && pass "with every precondition satisfied the drill DOES reach the restore" \
    || fail "the drill never restored even on the clean path — the preconditions above prove nothing ($OUT)"
  [[ "$CODE" -eq 1 ]] && pass "a cluster that will not start is a drill FAILURE (exit 1), not a precondition error" || fail "expected exit 1, got $CODE ($OUT)"
  SURVIVORS="$(find "$DRILL_SHM" -maxdepth 1 -name 'drill-*' 2>/dev/null || true)"
  [[ -z "$SURVIVORS" ]] \
    && pass "the drill root was removed on the failure path" \
    || fail "a drill root survived teardown: $SURVIVORS"
else
  # Reported, not silently dropped: a suite that quietly skips its own positive
  # control reads as "everything passed" when it proved much less.
  echo "  SKIPPED - positive control needs MemAvailable in /proc/meminfo (absent on this host);"
  echo "            the drill's RAM gate fails closed here, which the section above asserts instead."
fi

# ════════════════════════════════════════════════════════════════════════
section "Application smoke helper"
SMOKE="$SCRIPT_DIR/noramedi-pitr-app-smoke.mjs"
if [[ -f "$SMOKE" ]]; then
  pass "noramedi-pitr-app-smoke.mjs is present (the drill refuses to run without it)"
  if command -v node >/dev/null 2>&1; then
    node --check "$SMOKE" >/dev/null 2>&1 && pass "app smoke parses (node --check)" || fail "app smoke has a syntax error"

    # It must always emit exactly one contract line, including on its own
    # failure paths — the drill treats a missing line as a failed stage, so a
    # helper that dies silently and a helper that reports failure would be
    # indistinguishable in the evidence.
    SM_OUT="$(node "$SMOKE" 2>&1 || true)"
    [[ "$(grep -c '^APP_SMOKE_RESULT ' <<<"$SM_OUT")" -eq 1 ]] \
      && pass "emits exactly one APP_SMOKE_RESULT line when its environment is missing" \
      || fail "did not emit exactly one result line ($SM_OUT)"
    [[ "$SM_OUT" == *"APP_SMOKE_RESULT failed"* ]] && pass "a missing environment is a FAILURE, not a skip" || fail "expected a failed result ($SM_OUT)"

    SM_OUT="$(NORAMEDI_SMOKE_APP_DIR="$APP_DIR" NORAMEDI_SMOKE_SOCKET_DIR="127.0.0.1" \
              NORAMEDI_SMOKE_PORT=55433 NORAMEDI_SMOKE_DB=noramedi_crm NORAMEDI_SMOKE_USER=postgres \
              node "$SMOKE" 2>&1 || true)"
    [[ "$SM_OUT" == *"refusing to connect over TCP"* ]] \
      && pass "refuses a non-absolute (i.e. TCP) host — it must only ever reach the drill's own socket" \
      || fail "a TCP host was not refused ($SM_OUT)"

    SM_OUT="$(NORAMEDI_SMOKE_APP_DIR="$APP_DIR" NORAMEDI_SMOKE_SOCKET_DIR="$WORK/nosock" \
              NORAMEDI_SMOKE_PORT=55433 NORAMEDI_SMOKE_DB=noramedi_crm NORAMEDI_SMOKE_USER=postgres \
              node "$SMOKE" 2>&1 || true)"
    [[ "$SM_OUT" == *"no unix socket"* ]] && pass "refuses to run when the drill socket is absent" || fail "a missing socket was not detected ($SM_OUT)"
  fi

  grep -q 'PGPASSWORD' "$SMOKE" && fail "app smoke references PGPASSWORD" || pass "app smoke holds no credential (peer auth needs none)"
  grep -qE 'console\.log' "$SMOKE" && fail "app smoke uses console.log, which could print a row" || pass "app smoke never console.logs"
  grep -q 'result deliberately unused' "$SMOKE" \
    && pass "the findFirst() schema-drift probe discards its row rather than inspecting it" \
    || fail "the drift probe does not document discarding its row"
  grep -q 'createRequire' "$SMOKE" \
    && pass "loads the DEPLOYED Prisma client from the app directory, not its own dependencies" \
    || fail "does not resolve the deployed client"
else
  fail "noramedi-pitr-app-smoke.mjs is missing — the drill's application smoke cannot run"
fi

# ════════════════════════════════════════════════════════════════════════
section "Preflight: read-only by default"
grep -q '\-\-apply' "$PREFLIGHT" && pass "writing requires an explicit --apply" || fail "no --apply gate"

# Behavioural, not a grep: the script legitimately PRINTS `systemctl restart
# postgresql` as the operator's next step, so searching the source text would
# flag its own documentation. Instead a fake systemctl on PATH records every
# invocation, and the assertion is that the log stays empty.
SYSCTL_LOG="$WORK/systemctl.log"
: > "$SYSCTL_LOG"
cat > "$FAKEBIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "INVOKED: \$*" >> "$SYSCTL_LOG"
exit 0
EOF
chmod +x "$FAKEBIN/systemctl"
cat > "$FAKEBIN/service" <<EOF
#!/usr/bin/env bash
echo "INVOKED: \$*" >> "$SYSCTL_LOG"
exit 0
EOF
chmod +x "$FAKEBIN/service"

EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$PREFLIGHT"
[[ ! -s "$SYSCTL_LOG" ]] \
  && pass "preflight never executes systemctl/service — a PostgreSQL restart is always a deliberate operator action" \
  || fail "preflight invoked systemctl: $(cat "$SYSCTL_LOG")"

EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$PREFLIGHT"
[[ "$OUT" != *"$CANARY"* ]] && pass "preflight never prints the repository passphrase (it reads the config that holds it)" || fail "CANARY LEAKED from preflight"

rm -f "$FAKEBIN/systemctl" "$FAKEBIN/service"

EXTRA_ENV=(); run bash "$PREFLIGHT" --stanza "BAD NAME"
[[ "$CODE" -eq 2 ]] && pass "an invalid stanza name exits 2" || fail "expected exit 2, got $CODE"
EXTRA_ENV=(NORAMEDI_PGBACKREST_MIN_FREE_MB=nope); run bash "$PREFLIGHT"
[[ "$CODE" -eq 2 ]] && pass "a malformed free-space floor exits 2 (fail closed)" || fail "expected exit 2, got $CODE"

# ════════════════════════════════════════════════════════════════════════
section "Preflight: repo2 encryption is validated BEFORE any byte leaves the host"
# The status writer already refuses to call a plaintext repo2 off-host, but it
# discovers that AFTER the bytes are written. Preflight runs before, which is
# the only point at which the mistake is still cheap. repo2 is held to a
# STRICTER standard than repo1 for a concrete reason: repo1 never leaves
# infrastructure this program operates, and repo2 exists precisely to.
#
# Preflight refuses to run as non-root before it reaches any config check, so
# `id` is faked for this section only. Faking `id -u` rather than the config
# checks themselves keeps the assertions on the real code path. Removed again
# at the end of the section so nothing later inherits a root-looking shell.
cat > "$FAKEBIN/id" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "-u" ]] && { echo 0; exit 0; }
exec /usr/bin/id "$@"
EOF
chmod +x "$FAKEBIN/id"

# Section 4 (pgbackrest.conf) is only reached once section 3 resolves a
# drop-in target, so the harness supplies a real postgresql.conf with an
# active include_dir and a real data directory. Without them preflight exits
# AMBIGUOUS long before it reads a single repo2 key.
PGCONF_DIR="$WORK/pgconf"
PGCONF_FILE="$PGCONF_DIR/postgresql.conf"
PGDATA_FAKE="$WORK/pgdata"
mkdir -p "$PGCONF_DIR/conf.d" "$PGDATA_FAKE"
printf "include_dir = 'conf.d'\n" > "$PGCONF_FILE"

PF2="$WORK/pgbackrest-pf2.conf"

printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=none\n' "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-cipher-type is 'none'"* ]] \
  && pass "a PLAINTEXT repo2 is a preflight failure, not merely a warning" \
  || fail "plaintext repo2 was not reported ($OUT)"

printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-cipher-pass is not set"* ]] \
  && pass "an encrypted repo2 with no passphrase is caught before stanza-create fails on the remote host" \
  || fail "missing repo2 passphrase was not reported ($OUT)"

# Reusing one passphrase for both repositories means a single compromise opens
# the local AND the off-host copy — and defeats the point of escrowing two.
printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"IDENTICAL to repo1-cipher-pass"* ]] \
  && pass "a repo2 passphrase identical to repo1's is rejected" \
  || fail "identical passphrases were not reported ($OUT)"
[[ "$OUT" != *"$CANARY"* ]] \
  && pass "the identical-passphrase comparison never prints either passphrase (compared by hash)" \
  || fail "CANARY LEAKED while comparing passphrases"

printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-cipher-pass is set"* ]] && [[ "$OUT" != *"IDENTICAL"* ]] \
  && pass "a correctly configured, distinctly-keyed repo2 passes the encryption checks" \
  || fail "a valid repo2 was rejected ($OUT)"
[[ "$OUT" == *"Off-host activation is a SEPARATE authorization"* ]] \
  && pass "the off-host authorization warning is still emitted alongside the new checks" \
  || fail "the R-030 authorization warning was lost ($OUT)"

# Retention. pgBackRest expires nothing it was not told to expire, and repo2
# lives where this program has no disk check, no monitoring and no ability to
# free space during an incident. The SSH template block carried both keys, the
# S3 block did not, and nothing failed when they were absent.
printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-retention-full is not set"* ]] \
  && pass "a repo2 with no retention bound is a preflight failure" \
  || fail "missing repo2 retention was not reported ($OUT)"
[[ "$OUT" == *"repo2-retention-archive is not set"* ]] \
  && pass "both retention keys are checked, not just the first" \
  || fail "repo2-retention-archive was not checked ($OUT)"

printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\nrepo2-retention-full=7\nrepo2-retention-archive=7\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-retention-full=7"* ]] && [[ "$OUT" != *"is not set"* ]] \
  && pass "a fully configured repo2 passes the retention checks" \
  || fail "a valid repo2 retention config was rejected ($OUT)"
[[ "$OUT" != *"$CANARY"* ]] \
  && pass "the retention checks never print either passphrase" \
  || fail "CANARY LEAKED while validating retention"

# ── SFTP host-key verification (F4-FCR-004-R1) ────────────────────────────
#
# The accepted contract, verified against the PINNED production build
# (pgBackRest 2.50) and documented with citations in runbook §22.4c:
#
#   repo2-sftp-host-key-check-type=fingerprint
#   repo2-sftp-host-key-hash-type=sha256
#   repo2-sftp-host-fingerprint=<64 lowercase hex chars, no separators>
#
# The check type is the load-bearing key. On 2.50 it DEFAULTS TO strict, and
# storage/sftp/storage.c compares the pinned fingerprint ONLY when it is
# exactly `fingerprint`; every other non-`none` value falls through to
# known_hosts and the pin is never read. So the earlier gate -- which refused
# only `none` and accepted any other value -- passed configs whose fingerprint
# was inert. These cases pin that distinction down.
_SFTP_BASE='[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-type=sftp\nrepo2-path=/var/lib/pgbackrest\nrepo2-sftp-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\nrepo2-retention-full=7\nrepo2-retention-archive=7\n'
# 64 lowercase hex characters == a sha256 digest as pgBackRest renders it.
_FP_OK='3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b'

sftp_pf() {   # $1 = extra config lines (printf format, already \n-escaped)
  printf "${_SFTP_BASE}$1" "$CANARY" "$CANARY" > "$PF2"
  EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
  run bash "$PREFLIGHT"
}

# (3) The accepted pairing passes -- the positive control. Without this, every
#     negative below could be satisfied by a gate that fails everything.
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"repo2-sftp-host-key-check-type=fingerprint"* ]] \
  && [[ "$OUT" == *"repo2-sftp-host-fingerprint is pinned"* ]] \
  && pass "the accepted contract (check-type=fingerprint + sha256 + 64 hex chars) passes preflight" \
  || fail "the accepted SFTP host-key contract was rejected ($OUT)"
[[ "$OUT" != *"$_FP_OK"* ]] \
  && pass "the preflight reports the fingerprint as pinned WITHOUT echoing its value" \
  || fail "the preflight printed the fingerprint value ($OUT)"

# (4) none -- verification off entirely.
sftp_pf "repo2-sftp-host-key-check-type=none\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"host-key-check-type=none disables SSH host-key verification"* ]] \
  && pass "repo2-sftp-host-key-check-type=none is a preflight failure, not a warning" \
  || fail "host-key-check-type=none was not refused ($OUT)"

# (5) Missing check type. This is the case the pre-R1 gate ACCEPTED: a pinned
#     fingerprint that pgBackRest never compares, because the default is
#     `strict`. It must fail, and the message must name the default.
sftp_pf "repo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"repo2-sftp-host-key-check-type is not set"* ]] \
  && pass "a pinned fingerprint with NO check type fails (default 'strict' never compares the pin)" \
  || fail "a config whose fingerprint pgBackRest would never read was accepted ($OUT)"

# (5b) strict + a pinned fingerprint is the same defect stated explicitly.
sftp_pf "repo2-sftp-host-key-check-type=strict\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"repo2-sftp-host-key-check-type=strict verifies against"* ]] \
  && pass "check-type=strict alongside a pinned fingerprint is refused as contradictory" \
  || fail "strict+fingerprint was accepted even though the pin is inert ($OUT)"

# (5c) accept-new is trust-on-first-use, and the first backup is the one that
#      carries the data off the host.
sftp_pf "repo2-sftp-host-key-check-type=accept-new\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"accept-new is trust-on-first-use"* ]] \
  && pass "check-type=accept-new is refused (and is not silently read as 'accept')" \
  || fail "accept-new was accepted ($OUT)"

# (6) Weak / wrong / missing hash type.
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=md5\nrepo2-sftp-host-fingerprint=f84e172dfead7aeeeae6c1fdfb5aa8cf\n"
[[ "$OUT" == *"repo2-sftp-host-key-hash-type=md5 is a broken digest"* ]] \
  && pass "hash-type=md5 is refused even though pgBackRest 2.50 accepts it" \
  || fail "md5 host-key hash type was accepted ($OUT)"
[[ "$OUT" != *"is malformed"* ]] && [[ "$OUT" != *"hex characters but"* ]] \
  && pass "a rejected hash type does not also emit a bogus fingerprint-length failure" \
  || fail "md5 produced a second, misleading fingerprint failure ($OUT)"

sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha1\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"repo2-sftp-host-key-hash-type=sha1 is a broken digest"* ]] \
  && pass "hash-type=sha1 is refused" \
  || fail "sha1 host-key hash type was accepted ($OUT)"

sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-fingerprint=${_FP_OK}\n"
[[ "$OUT" == *"repo2-sftp-host-key-hash-type is not set"* ]] \
  && pass "a missing hash type is refused (it selects the digest the pin is compared against)" \
  || fail "a fingerprint with no declared hash type was accepted ($OUT)"

# (7) Missing fingerprint.
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\n"
[[ "$OUT" == *"no repo2-sftp-host-fingerprint is pinned"* ]] \
  && pass "an SFTP repo2 with no pinned fingerprint is a preflight failure" \
  || fail "an unpinned SFTP endpoint was accepted ($OUT)"

# (8) The template placeholder.
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=<REPLACE - pin it>\n"
[[ "$OUT" == *"repo2-sftp-host-fingerprint is still the"* ]] \
  && pass "a template '<REPLACE ...>' fingerprint placeholder is refused" \
  || fail "the fingerprint placeholder was accepted as a pin ($OUT)"

# (9) Malformed fingerprints. Each of these is a value pgBackRest compares with
#     strcmp() against lowercase colonless hex, so each fails at RUN time --
#     after the operator believes the endpoint is pinned. The pre-R1 regex
#     `[0-9a-fA-F:]{16,}` ACCEPTED the first two.
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=ab:cd:ef:01:23:45:67:89\n"
[[ "$OUT" == *"repo2-sftp-host-fingerprint is colon-separated"* ]] \
  && pass "a colon-separated fingerprint is refused (pgBackRest never matches it)" \
  || fail "colon-separated fingerprint was accepted as a valid pin ($OUT)"

sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=3A7BD3E2360A3D29EEA436FCFB7E44C735D117C42D1C1835420B6B9942DD4F1B\n"
[[ "$OUT" == *"contains uppercase hex"* ]] \
  && pass "an UPPERCASE hex fingerprint is refused (strcmp is against lowercase)" \
  || fail "uppercase fingerprint was accepted ($OUT)"

sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=3a7bd3e2360a3d29eea436fcfb7e44c7\n"
[[ "$OUT" == *"hex characters but repo2-sftp-host-key-hash-type=sha256 requires exactly 64"* ]] \
  && pass "a 32-char (md5-length) fingerprint under sha256 is refused on length" \
  || fail "a wrong-length fingerprint was accepted ($OUT)"

sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=\n"
[[ "$OUT" == *"in ssh-keygen's '<HASH>:<base64>' form"* ]] \
  && pass "ssh-keygen's base64 'SHA256:...' form is refused, and named as such" \
  || fail "the ssh-keygen base64 fingerprint form was accepted or misdiagnosed ($OUT)"
# Regression guard for the greedy-sed defect this case exposed: a value whose
# base64 padding ends in `=` must not be truncated to empty and reported as
# "no fingerprint pinned" -- fail-closed, but it sends the operator to add a
# value they had already added.
[[ "$OUT" != *"no repo2-sftp-host-fingerprint is pinned"* ]] \
  && pass "a fingerprint containing '=' is not truncated to empty by value extraction" \
  || fail "a base64 fingerprint was truncated and misreported as unpinned ($OUT)"

# A bare malformed value (neither hex, nor colon form, nor ssh-keygen form).
sftp_pf "repo2-sftp-host-key-check-type=fingerprint\nrepo2-sftp-host-key-hash-type=sha256\nrepo2-sftp-host-fingerprint=not-a-digest\n"
[[ "$OUT" == *"repo2-sftp-host-fingerprint is malformed"* ]] \
  && pass "a non-hex fingerprint is refused as malformed" \
  || fail "a non-hex fingerprint was accepted ($OUT)"

# (12) No secret leak anywhere in the host-key surface.
[[ "$OUT" != *"$CANARY"* ]] \
  && pass "the SFTP host-key checks never print either passphrase" \
  || fail "CANARY LEAKED while validating SFTP host-key settings"

# (9b) repo2-sftp-* without repo2-type=sftp is the gap between the two files:
#      the status writer classifies from repo2-sftp-host alone, this gate keys
#      on repo2-type, and pgBackRest ignores the SFTP settings entirely.
printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-path=/var/lib/pgbackrest\nrepo2-sftp-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\nrepo2-retention-full=7\nrepo2-retention-archive=7\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" == *"repo2-sftp-* options are set but repo2-type is"* ]] \
  && pass "repo2-sftp-* without repo2-type=sftp is refused (preflight and status writer would disagree)" \
  || fail "a half-configured SFTP repo2 slipped past every host-key check ($OUT)"

# (10) S3 non-regression: an S3 repo2 must NOT be dragged into SFTP-only checks.
printf '[global]\nrepo1-path=/var/lib/pgbackrest\nrepo1-cipher-type=aes-256-cbc\nrepo1-cipher-pass=%s\nrepo2-type=s3\nrepo2-s3-endpoint=s3.example.tr\nrepo2-cipher-type=aes-256-cbc\nrepo2-cipher-pass=%s-distinct\nrepo2-retention-full=7\nrepo2-retention-archive=7\n' "$CANARY" "$CANARY" > "$PF2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$PF2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo" FAKE_ARCHIVE_MODE=off FAKE_INFO_JSON="$INFO_ONE_BACKUP" FAKE_CONFIG_FILE="$PGCONF_FILE" FAKE_DATA_DIRECTORY="$PGDATA_FAKE")
run bash "$PREFLIGHT"
[[ "$OUT" != *"sftp-host-fingerprint"* ]] && [[ "$OUT" != *"sftp-host-key-check-type"* ]] \
  && pass "an S3 repo2 is not subjected to the SFTP host-key checks" \
  || fail "S3 repo2 wrongly required SFTP host-key settings ($OUT)"
unset _SFTP_BASE _FP_OK

# (11) ACTIVE operator guidance must not authorize a SHA-1 ssh-rsa fallback.
#
#      The program contract accepted for the first customer is MODERN SSH ONLY,
#      with an explicit stop rule. Before F4-FCR-004-R1 the template and the
#      runbook told the operator the endpoint's sshd "may need" / "must
#      re-enable" `PubkeyAcceptedAlgorithms +ssh-rsa` and to verify at
#      CHECKPOINT 5 -- i.e. they published the weakening as an available
#      workaround. Mentioning ssh-rsa is still legitimate (the prohibition and
#      the historical observation both have to name it), so this asserts on the
#      AUTHORIZING VERB rather than on the token, and pairs it with a positive
#      assertion so deleting the stop rule fails too.
RUNBOOK_F4="$SCRIPT_DIR/../docs/program/runbooks/F4_RECOVERY_OPERATIONS.md"
GATE0_TOPO="$SCRIPT_DIR/../scripts/noramedi-gate0-repo2-topology.sh"
_AUTHZ_RE='may need|must re-enable|must set|must add|should add|should set|need to add|will need'
for _gf in "$CONF_EXAMPLE" "$RUNBOOK_F4"; do
  _gname="$(basename "$_gf")"
  _ghits="$(grep -nE 'ssh-rsa|PubkeyAcceptedAlgorithms|HostkeyAlgorithms' "$_gf" 2>/dev/null \
            | grep -EI "$_AUTHZ_RE" || true)"
  [[ -z "$_ghits" ]] \
    && pass "${_gname} does not authorize a SHA-1 ssh-rsa fallback in active guidance" \
    || fail "${_gname} publishes SHA-1 ssh-rsa re-enablement as an available workaround: ${_ghits}"
done
for _gf in "$CONF_EXAMPLE" "$RUNBOOK_F4"; do
  _gname="$(basename "$_gf")"
  grep -q 'MODERN SSH AUTH CANNOT BE NEGOTIATED' "$_gf" \
    && pass "${_gname} publishes the explicit modern-SSH stop condition" \
    || fail "${_gname} lost the 'MODERN SSH AUTH CANNOT BE NEGOTIATED => NO-GO' stop rule"
  grep -qi 'PROHIBITED FOR FIRST-CUSTOMER ACTIVATION' "$_gf" \
    && pass "${_gname} labels SHA-1 re-enablement PROHIBITED for first-customer activation" \
    || fail "${_gname} lost the PROHIBITED-for-first-customer label"
done
# The Gate 0 harness genuinely does weaken its throwaway container's sshd. That
# is allowed, but it must never read as sanctioned for a real endpoint.
grep -q 'PROHIBITED FOR FIRST-CUSTOMER ACTIVATION' "$GATE0_TOPO" \
  && pass "the Gate 0 topology harness labels its ssh-rsa scaffolding PROHIBITED for real endpoints" \
  || fail "the Gate 0 harness re-enables SHA-1 with no PROHIBITED label — it reads as sanctioned"
# The template must publish the accepted contract, not just forbid the bad one.
grep -q '^;   repo2-sftp-host-key-check-type=fingerprint' "$CONF_EXAMPLE" \
  && pass "pgbackrest.conf.example publishes repo2-sftp-host-key-check-type=fingerprint in the SFTP shape" \
  || fail "the SFTP template shape does not publish the required check type"
unset _AUTHZ_RE _ghits _gf _gname

rm -f "$FAKEBIN/id"

# ════════════════════════════════════════════════════════════════════════
section "Backup wrapper: encryption is enforced on the WRITE path, not only in preflight"
# "Encryption is REQUIRED before any byte leaves this host" is the one
# prohibition this program states absolutely, and until now only preflight
# enforced it — a separate operator step ordered by prose in runbook §16.5,
# not a gate. `--repo 2` invoked without it wrote a physical copy of every
# table, including special-category health data under KVKK Art. 6, in
# plaintext to infrastructure this program does not operate. The status
# writer's REPO2_PLAINTEXT verdict lands only AFTER the bytes are gone.
CONF_PLAIN2="$WORK/pgbackrest-plain2.conf"
printf '[global]\nrepo1-path=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=none\n' "$WORK/repo" > "$CONF_PLAIN2"
# --dry-run because the wrapper requires root before any config check; dry-run
# is the only path that reaches the gate unprivileged. It is also the stronger
# assertion: the gate must fire BEFORE the command is composed, so not even a
# "would run" line may be printed for a plaintext off-host repository.
: > "$WORK/pgbackrest.log"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_PLAIN2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo")
run bash "$BACKUP" --repo 2 --type full --dry-run
[[ "$CODE" -eq 3 ]] \
  && pass "a plaintext repo2 backup exits 3 (precondition) instead of shipping cleartext PHI" \
  || fail "expected exit 3 for a plaintext repo2, got $CODE ($OUT)"
[[ "$OUT" == *"pgBackRest was NOT invoked"* ]] \
  && pass "the refusal states that nothing was invoked, so the operator knows no byte left" \
  || fail "the plaintext refusal does not say whether data moved ($OUT)"
[[ "$OUT" != *"would run"* ]] \
  && pass "the gate fires before the pgbackrest command is composed, not after" \
  || fail "a plaintext repo2 still reached command construction ($OUT)"
[[ ! -s "$WORK/pgbackrest.log" ]] \
  && pass "no pgbackrest invocation was recorded for the refused plaintext repo2" \
  || fail "pgbackrest ran despite the plaintext refusal ($(cat "$WORK/pgbackrest.log"))"

CONF_ENC2="$WORK/pgbackrest-enc2.conf"
printf '[global]\nrepo1-path=%s\nrepo2-host=backup.example.tr\nrepo2-cipher-type=aes-256-cbc\n' "$WORK/repo" > "$CONF_ENC2"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_ENC2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo")
run bash "$BACKUP" --repo 2 --type full --dry-run
[[ "$CODE" -eq 0 ]] \
  && pass "an encrypted repo2 is not blocked by the new gate" \
  || fail "the cipher gate rejected a correctly encrypted repo2, got $CODE ($OUT)"

# The default production path must be untouched: repo1 has never carried a
# cipher requirement in this wrapper and acquiring one here would break every
# host running today.
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF_PLAIN2" NORAMEDI_PGBACKREST_REPO_PATH="$WORK/repo")
run bash "$BACKUP" --type full --dry-run
[[ "$CODE" -eq 0 ]] \
  && pass "the repo1 path is byte-for-byte unaffected by the repo2 cipher gate" \
  || fail "the cipher gate leaked onto the default repo1 path, got $CODE ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "Restore drill (behaviour): PITR marker CLI validation fails closed"
# These all abort during argument validation, before any precondition and long
# before anything is restored — so they are safe to run with no fake cluster.
EXTRA_ENV=(); run bash "$DRILL" --pitr-run-id F4-FCR-002A-20260815-01
[[ "$CODE" -eq 2 ]] && pass "--pitr-run-id without --target exits 2 (verification without a target is meaningless)" || fail "expected exit 2, got $CODE ($OUT)"

EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26+00' --pitr-run-id 'bad id; DROP'
[[ "$CODE" -eq 2 ]] && pass "a run id outside [A-Za-z0-9._-] exits 2 (it is interpolated into SQL)" || fail "expected exit 2, got $CODE ($OUT)"

EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26+00' --pitr-run-id ok --marker-seg 'not-a-segment'
[[ "$CODE" -eq 2 ]] && pass "a malformed WAL segment name exits 2" || fail "expected exit 2, got $CODE ($OUT)"

EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26+00' --pitr-run-id ok --marker-b-at 'yesterday'
[[ "$CODE" -eq 2 ]] && pass "a malformed marker-B timestamp exits 2" || fail "expected exit 2, got $CODE ($OUT)"

# A bare target is resolved in the DRILL cluster's timezone while the markers it
# is compared against were written in production's. The run does not error — it
# stops in the wrong place. Rejected at parse time for verified runs only.
EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26' --pitr-run-id F4-FCR-002A-20260815-01
[[ "$CODE" -eq 2 ]] && pass "a --target with no UTC offset exits 2 when verification is requested" || fail "expected exit 2, got $CODE ($OUT)"
[[ "$OUT" == *"explicit UTC offset"* ]] && pass "the offset refusal says what is wrong and shows the expected shape" || fail "unhelpful offset error ($OUT)"

# The same run WITHOUT --pitr-run-id must still be allowed: an unverified triage
# restore is legitimate, it simply claims no R-031/R-032 evidence. If the offset
# rule leaked into the general path it would break ordinary recovery work.
EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26'
[[ "$OUT" != *"explicit UTC offset"* ]] && pass "a bare target is still permitted for an unverified triage restore" || fail "the offset requirement leaked outside verified runs ($OUT)"

# The marker procedure derives the target as the midpoint of two createdAt
# values, so fractional seconds are the normal case, not an edge case — the
# first real run produced 12:59:26.405500+00. An argument validator that
# rejected it would have failed the drill before pgbackrest was ever called.
# NORAMEDI_PITR_MARKER_ORG is now mandatory alongside --pitr-run-id (see the
# section below), so it is supplied here to keep this assertion about --target
# parsing rather than about the sentinel.
EXTRA_ENV=(NORAMEDI_PITR_MARKER_ORG=__noramedi_pitr_drill__); run bash "$DRILL" --target '2026-08-15 12:59:26.405500+00' --pitr-run-id F4-FCR-002A-20260815-01
[[ "$CODE" -ne 2 ]] && pass "a fractional-second target with an explicit offset is accepted" || fail "the real derived target was rejected at argument validation ($OUT)"
[[ "$OUT" != *"Invalid --target"* ]] && pass "no spurious --target rejection for microsecond precision" || fail "microseconds are rejected ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "Restore drill: the marker sentinel must be stated on a verified run"
# The marker WRITER is an operator-side program that is not in this repository,
# so the two agree on this literal only by convention. When they diverged, the
# drill queried __noramedi_pitr_drill__ while the markers had been written
# under noramedi-f4-pitr-sentinel; that reads as marker A = 0, which the drill
# reports as an undershoot. A full restore was spent before anyone suspected a
# name mismatch. Runbook §21.7 prescribed exactly this fix.
EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26.405500+00' --pitr-run-id F4-FCR-002A-20260815-01
[[ "$CODE" -eq 2 ]] \
  && pass "--pitr-run-id without NORAMEDI_PITR_MARKER_ORG exits 2 instead of silently defaulting" \
  || fail "expected exit 2 for an unstated sentinel, got $CODE ($OUT)"
[[ "$OUT" == *"NORAMEDI_PITR_MARKER_ORG"* ]] && [[ "$OUT" == *"marker A=0"* ]] \
  && pass "the refusal names the variable AND the false undershoot it prevents" \
  || fail "the sentinel refusal is not self-explaining ($OUT)"

# The default must survive for unverified triage restores, which read no marker
# at all. If the requirement leaked onto the general path it would break
# ordinary recovery work during an incident.
EXTRA_ENV=(); run bash "$DRILL" --target '2026-08-15 12:59:26'
[[ "$OUT" != *"NORAMEDI_PITR_MARKER_ORG"* ]] \
  && pass "an unverified triage restore still runs without the sentinel" \
  || fail "the sentinel requirement leaked outside verified runs ($OUT)"

# ════════════════════════════════════════════════════════════════════════
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]] || exit 1

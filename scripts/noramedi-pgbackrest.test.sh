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
  *"SHOW data_directory"*)  echo "${FAKE_DATA_DIRECTORY:-/var/lib/postgresql/16/main}" ;;
  *"SHOW config_file"*)     echo "${FAKE_CONFIG_FILE:-/etc/postgresql/16/main/postgresql.conf}" ;;
  *"SHOW include_dir"*)     echo "${FAKE_INCLUDE_DIR:-}" ;;
  *"SHOW server_version"*)  echo "${FAKE_SERVER_VERSION:-16.14}" ;;
  *pg_stat_archiver*)       echo "${FAKE_ARCHIVER_ROW:-|||}" ;;
  *) echo "" ;;
esac
exit 0
EOF
  chmod +x "$FAKEBIN/psql"
}

# pgbackrest fake: `version`, `info --output=json`, `check`.
write_fake_pgbackrest() {
  cat > "$FAKEBIN/pgbackrest" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    version) echo "pgBackRest ${FAKE_PGBR_VERSION:-2.54.2}"; exit 0 ;;
  esac
done
case "$*" in
  *info*) printf '%s' "${FAKE_INFO_JSON:-[]}"; exit "${FAKE_INFO_RC:-0}" ;;
  *check*) exit "${FAKE_CHECK_RC:-0}" ;;
  *help*) echo "zst lz4 gz none"; exit 0 ;;
esac
exit 0
EOF
  chmod +x "$FAKEBIN/pgbackrest"
}

# df fake: -Pm output with a controllable free-MB figure.
write_fake_df() {
  cat > "$FAKEBIN/df" <<'EOF'
#!/usr/bin/env bash
echo "Filesystem 1M-blocks Used Available Use% Mounted on"
echo "/dev/fake 76000 7600 ${FAKE_FREE_MB:-65000} 11% /"
EOF
  chmod +x "$FAKEBIN/df"
}

write_fake_runuser
write_fake_psql
write_fake_pgbackrest
write_fake_df

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
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s13" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "yes" ]] && pass "a fresh restore proof from repo2 upgrades offHost to 'yes'" || fail "expected yes with a valid proof ($OUT)"

# 8. A proof from repo1 must NOT count — the local repo is not independent.
printf '{"schemaVersion":1,"result":"passed","repo":1,"stanza":"noramedi","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s14" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a restore proof from repo1 does NOT prove off-host recoverability" || fail "expected unproven for a repo1 proof ($OUT)"

# 9. A stale proof must not keep claiming success forever.
printf '{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u -d '-100 days' '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s15" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a 100-day-old restore proof expires back to 'unproven'" || fail "expected unproven for a stale proof ($OUT)"

# 10. A FAILED drill must never count as proof.
printf '{"schemaVersion":1,"result":"failed","repo":2,"stanza":"noramedi","runId":"t","finishedAt":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$PROOF"
EXTRA_ENV=(NORAMEDI_PGBACKREST_CONF="$CONF5" NORAMEDI_PGBACKREST_STATE_DIR="$WORK/s16" NORAMEDI_PGBACKREST_OFFHOST_PROOF="$PROOF" FAKE_ARCHIVE_MODE=on FAKE_INFO_JSON="$INFO_ONE_BACKUP")
run bash "$STATUS" --stdout --no-check
[[ "$(offhost_of "$OUT")" == "unproven" ]] && pass "a FAILED restore drill is not proof" || fail "expected unproven for a failed drill ($OUT)"

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
section "Backup wrapper: disk-exhaustion abort"
# Required explicitly by the drafted freeze exception. An alert notifies
# someone after the fact; an abort refuses to make it worse.
mkdir -p "$WORK/repo"
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
grep -q '127.0.0.1' "$DRILL" && pass "binds loopback only" || fail "no loopback binding"
grep -q 'listen_addresses' "$DRILL" && pass "verifies the bound address at runtime, not just in config" || fail "no runtime bind verification"
grep -q 'REHEARSAL_OS_USER' "$DRILL" && pass "requires an explicit unprivileged OS user" || fail "no privilege delegation"

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
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]] || exit 1

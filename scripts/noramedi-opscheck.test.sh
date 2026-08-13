#!/usr/bin/env bash
# noramedi-opscheck.test.sh — F3-OBS-002
#
# Unit-like test harness for scripts/noramedi-opscheck.sh. No real pm2/df/
# curl/production paths are touched: a temp bin directory with fake `pm2`,
# `df`, and `curl` executables is prepended to PATH, and BACKUP_DIR/
# DISK_PATH/STATE_DIR are redirected into a temp directory via the script's
# documented test-only override env vars.
#
# Run with: bash scripts/noramedi-opscheck.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPSCHECK="$SCRIPT_DIR/noramedi-opscheck.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAKEBIN="$WORK/bin"
mkdir -p "$FAKEBIN"

PASSED=0
FAILED=0

pass() { echo "  ok - $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL - $1"; FAILED=$((FAILED + 1)); }

section() { echo; echo "$1"; }

# ── fake command factories ──────────────────────────────────────────────

# write_fake_pm2 JSON — controls what `pm2 jlist` prints.
write_fake_pm2() {
  cat > "$FAKEBIN/pm2" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "jlist" ]]; then
  cat <<'JLIST'
$1
JLIST
else
  exit 1
fi
EOF
  chmod +x "$FAKEBIN/pm2"
}

pm2_jlist_json() {
  # $1=api_status $2=worker_status $3=api_restarts $4=worker_restarts
  cat <<EOF
[
  {"name":"noramedi-api","pm2_env":{"status":"$1","restart_time":$3}},
  {"name":"noramedi-worker","pm2_env":{"status":"$2","restart_time":$4}}
]
EOF
}

# write_fake_df PERCENT — controls `df -P` output.
write_fake_df() {
  cat > "$FAKEBIN/df" <<EOF
#!/usr/bin/env bash
echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"
echo "/dev/sda1        10000000   1000000   9000000       ${1}% /"
EOF
  chmod +x "$FAKEBIN/df"
}

# write_fake_curl EXIT_CODE LOGFILE — controls curl's exit code and logs argv
# (never asserted to be secret-free itself — that's expected, curl needs the
# real URL to do its job; what's asserted secret-free is the SCRIPT's own
# stdout/stderr, captured separately by each test).
write_fake_curl() {
  local exit_code="$1" logfile="$2"
  cat > "$FAKEBIN/curl" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "$logfile"
exit $exit_code
EOF
  chmod +x "$FAKEBIN/curl"
}

# run_opscheck ARGS... — invokes the real script with fakes on PATH, a
# redirected backup/state dir, and whatever NAME=VALUE strings are currently
# in the EXTRA_ENV array (set by the caller before invoking). Captures
# stdout+stderr and exit code into globals OUT and CODE.
#
# Uses the external `env` command rather than bash's own leading
# `VAR=val command` assignment syntax: bash only recognizes that syntax for
# LITERAL NAME=VALUE tokens written directly in the command line — an
# NAME=VALUE string arriving via "${ARRAY[@]}" expansion is just an ordinary
# argument to bash's parser (confirmed: `A=(FOO=bar); "${A[@]}" echo hi`
# fails with "FOO=bar: command not found"), so this harness's env values
# (built dynamically per-scenario into an array) would never actually reach
# the script's environment that way. `env` has no such restriction — it
# inspects each of its own argv strings for a literal `=` regardless of
# where that string came from, so `env "${EXTRA_ENV[@]}" "$OPSCHECK" "$@"`
# correctly applies every array-expanded assignment and then executes
# $OPSCHECK with "$@" as ITS arguments (env stops treating argv as
# assignments at the first token without `=`, which is $OPSCHECK itself —
# critically, $OPSCHECK must be the specific token placed there, never mixed
# in ahead of the assignments, or env would try to "execute" e.g. `--check`
# as a program name instead).
EXTRA_ENV=()

run_opscheck() {
  set +e
  OUT="$(PATH="$FAKEBIN:$PATH" \
    NORAMEDI_OPSCHECK_DISK_PATH="/" \
    NORAMEDI_OPSCHECK_BACKUP_DIR="$BACKUP_DIR" \
    NORAMEDI_OPSCHECK_STATE_DIR="$STATE_DIR" \
    env "${EXTRA_ENV[@]}" "$OPSCHECK" "$@" 2>&1)"
  CODE=$?
  set -e
  EXTRA_ENV=()
}

new_scenario_dirs() {
  BACKUP_DIR="$(mktemp -d "$WORK/backup.XXXXXX")"
  STATE_DIR="$(mktemp -d "$WORK/state.XXXXXX")"
}

touch_backup_file() {
  # $1 = filename, $2 = age in hours (mtime set relative to now). Uses an
  # absolute Unix epoch with `touch -d @epoch`, not `touch -t YYYYMMDDhhmm`
  # — `touch -t` interprets its timestamp argument in LOCAL time, so
  # feeding it a `date -u`-computed string silently skews the resulting
  # mtime by the host's UTC offset (caught by the exact-boundary test:
  # a "-30 hours" file measured as 32h old on a UTC+2 host). `@epoch` has
  # no timezone to get wrong.
  local f="$BACKUP_DIR/$1"
  touch "$f"
  local epoch
  epoch="$(date -u -d "-$2 hours" +%s 2>/dev/null || date -u -v-"$2"H +%s)"
  touch -d "@$epoch" "$f"
}

# touch_backup_file_future FILENAME HOURS_AHEAD — same as touch_backup_file
# but sets an mtime in the FUTURE (clock skew / bad `touch` / a replayed
# file), to exercise check_backup()'s future-timestamp guard.
touch_backup_file_future() {
  local f="$BACKUP_DIR/$1"
  touch "$f"
  local epoch
  epoch="$(date -u -d "+$2 hours" +%s 2>/dev/null || date -u -v+"$2"H +%s)"
  touch -d "@$epoch" "$f"
}

# ── bash -n syntax check ────────────────────────────────────────────────
section "Syntax"
if bash -n "$OPSCHECK"; then pass "noramedi-opscheck.sh parses (bash -n)"; else fail "noramedi-opscheck.sh has a syntax error"; fi

# ── scenario: fully healthy ─────────────────────────────────────────────
section "Fully healthy"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 3 3)"
write_fake_df 42
write_fake_curl 0 "$WORK/curl.log"
touch_backup_file "noramedi_crm-20260101-030000.dump" 1
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/PM2SECRET
  NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/DISKSECRET
  NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/BACKUPSECRET
)
run_opscheck

[[ "$CODE" -eq 0 ]] && pass "exit code 0 when everything healthy" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"pm2 check: 'noramedi-api' online"* ]] && pass "reports api online" || fail "missing api-online line"
[[ "$OUT" == *"disk check: OK"* ]] && pass "reports disk OK" || fail "missing disk-OK line"
[[ "$OUT" == *"backup check: OK"* ]] && pass "reports backup OK" || fail "missing backup-OK line"

# ── scenario: api offline ───────────────────────────────────────────────
section "API process offline"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json stopped online 1 1)"
write_fake_df 42
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
touch_backup_file "noramedi_crm-20260101-030000.dump" 1
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2

[[ "$((CODE & 1))" -eq 1 ]] && pass "pm2 bit (1) set when api offline" || fail "expected bit 1 set, got $CODE ($OUT)"
[[ "$OUT" == *"'noramedi-api' status='stopped'"* ]] && pass "names the offline process" || fail "missing offline-process detail ($OUT)"
grep -q '/s/fail$' "$WORK/curl.log" && pass "a local-check failure pings the '/fail' suffixed URL (dead-man's-switch fail signal)" || fail "expected curl to be called with the /fail URL on local failure ($(cat "$WORK/curl.log"))"

# ── scenario: worker offline ────────────────────────────────────────────
section "Worker process offline"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online errored 1 9)"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2
[[ "$((CODE & 1))" -eq 1 ]] && pass "pm2 bit (1) set when worker offline" || fail "expected bit 1 set, got $CODE ($OUT)"

# ── scenario: disk over threshold ───────────────────────────────────────
section "Disk over threshold"
new_scenario_dirs
write_fake_df 95
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=90)
run_opscheck --check disk
[[ "$((CODE & 2))" -eq 2 ]] && pass "disk bit (2) set at 95% with threshold 90%" || fail "expected bit 2 set, got $CODE ($OUT)"

section "Disk under threshold"
new_scenario_dirs
write_fake_df 50
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=90)
run_opscheck --check disk
[[ "$((CODE & 2))" -eq 0 ]] && pass "disk bit clear at 50% with threshold 90%" || fail "expected bit 2 clear, got $CODE ($OUT)"

section "Disk exactly at threshold boundary"
new_scenario_dirs
write_fake_df 90
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=90)
run_opscheck --check disk
[[ "$((CODE & 2))" -eq 2 ]] && pass "disk bit (2) set at exactly 90% with threshold 90% (>= is inclusive)" || fail "expected bit 2 set at boundary, got $CODE ($OUT)"

new_scenario_dirs
write_fake_df 89
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=90)
run_opscheck --check disk
[[ "$((CODE & 2))" -eq 0 ]] && pass "disk bit clear one point under the boundary (89% vs threshold 90%)" || fail "expected bit 2 clear just under boundary, got $CODE ($OUT)"

section "Invalid disk threshold config fails closed"
new_scenario_dirs
write_fake_df 10
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=not-a-number)
run_opscheck --check disk
[[ "$CODE" -ne 0 ]] && pass "non-numeric DISK_THRESHOLD_PERCENT is rejected (nonzero exit), not silently treated as healthy" || fail "expected nonzero exit for invalid threshold, got $CODE ($OUT)"
[[ "$OUT" == *"FATAL"* ]] && pass "invalid threshold reports FATAL, not a false pass" || fail "missing FATAL message for invalid threshold ($OUT)"
[[ "$CODE" -eq 16 ]] && pass "invalid threshold exits with the dedicated config-error code 16, not the pm2-bit-colliding 1" || fail "expected exit 16 for invalid threshold, got $CODE ($OUT)"

new_scenario_dirs
write_fake_df 10
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=150)
run_opscheck --check disk
[[ "$CODE" -ne 0 ]] && pass "out-of-range DISK_THRESHOLD_PERCENT (150) is rejected" || fail "expected nonzero exit for out-of-range threshold, got $CODE ($OUT)"
[[ "$CODE" -eq 16 ]] && pass "out-of-range threshold also exits 16, not the pm2-bit-colliding 1" || fail "expected exit 16 for out-of-range threshold, got $CODE ($OUT)"

# ── scenario: exit-code contract — config/CLI errors vs. the check bitmask ─
section "Exit-code contract: config/CLI errors use 16, never collide with bitmask bits 0-3"
new_scenario_dirs
EXTRA_ENV=()
run_opscheck --bogus-flag
[[ "$CODE" -eq 16 ]] && pass "unknown CLI flag exits 16" || fail "expected exit 16 for unknown flag, got $CODE ($OUT)"

new_scenario_dirs
EXTRA_ENV=()
run_opscheck --check bogus-check-name
[[ "$CODE" -eq 16 ]] && pass "unrecognized --check value exits 16" || fail "expected exit 16 for unrecognized --check value, got $CODE ($OUT)"

new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json stopped online 1 1)"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2
[[ "$CODE" -eq 1 ]] && pass "a genuine pm2-check failure still exits with bit 0 (1), distinct from the 16 config-error code" || fail "expected exit 1 (pm2 bit only) for a real pm2 failure, got $CODE ($OUT)"

# ── scenario: backup stale ──────────────────────────────────────────────
section "Backup stale"
new_scenario_dirs
touch_backup_file "noramedi_crm-20260101-030000.dump" 48
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/s NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS=30)
run_opscheck --check backup
[[ "$((CODE & 4))" -eq 4 ]] && pass "backup bit (4) set when newest file is 48h old (max 30h)" || fail "expected bit 4 set, got $CODE ($OUT)"

section "Backup exactly at max-age boundary (not stale — strictly-greater-than semantics)"
new_scenario_dirs
touch_backup_file "noramedi_crm-20260101-030000.dump" 30
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/s NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS=30)
run_opscheck --check backup
[[ "$((CODE & 4))" -eq 0 ]] && pass "backup bit clear at exactly 30h old with max 30h (age > max, not >=)" || fail "expected bit 4 clear at boundary, got $CODE ($OUT)"

section "Backup mtime in the future (clock skew fails closed, not silently healthy)"
new_scenario_dirs
touch_backup_file_future "noramedi_crm-20260101-030000.dump" 5
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
SECRET="hcuuid-future-mtime-do-not-print-this-token"
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL="http://hc-ping.example/$SECRET" NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS=30)
run_opscheck --check backup

[[ "$((CODE & 4))" -eq 4 ]] && pass "backup bit (4) set when newest backup mtime is in the future" || fail "expected bit 4 set for future mtime, got $CODE ($OUT)"
[[ "$OUT" == *"backup check: FAIL"*"future"* ]] && pass "reports a FAIL diagnostic naming the future-timestamp condition" || fail "missing future-timestamp FAIL diagnostic ($OUT)"
grep -q '/hc-ping.example/'"$SECRET"'/fail$' "$WORK/curl.log" && pass "future-mtime local failure pings the '/fail' suffixed URL" || fail "expected curl to be called with the /fail URL on future-mtime failure ($(cat "$WORK/curl.log"))"
[[ "$OUT" != *"$SECRET"* ]] && pass "future-mtime failure path never echoes the ping-URL secret token" || fail "SECRET LEAK: ping URL token appeared in script output on future-mtime failure"

section "Invalid backup max-age config fails closed"
new_scenario_dirs
touch_backup_file "noramedi_crm-20260101-030000.dump" 1
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/s NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS=not-a-number)
run_opscheck --check backup
[[ "$CODE" -ne 0 ]] && pass "non-numeric BACKUP_MAX_AGE_HOURS is rejected (nonzero exit), not silently treated as healthy" || fail "expected nonzero exit for invalid max-age, got $CODE ($OUT)"
[[ "$OUT" == *"FATAL"* ]] && pass "invalid max-age reports FATAL, not a false pass" || fail "missing FATAL message for invalid max-age ($OUT)"
[[ "$CODE" -eq 16 ]] && pass "invalid max-age also exits 16, not the pm2-bit-colliding 1" || fail "expected exit 16 for invalid max-age, got $CODE ($OUT)"

# ── scenario: backup dir missing entirely ───────────────────────────────
section "Backup directory missing"
new_scenario_dirs
rm -rf "$BACKUP_DIR"
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/s)
run_opscheck --check backup
[[ "$((CODE & 4))" -eq 4 ]] && pass "backup bit (4) set when backup dir does not exist (fail closed)" || fail "expected bit 4 set, got $CODE ($OUT)"

# ── scenario: backup dir has no matching file ───────────────────────────
section "Backup directory has no matching file"
new_scenario_dirs
touch "$BACKUP_DIR/not-a-backup.txt"
EXTRA_ENV=(NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/s)
run_opscheck --check backup
[[ "$((CODE & 4))" -eq 4 ]] && pass "backup bit (4) set when no file matches the backup filename pattern" || fail "expected bit 4 set, got $CODE ($OUT)"

# ── scenario: ping/curl transport failure ───────────────────────────────
section "Ping transport failure (local checks otherwise healthy)"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
write_fake_curl 7 "$WORK/curl.log"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2
[[ "$((CODE & 8))" -eq 8 ]] && pass "ping bit (8) set when curl fails" || fail "expected bit 8 set, got $CODE ($OUT)"
[[ "$((CODE & 1))" -eq 0 ]] && pass "pm2 bit stays clear — ping failure is separate from local-check failure" || fail "pm2 bit incorrectly set on ping-only failure ($OUT)"

# ── scenario: missing ping URL entirely ─────────────────────────────────
section "Ping URL not configured"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=()
run_opscheck --check pm2
[[ "$((CODE & 8))" -eq 8 ]] && pass "ping bit (8) set when ping URL env var is unset" || fail "expected bit 8 set, got $CODE ($OUT)"
[[ "$OUT" == *"no ping URL configured"* ]] && pass "explains the missing-config condition" || fail "missing explanatory message ($OUT)"

# ── scenario: dry-run never invokes curl ────────────────────────────────
section "Dry-run mode"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/PM2SECRET)
run_opscheck --dry-run --check pm2
[[ ! -s "$WORK/curl.log" ]] && pass "curl never invoked in --dry-run" || fail "curl was invoked during --dry-run"
[[ "$OUT" == *"DRY-RUN: would ping 'pm2' outcome=success"* ]] && pass "dry-run reports intended outcome" || fail "missing dry-run report line ($OUT)"

# ── scenario: suppressed ping for one check only ────────────────────────
section "Suppressed ping (drill mechanism)"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
write_fake_df 10
touch_backup_file "noramedi_crm-20260101-030000.dump" 1
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/PM2SECRET
  NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/DISKSECRET
  NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/BACKUPSECRET
  NORAMEDI_OPSCHECK_SUPPRESS_PING=disk
)
run_opscheck

lines_hitting_curl="$(wc -l < "$WORK/curl.log" | tr -d ' ')"
[[ "$lines_hitting_curl" -eq 2 ]] && pass "only the non-suppressed checks (pm2, backup) actually pinged" || fail "expected exactly 2 curl invocations, got $lines_hitting_curl"
[[ "$OUT" == *"ping suppressed for 'disk'"* ]] && pass "reports the suppression explicitly" || fail "missing suppression report line ($OUT)"
[[ "$CODE" -eq 0 ]] && pass "suppressed check still reports overall healthy (local check itself still ran and passed)" || fail "expected exit 0, got $CODE ($OUT)"

# ── scenario: no secret leakage in stdout/stderr ────────────────────────
section "No secret leakage"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json stopped online 1 1)"
write_fake_df 95
write_fake_curl 1 "$WORK/curl.log"
touch_backup_file "noramedi_crm-20260101-030000.dump" 999
SECRET="hcuuid-4f9a2b7e-do-not-print-this-token"
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_DISK_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_BACKUP_PING_URL="http://hc-ping.example/$SECRET"
)
run_opscheck

if [[ "$OUT" != *"$SECRET"* ]]; then
  pass "script stdout/stderr never contains the ping-URL secret token"
else
  fail "SECRET LEAK: ping URL token appeared in script output"
fi

# ── summary ──────────────────────────────────────────────────────────────
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]] || exit 1

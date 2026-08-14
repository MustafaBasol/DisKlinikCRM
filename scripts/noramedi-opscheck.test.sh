#!/usr/bin/env bash
# noramedi-opscheck.test.sh — F3-OBS-002, extended by F4-FCR-001
#
# Unit-like test harness for scripts/noramedi-opscheck.sh. No real pm2/df/
# curl/production paths are touched: a temp bin directory with fake `pm2`,
# `df`, and `curl` executables is prepended to PATH, and BACKUP_DIR/
# DISK_PATH/STATE_DIR/RECOVERY_STATUS_FILE are redirected into a temp
# directory via the script's documented override env vars.
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
    NORAMEDI_OPSCHECK_RECOVERY_STATUS_FILE="$RECOVERY_STATUS_FILE" \
    env "${EXTRA_ENV[@]}" "$OPSCHECK" "$@" 2>&1)"
  CODE=$?
  set -e
  EXTRA_ENV=()
}

new_scenario_dirs() {
  BACKUP_DIR="$(mktemp -d "$WORK/backup.XXXXXX")"
  STATE_DIR="$(mktemp -d "$WORK/state.XXXXXX")"
  # Always redirected away from the real /var/lib/noramedi path, and NOT
  # created here: "no status file at all" is the default starting state, so a
  # scenario that forgets to write one fails the filebackup/drill checks
  # rather than silently reading some other file.
  RECOVERY_STATUS_DIR="$(mktemp -d "$WORK/recovery.XXXXXX")"
  RECOVERY_STATUS_FILE="$RECOVERY_STATUS_DIR/recovery-status.json"
  reset_recovery_status_fields
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

# ── recovery status file fixtures (F4-FCR-001) ──────────────────────────
#
# The filebackup and drill checks read an application-written status file
# rather than the database (see the script header for why). These helpers
# build that file. Every field is a variable so a scenario can perturb
# exactly one thing and leave the rest healthy; reset_recovery_status_fields
# (called by new_scenario_dirs) restores the all-healthy baseline so a
# perturbation can never leak into the next scenario.

# iso_age HOURS — ISO-8601 UTC timestamp HOURS in the past. A NEGATIVE value
# yields a FUTURE timestamp (the clock-skew cases). Computed from an absolute
# epoch, for the same reason touch_backup_file uses `@epoch`: any
# local-time-interpreting formatting would skew the fixture by the host's
# UTC offset and quietly move every boundary case.
iso_age() {
  local h="$1" now epoch
  now="$(date -u +%s)"
  epoch=$(( now - h * 3600 ))
  date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$epoch" +%Y-%m-%dT%H:%M:%SZ
}

reset_recovery_status_fields() {
  RS_SCHEMA_VERSION=1
  RS_GENERATED_AGE_H=1
  RS_FB_AGE_H=2
  RS_FB_STATUS=completed
  RS_FB_FAILED=0
  RS_FB_MISSING=0
  RS_FB_ENABLED=true
  RS_FB_OFFHOST=true
  RS_DRILL_AGE_H=48
  RS_DRILL_STATUS=passed
}

# write_recovery_status — writes the status file from the current RS_* values.
write_recovery_status() {
  cat > "$RECOVERY_STATUS_FILE" <<EOF
{
  "schemaVersion": $RS_SCHEMA_VERSION,
  "generatedAt": "$(iso_age "$RS_GENERATED_AGE_H")",
  "fileBackup": { "lastRunAt": "$(iso_age "$RS_FB_AGE_H")", "status": "$RS_FB_STATUS", "filesFailed": $RS_FB_FAILED, "filesMissing": $RS_FB_MISSING, "enabled": $RS_FB_ENABLED, "destinationOffHost": $RS_FB_OFFHOST },
  "drill":      { "lastRunAt": "$(iso_age "$RS_DRILL_AGE_H")", "kind": "file_restore_rehearsal", "status": "$RS_DRILL_STATUS" }
}
EOF
}

# write_raw_recovery_status CONTENT — writes arbitrary bytes, for the
# malformed/unparseable cases the structured writer above cannot express.
write_raw_recovery_status() {
  printf '%s' "$1" > "$RECOVERY_STATUS_FILE"
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
write_recovery_status
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/PM2SECRET
  NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/DISKSECRET
  NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/BACKUPSECRET
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
)
run_opscheck

[[ "$CODE" -eq 0 ]] && pass "exit code 0 when everything healthy" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"pm2 check: 'noramedi-api' online"* ]] && pass "reports api online" || fail "missing api-online line"
[[ "$OUT" == *"disk check: OK"* ]] && pass "reports disk OK" || fail "missing disk-OK line"
[[ "$OUT" == *"backup check: OK"* ]] && pass "reports backup OK" || fail "missing backup-OK line"
[[ "$OUT" == *"filebackup check: OK"* ]] && pass "reports filebackup OK" || fail "missing filebackup-OK line ($OUT)"
[[ "$OUT" == *"drill check: OK"* ]] && pass "reports drill OK" || fail "missing drill-OK line ($OUT)"
[[ "$OUT" == *"checks=[pm2 disk backup filebackup drill]"* ]] && pass "all five checks run by default" || fail "default check list is not the expected five ($OUT)"

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
[[ "$CODE" -eq 64 ]] && pass "invalid threshold exits with the dedicated config-error code 64, not the pm2-bit-colliding 1" || fail "expected exit 64 for invalid threshold, got $CODE ($OUT)"

new_scenario_dirs
write_fake_df 10
EXTRA_ENV=(NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/s NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT=150)
run_opscheck --check disk
[[ "$CODE" -ne 0 ]] && pass "out-of-range DISK_THRESHOLD_PERCENT (150) is rejected" || fail "expected nonzero exit for out-of-range threshold, got $CODE ($OUT)"
[[ "$CODE" -eq 64 ]] && pass "out-of-range threshold also exits 64, not the pm2-bit-colliding 1" || fail "expected exit 64 for out-of-range threshold, got $CODE ($OUT)"

# ── scenario: exit-code contract — config/CLI errors vs. the check bitmask ─
section "Exit-code contract: config/CLI errors use 64, never collide with bitmask bits 0-5"
new_scenario_dirs
EXTRA_ENV=()
run_opscheck --bogus-flag
[[ "$CODE" -eq 64 ]] && pass "unknown CLI flag exits 64" || fail "expected exit 64 for unknown flag, got $CODE ($OUT)"

new_scenario_dirs
EXTRA_ENV=()
run_opscheck --check bogus-check-name
[[ "$CODE" -eq 64 ]] && pass "unrecognized --check value exits 64" || fail "expected exit 64 for unrecognized --check value, got $CODE ($OUT)"
[[ "$OUT" == *"pm2|disk|backup|filebackup|drill"* ]] && pass "the unknown --check error message lists all five valid names" || fail "unknown --check message does not list the five check names ($OUT)"

new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json stopped online 1 1)"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2
[[ "$CODE" -eq 1 ]] && pass "a genuine pm2-check failure still exits with bit 0 (1), distinct from the 64 config-error code" || fail "expected exit 1 (pm2 bit only) for a real pm2 failure, got $CODE ($OUT)"

# Each new *_MAX_AGE_HOURS value gets the same fail-closed startup validation
# as the two that predate F4-FCR-001 — an unparseable age must never fall
# through to a comparison that quietly reports "fresh".
section "Invalid recovery-status max-age config fails closed"
for bad_var in NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS \
               NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS \
               NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS; do
  new_scenario_dirs
  write_recovery_status
  EXTRA_ENV=(NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/s "${bad_var}=not-a-number")
  run_opscheck --check filebackup
  [[ "$CODE" -eq 64 ]] && pass "non-numeric $bad_var exits 64 (config error), not a false healthy" || fail "expected exit 64 for invalid $bad_var, got $CODE ($OUT)"

  new_scenario_dirs
  write_recovery_status
  EXTRA_ENV=(NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/s "${bad_var}=0")
  run_opscheck --check filebackup
  [[ "$CODE" -eq 64 ]] && pass "zero $bad_var is rejected (must be a positive integer)" || fail "expected exit 64 for ${bad_var}=0, got $CODE ($OUT)"
done

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
[[ "$CODE" -eq 64 ]] && pass "invalid max-age also exits 64, not the pm2-bit-colliding 1" || fail "expected exit 64 for invalid max-age, got $CODE ($OUT)"

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

# ── scenario: filebackup check (F4-FCR-001) ─────────────────────────────
#
# Every one of these runs ONLY the filebackup check with a working fake curl
# and a configured ping URL, so the exit code is exactly the filebackup bit
# (8) or 0 — nothing else can contaminate the assertion.

write_fake_curl 0 "$WORK/curl.log"

# run_filebackup [EXTRA_NAME=VALUE...] — filebackup check, ping configured.
run_filebackup() {
  EXTRA_ENV=(NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET "$@")
  run_opscheck --check filebackup
}

# run_drill [EXTRA_NAME=VALUE...] — drill check, ping configured.
run_drill() {
  EXTRA_ENV=(NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET "$@")
  run_opscheck --check drill
}

section "File backup healthy"
new_scenario_dirs
write_recovery_status
run_filebackup
[[ "$CODE" -eq 0 ]] && pass "exit 0 when the file-backup sweep is enabled, recent, completed and clean" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"filebackup check: OK"* ]] && pass "reports the filebackup OK line" || fail "missing filebackup-OK line ($OUT)"

section "File backup: exit-code bit is exactly 8"
new_scenario_dirs   # no status file written at all
run_filebackup
[[ "$CODE" -eq 8 ]] && pass "filebackup bit is exactly 8 (bit 3) — the F4-FCR-001 contract value" || fail "expected exit exactly 8, got $CODE ($OUT)"

section "File backup: status file missing"
new_scenario_dirs
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when the recovery status file does not exist" || fail "expected bit 8 set, got $CODE ($OUT)"
[[ "$OUT" == *"does not exist"* ]] && pass "names the missing-status-file condition" || fail "missing diagnostic for absent status file ($OUT)"

section "File backup: status file unreadable/unparseable"
new_scenario_dirs
write_raw_recovery_status "this is not json at all"
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set for a non-JSON status file" || fail "expected bit 8 set for non-JSON file, got $CODE ($OUT)"

new_scenario_dirs
write_raw_recovery_status '{ "schemaVersion": 1, "generatedAt": "2026-08-14T03:05:00Z", "fileBackup": { "lastRunAt": "2026-08-14T03:00:12Z", "status": "compl'
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set for a truncated status file (partial write)" || fail "expected bit 8 set for truncated file, got $CODE ($OUT)"

new_scenario_dirs
write_raw_recovery_status ""
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set for an empty status file" || fail "expected bit 8 set for empty file, got $CODE ($OUT)"

new_scenario_dirs
write_raw_recovery_status '{ "generatedAt": "2026-08-14T03:05:00Z", "fileBackup": { "enabled": true } }'
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when schemaVersion is absent entirely" || fail "expected bit 8 set for absent schemaVersion, got $CODE ($OUT)"

section "File backup: wrong schemaVersion"
new_scenario_dirs
RS_SCHEMA_VERSION=2
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set for schemaVersion=2 (never interpreted on a guess)" || fail "expected bit 8 set for schemaVersion=2, got $CODE ($OUT)"
[[ "$OUT" == *"schemaVersion"* ]] && pass "names schemaVersion in the diagnostic" || fail "missing schemaVersion diagnostic ($OUT)"

section "File backup disabled is itself alertable"
new_scenario_dirs
RS_FB_ENABLED=false
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when fileBackup.enabled is false" || fail "expected bit 8 set when disabled, got $CODE ($OUT)"
[[ "$OUT" == *"DISABLED"* ]] && pass "explains that attachments have no second copy" || fail "missing disabled-file-backup diagnostic ($OUT)"

section "File backup: last run did not complete"
new_scenario_dirs
RS_FB_STATUS=failed
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when fileBackup.status is 'failed'" || fail "expected bit 8 set for status=failed, got $CODE ($OUT)"

new_scenario_dirs
RS_FB_STATUS=running
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set for any status other than 'completed'" || fail "expected bit 8 set for status=running, got $CODE ($OUT)"

section "File backup: failed/missing files"
new_scenario_dirs
RS_FB_FAILED=3
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when filesFailed > 0" || fail "expected bit 8 set for filesFailed=3, got $CODE ($OUT)"

new_scenario_dirs
RS_FB_MISSING=2
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when filesMissing > 0" || fail "expected bit 8 set for filesMissing=2, got $CODE ($OUT)"

section "File backup: lastRunAt staleness"
new_scenario_dirs
RS_FB_AGE_H=40
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when lastRunAt is 40h old (max 30h)" || fail "expected bit 8 set for stale lastRunAt, got $CODE ($OUT)"

new_scenario_dirs
RS_FB_AGE_H=30
write_recovery_status
run_filebackup
[[ "$CODE" -eq 0 ]] && pass "filebackup bit clear at exactly 30h with max 30h (age > max, matching check_backup's boundary semantics)" || fail "expected exit 0 at the max-age boundary, got $CODE ($OUT)"

new_scenario_dirs
RS_FB_AGE_H=40
write_recovery_status
run_filebackup NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS=48
[[ "$CODE" -eq 0 ]] && pass "a raised NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS is honoured (40h under a 48h max)" || fail "expected exit 0 with max-age 48, got $CODE ($OUT)"

section "File backup: future-dated lastRunAt fails closed"
new_scenario_dirs
RS_FB_AGE_H=-5   # five hours in the FUTURE
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when lastRunAt is in the future (clock skew fails closed, never 'fresh')" || fail "expected bit 8 set for future lastRunAt, got $CODE ($OUT)"
[[ "$OUT" == *"future"* ]] && pass "names the future-timestamp condition" || fail "missing future-timestamp diagnostic ($OUT)"

section "File backup: destination is not in an independent failure domain (F4-FCR-001-R1)"
new_scenario_dirs
RS_FB_OFFHOST=false     # e.g. FILE_BACKUP_LOCAL_DIR on the single-disk VPS
write_recovery_status
EXTRA_ENV=(NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET)
run_opscheck --check filebackup
[[ "$CODE" -eq 8 ]] && pass "same-host destination FAILS by default — a copy on the same disk does not survive the disk loss it exists to protect against" || fail "expected exit 8 for destinationOffHost=false, got $CODE ($OUT)"
[[ "$OUT" == *"independent failure domain"* ]] && pass "diagnoses the same-host destination explicitly" || fail "missing failure-domain diagnostic ($OUT)"

new_scenario_dirs
RS_FB_OFFHOST=false
write_recovery_status
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_FILEBACKUP_REQUIRE_OFFHOST=false
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
)
run_opscheck --check filebackup
[[ "$CODE" -eq 0 ]] && pass "an explicit opt-out lets a knowingly-accepted same-host copy pass" || fail "expected exit 0 with REQUIRE_OFFHOST=false, got $CODE ($OUT)"
[[ "$OUT" == *"WARNING"* ]] && pass "the opt-out still warns rather than going silent" || fail "missing WARNING on opt-out ($OUT)"

new_scenario_dirs
write_raw_recovery_status "{ \"schemaVersion\": 1, \"generatedAt\": \"$(iso_age 1)\", \"fileBackup\": { \"lastRunAt\": \"$(iso_age 2)\", \"status\": \"completed\", \"filesFailed\": 0, \"filesMissing\": 0, \"enabled\": true }, \"drill\": { \"lastRunAt\": \"$(iso_age 48)\", \"kind\": \"file_restore_rehearsal\", \"status\": \"passed\" } }"
EXTRA_ENV=(NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET)
run_opscheck --check filebackup
[[ "$CODE" -eq 8 ]] && pass "a missing destinationOffHost field fails closed rather than being assumed off-host" || fail "expected exit 8 for a missing destinationOffHost, got $CODE ($OUT)"

section "File backup: status file itself stopped being refreshed"
new_scenario_dirs
RS_GENERATED_AGE_H=40   # writer died 40h ago; the fields inside still look healthy
write_recovery_status
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
)
run_opscheck --check filebackup --check drill
[[ "$((CODE & 8))" -eq 8 ]] && pass "filebackup bit (8) set when generatedAt is 40h old (max 30h) even though every field inside still reads healthy" || fail "expected bit 8 set for a stale generatedAt, got $CODE ($OUT)"
[[ "$OUT" == *"writer is not running"* ]] && pass "diagnoses the stale status file as a dead writer, not a backup problem" || fail "missing dead-writer diagnostic ($OUT)"
# F4-FCR-001-R1: a stale status file must fail BOTH checks (8|16 = 24), not
# just filebackup. The earlier "scoped to filebackup, no double alert"
# expectation was itself the defect: `--check drill` read drill.status and
# drill.lastRunAt straight out of a document that had not been refreshed for
# weeks, so a worker dead for 20 days kept the drill dead-man's switch GREEN.
# Two checks going DOWN is the honest outcome — when the writer is dead, both
# signals are equally untrustworthy, and a false green is far worse than a
# second email.
[[ "$CODE" -eq 24 ]] && pass "a stale status file fails BOTH checks (24) — neither signal is trustworthy once the writer is dead" || fail "expected exit exactly 24 (filebackup|drill), got $CODE ($OUT)"
[[ "$OUT" == *"drill check: FAIL"* ]] && pass "the drill check explicitly reports the dead writer rather than trusting stale contents" || fail "drill check did not fail on a stale status file ($OUT)"

new_scenario_dirs
RS_GENERATED_AGE_H=40
write_recovery_status
run_filebackup NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS=48
[[ "$CODE" -eq 0 ]] && pass "a raised NORAMEDI_OPSCHECK_RECOVERY_STATUS_MAX_AGE_HOURS is honoured" || fail "expected exit 0 with status max-age 48, got $CODE ($OUT)"

section "File backup: raw status-file content is never echoed"
new_scenario_dirs
RS_FB_STATUS="failed-0f3c1d7b-this-parsed-value-must-not-be-echoed-verbatim"
write_recovery_status
run_filebackup
[[ "$((CODE & 8))" -eq 8 ]] && pass "an unexpected status value fails the check" || fail "expected bit 8 set, got $CODE ($OUT)"
[[ "$OUT" != *"0f3c1d7b"* ]] && pass "an over-long/unexpected parsed value is rendered as a placeholder, never echoed verbatim" || fail "CONTENT LEAK: raw status-file value appeared in script output ($OUT)"

# ── scenario: drill check (F4-FCR-001) ──────────────────────────────────

section "Drill healthy"
new_scenario_dirs
write_recovery_status
run_drill
[[ "$CODE" -eq 0 ]] && pass "exit 0 when a restore rehearsal passed 48h ago (max 192h)" || fail "expected exit 0, got $CODE ($OUT)"
[[ "$OUT" == *"drill check: OK"* ]] && pass "reports the drill OK line" || fail "missing drill-OK line ($OUT)"

section "Drill: exit-code bit is exactly 16"
new_scenario_dirs   # no status file at all
run_drill
[[ "$CODE" -eq 16 ]] && pass "drill bit is exactly 16 (bit 4) — the F4-FCR-001 contract value, formerly the config-error code" || fail "expected exit exactly 16, got $CODE ($OUT)"

section "Drill: no drill object recorded"
new_scenario_dirs
write_raw_recovery_status '{ "schemaVersion": 1, "generatedAt": "2026-08-14T03:05:00Z", "fileBackup": { "lastRunAt": "2026-08-14T03:00:12Z", "status": "completed", "filesFailed": 0, "filesMissing": 0, "enabled": true, "destinationOffHost": true } }'
run_drill
[[ "$((CODE & 16))" -eq 16 ]] && pass "drill bit (16) set when no rehearsal has ever been recorded" || fail "expected bit 16 set for a missing drill object, got $CODE ($OUT)"

section "Drill: stale rehearsal"
new_scenario_dirs
RS_DRILL_AGE_H=200
write_recovery_status
run_drill
[[ "$((CODE & 16))" -eq 16 ]] && pass "drill bit (16) set when the last rehearsal was 200h ago (max 192h)" || fail "expected bit 16 set for a stale drill, got $CODE ($OUT)"

new_scenario_dirs
RS_DRILL_AGE_H=192
write_recovery_status
run_drill
[[ "$CODE" -eq 0 ]] && pass "drill bit clear at exactly 192h with max 192h (age > max, one weekly rehearsal plus margin)" || fail "expected exit 0 at the drill max-age boundary, got $CODE ($OUT)"

new_scenario_dirs
RS_DRILL_AGE_H=200
write_recovery_status
run_drill NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS=240
[[ "$CODE" -eq 0 ]] && pass "a raised NORAMEDI_OPSCHECK_DRILL_MAX_AGE_HOURS is honoured (200h under a 240h max)" || fail "expected exit 0 with drill max-age 240, got $CODE ($OUT)"

section "Drill: future-dated lastRunAt fails closed"
new_scenario_dirs
RS_DRILL_AGE_H=-5
write_recovery_status
run_drill
[[ "$((CODE & 16))" -eq 16 ]] && pass "drill bit (16) set when drill.lastRunAt is in the future" || fail "expected bit 16 set for a future drill timestamp, got $CODE ($OUT)"

section "Drill: rehearsal did not pass"
new_scenario_dirs
RS_DRILL_STATUS=failed
write_recovery_status
run_drill
[[ "$((CODE & 16))" -eq 16 ]] && pass "drill bit (16) set when drill.status is 'failed'" || fail "expected bit 16 set for status=failed, got $CODE ($OUT)"

new_scenario_dirs
RS_DRILL_STATUS=skipped
write_recovery_status
run_drill
[[ "$((CODE & 16))" -eq 16 ]] && pass "drill bit (16) set for any status other than 'passed'" || fail "expected bit 16 set for status=skipped, got $CODE ($OUT)"

section "Exit-code contract: the two new bits are independent and additive"
new_scenario_dirs
RS_FB_ENABLED=false
RS_DRILL_STATUS=failed
write_recovery_status
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
)
run_opscheck --check filebackup --check drill
[[ "$CODE" -eq 24 ]] && pass "filebackup (8) + drill (16) failing together exits 24, distinct from every other code" || fail "expected exit 24, got $CODE ($OUT)"

new_scenario_dirs
RS_DRILL_STATUS=failed
write_recovery_status
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
)
run_opscheck --check filebackup --check drill
[[ "$CODE" -eq 16 ]] && pass "a failing drill does not set the filebackup bit (the checks are independent)" || fail "expected exit exactly 16, got $CODE ($OUT)"

section "Suppressed ping for the two new checks"
new_scenario_dirs
write_recovery_status
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
  NORAMEDI_OPSCHECK_SUPPRESS_PING=filebackup,drill
)
run_opscheck --check filebackup --check drill
[[ ! -s "$WORK/curl.log" ]] && pass "NORAMEDI_OPSCHECK_SUPPRESS_PING recognizes the new check names (no curl invoked)" || fail "expected no curl invocations with both new checks suppressed ($(cat "$WORK/curl.log"))"
[[ "$OUT" == *"ping suppressed for 'filebackup'"* ]] && pass "reports filebackup suppression explicitly" || fail "missing filebackup suppression line ($OUT)"
[[ "$OUT" == *"ping suppressed for 'drill'"* ]] && pass "reports drill suppression explicitly" || fail "missing drill suppression line ($OUT)"
[[ "$CODE" -eq 0 ]] && pass "suppression does not change the local result of either new check" || fail "expected exit 0, got $CODE ($OUT)"

# ── scenario: ping/curl transport failure ───────────────────────────────
section "Ping transport failure (local checks otherwise healthy)"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
write_fake_curl 7 "$WORK/curl.log"
EXTRA_ENV=(NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/s)
run_opscheck --check pm2
[[ "$((CODE & 32))" -eq 32 ]] && pass "ping bit (32) set when curl fails" || fail "expected bit 32 set, got $CODE ($OUT)"
[[ "$CODE" -eq 32 ]] && pass "a ping-only failure exits exactly 32 (the F4-FCR-001 value; it was 8 before the filebackup bit took that value)" || fail "expected exit exactly 32 for a ping-only failure, got $CODE ($OUT)"
[[ "$((CODE & 1))" -eq 0 ]] && pass "pm2 bit stays clear — ping failure is separate from local-check failure" || fail "pm2 bit incorrectly set on ping-only failure ($OUT)"

# ── scenario: missing ping URL entirely ─────────────────────────────────
section "Ping URL not configured"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json online online 1 1)"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=()
run_opscheck --check pm2
[[ "$((CODE & 32))" -eq 32 ]] && pass "ping bit (32) set when ping URL env var is unset" || fail "expected bit 32 set, got $CODE ($OUT)"
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
write_recovery_status
: > "$WORK/curl.log"
write_fake_curl 0 "$WORK/curl.log"
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL=http://x/PM2SECRET
  NORAMEDI_OPSCHECK_DISK_PING_URL=http://x/DISKSECRET
  NORAMEDI_OPSCHECK_BACKUP_PING_URL=http://x/BACKUPSECRET
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL=http://x/FILEBACKUPSECRET
  NORAMEDI_OPSCHECK_DRILL_PING_URL=http://x/DRILLSECRET
  NORAMEDI_OPSCHECK_SUPPRESS_PING=disk
)
run_opscheck

lines_hitting_curl="$(wc -l < "$WORK/curl.log" | tr -d ' ')"
[[ "$lines_hitting_curl" -eq 4 ]] && pass "only the non-suppressed checks (pm2, backup, filebackup, drill) actually pinged" || fail "expected exactly 4 curl invocations, got $lines_hitting_curl"
[[ "$OUT" == *"ping suppressed for 'disk'"* ]] && pass "reports the suppression explicitly" || fail "missing suppression report line ($OUT)"
[[ "$CODE" -eq 0 ]] && pass "suppressed check still reports overall healthy (local check itself still ran and passed)" || fail "expected exit 0, got $CODE ($OUT)"

# ── scenario: no secret leakage in stdout/stderr ────────────────────────
section "No secret leakage"
new_scenario_dirs
write_fake_pm2 "$(pm2_jlist_json stopped online 1 1)"
write_fake_df 95
write_fake_curl 1 "$WORK/curl.log"
touch_backup_file "noramedi_crm-20260101-030000.dump" 999
# No recovery status file written: the filebackup and drill checks take their
# failure paths too, so this covers every check's failure branch at once.
SECRET="hcuuid-4f9a2b7e-do-not-print-this-token"
EXTRA_ENV=(
  NORAMEDI_OPSCHECK_PM2_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_DISK_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_BACKUP_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_FILEBACKUP_PING_URL="http://hc-ping.example/$SECRET"
  NORAMEDI_OPSCHECK_DRILL_PING_URL="http://hc-ping.example/$SECRET"
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

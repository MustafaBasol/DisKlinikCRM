#!/usr/bin/env bash
# noramedi-attachment-vps2.test.sh — F4-ATTACH-001-R1
#
# Run with: bash scripts/noramedi-attachment-vps2.test.sh
#
# Covers the three shell scripts added by F4-ATTACH-001-R1
# (noramedi-attachment-vps2-{backup,check,restore-proof}.sh). Follows the
# same precedent scripts/noramedi-pgbackrest.test.sh already established for
# exactly this gap: a `.sh` file under scripts/ is invisible to
# scripts/log-privacy-guard (which only scans server/src/{routes,services,
# jobs,middleware,utils} `.ts` files) and to the CI shell step (`bash -n`
# only), and there is no shellcheck step and no secret scanner anywhere in
# this repository. Without this file the new scripts would have NO
# automated guard at all.
#
# `restic` is faked (see write_fake_restic below) rather than requiring a
# real restic binary or a real VPS2 endpoint — this file validates the
# WRAPPER's own logic (arg parsing, locking, log-privacy discipline, status
# file shape, exit codes), not restic itself.
#
# Deliberately `set -uo pipefail` WITHOUT -e, matching
# noramedi-pgbackrest.test.sh: a failing assertion must record a failure and
# continue, not abort the run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$SCRIPT_DIR/noramedi-attachment-vps2-backup.sh"
CHECK="$SCRIPT_DIR/noramedi-attachment-vps2-check.sh"
RESTOREPROOF="$SCRIPT_DIR/noramedi-attachment-vps2-restore-proof.sh"
ALL_SCRIPTS=("$BACKUP" "$CHECK" "$RESTOREPROOF")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKEBIN="$WORK/bin"
STORE="$WORK/fake-restic-store"
mkdir -p "$FAKEBIN" "$STORE"

PASSED=0
FAILED=0
SKIPPED=0
pass() { PASSED=$((PASSED + 1)); echo "  ok - $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL - $1"; }
skip() { SKIPPED=$((SKIPPED + 1)); echo "  skip - $1"; }
section() { echo; echo "$1"; }

# flock is not available on every development host (notably: Windows
# Git-Bash/MSYS/Cygwin, where this file itself is sometimes authored/run
# from). It IS present on every CI runner this program uses (ubuntu-latest
# ships util-linux's flock). The scripts under test correctly and
# deliberately fail closed (exit 3, "flock is not available") when it is
# missing — assertions that need a real lock to exercise the SUCCESS/FAILURE
# paths are skipped (not failed) on a host without it, exactly the same
# documented precedent as the one Windows-specific skip already accepted in
# scripts/noramedi-opscheck.test.sh / the F4-FCR-003 test run (missing
# /proc/meminfo). The fail-closed behavior itself IS asserted unconditionally
# below, on every host, because it needs no lock to trigger.
HAVE_FLOCK=false
command -v flock >/dev/null 2>&1 && HAVE_FLOCK=true

# The token that must never appear in anything this test captures.
CANARY="attachvps2-CANARY-d0-n0t-pr1nt-th1s-t0ken-/secret/local/path"

OUT=""
CODE=0
# Invoked as `bash "$script" ...`, NOT as `"$script" ...` directly — same
# repository convention noramedi-opscheck.test.sh/noramedi-pgbackrest.test.sh
# already established (see noramedi-opscheck.test.sh's own comment). The
# scripts under test are committed mode 100644, matching every other operator
# script in scripts/ (they get chmod 0755 at INSTALL time — see each script's
# own systemd unit header — never in git); relying on the git-tracked
# executable bit here is what broke this file's very first exact-head CI run
# (exit 126 / Permission denied on every assertion) while every other shell
# test suite in this repository passed unaffected.
run() {
  set +e
  OUT="$(PATH="$FAKEBIN:$PATH" env "${EXTRA_ENV[@]}" bash "$@" 2>&1)"
  CODE=$?
  set -e
  EXTRA_ENV=()
}
EXTRA_ENV=()

# ── fakes ────────────────────────────────────────────────────────────────

write_fake_restic() {
  cat > "$FAKEBIN/restic" <<EOF
#!/usr/bin/env bash
STORE="$STORE"
EOF
  cat >> "$FAKEBIN/restic" <<'FAKE_RESTIC'
CMD="${1:-}"; shift || true
case "$CMD" in
  backup)
    SRC=""
    for a in "$@"; do SRC="$a"; done   # last positional arg is the source dir
    SNAP_ID="${FAKE_RESTIC_SNAPSHOT_ID:-snap0000000000000000000000000000000000000000}"
    if [[ "${FAKE_RESTIC_EMIT_STATUS_CANARY:-false}" == true ]]; then
      echo '{"message_type":"status","percent_done":0.5,"action":"scan_finished"}'
      # A status line intentionally shaped like it could carry a path, to
      # prove the wrapper never forwards raw restic stdout on success.
      echo "{\"message_type\":\"status\",\"item\":\"${CANARY_PATH:-}\"}"
    fi
    if [[ -n "$SRC" ]] && [[ -d "$SRC" ]] && [[ "${FAKE_RESTIC_BACKUP_EXIT:-0}" -eq 0 ]]; then
      mkdir -p "$STORE/$SNAP_ID"
      cp -a "$SRC"/. "$STORE/$SNAP_ID"/ 2>/dev/null || true
    fi
    if [[ "${FAKE_RESTIC_BACKUP_EXIT:-0}" -ne 0 ]]; then
      echo "ERROR: simulated backup failure touching ${CANARY_PATH:-/no/path}" >&2
      exit "${FAKE_RESTIC_BACKUP_EXIT}"
    fi
    echo "{\"message_type\":\"summary\",\"snapshot_id\":\"${SNAP_ID}\",\"files_new\":3,\"files_changed\":1,\"files_unmodified\":10,\"total_bytes_processed\":123456}"
    exit 0
    ;;
  check)
    if [[ "${FAKE_RESTIC_CHECK_EXIT:-0}" -ne 0 ]]; then
      echo "error: pack ID does not match, mentions ${CANARY_PATH:-/no/path}" >&2
      exit "${FAKE_RESTIC_CHECK_EXIT}"
    fi
    echo "no errors were found"
    exit 0
    ;;
  restore)
    SNAP="${1:-}"; shift || true
    TARGET=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --target) TARGET="$2"; shift 2 ;; *) shift ;; esac
    done
    if [[ "${FAKE_RESTIC_RESTORE_EXIT:-0}" -ne 0 ]]; then
      echo "ERROR: simulated restore failure" >&2
      exit "${FAKE_RESTIC_RESTORE_EXIT}"
    fi
    mkdir -p "$TARGET"
    if [[ -d "$STORE/$SNAP" ]]; then
      cp -a "$STORE/$SNAP"/. "$TARGET"/ 2>/dev/null || true
    fi
    if [[ "${FAKE_RESTIC_RESTORE_CORRUPT:-false}" == true ]]; then
      # Flip one byte in every restored file to force a checksum mismatch.
      find "$TARGET" -type f -print0 | xargs -0 -I{} sh -c 'printf "X" >> "{}"'
    fi
    exit 0
    ;;
  *) echo "fake restic: unknown subcommand '$CMD'" >&2; exit 2 ;;
esac
FAKE_RESTIC
  chmod +x "$FAKEBIN/restic"
}

write_fake_curl() {
  # Records every URL it is called with, one per line, so ping_ok/ping_fail
  # can be asserted without a real network call.
  cat > "$FAKEBIN/curl" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "$WORK/curl-calls.log"
for a in "\$@"; do last="\$a"; done
exit 0
EOF
  chmod +x "$FAKEBIN/curl"
}

setup_common_env() {
  RESTIC_PW="$WORK/restic-password"
  echo -n "not-a-real-passphrase" > "$RESTIC_PW"
  chmod 600 "$RESTIC_PW"
  STATUS_FILE="$WORK/status.json"
  SOURCE_DIR="$WORK/uploads"
  mkdir -p "$SOURCE_DIR"
  echo "synthetic-fixture-not-real-upload-content" > "$SOURCE_DIR/fixture.bin"
  LOCK_FILE="$WORK/backup.lock"
  CHECK_LOCK_FILE="$WORK/check.lock"
  RESTOREPROOF_LOCK_FILE="$WORK/restore-proof.lock"
  rm -f "$WORK/curl-calls.log"
  # Exported (not per-call EXTRA_ENV) so every invocation below inherits a
  # hermetic status-write lock path under $WORK — never the real
  # /var/lock/noramedi-attachment-vps2-status.lock default, keeping this
  # suite's "no real paths touched" guarantee even though the status-write
  # lock itself is stateless/reusable across the whole run, unlike
  # STATUS_FILE's per-section content.
  export NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE="$WORK/status.lock"
}

write_fake_restic
write_fake_curl
setup_common_env

# ── syntax ───────────────────────────────────────────────────────────────
section "Syntax"
for s in "${ALL_SCRIPTS[@]}"; do
  if bash -n "$s" 2>/tmp/synerr; then
    pass "bash -n: $(basename "$s")"
  else
    fail "bash -n: $(basename "$s") — $(cat /tmp/synerr)"
  fi
done

# ── --help / usage ──────────────────────────────────────────────────────
section "Usage"
for s in "${ALL_SCRIPTS[@]}"; do
  run "$s" --help
  [[ "$CODE" -eq 0 ]] && [[ -n "$OUT" ]] && pass "--help exits 0 with output: $(basename "$s")" \
    || fail "--help: $(basename "$s") exit=$CODE"
done

for s in "${ALL_SCRIPTS[@]}"; do
  run "$s" --not-a-real-flag
  [[ "$CODE" -eq 2 ]] && pass "unknown flag exits 2: $(basename "$s")" \
    || fail "unknown flag: $(basename "$s") exit=$CODE (expected 2)"
done

# ── backup: --tag validation ────────────────────────────────────────────
section "Backup: --tag validation"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW")
run "$BACKUP" --tag "Not Valid!" --dry-run
[[ "$CODE" -eq 2 ]] && pass "invalid --tag rejected" || fail "invalid --tag: exit=$CODE (expected 2)"

EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR")
run "$BACKUP" --tag restore-proof --dry-run
[[ "$CODE" -eq 0 ]] && pass "valid --tag accepted in dry-run" || fail "valid --tag: exit=$CODE"

# ── preconditions: missing restic ───────────────────────────────────────
# Uses the test's own inherited PATH, deliberately WITHOUT FAKEBIN prepended
# (so the fake restic is absent) and without needing to fabricate a PATH that
# still resolves bash/node/coreutils/env itself — this host's real PATH
# already has no `restic` on it, which is exactly the precondition this
# asserts. (An earlier revision used an emptied PATH here, which broke
# `#!/usr/bin/env bash` resolution itself and produced a misleading exit 127
# instead of ever reaching this script's own precondition check.)
section "Preconditions: restic absent"
if command -v restic >/dev/null 2>&1; then
  skip "backup: restic-absent precondition — a real restic IS installed on this host, cannot exercise its absence without PATH surgery"
else
  CODE_NORES=0
  OUT_NORES="$(env RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" bash "$BACKUP" --dry-run 2>&1)" || CODE_NORES=$?
  [[ "$CODE_NORES" -eq 3 ]] && pass "backup: exits 3 when restic is absent" \
    || fail "backup restic-absent: exit=$CODE_NORES (expected 3), out=$OUT_NORES"
fi

# ── preconditions: missing / unreadable RESTIC_PASSWORD_FILE ────────────
section "Preconditions: RESTIC_PASSWORD_FILE"
EXTRA_ENV=(RESTIC_REPOSITORY=x)
run "$BACKUP" --dry-run
[[ "$CODE" -eq 3 ]] && pass "backup: exits 3 when RESTIC_PASSWORD_FILE unset" \
  || fail "backup RESTIC_PASSWORD_FILE unset: exit=$CODE (expected 3)"

EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$WORK/does-not-exist")
run "$BACKUP" --dry-run
[[ "$CODE" -eq 3 ]] && pass "backup: exits 3 when RESTIC_PASSWORD_FILE missing" \
  || fail "backup RESTIC_PASSWORD_FILE missing: exit=$CODE (expected 3)"

EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="relative/path")
run "$BACKUP" --dry-run
[[ "$CODE" -eq 3 ]] && pass "backup: rejects non-absolute RESTIC_PASSWORD_FILE" \
  || fail "backup RESTIC_PASSWORD_FILE relative: exit=$CODE (expected 3)"

for s in "$CHECK" "$RESTOREPROOF"; do
  EXTRA_ENV=(RESTIC_REPOSITORY=x)
  run "$s" --dry-run
  [[ "$CODE" -eq 3 ]] && pass "$(basename "$s"): exits 3 when RESTIC_PASSWORD_FILE unset" \
    || fail "$(basename "$s") RESTIC_PASSWORD_FILE unset: exit=$CODE (expected 3)"
done

# ── preconditions: missing source dir (backup only) ─────────────────────
section "Preconditions: source dir"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW")
run "$BACKUP" --source "$WORK/no-such-uploads-dir"
[[ "$CODE" -eq 3 ]] && pass "backup: exits 3 when --source directory is missing" \
  || fail "backup missing source: exit=$CODE (expected 3)"

# ── dry-run never writes the status file or invokes restic ─────────────
section "Dry-run isolation"
rm -f "$STATUS_FILE"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE")
run "$BACKUP" --dry-run
[[ "$CODE" -eq 0 ]] && [[ ! -f "$STATUS_FILE" ]] && pass "backup --dry-run: exit 0, no status file written" \
  || fail "backup --dry-run isolation: exit=$CODE status_exists=$([[ -f "$STATUS_FILE" ]] && echo yes || echo no)"

# ── preconditions: flock absent ──────────────────────────────────────────
# On a host that genuinely has no flock (this dev host may be one — see
# HAVE_FLOCK above), FAKEBIN's PATH already exercises this precondition, no
# surgery needed. On a host that DOES have flock (every CI runner), its
# directory is stripped from PATH for exactly this one invocation so the
# precondition is exercised there too, rather than only ever on hosts that
# happen to lack the tool.
section "Preconditions: flock absent"
if $HAVE_FLOCK; then
  FLOCK_DIR="$(dirname "$(command -v flock)")"
  NOFLOCK_PATH="$(printf '%s' "$FAKEBIN:$PATH" | awk -v RS=: -v ORS=: -v d="$FLOCK_DIR" '$0!=d' | sed 's/:$//')"
else
  NOFLOCK_PATH="$FAKEBIN:$PATH"
fi
CODE_NOFLOCK=0
OUT_NOFLOCK="$(PATH="$NOFLOCK_PATH" env RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" bash "$BACKUP" 2>&1)" || CODE_NOFLOCK=$?
[[ "$CODE_NOFLOCK" -eq 3 ]] && pass "backup: exits 3 when flock is absent" \
  || fail "backup flock-absent: exit=$CODE_NOFLOCK (expected 3), out=$OUT_NOFLOCK"

echo "DIAG: NOFLOCK_PATH=$NOFLOCK_PATH" >&2
echo "DIAG: direct command -v flock with NOFLOCK_PATH: $(PATH="$NOFLOCK_PATH" command -v flock 2>&1; echo "[rc=$?]")" >&2
echo "DIAG: minimal env+bash -c harness: $(PATH="$NOFLOCK_PATH" env RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" bash -c 'echo "PATH=$PATH"; command -v flock; echo "rc=$?"' 2>&1)" >&2

CODE_NOFLOCK_RP=0
OUT_NOFLOCK_RP="$(PATH="$NOFLOCK_PATH" env RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" bash "$RESTOREPROOF" 2>&1)" || CODE_NOFLOCK_RP=$?
[[ "$CODE_NOFLOCK_RP" -eq 3 ]] && pass "restore-proof: exits 3 when flock is absent" \
  || fail "restore-proof flock-absent: exit=$CODE_NOFLOCK_RP (expected 3), out=$OUT_NOFLOCK_RP"

# ── lock contention ──────────────────────────────────────────────────────
section "Lock contention"
if $HAVE_FLOCK; then
  exec 8>"$LOCK_FILE"
  if flock -n 8; then
    EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$LOCK_FILE" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE")
    run "$BACKUP"
    [[ "$CODE" -eq 5 ]] && pass "backup: exits 5 when the lock is already held" \
      || fail "backup lock contention: exit=$CODE (expected 5)"
    flock -u 8
  else
    fail "backup lock contention: could not acquire the test's own flock to set up the scenario"
  fi
  exec 8>&-

  # restore-proof's operation lock is SEPARATE from backup's/check's own —
  # holding it must not affect backup at all, and must make a concurrent
  # restore-proof run exit 5.
  exec 8>"$RESTOREPROOF_LOCK_FILE"
  if flock -n 8; then
    EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE="$RESTOREPROOF_LOCK_FILE" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE")
    run "$RESTOREPROOF"
    [[ "$CODE" -eq 5 ]] && pass "restore-proof: exits 5 when the lock is already held" \
      || fail "restore-proof lock contention: exit=$CODE (expected 5)"
    flock -u 8
  else
    fail "restore-proof lock contention: could not acquire the test's own flock to set up the scenario"
  fi
  exec 8>&-
else
  skip "backup lock contention: flock not available on this host (verified on CI, which ships util-linux flock)"
  skip "restore-proof lock contention: flock not available on this host (verified on CI, which ships util-linux flock)"
fi

# The remaining backup/check runtime assertions (success path, failure path,
# log-privacy canary against a REAL invocation) all need a real lock — they
# are skipped as a block on a host without flock, exactly like the lock
# contention test above, rather than repeating the same guard nine times.
if $HAVE_FLOCK; then

# ── successful backup run: status file shape + ping ─────────────────────
section "Successful backup run"
rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/backup2.lock" NORAMEDI_ATTACHMENT_VPS2_PING_URL="http://x/PINGSECRET" FAKE_RESTIC_SNAPSHOT_ID="snapaaa111")
run "$BACKUP"
[[ "$CODE" -eq 0 ]] && pass "backup: successful run exits 0" || fail "backup successful run: exit=$CODE, out=$OUT"

if [[ -f "$STATUS_FILE" ]]; then
  SHAPE_OK="$(node -e '
    const doc = require(process.argv[1]);
    const b = doc.backup || {};
    const ok = b.lastRunStatus === "completed"
      && b.snapshotId === "snapaaa111"
      && b.filesNew === 3
      && b.filesChanged === 1
      && b.filesUnmodified === 10
      && b.totalBytesProcessed === 123456
      && typeof b.lastRunDurationSeconds === "number";
    console.log(ok ? "yes" : "no:" + JSON.stringify(b));
  ' "$STATUS_FILE" 2>&1)"
  [[ "$SHAPE_OK" == "yes" ]] && pass "backup: status file has the expected shape" \
    || fail "backup status file shape: $SHAPE_OK"
else
  fail "backup: status file was not written on success"
fi

if grep -qF "http://x/PINGSECRET" "$WORK/curl-calls.log" 2>/dev/null && ! grep -qF "/fail" "$WORK/curl-calls.log"; then
  pass "backup: pings the SUCCESS url, not /fail"
else
  fail "backup: ping calls were $(cat "$WORK/curl-calls.log" 2>/dev/null || echo '<none>')"
fi

# ── failed backup run: exit 1, /fail pinged, status recorded ────────────
section "Failed backup run"
rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/backup3.lock" NORAMEDI_ATTACHMENT_VPS2_PING_URL="http://x/PINGSECRET" FAKE_RESTIC_BACKUP_EXIT=1 CANARY_PATH="$CANARY")
run "$BACKUP"
[[ "$CODE" -eq 1 ]] && pass "backup: restic failure surfaces as exit 1" || fail "backup failure: exit=$CODE"
if [[ -f "$STATUS_FILE" ]]; then
  FAILED_OK="$(node -e 'const d=require(process.argv[1]); console.log((d.backup||{}).lastRunStatus === "failed" ? "yes" : "no")' "$STATUS_FILE" 2>&1)"
  [[ "$FAILED_OK" == "yes" ]] && pass "backup: status file records the failure" || fail "backup failure status: $FAILED_OK"
fi
grep -qF "http://x/PINGSECRET/fail" "$WORK/curl-calls.log" 2>/dev/null \
  && pass "backup: pings the /fail url on failure" \
  || fail "backup: /fail was not pinged — calls: $(cat "$WORK/curl-calls.log" 2>/dev/null || echo '<none>')"

# ── log-privacy canary — restic's raw stderr/stdout must never be echoed ─
section "Log privacy"
rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/backup4.lock" FAKE_RESTIC_BACKUP_EXIT=1 CANARY_PATH="$CANARY")
run "$BACKUP"
if [[ "$OUT" != *"$CANARY"* ]]; then
  pass "backup: CANARY never appears in captured output on a failing run"
else
  fail "backup: CANARY LEAKED into output — $OUT"
fi

rm -f "$STATUS_FILE"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/backup5.lock" FAKE_RESTIC_EMIT_STATUS_CANARY=true CANARY_PATH="$CANARY")
run "$BACKUP"
if [[ "$OUT" != *"$CANARY"* ]]; then
  pass "backup: CANARY never appears in captured output on a successful run with verbose restic status lines"
else
  fail "backup: CANARY LEAKED into successful-run output — $OUT"
fi

EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/check1.lock" FAKE_RESTIC_CHECK_EXIT=1 CANARY_PATH="$CANARY")
run "$CHECK"
[[ "$CODE" -eq 1 ]] && pass "check: restic failure surfaces as exit 1" || fail "check failure: exit=$CODE"
if [[ "$OUT" != *"$CANARY"* ]]; then
  pass "check: CANARY never appears in captured output on a failing check"
else
  fail "check: CANARY LEAKED into output — $OUT"
fi

# check success path + status shape
rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/check2.lock" NORAMEDI_ATTACHMENT_VPS2_CHECK_PING_URL="http://x/CHECKSECRET")
run "$CHECK"
[[ "$CODE" -eq 0 ]] && pass "check: successful run exits 0" || fail "check successful run: exit=$CODE out=$OUT"
if [[ -f "$STATUS_FILE" ]]; then
  CHECK_OK="$(node -e 'const d=require(process.argv[1]); console.log((d.check||{}).lastRunStatus === "passed" ? "yes" : "no:" + JSON.stringify(d.check))' "$STATUS_FILE" 2>&1)"
  [[ "$CHECK_OK" == "yes" ]] && pass "check: status file records a pass" || fail "check status shape: $CHECK_OK"
fi
grep -qF "http://x/CHECKSECRET" "$WORK/curl-calls.log" 2>/dev/null && ! grep -qF "/fail" "$WORK/curl-calls.log" \
  && pass "check: pings its own SUCCESS url" || fail "check: ping calls were $(cat "$WORK/curl-calls.log" 2>/dev/null || echo '<none>')"

else
  skip "backup/check runtime success+failure+log-privacy assertions: flock not available on this host (verified on CI)"
fi

# backup, check, and restore-proof each use a DIFFERENT operation lock file
# by default (documented contract) — none of the three may ever block another.
section "Independent lock files"
grep -q "NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE:-/var/lock/noramedi-attachment-vps2.lock" "$BACKUP" \
  && grep -q "NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-check.lock" "$CHECK" \
  && pass "backup and check default to distinct lock files" \
  || fail "backup/check lock file defaults are not distinct — a slow weekly check would block every daily backup"

grep -q "NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-restore-proof.lock" "$RESTOREPROOF" \
  && pass "restore-proof defaults to its own, third distinct lock file" \
  || fail "restore-proof lock file default is missing or collides with backup's/check's — a slow monthly restore-proof would block backup/check"

# The shared status-write lock is the SAME file for all three by design
# (it protects the shared status DOCUMENT, not any one job's own operation) —
# assert that explicitly so a future edit cannot accidentally fork it into
# three independent, non-cooperating locks and silently reintroduce the
# lost-update race this lock exists to prevent.
STATUS_LOCK_COUNT=0
for _s in "$BACKUP" "$CHECK" "$RESTOREPROOF"; do
  grep -q "NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-status.lock" "$_s" \
    && STATUS_LOCK_COUNT=$((STATUS_LOCK_COUNT + 1))
done
[[ "$STATUS_LOCK_COUNT" -eq 3 ]] && pass "all three scripts share the SAME status-write lock default" \
  || fail "status-write lock default is not consistently shared across all three scripts (found in ${STATUS_LOCK_COUNT}/3)"

# ── status write lock: a waiting writer merges onto the freshest content ───
# Deterministically reproduces the concurrency defect this lock exists to
# prevent — NOT a timing-dependent race. The test process itself holds the
# status-write lock and writes a "check" field while holding it (standing in
# for a real concurrent check run that just finished); it then starts a real
# backup run in the background, which is forced to block on the same lock,
# and only afterwards releases it. Regardless of exactly how the background
# process's timing lines up with the `sleep` below (a wide-margin nicety, not
# a correctness requirement), the assertions only pass if the backup run
# waited for the lock and then merged onto the version the test wrote, rather
# than either failing outright or silently overwriting it.
section "Status write lock: waiting writer merges onto the freshest content, not a stale read"
if $HAVE_FLOCK; then
  rm -f "$STATUS_FILE"
  CONC_STATUS_LOCK="$WORK/status-concurrency.lock"
  exec 8>"$CONC_STATUS_LOCK"
  flock 8
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schemaVersion:1, check:{lastRunStatus:"passed"}}, null, 2)+"\n")' "$STATUS_FILE"
  (
    PATH="$FAKEBIN:$PATH" env RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" \
      NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR="$SOURCE_DIR" \
      NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" \
      NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE="$WORK/backup-conc.lock" \
      NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE="$CONC_STATUS_LOCK" \
      FAKE_RESTIC_SNAPSHOT_ID="snapconc001" \
      bash "$BACKUP" >"$WORK/conc-backup.out" 2>&1
    echo $? >"$WORK/conc-backup.rc"
  ) &
  BGPID=$!
  sleep 0.3
  flock -u 8
  exec 8>&-
  wait "$BGPID"
  BACKUP_RC="$(cat "$WORK/conc-backup.rc" 2>/dev/null || echo 1)"
  [[ "$BACKUP_RC" -eq 0 ]] && pass "status write lock: background backup run (forced to wait on the lock) still exits 0" \
    || fail "status write lock: background backup run failed — rc=$BACKUP_RC out=$(cat "$WORK/conc-backup.out" 2>/dev/null)"
  if [[ -f "$STATUS_FILE" ]]; then
    BOTH_OK="$(node -e 'const d=require(process.argv[1]); console.log((d.check && d.check.lastRunStatus === "passed" && d.backup && d.backup.lastRunStatus === "completed") ? "yes" : "no:"+JSON.stringify(d))' "$STATUS_FILE" 2>&1)"
    [[ "$BOTH_OK" == "yes" ]] && pass "status write lock: waiting writer preserved the other job's pre-existing field instead of losing it" \
      || fail "status write lock: lost-update race reproduced — $BOTH_OK"
  else
    fail "status write lock: status file missing after the concurrent run"
  fi
else
  skip "status write lock: flock not available on this host (verified on CI, which ships util-linux flock)"
fi

# ── restore-proof: success (checksum match) ─────────────────────────────
# Needs a real flock (restore-proof.sh now acquires its own operation lock —
# see the "Lock contention"/"Preconditions: flock absent" sections above),
# same guard as the backup/check runtime block.
section "Restore proof: success"
if $HAVE_FLOCK; then
  rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
  EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE="$WORK/restore-proof-success.lock" NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_PING_URL="http://x/RPSECRET" FAKE_RESTIC_SNAPSHOT_ID="snapproof001")
  run "$RESTOREPROOF"
  [[ "$CODE" -eq 0 ]] && pass "restore-proof: matching checksum exits 0" || fail "restore-proof success: exit=$CODE out=$OUT"
  if [[ -f "$STATUS_FILE" ]]; then
    RP_OK="$(node -e 'const d=require(process.argv[1]); const r=d.restoreProof||{}; console.log(r.checksumMatch === true && r.snapshotId === "snapproof001" ? "yes" : "no:" + JSON.stringify(r))' "$STATUS_FILE" 2>&1)"
    [[ "$RP_OK" == "yes" ]] && pass "restore-proof: status file records checksumMatch=true" || fail "restore-proof status shape: $RP_OK"
  fi
  grep -qF "http://x/RPSECRET" "$WORK/curl-calls.log" 2>/dev/null && ! grep -qF "/fail" "$WORK/curl-calls.log" \
    && pass "restore-proof: pings its own SUCCESS url" || fail "restore-proof: ping calls were $(cat "$WORK/curl-calls.log" 2>/dev/null || echo '<none>')"

  # ── restore-proof: checksum mismatch is detected and fails closed ───────
  section "Restore proof: corrupted restore is detected"
  rm -f "$STATUS_FILE" "$WORK/curl-calls.log"
  EXTRA_ENV=(RESTIC_REPOSITORY=x RESTIC_PASSWORD_FILE="$RESTIC_PW" NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE="$STATUS_FILE" NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE="$WORK/restore-proof-mismatch.lock" NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_PING_URL="http://x/RPSECRET" FAKE_RESTIC_SNAPSHOT_ID="snapproof002" FAKE_RESTIC_RESTORE_CORRUPT=true)
  run "$RESTOREPROOF"
  [[ "$CODE" -eq 1 ]] && pass "restore-proof: checksum mismatch exits 1 (fails closed)" || fail "restore-proof mismatch: exit=$CODE out=$OUT"
  grep -qF "http://x/RPSECRET/fail" "$WORK/curl-calls.log" 2>/dev/null \
    && pass "restore-proof: pings /fail on checksum mismatch" \
    || fail "restore-proof: /fail was not pinged on mismatch"
else
  skip "restore-proof success: flock not available on this host (verified on CI, which ships util-linux flock)"
  skip "restore-proof corrupted restore: flock not available on this host (verified on CI, which ships util-linux flock)"
fi

# ── restore-proof: never touches the real source_dir / primary storage ──
section "Restore proof: never reads NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR"
# Comment lines are stripped first — the script's header documents, in prose,
# what it deliberately does NOT touch, which would otherwise self-defeat this
# assertion. Only non-comment (code) lines matter here.
if grep -v '^[[:space:]]*#' "$RESTOREPROOF" | grep -q "NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR"; then
  fail "restore-proof.sh's CODE references NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR — it must only ever touch a disposable synthetic directory"
else
  pass "restore-proof.sh's code contains no reference to the primary-storage source dir variable"
fi

# ── every script rejects being sourced with unset -u-sensitive vars, i.e.
#    set -euo pipefail is present (defense against a future edit silently
#    dropping it) ─────────────────────────────────────────────────────────
section "Strict mode present"
for s in "${ALL_SCRIPTS[@]}"; do
  grep -q "^set -euo pipefail$" "$s" \
    && pass "set -euo pipefail present: $(basename "$s")" \
    || fail "set -euo pipefail MISSING from $(basename "$s")"
done

# ── summary ──────────────────────────────────────────────────────────────
echo
echo "attachment-vps2 shell tests: ${PASSED} passed, ${FAILED} failed, ${SKIPPED} skipped"
[[ "$FAILED" -eq 0 ]]

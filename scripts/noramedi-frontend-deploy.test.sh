#!/usr/bin/env bash
# noramedi-frontend-deploy.test.sh — F3-PROD-004 (R-038)
#
# Run with: bash scripts/noramedi-frontend-deploy.test.sh
#
# ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
# scripts/noramedi-frontend-deploy.sh renames production directories. Its two
# genuinely dangerous properties cannot be exercised in production and cannot
# be reasoned about from a diff:
#
#   1. Promotion is a TWO-STEP SAME-FILESYSTEM RENAME PROMOTION — near-atomic,
#      NOT a single atomic exchange. If the second rename fails after the first
#      succeeded, production has no live bundle at all. The script attempts a
#      bounded restoration; nothing but a test can prove it actually runs, and
#      a refactor could silently delete that branch.
#   2. Every path it acts on is user-influenceable. A path-safety regression
#      would not fail loudly — it would succeed, against the wrong directory.
#
# So the failure path is driven for real here, by putting a `mv` on PATH that
# refuses exactly the activation rename, and the safety assertions are driven
# with the paths an operator would most plausibly get wrong.
#
# Everything runs in mktemp working directories. Nothing in this suite ever
# names /var/www/noramedi, touches a database, a PM2 process, or the network.
#
# Deliberately `set -uo pipefail` WITHOUT -e, matching the sibling suites: a
# failing assertion records a failure and the run continues. Unlike the sibling
# suites, run() does NOT re-enable errexit afterwards — that is a known quirk
# there which contradicts this header, and reproducing it would make a mid-file
# assertion failure abort the rest of the suite.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE="$SCRIPT_DIR/noramedi-frontend-deploy.sh"

if [[ ! -f "$FE" ]]; then
  echo "  FAIL - $FE is missing"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0
SKIPPED=0
pass()    { PASSED=$((PASSED + 1)); echo "  ok - $1"; }
fail()    { FAILED=$((FAILED + 1)); echo "  FAIL - $1"; }
section() { echo; echo "$1"; }

# Planted in the process environment for every single invocation below. If this
# token ever reaches stdout or stderr, a real DATABASE_URL / SENTRY_DSN would
# reach the deploy log on a real run.
CANARY="frontend-deploy-CANARY-d0-n0t-pr1nt-th1s-t0ken"

# ── fakes ────────────────────────────────────────────────────────────────
# Resolved BEFORE PATH is ever shadowed, so the fakes can reach the real tools.
REAL_MV="$(command -v mv)"
REAL_DATE="$(command -v date)"

FAKEBIN="$WORK/bin"
FAILBIN="$WORK/failbin"
mkdir -p "$FAKEBIN" "$FAILBIN"

# A frozen clock. Every directory name and every release-marker timestamp the
# script produces is derived from `date`, so freezing it is what makes the
# rollback-destination-collision case reproducible rather than a race, and
# what lets the release marker be asserted byte-for-byte.
write_fake_date() {
  local dir="$1"
  cat > "$dir/date" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in
    +%Y%m%dT%H%M%SZ)     echo "20260101T000000Z";     exit 0 ;;
    +%Y-%m-%dT%H:%M:%SZ) echo "2026-01-01T00:00:00Z"; exit 0 ;;
    +%H:%M:%S)           echo "00:00:00";             exit 0 ;;
  esac
done
exec "$REAL_DATE" "\$@"
EOF
  chmod +x "$dir/date"
}

# A `mv` that refuses ONLY the activation rename (source basename dist.next).
# This is the real second-rename failure, produced without a test-only hook in
# the production script: the preserving rename and the restoring rename both
# pass straight through to the real mv, exactly as they would in production.
write_failing_mv() {
  cat > "$FAILBIN/mv" <<EOF
#!/usr/bin/env bash
src="\${@: -2:1}"
if [[ "\$(basename -- "\$src")" == "dist.next" ]]; then
  echo "fake mv: simulated failure activating \$src" >&2
  exit 1
fi
exec "$REAL_MV" "\$@"
EOF
  chmod +x "$FAILBIN/mv"
}

# A `stat` that cannot report a filesystem device — the host the promotion
# contract's same-filesystem precondition cannot be verified on. Same technique
# as the failing `mv`: the seam is on PATH, so the production script needs no
# test-only hook to reach its fail-closed path (F3-PROD-004-R1, blocker 1).
NOSTATBIN="$WORK/nostatbin"
mkdir -p "$NOSTATBIN"
write_no_device_stat() {
  cat > "$NOSTATBIN/stat" <<'EOF'
#!/usr/bin/env bash
echo "fake stat: filesystem device information is unavailable on this host" >&2
exit 1
EOF
  chmod +x "$NOSTATBIN/stat"
}

write_fake_date "$FAKEBIN"
write_fake_date "$FAILBIN"
write_fake_date "$NOSTATBIN"
write_failing_mv
write_no_device_stat

# ── invocation ───────────────────────────────────────────────────────────
OUT=""
CODE=0
BIN="$FAKEBIN"
run() {
  set +e
  OUT="$(PATH="$BIN:$PATH" \
        env DATABASE_URL="postgresql://u:$CANARY@h/db" \
            SENTRY_DSN="https://$CANARY@sentry.invalid/1" \
            NORAMEDI_DEPLOY_TOKEN="$CANARY" \
            "$@" 2>&1)"
  CODE=$?
  set +e
  BIN="$FAKEBIN"
}

# ── fixtures ─────────────────────────────────────────────────────────────
# A minimal but structurally honest Vite bundle: index.html with a root-absolute
# hashed entry chunk and stylesheet, both present on disk.
seed_bundle() {
  local dir="$1" token="$2"
  mkdir -p "$dir/assets"
  printf 'chunk-%s\n' "$token" > "$dir/assets/index-$token.js"
  printf '.c{}\n'                > "$dir/assets/index-$token.css"
  cat > "$dir/index.html" <<EOF
<!doctype html><html><head>
<link rel="stylesheet" href="/assets/index-$token.css">
<script type="module" src="/assets/index-$token.js"></script>
</head><body><div id="root"></div></body></html>
EOF
}

new_app() {
  # Two statements: `local a="$1" b="$a"` reads an unset `a` under `set -u`.
  local name="$1"
  local app="$WORK/$name"
  mkdir -p "$app"
  printf '%s\n' "$app"
}

# ── the build seam (F3-PROD-004-R1, blocker 2) ───────────────────────────
# The production script no longer accepts a build *command string*: there is no
# shell-string build hook left in it. Its only substitution point is
# NORAMEDI_FRONTEND_BUILD_EXECUTABLE, an absolute path to an executable file it
# runs directly. So the shell scripting this suite needs stays entirely on this
# side of that boundary — this file authors the helper program, and the
# production script only ever executes a validated executable.
#
# build_exe SHELL_BODY -> absolute path to a fresh executable running SHELL_BODY.
BUILD_EXE_SEQ=0
build_exe() {
  local body="$1"
  BUILD_EXE_SEQ=$((BUILD_EXE_SEQ + 1))
  local f="$WORK/build-helper-$BUILD_EXE_SEQ.sh"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -uo pipefail\n'
    printf '%s\n' "$body"
  } > "$f"
  chmod +x "$f"
  printf '%s\n' "$f"
}

# The body of a build that produces a valid staged bundle. Relative to the
# deployment root, which is the cwd the production script invokes it in.
build_ok_body() {
  local token="$1"
  printf 'mkdir -p dist.next/assets && printf "chunk\\n" > dist.next/assets/index-%s.js && printf ".c{}\\n" > dist.next/assets/index-%s.css && printf "<!doctype html><html><head><link rel=\\"stylesheet\\" href=\\"/assets/index-%s.css\\"><script type=\\"module\\" src=\\"/assets/index-%s.js\\"></script></head><body></body></html>" > dist.next/index.html' \
    "$token" "$token" "$token" "$token"
}
build_ok() { build_exe "$(build_ok_body "$1")"; }

# bundle_token BUNDLE_DIR — which build is this? live_token takes a deployment
# root; bundle_token takes a bundle directory (preserved, staged, whatever).
bundle_token() {
  grep -oE 'index-[A-Za-z0-9]+\.js' "$1/index.html" 2>/dev/null | head -n1 | sed -E 's/index-(.*)\.js/\1/'
}
live_token() { bundle_token "$1/dist"; }

# Full recursive content snapshot — names AND bytes. Comparing two of these is
# what makes "zero mutations" a measured claim rather than an asserted one.
snapshot() {
  ( cd "$1" 2>/dev/null || return 0
    find . -print | LC_ALL=C sort
    find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s::' "$f"; cat -- "$f"; printf '\n'
    done ) 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════════
section "A. Successful staged build, validation and promotion"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-happy)"
seed_bundle "$APP/dist" v1

run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha 1111222233334444555566667777888899990000

[[ "$CODE" -eq 0 ]] \
  && pass "deploy exits 0 on the happy path" \
  || fail "expected exit 0, got $CODE: $OUT"
[[ "$(live_token "$APP")" == "v2" ]] \
  && pass "the newly built bundle is now the live one" \
  || fail "live bundle is '$(live_token "$APP")', expected v2"
[[ -d "$APP/dist.rollback-111122223333-20260101T000000Z" ]] \
  && pass "the previous live bundle is preserved under the dist.rollback-<tag>-<UTC> convention" \
  || fail "no preserved bundle found; got: $(ls -d "$APP"/dist.rollback-* 2>/dev/null)"
[[ "$(bundle_token "$APP/dist.rollback-111122223333-20260101T000000Z")" == "v1" ]] \
  && pass "the preserved bundle holds the bundle that was live before the deploy" \
  || fail "preserved bundle does not contain v1"
[[ ! -e "$APP/dist.next" ]] \
  && pass "no staging directory is left behind after promotion" \
  || fail "dist.next still exists after promotion"
[[ "$OUT" == *"TWO-STEP"* || "$OUT" == *"step 1/2"* ]] \
  && pass "the promotion is reported as two distinct steps, not one exchange" \
  || fail "promotion output does not show the two-step sequence: $OUT"

# ── the operator's question: what SHA is this frontend serving? ──────────
section "B. Release traceability (release marker)"
MARKER="$APP/dist/release.json"
[[ -f "$MARKER" ]] \
  && pass "the live bundle carries a release.json marker" \
  || fail "no release.json in the promoted bundle"
grep -q '"releaseSha": "1111222233334444555566667777888899990000"' "$MARKER" \
  && pass "the marker records the exact release SHA that was deployed" \
  || fail "marker releaseSha is wrong: $(cat "$MARKER" 2>/dev/null)"
grep -q '"builtAt": "2026-01-01T00:00:00Z"' "$MARKER" \
  && pass "the marker records a UTC build timestamp" \
  || fail "marker builtAt is wrong: $(cat "$MARKER" 2>/dev/null)"
grep -q '"task": "F3-PROD-004"' "$MARKER" \
  && pass "the marker records the owning task" \
  || fail "marker task field is wrong: $(cat "$MARKER" 2>/dev/null)"
# The marker is served publicly by nginx. Nothing may be added to it that is
# not already public — no path, no host, no environment value.
LEAK_PAT="$WORK|$APP|$CANARY|DATABASE_URL|SENTRY"
HOSTN="$(hostname 2>/dev/null || true)"
# Only worth asserting on a hostname long enough not to match by accident.
[[ "${#HOSTN}" -ge 4 ]] && LEAK_PAT="$LEAK_PAT|$HOSTN"
if grep -qE "$LEAK_PAT" "$MARKER"; then
  fail "the release marker leaks a filesystem path, hostname, or environment value: $(cat "$MARKER")"
else
  pass "the release marker contains no path, hostname, or environment value"
fi
[[ "$(grep -c '"' "$MARKER")" -eq 4 ]] \
  && pass "the marker carries exactly the four documented fields and nothing else" \
  || fail "marker field count changed unexpectedly: $(cat "$MARKER")"

run bash "$FE" verify --app-dir "$APP" --expect-sha 1111222233334444555566667777888899990000
[[ "$CODE" -eq 0 ]] \
  && pass "verify --expect-sha passes against the bundle that was just deployed" \
  || fail "verify failed unexpectedly: $OUT"
[[ "$OUT" == *"FRONTEND_RELEASE_SHA = 1111222233334444555566667777888899990000"* ]] \
  && pass "verify reports FRONTEND_RELEASE_SHA" \
  || fail "verify did not report FRONTEND_RELEASE_SHA: $OUT"
[[ "$OUT" == *"BACKEND_RELEASE_SHA  = NOT_APPLICABLE"* ]] \
  && pass "verify reports BACKEND_RELEASE_SHA as NOT_APPLICABLE with no PM2 present (never a guess from local git)" \
  || fail "verify fabricated or mis-reported a backend SHA: $OUT"
[[ "$OUT" == *"RELEASE_SHA_MATCH    = NOT_APPLICABLE"* ]] \
  && pass "verify reports MATCH = NOT_APPLICABLE rather than claiming agreement it cannot establish" \
  || fail "verify reported a match state it cannot support: $OUT"

run bash "$FE" verify --app-dir "$APP" --expect-sha deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
[[ "$CODE" -ne 0 ]] \
  && pass "verify --expect-sha fails when the live bundle is a different release" \
  || fail "verify accepted the wrong release SHA"

# ════════════════════════════════════════════════════════════════════════
section "C. Build failure leaves the live bundle untouched"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-buildfail)"
seed_bundle "$APP/dist" v1
SNAP_BEFORE="$(snapshot "$APP")"

run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_exe 'exit 3')" \
    bash "$FE" deploy --app-dir "$APP" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555

[[ "$CODE" -ne 0 ]] \
  && pass "deploy fails when the build fails" \
  || fail "deploy reported success after a failing build"
[[ "$OUT" == *"UNCHANGED"* ]] \
  && pass "the failure message states that the live bundle is unchanged" \
  || fail "failure message does not tell the operator the live state: $OUT"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "not one byte under the deployment root changed" \
  || fail "the deployment root was mutated by a failed build"

# ════════════════════════════════════════════════════════════════════════
section "D. Invalid staging output is refused before any rename"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-nostage)"
seed_bundle "$APP/dist" v1
SNAP_BEFORE="$(snapshot "$APP")"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_exe 'true')" \
    bash "$FE" deploy --app-dir "$APP" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
[[ "$CODE" -ne 0 ]] \
  && pass "a build that exits 0 but produces no staging directory is refused" \
  || fail "deploy accepted a build that produced nothing"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "live bundle untouched (missing staging directory)" \
  || fail "deployment root mutated despite a missing staging directory"

# For the cases below the build DOES emit something, so a leftover dist.next is
# expected and correct — the script never deletes, and the rejected output is
# left in place for the operator to inspect. The live bundle is what must be
# byte-identical, so that is what is compared.
reject_case() {
  local label="$1" body="$2" expect="$3"
  local app; app="$(new_app "app-reject-$RANDOM$RANDOM")"
  seed_bundle "$app/dist" v1
  local before; before="$(snapshot "$app/dist")"
  run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_exe "$body")" \
      bash "$FE" deploy --app-dir "$app" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
  if [[ "$CODE" -ne 0 && "$OUT" == *"$expect"* ]]; then
    pass "$label is refused"
  else
    fail "$label was accepted or refused for the wrong reason (exit $CODE): $OUT"
  fi
  [[ "$(snapshot "$app/dist")" == "$before" ]] \
    && pass "live bundle byte-identical after refusing $label" \
    || fail "the live bundle changed while refusing $label"
  [[ -e "$app/dist.next" ]] \
    && pass "the rejected build output is retained for inspection, not deleted ($label)" \
    || fail "the rejected build output was deleted ($label)"
}

reject_case "a staging directory with no index.html" \
  'mkdir -p dist.next/assets && printf x > dist.next/assets/stray.js' \
  'index.html'

# The partial build: index.html exists, but the hashed entry chunk it points at
# was never written. This is the outcome that would serve a blank page.
reject_case "a bundle whose index.html references a missing hashed asset" \
  'mkdir -p dist.next/assets && printf "<!doctype html><script type=\"module\" src=\"/assets/index-ghost.js\"></script>" > dist.next/index.html' \
  'not present in the bundle'

reject_case "an empty staging directory" \
  'mkdir -p dist.next' \
  'empty'

# ════════════════════════════════════════════════════════════════════════
section "E. Stale staging and rollback-destination collision"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-stalestage)"
seed_bundle "$APP/dist" v1
seed_bundle "$APP/dist.next" vstale
SNAP_BEFORE="$(snapshot "$APP")"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
[[ "$CODE" -ne 0 && "$OUT" == *"stale"* ]] \
  && pass "a pre-existing staging directory aborts the deploy rather than being silently overwritten" \
  || fail "deploy did not refuse a pre-existing dist.next (exit $CODE): $OUT"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "the stale staging directory was neither deleted nor promoted" \
  || fail "the deployment root was mutated by the stale-staging abort"

# --clean-staging moves it aside; it must never delete it.
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --clean-staging --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
[[ "$CODE" -eq 0 ]] \
  && pass "--clean-staging allows the deploy to proceed" \
  || fail "--clean-staging deploy failed: $OUT"
[[ -d "$APP/dist.next.stale-20260101T000000Z" && "$(bundle_token "$APP/dist.next.stale-20260101T000000Z")" == "vstale" ]] \
  && pass "--clean-staging preserves the stale bundle intact instead of deleting it" \
  || fail "the stale staging bundle was not preserved: $(ls "$APP")"

# Collision: the destination the deploy would create already exists. With the
# clock frozen this is exact, not a race.
APP="$(new_app app-collide)"
seed_bundle "$APP/dist" v1
mkdir -p "$APP/dist.rollback-aaaa1111bbbb-20260101T000000Z"
printf 'do-not-touch\n' > "$APP/dist.rollback-aaaa1111bbbb-20260101T000000Z/SENTINEL"
SNAP_BEFORE="$(snapshot "$APP")"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
[[ "$CODE" -ne 0 ]] \
  && pass "a colliding rollback destination aborts the deploy" \
  || fail "deploy overwrote or reused an existing preserved bundle"
[[ -f "$APP/dist.rollback-aaaa1111bbbb-20260101T000000Z/SENTINEL" ]] \
  && pass "the already-retained bundle at the colliding path is untouched" \
  || fail "an existing retained bundle was clobbered"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "nothing under the deployment root changed on the collision path" \
  || fail "the deployment root was mutated by the collision abort"

# ════════════════════════════════════════════════════════════════════════
section "F. Second-rename failure restores the previous live bundle"
# ════════════════════════════════════════════════════════════════════════
# The one window the promotion contract has. `mv` on PATH refuses exactly the
# activation rename, so step 1 has already renamed the live bundle away when
# step 2 fails — the real production-hazard sequence.
APP="$(new_app app-renamefail)"
seed_bundle "$APP/dist" v1
BIN="$FAILBIN"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha bbbb1111cccc2222dddd3333eeee4444ffff5555

[[ "$CODE" -ne 0 ]] \
  && pass "a failed activation rename fails the deploy" \
  || fail "deploy reported success after the activation rename failed"
[[ -d "$APP/dist" ]] \
  && pass "production is NOT left without a live bundle" \
  || fail "CRITICAL: the live bundle does not exist after a failed activation rename"
[[ "$(live_token "$APP")" == "v1" ]] \
  && pass "the previous live bundle was restored — the site serves the pre-deploy build" \
  || fail "the restored live bundle is '$(live_token "$APP")', expected v1"
[[ "$OUT" == *"RESTORED"* ]] \
  && pass "the operator is told, in the failure message, that the previous bundle was restored" \
  || fail "the failure message does not state the restoration outcome: $OUT"
[[ -d "$APP/dist.next" ]] \
  && pass "the new build is preserved at the staging path for a retry" \
  || fail "the new build was lost"
[[ ! -e "$APP/dist.rollback-bbbb1111cccc-20260101T000000Z" ]] \
  && pass "the preserved-bundle path is vacated by the restoration, leaving no half-finished state" \
  || fail "a stray preserved bundle survived the restoration"
[[ ! -f "$APP/.noramedi-frontend-release-state" ]] \
  && pass "no rollback pointer is written for a promotion that never completed" \
  || fail "a rollback pointer was written despite the promotion failing"

# ════════════════════════════════════════════════════════════════════════
section "G. Rollback restores the exact expected version"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-rollback)"
seed_bundle "$APP/dist" v1
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --tag rel-a --release-sha 1111111111111111111111111111111111111111
[[ "$CODE" -eq 0 && "$(live_token "$APP")" == "v2" ]] \
  && pass "setup: v2 deployed over v1" \
  || fail "setup deploy failed: $OUT"

PRESERVED="$APP/dist.rollback-rel-a-20260101T000000Z"
[[ -d "$PRESERVED" ]] \
  && pass "the deploy names the preserved bundle after the operator-supplied --tag" \
  || fail "expected $PRESERVED, got $(ls -d "$APP"/dist.rollback-* 2>/dev/null)"

# The pointer is a recorded fact, not an inference from directory ordering.
grep -q "^ROLLBACK_DIR=$PRESERVED$" "$APP/.noramedi-frontend-release-state" \
  && pass "deploy records the exact preserved path in the state file" \
  || fail "state file does not record the preserved path: $(cat "$APP/.noramedi-frontend-release-state" 2>/dev/null)"

# Explicit target.
run bash "$FE" rollback --app-dir "$APP" --from "$PRESERVED" --tag undo-a
[[ "$CODE" -eq 0 ]] \
  && pass "explicit rollback exits 0" \
  || fail "rollback failed: $OUT"
[[ "$(live_token "$APP")" == "v1" ]] \
  && pass "the exact bundle named by --from is now the live one" \
  || fail "live bundle after rollback is '$(live_token "$APP")', expected v1"
[[ "$(bundle_token "$APP/dist.rollback-undo-a-20260101T000000Z")" == "v2" ]] \
  && pass "the bundle that was live before the rollback is preserved, so the rollback is itself reversible" \
  || fail "the rolled-back-from bundle was not preserved"
[[ ! -e "$PRESERVED" ]] \
  && pass "the restored bundle was moved, not copied — no duplicate left behind" \
  || fail "the rollback source still exists after being promoted"

# Undo the rollback via the recorded pointer, with no argument at all.
run bash "$FE" rollback --app-dir "$APP" --tag undo-b
[[ "$CODE" -eq 0 && "$(live_token "$APP")" == "v2" ]] \
  && pass "rollback with no --from uses the recorded pointer and restores the expected version" \
  || fail "pointer-driven rollback did not restore v2 (exit $CODE): $OUT"

# No pointer, no argument: refuse. Guessing is not a rollback contract.
APP="$(new_app app-nopointer)"
seed_bundle "$APP/dist" v1
mkdir -p "$APP/dist.rollback-tempting-20251231T000000Z"
seed_bundle "$APP/dist.rollback-tempting-20251231T000000Z" vguess
run bash "$FE" rollback --app-dir "$APP"
[[ "$CODE" -ne 0 ]] \
  && pass "rollback refuses when no target is given and none is recorded" \
  || fail "rollback guessed a target from the directory listing"
[[ "$(live_token "$APP")" == "v1" ]] \
  && pass "the tempting-looking directory was not promoted" \
  || fail "rollback promoted a guessed directory"

# ════════════════════════════════════════════════════════════════════════
section "H. Invalid rollback sources are refused"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-badsrc)"
seed_bundle "$APP/dist" v1
OUTSIDE="$WORK/outside-dist.rollback-evil"
seed_bundle "$OUTSIDE" vevil
mkdir -p "$APP/dist.rollback-notabundle-20260101T000000Z"
printf 'readme\n' > "$APP/dist.rollback-notabundle-20260101T000000Z/README"
SNAP_BEFORE="$(snapshot "$APP")"

run bash "$FE" rollback --app-dir "$APP" --from "$OUTSIDE"
[[ "$CODE" -ne 0 ]] \
  && pass "a rollback source outside the deployment root is refused" \
  || fail "rollback accepted a source outside the deployment root"

run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist"
[[ "$CODE" -ne 0 && "$OUT" == *"live bundle itself"* ]] \
  && pass "rollback source == the live bundle is refused, with a message naming that exact mistake" \
  || fail "rollback did not specifically refuse --from <app>/dist (exit $CODE): $OUT"

run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist.rollback-notabundle-20260101T000000Z"
[[ "$CODE" -ne 0 && "$OUT" == *"index.html"* ]] \
  && pass "a directory that is not a frontend build is refused even when correctly named" \
  || fail "rollback accepted a non-bundle directory (exit $CODE): $OUT"

run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist.rollback-does-not-exist"
[[ "$CODE" -ne 0 ]] \
  && pass "a non-existent rollback source is refused" \
  || fail "rollback accepted a non-existent source"

run bash "$FE" rollback --app-dir "$APP" --from "$APP/../etc"
[[ "$CODE" -ne 0 ]] \
  && pass "a traversal-shaped rollback source is refused" \
  || fail "rollback accepted a traversal path"

[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "no invalid-rollback attempt mutated anything under the deployment root" \
  || fail "an invalid rollback attempt mutated the deployment root"

# ════════════════════════════════════════════════════════════════════════
section "I. Path safety"
# ════════════════════════════════════════════════════════════════════════
# Every one of these aborts before the script performs any action at all;
# none of them can reach a rename, which is why it is safe to name them.
#
# Exit status alone is NOT a sufficient assertion here, and asserting only that
# was a real defect in an earlier revision of this file: with the safety guard
# deleted entirely, `--app-dir /` still exits non-zero, because /dist does not
# happen to exist and the initial-deploy guard catches it instead. The test
# passed while the protection was gone. So each case asserts that the refusal
# came from the DEPLOYMENT-ROOT guard specifically, by its own wording.
#
# /var/www and /usr/local are depth-2 and are caught only by the denylist;
# / /var /usr /etc /home /tmp are caught by the denylist or the depth floor.
root_guard_refused() {
  [[ "$CODE" -ne 0 && ( "$OUT" == *"as a deployment root"* || "$OUT" == *"too shallow"* ) ]]
}
for bad in / /var /var/www /usr /usr/local /etc /home /tmp; do
  run bash "$FE" deploy --app-dir "$bad" --dry-run
  root_guard_refused \
    && pass "the deployment-root guard refuses '$bad'" \
    || fail "'$bad' was not refused BY THE ROOT GUARD (exit $CODE): $OUT"
done

run bash "$FE" deploy --app-dir "" --dry-run
[[ "$CODE" -ne 0 && "$OUT" == *"requires a non-empty value"* ]] \
  && pass "refuses an empty --app-dir value rather than defaulting to somewhere" \
  || fail "an empty --app-dir was not cleanly refused (exit $CODE): $OUT"

run bash "$FE" deploy --app-dir "relative/path" --dry-run
[[ "$CODE" -ne 0 ]] \
  && pass "refuses a relative deployment root that does not resolve to a real directory" \
  || fail "accepted a relative deployment root"

run bash "$FE" deploy --app-dir "$WORK/does-not-exist" --dry-run
[[ "$CODE" -ne 0 && "$OUT" == *"does not exist"* ]] \
  && pass "refuses a non-existent deployment root, naming that reason" \
  || fail "a non-existent deployment root was not cleanly refused (exit $CODE): $OUT"

if [[ -n "${HOME:-}" && -d "${HOME:-}" ]]; then
  run bash "$FE" deploy --app-dir "$HOME" --dry-run
  [[ "$CODE" -ne 0 && "$OUT" == *"home directory"* ]] \
    && pass "the deployment-root guard refuses \$HOME by name" \
    || fail "\$HOME was not refused by the root guard (exit $CODE): $OUT"
fi

# A symlinked live bundle would send the rename somewhere the safety
# assertions never inspected.
APP="$(new_app app-symlink)"
ELSEWHERE="$WORK/elsewhere"
seed_bundle "$ELSEWHERE" vlink
if ln -s "$ELSEWHERE" "$APP/dist" 2>/dev/null && [[ -L "$APP/dist" ]]; then
  run bash "$FE" verify --app-dir "$APP"
  [[ "$CODE" -ne 0 && "$OUT" == *"symlink"* ]] \
    && pass "refuses to treat a symlinked live path as the live bundle" \
    || fail "a symlinked live path was accepted (exit $CODE): $OUT"
else
  # Windows/MSYS without developer mode cannot create a real symlink. Counted
  # and printed rather than passed silently: on the ubuntu-latest CI runner
  # that actually gates this repository, this branch never executes.
  SKIPPED=$((SKIPPED + 1))
  echo "  SKIPPED - this filesystem cannot create symlinks; the symlink guard was NOT exercised here (it is on CI)."
fi

# Tags become directory names, so they are path input too. Each candidate gets
# a FRESH deployment root: sharing one would let a leftover dist.next from the
# previous iteration abort the run, and the assertion would pass for a reason
# that has nothing to do with the tag.
for badtag in "../escape" "a/b" "with space" "\$(touch $WORK/pwned)" "\`touch $WORK/pwned2\`" ";touch $WORK/pwned3" "*" ".." "."; do
  APP="$(new_app "app-badtag-$RANDOM$RANDOM")"
  seed_bundle "$APP/dist" v1
  SNAP_BEFORE="$(snapshot "$APP")"
  run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
      bash "$FE" deploy --app-dir "$APP" --tag "$badtag" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
  if [[ "$CODE" -ne 0 && "$OUT" == *"tag"* && "$(snapshot "$APP")" == "$SNAP_BEFORE" ]]; then
    pass "refuses tag '$badtag' before touching anything"
  else
    fail "tag '$badtag' was not cleanly refused (exit $CODE): $OUT"
  fi
done
[[ ! -e "$WORK/pwned" && ! -e "$WORK/pwned2" && ! -e "$WORK/pwned3" ]] \
  && pass "no tag reached a shell as code" \
  || fail "COMMAND INJECTION: a tag was evaluated"

# A deployment root containing a space must work, not merely fail safely.
APP="$WORK/app with space"
mkdir -p "$APP"
seed_bundle "$APP/dist" v1
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --tag spaced --release-sha cccc1111dddd2222eeee3333ffff444455556666
[[ "$CODE" -eq 0 && "$(live_token "$APP")" == "v2" ]] \
  && pass "a deployment root containing a space deploys correctly (quoting is intact end to end)" \
  || fail "deploy broke on a path with a space (exit $CODE): $OUT"
run bash "$FE" rollback --app-dir "$APP" --tag spacedback
[[ "$CODE" -eq 0 && "$(live_token "$APP")" == "v1" ]] \
  && pass "rollback works on a path containing a space" \
  || fail "rollback broke on a path with a space (exit $CODE): $OUT"

# ════════════════════════════════════════════════════════════════════════
section "J. Dry run performs zero mutations"
# ════════════════════════════════════════════════════════════════════════
APP="$(new_app app-dryrun)"
seed_bundle "$APP/dist" v1
seed_bundle "$APP/dist.rollback-old-20250101T000000Z" v0
SNAP_BEFORE="$(snapshot "$APP")"

run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_exe "$(build_ok_body v2); touch $WORK/build-ran")" \
    bash "$FE" deploy --app-dir "$APP" --dry-run --release-sha eeee1111ffff2222aaaa3333bbbb4444cccc5555
[[ "$CODE" -eq 0 ]] \
  && pass "dry-run deploy exits 0" \
  || fail "dry-run deploy failed: $OUT"
[[ ! -e "$WORK/build-ran" ]] \
  && pass "dry run does not run the build" \
  || fail "dry run executed the build command"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "dry-run deploy changed nothing under the deployment root — no rename, no delete, no state file" \
  || fail "dry-run deploy mutated the deployment root"
[[ "$OUT" == *"DRY RUN"* && "$OUT" == *"would promote"* ]] \
  && pass "dry-run deploy prints the intended promotion" \
  || fail "dry-run deploy did not print its intended actions: $OUT"

run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist.rollback-old-20250101T000000Z" --dry-run
[[ "$CODE" -eq 0 ]] \
  && pass "dry-run rollback exits 0" \
  || fail "dry-run rollback failed: $OUT"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "dry-run rollback changed nothing under the deployment root" \
  || fail "dry-run rollback mutated the deployment root"

run bash "$FE" verify --app-dir "$APP"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "verify is read-only" \
  || fail "verify mutated the deployment root"

# ════════════════════════════════════════════════════════════════════════
section "K. The script never deletes, and never prints a secret"
# ════════════════════════════════════════════════════════════════════════
# Every invocation in this suite ran with DATABASE_URL, SENTRY_DSN and a token
# carrying CANARY in the environment. The strongest form of this assertion is
# structural: the file contains no deletion primitive at all.
# Whole-line comments are blanked first so the prose describing these rules
# cannot satisfy the check that enforces them.
CODE_ONLY="$WORK/deploy-code-only.sh"
sed -E 's/^[[:space:]]*#.*$//' "$FE" > "$CODE_ONLY"

if grep -qE '(^|[^[:alnum:]_/])rm([[:space:]]|$)' "$CODE_ONLY"; then
  fail "the deploy script contains an rm invocation: $(grep -nE '(^|[^[:alnum:]_/])rm([[:space:]]|$)' "$CODE_ONLY" | head -3)"
else
  pass "the deploy script contains no rm at all — a superseded bundle can only ever be moved"
fi
if grep -qE '(shred|unlink|rmdir|truncate|-delete)([[:space:]]|$)' "$CODE_ONLY"; then
  fail "the deploy script contains another deletion primitive: $(grep -nE '(shred|unlink|rmdir|truncate|-delete)([[:space:]]|$)' "$CODE_ONLY" | head -3)"
else
  pass "the deploy script contains no other deletion primitive"
fi
# printenv / env dumps / declare -p are the classic way a deploy log acquires a DSN.
if grep -qE '(printenv|declare[[:space:]]+-p|^[[:space:]]*env[[:space:]]*$|env[[:space:]]*\|)' "$CODE_ONLY"; then
  fail "the deploy script may dump the environment: $(grep -nE '(printenv|declare[[:space:]]+-p|^[[:space:]]*env[[:space:]]*$|env[[:space:]]*\|)' "$CODE_ONLY" | head -3)"
else
  pass "the deploy script never dumps the environment"
fi

APP="$(new_app app-canary)"
seed_bundle "$APP/dist" v1
LEAKED=0
for args in \
  "deploy --app-dir $APP --dry-run --release-sha ffff1111aaaa2222bbbb3333cccc4444dddd5555" \
  "verify --app-dir $APP" \
  "rollback --app-dir $APP" \
  "help"
do
  # shellcheck disable=SC2086
  run bash "$FE" $args
  [[ "$OUT" == *"$CANARY"* ]] && LEAKED=$((LEAKED + 1))
done
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --tag canary --release-sha ffff1111aaaa2222bbbb3333cccc4444dddd5555
[[ "$OUT" == *"$CANARY"* ]] && LEAKED=$((LEAKED + 1))
BIN="$FAILBIN"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v3)" \
    bash "$FE" deploy --app-dir "$APP" --tag canary2 --release-sha ffff1111aaaa2222bbbb3333cccc4444dddd6666
[[ "$OUT" == *"$CANARY"* ]] && LEAKED=$((LEAKED + 1))

[[ "$LEAKED" -eq 0 ]] \
  && pass "no command path — success, failure, restoration, dry run or help — printed the environment canary" \
  || fail "SECRET LEAK: the canary appeared in the output of $LEAKED command path(s)"

# ════════════════════════════════════════════════════════════════════════
section "L. Interface and shell hygiene"
# ════════════════════════════════════════════════════════════════════════
bash -n "$FE" \
  && pass "the deploy script parses (bash -n)" \
  || fail "the deploy script has a syntax error"
bash -n "$SCRIPT_DIR/noramedi-frontend-deploy.test.sh" \
  && pass "this test file parses (bash -n)" \
  || fail "this test file has a syntax error"

run bash "$FE"
[[ "$CODE" -ne 0 ]] && pass "refuses to run with no command" || fail "ran with no command"
run bash "$FE" definitely-not-a-command
[[ "$CODE" -ne 0 ]] && pass "refuses an unknown command" || fail "accepted an unknown command"
run bash "$FE" deploy --not-a-real-flag
[[ "$CODE" -ne 0 ]] && pass "refuses an unknown deploy option" || fail "accepted an unknown deploy option"
run bash "$FE" help
[[ "$CODE" -eq 0 && "$OUT" == *"TWO-STEP SAME-FILESYSTEM RENAME PROMOTION"* ]] \
  && pass "help states the promotion semantics verbatim" \
  || fail "help does not carry the promotion-semantics wording"
[[ "$OUT" == *"NOT A SINGLE ATOMIC EXCHANGE"* ]] \
  && pass "help states that promotion is not a single atomic exchange" \
  || fail "help omits the not-atomic wording"

# ── the F4-1A2 lesson: a shell test that CI never executes is not a test ──
# Nothing else in this repository asserts that a scripts/*.test.sh file is
# reachable from `npm run test:shell`. Without this, a sibling suite added
# later could sit in the tree, pass `bash -n`, and never once run.
PKG="$(cd "$SCRIPT_DIR/.." && pwd)/package.json"
UNWIRED=""
for t in "$SCRIPT_DIR"/*.test.sh; do
  base="$(basename -- "$t")"
  grep -q "scripts/$base" "$PKG" || UNWIRED="$UNWIRED $base"
done
[[ -z "$UNWIRED" ]] \
  && pass "every scripts/*.test.sh is referenced by package.json" \
  || fail "shell suites exist that no npm script runs:$UNWIRED"

CHAIN="$(node -e 'process.stdout.write(require(process.argv[1]).scripts["test:shell"]||"")' "$PKG" 2>/dev/null)"
if [[ -n "$CHAIN" ]]; then
  MISSING=""
  for t in "$SCRIPT_DIR"/*.test.sh; do
    base="$(basename -- "$t")"
    key="$(node -e '
      const s = require(process.argv[1]).scripts;
      const want = "scripts/" + process.argv[2];
      const hit = Object.keys(s).find(k => k.startsWith("test:shell:") && s[k].includes(want));
      process.stdout.write(hit || "");
    ' "$PKG" "$base" 2>/dev/null)"
    [[ -n "$key" && "$CHAIN" == *"$key"* ]] || MISSING="$MISSING $base"
  done
  [[ -z "$MISSING" ]] \
    && pass "every scripts/*.test.sh is chained into the aggregate 'npm run test:shell' CI runs" \
    || fail "shell suites are not reachable from 'npm run test:shell':$MISSING"
else
  fail "package.json has no test:shell script — the CI shell lane would run nothing"
fi

# ════════════════════════════════════════════════════════════════════════
section "M. An UNDETERMINED filesystem device refuses the operation (R1 blocker 1)"
# ════════════════════════════════════════════════════════════════════════
# The promotion contract is a same-filesystem rename. This precondition used to
# WARN and continue when `stat` could not report a device — a fail-closed
# contract failing OPEN on precisely the hosts where nothing had verified it.
# Driven for real with a `stat` on PATH that cannot report a device; the
# production script has no hook for this.
#
# Every case here asserts the refusal came from THIS check by its own wording.
# Asserting only a non-zero exit is what let a deleted path-safety guard survive
# mutation B earlier in this task.

APP="$(new_app app-nodev-deploy)"
seed_bundle "$APP/dist" v1
SNAP_BEFORE="$(snapshot "$APP")"
BIN="$NOSTATBIN"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha 1111222233334444555566667777888899990000
[[ "$CODE" -ne 0 && "$OUT" == *"UNVERIFIABLE"* ]] \
  && pass "deploy REFUSES when the filesystem device cannot be determined" \
  || fail "deploy did not fail closed on an undetermined device (exit $CODE): $OUT"
[[ "$OUT" == *"UNCHANGED"* ]] \
  && pass "the refusal tells the operator the live bundle is unchanged" \
  || fail "the refusal does not state the live state: $OUT"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "not one byte under the deployment root changed — the check precedes the build and both renames" \
  || fail "the deployment root was mutated despite an unverifiable device"
[[ ! -e "$APP/.noramedi-frontend-release-state" ]] \
  && pass "no rollback state was recorded" \
  || fail "a state file was written despite the refusal"

BIN="$NOSTATBIN"
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --dry-run --release-sha 1111222233334444555566667777888899990000
[[ "$CODE" -ne 0 && "$OUT" == *"UNVERIFIABLE"* ]] \
  && pass "dry-run deploy reports that the real operation would REFUSE" \
  || fail "dry-run deploy did not report the refusal (exit $CODE): $OUT"
[[ "$OUT" == *"DRY RUN"* ]] \
  && pass "the dry-run refusal says explicitly that nothing was changed" \
  || fail "the dry-run refusal does not distinguish itself from a real one: $OUT"
[[ "$OUT" != *"DRY RUN complete"* ]] \
  && pass "a dry run never reports the deployment as safe when the real one would fail" \
  || fail "the dry run declared success on a host where the deploy would refuse: $OUT"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "dry-run refusal mutated nothing" \
  || fail "the dry-run refusal mutated the deployment root"

APP="$(new_app app-nodev-rollback)"
seed_bundle "$APP/dist" v2
seed_bundle "$APP/dist.rollback-manual-20260101T000000Z" v1
SNAP_BEFORE="$(snapshot "$APP")"
BIN="$NOSTATBIN"
run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist.rollback-manual-20260101T000000Z"
[[ "$CODE" -ne 0 && "$OUT" == *"UNVERIFIABLE"* ]] \
  && pass "rollback REFUSES when the filesystem device cannot be determined" \
  || fail "rollback did not fail closed on an undetermined device (exit $CODE): $OUT"
[[ "$(live_token "$APP")" == "v2" ]] \
  && pass "the live bundle is still the pre-rollback one" \
  || fail "the live bundle changed during a refused rollback"
[[ "$(snapshot "$APP")" == "$SNAP_BEFORE" ]] \
  && pass "not one byte changed during the refused rollback" \
  || fail "the deployment root was mutated during a refused rollback"

BIN="$NOSTATBIN"
run bash "$FE" rollback --app-dir "$APP" --dry-run --from "$APP/dist.rollback-manual-20260101T000000Z"
[[ "$CODE" -ne 0 && "$OUT" == *"UNVERIFIABLE"* && "$OUT" != *"DRY RUN complete"* ]] \
  && pass "dry-run rollback reports the refusal instead of reporting success" \
  || fail "dry-run rollback did not report the refusal (exit $CODE): $OUT"

# Positive control: with a working `stat` the identical rollback succeeds. Without
# this, the four assertions above could be passing for any reason at all.
run bash "$FE" rollback --app-dir "$APP" --from "$APP/dist.rollback-manual-20260101T000000Z"
[[ "$CODE" -eq 0 && "$(live_token "$APP")" == "v1" ]] \
  && pass "the same rollback succeeds once the device CAN be determined (the refusals above are attributable)" \
  || fail "the control rollback failed, so section M proves nothing (exit $CODE): $OUT"

# ════════════════════════════════════════════════════════════════════════
section "N. The build is a fixed command, never an evaluated string (R1 blocker 2)"
# ════════════════════════════════════════════════════════════════════════
# The script used to accept a build COMMAND STRING from the environment and
# evaluate it — arbitrary code execution in a tool an operator runs against
# production, present only to make this suite possible. It now runs a fixed
# argument vector, and the only substitution point is an executable file.

if grep -qE '(^|[^[:alnum:]_])eval([^[:alnum:]_]|$)' "$CODE_ONLY"; then
  fail "the deploy script evaluates a string: $(grep -nE '(^|[^[:alnum:]_])eval([^[:alnum:]_]|$)' "$CODE_ONLY" | head -3)"
else
  pass "the deploy script contains no eval at all"
fi
if grep -qE '(bash|sh|zsh|dash)[[:space:]]+-c' "$CODE_ONLY"; then
  fail "the deploy script hands a string to a shell: $(grep -nE '(bash|sh|zsh|dash)[[:space:]]+-c' "$CODE_ONLY" | head -3)"
else
  pass "the deploy script never invokes a shell with -c on any value"
fi
if grep -q 'BUILD_CMD' "$FE"; then
  fail "the removed shell-string build seam is still referenced: $(grep -n 'BUILD_CMD' "$FE" | head -3)"
else
  pass "the shell-string build seam is gone from the script entirely, comments included"
fi
if grep -q 'BUILD_ARGV=(npm run build -- --outDir dist.next)' "$FE"; then
  pass "the production build is a fixed argument vector: npm run build -- --outDir dist.next"
else
  fail "the fixed production build argument vector is missing or changed shape"
fi

# build_reject LABEL VALUE EXPECT [SIDE_EFFECT_PATH]
build_reject() {
  local label="$1" value="$2" expect="$3" side="${4-}"
  local app; app="$(new_app "app-bexe-$RANDOM$RANDOM")"
  seed_bundle "$app/dist" v1
  local before; before="$(snapshot "$app")"
  run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$value" \
      bash "$FE" deploy --app-dir "$app" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
  [[ "$CODE" -ne 0 && "$OUT" == *"$expect"* ]] \
    && pass "refuses $label" \
    || fail "accepted $label, or refused it for the wrong reason (exit $CODE): $OUT"
  [[ "$(snapshot "$app")" == "$before" ]] \
    && pass "nothing under the deployment root changed while refusing $label" \
    || fail "the deployment root was mutated while refusing $label"
  if [[ -n "$side" ]]; then
    [[ ! -e "$side" ]] \
      && pass "the value was NOT interpreted as shell code ($label — its side effect never happened)" \
      || fail "the value was executed as shell code: '$side' exists ($label)"
  fi
}

build_reject "a bare command name (would be resolved through PATH)" \
  "npm" "must be an absolute path"
build_reject "a shell command STRING rather than a path" \
  "printf x > $WORK/pwned-relative" "must be an absolute path" "$WORK/pwned-relative"
build_reject "an absolute-looking shell command string with a redirect" \
  "/bin/sh -c 'printf x > $WORK/pwned-absolute'" "does not exist" "$WORK/pwned-absolute"
build_reject "an absolute path with shell metacharacters appended" \
  "/bin/echo hi; printf x > $WORK/pwned-semicolon" "does not exist" "$WORK/pwned-semicolon"
build_reject "an executable that does not exist" \
  "/nonexistent-build-helper-$RANDOM" "does not exist"
build_reject "a directory" \
  "$WORK" "is a directory"

NOEXEC="$WORK/not-executable-helper.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$NOEXEC"
chmod -x "$NOEXEC" 2>/dev/null || true
if [[ -x "$NOEXEC" ]]; then
  SKIPPED=$((SKIPPED + 1))
  echo "  SKIPPED - this filesystem reports every file as executable; the non-executable-override guard was NOT exercised here (it is on CI)."
else
  build_reject "a regular file that is not executable" "$NOEXEC" "is not executable"
fi

# Using the seam at all must be conspicuous: a production run that somehow has it
# set should say so in the deploy log rather than build something unexpected
# silently.
APP="$(new_app app-bexe-warn)"
seed_bundle "$APP/dist" v1
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha aaaa1111bbbb2222cccc3333dddd4444eeee5555
[[ "$CODE" -eq 0 && "$OUT" == *"WARNING"* && "$OUT" == *"NORAMEDI_FRONTEND_BUILD_EXECUTABLE"* ]] \
  && pass "an overridden build executable succeeds but is reported as a WARNING in the log" \
  || fail "the build override was used without a visible warning (exit $CODE): $OUT"
[[ "$(live_token "$APP")" == "v2" ]] \
  && pass "the overridden executable is actually run (it produced the promoted bundle)" \
  || fail "the override did not produce the live bundle"

# ════════════════════════════════════════════════════════════════════════
section "O. Release identity contract (R1 blocker 3)"
# ════════════════════════════════════════════════════════════════════════
# releaseSha is PUBLIC metadata: dist/release.json is served to anyone. It used
# to be interpolated into JSON unvalidated, so a quote or a newline produced a
# malformed marker and arbitrary text in operator output.
#
# The accepted shape is the one the rest of the program already produces —
# noramedi-deploy.sh:182 and ecosystem.config.cjs both resolve `git rev-parse
# HEAD` or the literal "unknown" — so 40/64 lowercase hex, or that sentinel.

json_of() { node -e '
  const fs = require("fs");
  const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(process.argv[2] === "@keys"
    ? Object.keys(o).sort().join(",")
    : String(o[process.argv[2]]));
' "$1" "$2" 2>/dev/null; }

sha_reject() {
  local label="$1" sha="$2" expect="${3:-not a valid release identity}" side="${4-}"
  local app; app="$(new_app "app-sha-$RANDOM$RANDOM")"
  seed_bundle "$app/dist" v1
  local before; before="$(snapshot "$app")"
  run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
      bash "$FE" deploy --app-dir "$app" --release-sha "$sha"
  [[ "$CODE" -ne 0 && "$OUT" == *"$expect"* ]] \
    && pass "refuses $label" \
    || fail "accepted $label, or refused it for the wrong reason (exit $CODE): $OUT"
  [[ "$(snapshot "$app")" == "$before" ]] \
    && pass "nothing under the deployment root changed while refusing $label" \
    || fail "the deployment root was mutated while refusing $label"
  if [[ -n "$side" ]]; then
    [[ ! -e "$side" ]] \
      && pass "the rejected identity was never interpreted as code ($label)" \
      || fail "the release identity was executed as shell code ($label)"
  fi
}

sha_reject "a double quote (it would break the JSON marker)" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee55"5'
sha_reject "a JSON field-injection attempt" \
  'x", "builtBy": "somebody-else'
sha_reject "an embedded newline" \
  "$(printf 'aaaa1111bbbb2222cccc3333dddd4444eeee5555\nx')"
sha_reject "an embedded carriage return" \
  "$(printf 'aaaa1111bbbb2222cccc3333dddd4444eeee5555\rx')"
sha_reject "an embedded tab" \
  "$(printf 'aaaa1111bbbb2222cccc3333dddd4444eeee5555\tx')"
sha_reject "an embedded space" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee555 5'
sha_reject "a backslash" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee555\5'
sha_reject "a slash (it would look like a path component)" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee5/55'
sha_reject "a shell-looking value" \
  "\$(printf x > $WORK/sha-pwned)" "not a valid release identity" "$WORK/sha-pwned"
sha_reject "a backtick-looking value" \
  "\`printf x > $WORK/sha-pwned-tick\`" "not a valid release identity" "$WORK/sha-pwned-tick"
sha_reject "an abbreviated 12-character SHA (nothing in this repository produces one)" \
  'aaaa1111bbbb'
sha_reject "a 39-character near-miss" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee555'
sha_reject "a 41-character near-miss" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee55551'
sha_reject "non-hex characters of the right length" \
  'zzzz1111bbbb2222cccc3333dddd4444eeee5555'
sha_reject "arbitrary prose" \
  'the release we deployed on tuesday'

# Uppercase hex is a valid SHA typed the wrong way; it gets its own message,
# because silently accepting it would report a release skew that does not exist.
sha_reject "an UPPERCASE hex SHA" \
  'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555' 'hex but not lowercase'

# An overlong blob must be refused without echoing it back into the deploy log.
LONG_SHA="$(printf 'a%.0s' {1..500})"
APP="$(new_app app-sha-long)"
seed_bundle "$APP/dist" v1
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$APP" --release-sha "$LONG_SHA"
[[ "$CODE" -ne 0 && "$OUT" == *"not a valid release identity"* ]] \
  && pass "refuses a 500-character release identity" \
  || fail "accepted an overlong release identity (exit $CODE): $OUT"
[[ "$OUT" == *"truncated, 500 chars"* ]] \
  && pass "the overlong value is summarised, not echoed whole into the deploy log" \
  || fail "the error message does not bound the value it reports: $OUT"

# --expect-sha is operator-supplied too, and a malformed one must not be
# reported as a production release mismatch.
run bash "$FE" verify --app-dir "$APP" --expect-sha 'not a sha'
[[ "$CODE" -ne 0 && "$OUT" == *"not a valid release identity"* ]] \
  && pass "verify refuses a malformed --expect-sha instead of reporting a mismatch" \
  || fail "verify accepted a malformed --expect-sha (exit $CODE): $OUT"

# ── the accepted values, and the marker they produce ─────────────────────
accept_case() {
  local label="$1" sha="$2" tagdir="$3"
  local app; app="$(new_app "app-shaok-$RANDOM$RANDOM")"
  seed_bundle "$app/dist" v1
  run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
      bash "$FE" deploy --app-dir "$app" --release-sha "$sha"
  [[ "$CODE" -eq 0 ]] \
    && pass "accepts $label" \
    || fail "refused $label (exit $CODE): $OUT"
  [[ "$(json_of "$app/dist/release.json" @keys)" == "builtAt,builtBy,releaseSha,task" ]] \
    && pass "release.json parses as JSON and carries exactly the four documented fields ($label)" \
    || fail "release.json is not valid JSON or its field set changed ($label): $(cat "$app/dist/release.json" 2>/dev/null)"
  [[ "$(json_of "$app/dist/release.json" releaseSha)" == "$sha" ]] \
    && pass "the parsed releaseSha is exactly the accepted value ($label)" \
    || fail "releaseSha round-tripped wrong ($label)"
  [[ -d "$app/$tagdir" ]] \
    && pass "the preserved bundle is named from the accepted identity ($label)" \
    || fail "expected preserved bundle '$tagdir' ($label); got: $(ls -d "$app"/dist.rollback-* 2>/dev/null)"
}

accept_case "a 40-character lowercase SHA-1" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee5555' 'dist.rollback-aaaa1111bbbb-20260101T000000Z'
accept_case "a 64-character lowercase SHA-256 object id" \
  'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888' 'dist.rollback-aaaa1111bbbb-20260101T000000Z'
accept_case "the exact \"unknown\" sentinel the rest of the program already uses" \
  'unknown' 'dist.rollback-manual-20260101T000000Z'

# ════════════════════════════════════════════════════════════════════════
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed, $SKIPPED skipped"
[[ "$SKIPPED" -eq 0 ]] || echo "NOTE: $SKIPPED check(s) could not run on this platform — see the SKIPPED line(s) above."
[[ "$FAILED" -eq 0 ]] || exit 1

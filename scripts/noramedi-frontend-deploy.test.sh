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
section "P. Public verification is decided by the served marker, not by HTTP status (F3-PROD-005)"
# ════════════════════════════════════════════════════════════════════════
# `verify --url` is the ONLY check that can establish "nginx serves the
# directory this script promotes", so its soundness is the whole value of the
# R-038 closure evidence. F3-PROD-005 read the live production site before any
# deploy and found the original status-code-only check wrong in both
# directions: `GET /` answers 302 (a redirect to /login), which failed a
# healthy site; and `GET /release.json` answered 200 with index.html via the
# SPA fallback, which passed a host that had no release marker at all.
#
# Both production behaviours are reproduced here by a `curl` on PATH. The fake
# only follows the redirect when -L is actually passed, so removing -L from the
# production script turns a test red rather than quietly passing.

CURLBIN="$WORK/curlbin"
mkdir -p "$CURLBIN"
write_fake_date "$CURLBIN"
cat > "$CURLBIN/curl" <<'FAKECURL'
#!/usr/bin/env bash
follow=0; url=""; wfmt=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -L|--location)            follow=1; shift ;;
    -w|--write-out)           wfmt="${2-}"; shift 2 ;;
    --max-redirs|--max-time)  shift 2 ;;
    --)                       shift ;;
    -*)                       shift ;;
    *)                        url="$1"; shift ;;
  esac
done

# An unreachable host: curl itself fails and writes nothing at all.
[[ "${FAKE_SITE_DOWN:-0}" == "1" ]] && exit 7

rest="${url#*://}"
origin="${url%%://*}://${rest%%/*}"
if [[ "$rest" == */* ]]; then path="/${rest#*/}"; else path="/"; fi
eff="$url"

# The write-out format is expanded the way curl expands it, so the production
# script's -w string is exercised rather than assumed: drop %{url_effective}
# from it and the origin checks below stop receiving a URL.
emit() {
  printf '%s' "$1"
  if [[ -n "$wfmt" ]]; then
    out="$wfmt"
    out="${out//'%{http_code}'/$2}"
    out="${out//'%{url_effective}'/$eff}"
    printf '%s' "$out"
  fi
  exit 0
}

# Production answers `GET /` with a 302 to /login.
if [[ "$path" == "/" && "${FAKE_SITE_ROOT_302:-0}" == "1" ]]; then
  if [[ "$follow" == "1" ]]; then
    path="/login"; eff="$origin/login"
  else
    emit '<html><head><title>302 Found</title></head></html>' 302
  fi
fi

# A redirect on the marker path. The target serves the SAME marker file: the
# only thing under test is where the answer came from.
if [[ "$path" == "/release.json" && -n "${FAKE_SITE_MARKER_REDIRECT:-}" ]]; then
  if [[ "$follow" == "1" ]]; then
    eff="$FAKE_SITE_MARKER_REDIRECT"
  else
    emit '<html><head><title>302 Found</title></head></html>' 302
  fi
fi

root="${FAKE_SITE_DIR:-}"
if [[ -f "$root$path" ]]; then
  status=200
  # A host that answers the marker path with an error while still returning a
  # body — the R2-R1 case that body-only validation could not reject.
  if [[ "$path" == "/release.json" && -n "${FAKE_SITE_MARKER_STATUS:-}" ]]; then
    status="$FAKE_SITE_MARKER_STATUS"
  fi
  emit "$(cat "$root$path")" "$status"
elif [[ "${FAKE_SITE_SPA:-0}" == "1" && -f "$root/index.html" ]]; then
  # try_files $uri /index.html — 200, but it is the app, not the file asked for.
  emit "$(cat "$root/index.html")" 200
fi
emit '<html><head><title>404 Not Found</title></head></html>' 404
FAKECURL
chmod +x "$CURLBIN/curl"

export FAKE_SITE_DIR="" FAKE_SITE_ROOT_302=0 FAKE_SITE_SPA=0 FAKE_SITE_DOWN=0
export FAKE_SITE_MARKER_STATUS="" FAKE_SITE_MARKER_REDIRECT=""

PSHA='1111222233334444555566667777888899990000'
OTHER_SHA='aaaabbbbccccddddeeeeffff0000111122223333'

PAPP="$(new_app app-public)"
seed_bundle "$PAPP/dist" p1
run env NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok p2)" \
    bash "$FE" deploy --app-dir "$PAPP" --release-sha "$PSHA"
[[ "$CODE" -eq 0 ]] \
  && pass "a bundle is deployed to verify against" \
  || fail "setup deploy failed (exit $CODE): $OUT"

# ── P1. The production pre-deploy shape: SPA fallback answers 200 for a
#        release.json that does not exist anywhere on the host. ────────────
SITE_NOMARKER="$WORK/site-nomarker"
mkdir -p "$SITE_NOMARKER"
cp -r "$PAPP/dist/." "$SITE_NOMARKER/"
rm -f "$SITE_NOMARKER/release.json"

FAKE_SITE_DIR="$SITE_NOMARKER"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test

[[ "$CODE" -ne 0 ]] \
  && pass "verify FAILS when the site serves the SPA fallback instead of a release marker" \
  || fail "verify passed against a host serving no release marker at all: $OUT"
[[ "$OUT" == *"PUBLIC_RELEASE_SHA         = NOT_SERVED"* ]] \
  && pass "a 200-with-no-marker is reported as NOT_SERVED, not as a served marker" \
  || fail "the fallback response was not reported as NOT_SERVED: $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED"* ]] \
  && pass "the nginx-serves-promoted-dist claim is NOT_VERIFIED on a fallback response" \
  || fail "the script claimed the promoted dist is served on fallback HTML: $OUT"

# ── P2. A healthy site whose root redirects must PASS. ───────────────────
SITE_OK="$WORK/site-ok"
mkdir -p "$SITE_OK"
cp -r "$PAPP/dist/." "$SITE_OK/"

FAKE_SITE_DIR="$SITE_OK"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test --expect-sha "$PSHA"

[[ "$CODE" -eq 0 ]] \
  && pass "a 302 on / does not fail verification when the redirect resolves to a 2xx" \
  || fail "verify failed against a healthy site whose root redirects (exit $CODE): $OUT"
[[ "$OUT" == *"PUBLIC_RELEASE_SHA         = $PSHA"* ]] \
  && pass "the served marker's releaseSha is parsed out of the response body" \
  || fail "the served releaseSha was not reported: $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = VERIFIED"* ]] \
  && pass "served marker == promoted bundle is reported as VERIFIED" \
  || fail "the script withheld VERIFIED on a genuinely served marker: $OUT"
[[ "$OUT" != *"$CANARY"* ]] \
  && pass "public verification prints no environment secret" \
  || fail "a planted secret reached the public-verification output"

# ── P3. The site serves a DIFFERENT release than the bundle on disk. ─────
SITE_SKEW="$WORK/site-skew"
mkdir -p "$SITE_SKEW"
cp -r "$PAPP/dist/." "$SITE_SKEW/"
printf '{\n  "releaseSha": "%s",\n  "builtAt": "2026-01-01T00:00:00Z",\n  "builtBy": "noramedi-frontend-deploy.sh",\n  "task": "F3-PROD-004"\n}\n' \
  "$OTHER_SHA" > "$SITE_SKEW/release.json"

FAKE_SITE_DIR="$SITE_SKEW"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test

[[ "$CODE" -ne 0 ]] \
  && pass "verify fails when the served marker names a different release than the live bundle" \
  || fail "verify accepted a served release that is not the promoted one: $OUT"
[[ "$OUT" == *"PUBLIC_SHA_MATCHES_LOCAL   = NO"* ]] \
  && pass "the served-vs-promoted disagreement is reported as PUBLIC_SHA_MATCHES_LOCAL = NO" \
  || fail "the disagreement was not reported: $OUT"

# ── P4. A served marker whose releaseSha is not a valid release identity is
#        reported as INVALID and never echoed back. ──────────────────────
SITE_BAD="$WORK/site-bad"
mkdir -p "$SITE_BAD"
cp -r "$PAPP/dist/." "$SITE_BAD/"
printf '{ "releaseSha": "%s" }\n' 'NOT-a-release-identity' > "$SITE_BAD/release.json"

FAKE_SITE_DIR="$SITE_BAD"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test

[[ "$CODE" -ne 0 ]] \
  && pass "verify fails on a served marker carrying a malformed release identity" \
  || fail "verify accepted a malformed served release identity: $OUT"
[[ "$OUT" == *"PUBLIC_RELEASE_SHA         = INVALID"* && "$OUT" != *"NOT-a-release-identity"* ]] \
  && pass "the malformed served value is reported as INVALID, not echoed into the log" \
  || fail "the malformed served value was echoed or mis-reported: $OUT"

# ── P5. An unreachable site fails; it is never treated as "nothing to check".
FAKE_SITE_DIR="$SITE_OK"; FAKE_SITE_ROOT_302=0; FAKE_SITE_SPA=1; FAKE_SITE_DOWN=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test
FAKE_SITE_DOWN=0

[[ "$CODE" -ne 0 ]] \
  && pass "an unreachable site fails verification rather than being skipped" \
  || fail "verify passed against an unreachable site: $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED"* ]] \
  && pass "an unreachable site never yields a VERIFIED serving claim" \
  || fail "the script claimed VERIFIED against an unreachable site: $OUT"

# ── P6. The R-038 condition itself: no marker on disk AND none served. ───
QAPP="$(new_app app-premarker)"
seed_bundle "$QAPP/dist" q1     # a pre-F3-PROD-004 bundle: no release.json
FAKE_SITE_DIR="$SITE_NOMARKER"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$QAPP" --url https://site.test

[[ "$CODE" -ne 0 ]] \
  && pass "a pre-marker bundle behind an SPA fallback fails verification (the R-038 condition)" \
  || fail "the R-038 condition passed verification: $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED"* ]] \
  && pass "no serving claim is made when neither side has a marker" \
  || fail "a serving claim was made with no marker on either side: $OUT"

# ── P7/P8. A non-success response is not a served file, however good its
#          body looks. This is the F3-PROD-004-R2-R1 blocker: the first
#          correction moved the verdict onto the body and, in doing so, let a
#          404 or a 500 carrying a perfectly valid matching marker establish
#          production serving evidence. ────────────────────────────────────
error_status_case() {
  local status="$1"
  FAKE_SITE_DIR="$SITE_OK"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
  FAKE_SITE_MARKER_STATUS="$status"
  BIN="$CURLBIN"
  run bash "$FE" verify --app-dir "$PAPP" --url https://site.test
  FAKE_SITE_MARKER_STATUS=""

  [[ "$CODE" -ne 0 ]] \
    && pass "verify fails when /release.json answers $status, even with a valid matching marker body" \
    || fail "a $status response established serving evidence: $OUT"
  [[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED"* ]] \
    && pass "a $status marker response never yields a VERIFIED serving claim" \
    || fail "the script claimed VERIFIED on a $status marker response: $OUT"
  [[ "$OUT" == *"PUBLIC_RELEASE_SHA         = NOT_SERVED"* && "$OUT" != *"PUBLIC_RELEASE_SHA         = $PSHA"* ]] \
    && pass "the body of a $status response is not read as a served marker at all" \
    || fail "a $status response body was parsed and reported as a served marker: $OUT"
  [[ "$OUT" == *"PUBLIC_MARKER_STATUS       = $status"* ]] \
    && pass "the marker response's own HTTP status is recorded as $status" \
    || fail "the marker HTTP status was not recorded: $OUT"
}

error_status_case 404
error_status_case 500

# ── P9. A SAME-ORIGIN redirect on the marker path is acceptable: the answer
#        still comes from the host that was asked about. ──────────────────
FAKE_SITE_DIR="$SITE_OK"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
FAKE_SITE_MARKER_REDIRECT="https://site.test/static/release.json"
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test
FAKE_SITE_MARKER_REDIRECT=""

[[ "$CODE" -eq 0 ]] \
  && pass "a same-origin redirect to the marker passes verification" \
  || fail "a same-origin redirect was refused (exit $CODE): $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = VERIFIED"* ]] \
  && pass "a same-origin redirect still establishes the serving claim" \
  || fail "the serving claim was withheld after a same-origin redirect: $OUT"
[[ "$OUT" == *"PUBLIC_MARKER_URL          = https://site.test/static/release.json"* ]] \
  && pass "the marker's final effective URL is recorded, not just its status" \
  || fail "the effective URL of the marker response was not recorded: $OUT"
[[ "$OUT" == *"PUBLIC_ROOT_URL            = https://site.test/login"* ]] \
  && pass "the app root's final effective URL is recorded after the redirect" \
  || fail "the effective URL of the root response was not recorded: $OUT"

# ── P10. A CROSS-ORIGIN redirect is not. A valid, matching marker fetched
#         from another host is a fact about that host. ────────────────────
FAKE_SITE_DIR="$SITE_OK"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
FAKE_SITE_MARKER_REDIRECT="https://elsewhere.test/release.json"
BIN="$CURLBIN"
run bash "$FE" verify --app-dir "$PAPP" --url https://site.test
FAKE_SITE_MARKER_REDIRECT=""

[[ "$CODE" -ne 0 ]] \
  && pass "verify fails when the marker request is redirected to another origin" \
  || fail "a cross-origin marker response established serving evidence: $OUT"
[[ "$OUT" == *"NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED"* ]] \
  && pass "a cross-origin marker response never yields a VERIFIED serving claim" \
  || fail "the script claimed VERIFIED from a foreign origin: $OUT"
[[ "$OUT" == *"PUBLIC_RELEASE_SHA         = NOT_SERVED"* ]] \
  && pass "a marker served by another origin is reported as NOT_SERVED here" \
  || fail "a foreign-origin body was read as this host's marker: $OUT"

# ── P11/P12. A 2xx from the right origin still has to carry a marker. ────
marker_body_case() {
  local label="$1" body="$2"
  local dir="$WORK/site-body-$3"
  mkdir -p "$dir"
  cp -r "$PAPP/dist/." "$dir/"
  printf '%s' "$body" > "$dir/release.json"

  FAKE_SITE_DIR="$dir"; FAKE_SITE_ROOT_302=1; FAKE_SITE_SPA=1
  BIN="$CURLBIN"
  run bash "$FE" verify --app-dir "$PAPP" --url https://site.test

  [[ "$CODE" -ne 0 ]] \
    && pass "verify fails when the served marker $label" \
    || fail "verify accepted a marker that $label: $OUT"
  [[ "$OUT" == *"PUBLIC_RELEASE_SHA         = NOT_SERVED"* ]] \
    && pass "a marker that $label is reported as NOT_SERVED" \
    || fail "a marker that $label was not reported as NOT_SERVED: $OUT"
}

marker_body_case "is malformed and cannot be parsed" \
  '{ "releaseSha": "1111222233334' malformed
marker_body_case "is well-formed JSON with no releaseSha field" \
  '{ "builtAt": "2026-01-01T00:00:00Z", "task": "F3-PROD-004" }' nosha

unset FAKE_SITE_DIR FAKE_SITE_ROOT_302 FAKE_SITE_SPA FAKE_SITE_DOWN
unset FAKE_SITE_MARKER_STATUS FAKE_SITE_MARKER_REDIRECT

# ════════════════════════════════════════════════════════════════════════
section "Q. The cleanliness gate ignores this script's own artifacts (F3-PROD-004-R3)"
# ════════════════════════════════════════════════════════════════════════
# The defect this section closes was found by a production preflight, not by a
# diff. The gate at cmd_deploy step 1 refuses ANY non-empty
# `git status --porcelain` — and the script runs inside the production checkout
# and leaves four names there itself:
#
#   dist.next                 staging build
#   dist.next.stale-<UTC>     what --clean-staging moves a stale staging aside to
#   dist.rollback-<tag>-<UTC> the preserved bundle EVERY deploy leaves behind
#   .noramedi-frontend-release-state   the deterministic rollback pointer
#
# So a SUCCESSFUL deploy dirtied its own checkout and blocked the next one:
#
#   /var/www/noramedi $ git status --porcelain
#   ?? dist.rollback-f3-sec-004-20260817T093856/
#
# The fix is four exact rules in the repository's .gitignore, and THAT FILE is
# what this section tests. Every fixture below copies scripts/../.gitignore
# verbatim into a real throwaway git checkout; nothing here restates a rule, so
# deleting one from the repository fails these cases rather than this file.
#
# Two properties matter equally and both are asserted:
#   * none of the four artifacts blocks a deploy at the cleanliness gate any
#     more, driven through the real gate;
#   * nothing else got quieter. A modified tracked file, an untracked source
#     file, and even a FILE whose name merely looks like a preserved bundle all
#     still fail the gate closed — the rules are directory-scoped exact names,
#     not a wildcard over the checkout. And a leftover dist.next, now invisible
#     to git, is still refused by the script's own staging precondition, which
#     is a filesystem check and was always the real protection there (Q3b).
#
# Q5 is the falsification, kept permanently in the suite: with those four rules
# and nothing else stripped out of the copied .gitignore, the identical
# artifacts DO block the deploy again. Without it every "allowed" result above
# could be green because git never saw the artifacts at all.

REPO_GITIGNORE="$(cd "$SCRIPT_DIR/.." && pwd)/.gitignore"
SHA_Q="1111222233334444555566667777888899990000"

# The developer's global/system git config is excluded from every git process
# this section starts, the fixtures' and the deploy script's alike. A stray
# core.excludesFile on one machine would otherwise turn the REFUSE cases green
# for a reason that does not exist on the production host.
GIT_ISOLATED=(GIT_CONFIG_GLOBAL=/dev/null
              GIT_CONFIG_NOSYSTEM=1
              GIT_AUTHOR_NAME=fixture   GIT_AUTHOR_EMAIL=fixture@example.invalid
              GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid)

git_in() {
  local dir="$1"; shift
  env "${GIT_ISOLATED[@]}" git -C "$dir" "$@"
}

# `git status` may refresh and rewrite .git/index, so the whole-tree snapshot()
# above would report a mutation the deploy did not make. The claim being
# measured is about the WORKING TREE, which is what the deploy would rename.
#
# Content goes through cksum rather than cat because these fixtures carry a copy
# of the repository's .gitignore: a command substitution silently drops NUL
# bytes, so a cat-based snapshot would be blind to a whole class of change in
# any file that ever acquired one (this one had until F3-PROD-004-R3).
snapshot_nogit() {
  ( cd "$1" 2>/dev/null || return 0
    find . -path ./.git -prune -o -print | LC_ALL=C sort
    find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s::' "$f"; cksum < "$f"
    done ) 2>/dev/null
}

# new_git_app NAME — a deployment root that is a real git checkout carrying the
# repository's .gitignore verbatim, one tracked source file, and a clean tree.
new_git_app() {
  local name="$1"
  local app; app="$(new_app "$name")"
  cp -- "$REPO_GITIGNORE" "$app/.gitignore"
  mkdir -p "$app/src"
  printf 'export const answer = 1;\n' > "$app/src/app.ts"
  git_in "$app" -c init.defaultBranch=main init -q      >/dev/null 2>&1
  git_in "$app" add -A                                  >/dev/null 2>&1
  git_in "$app" commit -q -m "fixture: clean checkout"  >/dev/null 2>&1
  printf '%s\n' "$app"
}

# plant_state_file APP DIRNAME — the state file exactly as write_state leaves it.
plant_state_file() {
  cat > "$1/.noramedi-frontend-release-state" <<EOF
# noramedi-frontend-deploy.sh state — F3-PROD-004. Machine-written; safe to read.
ROLLBACK_DIR=$1/$2
PROMOTED_RELEASE_SHA=$SHA_Q
PREVIOUS_RELEASE_SHA=unknown
UPDATED_AT=2026-01-01T00:00:00Z
EOF
}

if ! command -v git >/dev/null 2>&1; then
  SKIPPED=$((SKIPPED + 1))
  echo "  SKIPPED - git is not available here, so the cleanliness gate cannot be driven at all (it is on CI)."
else

# ── Q0. Control: the fixture itself deploys. Without this, every "allowed"
#        result below could be green because the fixture is broken. ──────────
QAPP="$(new_git_app app-git-control)"
seed_bundle "$QAPP/dist" v1
[[ -z "$(git_in "$QAPP" status --porcelain)" ]] \
  && pass "the fixture checkout starts clean (a live dist/ is already ignored)" \
  || fail "the fixture is dirty before anything was planted: $(git_in "$QAPP" status --porcelain)"
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag ctl
[[ "$CODE" -eq 0 && "$(live_token "$QAPP")" == "v2" ]] \
  && pass "a deploy from a clean git checkout succeeds (the fixture drives the real gate)" \
  || fail "the control deploy failed, so section Q proves nothing (exit $CODE): $OUT"

# ── Q1/Q2/Q3. Each artifact ALONE must leave the gate satisfied. ──────────
# A planted directory is seeded with a real bundle on purpose: git does not
# report an EMPTY directory at all, so an empty one would pass for the wrong
# reason. Requirements 1, 2 and 3.
ALLOW_SEQ=0
allows_case() {
  local label="$1"; shift
  ALLOW_SEQ=$((ALLOW_SEQ + 1))
  local app; app="$(new_git_app "app-git-allow-$ALLOW_SEQ")"
  seed_bundle "$app/dist" v1
  local p
  for p in "$@"; do
    case "$p" in
      */) seed_bundle "$app/${p%/}" old ;;
      .noramedi-frontend-release-state) plant_state_file "$app" "dist.rollback-prev-20251231T000000Z" ;;
      *)  printf 'placeholder\n' > "$app/$p" ;;
    esac
  done
  [[ -z "$(git_in "$app" status --porcelain)" ]] \
    && pass "$label leaves 'git status --porcelain' empty under the repository's ignore rules" \
    || fail "$label is still reported by git status: $(git_in "$app" status --porcelain)"
  run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
      bash "$FE" deploy --app-dir "$app" --release-sha "$SHA_Q" --tag q
  [[ "$CODE" -eq 0 ]] \
    && pass "the cleanliness gate allows a deploy from a checkout holding only $label" \
    || fail "$label blocked the deploy (exit $CODE): $OUT"
  [[ "$(live_token "$app")" == "v2" ]] \
    && pass "the deploy past $label actually promoted the new bundle" \
    || fail "the deploy past $label reported success without promoting: $(live_token "$app")"
  [[ "$OUT" != *"--allow-dirty"* ]] \
    && pass "the operator is never told to reach for --allow-dirty because of $label" \
    || fail "$label produced dirty-worktree output: $OUT"
}

allows_case "a preserved rollback bundle (dist.rollback-<tag>-<UTC>)" \
  "dist.rollback-f3-sec-004-20260817T093856/"
allows_case "the release state file (.noramedi-frontend-release-state)" \
  ".noramedi-frontend-release-state"
allows_case "a moved-aside stale staging bundle (dist.next.stale-<UTC>)" \
  "dist.next.stale-20260817T093856/"
allows_case "every deployment artifact at once" \
  "dist.rollback-f3-sec-004-20260817T093856/" ".noramedi-frontend-release-state" \
  "dist.next.stale-20260817T093856/"

# ── Q3b. dist.next: ignored by git, and STILL refused by the script. ─────
# `dist/` does not cover `dist.next` — a .gitignore pattern matches whole path
# components — so a leftover staging bundle used to dirty the checkout too, and
# it gets a rule of its own.
#
# What must not happen is that ignoring it hides it. The protection against
# promoting a stale staging bundle was never the git gate; it is the script's
# own staging precondition, which is a filesystem check. This case proves both
# halves separately: the cleanliness gate is satisfied, and the deploy is still
# REFUSED — by the staging check, in its own words, not by the cleanliness gate.
QAPP="$(new_git_app app-git-stale-staging)"
seed_bundle "$QAPP/dist" v1
seed_bundle "$QAPP/dist.next" leftover
[[ -z "$(git_in "$QAPP" status --porcelain)" ]] \
  && pass "a leftover staging bundle (dist.next) leaves 'git status --porcelain' empty" \
  || fail "dist.next still dirties the checkout: $(git_in "$QAPP" status --porcelain)"
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag stale
[[ "$CODE" -ne 0 && "$OUT" == *"may be stale"* ]] \
  && pass "a leftover dist.next is still REFUSED, by the staging precondition (ignoring it hid nothing)" \
  || fail "the stale staging protection did not fire (exit $CODE): $OUT"
[[ "$OUT" != *"uncommitted changes"* ]] \
  && pass "that refusal is the staging check, not the cleanliness gate — the gate was satisfied" \
  || fail "dist.next was still refused by the git cleanliness gate: $OUT"
[[ "$(live_token "$QAPP")" == "v1" ]] \
  && pass "nothing was promoted over the leftover staging bundle" \
  || fail "a stale staging bundle reached the live path"

# ── Q4. The full lifecycle: deploy, then deploy again. Requirement 6. ─────
# This is the production sequence verbatim — a successful deploy, then the
# mandatory forward deploy it used to block. Neither run is given --allow-dirty,
# and the artifacts the first run created are still on disk for the second.
QAPP="$(new_git_app app-git-lifecycle)"
seed_bundle "$QAPP/dist" v1
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag first
[[ "$CODE" -eq 0 ]] \
  && pass "lifecycle deploy 1/2 succeeds" \
  || fail "lifecycle deploy 1/2 failed (exit $CODE): $OUT"
[[ -d "$QAPP/dist.rollback-first-20260101T000000Z" && -f "$QAPP/.noramedi-frontend-release-state" ]] \
  && pass "deploy 1/2 left a preserved bundle and a state file in the checkout, as it must" \
  || fail "deploy 1/2 did not leave the artifacts this section is about"
[[ -z "$(git_in "$QAPP" status --porcelain)" ]] \
  && pass "the checkout a successful deploy leaves behind is still clean to git" \
  || fail "a successful deploy dirtied its own checkout — the F3-PROD-004-R3 defect: $(git_in "$QAPP" status --porcelain)"

run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v3)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag second
[[ "$CODE" -eq 0 ]] \
  && pass "the mandatory subsequent forward deploy succeeds WITHOUT --allow-dirty" \
  || fail "deploy 2/2 was blocked by the artifacts deploy 1/2 created (exit $CODE): $OUT"
[[ "$(live_token "$QAPP")" == "v3" ]] \
  && pass "deploy 2/2 promoted the newer bundle" \
  || fail "deploy 2/2 did not promote: live is '$(live_token "$QAPP")'"
[[ -d "$QAPP/dist.rollback-first-20260101T000000Z" ]] \
  && pass "the retained rollback bundle from deploy 1/2 was never deleted to satisfy the gate" \
  || fail "the earlier preserved bundle disappeared"
[[ -z "$(git_in "$QAPP" status --porcelain)" ]] \
  && pass "the checkout is still clean after two deploys and two retained bundles" \
  || fail "the checkout is dirty after the second deploy: $(git_in "$QAPP" status --porcelain)"

# --clean-staging is the one path that produces dist.next.stale-*; drive it for
# real so requirement 3 rests on the script's own behaviour, not on a name this
# file made up.
seed_bundle "$QAPP/dist.next" leftover
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v4)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag third --clean-staging
[[ "$CODE" -eq 0 && -d "$QAPP/dist.next.stale-20260101T000000Z" ]] \
  && pass "--clean-staging produces dist.next.stale-<UTC> in the checkout, as accepted behaviour" \
  || fail "--clean-staging did not produce the stale staging artifact (exit $CODE): $OUT"
[[ -z "$(git_in "$QAPP" status --porcelain)" ]] \
  && pass "the stale staging artifact the script itself created does not dirty the checkout" \
  || fail "dist.next.stale-* dirtied the checkout: $(git_in "$QAPP" status --porcelain)"
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v5)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag fourth
[[ "$CODE" -eq 0 && "$(live_token "$QAPP")" == "v5" ]] \
  && pass "a deploy still succeeds after --clean-staging, with all three artifact kinds present" \
  || fail "the post---clean-staging deploy was blocked (exit $CODE): $OUT"

# ── Q5/Q6. What must STILL fail. Requirements 4 and 5. ────────────────────
# Every case here plants the ignored artifacts too, so the refusal has to come
# from the real change: the new rules must not swallow one.
REFUSE_SEQ=0
refuses_case() {
  local label="$1" rel="$2" content="$3"
  REFUSE_SEQ=$((REFUSE_SEQ + 1))
  local app; app="$(new_git_app "app-git-refuse-$REFUSE_SEQ")"
  seed_bundle "$app/dist" v1
  seed_bundle "$app/dist.rollback-prev-20251231T000000Z" old
  plant_state_file "$app" "dist.rollback-prev-20251231T000000Z"
  mkdir -p -- "$(dirname -- "$app/$rel")"
  printf '%s\n' "$content" > "$app/$rel"

  local before; before="$(snapshot_nogit "$app")"
  run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
      bash "$FE" deploy --app-dir "$app" --release-sha "$SHA_Q" --tag q
  [[ "$CODE" -ne 0 ]] \
    && pass "the gate still REFUSES a deploy when the checkout holds $label" \
    || fail "$label did not block the deploy — the ignore rules are too broad: $OUT"
  # Attributable to THIS gate by its own wording. A non-zero exit alone would
  # also be produced by an unrelated failure.
  [[ "$OUT" == *"uncommitted changes"* ]] \
    && pass "the refusal for $label comes from the git cleanliness gate itself" \
    || fail "the refusal for $label did not come from the cleanliness gate: $OUT"
  [[ "$(live_token "$app")" == "v1" ]] \
    && pass "the live bundle is untouched by the refused deploy over $label" \
    || fail "the live bundle changed during a refused deploy"
  [[ "$(snapshot_nogit "$app")" == "$before" ]] \
    && pass "not one byte of the working tree changed while $label was refused" \
    || fail "the refused deploy over $label mutated the working tree"
}

refuses_case "a modified tracked source file" \
  "src/app.ts" "export const answer = 2;"
refuses_case "an untracked source-like file outside the deployment artifacts" \
  "src/newFeature.ts" "export const feature = () => true;"
# The rules end in '/', so they match DIRECTORIES only, and the state file is
# matched by its exact name. A file that merely starts dist.rollback- is not a
# deployment artifact and must not be swept up by them.
refuses_case "an untracked FILE named like a preserved bundle (the rule is directory-scoped)" \
  "dist.rollback-notes.txt" "notes about a rollback"

# --allow-dirty itself is unchanged: still available, still warns, still the
# only way past a genuinely dirty tree. Nothing here weakened it.
QAPP="$(new_git_app app-git-allow-dirty)"
seed_bundle "$QAPP/dist" v1
printf 'export const answer = 2;\n' > "$QAPP/src/app.ts"
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$QAPP" --release-sha "$SHA_Q" --tag dirty --allow-dirty
[[ "$CODE" -eq 0 && "$OUT" == *"DIRTY worktree"* ]] \
  && pass "--allow-dirty still deploys past a genuinely dirty tree, and still warns" \
  || fail "--allow-dirty behaviour changed (exit $CODE): $OUT"

# ── Q7. Falsification: it is the REPOSITORY's rules doing this. ───────────
# The same fixture, built from a .gitignore with EXACTLY the four new rules
# stripped and nothing else changed. If the artifacts stop blocking the deploy
# here too, then every "allowed" case above is green for some other reason and
# proves nothing about .gitignore.
MUTAPP="$(new_app app-git-mutated-ignore)"
# -a: .gitignore carried a stray UTF-16 fragment on its '.codegraph/' line until
# F3-PROD-004-R3 removed it. While those NUL bytes were there grep read the file
# as binary and emitted no lines at all, which would silently reduce this
# falsification to a no-op rather than failing it. -a keeps that from ever being
# a quiet outcome again; the line-count assertion below is what makes it loud.
grep -a -vxE 'dist\.next/|dist\.next\.stale-\*/|dist\.rollback-\*/|\.noramedi-frontend-release-state' \
  "$REPO_GITIGNORE" > "$MUTAPP/.gitignore"
STRIPPED=$(( $(wc -l < "$REPO_GITIGNORE") - $(wc -l < "$MUTAPP/.gitignore") ))
[[ "$STRIPPED" -eq 4 ]] \
  && pass "the ignore contract is exactly the four expected rules, verbatim, in .gitignore" \
  || fail "stripping the four F3-PROD-004-R3 rules removed $STRIPPED line(s), not 4 — the contract was reworded or broadened; reread .gitignore before touching this case"

mkdir -p "$MUTAPP/src"
printf 'export const answer = 1;\n' > "$MUTAPP/src/app.ts"
git_in "$MUTAPP" -c init.defaultBranch=main init -q       >/dev/null 2>&1
git_in "$MUTAPP" add -A                                   >/dev/null 2>&1
git_in "$MUTAPP" commit -q -m "fixture: rules stripped"   >/dev/null 2>&1
seed_bundle "$MUTAPP/dist" v1
seed_bundle "$MUTAPP/dist.rollback-f3-sec-004-20260817T093856" old
plant_state_file "$MUTAPP" "dist.rollback-f3-sec-004-20260817T093856"

[[ -n "$(git_in "$MUTAPP" status --porcelain)" ]] \
  && pass "without the four rules the identical artifacts ARE reported by git status" \
  || fail "the artifacts are invisible to git even with the rules stripped — the cases above prove nothing"
run env "${GIT_ISOLATED[@]}" NORAMEDI_FRONTEND_BUILD_EXECUTABLE="$(build_ok v2)" \
    bash "$FE" deploy --app-dir "$MUTAPP" --release-sha "$SHA_Q" --tag mut
[[ "$CODE" -ne 0 && "$OUT" == *"uncommitted changes"* ]] \
  && pass "without the four rules the deploy is blocked by its own artifacts — the R3 defect, reproduced" \
  || fail "the stripped-rules fixture still deployed (exit $CODE), so section Q is not attributable to .gitignore: $OUT"
[[ "$(live_token "$MUTAPP")" == "v1" ]] \
  && pass "that blocked deploy promoted nothing (the defect is a hard refusal, not a warning)" \
  || fail "the blocked deploy still promoted a bundle"

fi

# ════════════════════════════════════════════════════════════════════════
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed, $SKIPPED skipped"
[[ "$SKIPPED" -eq 0 ]] || echo "NOTE: $SKIPPED check(s) could not run on this platform — see the SKIPPED line(s) above."
[[ "$FAILED" -eq 0 ]] || exit 1

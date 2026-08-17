#!/usr/bin/env bash
# noramedi-frontend-deploy.sh — F3-PROD-004 (R-038)
# Deploy to: /usr/local/sbin/noramedi-frontend-deploy.sh
# chmod +x /usr/local/sbin/noramedi-frontend-deploy.sh
#
# Repository-owned frontend build / promotion / rollback for the production
# static bundle. `noramedi-deploy.sh` remains authoritative for the BACKEND
# (git pull, npm ci, prisma, PM2); it has no frontend step at all, which is
# exactly the gap RISK_REGISTER.md R-038 names. This script adds the missing
# half without changing anything the backend script does.
#
# Commands:
#   deploy     build -> stage -> validate -> promote -> verify
#   rollback   restore a previously preserved bundle as the live one
#   verify     report on the CURRENT live bundle (read-only, no mutation)
#   help       show this header
#
# ── PROMOTION SEMANTICS (read this before changing anything) ─────────────
# Promotion is a TWO-STEP SAME-FILESYSTEM RENAME PROMOTION:
#
#     mv <live>     <rollback>      # rename 1
#     mv <staging>  <live>          # rename 2
#
# It is NEAR-ATOMIC. It is NOT A SINGLE ATOMIC EXCHANGE. Between the two
# renames there is a very short interval in which the live directory does not
# exist. This is the procedure the operator already performs by hand (see
# docs/program/evidence/F3-PROD-003_*.md §5.1); this script does not upgrade
# it to an atomic exchange and does not claim to. What it adds is that the
# window is now bounded by code rather than by typing speed, and that a
# failure of rename 2 triggers a bounded best-effort restoration of rename 1
# instead of leaving production with no live directory.
#
# ── WHAT THIS SCRIPT DOES NOT KNOW (read before first production use) ────
# The directory this script promotes is <app-dir>/dist, which is exactly the
# path the accepted manual procedure operates on (docs/program/evidence/
# F3-PROD-003_*.md §5.1: `mv dist "$ROLLBACK_DIR"` then `mv dist.next dist`,
# inside the production checkout).
#
# What NO repository evidence establishes is that nginx actually SERVES that
# directory. The host nginx config is not repository-owned; F0-006 records the
# production static root as UNVERIFIED_PRODUCTION, and the only `root .../dist`
# line in the repository (docs/22-hostinger-vps-postgres-deploy-plan.md) still
# carries pre-rename branding and is not authoritative. This script therefore
# reproduces the accepted filesystem procedure and makes no claim about the web
# server. `verify --url https://<host>` is the check that closes that loop, and
# an operator should run it once, deliberately, on first use.
#
# ── WHAT THIS SCRIPT NEVER DOES ──────────────────────────────────────────
#   * It never deletes anything. There is no `rm` in this file. A stale
#     staging directory is moved aside, never removed; a superseded bundle is
#     preserved, never removed. Reclaiming disk is a deliberate operator act.
#   * It never touches the database, PM2, nginx, or any application process.
#   * It never prints an environment variable's value, a credential, a token,
#     a DSN, or a connection string. The only identifiers it prints are paths
#     under the deployment root and the git release SHA (which `git log`
#     already shows, and which the deploy log is expected to record).
#
# Usage:
#   noramedi-frontend-deploy.sh deploy   [OPTIONS]
#   noramedi-frontend-deploy.sh rollback [OPTIONS]
#   noramedi-frontend-deploy.sh verify   [OPTIONS]
#
# Common options:
#   --app-dir DIR      Deployment root (default: $NORAMEDI_APP_DIR, else
#                      /var/www/noramedi). The live bundle is <DIR>/dist.
#   --dry-run          Validate and print the intended actions; mutate nothing.
#   -h, --help         Show this help
#
# deploy options:
#   --release-sha SHA  Release identifier to record (default: $RELEASE_SHA,
#                      else `git -C <app-dir> rev-parse HEAD`, else "unknown")
#   --tag NAME         Label embedded in the preserved directory's name
#                      (default: the 12-char release SHA). [A-Za-z0-9._-] only.
#   --skip-build       Do not run the build; <DIR>/dist.next must already exist
#                      and is validated exactly as a freshly built one would be.
#   --allow-dirty      Do not refuse to deploy from a dirty git worktree.
#   --allow-initial    Permit a first deploy in which no live bundle exists yet
#                      (nothing to preserve, so no rollback point is created).
#   --clean-staging    If <DIR>/dist.next already exists, move it aside to
#                      <DIR>/dist.next.stale-<UTC> instead of aborting.
#
# rollback options:
#   --from DIR         Explicit bundle to restore. Must live directly under the
#                      deployment root and be named dist.rollback-*.
#                      Default: the path recorded by the last deploy in
#                      <DIR>/.noramedi-frontend-release-state.
#   --tag NAME         Label for the directory preserving the CURRENT live
#                      bundle before it is replaced (default: "preroll").
#
# verify options:
#   --url BASE         Additionally fetch BASE/ and BASE/release.json over
#                      HTTP(S) and report reachability. Omitted by default:
#                      verification is filesystem-local and needs no network.
#   --expect-sha SHA   Fail unless the live release marker records SHA.
#   --check-backend    Also run the existing noramedi-healthcheck.sh. Reported
#                      as a separate line: a healthy backend NEVER satisfies a
#                      frontend check, and a frontend failure is never hidden
#                      behind it.
#
# Exit status: 0 = success. Any non-zero exit means the live bundle is either
# unchanged (the overwhelmingly common case — every precondition is checked
# before the first rename) or, for the rename-2 failure path only, restored to
# its previous contents. The failure message says which.

# The house pragma across every sibling script (noramedi-deploy.sh:34,
# noramedi-healthcheck.sh:21, noramedi-opscheck.sh:346, ...) is
# `set -euo pipefail`. `-E` is added here and nowhere else on purpose: it is
# inert today (this file installs no ERR trap) but it means that if one is ever
# added it will fire inside the promotion functions rather than being silently
# skipped there — which, in a file whose whole job is renaming production
# directories, is the one place that difference would matter.
set -Eeuo pipefail

SCRIPT_TASK="F3-PROD-004"
HEALTHCHECK="${NORAMEDI_HEALTHCHECK:-/usr/local/sbin/noramedi-healthcheck.sh}"

# ── logging ──────────────────────────────────────────────────────────────
# Same shape as noramedi-deploy.sh so both halves of a deploy read alike.
timestamp() { date '+%H:%M:%S'; }
log()  { echo "[$(timestamp)] $*"; }
warn() { echo "[$(timestamp)] WARNING — $*" >&2; }
die()  { echo "[$(timestamp)] FATAL — $*" >&2; exit 1; }

usage() {
  grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

# ── path canonicalisation ────────────────────────────────────────────────
# Deliberately not `realpath`/`readlink -f`: this must behave identically on
# the Ubuntu production host and on every developer/CI shell that runs the
# test suite, and it must resolve a path whose final component does not exist
# yet (the rollback destination). cd+pwd -P resolves symlinks in the parent,
# which is the part that matters for the safety assertions below.
canonicalize() {
  local p="$1" dir base
  [[ -n "$p" ]] || { printf '%s\n' ''; return 0; }
  if [[ "$p" == "/" ]]; then printf '/\n'; return 0; fi
  if [[ -d "$p" ]]; then (cd -- "$p" && pwd -P); return 0; fi
  dir="$(dirname -- "$p")"
  base="$(basename -- "$p")"
  if [[ -d "$dir" ]]; then
    local rdir; rdir="$(cd -- "$dir" && pwd -P)"
    [[ "$rdir" == "/" ]] && printf '/%s\n' "$base" || printf '%s/%s\n' "$rdir" "$base"
    return 0
  fi
  printf '%s\n' "$p"
}

# ── path safety ──────────────────────────────────────────────────────────
# This script renames production directories. Every path it acts on is
# bounded before any mutation:
#   * the deployment root must be absolute, must exist, must not be a system
#     directory, and must be at least two components deep;
#   * the live bundle must be exactly <root>/dist — not a sibling, not a
#     descendant, not a symlink target elsewhere;
#   * staging must be exactly <root>/dist.next;
#   * every preserved bundle must be <root>/dist.rollback-*.
# There is no code path that renames anything failing these assertions.
UNSAFE_ROOTS=(
  / /bin /boot /dev /etc /home /lib /lib32 /lib64 /media /mnt /opt /proc
  /root /run /sbin /srv /sys /tmp /usr /usr/local /usr/local/bin /var
  /var/www /var/lib /var/log
)

assert_safe_app_dir() {
  local dir="$1" candidate depth
  [[ -n "$dir" ]] || die "deployment root is empty."
  [[ "$dir" == /* ]] || die "deployment root must be an absolute path: '$dir'"
  # The denylist and the depth floor are checked BEFORE the existence test on
  # purpose. Ordering them after it makes the guard's behaviour depend on which
  # system directories happen to exist on the host — a path that is refused as
  # a system directory on the production Ubuntu host would be refused merely as
  # "not found" elsewhere, so the protection could be deleted without any test
  # noticing. This ordering also means a system path is never even stat'ed.
  for candidate in "${UNSAFE_ROOTS[@]}"; do
    [[ "$dir" == "$candidate" ]] && die "refusing to operate on system directory '$dir' as a deployment root."
  done
  [[ -n "${HOME:-}" && "$dir" == "$HOME" ]] && die "refusing to operate on the home directory '$dir' as a deployment root."
  # Depth: "/a" -> 1, "/a/b" -> 2. A one-component root is always a mistake.
  depth="$(printf '%s' "${dir#/}" | awk -F/ '{c=0; for (i=1; i<=NF; i++) if ($i != "") c++; print c}')"
  [[ "$depth" -ge 2 ]] || die "deployment root '$dir' is too shallow (depth $depth); refusing."
  [[ -d "$dir" ]] || die "deployment root does not exist or is not a directory: '$dir'"
  return 0
}

# assert_child_of ROOT PATH LABEL — PATH must sit DIRECTLY under ROOT.
assert_child_of() {
  local root="$1" path="$2" label="$3" parent
  parent="$(dirname -- "$path")"
  [[ "$parent" == "$root" ]] \
    || die "$label must be a direct child of the deployment root. Expected parent '$root', got '$parent'."
}

assert_basename() {
  local path="$1" expected="$2" label="$3" base
  base="$(basename -- "$path")"
  [[ "$base" == "$expected" ]] \
    || die "$label must be named '$expected', got '$base' — refusing to rename an unexpected path."
}

assert_safe_tag() {
  local tag="$1"
  [[ -n "$tag" ]] || die "tag is empty."
  [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "tag '$tag' contains characters outside [A-Za-z0-9._-]; refusing (it becomes a directory name)."
  [[ "$tag" != "." && "$tag" != ".." ]] || die "tag '$tag' is not a usable directory-name component."
}

# ── same-filesystem contract ─────────────────────────────────────────────
# The promotion contract is a RENAME, and rename(2) cannot cross filesystems.
# If staging and live were on different devices, `mv` would silently degrade
# into copy-then-delete: slow, non-atomic in a much worse way, and with a
# genuinely long window. Fail closed instead of degrading quietly.
device_of() {
  # Two statements on purpose: under `set -u`, bash expands every word of a
  # single `local` command before assigning any of them, so `local p="$1"
  # target="$p"` reads an unset `p` and aborts.
  local p="$1"
  local target="$p"
  [[ -e "$target" ]] || target="$(dirname -- "$p")"
  stat -c '%d' -- "$target" 2>/dev/null || stat -f '%d' -- "$target" 2>/dev/null || echo "unknown"
}

assert_same_filesystem() {
  local a="$1" b="$2" da db
  da="$(device_of "$a")"; db="$(device_of "$b")"
  if [[ "$da" == "unknown" || "$db" == "unknown" ]]; then
    warn "could not determine the filesystem device for '$a' / '$b'; the same-filesystem precondition is UNVERIFIED."
    return 0
  fi
  [[ "$da" == "$db" ]] \
    || die "'$a' and '$b' are on different filesystems (device $da vs $db). The promotion contract requires a same-filesystem rename; refusing."
}

# ── bundle validation ────────────────────────────────────────────────────
# "Does this directory look like a Vite production bundle?" — deliberately
# not an HTML parser. index.html must exist and be non-empty, and every
# root-absolute local asset it references must be present on disk. That is
# what actually catches the failure mode this guards against: a build that
# exited 0 but emitted a partial or empty tree.
validate_bundle() {
  local dir="$1" label="$2" ref target missing=0 refs=0

  [[ -d "$dir" ]] || die "$label is missing or not a directory: '$dir'"
  # -A includes dotfiles; an "empty" build directory is a build that failed.
  [[ -n "$(ls -A -- "$dir" 2>/dev/null)" ]] || die "$label is empty: '$dir'"
  [[ -f "$dir/index.html" ]] || die "$label has no index.html: '$dir/index.html'"
  [[ -s "$dir/index.html" ]] || die "$label has an empty index.html: '$dir/index.html'"

  # Root-absolute src="/..." / href="/..." references. Vite emits exactly this
  # shape for the entry chunk and stylesheet, so the entry bundle is always
  # among them; a missing hashed entry chunk is the single most damaging
  # partial-build outcome and is caught here.
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    # Skip protocol-relative (//host/...) and any query/fragment noise.
    [[ "$ref" == //* ]] && continue
    ref="${ref%%\?*}"; ref="${ref%%#*}"
    [[ -n "$ref" ]] || continue
    refs=$(( refs + 1 ))
    target="$dir$ref"
    if [[ ! -f "$target" ]]; then
      warn "$label references '$ref' but $(basename -- "$dir")$ref does not exist."
      missing=$(( missing + 1 ))
    fi
  done < <(grep -oE '(src|href)="/[^"]*"' "$dir/index.html" 2>/dev/null | sed -E 's/^(src|href)="//; s/"$//' | sort -u)

  [[ "$missing" -eq 0 ]] \
    || die "$label references $missing asset(s) that are not present in the bundle — refusing to treat it as a deployable build."

  log "OK — $label validated: index.html present, $refs root-absolute reference(s), all resolvable."
  return 0
}

# ── release marker ───────────────────────────────────────────────────────
# The operator question this answers: "what git SHA is this frontend serving?"
# Deliberately minimal — a SHA, a UTC timestamp, and the tool that wrote it.
# No hostname, no path, no environment, no build machine, nothing derived
# from any credential. It is served publicly by nginx like any other file in
# the bundle, so nothing that is not already public may be added here.
RELEASE_MARKER_NAME="release.json"

write_release_marker() {
  local dir="$1" sha="$2" built_at
  built_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cat > "$dir/$RELEASE_MARKER_NAME" <<EOF
{
  "releaseSha": "$sha",
  "builtAt": "$built_at",
  "builtBy": "noramedi-frontend-deploy.sh",
  "task": "$SCRIPT_TASK"
}
EOF
  log "Release marker written: $(basename -- "$dir")/$RELEASE_MARKER_NAME (releaseSha=$sha, builtAt=$built_at)"
}

# read_marker_field DIR FIELD — prints the value, or "" when unreadable.
read_marker_field() {
  local dir="$1" field="$2"
  [[ -f "$dir/$RELEASE_MARKER_NAME" ]] || { printf '\n'; return 0; }
  grep -oE "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$dir/$RELEASE_MARKER_NAME" 2>/dev/null \
    | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"$/\1/'
}

# ── deploy state (deterministic rollback target) ─────────────────────────
# Rollback must never guess. Deploy records the exact preserved path here at
# the moment it creates it; rollback reads it back, and an operator can always
# override with --from. Ordering of `ls` is never consulted.
STATE_FILE_NAME=".noramedi-frontend-release-state"

write_state() {
  local app_dir="$1" rollback_dir="$2" promoted_sha="$3" previous_sha="$4"
  cat > "$app_dir/$STATE_FILE_NAME" <<EOF
# noramedi-frontend-deploy.sh state — $SCRIPT_TASK. Machine-written; safe to read.
ROLLBACK_DIR=$rollback_dir
PROMOTED_RELEASE_SHA=$promoted_sha
PREVIOUS_RELEASE_SHA=$previous_sha
UPDATED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF
}

read_state_field() {
  local app_dir="$1" key="$2"
  [[ -f "$app_dir/$STATE_FILE_NAME" ]] || { printf '\n'; return 0; }
  grep -E "^$key=" "$app_dir/$STATE_FILE_NAME" 2>/dev/null | head -n1 | cut -d= -f2-
}

# ── backend release SHA (never fabricated from local git) ────────────────
# The backend's deployed SHA is whatever the RUNNING process carries, which
# noramedi-deploy.sh step 4b puts there via ecosystem.config.cjs. Reading it
# from `git rev-parse` would report what is checked out, not what is running,
# and would make a genuine backend/frontend skew invisible. If PM2 or node is
# unavailable the answer is NOT_APPLICABLE — never a guess.
backend_release_sha() {
  local name="${1:-noramedi-api}"
  command -v pm2  >/dev/null 2>&1 || { printf 'NOT_APPLICABLE\n'; return 0; }
  command -v node >/dev/null 2>&1 || { printf 'NOT_APPLICABLE\n'; return 0; }
  pm2 jlist 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", c => { raw += c; });
    process.stdin.on("end", () => {
      let apps;
      try { apps = JSON.parse(raw); } catch { process.stdout.write("NOT_APPLICABLE"); return; }
      const app = apps.find(a => a.name === process.argv[1]);
      if (!app || !app.pm2_env) { process.stdout.write("NOT_APPLICABLE"); return; }
      // Only the release tag is ever read out of pm2_env; no other key is
      // touched, so no credential in the process environment can leak here.
      process.stdout.write(app.pm2_env.RELEASE_SHA || "UNSET");
    });
  ' "$name" 2>/dev/null || printf 'NOT_APPLICABLE\n'
}

# ── shared option state ──────────────────────────────────────────────────
APP_DIR_OPT="${NORAMEDI_APP_DIR:-/var/www/noramedi}"
DRY_RUN=false

APP_DIR=""
LIVE_DIR=""
STAGING_DIR=""

resolve_paths() {
  APP_DIR="$(canonicalize "$APP_DIR_OPT")"
  assert_safe_app_dir "$APP_DIR"
  LIVE_DIR="$APP_DIR/dist"
  STAGING_DIR="$APP_DIR/dist.next"
  assert_basename "$LIVE_DIR" "dist" "the live bundle"
  assert_child_of "$APP_DIR" "$LIVE_DIR" "the live bundle"
  assert_basename "$STAGING_DIR" "dist.next" "the staging bundle"
  assert_child_of "$APP_DIR" "$STAGING_DIR" "the staging bundle"
  # A symlinked live directory would make the rename act somewhere else.
  [[ ! -L "$LIVE_DIR" ]] || die "the live bundle '$LIVE_DIR' is a symlink; this script's rename contract requires a real directory."
  [[ ! -L "$STAGING_DIR" ]] || die "the staging bundle '$STAGING_DIR' is a symlink; refusing."
}

utc_stamp() { date -u '+%Y%m%dT%H%M%SZ'; }

# take_value FLAG [VALUE] — validates a value-taking option and publishes the
# result in OPT_VALUE. Deliberately not `x="$(take_value ...)"`: `die` inside a
# command substitution would exit only the subshell, and the caller would carry
# on with an empty path. Empty is rejected as firmly as missing — `--app-dir ""`
# must never silently become the current directory.
OPT_VALUE=""
take_value() {
  local flag="$1"
  [[ $# -ge 2 && -n "${2-}" ]] || die "$flag requires a non-empty value."
  OPT_VALUE="$2"
}

# ════════════════════════════════════════════════════════════════════════
# deploy
# ════════════════════════════════════════════════════════════════════════
cmd_deploy() {
  local release_sha="${RELEASE_SHA:-}" tag="" skip_build=false allow_dirty=false
  local allow_initial=false clean_staging=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir)      take_value --app-dir     "${2-}"; APP_DIR_OPT="$OPT_VALUE"; shift 2 ;;
      --release-sha)  take_value --release-sha "${2-}"; release_sha="$OPT_VALUE"; shift 2 ;;
      --tag)          take_value --tag         "${2-}"; tag="$OPT_VALUE";         shift 2 ;;
      --skip-build)   skip_build=true;    shift ;;
      --allow-dirty)  allow_dirty=true;   shift ;;
      --allow-initial) allow_initial=true; shift ;;
      --clean-staging) clean_staging=true; shift ;;
      --dry-run)      DRY_RUN=true;       shift ;;
      -h|--help)      usage ;;
      *) die "Unknown deploy option: $1 (run with --help for usage)" ;;
    esac
  done

  resolve_paths
  log "=== NoraMedi frontend deploy ($SCRIPT_TASK)$([[ "$DRY_RUN" == "true" ]] && echo ' — DRY RUN') ==="
  log "Deployment root : $APP_DIR"
  log "Live bundle     : $LIVE_DIR"
  log "Staging bundle  : $STAGING_DIR"

  # 1. Repository state. A deploy from a dirty worktree produces a bundle no
  #    SHA can describe, which is precisely the R-038 traceability failure.
  if [[ -d "$APP_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
    if [[ -n "$(git -C "$APP_DIR" status --porcelain 2>/dev/null)" ]]; then
      if [[ "$allow_dirty" == "true" ]]; then
        warn "deploying from a DIRTY worktree because --allow-dirty was given; the recorded release SHA will not fully describe this bundle."
      else
        die "the deployment checkout '$APP_DIR' has uncommitted changes. The recorded release SHA would not describe the built bundle. Re-run with --allow-dirty only if that is intended."
      fi
    fi
    [[ -n "$release_sha" ]] || release_sha="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)"
  fi
  if [[ -z "$release_sha" ]]; then
    release_sha="unknown"
    warn "no release SHA could be determined (not a git checkout and neither RELEASE_SHA nor --release-sha was given); the release marker will record \"unknown\"."
  fi
  log "Release SHA     : $release_sha"

  # 2. Preserved-directory name. Same convention the operator already used by
  #    hand: dist.rollback-<tag>-<UTC>.
  if [[ -z "$tag" ]]; then
    if [[ "$release_sha" == "unknown" ]]; then tag="manual"; else tag="${release_sha:0:12}"; fi
  fi
  assert_safe_tag "$tag"
  local rollback_dir="$APP_DIR/dist.rollback-$tag-$(utc_stamp)"
  assert_child_of "$APP_DIR" "$rollback_dir" "the preserved bundle"
  case "$(basename -- "$rollback_dir")" in
    dist.rollback-*) : ;;
    *) die "computed preserved-bundle name '$(basename -- "$rollback_dir")' does not match dist.rollback-*; refusing." ;;
  esac
  [[ ! -e "$rollback_dir" ]] || die "preserved-bundle destination already exists: '$rollback_dir'. Refusing to overwrite a retained bundle."
  log "Rollback dest   : $rollback_dir"

  # 3. Live bundle precondition.
  local have_live=true
  if [[ ! -d "$LIVE_DIR" ]]; then
    have_live=false
    [[ "$allow_initial" == "true" ]] \
      || die "no live bundle at '$LIVE_DIR'. If this is genuinely the first frontend deploy on this host, re-run with --allow-initial (no rollback point can be created)."
    warn "no live bundle exists yet; running as an INITIAL deploy. No rollback point will be created by this run."
  fi

  # 4. Staging precondition. A stale dist.next is the classic way to promote
  #    last week's build believing it is today's.
  if [[ -e "$STAGING_DIR" ]]; then
    if [[ "$skip_build" == "true" ]]; then
      log "Using the pre-existing staging bundle (--skip-build)."
    elif [[ "$clean_staging" == "true" ]]; then
      local stale="$APP_DIR/dist.next.stale-$(utc_stamp)"
      [[ ! -e "$stale" ]] || die "stale-staging destination already exists: '$stale'"
      if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN — would move the pre-existing staging bundle aside: '$STAGING_DIR' -> '$stale'"
      else
        log "Moving the pre-existing staging bundle aside (not deleting it): '$stale'"
        mv -- "$STAGING_DIR" "$stale"
      fi
    else
      die "staging bundle '$STAGING_DIR' already exists and may be stale. Re-run with --clean-staging (moves it aside, never deletes) or --skip-build (promote it as-is)."
    fi
  elif [[ "$skip_build" == "true" ]]; then
    die "--skip-build was given but the staging bundle '$STAGING_DIR' does not exist."
  fi

  assert_same_filesystem "$STAGING_DIR" "$APP_DIR"
  [[ "$have_live" == "false" ]] || assert_same_filesystem "$LIVE_DIR" "$rollback_dir"

  # 5. Build. NORAMEDI_FRONTEND_BUILD_CMD exists so the regression suite can
  #    drive every path in this script without a Vite toolchain; production
  #    leaves it unset and gets the repository's own build script.
  local build_cmd="${NORAMEDI_FRONTEND_BUILD_CMD:-npm run build -- --outDir dist.next}"
  if [[ "$skip_build" == "true" ]]; then
    log "Skipping build (--skip-build); validating the existing staging bundle."
  elif [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN — would run in '$APP_DIR': $build_cmd"
  else
    log "Building frontend into $(basename -- "$STAGING_DIR")..."
    if ! ( cd "$APP_DIR" && eval "$build_cmd" ); then
      die "frontend build failed. The live bundle at '$LIVE_DIR' is UNCHANGED — nothing was renamed."
    fi
    log "Build completed."
  fi

  # 6. Artifact validation + release marker.
  if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN — would validate '$STAGING_DIR' and write its $RELEASE_MARKER_NAME (releaseSha=$release_sha)."
    log "DRY RUN — would promote: mv '$LIVE_DIR' '$rollback_dir' then mv '$STAGING_DIR' '$LIVE_DIR'"
    log "DRY RUN — no build, no rename, no delete, no state file written. Live bundle untouched."
    log "=== DRY RUN complete — zero mutations ==="
    return 0
  fi

  validate_bundle "$STAGING_DIR" "the staging bundle"
  write_release_marker "$STAGING_DIR" "$release_sha"

  local previous_sha="none"
  if [[ "$have_live" == "true" ]]; then
    previous_sha="$(read_marker_field "$LIVE_DIR" releaseSha)"
    [[ -n "$previous_sha" ]] || previous_sha="unknown"
  fi

  # 7. Promotion — TWO-STEP SAME-FILESYSTEM RENAME PROMOTION. Near-atomic.
  #    NOT a single atomic exchange.
  if [[ "$have_live" == "true" ]]; then
    log "Promotion step 1/2 — preserving the current live bundle: '$LIVE_DIR' -> '$rollback_dir'"
    mv -- "$LIVE_DIR" "$rollback_dir" \
      || die "could not preserve the current live bundle. Nothing was renamed; '$LIVE_DIR' is UNCHANGED."

    log "Promotion step 2/2 — activating the new bundle: '$STAGING_DIR' -> '$LIVE_DIR'"
    if ! mv -- "$STAGING_DIR" "$LIVE_DIR"; then
      # The one window this contract has. Bounded best-effort restoration:
      # put the preserved bundle straight back so production is never left
      # without a live directory.
      warn "activating the new bundle FAILED after the previous one was already preserved. Attempting to restore '$rollback_dir' -> '$LIVE_DIR'."
      if mv -- "$rollback_dir" "$LIVE_DIR"; then
        die "promotion failed at step 2/2; the PREVIOUS live bundle was RESTORED to '$LIVE_DIR'. The site is serving the pre-deploy build. The new build remains staged at '$STAGING_DIR'."
      fi
      die "promotion failed at step 2/2 AND restoration failed. '$LIVE_DIR' does not exist. The previous bundle is intact at '$rollback_dir' and the new one at '$STAGING_DIR' — restore manually with: mv '$rollback_dir' '$LIVE_DIR'"
    fi
  else
    log "Promotion (initial) — activating the new bundle: '$STAGING_DIR' -> '$LIVE_DIR'"
    mv -- "$STAGING_DIR" "$LIVE_DIR" \
      || die "could not activate the new bundle. No live bundle existed before this run and none exists now; the build remains at '$STAGING_DIR'."
  fi

  # 8. State — written only after a successful promotion, so it can never
  #    point at a bundle that was not actually superseded.
  if [[ "$have_live" == "true" ]]; then
    write_state "$APP_DIR" "$rollback_dir" "$release_sha" "$previous_sha"
    log "Rollback point recorded in $STATE_FILE_NAME -> $rollback_dir"
  else
    write_state "$APP_DIR" "" "$release_sha" "none"
    log "No rollback point recorded (initial deploy)."
  fi

  # 9. Post-promotion verification of what is now live.
  validate_bundle "$LIVE_DIR" "the live bundle"
  report_release_state

  log "=== Frontend deploy complete — $LIVE_DIR is serving $release_sha ==="
  if [[ "$have_live" == "true" ]]; then
    log "Roll back with: $0 rollback --from '$rollback_dir'"
  fi
}

# ════════════════════════════════════════════════════════════════════════
# rollback
# ════════════════════════════════════════════════════════════════════════
cmd_rollback() {
  local from="" tag="preroll"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir) take_value --app-dir "${2-}"; APP_DIR_OPT="$OPT_VALUE"; shift 2 ;;
      --from)    take_value --from    "${2-}"; from="$OPT_VALUE";        shift 2 ;;
      --tag)     take_value --tag     "${2-}"; tag="$OPT_VALUE";         shift 2 ;;
      --dry-run) DRY_RUN=true; shift ;;
      -h|--help) usage ;;
      *) die "Unknown rollback option: $1 (run with --help for usage)" ;;
    esac
  done

  resolve_paths
  assert_safe_tag "$tag"
  log "=== NoraMedi frontend rollback ($SCRIPT_TASK)$([[ "$DRY_RUN" == "true" ]] && echo ' — DRY RUN') ==="
  log "Deployment root : $APP_DIR"

  # 1. Resolve the source. Either explicit, or the exact path the last deploy
  #    recorded. `ls` ordering is never consulted — "most recent looking
  #    directory name" is not a rollback contract.
  if [[ -z "$from" ]]; then
    from="$(read_state_field "$APP_DIR" ROLLBACK_DIR)"
    [[ -n "$from" ]] \
      || die "no rollback target given and none recorded in '$APP_DIR/$STATE_FILE_NAME'. Pass the exact bundle with --from <dir>. This script does not guess a target from directory listings."
    log "Rollback source : $from (from $STATE_FILE_NAME)"
  else
    log "Rollback source : $from (explicit --from)"
  fi

  local src; src="$(canonicalize "$from")"

  # 2. Bound the source exactly as tightly as every other path.
  assert_child_of "$APP_DIR" "$src" "the rollback source"
  # Ordered BEFORE the name check on purpose: "dist" can never match
  # dist.rollback-*, so if these two lines came second they would be
  # unreachable and the operator would get a misleading message for the single
  # most plausible typo — `--from <app-dir>/dist`, which would rename the live
  # bundle onto itself.
  [[ "$src" != "$LIVE_DIR" ]] || die "rollback source is the live bundle itself ('$LIVE_DIR'); refusing."
  [[ "$src" != "$STAGING_DIR" ]] || die "rollback source is the staging bundle ('$STAGING_DIR'); refusing."
  case "$(basename -- "$src")" in
    dist.rollback-*) : ;;
    *) die "rollback source '$src' is not named dist.rollback-*; refusing to promote an arbitrary directory into the live path." ;;
  esac
  [[ -d "$src" ]] || die "rollback source does not exist or is not a directory: '$src'"
  [[ ! -L "$src" ]] || die "rollback source '$src' is a symlink; refusing."
  validate_bundle "$src" "the rollback source"

  # 3. The current live bundle is PRESERVED, never discarded — a rollback must
  #    itself be reversible, and the only known-good copy must never be the
  #    thing that gets destroyed.
  local preserve_dir="$APP_DIR/dist.rollback-$tag-$(utc_stamp)"
  assert_child_of "$APP_DIR" "$preserve_dir" "the preserved bundle"
  [[ ! -e "$preserve_dir" ]] || die "preserved-bundle destination already exists: '$preserve_dir'"

  local have_live=true
  [[ -d "$LIVE_DIR" ]] || have_live=false
  if [[ "$have_live" == "true" ]]; then
    assert_same_filesystem "$LIVE_DIR" "$preserve_dir"
  fi
  assert_same_filesystem "$src" "$LIVE_DIR"

  local from_sha to_sha
  to_sha="$(read_marker_field "$src" releaseSha)"; [[ -n "$to_sha" ]] || to_sha="unknown"
  from_sha="none"
  if [[ "$have_live" == "true" ]]; then
    from_sha="$(read_marker_field "$LIVE_DIR" releaseSha)"; [[ -n "$from_sha" ]] || from_sha="unknown"
  fi
  log "Rolling back    : $from_sha -> $to_sha"

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ "$have_live" == "true" ]]; then
      log "DRY RUN — would preserve the current live bundle: mv '$LIVE_DIR' '$preserve_dir'"
    else
      log "DRY RUN — no live bundle exists; nothing would be preserved."
    fi
    log "DRY RUN — would activate: mv '$src' '$LIVE_DIR'"
    log "DRY RUN — no rename, no delete, no state file written. Live bundle untouched."
    log "=== DRY RUN complete — zero mutations ==="
    return 0
  fi

  # 4. Same two-step same-filesystem rename promotion, same semantics, same
  #    bounded restoration on a step-2 failure.
  if [[ "$have_live" == "true" ]]; then
    log "Rollback step 1/2 — preserving the current live bundle: '$LIVE_DIR' -> '$preserve_dir'"
    mv -- "$LIVE_DIR" "$preserve_dir" \
      || die "could not preserve the current live bundle. Nothing was renamed; '$LIVE_DIR' is UNCHANGED."
  fi

  log "Rollback step 2/2 — activating the restored bundle: '$src' -> '$LIVE_DIR'"
  if ! mv -- "$src" "$LIVE_DIR"; then
    if [[ "$have_live" == "true" ]]; then
      warn "activating the restored bundle FAILED after the current one was already preserved. Attempting to restore '$preserve_dir' -> '$LIVE_DIR'."
      if mv -- "$preserve_dir" "$LIVE_DIR"; then
        die "rollback failed at step 2/2; the bundle that was live before this rollback was RESTORED to '$LIVE_DIR'. The rollback source is untouched at '$src'."
      fi
      die "rollback failed at step 2/2 AND restoration failed. '$LIVE_DIR' does not exist. Both bundles are intact — restore manually with: mv '$preserve_dir' '$LIVE_DIR'"
    fi
    die "could not activate the restored bundle and no live bundle existed. '$src' is untouched."
  fi

  if [[ "$have_live" == "true" ]]; then
    write_state "$APP_DIR" "$preserve_dir" "$to_sha" "$from_sha"
    log "Undo point recorded in $STATE_FILE_NAME -> $preserve_dir"
  else
    write_state "$APP_DIR" "" "$to_sha" "none"
  fi

  validate_bundle "$LIVE_DIR" "the live bundle"
  report_release_state

  log "=== Frontend rollback complete — $LIVE_DIR is serving $to_sha ==="
  if [[ "$have_live" == "true" ]]; then
    log "Undo this rollback with: $0 rollback --from '$preserve_dir'"
  fi
}

# ════════════════════════════════════════════════════════════════════════
# verify
# ════════════════════════════════════════════════════════════════════════
# report_release_state prints the three lines an operator and a runbook both
# key off. A frontend problem is never hidden behind a healthy backend: the
# frontend lines are produced from the frontend bundle alone.
report_release_state() {
  local fe be match
  fe="$(read_marker_field "$LIVE_DIR" releaseSha)"; [[ -n "$fe" ]] || fe="UNKNOWN"
  be="$(backend_release_sha noramedi-api)"
  if [[ "$be" == "NOT_APPLICABLE" || "$be" == "UNSET" || "$fe" == "UNKNOWN" ]]; then
    match="NOT_APPLICABLE"
  elif [[ "$be" == "$fe" ]]; then
    match="YES"
  else
    match="NO"
  fi
  log "FRONTEND_RELEASE_SHA = $fe"
  log "BACKEND_RELEASE_SHA  = $be"
  log "RELEASE_SHA_MATCH    = $match"
  [[ "$match" != "NO" ]] \
    || warn "backend and frontend are serving DIFFERENT releases. This is permitted by the deploy model (backend and frontend deploy independently) but must be a deliberate choice, not a surprise."
}

cmd_verify() {
  local url="" expect_sha="" failures=0 check_backend=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir)       take_value --app-dir    "${2-}"; APP_DIR_OPT="$OPT_VALUE"; shift 2 ;;
      --url)           take_value --url        "${2-}"; url="$OPT_VALUE";         shift 2 ;;
      --expect-sha)    take_value --expect-sha "${2-}"; expect_sha="$OPT_VALUE";  shift 2 ;;
      --check-backend) check_backend=true; shift ;;
      --dry-run)       DRY_RUN=true; shift ;;
      -h|--help)       usage ;;
      *) die "Unknown verify option: $1 (run with --help for usage)" ;;
    esac
  done

  resolve_paths
  log "=== NoraMedi frontend verify ($SCRIPT_TASK) — read-only ==="
  log "Live bundle     : $LIVE_DIR"

  validate_bundle "$LIVE_DIR" "the live bundle"

  local fe; fe="$(read_marker_field "$LIVE_DIR" releaseSha)"
  if [[ -z "$fe" ]]; then
    warn "the live bundle has no $RELEASE_MARKER_NAME — it predates $SCRIPT_TASK or was placed by hand. Its source revision cannot be established from the bundle itself (this is the R-038 condition)."
    failures=$(( failures + 1 ))
  fi
  report_release_state

  if [[ -n "$expect_sha" ]]; then
    if [[ "$fe" == "$expect_sha" ]]; then
      log "OK — the live bundle records the expected release SHA."
    else
      warn "expected release SHA '$expect_sha' but the live bundle records '${fe:-<none>}'."
      failures=$(( failures + 1 ))
    fi
  fi

  # Optional reachability. Backend health stays with the existing script; it
  # is reported separately and never allowed to stand in for the frontend.
  if [[ -n "$url" ]]; then
    if command -v curl >/dev/null 2>&1; then
      local base="${url%/}" code
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/" 2>/dev/null || echo 000)"
      [[ "$code" == "200" ]] && log "OK — GET $base/ -> $code" \
        || { warn "GET $base/ -> $code"; failures=$(( failures + 1 )); }
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/$RELEASE_MARKER_NAME" 2>/dev/null || echo 000)"
      [[ "$code" == "200" ]] && log "OK — GET $base/$RELEASE_MARKER_NAME -> $code" \
        || { warn "GET $base/$RELEASE_MARKER_NAME -> $code"; failures=$(( failures + 1 )); }
    else
      warn "curl is not available; --url reachability checks were SKIPPED (reported, not silently passed)."
      failures=$(( failures + 1 ))
    fi
  fi

  # Backend health, reported on its own line and deliberately AFTER the
  # frontend result is already decided. The existing script owns this check;
  # nothing about it is reimplemented here, and it cannot rescue a frontend
  # failure — `failures` is already non-zero by this point if the bundle is bad.
  if [[ "$check_backend" == "true" ]]; then
    if [[ -x "$HEALTHCHECK" ]]; then
      if "$HEALTHCHECK" --local --max-attempts 12 --interval 5; then
        log "BACKEND_HEALTH = OK (via $HEALTHCHECK)"
      else
        warn "BACKEND_HEALTH = FAILED (via $HEALTHCHECK). This is a BACKEND problem and is reported separately from the frontend result above."
        failures=$(( failures + 1 ))
      fi
    else
      warn "BACKEND_HEALTH = SKIPPED — '$HEALTHCHECK' is not present or not executable (reported, not silently passed)."
      failures=$(( failures + 1 ))
    fi
  fi

  if [[ "$failures" -gt 0 ]]; then
    die "frontend verification finished with $failures problem(s) — see the warnings above."
  fi
  log "=== Frontend verification passed ==="
}

# ════════════════════════════════════════════════════════════════════════
# entry point
# ════════════════════════════════════════════════════════════════════════
[[ $# -gt 0 ]] || { echo "No command given. Run with --help for usage." >&2; exit 1; }

case "$1" in
  deploy)    shift; cmd_deploy   "$@" ;;
  rollback)  shift; cmd_rollback "$@" ;;
  verify)    shift; cmd_verify   "$@" ;;
  help|-h|--help) usage ;;
  *) echo "Unknown command: $1 (expected deploy, rollback, verify, or help)" >&2; exit 1 ;;
esac

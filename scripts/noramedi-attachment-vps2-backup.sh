#!/usr/bin/env bash
# noramedi-attachment-vps2-backup.sh — F4-ATTACH-001-R1
# Deploy to: /usr/local/sbin/noramedi-attachment-vps2-backup.sh (NOT installed by this task)
# Intended runner: ops/systemd/noramedi-attachment-vps2-backup.{service,timer}
#
# Client-side-ENCRYPTED, versioned, off-host secondary copy of the VPS1
# PatientAttachment/LabOrderAttachment/ImagingImage local-storage tree
# (server/src/services/fileStorage.ts's `uploads/` root — see
# docs/program/evidence/F4-ATTACH-001-R1_VPS2_ENCRYPTED_SECONDARY_REPLICA_DISCOVERY_AND_PLAN.md
# §3 for why restic was selected over a raw mirror, an rclone-crypt remote,
# or the existing dormant `FILE_BACKUP_S3_*` application-layer path).
#
# ⚠ THIS SCRIPT NEVER TOUCHES PRIMARY STORAGE. It only ever reads
# NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR; it has no delete/write path against it.
# It does not use, read, or reference the pgBackRest repo2 config/credentials,
# the GlitchTip account/directories, or any DICOM/imaging-remote-storage
# credential — those remain a program-level prohibition, not merely an
# implementation detail this script happens to avoid.
#
# WHY RESTIC AND NOT A CUSTOM SCRIPT AROUND rsync/tar:
# restic encrypts every chunk client-side (AES-256 + Poly1305) BEFORE it ever
# leaves this host, deduplicates content-addressed chunks (so a re-run is
# cheap and idempotent without any bookkeeping this script has to invent), and
# stores data as a VERSIONED, CONTENT-ADDRESSED SNAPSHOT REPOSITORY: deleting
# a source file does not propagate as a destructive mirror deletion, because
# an ordinary backup run never removes an existing snapshot — only a separate,
# explicit `forget` (reference removal) followed by `prune` (reclamation)
# does. That is a plain `rsync --delete` mirror cannot provide.
#
# ⚠ THIS IS NOT ENFORCED APPEND-ONLY / IMMUTABLE / WORM STORAGE. The SFTP
# account this repository lives behind has ordinary read/write/delete rights
# over the repository path (see the env-example's account contract) — a
# compromised credential, an operator running `forget`+`prune`, or a direct
# `rm` against the repository path on VPS2 CAN destroy snapshot history.
# restic's snapshot model only means normal backup operation never deletes
# data as a side effect; it is not a substitute for object-lock/WORM storage,
# which this restricted-SFTP topology does not provide and which remains a
# DEFERRED, not-yet-selected future hardening option (discovery document
# §3.2/§4).
#
# NEVER logs a patient filename, clinic id, storage key, or file path. Only
# aggregate counts/bytes/duration from restic's own `--json` summary line are
# ever written to stdout/stderr or the status file.
#
# Usage:
#   noramedi-attachment-vps2-backup.sh [--source DIR] [--tag TAG] [--dry-run]
#                                       [-h|--help]
#
# Options:
#   --source DIR  Override NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR for this run.
#   --tag TAG     Extra restic tag appended to the fixed `attachment-vps2`
#                 tag (e.g. a restore-proof caller uses `--tag restore-proof`
#                 against a disposable synthetic source — see
#                 noramedi-attachment-vps2-restore-proof.sh). Must match
#                 ^[a-z0-9][a-z0-9_-]{0,63}$.
#   --dry-run     Run every precondition, print the exact restic command,
#                 invoke nothing. Safe to run on production at any time.
#
# Environment (optional; defaults shown):
#   NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR   /var/www/noramedi/server/uploads
#   NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE    /var/lock/noramedi-attachment-vps2.lock
#                                          (this job's OWN operation lock —
#                                          deliberately separate from check's
#                                          and restore-proof's own operation
#                                          locks, and from the status-write
#                                          lock below, so a slow check or
#                                          restore-proof never blocks a
#                                          backup from starting)
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE  /var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE
#                                          /var/lock/noramedi-attachment-vps2-status.lock
#                                          A SEPARATE, short-lived lock held
#                                          ONLY while reading-merging-writing
#                                          the shared status document — never
#                                          held for the duration of the
#                                          restic call itself. Shared by all
#                                          three attachment-vps2 scripts (this
#                                          one, check, restore-proof) so a
#                                          concurrent writer always merges
#                                          onto the other's freshest write
#                                          instead of losing it to an
#                                          unsynchronized read-modify-write —
#                                          see with_status_lock() below.
#   NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT  3600   seconds; the whole restic call is
#                                          wrapped in `timeout`
#   NORAMEDI_ATTACHMENT_VPS2_PING_URL     Healthchecks.io-style heartbeat: a
#                                          plain GET on success, GET "$URL/fail"
#                                          on a known failure. Same convention
#                                          as scripts/noramedi-opscheck.sh — see
#                                          that script's header. Optional; no
#                                          ping is sent when unset.
#   RESTIC_REPOSITORY   sftp:noramedi-attach-backup@<vps2-host>:/srv/noramedi-attachment-vps2/repo
#                        (required; restic's own variable, read directly by
#                        the `restic` binary — never echoed by this script)
#   RESTIC_PASSWORD_FILE  path to the repo passphrase file — MUST resolve to a
#                        file on THIS host (VPS1), never on VPS2. Required.
#                        Its contents are never read by this script; restic
#                        reads it directly. See the discovery document §4 for
#                        the escrow requirement (the passphrase must also be
#                        escrowed off both hosts, exactly as repo2-cipher-pass
#                        was for pgBackRest — this script does not perform
#                        that escrow, which remains an operator action).
#   RESTIC_CACHE_DIR     /var/lib/noramedi-attachment-vps2/cache (restic's own
#                        variable; set explicitly so systemd's ReadWritePaths
#                        can be scoped to it instead of the caller's $HOME)
#
# Exit codes (distinct on purpose — cron/systemd mail and journald must be
# able to tell these apart, mirroring scripts/noramedi-pgbackrest-backup.sh):
#   0  success
#   1  restic reported a failure
#   2  usage / CLI error, or an invalid environment value (fail closed)
#   3  precondition failure (restic not installed, RESTIC_REPOSITORY/
#      RESTIC_PASSWORD_FILE unset, RESTIC_PASSWORD_FILE unreadable, source
#      directory missing, node unavailable for JSON parsing)
#   5  another run holds the lock (not an error; scheduler overlap)
#   124 the restic call exceeded NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT (from
#      `timeout`'s own convention, preserved rather than remapped)

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
LOCKED_EXIT_CODE=5

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[attachment-vps2-backup] $(timestamp) $*"; }
fail() { echo "[attachment-vps2-backup] $(timestamp) FAIL — $*" >&2; }

SOURCE_DIR="${NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR:-/var/www/noramedi/server/uploads}"
EXTRA_TAG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)  SOURCE_DIR="${2:-}"; shift 2 ;;
    --tag)     EXTRA_TAG="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

if [[ -n "$EXTRA_TAG" ]] && [[ ! "$EXTRA_TAG" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]; then
  echo "Invalid --tag '$EXTRA_TAG'" >&2; exit "$USAGE_ERROR_EXIT_CODE"
fi

LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_LOCK_FILE:-/var/lock/noramedi-attachment-vps2.lock}"
STATUS_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE:-/var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json}"
STATUS_LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-status.lock}"
CMD_TIMEOUT="${NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT:-3600}"
PING_URL="${NORAMEDI_ATTACHMENT_VPS2_PING_URL:-}"

[[ "$CMD_TIMEOUT" =~ ^[0-9]+$ ]] && [[ "$CMD_TIMEOUT" -gt 0 ]] || {
  echo "Invalid NORAMEDI_ATTACHMENT_VPS2_CMD_TIMEOUT '$CMD_TIMEOUT'" >&2; exit "$USAGE_ERROR_EXIT_CODE"; }

# ── ping helpers (best-effort; never fail the run because monitoring failed to
#    send a heartbeat — the whole point of a dead-man's-switch is that a
#    MISSING ping alarms on its own, so a network blip here degrades safely) ──
ping_ok()   { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL"      || true; }
ping_fail() { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL/fail" || true; }

# ── status-write lock (SEPARATE from this script's own operation lock above)
#    — held only for the brief read-merge-write below, never for the restic
#    call itself, and shared by all three attachment-vps2 scripts against the
#    SAME status document. Without this, two scripts finishing around the
#    same time can each read the same on-disk version, merge their own field
#    in, and write back — the second writer's version silently overwrites the
#    first writer's update (a classic unsynchronized read-modify-write lost
#    update), even though each script's own JSON merge code only ever touches
#    its own top-level key. Never let a stuck status write fail the run whose
#    real result (backup/check/restore-proof) already happened — log and
#    return non-zero, but the caller does not treat that as this run's own
#    failure.
with_status_lock() {
  local lock_dir
  lock_dir="$(dirname "$STATUS_LOCK_FILE")"
  mkdir -p "$lock_dir" 2>/dev/null || true
  # Everything below runs in a SUBSHELL specifically so that a bare `exec`
  # (needed to attach fd 8 to a file so `flock` can lock it) scopes its
  # redirections to this subshell only. `exec N>file` with no command word
  # applies ALL its redirections PERMANENTLY to the CURRENT shell — an
  # earlier revision called it directly in this function's own shell, which
  # silently and permanently redirected this script's own stderr to
  # /dev/null after the first status write, masking every later error
  # message. The subshell's fd table (and any lock held through it) is
  # discarded when it exits, so no explicit unlock/close is needed either.
  (
    exec 8>"$STATUS_LOCK_FILE" 2>/dev/null || {
      fail "cannot open status-write lock file '$STATUS_LOCK_FILE' — status not updated this run"
      exit 1
    }
    if ! flock -w 10 8; then
      fail "could not acquire the status-write lock within 10s — status file left unchanged this run"
      exit 1
    fi
    "$@"
  )
}

# ── overlap guard — identical shape to noramedi-pgbackrest-backup.sh; see that
#    script's comment for why this is a fd-held flock and not `flock -n file cmd`.
if [[ "$DRY_RUN" != true ]]; then
  command -v flock >/dev/null 2>&1 || {
    fail "flock is not available; refusing to run without an overlap guard"
    exit "$PRECONDITION_EXIT_CODE"
  }
  LOCK_DIR="$(dirname "$LOCK_FILE")"
  [[ -d "$LOCK_DIR" ]] && [[ -w "$LOCK_DIR" ]] || {
    fail "lock directory '$LOCK_DIR' does not exist or is not writable"
    exit "$PRECONDITION_EXIT_CODE"
  }
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    fail "another attachment-vps2 backup run holds $LOCK_FILE — skipping this run"
    exit "$LOCKED_EXIT_CODE"
  fi
fi

# ── preconditions ────────────────────────────────────────────────────────
command -v restic >/dev/null 2>&1 || { fail "restic is not installed"; exit "$PRECONDITION_EXIT_CODE"; }
command -v node    >/dev/null 2>&1 || { fail "node is not available (required to parse restic --json output; no jq dependency exists anywhere in this repository)"; exit "$PRECONDITION_EXIT_CODE"; }
command -v timeout >/dev/null 2>&1 || { fail "timeout is not available"; exit "$PRECONDITION_EXIT_CODE"; }

# Plain [[ -n ]] checks, deliberately NOT bash's ${VAR:?msg} form: under
# `set -e` in a non-interactive shell, a failed :? parameter expansion
# terminates the script immediately with exit 1 — it is NOT a command
# failure `||` can intercept, so it cannot be made to return this script's
# own distinct PRECONDITION_EXIT_CODE. Caught by this repository's own test
# suite (scripts/noramedi-attachment-vps2.test.sh) after an earlier revision
# used :? here and every precondition test silently got exit 1 instead of 3.
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { fail "RESTIC_REPOSITORY is not set"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" ]] || { fail "RESTIC_PASSWORD_FILE is not set"; exit "$PRECONDITION_EXIT_CODE"; }

[[ -d "$SOURCE_DIR" ]] || { fail "source directory '$SOURCE_DIR' does not exist"; exit "$PRECONDITION_EXIT_CODE"; }

case "$RESTIC_PASSWORD_FILE" in
  /*) : ;;
  *) fail "RESTIC_PASSWORD_FILE must be an absolute path"; exit "$PRECONDITION_EXIT_CODE" ;;
esac
[[ -r "$RESTIC_PASSWORD_FILE" ]] || {
  fail "RESTIC_PASSWORD_FILE is not readable by this process (path itself not logged)"
  exit "$PRECONDITION_EXIT_CODE"
}

STATUS_DIR="$(dirname "$STATUS_FILE")"
if [[ "$DRY_RUN" != true ]]; then
  mkdir -p "$STATUS_DIR" 2>/dev/null || { fail "cannot create status directory '$STATUS_DIR'"; exit "$PRECONDITION_EXIT_CODE"; }
fi

# ── build the command ────────────────────────────────────────────────────
TAGS=(--tag attachment-vps2)
[[ -n "$EXTRA_TAG" ]] && TAGS+=(--tag "$EXTRA_TAG")

RESTIC_ARGS=(backup "${TAGS[@]}" --exclude-caches --one-file-system --json "$SOURCE_DIR")

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would run: timeout ${CMD_TIMEOUT}s restic ${RESTIC_ARGS[*]}"
  log "DRY-RUN: RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE are read directly by restic and are never printed by this script"
  log "DRY-RUN: nothing was invoked"
  exit 0
fi

log "starting backup of '$SOURCE_DIR' (path itself is an operational directory, not patient data)"
START_EPOCH="$(date -u +%s)"

RESTIC_OUT="$(mktemp)"
trap 'rm -f "$RESTIC_OUT"' EXIT

# restic's --json mode still emits verbose per-file 'status' messages by
# default, and a raw stderr passthrough on failure (e.g. a permission-denied
# message) can embed a local path. Both stdout AND stderr are therefore
# captured into the SAME file and never printed verbatim — on success only
# the parsed 'summary' message's aggregate counters are used (below); on
# failure only an aggregate line count is logged (never the line content),
# matching noramedi-attachment-vps2-check.sh's same discipline.
set +e
timeout "${CMD_TIMEOUT}s" restic "${RESTIC_ARGS[@]}" >"$RESTIC_OUT" 2>&1
RESTIC_EXIT=$?
set -e

DURATION=$(( $(date -u +%s) - START_EPOCH ))

if [[ "$RESTIC_EXIT" -ne 0 ]]; then
  OUT_LINE_COUNT="$(grep -c . "$RESTIC_OUT" || true)"
  fail "restic backup failed (exit ${RESTIC_EXIT}) after ${DURATION}s — ${OUT_LINE_COUNT} output lines captured, no line content logged (no file path or filename is ever added by this wrapper)"
  with_status_lock node -e '
    const fs = require("fs");
    const statusFile = process.argv[1];
    let doc = {};
    try { doc = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { doc = {}; }
    doc.schemaVersion = 1;
    doc.generatedAt = process.argv[2];
    doc.backup = doc.backup || {};
    doc.backup.lastRunAt = process.argv[2];
    doc.backup.lastRunStatus = "failed";
    doc.backup.lastRunExitCode = Number(process.argv[3]);
    doc.backup.lastRunDurationSeconds = Number(process.argv[4]);
    // Atomic write: temp file in the same directory + fsync + rename, so a
    // concurrent reader (or a crash mid-write) never observes a partial file.
    const tmp = statusFile + ".tmp." + process.pid;
    const fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, JSON.stringify(doc, null, 2) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, statusFile);
  ' "$STATUS_FILE" "$(timestamp)" "$RESTIC_EXIT" "$DURATION" 2>/dev/null || true
  ping_fail
  exit 1
fi

# Extract the single 'summary' JSON line and write the status file. Never
# echoes the raw restic output (which restic itself never populates with
# filenames in --json summary mode, but this keeps the guarantee structural
# rather than dependent on restic's own behavior).
with_status_lock node -e '
  const fs = require("fs");
  const [, , rawOutPath, statusFile, generatedAt, durationStr] = process.argv;
  const lines = fs.readFileSync(rawOutPath, "utf8").split("\n").filter(Boolean);
  let summary = null;
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.message_type === "summary") summary = msg;
    } catch { /* ignore non-JSON / partial lines */ }
  }
  if (!summary) {
    console.error("[attachment-vps2-backup] restic exited 0 but no summary message was found — treating as failure");
    process.exit(1);
  }
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { doc = {}; }
  doc.schemaVersion = 1;
  doc.generatedAt = generatedAt;
  doc.backup = {
    lastRunAt: generatedAt,
    lastRunStatus: "completed",
    lastRunExitCode: 0,
    lastRunDurationSeconds: Number(durationStr),
    snapshotId: summary.snapshot_id || null,
    filesNew: summary.files_new ?? null,
    filesChanged: summary.files_changed ?? null,
    filesUnmodified: summary.files_unmodified ?? null,
    totalBytesProcessed: summary.total_bytes_processed ?? null,
  };
  const tmp = statusFile + ".tmp." + process.pid;
  const fd = fs.openSync(tmp, "w");
  fs.writeSync(fd, JSON.stringify(doc, null, 2) + "\n");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, statusFile);
' "$RESTIC_OUT" "$STATUS_FILE" "$(timestamp)" "$DURATION"

log "backup completed in ${DURATION}s"
ping_ok
log "done"
exit 0

#!/usr/bin/env bash
# noramedi-attachment-vps2-restore-proof.sh — F4-ATTACH-001-R1
# Deploy to: /usr/local/sbin/noramedi-attachment-vps2-restore-proof.sh (NOT installed by this task)
#
# Synthetic, non-PHI restore proof for the attachment-vps2 secondary copy —
# Stage 6 of docs/program/evidence/F4-ATTACH-001-R1_VPS2_ENCRYPTED_SECONDARY_REPLICA_DISCOVERY_AND_PLAN.md.
#
# ⚠ NEVER operates on real PatientAttachment/LabOrderAttachment/ImagingImage
# files. It generates its OWN synthetic file with random, non-clinical bytes
# in a disposable temp directory, backs up ONLY that disposable directory
# (tagged `restore-proof`, never touching
# NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR), restores the resulting snapshot into a
# SECOND disposable directory, and compares SHA-256 digests. Both temp
# directories are removed in a `trap ... EXIT`, regardless of outcome, so a
# scheduled run never accumulates synthetic files on disk.
#
#   SOURCE synthetic file
#     → restic backup (tag=restore-proof) to the SAME VPS2 repository real
#       attachment backups use — this proves the actual repository this
#       program depends on, not a separate throwaway one
#     → source temp dir removed
#     → restic restore of that exact snapshot to a second disposable dir
#     → SHA-256 compared
#
# Usage:
#   noramedi-attachment-vps2-restore-proof.sh [--dry-run] [-h|--help]
#
# Environment (optional; defaults shown):
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE      /var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json
#   NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE /var/lock/noramedi-attachment-vps2-status.lock
#     A SEPARATE, short-lived lock held only while merging this script's own
#     result into the shared status document — never for the duration of the
#     restic calls themselves. Shared with backup.sh/check.sh against the
#     SAME status document so a concurrent writer always merges onto the
#     other's freshest write instead of losing it to an unsynchronized
#     read-modify-write.
#   NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE
#                                              /var/lock/noramedi-attachment-vps2-restore-proof.lock
#     This job's OWN operation lock — deliberately separate from backup's and
#     check's own operation locks (see those scripts' headers) so a slow or
#     stuck restore-proof run never blocks a daily backup or weekly check,
#     and vice versa.
#   NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_PING_URL  Healthchecks.io-style
#     heartbeat, same convention as the backup/check scripts. A missed
#     restore-proof run is exactly as diagnostic as a missed backup: a
#     repository that has never had a restore attempted against it is an
#     unproven claim, not a working backup.
#   RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE / RESTIC_CACHE_DIR — same as the
#     other two scripts.
#
# Exit codes:
#   0  restore proof PASSED (checksum matched)
#   1  restore proof FAILED (checksum mismatch, or restic reported an error)
#   2  usage / CLI error
#   3  precondition failure
#   5  another restore-proof run holds this job's own operation lock (not an
#      error; scheduler overlap — same convention as backup.sh/check.sh)

set -euo pipefail
export LC_ALL=C

USAGE_ERROR_EXIT_CODE=2
PRECONDITION_EXIT_CODE=3
LOCKED_EXIT_CODE=5

usage() { grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'; exit 0; }
timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[attachment-vps2-restore-proof] $(timestamp) $*"; }
fail() { echo "[attachment-vps2-restore-proof] $(timestamp) FAIL — $*" >&2; }

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit "$USAGE_ERROR_EXIT_CODE" ;;
  esac
done

LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-restore-proof.lock}"
STATUS_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE:-/var/lib/noramedi-attachment-vps2/status/attachment-vps2-status.json}"
STATUS_LOCK_FILE="${NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE:-/var/lock/noramedi-attachment-vps2-status.lock}"
PING_URL="${NORAMEDI_ATTACHMENT_VPS2_RESTOREPROOF_PING_URL:-}"

ping_ok()   { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL"      || true; }
ping_fail() { [[ -n "$PING_URL" ]] && curl -fsS --max-time 10 --retry 2 -o /dev/null "$PING_URL/fail" || true; }

# ── status-write lock — SEPARATE from this job's own operation lock below,
#    and SHARED with noramedi-attachment-vps2-backup.sh/-check.sh against the
#    same status document. See noramedi-attachment-vps2-backup.sh for the
#    full rationale.
with_status_lock() {
  local lock_dir rc
  lock_dir="$(dirname "$STATUS_LOCK_FILE")"
  mkdir -p "$lock_dir" 2>/dev/null || true
  # `flock FILE COMMAND [ARGS...]` — see noramedi-attachment-vps2-backup.sh's
  # own with_status_lock() for why this form (flock opens/locks/execs/
  # releases entirely in its own C code) replaced an earlier `exec N>FILE`
  # + subshell design that hit two separate bash pitfalls in turn (a bare
  # `exec` permanently redirecting this script's own stderr, then — even
  # once subshell-scoped — a bare subshell statement aborting the whole
  # script under `set -e` before its exit status could ever be captured).
  flock -w 10 "$STATUS_LOCK_FILE" "$@" && rc=0 || rc=$?
  # `if`, not a bare `[[ ]] && fail` — see noramedi-attachment-vps2-backup.sh's
  # own comment: under `set -e`, a bare `test && action` line is ITSELF a
  # "failing command" whenever the test is false (i.e. on the success path),
  # which would abort this function before it ever reaches `return` below.
  if [[ "$rc" -ne 0 ]]; then
    fail "status-write lock could not be acquired within 10s, or the status write itself failed (exit ${rc}) — status may be left unchanged this run"
  fi
  return "$rc"
}

command -v restic    >/dev/null 2>&1 || { fail "restic is not installed"; exit "$PRECONDITION_EXIT_CODE"; }
command -v node      >/dev/null 2>&1 || { fail "node is not available"; exit "$PRECONDITION_EXIT_CODE"; }
command -v sha256sum >/dev/null 2>&1 || { fail "sha256sum is not available"; exit "$PRECONDITION_EXIT_CODE"; }

# See noramedi-attachment-vps2-backup.sh's identical check for why this is a
# plain [[ -n ]] test and not bash's ${VAR:?msg} form.
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { fail "RESTIC_REPOSITORY is not set"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" ]] || { fail "RESTIC_PASSWORD_FILE is not set"; exit "$PRECONDITION_EXIT_CODE"; }
[[ -r "$RESTIC_PASSWORD_FILE" ]] || {
  fail "RESTIC_PASSWORD_FILE is not readable"; exit "$PRECONDITION_EXIT_CODE"; }

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would generate a synthetic file, restic backup --tag restore-proof it, restore it, and compare SHA-256"
  log "DRY-RUN: nothing was invoked"
  exit 0
fi

# ── overlap guard — this job's OWN operation lock, identical shape to
#    noramedi-attachment-vps2-backup.sh/-check.sh's own guards (a fd-held
#    flock, not `flock -n file cmd`) but a SEPARATE lock file from both, so a
#    slow restore-proof never blocks a backup or check and vice versa.
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
  fail "another attachment-vps2 restore-proof run holds $LOCK_FILE — skipping this run"
  exit "$LOCKED_EXIT_CODE"
fi

SRC_DIR="$(mktemp -d)"
RESTORE_DIR="$(mktemp -d)"
chmod 700 "$SRC_DIR" "$RESTORE_DIR"
cleanup() { rm -rf "$SRC_DIR" "$RESTORE_DIR"; }
trap cleanup EXIT

# A synthetic, non-PHI marker file: fixed-format content plus random bytes, so
# a restore-proof run's own SHA-256 can never coincidentally collide with a
# real attachment and this file could not be mistaken for clinical data if it
# ever leaked into a log (it never does — only the digest is logged below).
SYNTH_NAME="restore-proof-$(date -u +%Y%m%dT%H%M%SZ)-$$.bin"
{
  echo "NORAMEDI_ATTACHMENT_VPS2_RESTORE_PROOF_SYNTHETIC_FILE_NOT_PHI"
  head -c 4096 /dev/urandom | base64
} > "$SRC_DIR/$SYNTH_NAME"

SOURCE_SHA="$(sha256sum "$SRC_DIR/$SYNTH_NAME" | awk '{print $1}')"
log "generated synthetic file, sha256=${SOURCE_SHA}"

set +e
BACKUP_OUT="$(restic backup --tag restore-proof --json "$SRC_DIR" 2>&1)"
BACKUP_EXIT=$?
set -e
if [[ "$BACKUP_EXIT" -ne 0 ]]; then
  fail "restic backup of the synthetic file failed (exit ${BACKUP_EXIT})"
  ping_fail
  exit 1
fi

SNAPSHOT_ID="$(printf '%s\n' "$BACKUP_OUT" | node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try { const msg = JSON.parse(line); if (msg.message_type === "summary") { console.log(msg.snapshot_id); process.exit(0); } } catch {}
  }
  process.exit(1);
')"
if [[ -z "$SNAPSHOT_ID" ]]; then
  fail "could not determine the snapshot id from restic's backup summary"
  ping_fail
  exit 1
fi
log "backed up synthetic file as snapshot ${SNAPSHOT_ID}"

# Remove the source temp dir NOW, before restoring — the proof must show the
# bytes come back from VPS2, not that they were still sitting in $SRC_DIR.
rm -rf "$SRC_DIR"

set +e
restic restore "$SNAPSHOT_ID" --target "$RESTORE_DIR" >/dev/null 2>&1
RESTORE_EXIT=$?
set -e
if [[ "$RESTORE_EXIT" -ne 0 ]]; then
  fail "restic restore of snapshot ${SNAPSHOT_ID} failed (exit ${RESTORE_EXIT})"
  ping_fail
  exit 1
fi

RESTORED_PATH="$(find "$RESTORE_DIR" -type f -name "$SYNTH_NAME" | head -n1)"
if [[ -z "$RESTORED_PATH" ]] || [[ ! -f "$RESTORED_PATH" ]]; then
  fail "restored synthetic file was not found under ${RESTORE_DIR}"
  ping_fail
  exit 1
fi

RESTORED_SHA="$(sha256sum "$RESTORED_PATH" | awk '{print $1}')"

CHECKSUM_MATCH=false
[[ "$RESTORED_SHA" == "$SOURCE_SHA" ]] && CHECKSUM_MATCH=true

STATUS_DIR="$(dirname "$STATUS_FILE")"
mkdir -p "$STATUS_DIR" 2>/dev/null || true
with_status_lock node -e '
  const fs = require("fs");
  // `node -e` positional args start at argv[1] — no script-path placeholder
  // to also skip (unlike `node script.js arg1`). One leading skip only.
  const [, statusFile, generatedAt, snapshotId, match] = process.argv;
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { doc = {}; }
  doc.schemaVersion = 1;
  doc.generatedAt = generatedAt;
  doc.restoreProof = {
    lastRunAt: generatedAt,
    lastRunStatus: match === "true" ? "passed" : "failed",
    snapshotId,
    checksumMatch: match === "true",
  };
  const tmp = statusFile + ".tmp." + process.pid;
  const fd = fs.openSync(tmp, "w");
  fs.writeSync(fd, JSON.stringify(doc, null, 2) + "\n");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, statusFile);
' "$STATUS_FILE" "$(timestamp)" "$SNAPSHOT_ID" "$CHECKSUM_MATCH" 2>/dev/null || true

if [[ "$CHECKSUM_MATCH" != true ]]; then
  fail "CHECKSUM MISMATCH: source=${SOURCE_SHA} restored=${RESTORED_SHA} — restore proof FAILED"
  ping_fail
  exit 1
fi

log "restore proof PASSED — snapshot ${SNAPSHOT_ID}, sha256 ${SOURCE_SHA} matched after round-trip through VPS2"
ping_ok
log "done"
exit 0

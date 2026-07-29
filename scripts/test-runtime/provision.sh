#!/usr/bin/env bash
# F1-003-P2 — Disposable PostgreSQL/MinIO test-runtime entry point (Bash/Linux/CI).
#
# Thin wrapper only — all orchestration logic lives in orchestrator.ts (shared
# with the PowerShell entry point). POSIX-portable; suitable for local Linux
# and a future GitHub Actions job.
#
# Usage (from repository root):
#   scripts/test-runtime/provision.sh postgres
#   scripts/test-runtime/provision.sh storage
#   scripts/test-runtime/provision.sh verify-parallel
#   scripts/test-runtime/provision.sh postgres --inject-failure=test

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"
cd "$REPO_ROOT" || exit 1

PROFILE="${1:-}"
if [ -z "$PROFILE" ]; then
  echo "Usage: $0 <postgres|storage|verify-parallel> [--inject-failure=test|migration|readiness|cleanup]" >&2
  exit 2
fi
shift || true

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker is not available (engine unreachable). Start/verify the Docker daemon and retry." >&2
  exit 1
fi

CHILD_PID=""

cleanup_notice() {
  # Best-effort only: the orchestrator itself installs SIGINT/SIGTERM
  # handlers and attempts real teardown. This trap documents the platform
  # limitation (no guarantee survives a hard kill/daemon crash) and forwards
  # the signal to the child so its own handler can run.
  echo "[provision.sh] Received termination signal — forwarding to orchestrator; a hard kill is NOT guaranteed to clean up (documented limitation)." >&2
  if [ -n "$CHILD_PID" ]; then
    kill -TERM "$CHILD_PID" 2>/dev/null
    wait "$CHILD_PID"
  fi
  exit 143
}
trap cleanup_notice INT TERM

npx tsx scripts/test-runtime/orchestrator.ts "$PROFILE" "$@" &
CHILD_PID=$!
wait "$CHILD_PID"
exit $?

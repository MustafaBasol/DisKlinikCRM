#!/usr/bin/env bash
# F1-003-P2 — Stale disposable-runtime resource sweeper (Bash/Linux/CI).
#
# Defense-in-depth only, not the primary cleanup mechanism (the orchestrator's
# own per-run teardown is). Removes ONLY Docker resources labeled
# com.noramedi.test-runtime=true and older than the configured TTL. Never
# performs a broad docker system prune; never touches unlabeled resources.
#
# Usage:
#   scripts/test-runtime/sweep.sh                 # dry run (default)
#   scripts/test-runtime/sweep.sh --live
#   scripts/test-runtime/sweep.sh --live --ttl-hours=8

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"
cd "$REPO_ROOT" || exit 1

npx tsx scripts/test-runtime/orchestrator.ts cleanup-stale "$@"
exit $?

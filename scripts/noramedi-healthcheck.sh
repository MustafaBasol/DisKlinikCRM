#!/usr/bin/env bash
# noramedi-healthcheck.sh
# Deploy to: /usr/local/sbin/noramedi-healthcheck.sh
# chmod +x /usr/local/sbin/noramedi-healthcheck.sh
#
# Usage:
#   noramedi-healthcheck.sh [--local] [--max-attempts N] [--interval S]
#
# Probes the NoraMedi API health endpoint with retry logic.
# HTTP 401 is treated as SUCCESS (API is reachable; auth middleware rejects
# unauthenticated requests by design — this is expected behaviour).
# HTTP 502 / connection refused is retryable for a short window.
#
# Options:
#   --local          Probe http://127.0.0.1:5000/api/health instead of the
#                    public HTTPS endpoint.
#   --max-attempts N Maximum probe attempts before declaring failure.
#                    Default: 12  (≈ 60 s at 5 s intervals)
#   --interval S     Seconds to wait between attempts. Default: 5

set -euo pipefail

# ── defaults ────────────────────────────────────────────────────────────────
PUBLIC_URL="https://api.noramedi.com/api/health"
LOCAL_URL="http://127.0.0.1:5000/api/health"
USE_LOCAL=false
MAX_ATTEMPTS=12
INTERVAL=5

# ── argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      USE_LOCAL=true
      shift
      ;;
    --max-attempts)
      MAX_ATTEMPTS="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$USE_LOCAL" == "true" ]]; then
  TARGET_URL="$LOCAL_URL"
else
  TARGET_URL="$PUBLIC_URL"
fi

# ── helpers ──────────────────────────────────────────────────────────────────
timestamp() { date '+%H:%M:%S'; }

# ── probe loop ───────────────────────────────────────────────────────────────
echo "[$(timestamp)] Healthcheck start — target: $TARGET_URL"
echo "[$(timestamp)] Max attempts: $MAX_ATTEMPTS, interval: ${INTERVAL}s"

attempt=0
while true; do
  attempt=$(( attempt + 1 ))

  # curl: -s silent, -o discard body, -w write HTTP code, --max-time cap each call
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    "$TARGET_URL" 2>/dev/null) || HTTP_CODE="000"

  case "$HTTP_CODE" in
    200|204)
      echo "[$(timestamp)] OK ($HTTP_CODE) — API healthy after $attempt attempt(s)."
      exit 0
      ;;
    401|403)
      # Auth middleware intercepted the unauthenticated probe — API is running.
      echo "[$(timestamp)] OK ($HTTP_CODE) — API reachable (auth wall expected) after $attempt attempt(s)."
      exit 0
      ;;
    000|502|503|504)
      # Not up yet or gateway error — retryable.
      if [[ $attempt -ge $MAX_ATTEMPTS ]]; then
        echo "[$(timestamp)] FAILED — got $HTTP_CODE after $attempt attempt(s). API did not become ready." >&2
        exit 1
      fi
      echo "[$(timestamp)] Attempt $attempt/$MAX_ATTEMPTS — got $HTTP_CODE, retrying in ${INTERVAL}s..."
      sleep "$INTERVAL"
      ;;
    *)
      # Any other HTTP code (4xx, 5xx except 502-504) means the server responded.
      # Treat as healthy (API is up even if it signals an error for this path).
      echo "[$(timestamp)] OK ($HTTP_CODE) — API responded after $attempt attempt(s)."
      exit 0
      ;;
  esac
done

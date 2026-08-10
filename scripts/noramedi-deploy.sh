#!/usr/bin/env bash
# noramedi-deploy.sh
# Deploy to: /usr/local/sbin/noramedi-deploy.sh
# chmod +x /usr/local/sbin/noramedi-deploy.sh
#
# Full production deploy sequence:
#   1. git pull                                        (skip: --skip-pull)
#   2. npm ci                                           (skip: --skip-build)
#   3. prisma migrate deploy                            (skip: --skip-migrate)
#   4. prisma generate                                  (skip: --skip-generate)
#   5. pm2 startOrReload ecosystem.config.cjs --only noramedi-api --update-env
#   6. pm2 startOrReload ecosystem.config.cjs --only noramedi-worker --update-env
#   7. API healthcheck with retry (401 = healthy)
#   8. worker PM2-status verification with retry (F3-IMPL-002)
#
# Steps 5-8 use the repository-defined ecosystem.config.cjs (F3-IMPL-002) as
# the single source of truth for both PM2 processes — see that file's
# comments for the first-deploy-may-restart-not-reload caveat and for why
# only the API app sets RUN_BACKGROUND_JOBS=false.
#
# Usage:
#   noramedi-deploy.sh [OPTIONS]
#
# Options:
#   --skip-pull       Skip git pull (use current code)
#   --skip-build      Skip npm ci (deps unchanged)
#   --skip-migrate    Skip prisma migrate deploy
#   --skip-generate   Skip prisma generate
#   -h, --help        Show this help

set -euo pipefail

APP_DIR="${NORAMEDI_APP_DIR:-/var/www/noramedi}"
PM2_API_NAME="noramedi-api"
PM2_WORKER_NAME="noramedi-worker"
ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.cjs"
HEALTHCHECK="/usr/local/sbin/noramedi-healthcheck.sh"

SKIP_PULL=false
SKIP_BUILD=false
SKIP_MIGRATE=false
SKIP_GENERATE=false

usage() {
  grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-pull)     SKIP_PULL=true;     shift ;;
    --skip-build)    SKIP_BUILD=true;    shift ;;
    --skip-migrate)  SKIP_MIGRATE=true;  shift ;;
    --skip-generate) SKIP_GENERATE=true; shift ;;
    -h|--help)       usage ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 1 ;;
  esac
done

timestamp() { date '+%H:%M:%S'; }

echo "=== [$(timestamp)] NoraMedi deploy start ==="

# 1. Pull latest code
if [[ "$SKIP_PULL" == "false" ]]; then
  echo "[$(timestamp)] Pulling latest code..."
  git -C "$APP_DIR" pull --ff-only
fi

# Steps 2-4 run from the server directory so Prisma can locate schema.prisma.
pushd "$APP_DIR/server" >/dev/null

# 2. Install backend deps (includes devDependencies — tsx and prisma are needed at runtime)
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "[$(timestamp)] Installing backend dependencies..."
  npm ci
fi

# 3. Run migrations
if [[ "$SKIP_MIGRATE" == "false" ]]; then
  echo "[$(timestamp)] Running database migrations..."
  npx prisma migrate deploy
fi

# 4. Regenerate Prisma client (cheap; ensures client matches schema after migration)
if [[ "$SKIP_GENERATE" == "false" ]]; then
  echo "[$(timestamp)] Generating Prisma client..."
  npx prisma generate
fi

popd >/dev/null

# pm2_status_of NAME — prints the PM2 "status" field for app NAME (e.g.
# "online", "stopped", "errored"), or "missing" if no app with that name is
# registered. Never prints anything beyond the status word — no env/secrets.
pm2_status_of() {
  local name="$1"
  pm2 jlist | node -e '
    let raw = "";
    process.stdin.on("data", chunk => { raw += chunk; });
    process.stdin.on("end", () => {
      let apps;
      try { apps = JSON.parse(raw); } catch { process.stdout.write("unparseable"); return; }
      const app = apps.find(a => a.name === process.argv[1]);
      process.stdout.write(app && app.pm2_env ? String(app.pm2_env.status) : "missing");
    });
  ' "$name"
}

# verify_pm2_online NAME MAX_ATTEMPTS INTERVAL — polls pm2_status_of until it
# reports "online" or the attempt budget is exhausted. Returns non-zero on
# failure/timeout; never prints secrets (status word only).
verify_pm2_online() {
  local name="$1" max_attempts="$2" interval="$3" attempt=0 status
  while true; do
    attempt=$(( attempt + 1 ))
    status="$(pm2_status_of "$name" 2>/dev/null || echo error)"
    if [[ "$status" == "online" ]]; then
      echo "[$(timestamp)] OK — PM2 process '$name' is online after $attempt attempt(s)."
      return 0
    fi
    if [[ $attempt -ge $max_attempts ]]; then
      echo "[$(timestamp)] FAILED — PM2 process '$name' status is '$status' after $attempt attempt(s)." >&2
      return 1
    fi
    echo "[$(timestamp)] Attempt $attempt/$max_attempts — '$name' status '$status', retrying in ${interval}s..."
    sleep "$interval"
  done
}

# 5. Reload/start API (graceful reload if config unchanged; otherwise a
#    one-time restart — see ecosystem.config.cjs's operational note).
echo "[$(timestamp)] Reloading PM2 process: $PM2_API_NAME"
pm2 startOrReload "$ECOSYSTEM_FILE" --only "$PM2_API_NAME" --update-env

# 6. Reload/start worker. F3-IMPL-002: previously this process's deploy
#    lifecycle was entirely undefined in the repository (RISK_REGISTER.md
#    R-033) — a failure here is NOT silently ignored; the script aborts.
echo "[$(timestamp)] Reloading PM2 process: $PM2_WORKER_NAME"
pm2 startOrReload "$ECOSYSTEM_FILE" --only "$PM2_WORKER_NAME" --update-env

# Short grace period so PM2 marks both processes online before verification.
sleep 2

# 7. API healthcheck with retry
echo "[$(timestamp)] Running API healthcheck..."
"$HEALTHCHECK" --local --max-attempts 12 --interval 5

# 8. Worker verification. The worker has no HTTP surface (deliberately not
#    added — see F3-IMPL-002 evidence doc); PM2's own process status is the
#    non-invasive liveness signal, consistent with LAUNCH_GATES.md's
#    "PM2 online status" acceptance for worker health.
echo "[$(timestamp)] Verifying worker process state: $PM2_WORKER_NAME"
if ! verify_pm2_online "$PM2_WORKER_NAME" 12 5; then
  echo "[$(timestamp)] FATAL — $PM2_WORKER_NAME did not reach 'online' state." >&2
  echo "[$(timestamp)] Background jobs (reminders, retries, cleanup, sync) may not be running. Deploy aborted." >&2
  exit 1
fi

echo "=== [$(timestamp)] Deploy complete — $PM2_API_NAME and $PM2_WORKER_NAME both online ==="

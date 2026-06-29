#!/usr/bin/env bash
# noramedi-deploy.sh
# Deploy to: /usr/local/sbin/noramedi-deploy.sh
# chmod +x /usr/local/sbin/noramedi-deploy.sh
#
# Full production deploy sequence:
#   1. git pull                       (skip: --skip-pull)
#   2. npm ci                         (skip: --skip-build)
#   3. prisma migrate deploy          (skip: --skip-migrate)
#   4. prisma generate                (skip: --skip-generate)
#   5. pm2 reload noramedi-api --update-env
#   6. healthcheck with retry (401 = healthy)
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
PM2_NAME="noramedi-api"
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

# 5. Reload app (graceful — zero-downtime if cluster mode; instant otherwise)
echo "[$(timestamp)] Reloading PM2 process: $PM2_NAME"
pm2 reload "$PM2_NAME" --update-env

# Short grace period so PM2 marks the process online before healthcheck starts.
sleep 2

# 6. Healthcheck with retry
echo "[$(timestamp)] Running healthcheck..."
"$HEALTHCHECK" --local --max-attempts 12 --interval 5

echo "=== [$(timestamp)] Deploy complete ==="

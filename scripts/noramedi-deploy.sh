#!/usr/bin/env bash
# noramedi-deploy.sh
# Deploy to: /usr/local/sbin/noramedi-deploy.sh
# chmod +x /usr/local/sbin/noramedi-deploy.sh
#
# Usage:
#   noramedi-deploy.sh [--skip-build] [--skip-migrate]
#
# Full production deploy sequence:
#   1. git pull
#   2. npm ci (backend deps)
#   3. prisma migrate deploy
#   4. pm2 reload noramedi-api --update-env
#   5. healthcheck with retry (accepts 401 as healthy)
#
# Options:
#   --skip-build     Skip npm ci step (deps unchanged)
#   --skip-migrate   Skip prisma migrate deploy

set -euo pipefail

APP_DIR="${NORAMEDI_APP_DIR:-/var/www/noramedi}"
PM2_NAME="noramedi-api"
HEALTHCHECK="/usr/local/sbin/noramedi-healthcheck.sh"

SKIP_BUILD=false
SKIP_MIGRATE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)   SKIP_BUILD=true;   shift ;;
    --skip-migrate) SKIP_MIGRATE=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

timestamp() { date '+%H:%M:%S'; }

echo "=== [$(timestamp)] NoraMedi deploy start ==="

# 1. Pull latest code
echo "[$(timestamp)] Pulling latest code..."
git -C "$APP_DIR" pull --ff-only

# 2. Install backend deps
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "[$(timestamp)] Installing backend dependencies..."
  npm ci --prefix "$APP_DIR/server" --omit=dev
fi

# 3. Run migrations
if [[ "$SKIP_MIGRATE" == "false" ]]; then
  echo "[$(timestamp)] Running database migrations..."
  npx --prefix "$APP_DIR/server" prisma migrate deploy
fi

# 4. Reload app (graceful — zero-downtime if cluster mode; instant otherwise)
echo "[$(timestamp)] Reloading PM2 process: $PM2_NAME"
pm2 reload "$PM2_NAME" --update-env

# Short grace period so PM2 marks the process online before healthcheck starts.
sleep 2

# 5. Healthcheck with retry
echo "[$(timestamp)] Running healthcheck..."
"$HEALTHCHECK" --local --max-attempts 12 --interval 5

echo "=== [$(timestamp)] Deploy complete ==="

# F0-002 — Production Evidence Request (Stage B input)

**For the user to run, read-only, on the production VPS.** This is not run by the agent. Nothing in this file connects to production, restarts anything, migrates anything, or installs anything.

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, patient name, phone number, email address, clinical data, or private object path before pasting the results back into this conversation or into ChatGPT.

## How to use this file

1. SSH into the production VPS yourself (the agent does not have and must not be given production credentials).
2. Run the commands section by section, in order. Each section is self-contained and copy-pasteable.
3. Where a command depends on a name discovered in an earlier section (e.g. the app directory, the real PM2 process names), the later command uses that discovered value — do not assume the names below are correct until Section B/D confirm them.
4. Paste the output of Section K (the compact summary) back into this conversation once you've reviewed it against the warning banner above.

### Naming caveat

The repository contains these **expected** names (found in `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, and `server/src/services/backupService.ts` — see `F0-002_REPOSITORY_BASELINE.md` §6.6–6.7 for exact citations):

- App path: `/var/www/noramedi`
- Database name: `noramedi_crm`
- PM2 API process: `noramedi-api`
- PM2 worker process: `noramedi-worker` — **this name does not actually appear anywhere in the repository.** It is an expectation stated in the task, not a repository-confirmed fact. Section D below explicitly checks whether any such process exists rather than assuming it does.

Treat all four as hypotheses to confirm, not facts.

---

## A. Host and time

```bash
date -Is
hostname
uname -a
df -h
free -h
uptime
```

---

## B. Application Git state

```bash
# Confirm the expected app directory exists before assuming it
APP_DIR="/var/www/noramedi"
test -d "$APP_DIR" && echo "EXISTS: $APP_DIR" || echo "MISSING: $APP_DIR (check actual path before continuing)"

cd "$APP_DIR" || exit 1

git status --short --branch
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD   # branch name, or "HEAD" if detached
git log -1 --format='%H %ci %s'
git remote get-url origin

# Compare against the real remote main WITHOUT fetching or modifying local refs
git ls-remote origin refs/heads/main

# Are there local modifications?
git diff --stat
git status --short
```

---

## C. Runtime versions

```bash
node -v
npm -v
pm2 -v
psql --version 2>/dev/null || sudo -u postgres psql --version 2>/dev/null
redis-cli --version 2>/dev/null; systemctl is-active redis 2>/dev/null || systemctl is-active redis-server 2>/dev/null
nginx -v
```

---

## D. PM2 process state

```bash
pm2 list

# Look for the expected names explicitly, and report what actually exists
pm2 list | grep -E "noramedi|noramedi-api|noramedi-worker" || echo "No process matching 'noramedi*' found — report the full 'pm2 list' output above instead"

pm2 describe noramedi-api 2>/dev/null | grep -E "status|restarts|uptime" || echo "noramedi-api: not found by that name"
pm2 describe noramedi-worker 2>/dev/null | grep -E "status|restarts|uptime" || echo "noramedi-worker: not found by that name"
```

Do **not** run `pm2 env <id>`, `pm2 prettylist`, `pm2 show <id> --format json` (includes env), or any other command that would print process environment variables.

---

## E. Application health

```bash
# Repository healthcheck script availability
test -x /usr/local/sbin/noramedi-healthcheck.sh && echo "PRESENT and executable" || echo "MISSING or not executable"

# Nginx config syntax check (does not reload/restart nginx)
nginx -t

# Local health endpoint (repository-declared: server/src/index.ts, port default 5000)
curl -s -o /dev/null -w "local /api/health -> HTTP %{http_code}\n" --max-time 5 http://127.0.0.1:5000/api/health

# Public health endpoint — ONLY the hostname already declared in the repository
# (scripts/noramedi-healthcheck.sh). Do not substitute a guessed hostname.
curl -s -o /dev/null -w "public /api/health -> HTTP %{http_code}\n" --max-time 5 https://api.noramedi.com/api/health
```

A `200`, `204`, `401`, or `403` response is expected/healthy per the repository's own healthcheck logic (401/403 means the auth wall was reached, i.e. the API is up). `000`/`502`/`503`/`504` indicates a problem.

---

## F. Database and migrations

Metadata only — no clinical/business table is queried.

```bash
# Confirm the actual database name rather than assuming it
sudo -u postgres psql -l | grep -i noramedi

DB_NAME="noramedi_crm"   # adjust if the line above shows a different name

sudo -u postgres psql -d "$DB_NAME" -c "SELECT version();"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));"

# Latest migration entries (name, timing, rollback state only — no row data)
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 10;
"

# Failed/incomplete migrations (finished_at IS NULL means still-applying or failed)
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT count(*) AS incomplete_migrations
FROM _prisma_migrations
WHERE finished_at IS NULL;
"
```

Do not query any clinical, patient, appointment, billing, or message table.

---

## G. Configuration presence checks

**Print only SET / MISSING / EMPTY. Never print the value.**

```bash
APP_DIR="/var/www/noramedi"
ENV_FILE="$APP_DIR/server/.env"

check_var() {
  local name="$1"
  if [ ! -f "$ENV_FILE" ]; then
    echo "$name: CANNOT_CHECK (env file not found at $ENV_FILE)"
    return
  fi
  local line
  line=$(grep -E "^${name}=" "$ENV_FILE" || true)
  if [ -z "$line" ]; then
    echo "$name: MISSING"
  else
    local value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    if [ -z "$value" ]; then
      echo "$name: EMPTY"
    else
      echo "$name: SET"
    fi
  fi
}

for var in NODE_ENV DATABASE_URL JWT_SECRET PLATFORM_JWT_SECRET CSRF_SECRET ENCRYPTION_KEY REDIS_URL S3_BUCKET S3_REGION S3_ENDPOINT RUN_BACKGROUND_JOBS; do
  check_var "$var"
done
```

`NODE_ENV` and `RUN_BACKGROUND_JOBS` are non-secret mode flags — if you want, you may additionally report their literal values (e.g. `NODE_ENV=production`, `RUN_BACKGROUND_JOBS=false`) since they carry no sensitive information. All other variables above: SET/MISSING/EMPTY only, never the value.

---

## H. Storage

```bash
APP_DIR="/var/www/noramedi"

# Local upload directory presence and size (no filenames/content listed)
test -d "$APP_DIR/server/uploads" && echo "uploads dir EXISTS" || echo "uploads dir MISSING"
du -sh "$APP_DIR/server/uploads" 2>/dev/null || echo "cannot measure (missing or inaccessible)"

# S3 configuration presence only (reuses the SET/MISSING check from Section G)
grep -qE "^S3_BUCKET=" "$APP_DIR/server/.env" 2>/dev/null && echo "S3_BUCKET: SET (see Section G for detail)" || echo "S3_BUCKET: MISSING"
```

Do not run `ls`/`find` inside `uploads/` and do not print any filename or object key.

---

## I. Backup

```bash
# Repository-declared paths (server/src/services/backupService.ts)
BACKUP_DIR="/root/noramedi-backups"
BACKUP_SCRIPT="/usr/local/sbin/noramedi-db-backup.sh"
BACKUP_LOG="/var/log/noramedi-db-backup.log"
BACKUP_CRON="/etc/cron.d/noramedi-db-backup"

test -d "$BACKUP_DIR" && echo "backup dir EXISTS" || echo "backup dir MISSING"
test -x "$BACKUP_SCRIPT" && echo "backup script PRESENT and executable" || echo "backup script MISSING or not executable"
test -f "$BACKUP_CRON" && echo "backup cron unit PRESENT" || echo "backup cron unit MISSING"
test -f "$BACKUP_LOG" && echo "backup log PRESENT" || echo "backup log MISSING"

# Latest backup age + total size — filenames only (they contain no patient data,
# just a timestamped pattern: noramedi_crm-YYYYMMDD-HHMMSS.dump)
ls -lt "$BACKUP_DIR" 2>/dev/null | head -5
du -sh "$BACKUP_DIR" 2>/dev/null

# Narrow cron/systemd check — does not print unrelated cron content
grep -l "noramedi" /etc/cron.d/* 2>/dev/null
systemctl list-timers 2>/dev/null | grep -i noramedi

# PITR/WAL evidence — configuration presence only, no PostgreSQL state is altered
sudo -u postgres psql -c "SHOW archive_mode;" 2>/dev/null
sudo -u postgres psql -c "SHOW wal_level;" 2>/dev/null
```

Do not open, extract, or restore any backup file. Do not run the backup script.

---

## J. Nginx / TLS

```bash
nginx -t

# Active NoraMedi-related server blocks — review before sharing, redact any
# non-hostname sensitive value (e.g. internal upstream IPs) if present
grep -rl "noramedi" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
grep -A5 "server_name" /etc/nginx/sites-enabled/*noramedi* 2>/dev/null

# Certificate expiry — only against the hostname already confirmed reachable
# in Section E (api.noramedi.com). Do not guess or substitute another hostname.
echo | openssl s_client -connect api.noramedi.com:443 -servername api.noramedi.com 2>/dev/null | openssl x509 -noout -enddate
```

---

## K. Final evidence summary

Run this last; it re-prints the key lines from A–J so you can review everything in one place before pasting it back.

```bash
echo "=== F0-002 Stage B evidence summary — $(date -Is) ==="
echo "--- Host ---"
hostname; uptime
echo "--- Git ---"
cd /var/www/noramedi 2>/dev/null && git rev-parse HEAD && git status --short --branch
echo "--- PM2 ---"
pm2 list
echo "--- Health ---"
curl -s -o /dev/null -w "local: %{http_code}\n" --max-time 5 http://127.0.0.1:5000/api/health
echo "--- DB migration head ---"
sudo -u postgres psql -d noramedi_crm -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1;" 2>/dev/null
echo "--- Backup ---"
ls -lt /root/noramedi-backups 2>/dev/null | head -1
echo "=== end summary ==="
```

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, patient name, phone number, email address, clinical data, or private object path before pasting the results back into this conversation or into ChatGPT.

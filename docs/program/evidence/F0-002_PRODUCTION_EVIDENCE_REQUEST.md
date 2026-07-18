# F0-002 — Production Evidence Request (Stage B input)

**For the user to run, read-only, on the production VPS.** This is not run by the agent. Nothing in this file connects to production, restarts anything, migrates anything, or installs anything.

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, patient name, phone number, email address, clinical data, or private object path before pasting the results back into this conversation or into ChatGPT.

## How to use this file

1. SSH into the production VPS yourself (the agent does not have and must not be given production credentials).
2. Open **one interactive shell session** and run the sections in order (B through K reuse variables — `APP_DIR`, `DB_NAME`, `PUBLIC_HOST` — and the `check_var` function set up in earlier sections). Each section is copy-pasteable, but later sections depend on values confirmed earlier in the same session.
3. Where a section asks you to confirm a discovered name (app directory, database name, public hostname, PM2 process names), **do not** let the script guess — set the variable to the value you actually confirmed before continuing.
4. Paste the output of Section K (the compact summary) back into this conversation once you've reviewed it against the warning banner above.

### Naming caveat

The repository contains these **expected** names (found in `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, and `server/src/services/backupService.ts` — see `F0-002_REPOSITORY_BASELINE.md` §6.6–6.7 for exact citations):

- App path: `/var/www/noramedi`
- Database name: `noramedi_crm`
- PM2 API process: `noramedi-api`
- PM2 worker process: `noramedi-worker` — **this name does not actually appear anywhere in the repository.** It is an expectation stated in the task, not a repository-confirmed fact. Section D below explicitly checks whether any such process exists rather than assuming it does.

Treat all four as hypotheses to confirm, not facts. Sections B, F, and E/J below turn the app-path, database-name, and public-hostname hypotheses into explicitly confirmed `APP_DIR` / `DB_NAME` / `PUBLIC_HOST` values that later sections reuse — they never silently fall back to the repository guess.

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
# Confirm the actual app directory before assuming it. This candidate comes
# from the repository's deploy script, not from any production evidence yet.
CANDIDATE_APP_DIR="/var/www/noramedi"
if [ -d "$CANDIDATE_APP_DIR" ]; then
  echo "EXISTS: $CANDIDATE_APP_DIR"
  export APP_DIR="$CANDIDATE_APP_DIR"
else
  echo "MISSING: $CANDIDATE_APP_DIR"
  echo "STOP — do not guess. Find the real path yourself, then run:"
  echo '  export APP_DIR="<confirmed-actual-path>"'
  echo "before continuing to the rest of this section."
fi

# If APP_DIR was not set above, set it now with the confirmed real path,
# then re-run from this line down.
: "${APP_DIR:?APP_DIR not set — confirm the actual application directory above before continuing}"

cd "$APP_DIR" || exit 1

git rev-parse HEAD
BRANCH=$(git rev-parse --abbrev-ref HEAD)   # branch name, or "HEAD" if detached
echo "branch: $BRANCH"
git log -1 --format='%H %ci %s'

# Report only whether the origin remote is configured — never print its URL.
# A remote URL could embed a credential or token before the '@'.
if git remote get-url origin >/dev/null 2>&1; then
  echo "origin remote: CONFIGURED"
else
  echo "origin remote: MISSING"
fi

# Compare against the real remote main WITHOUT fetching or modifying local refs
git ls-remote origin refs/heads/main

# Working-tree cleanliness — metadata only, never individual file paths
DIRTY_COUNT=$(git status --porcelain=v1 | wc -l)
echo "working tree entries changed/untracked: $DIRTY_COUNT"
if [ "$DIRTY_COUNT" -eq 0 ]; then
  echo "working tree: CLEAN"
else
  echo "working tree: DIRTY"
fi
```

`APP_DIR` stays exported for the rest of this shell session — Sections E, G, H, I, and K below reuse it and will refuse to run if it isn't set.

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

## E. Application health and public hostname discovery

```bash
: "${APP_DIR:?Set APP_DIR in Section B first}"

# Repository healthcheck script availability
test -x /usr/local/sbin/noramedi-healthcheck.sh && echo "PRESENT and executable" || echo "MISSING or not executable"

# Nginx config syntax check (does not reload/restart nginx)
nginx -t

# Local health endpoint (repository-declared: server/src/index.ts, port default 5000)
curl -s -o /dev/null -w "local /api/health -> HTTP %{http_code}\n" --max-time 5 http://127.0.0.1:5000/api/health

# --- Public hostname discovery (hostnames only, no other config content) ---
grep -rhE '^\s*server_name\s' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
  | sed -E 's/^\s*server_name\s+//; s/;\s*$//' \
  | tr ' ' '\n' \
  | grep -vE '^(_|localhost)$' \
  | sort -u

# From the candidates printed above, set exactly ONE explicitly confirmed
# public hostname yourself. Do not pick this automatically; do not use a
# wildcard, "_", localhost, or a hostname that only appears inside a
# repository script (e.g. do not assume api.noramedi.com just because it
# appears in scripts/noramedi-healthcheck.sh).
PUBLIC_HOST=""   # <- fill in, e.g. PUBLIC_HOST="api.noramedi.com"
export PUBLIC_HOST

if [ -z "$PUBLIC_HOST" ]; then
  echo "PUBLIC_HOST not set — skipping public health check (and the TLS check in Section J)"
else
  curl -s -o /dev/null -w "public /api/health -> HTTP %{http_code}\n" --max-time 5 "https://$PUBLIC_HOST/api/health"
fi
```

A `200`, `204`, `401`, or `403` response is expected/healthy per the repository's own healthcheck logic (401/403 means the auth wall was reached, i.e. the API is up). `000`/`502`/`503`/`504` indicates a problem.

`PUBLIC_HOST` stays exported for Section J's TLS check below.

---

## F. Database and migrations

Metadata only — no clinical/business table is queried.

```bash
# Candidate database names only — no owners, privileges, or connection info
sudo -u postgres psql -X -A -t -c "SELECT datname FROM pg_database WHERE datname ILIKE '%noramedi%';"

# Set the confirmed actual database name from the candidates printed above.
DB_NAME=""   # <- fill in, e.g. DB_NAME="noramedi_crm"
export DB_NAME
: "${DB_NAME:?DB_NAME not set — confirm the actual database name above before continuing}"

sudo -u postgres psql -d "$DB_NAME" -c "SELECT version();"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

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

`DB_NAME` stays exported for Section K below.

---

## G. Configuration presence checks

**Print only SET / MISSING / EMPTY / DUPLICATE. Never print the value.**

```bash
: "${APP_DIR:?Set APP_DIR in Section B first}"
ENV_FILE="$APP_DIR/server/.env"

check_var() {
  local name="$1"
  if [ ! -f "$ENV_FILE" ]; then
    echo "$name: CANNOT_CHECK (env file not found at $ENV_FILE)"
    return
  fi
  local count
  count=$(grep -cE "^${name}=" "$ENV_FILE")
  if [ "$count" -eq 0 ]; then
    echo "$name: MISSING"
    return
  fi
  if [ "$count" -gt 1 ]; then
    echo "$name: DUPLICATE"
    return
  fi
  local line value
  line=$(grep -E "^${name}=" "$ENV_FILE")
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  if [ -z "$value" ]; then
    echo "$name: EMPTY"
  else
    echo "$name: SET"
  fi
}

for var in NODE_ENV DATABASE_URL JWT_SECRET PLATFORM_JWT_SECRET CSRF_SECRET ENCRYPTION_KEY REDIS_URL S3_BUCKET S3_REGION S3_ENDPOINT RUN_BACKGROUND_JOBS; do
  check_var "$var"
done
```

`NODE_ENV` and `RUN_BACKGROUND_JOBS` are non-secret mode flags — if you want, you may additionally report their literal values (e.g. `NODE_ENV=production`, `RUN_BACKGROUND_JOBS=false`) since they carry no sensitive information. All other variables above: SET/MISSING/EMPTY/DUPLICATE only, never the value — a variable defined more than once in the file reports `DUPLICATE` rather than reading either occurrence.

`check_var` stays defined for Section K below.

---

## H. Storage

```bash
: "${APP_DIR:?Set APP_DIR in Section B first}"

# Local upload directory presence and size (no filenames/content listed)
test -d "$APP_DIR/server/uploads" && echo "uploads dir EXISTS" || echo "uploads dir MISSING"
du -sh "$APP_DIR/server/uploads" 2>/dev/null || echo "cannot measure (missing or inaccessible)"

# S3 configuration presence only (reuses the SET/MISSING/DUPLICATE check from Section G)
check_var S3_BUCKET
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
export BACKUP_DIR

test -d "$BACKUP_DIR" && echo "backup dir EXISTS" || echo "backup dir MISSING"
test -x "$BACKUP_SCRIPT" && echo "backup script PRESENT and executable" || echo "backup script MISSING or not executable"
test -f "$BACKUP_CRON" && echo "backup cron unit PRESENT" || echo "backup cron unit MISSING"
test -f "$BACKUP_LOG" && echo "backup log PRESENT" || echo "backup log MISSING"

# Only files matching the repository-declared backup filename pattern
# (server/src/services/backupService.ts) count as database backups — do
# not treat unrelated files in the backup directory as backups.
BACKUP_PATTERN='noramedi_crm-????????-??????.dump'
export BACKUP_PATTERN

# Backup metadata only — count, latest age, latest size, total size.
# No filenames are printed anywhere in this section.
BACKUP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$BACKUP_PATTERN" 2>/dev/null | wc -l)
echo "matching backup file count: $BACKUP_COUNT"

if [ "$BACKUP_COUNT" -eq 0 ]; then
  echo "no files matching the backup pattern were found"
else
  LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$BACKUP_PATTERN" -printf '%T@ %s\n' 2>/dev/null | sort -n | tail -1)
  LATEST_EPOCH=$(echo "$LATEST" | cut -d' ' -f1 | cut -d'.' -f1)
  LATEST_SIZE_BYTES=$(echo "$LATEST" | cut -d' ' -f2)
  echo "latest matching backup age (seconds): $(( $(date +%s) - LATEST_EPOCH ))"
  echo "latest matching backup size (bytes): $LATEST_SIZE_BYTES"
fi

du -sh "$BACKUP_DIR" 2>/dev/null

# General backup cron/systemd presence — does not print unrelated cron content
grep -l "noramedi" /etc/cron.d/* 2>/dev/null
systemctl list-timers 2>/dev/null | grep -i noramedi

# PITR/WAL evidence — configuration presence only, no PostgreSQL state is altered
sudo -u postgres psql -c "SHOW archive_mode;" 2>/dev/null
sudo -u postgres psql -c "SHOW wal_level;" 2>/dev/null
```

Do not open, extract, or restore any backup file. Do not run the backup script. Do not list backup filenames.

### Restore-test evidence (explicit limitation)

The repository contains a `runRestoreTest()` function (see `F0-002_REPOSITORY_BASELINE.md` §6.7), but the repository does **not** persist any durable "last restore test" ledger or result record anywhere. The existence of this function in the codebase is **not proof** that a restore test has ever actually been run.

The check below can only confirm the narrow case of a *named*, automated cron/systemd job that references both "noramedi" and "restore" — it cannot detect a manual restore test, it does not read any log or job output, and its **absence does not prove** that a manual restore test never happened.

```bash
# Narrow restore-test job name check only — distinct from the general
# backup cron/timer check above. Does not read logs or job output.
systemctl list-timers 2>/dev/null | grep -Ei 'noramedi.*restore|restore.*noramedi'
grep -lEi 'noramedi.*restore|restore.*noramedi' /etc/cron.d/* 2>/dev/null
```

Do not read application logs or backup contents as part of restore-test evidence. Unless the user separately provides a dated operational record (a manual log entry, ticket, or runbook sign-off — outside of this repository and outside of what these commands can produce), `Last restore test` in the tracker baseline (§3) remains `UNVERIFIED` regardless of what the two commands above return.

`BACKUP_DIR` and `BACKUP_PATTERN` stay exported for Section K below.

---

## J. Nginx / TLS

```bash
nginx -t

# Active NoraMedi-related config file paths only — no directive content
grep -rl "noramedi" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null

# Certificate expiry — only against the PUBLIC_HOST you explicitly confirmed
# in Section E. Do not guess or substitute another hostname.
if [ -z "$PUBLIC_HOST" ]; then
  echo "PUBLIC_HOST not set — skipping TLS expiry check"
else
  echo | openssl s_client -connect "$PUBLIC_HOST:443" -servername "$PUBLIC_HOST" 2>/dev/null | openssl x509 -noout -enddate
fi
```

Do not output upstream IP addresses, `proxy_pass` targets, certificate private-key paths, authorization headers, or the full active Nginx configuration (no `grep -A` around `server_name` or any other directive).

---

## K. Final evidence summary

Run this last, in the **same shell session** as Sections B, E, F, G, and I (it reuses `APP_DIR`, `PUBLIC_HOST`, `DB_NAME`, `check_var`, and `BACKUP_DIR` from those sections). It re-prints the key lines from A–J so you can review everything in one place before pasting it back.

```bash
: "${APP_DIR:?APP_DIR not set — confirm in Section B first}"
: "${DB_NAME:?DB_NAME not set — confirm in Section F first}"

echo "=== F0-002 Stage B evidence summary — $(date -Is) ==="

echo "--- Host ---"
hostname; uptime; free -h | head -2; df -h "$APP_DIR" 2>/dev/null

echo "--- Git (metadata only) ---"
(
  cd "$APP_DIR"
  git rev-parse HEAD
  K_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "branch: $K_BRANCH"
  if git remote get-url origin >/dev/null 2>&1; then
    echo "origin remote: CONFIGURED"
  else
    echo "origin remote: MISSING"
  fi
  git ls-remote origin refs/heads/main
  K_DIRTY_COUNT=$(git status --porcelain=v1 | wc -l)
  echo "working tree entries changed/untracked: $K_DIRTY_COUNT"
  if [ "$K_DIRTY_COUNT" -eq 0 ]; then
    echo "working tree: CLEAN"
  else
    echo "working tree: DIRTY"
  fi
)

echo "--- Runtime versions ---"
node -v; npm -v; pm2 -v; nginx -v

echo "--- PM2 ---"
pm2 list

echo "--- Local health ---"
curl -s -o /dev/null -w "local: %{http_code}\n" --max-time 5 http://127.0.0.1:5000/api/health

if [ -n "$PUBLIC_HOST" ]; then
  echo "--- Public health ($PUBLIC_HOST) ---"
  curl -s -o /dev/null -w "public: %{http_code}\n" --max-time 5 "https://$PUBLIC_HOST/api/health"
else
  echo "--- Public health: PUBLIC_HOST not confirmed in Section E, skipped ---"
fi

echo "--- DB migration head ---"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1;" 2>/dev/null

echo "--- Incomplete migrations ---"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;" 2>/dev/null

echo "--- Config presence (SET/MISSING/EMPTY/DUPLICATE only) ---"
for var in NODE_ENV DATABASE_URL JWT_SECRET PLATFORM_JWT_SECRET CSRF_SECRET ENCRYPTION_KEY REDIS_URL S3_BUCKET S3_REGION S3_ENDPOINT RUN_BACKGROUND_JOBS; do
  check_var "$var"
done

echo "--- Storage mode ---"
test -d "$APP_DIR/server/uploads" && echo "local uploads dir EXISTS" || echo "local uploads dir MISSING"
check_var S3_BUCKET

echo "--- Backup metadata (no filenames) ---"
if [ -n "$BACKUP_DIR" ] && [ -n "$BACKUP_PATTERN" ]; then
  K_BACKUP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$BACKUP_PATTERN" 2>/dev/null | wc -l)
  echo "matching backup file count: $K_BACKUP_COUNT"
  if [ "$K_BACKUP_COUNT" -eq 0 ]; then
    echo "no files matching the backup pattern were found"
  else
    K_LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$BACKUP_PATTERN" -printf '%T@ %s\n' 2>/dev/null | sort -n | tail -1)
    K_LATEST_EPOCH=$(echo "$K_LATEST" | cut -d' ' -f1 | cut -d'.' -f1)
    K_LATEST_SIZE=$(echo "$K_LATEST" | cut -d' ' -f2)
    echo "latest matching backup age (seconds): $(( $(date +%s) - K_LATEST_EPOCH ))"
    echo "latest matching backup size (bytes): $K_LATEST_SIZE"
  fi
  du -sh "$BACKUP_DIR" 2>/dev/null
else
  echo "BACKUP_DIR/BACKUP_PATTERN not set (run Section I first)"
fi

echo "--- PITR/WAL ---"
sudo -u postgres psql -c "SHOW archive_mode;" 2>/dev/null
sudo -u postgres psql -c "SHOW wal_level;" 2>/dev/null

echo "--- Nginx ---"
nginx -t

if [ -n "$PUBLIC_HOST" ]; then
  echo "--- TLS expiry ($PUBLIC_HOST) ---"
  echo | openssl s_client -connect "$PUBLIC_HOST:443" -servername "$PUBLIC_HOST" 2>/dev/null | openssl x509 -noout -enddate
else
  echo "--- TLS expiry: PUBLIC_HOST not confirmed, skipped ---"
fi

echo "=== end summary ==="
```

It must not include: any Git remote URL, sanitized or otherwise (only `CONFIGURED`/`MISSING` status), individual changed/untracked file paths (only the dirty-entry count and CLEAN/DIRTY status), environment values, application logs, database rows outside `_prisma_migrations` and PostgreSQL metadata, backup filenames, upload filenames, object keys, or the full Nginx configuration.

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, patient name, phone number, email address, clinical data, or private object path before pasting the results back into this conversation or into ChatGPT.

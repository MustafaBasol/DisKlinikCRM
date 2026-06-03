# Docker Deployment Runbook

Production deployment guide for Aile Dis CRM using Docker Compose on a VPS.

## Architecture

```
disklinikcrm_api       — Express backend (Node.js + Prisma)
disklinikcrm_frontend  — Vite build served by Nginx
```

Both containers are managed with separate Compose files under `/docker/disklinikcrm/`.

## Required Environment Files

### Backend: `/docker/disklinikcrm/app/server/.env`

Copy from `server/.env.example` and fill in all values:

```env
DATABASE_URL="postgresql://crm_user:STRONG_PASSWORD@localhost:5432/dis_klinik_crm?schema=public"
JWT_SECRET="LONG_RANDOM_STRING"
PLATFORM_JWT_SECRET="LONG_RANDOM_STRING_DIFFERENT"
WHATSAPP_WEBHOOK_SECRET="LONG_RANDOM_STRING"
PORT=5000
ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false   # set true only if you still use env-var Evolution config
ENCRYPTION_KEY="64_HEX_CHARS"               # openssl rand -hex 32
# Meta Cloud API (optional — only needed if using Meta provider)
META_APP_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=v23.0
META_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=
# WhatsApp AI Conversation Agent (optional — enables natural language routing)
# Obtain an API key from https://aistudio.google.com/
GOOGLE_AI_STUDIO_API_KEY=          # or use GEMINI_API_KEY as alias
GEMINI_API_KEY=
GOOGLE_AI_MODEL=gemini-2.0-flash   # optional, defaults to gemini-2.0-flash
# Set to 0, false, off, or disabled to turn off the AI agent entirely.
# The rule-based fallback router remains active when the agent is disabled.
WHATSAPP_AI_AGENT_ENABLED=true
```

### Frontend: `/docker/disklinikcrm/app/.env`

```env
VITE_API_URL=https://api.yourdomain.com/api
VITE_APP_NAME=Aile Dis CRM
VITE_IDLE_TIMEOUT_MINUTES=30
VITE_EMAIL_VERIFICATION_REQUIRED=false
# Meta Embedded Signup (optional)
VITE_META_APP_ID=
VITE_META_EMBEDDED_SIGNUP_CONFIG_ID=
VITE_META_GRAPH_API_VERSION=v23.0
VITE_META_REDIRECT_URI=
```

## Safe Deploy Flow

```bash
# 1. Pull latest code
cd /docker/disklinikcrm/app
git status
git pull origin main

# 2. Rebuild and restart backend
cd /docker/disklinikcrm
docker compose -f docker-compose.backend.yml build disklinikcrm_api
docker compose -f docker-compose.backend.yml up -d disklinikcrm_api

# 3. Run migrations BEFORE serving traffic
docker exec -it disklinikcrm_api sh -c "cd /app && npx prisma migrate deploy"

# 4. Regenerate Prisma client (if schema changed)
docker exec -it disklinikcrm_api sh -c "cd /app && npx prisma generate"

# 5. Rebuild and restart frontend (only if frontend code or env changed)
docker compose -f docker-compose.frontend.yml build disklinikcrm_frontend
docker compose -f docker-compose.frontend.yml up -d disklinikcrm_frontend

# 6. Verify containers
docker ps --filter "name=disklinikcrm" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 7. Check logs
docker logs --tail=100 disklinikcrm_api
```

## When to Rebuild Backend

Rebuild `disklinikcrm_api` when any of the following change:
- `server/src/**` (any backend source file)
- `server/prisma/schema.prisma`
- `server/prisma/migrations/**`
- `server/package.json` (new dependencies)
- `server/.env` (env vars — requires restart, not rebuild)

## When to Rebuild Frontend

Rebuild `disklinikcrm_frontend` when any of the following change:
- `src/**` (any frontend source file)
- `index.html`, `vite.config.ts`, `tailwind.config.js`
- `.env` (Vite bakes env vars at build time — requires full rebuild)

## Migration Order

1. Always run `prisma migrate deploy` AFTER the new backend image is running.
2. Run `prisma generate` only if you see Prisma client mismatch errors.
3. Never run `prisma migrate dev` in production.
4. Never run `prisma db push` in production.

## Orphan Container Warning

If you see a warning about orphan containers, it means both Compose files share
a Docker network but have different project names. This is expected.
Do NOT use `--remove-orphans` unless you are certain what the orphan containers are.
To suppress the warning, ensure the `COMPOSE_PROJECT_NAME` variable is set consistently.

## First-Time Production Setup

```bash
# Create database
docker exec -it disklinikcrm_db psql -U postgres -c "CREATE DATABASE dis_klinik_crm;"
docker exec -it disklinikcrm_db psql -U postgres -c "CREATE USER crm_user WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD';"
docker exec -it disklinikcrm_db psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE dis_klinik_crm TO crm_user;"

# Apply baseline migration (first deploy only)
docker exec -it disklinikcrm_api sh -c "cd /app && npx prisma migrate deploy"

# Seed demo data (optional)
docker exec -it disklinikcrm_api sh -c "cd /app && npx tsx prisma/seed.ts"
```

## Security Checklist Before Going Live

- [ ] All `change-me` values replaced with strong random secrets
- [ ] `ENCRYPTION_KEY` set to a 64-hex-char random value
- [ ] Demo credentials removed from login screen hints
- [ ] Firewall restricts to SSH (22), HTTP (80), HTTPS (443) only
- [ ] PostgreSQL not exposed publicly (internal Docker network only)
- [ ] Automated PostgreSQL backups configured
- [ ] SSL certificate active (Let's Encrypt / Certbot)
- [ ] `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false` once all connections migrated to panel
- [ ] WhatsApp AI agent: `GOOGLE_AI_STUDIO_API_KEY` or `GEMINI_API_KEY` set if AI routing is enabled
- [ ] `WHATSAPP_AI_AGENT_ENABLED=true` confirmed; set to `false` to fall back to rule-based router without AI
- [ ] AI agent piloted on a single clinic account before enabling for all tenants

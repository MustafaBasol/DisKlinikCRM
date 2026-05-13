# Hostinger VPS PostgreSQL Deployment Plan

This document describes the production deployment path for Aile Dis CRM on a Hostinger VPS.

## Target Architecture

- Frontend: Vite build served by Nginx.
- Backend: Express API served by Node.js and kept alive with PM2.
- Database: PostgreSQL.
- Reverse proxy:
  - `https://crm.example.com` -> frontend `dist`
  - `https://api.example.com` -> backend `127.0.0.1:5000`
- SSL: Let's Encrypt / Certbot.

## Required VPS Packages

Install:

- Git
- Node.js LTS
- npm
- PostgreSQL
- Nginx
- PM2
- Certbot

## PostgreSQL Setup

Example database and user:

```sql
CREATE DATABASE dis_klinik_crm;
CREATE USER crm_user WITH ENCRYPTED PASSWORD 'strong-password-here';
GRANT ALL PRIVILEGES ON DATABASE dis_klinik_crm TO crm_user;
```

Backend environment file on VPS:

```env
DATABASE_URL="postgresql://crm_user:strong-password-here@localhost:5432/dis_klinik_crm?schema=public"
JWT_SECRET="replace-with-long-random-secret"
WHATSAPP_WEBHOOK_SECRET="replace-with-long-random-secret"
PORT=5000
```

Frontend environment file before build:

```env
VITE_API_URL=https://api.example.com/api
VITE_APP_NAME=Aile Dis CRM
VITE_IDLE_TIMEOUT_MINUTES=30
VITE_EMAIL_VERIFICATION_REQUIRED=false
```

## Important Migration Note

The project started on SQLite during MVP development. The existing migration files were created for SQLite.

For PostgreSQL production, use a fresh production database and create a new PostgreSQL baseline migration from the current Prisma schema before first production deploy.

Recommended first-production sequence:

```bash
cd server
npm install
npx prisma migrate dev --name init_postgres_baseline
npx prisma generate
npx tsx prisma/seed.ts
```

After production is live, use:

```bash
npx prisma migrate deploy
```

Do not copy `server/prisma/dev.db` to production.

## Backend Deploy

```bash
git clone https://github.com/MustafaBasol/DisKlinikCRM.git
cd DisKlinikCRM/server
npm install
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts
pm2 start npm --name aile-dis-crm-api -- start
pm2 save
```

The current `server/package.json` may need a production start script before this step:

```json
"start": "tsx src/index.ts"
```

## Frontend Deploy

```bash
cd DisKlinikCRM
npm install
npm run build
```

Serve `dist/` with Nginx.

## Nginx Sketch

Frontend:

```nginx
server {
  server_name crm.example.com;
  root /var/www/DisKlinikCRM/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }
}
```

Backend:

```nginx
server {
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Before Real Clinic Use

- Replace all demo passwords.
- Disable or remove demo credential hints on the login screen.
- Use long random values for `JWT_SECRET` and `WHATSAPP_WEBHOOK_SECRET`.
- Configure backups for PostgreSQL.
- Restrict server firewall ports to SSH, HTTP, and HTTPS.
- Connect n8n only after the API URL and WhatsApp secret are finalized.

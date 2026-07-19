# PRODUCTION_TOPOLOGY — Confirmed Production Architecture

Source task: F0-006 — Production Topology and Configuration Verification. Underlying evidence: [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) (primary production evidence record) and [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) (source-level tracing, drift table). This document is a **synthesized reference**, not a new evidence source — every claim below traces to one of those two files. See [evidence/README.md](evidence/README.md) for the evidence-classification legend.

This document describes **observed operational state as of the evidence timestamps below**. It is not a `PRODUCTION_VERIFIED` release-gate status (tracker §2.2) and does not certify ongoing correctness.

Evidence basis: F0-002 Stage B, evidence timestamp `2026-07-19T13:43:12+03:00`, reconciled against a second same-day task-supplied evidence snapshot (see F0-006 evidence §1) — both consistent, treated as one evidence session.

---

## 1. Topology diagram (textual)

```
Internet
   │
   │  HTTPS (443) — api.noramedi.com, app.noramedi.com, noramedi.com, www.noramedi.com
   │  Let's Encrypt cert (SAN covers all 4 hostnames, expires 2026-09-26)
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Host Nginx 1.24.0  (disklinik-prod-01, bare VPS — Ubuntu,     │
│                      kernel 6.8.0-124-generic)                │
│   - TLS termination                                            │
│   - Reverse proxy → API (loopback)                            │
│   - Static frontend serving (path/mechanism not confirmed —    │
│     no repository script deploys the frontend build; see       │
│     F0-006 evidence §3/§4)                                     │
└───────────────┬─────────────────────────────────────────────┘
                │ proxy (loopback, TRUST_PROXY=1 hop assumed)
                ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ PM2 process: noramedi-api      │   │ PM2 process: noramedi-worker   │
│ Entrypoint: server/src/index.ts│   │ Entrypoint: server/src/worker.ts│
│ Mode: fork · Owner: root        │   │ Mode: fork · Owner: root        │
│ Node 22.23.1                    │   │ Node 22.23.1 (shared host)      │
│ Listens 0.0.0.0:5000 (default)  │   │ No HTTP listener                │
│ GET /api/health (DB-backed)     │   │ No health endpoint (PM2-alive   │
│                                  │   │  status only)                   │
│ Registers background jobs       │   │ Registers same background jobs  │
│ UNLESS RUN_BACKGROUND_JOBS      │   │ UNCONDITIONALLY (does not read  │
│ === 'false' (value unread)      │   │  RUN_BACKGROUND_JOBS at all)    │
│                                  │   │                                  │
│ Deploy-managed: YES              │   │ Deploy-managed: NO — no repo    │
│ (scripts/noramedi-deploy.sh      │   │  script reloads/restarts this   │
│  step 5: pm2 reload)             │   │  process (see drift #3)         │
└───────────────┬────────────────┘   └───────────────┬────────────────┘
                │                                       │
                │ shared DATABASE_URL, DB_POOL_MAX=10   │
                │ each (2 procs × 10 = ≤20 conns)       │
                ▼                                       ▼
        ┌───────────────────────────────────────────────────┐
        │ PostgreSQL 16.14 — database noramedi_crm (16 MB)    │
        │ wal_level=replica, archive_mode=off (no PITR)       │
        │ JobLock table — DB-backed lease lock prevents        │
        │   duplicate execution of the same job tick even if  │
        │   both processes above have it registered            │
        └───────────────────────────────────────────────────┘
                │
                │ pg_dump-style .dump (external script, not in repo)
                ▼
        /root/noramedi-backups  (SAME HOST as the database — no
                                  confirmed offsite copy)
        7 files observed, retention 7 days (declared), cron-scheduled
        (no systemd timer), latest ~10.6h old at evidence time

        Local disk: /var/www/noramedi/server/uploads (~3.1 MB)
        — patient/lab file storage, NOT confirmed to be included
          in the database backup pipeline above

        Redis 7.0.15 (active, REDIS_URL set) — optional, fail-open
        shared store for rate-limit counters only; not a queue,
        not a session store, not a cache for application data
```

---

## 2. Component inventory

| Component | Runs where | Started/managed by | Repository-defined? | Evidence |
|---|---|---|---|---|
| Host Nginx | `disklinik-prod-01`, host-level (not containerized) | OS service (not PM2) | Partially — repository `nginx.conf` describes a *different*, container-internal config; the actual host config content is unconfirmed | F0-006 evidence §4 |
| `noramedi-api` | Same host, PM2 fork process, `root` | PM2, reloaded by `scripts/noramedi-deploy.sh` step 5 | Yes — entrypoint, health check, graceful shutdown all in repository | F0-002 §B.4, F0-006 §2 |
| `noramedi-worker` | Same host, PM2 fork process, `root` | PM2 — **initial registration and ongoing reload/restart mechanism not defined in this repository** | Entrypoint yes (`server/src/worker.ts`); deploy/reload automation no | F0-002 §B.4/§6.10 item 3, F0-006 §2/§3 |
| PostgreSQL | Same host | OS service | Not provisioned by any repository script (assumed pre-installed) | F0-002 §6.6 |
| Redis | Same host | OS service | Not provisioned by any repository script (assumed pre-installed); application usage is optional/fail-open | F0-002 §B.3, F0-006 §7 |
| Backup script | Same host, `/usr/local/sbin/noramedi-db-backup.sh` | cron (`/etc/cron.d/noramedi-db-backup`) | No — script content is not part of this repository; only the repository's *client* (`backupService.ts`) is | F0-002 §6.7, F0-006 §6/§9 |
| Local upload storage | Same host, `server/uploads/` | N/A (filesystem) | Yes — `fileStorage.ts` local-mode logic | F0-006 §8 |

**Single-host observation:** every component above runs on the same VPS (`disklinik-prod-01`). There is no confirmed second host, no confirmed load balancer beyond Nginx itself, and no confirmed off-host component anywhere in the current production topology.

---

## 3. Process lifecycle

| Question | Answer |
|---|---|
| API entrypoint | `npm run start` → `npx prisma generate && tsx src/index.ts` (`server/package.json`) |
| Worker entrypoint | `npm run start:worker` → `npx prisma generate && tsx src/worker.ts` |
| API restart/reload | `pm2 reload noramedi-api --update-env`, invoked only by `scripts/noramedi-deploy.sh` |
| Worker restart/reload | **Not defined anywhere in the repository.** Whatever mechanism updates/restarts it in production is external to this codebase. |
| Graceful shutdown | Both processes: `SIGTERM`/`SIGINT` → drain/disconnect Prisma + Redis → exit 0, forced exit after 10s. Independently implemented in each entrypoint (no shared shutdown module). |
| Health/readiness | `GET /api/health` (API only, DB-backed, 3s timeout race, unauthenticated). The worker has no HTTP surface and no health endpoint of its own — PM2's own "online" status is the only external signal for worker liveness. |
| Background jobs — where do they run? | By default (`RUN_BACKGROUND_JOBS` unset or not `'false'`), the API registers all 9 jobs itself. The worker **always** registers all 9 jobs, regardless of the flag. Whether the API is *also* currently registering them in production depends on the literal (unread) value of `RUN_BACKGROUND_JOBS`, which F0-002/F0-006 intentionally did not read (only confirmed `SET`). Actual duplicate **execution** of any tick is prevented by a Postgres-table-backed lease lock (`JobLock`) regardless of which case applies. |
| PM2 process definition source | None in-repository — no `ecosystem.config.*` file exists. Both processes' registration (name, working directory, restart policy) originates entirely outside this repository. |

---

## 4. Deployment flow (bare-VPS + PM2 + host Nginx — confirmed topology)

```
scripts/noramedi-deploy.sh:
  1. git pull --ff-only              (APP_DIR, default /var/www/noramedi)
  2. npm ci                          (server/, includes devDependencies)
  3. npx prisma migrate deploy
  4. npx prisma generate
  5. pm2 reload noramedi-api --update-env
  6. sleep 2
  7. noramedi-healthcheck.sh --local --max-attempts 12 --interval 5
```

- **Not covered by this script:** worker restart/reload, frontend build, frontend publish to Nginx's static root, rollback of any step.
- **Atomicity:** fail-fast (`set -euo pipefail`), not transactional. A failure between step 3 (migrate) and step 5 (reload) leaves the database migrated ahead of the currently-running code, with no automated rollback.
- **A second, unrelated topology is documented but does not exist as running infrastructure:** `docs/35-docker-deploy-runbook.md` describes a Docker Compose deployment (containers `disklinikcrm_api`/`disklinikcrm_frontend`, `/docker/disklinikcrm/` compose files, database name `dis_klinik_crm`, product name "Aile Dis CRM"). No `Dockerfile` or `docker-compose*` file exists anywhere in the repository. This document is confirmed stale/aspirational — see F0-006 evidence §3 and the drift table (row 2).

---

## 5. Network and routing

| Fact | Value |
|---|---|
| Confirmed public hostnames | `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com` |
| TLS termination | Host Nginx `1.24.0`; Let's Encrypt certificate, issuer `YE2`, SAN covers all four hostnames, expires `2026-09-26` |
| Local API bind | `0.0.0.0:5000` (repository default; `LISTEN_HOST`/`PORT` overridable — production's actual bind address was not independently re-read beyond the local healthcheck target `127.0.0.1:5000` in `scripts/noramedi-healthcheck.sh`) |
| Reverse-proxy trust | API trusts exactly 1 proxy hop by default (`TRUST_PROXY=1`) — correct for a single Nginx in front, consistent with the confirmed topology |
| Request body limit (app-level) | `1mb` default (`JSON_BODY_LIMIT`) |
| Request body limit (Nginx-level) | Not established — host Nginx configuration content was not requested, per task instruction |
| Security headers (app-level) | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` always; HSTS when `NODE_ENV=production` |
| Security headers (Nginx-level) | Not established |

---

## 6. Storage and backup summary

| Fact | Value |
|---|---|
| Application file storage mode | `LOCAL_VPS_STORAGE` — no S3-compatible object storage configured |
| Local storage path | `/var/www/noramedi/server/uploads` (~3.1 MB observed) |
| Database backup location | `/root/noramedi-backups` — same host as the database |
| Database backup schedule | cron (`/etc/cron.d/noramedi-db-backup`); no systemd timer found |
| Database backup retention | 7 days (declared in `backupService.ts`; enforcement mechanism external and unverified) |
| Offsite backup copy | Not found, not supplied — treated as absent |
| PITR | Not configured (`archive_mode=off`) |
| Restore-test evidence | `UNVERIFIED` — capability exists (admin-triggered `runRestoreTest()`), no durable evidence of it ever having been exercised |
| Uploads included in backup pipeline? | Not confirmed — repository evidence suggests the backup pipeline targets the database only, not `uploads/` |

---

## 7. What remains unverified

See [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §13 for the complete list. Highlights:

- Literal value of `RUN_BACKGROUND_JOBS` (presence only confirmed)
- Actual PM2 `cwd` for either process
- Host Nginx configuration content (body limits, timeouts, headers, upstream directives)
- PgBouncer / read-replica presence
- Frontend build-artifact-to-source match
- Backup encryption-at-rest, offsite copy
- `server/uploads/` inclusion in the backup pipeline
- Last restore test (remains `UNVERIFIED`, not "never happened")

---

## 8. Related documents

- [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md) — full configuration variable inventory
- [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) — full evidence, drift table
- [evidence/F0-006_configuration_inventory.json](evidence/F0-006_configuration_inventory.json) — structured machine-readable inventory
- [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) — primary production evidence record
- [RISK_REGISTER.md](RISK_REGISTER.md) — formalized risks from this task (R-029…R-040)

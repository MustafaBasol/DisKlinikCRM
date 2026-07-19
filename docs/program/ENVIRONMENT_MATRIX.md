# ENVIRONMENT_MATRIX — Configuration Variable Inventory

Source task: F0-006 — Production Topology and Configuration Verification. Evidence basis: [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §5 (Configuration model), reconciled with [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.8. No secret values, connection strings, or other variable content appear anywhere in this document — presence/requirement status only, per task instruction.

Env loading mechanism: `dotenv.config()` (no explicit path), called independently in `server/src/index.ts`, `server/src/worker.ts`, and `server/src/db.ts` (via `import 'dotenv/config'`). Resolves relative to `process.cwd()` — conventionally `server/` (matching `server/.env`), never independently confirmed as the actual PM2 process working directory in production.

Legend: **Required** = process fails to start or a documented fatal path triggers if missing/invalid. **Optional (default)** = has a coded fallback. **Optional (feature-gate)** = absence simply disables a feature/mode. **Production status** = presence only, from F0-002 Stage B §B.8 (values never read).

---

## 1. Core / required

| Variable | Required by | Default | Production status | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | API + worker (Prisma adapter) | None — non-null assertion, throws at client construction if unset | `SET` | Single connection string used for all reads/writes; no read/write split |
| `NODE_ENV` | API (HSTS header, ENCRYPTION_KEY fatal-check gating) | None | `SET` | Value not read (only presence); `production` is assumed based on other evidence (HSTS observed via TLS/health checks is consistent but not directly confirmed as a header value) |
| `JWT_SECRET` | API (clinic-user auth) | None | `SET` | |
| `PLATFORM_JWT_SECRET` | API (platform-admin auth) | None | `SET` | Separate secret from `JWT_SECRET` by design |
| `CSRF_SECRET` | API (CSRF middleware) | None | `SET` | |
| `ENCRYPTION_KEY` | API (WhatsApp/SMS credential + webhook secret encryption at rest) | None — **fatal** (`process.exit(1)`) if unset/invalid AND `NODE_ENV=production`; warns only otherwise | `SET` | `server/src/index.ts:75-89` |

## 2. Optional — coded defaults

| Variable | Default | Purpose | Production status |
|---|---|---|---|
| `PORT` | `5000` | API HTTP bind port | Not independently re-read; consistent with `scripts/noramedi-healthcheck.sh`'s hardcoded `127.0.0.1:5000` local probe target |
| `LISTEN_HOST` | `0.0.0.0` | API HTTP bind address | Not checked |
| `JSON_BODY_LIMIT` | `1mb` | Express JSON body size limit | Not checked |
| `TRUST_PROXY` | `1` | Reverse-proxy hop count for `X-Forwarded-For` trust | Not checked; `1` is correct for the confirmed single-Nginx topology |
| `DB_POOL_MAX` | `10` | Prisma/`pg` pool size, per process | Not checked; with 2 processes (API + worker) at default, up to 20 total connections from this app |
| `DB_POOL_CONNECT_TIMEOUT_MS` | `10000` | Pool connection-acquire timeout | Not checked |
| `DB_POOL_IDLE_TIMEOUT_MS` | `30000` | Pool idle-connection timeout | Not checked |
| `RUN_BACKGROUND_JOBS` | unset = jobs run in-process (API) | Controls whether the API also registers background jobs (worker always does, regardless) | `SET` — **literal value not read**; see PRODUCTION_TOPOLOGY.md §3 for the duplicate-registration implication |
| `CORS_ORIGIN` / `CORS_ORIGINS` | empty (dev-permissive; production-blocking if empty and `NODE_ENV=production`) | Allowed cross-origin list for the session-cookie API | Not checked. **`server/.env.example` defines `CORS_ORIGINS` twice** (dev example line 17, prod example line 21) — only the last assignment would take effect in a real `.env`; not confirmed whether production's actual file has this duplication |

## 3. Optional — feature-gated (Redis)

| Variable | Effect if unset | Production status |
|---|---|---|
| `REDIS_URL` | Rate-limit counters fall back to an in-process `Map` (fail-open by design) | `SET` — Redis `7.0.15` service confirmed active |

## 4. Optional — feature-gated (S3-compatible object storage)

| Variable | Effect if unset | Production status |
|---|---|---|
| `S3_BUCKET` | Storage stays in local-disk mode (`isRemoteStorageEnabled()` returns `false`) | `MISSING` |
| `S3_REGION` | Defaults to `"auto"` when S3 mode is enabled | `MISSING` |
| `S3_ENDPOINT` | AWS default endpoint used when S3 mode is enabled and this is unset | `MISSING` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Falls back to AWS SDK default credential chain (e.g. IAM role) when S3 mode is enabled | Not checked (moot — S3 mode is off) |
| `S3_FORCE_PATH_STYLE` | Virtual-hosted-style addressing used when unset | Not checked (moot) |

All three primary S3 keys (`S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`) are `MISSING` together — the expected signature of intentional local-storage mode, not a partial/broken S3 configuration (F0-002 §B.8).

## 5. Frontend (build-time only — Vite)

Vite bakes `VITE_*` variables into the static bundle at `vite build` time; they are not read at runtime by the served files. No repository script performs this build/deploy for the bare-VPS topology (see PRODUCTION_TOPOLOGY.md §4), so which values (if any) were baked into the currently-served frontend bundle is **unverified**. The stale Docker runbook (`docs/35-docker-deploy-runbook.md`) documents `VITE_API_URL`, `VITE_APP_NAME`, `VITE_IDLE_TIMEOUT_MINUTES`, `VITE_EMAIL_VERIFICATION_REQUIRED`, and Meta-embedded-signup `VITE_META_*` variables for its own (non-running) Docker path — these are cited for completeness only, not as confirmed production values.

## 6. Not covered by `server/.env.example` at all

Confirmed by direct inspection of `server/.env.example` for this task: `REDIS_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `RUN_BACKGROUND_JOBS`, `DB_POOL_MAX`, `DB_POOL_CONNECT_TIMEOUT_MS`, `DB_POOL_IDLE_TIMEOUT_MS` are all read by application code but **do not appear in the example file** — an operator following only the example would not discover these options.

## 7. Template-level risk (not a confirmed production defect)

`server/.env.example` line 100 sets `SESSION_COOKIE_SECURE=false` as the active (uncommented) default; the production override (`SESSION_COOKIE_SECURE=true`) is present only as a **commented-out** line 102. If an operator copies the example to `.env` without uncommenting the production block, session cookies would be issued without the `Secure` flag. Production's actual `.env` content was not read — this is a template-quality risk, not a confirmed misconfiguration.

## 8. Duplicated/inconsistent naming across documentation (not application config)

Historical documentation uses three different PM2 process-name/product-name schemes across the repository's history (`aile-dis-crm-api`, `disklinikcrm_api`, `noramedi-api`) — see F0-002 §6.10 item 2. Only `noramedi-api`/`noramedi-worker` are confirmed to run in production.

---

## 9. Summary counts

| Category | Count |
|---|---|
| Required (fatal/near-fatal if missing) | 6 |
| Optional with coded default | 8 |
| Optional, Redis feature-gate | 1 |
| Optional, S3 feature-gate | 5 |
| Confirmed `SET` in production (of the 8 checked) | 8 |
| Confirmed `MISSING` in production (of the 3 checked) | 3 (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`) |
| Variables read by app code but absent from `.env.example` | 8 |

See [evidence/F0-006_configuration_inventory.json](evidence/F0-006_configuration_inventory.json) for the same inventory in structured form.

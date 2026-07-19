# F0-002 — Production Baseline Evidence (Stage B: Production/VPS Evidence)

Task: F0-002 — Repository and Deployment Baseline Inventory
Phase: F0 — Baseline, Program Control, and Architecture Validation
Stage: **B — Production/VPS evidence.** Collected by the user, read-only, per [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md). Stage A (repository evidence) is [F0-002_REPOSITORY_BASELINE.md](F0-002_REPOSITORY_BASELINE.md).

Evidence timestamp: `2026-07-19T13:43:12+03:00` and subsequent same-session checks (all commands in this document's evidence run were executed within one interactive shell session on the same host on the same day).

This is a **sanitized evidence summary**, not a raw terminal transcript. No secret, credential, connection string, environment variable value, backup filename, upload filename, object key, IP address, or patient/clinical/business data is recorded here — see [README.md](README.md) for the evidence-classification legend, extended with `VERIFIED_PRODUCTION_OBSERVED` (below).

This document records **observed operational state**. It does not constitute, and must not be read as, a `PRODUCTION_VERIFIED` release-gate status per [NORAMEDI_MASTER_TRACKER.md §2.2](../NORAMEDI_MASTER_TRACKER.md). No production change was made; every command run against production was read-only.

---

## B.1 Host

| Fact | Value | Classification |
|---|---|---|
| Hostname | `disklinik-prod-01` | `VERIFIED_PRODUCTION_OBSERVED` |
| Kernel | Linux `6.8.0-124-generic`, Ubuntu | `VERIFIED_PRODUCTION_OBSERVED` |
| Root filesystem | 76G total, 7.6G used, 65G available, 11% used | `VERIFIED_PRODUCTION_OBSERVED` |
| RAM | 7.8 GiB total, ~6.4 GiB available | `VERIFIED_PRODUCTION_OBSERVED` |
| Swap | 2.0 GiB, unused | `VERIFIED_PRODUCTION_OBSERVED` |
| Uptime | ~19 days 23 hours | `VERIFIED_PRODUCTION_OBSERVED` |
| Load average | 0.00, 0.01, 0.06 (1/5/15 min) | `VERIFIED_PRODUCTION_OBSERVED` |

No capacity concern is indicated by disk/RAM/load at evidence time.

---

## B.2 Application Git state

| Fact | Value | Classification |
|---|---|---|
| Confirmed app path | `/var/www/noramedi` — matches the repository-declared default (`scripts/noramedi-deploy.sh:26`, see Stage A §6.6) | `VERIFIED_PRODUCTION_OBSERVED` |
| Production `HEAD` | `7fcf2f850f151241266f07349c4bf4442c72bbca` | `VERIFIED_PRODUCTION_OBSERVED` |
| Production branch | `main` | `VERIFIED_PRODUCTION_OBSERVED` |
| Production working tree | `CLEAN` | `VERIFIED_PRODUCTION_OBSERVED` |
| Origin remote | `CONFIGURED` (URL not printed, per the evidence-request's own redaction rule) | `VERIFIED_PRODUCTION_OBSERVED` |
| `origin/main` at evidence time (remote ref, read-only) | `d9fc40883afc8791098865d4d185de3336774c7a` | `VERIFIED_PRODUCTION_OBSERVED` |
| Production vs. remote `main` difference | Production `7fcf2f8` is an ancestor of remote `main` `d9fc408`; the only commit(s) between them are [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) (`docs(test): add F0-005 test inventory and runtime baseline`) — **documentation-only**, no source/schema/migration/package/CI change. This is **not** classified as runtime deployment drift. | `VERIFIED_PRODUCTION_OBSERVED` — cross-referenced against `git log` on `main` (see [F0-005 evidence](F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md) / repository history) |

This resolves Stage A's `Application revision` / `Production revision` rows (§6.9) from `UNVERIFIED_PRODUCTION` to `VERIFIED_PRODUCTION_OBSERVED`: the deployed commit is a known, identified point on `main`'s history, one documentation-only PR behind the current tip.

---

## B.3 Runtime versions

| Component | Observed version | Repository-declared (Stage A) | Classification |
|---|---|---|---|
| Node.js | `22.23.1` | CI-declared `20` (`.github/workflows/windows-bridge-pr.yml`); no `engines` pin at root/server (Stage A §6.3) | `VERIFIED_PRODUCTION_OBSERVED` — **mismatch noted**: production runs a materially newer major (22) than the only CI job's declared Node (20); with no `engines` field, nothing in the repository enforces or even documents this. See §B.9 below. |
| npm | `10.9.8` | Not declared | `VERIFIED_PRODUCTION_OBSERVED` |
| PM2 | `7.0.1` | Not declared (deploy script assumes PM2 pre-installed, Stage A §6.6) | `VERIFIED_PRODUCTION_OBSERVED` |
| PostgreSQL | `16.14` | Provider only (`postgresql`, via `@prisma/adapter-pg`), no version pinned | `VERIFIED_PRODUCTION_OBSERVED` |
| Redis CLI | `7.0.15`, service **active** | Optional capability (`ioredis`, fail-open if absent) | `VERIFIED_PRODUCTION_OBSERVED` |
| Nginx | `1.24.0` | Repository `nginx.conf` is container-internal only (Stage A §6.6/§6.10) | `VERIFIED_PRODUCTION_OBSERVED` |

---

## B.4 PM2 topology

| Process | Status | Mode | Uptime at evidence time | Restarts | Unstable restarts | Classification |
|---|---|---|---|---|---|---|
| `noramedi-api` | online | fork | ~38 minutes | 14 | 0 | `VERIFIED_PRODUCTION_OBSERVED` |
| `noramedi-worker` | online | fork | ~39 minutes | 13 | 0 | `VERIFIED_PRODUCTION_OBSERVED` |

Notes (kept strictly to what was observed):

- Restart counts (14 / 13) are recorded as **observed metadata only**. Zero *unstable* restarts were reported at evidence time. This document does **not** claim crash instability — that would require log evidence not collected in this task. It is flagged as a **medium** operational-review item (see §B.11 Risks) because the counts are non-trivial for processes with only ~38–39 minutes of observed uptime, but the cause (deploy-triggered reloads vs. crash loop vs. manual restarts) is not established by this evidence and must not be guessed.
- PID values were visible in the raw `pm2 list` output but are explicitly **not** recorded here — they are not durable architecture facts (a PID is meaningless after any restart).
- This confirms, for the first time with production evidence, that **`noramedi-worker` exists and runs as a separate PM2 process** in production — resolving Stage A's `UNVERIFIED_PRODUCTION` classification for the worker process name (Stage A §6.6/§6.9), which could only establish that the name does not appear anywhere in the repository. See §B.9 below for the remaining gap this surfaces (no repository-defined deploy automation manages this process).

---

## B.5 Health

| Check | Result | Classification |
|---|---|---|
| Local `http://127.0.0.1:5000/api/health` | HTTP `200` | `VERIFIED_PRODUCTION_OBSERVED` |
| Public `https://api.noramedi.com/api/health` | HTTP `200` | `VERIFIED_PRODUCTION_OBSERVED` |
| Repository healthcheck script (`/usr/local/sbin/noramedi-healthcheck.sh`) | Present and executable | `VERIFIED_PRODUCTION_OBSERVED` |
| `nginx -t` | Successful | `VERIFIED_PRODUCTION_OBSERVED` |

Both the local (DB-backed `SELECT 1`, per Stage A §6.6) and public health endpoints returned a healthy response at evidence time. This is point-in-time health evidence, not a durable uptime/SLO claim, and is not equivalent to a `PRODUCTION_VERIFIED` release-gate status.

---

## B.6 Public hostnames and TLS

| Fact | Value | Classification |
|---|---|---|
| Confirmed `server_name` entries | `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com` | `VERIFIED_PRODUCTION_OBSERVED` |
| Certificate subject CN | `app.noramedi.com` | `VERIFIED_PRODUCTION_OBSERVED` |
| Certificate SAN | `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com` | `VERIFIED_PRODUCTION_OBSERVED` |
| Issuer | Let's Encrypt `YE2` | `VERIFIED_PRODUCTION_OBSERVED` |
| Expiry | `2026-09-26 19:47:44 GMT` | `VERIFIED_PRODUCTION_OBSERVED` |
| TLS hostname coverage | **VERIFIED** — the SAN list covers all four confirmed public server names | `VERIFIED_PRODUCTION_OBSERVED` |

This also resolves the Stage A `CONFLICTING_EVIDENCE` classification on deployment topology (Stage A §6.9/§6.10, contradiction #1): production terminates TLS via a host Nginx with a single certificate covering all four hostnames on a bare-VPS topology, consistent with `scripts/noramedi-deploy.sh` and **not** with the Docker Compose topology described in `docs/35-docker-deploy-runbook.md`. The Docker runbook is confirmed stale/aspirational, not the running architecture.

---

## B.7 Database and migrations

| Fact | Value | Classification |
|---|---|---|
| Database name | `noramedi_crm` — matches the repository-declared name (Stage A §6.7, `backupService.ts`) | `VERIFIED_PRODUCTION_OBSERVED` |
| PostgreSQL version | `16.14` (same as §B.3) | `VERIFIED_PRODUCTION_OBSERVED` |
| Database size | 16 MB | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest applied migration | `20260718164142_add_communication_preference_and_consent` | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest migration started | `2026-07-19 13:03:57+03` | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest migration finished | `2026-07-19 13:03:58+03` | `VERIFIED_PRODUCTION_OBSERVED` |
| Incomplete migrations (`finished_at IS NULL`) | `0` | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest 10 migrations | All had `finished_at` populated; no `rolled_back_at` values present | `VERIFIED_PRODUCTION_OBSERVED` |

`20260718164142_add_communication_preference_and_consent` is also the current repository migration head on `main` (confirmed by directory listing at the merge commit used for this delivery — see §6.5 cross-reference in the repository baseline doc), and matches production `HEAD` `7fcf2f8` (the PR #169 commit, see gitStatus). **Production migration state is consistent with the deployed commit; zero incomplete migrations.** No clinical/business table was queried — only `_prisma_migrations` metadata.

---

## B.8 Configuration presence

**Presence only — no value, secret, or connection string was recorded.**

| Status | Variables |
|---|---|
| SET | `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`, `RUN_BACKGROUND_JOBS` |
| MISSING | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` |

Classification: `VERIFIED_PRODUCTION_OBSERVED` (presence/absence only).

All critical auth/crypto/DB/Redis configuration keys are present. The three S3 keys are missing together and consistently, which is the expected signature of local-storage mode (see §B.9 Storage) rather than a partial/broken S3 configuration.

---

## B.9 Storage

| Fact | Value | Classification |
|---|---|---|
| Local upload directory | `/var/www/noramedi/server/uploads` — **exists** | `VERIFIED_PRODUCTION_OBSERVED` |
| Approximate size | 3.1 MB | `VERIFIED_PRODUCTION_OBSERVED` |
| S3-compatible object storage | **Not configured** (`S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` all `MISSING`, §B.8) | `VERIFIED_PRODUCTION_OBSERVED` |
| Storage mode classification | **`LOCAL_VPS_STORAGE`** | `VERIFIED_PRODUCTION_OBSERVED` |

This is an **observed state, not an endorsement**. Storage mode design/migration is out of scope for F0-002 (belongs to F0-011, Object Storage and Backup Migration Design) — see §B.11 Risks for the associated risk entry.

### Node/deploy-automation gaps surfaced by Stage B (new §6.10 contradictions)

Two Stage A findings are now sharpened with production evidence rather than resolved away:

1. **Node version drift.** Stage A found no `engines` pin anywhere in the root/server `package.json` and only a CI-inferred Node `20` (from the one imaging-scoped workflow). Production actually runs Node `22.23.1` — two major versions ahead of the only CI evidence, with nothing in the repository enforcing, documenting, or testing against the actual production Node version. This is a **latent risk**, not a currently observed failure (health checks pass).
2. **Worker deploy automation gap.** Stage A found that `scripts/noramedi-deploy.sh` reloads only the `noramedi-api` PM2 process and contains no mechanism to restart/reload a worker process. Stage B now confirms `noramedi-worker` **does** run as a separate PM2 process in production (§B.4) — meaning its current deployment/restart lifecycle is not reproducible from anything in this repository. How it gets updated/restarted on deploy is unknown from repository or the collected evidence and must not be assumed.

---

## B.10 Backup, PITR, and restore testing

| Fact | Value | Classification |
|---|---|---|
| Backup directory (`/root/noramedi-backups`) | Exists | `VERIFIED_PRODUCTION_OBSERVED` |
| Backup script (`/usr/local/sbin/noramedi-db-backup.sh`) | Present and executable | `VERIFIED_PRODUCTION_OBSERVED` |
| Backup cron unit (`/etc/cron.d/noramedi-db-backup`) | Present | `VERIFIED_PRODUCTION_OBSERVED` |
| Backup log (`/var/log/noramedi-db-backup.log`) | Present | `VERIFIED_PRODUCTION_OBSERVED` |
| Matching database backups | 7 | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest backup age at evidence time | 38,160 seconds (~10.6 hours) | `VERIFIED_PRODUCTION_OBSERVED` |
| Latest backup size | 434,585 bytes | `VERIFIED_PRODUCTION_OBSERVED` |
| Backup directory total size | ~2.7 MB | `VERIFIED_PRODUCTION_OBSERVED` |
| Scheduler | Cron (`/etc/cron.d/noramedi-db-backup`) — **no matching systemd timer found** | `VERIFIED_PRODUCTION_OBSERVED` |
| Backup filenames | Not recorded (per evidence-request redaction rule) | — |
| `wal_level` | `replica` | `VERIFIED_PRODUCTION_OBSERVED` |
| `archive_mode` | `off` | `VERIFIED_PRODUCTION_OBSERVED` |
| PITR classification | **`NOT_CONFIGURED` / `NOT_AVAILABLE`** | `VERIFIED_PRODUCTION_OBSERVED` |
| Restore-test evidence | No matching restore-test systemd timer; no matching restore-test cron; no durable manual restore-test evidence was supplied | `VERIFIED_PRODUCTION_OBSERVED` (absence of the narrow automated signal only) |
| Last restore test | **`UNVERIFIED`** | `UNVERIFIED_PRODUCTION` |

Backup automation exists and produced a recent (< 11 hours old), non-trivially-sized backup file, on a cron schedule (no systemd timer). This is a functioning backup pipeline as far as this evidence goes — it does **not** establish offsite durability (the backup directory is local to the same host as the database it backs up, per §B.10 and repository evidence in Stage A §6.7) and it does **not** establish that a restore has ever been successfully exercised. `wal_level: replica` is a WAL *format* setting only — per the task's explicit instruction, this alone is **not** evidence that a physical or logical replica actually exists, and no such claim is made here. Backup filenames were intentionally not recorded, per the production evidence request's redaction rules.

---

## B.11 Accepted findings and risks

### Accepted observed findings

1. Production API and worker run as separate PM2 processes (`noramedi-api`, `noramedi-worker`), both `online`, `fork` mode, 0 unstable restarts at evidence time.
2. Public and local health checks both return HTTP `200`.
3. Production migration state is clean — latest migration `20260718164142_add_communication_preference_and_consent` finished successfully, 0 incomplete migrations, matches the deployed commit and the current repository migration head.
4. All eight critical configuration keys (`NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`, `RUN_BACKGROUND_JOBS`) are present; no values were read or recorded.
5. Backup automation (script, cron, log, directory) exists and has produced 7 matching backup files, the latest ~10.6 hours old at evidence time.
6. Current storage is local VPS storage (`/var/www/noramedi/server/uploads`, ~3.1 MB); no S3-compatible object storage is configured.
7. PITR is not configured (`archive_mode: off`).
8. Restore-test evidence is unavailable via the narrow automated-job check; this does **not** mean a restore test has never occurred, only that no durable record was found or supplied.
9. Offsite backup evidence is unavailable — the backup directory is local to the same VPS as the database.
10. Production PM2 process ownership was observed (processes run as `root`); privilege hardening itself is out of scope for this task.

### Risks (identified, not remediated in F0-002)

| Severity | Risk | Basis |
|---|---|---|
| HIGH | Local patient/imaging storage on the same VPS as the database | §B.9 — `LOCAL_VPS_STORAGE`, no S3-compatible mode configured |
| HIGH | Backup directory appears local to the same VPS; offsite durability unverified | §B.10 — `/root/noramedi-backups` on the same host |
| HIGH | `archive_mode: off`, no PITR | §B.10 |
| HIGH | Restore test unverified | §B.10 — `Last restore test = UNVERIFIED` |
| MEDIUM | PM2 restart counts (14 `noramedi-api` / 13 `noramedi-worker`) require later operational review — no failure claim is made from this evidence alone | §B.4 |
| MEDIUM | PM2 processes run as `root`; privilege hardening not assessed by this task | §B.11 finding 10 |

None of these risks are remediated by F0-002 — this is an inventory task. They are carried forward as open items for later phases (F0-006 Production Topology and Configuration Verification for process/privilege review; F0-011 Object Storage and Backup Migration Design for storage/backup/PITR; a dedicated restore-test exercise for the restore-test gap).

---

## B.12 Reconciliation with Stage A repository evidence

Stage A (`F0-002_REPOSITORY_BASELINE.md` §6.9) recorded 20 rows as `UNVERIFIED_PRODUCTION`. This document resolves the following to `VERIFIED_PRODUCTION_OBSERVED`:

- Application revision / Production revision (§B.2)
- Backend runtime, Worker runtime existence (§B.3, §B.4 — Node version now known; the *worker PM2 process itself* now confirmed to exist, though its deploy automation gap remains, see §B.9)
- Database provider version (§B.7)
- Production migration head (§B.7)
- Process manager, API process, Worker process existence (§B.4)
- Redis (service active, §B.3; `REDIS_URL` set, §B.8)
- Storage mode, Storage location (§B.9)
- Backup type (existence and freshness, §B.10)
- Nginx/TLS (§B.6 — also resolves the Docker-vs-bare-VPS `CONFLICTING_EVIDENCE` row)
- Health endpoint (§B.5)
- Docker/Compose (§B.6 — confirmed bare-VPS + PM2 + host Nginx is what actually runs; Docker Compose runbook confirmed stale)

The following remain `UNVERIFIED_PRODUCTION` / explicitly `UNVERIFIED` after Stage B, by design — no evidence was collected or supplied that could resolve them, and none is fabricated:

- Offsite backup (no evidence of an offsite copy)
- PITR (confirmed **not configured**, which is itself a resolved fact — but the *capability* remains absent, not "pending")
- Last restore test (`UNVERIFIED` per explicit instruction; absence of automated-job evidence is not proof a manual test never happened)
- Frontend build-artifact-matches-source confirmation (not checked — no build/deploy dry-run was part of Stage B's read-only scope)
- PgBouncer / read replica existence (no check was part of the Stage B command set; `wal_level: replica` is explicitly not treated as replica evidence)
- Error tracking / metrics-tracing (repository-fact rows, unaffected by production access)

See [F0-002_REPOSITORY_BASELINE.md](F0-002_REPOSITORY_BASELINE.md) §6.9 for the updated evidence matrix incorporating both stages.

---

## Files touched by this Stage B delivery

Only files under `docs/program/` were created or modified. No application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, nginx file, environment file, or runtime configuration was modified. No production system was changed — every command executed against production (by the user, outside this task's tool access) was read-only, per [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md).

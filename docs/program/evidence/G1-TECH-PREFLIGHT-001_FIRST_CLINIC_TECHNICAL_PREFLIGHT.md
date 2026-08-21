# G1-TECH-PREFLIGHT-001 — First Clinic Technical Go-Live Preflight and Bootstrap Proof

**Task ID:** G1-TECH-PREFLIGHT-001
**Phase / gate:** Launch Gate G1 — Controlled Pilot readiness. Run in parallel with the externally-pending F4 Workload-B legal/counsel gate, which this document does **not** touch, close, weaken, or reinterpret.
**Repository baseline:** `origin/main` @ `ef90dfbb5f611a07698f9a9b6d3f263ed6b6c2fa` (merge of [PR #472](https://github.com/MustafaBasol/DisKlinikCRM/pull/472), `docs(f4-2-r2)` — F4-2-R2 merge confirmed present), established by `git fetch origin --prune` + `git checkout main` + `git pull --ff-only` + `git rev-parse HEAD`, working tree clean at task start.
**Production evidence timestamp:** `2026-08-21T16:05:14+03:00` … `2026-08-21T16:07:00+03:00`, host `disklinik-prod-01`, all reads read-only.

## 0. Non-authorization statement

This document records evidence and one additive runtime change. It does **not** approve G1, does not evaluate G1 on the decision owner's behalf, and does not create a real clinic, a real owner, or any real patient record. `G1_APPROVAL_STATUS` remains `NOT_APPROVED`. No legal, KVKK, VERBİS, or DPA determination is made or implied anywhere below; every such item is routed to qualified counsel per [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.H.

The state distinctions in [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §0 are preserved throughout: *agent completed* ≠ *tests passed* ≠ *PR opened* ≠ *merged* ≠ *deployed* ≠ *production verified* ≠ *legally approved* ≠ *G1 approved*. In particular, the runtime change in §4 is **implemented and tested, PR opened, NOT merged, NOT deployed, NOT production-verified.**

## 1. Production health preflight (read-only, fresh)

| Item | Observed value | Method |
|---|---|---|
| Host | `disklinik-prod-01`, up 2 days 5:10, load 0.12 | `hostname`, `uptime` |
| Time | `2026-08-21T16:05:14+03:00` | `date -Is` |
| **Deployed release SHA** | **`c01c568d36d67869c76d012d0b953383162c411b`** (`Merge pull request #468`, 2026-08-20 21:31 +0200) | `git -C /var/www/noramedi rev-parse HEAD` |
| Deployed vs `main` | Production is **5 commits behind** `main`. `git diff --name-only c01c568..ef90dfb` shows the delta touches **only** `docs/`, `ops/` examples, `server/package.json` (test-script wiring), one verification script and three test files — **no application runtime code differs**. Production is therefore functionally equivalent to `main` for every claim in this document, but is *not* at `main`'s SHA and must not be reported as such. | `git diff` |
| PM2 | `noramedi-api` online (17h, 13 restarts), `noramedi-worker` online (17h, 14 restarts) | `pm2 list` |
| Health endpoint | `{"status":"ok"}` | `curl -fsS http://127.0.0.1:5000/api/health` |
| PostgreSQL | 16 `main` cluster, port 5432, **online** | `pg_lsclusters` |
| Disk | `/` 13% used (9.1G / 76G) | `df -h` |
| Failed systemd units | **0** | `systemctl --failed` |
| `RUN_BACKGROUND_JOBS` | **`false`** on the API — resolves the long-standing "value unverified" gap in [../ENVIRONMENT_MATRIX.md](../ENVIRONMENT_MATRIX.md) and confirms the worker is the sole job owner (consistent with R-034 `CLOSED`) | env key read, value is non-secret |

**Migrations:** `prisma migrate status` → *"80 migrations found… Database schema is up to date!"*. Direct read of `_prisma_migrations`: **total 80, unfinished 0, rolled back 0, rows carrying error logs 0.** Latest applied: `20260820130000_add_imaging_image_storage_backend` @ 2026-08-20 19:34:27+03. **`MIGRATION_PENDING = 0`, `MIGRATION_FAILED = 0`.**

**Database scale (no PHI):** 19 MB; 2 organizations, 3 clinics, 11 users. One clinic (`242fc529…`) already carries the `POST /api/platform/clinics` defaults (`maxUsers=10`, `maxPatients=500`) and has **zero users** — i.e. production already contains an instance of exactly the zero-user state that §4 exists to resolve.

## 2. Backup / PITR / recovery preflight (read-only, fresh)

This is the section where the pilot onboarding checklist's baseline is most badly out of date. Every row below is a fresh 2026-08-21 observation.

| Item | Observed state |
|---|---|
| pgBackRest | **2.50**, stanza `noramedi`, `status: ok`, cipher `aes-256-cbc` |
| `pgbackrest check` | **completed successfully** for **both** repos; a live WAL segment was archived to repo1 *and* repo2 during the check |
| repo1 | local, `/var/lib/pgbackrest` |
| repo2 | **off-host**, SFTP to `94.138.221.64` (TR secondary VPS), host-key pinned by fingerprint, encrypted |
| WAL archiving | `archive_mode=on`, `archive_command=pgbackrest --stanza=noramedi archive-push %p`, `wal_level=replica`, `archive_timeout=300` |
| `pg_stat_archiver` | **archived 1783, failed 0**, last archived `000000010000000700000000` @ 2026-08-21 16:03:58+03, no failure ever recorded |
| Latest backups | repo1 full 2026-08-21 13:05:06+03; repo2 full 2026-08-21 10:59:16+03 (8 backups on record) |
| Backup scheduling | `/etc/cron.d/noramedi-pgbackrest` (root:root) — repo1 daily 02:45 + weekly verify, repo2 daily 03:30 + weekly verify |
| Legacy `pg_dump` | still running daily 03:15 into `/root/noramedi-backups` (4 files retained) — belt-and-braces alongside pgBackRest, not the primary mechanism |
| **PITR status writer** | `noramedi-pgbackrest-status.timer` every ~15 min, last run 16:04:20, exit 0. `/var/lib/noramedi/pitr-status.json`: `offHost: "yes"`, `tier: "T2"`, `offHostReason: "RESTORE_PROVEN_FROM_REPO2"`, `statusOk: true`, `readyCount: 0`, `failedCount: 0` |
| **Restore drill** | `/var/lib/noramedi/pitr-drill-result.json` — `result: "passed"`, `r032Eligible: true`, repo **2**, RPO **2 min** (target 60), RTO **25 s** (target 14400), migration parity **80/80, 0 missing, 0 ahead**, application smoke **passed**, tenant-isolation smoke **passed** |
| Off-host proof | `/var/lib/noramedi/pitr-offhost-proof.json` — `result: "passed"`, repo 2, target `94.138.221.64` |
| opscheck | `noramedi-opscheck.timer` every ~5 min, last run 16:06:46 exit 0, checks `[pm2 disk backup pitr]` **all OK**, external heartbeats (Healthchecks.io) pinged successfully for all four |
| **File-tree (uploads) backup** | `/var/lib/noramedi/recovery-status.json` → `fileBackup: { enabled: false, destinationOffHost: false }` — **the attachment/upload tree is NOT backed up off-host.** This is the one genuinely open item in this section. |

**Consequence for G1:** [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.E's *mandatory* item ("at least one restore-test rehearsed before the pilot's first clinic goes live") is **satisfied** — three drills are on record, the newest of which restored from the **off-host** repo. R-031 and R-032 are `CLOSED` in [../RISK_REGISTER.md](../RISK_REGISTER.md). The database half of R-030 (R-030-DB) has all four of its technical/operational blockers closed and is held open **only** by the KVKK Workload-B counsel gate — a legal item, not a technical one. The **file-tree** half (R-030-FILES) remains technically open and is listed as such in §9.

## 3. G1 requirement reconciliation — old checklist vs current reality

[../../operations/pilot/PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md](../../operations/pilot/PILOT_CUSTOMER_ONBOARDING_CHECKLIST.md) was authored at baseline `3b4ec9d`. Several of its §2 checks are now factually superseded. Stale claims are **not** preserved merely because the checklist states them.

| # | Checklist §2 check | Old checklist state | Current repository state | Current production state | Status |
|---|---|---|---|---|---|
| 1 | Production health | Requires fresh check | n/a | API + worker online, `/api/health` 200, 0 failed units | **SATISFIED** (§1) |
| 2 | Migration status | Requires fresh check; cites R-062 | R-062 `MITIGATED` | 80/80 applied, 0 pending, 0 failed | **SATISFIED** (§1) |
| 3 | Backup evidence | "~11 hours" `pg_dump` interval | pgBackRest ops tooling merged | repo1 + repo2 scheduled, newest full 3h old, opscheck green | **STALE_DOC** — superseded (§2) |
| 4 | Restore-test evidence | "**no evidence of an actual run exists** — blocks the first clinic's onboarding" | R-032 `CLOSED` | 3 drills passed; newest from off-host repo2, RPO 2 min / RTO 25 s | **STALE_DOC** — the stated blocker no longer exists (§2) |
| 5 | Tenant creation | `POST /api/platform/clinics` | Route present, transactional, audited, 4 tests | Reachable; one clinic already created this way | **SATISFIED** (§4.1) |
| 6 | User/role creation | "**Known gap** — no bootstrap/invite flow for a brand-new tenant's first user was found" | **Gap confirmed at `ef90dfb`, then closed by this task** — see §4.2 | **NOT deployed** | **OPEN until merged + deployed** (§4.2) |
| 7 | Clinic legal profile | Fields enumerated | Model, routes, publish validation, tenant scoping and 40 tests all present | Table present, 1 published profile (pre-existing tenant) | **SATISFIED** with two recorded gaps (§5) |
| 8 | Audit/log access | Must be demonstrated | `AuditLog`/`ActivityLog`/`PlatformAdminAuditEvent`/`SecuritySignalEvent` present; tenant-scoped read route exists | 353 / 386 / 104 / 51 rows respectively — all four are actively written in production | **SATISFIED** with one gap (§6) |
| 9 | WhatsApp/Meta configuration | Env keys enumerated | Central-app + per-org connection model, HMAC verification, approved-template enforcement | Meta app keys present, legacy fallback `false`, per-clinic binding table present | **OPEN — PARTIAL** (§7) |
| 10 | Support/escalation contacts | Not filled in | Playbook has placeholders | n/a | **G1_REAL_CLINIC_INPUTS_REQUIRED** (§8) |
| 11 | G1-blocking risk status (R-046, R-061, R-029, R-030, R-031, R-032) | All treated as open | R-061 `CLOSED`, R-031 `CLOSED`, R-032 `CLOSED`; R-046 `OPEN`; R-029/R-030 `OPEN` | — | **Partly STALE_DOC** — see table below |

### Risk-by-risk (fresh read of [../RISK_REGISTER.md](../RISK_REGISTER.md))

| Risk | Current status | G1 relevance |
|---|---|---|
| **R-046** | `OPEN` | **The one named G1 blocker still genuinely open.** [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2 Blockers #1 and [../RELEASE_GATES.md](../RELEASE_GATES.md)'s G0 mandatory condition #1 both require it resolved or explicitly downgraded with evidence. Production-level cross-tenant negative verification and audit verification for the KVKK-HIGH-007/008 migrations have still never been performed. Not addressed by this task. |
| R-061 | `CLOSED` (2026-07-24, corrected 2026-07-25) | Was a G1 blocker; kill switch verified end-to-end in production. Checklist §5's "R-061 is OPEN" is **stale**. |
| R-062 | `MITIGATED` | Ordering resolved; residuals tracked under R-046/R-070. |
| R-031 (PITR) | `CLOSED` (2026-08-15) | Was "accepted temporary risk for G1 only"; now closed outright (§2). |
| R-032 (restore test) | `CLOSED` (2026-08-15) | The one item [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.E promoted to *mandatory* for G1 — now satisfied three times over (§2). |
| R-030-DB | `OPEN` | Technically complete; held **only** by the KVKK Workload-B counsel gate → `LEGAL_EXTERNAL`, not a technical blocker. |
| R-030-FILES / R-029 | `OPEN` | Upload tree not backed up off-host (§2). G1-allowed accepted risk per [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.E, but only with the ten governance fields recorded per clinic. |
| R-001, R-055 | `OPEN` | Application-layer-only tenant isolation. Explicitly G1-allowed accepted risk; mandatory to revisit at G2. |
| R-025 | `OPEN` | Entitlement enforcement. Named a **G2** requirement, not a G1 blocker. Note the concrete finding in §4.4. |
| R-018, R-035, R-036, R-037, R-039 | `OPEN` | G1-allowed documented operational debt. |
| R-033, R-034, R-038, R-074 | `CLOSED` | Worker deploy automation, duplicate job registration, frontend rollback, observability. |

## 4. First tenant creation and first OWNER bootstrap

### 4.1 `POST /api/platform/clinics` — tenant creation (unchanged, verified)

`server/src/routes/platformAdmin.ts:639`. Auth: `authenticatePlatformAdmin` + `csrfProtection('platform')` (router-level, `platformAdmin.ts:154`). Requires `name` + `slug` only; sanitizes the slug and rejects a duplicate with 409. Creates an `Organization` **and** a `Clinic` in **one** `prisma.$transaction`, together with a `platform_clinic.created` `PlatformAdminAuditEvent` written by `writePlatformAdminAuditEventInTx` — whose type signature accepts only a `TransactionClient`, so a clinic cannot be created without its audit row. Defaults applied: `currency='TRY'`, `timezone='Europe/Istanbul'`, `defaultLanguage='tr'`, `status='active'` (**not** `trial`, and no trial dates are set), `maxUsers=10`, `maxPatients=500`.

**No dry-run mode exists** for this route and none was invented. The only preview capability in the file is `POST /clinics/:id/sms-addon/preview-routing`, which is unrelated.

**Rollback/deactivation path:** `PATCH /api/platform/clinics/:id/status` accepts `trial|active|suspended|cancelled`. There is **no** `DELETE` route for a clinic — which is the correct posture for the rollback model in §8. Suspension is not cosmetic: `server/src/middleware/auth.ts:174-179` rejects every authenticated request for a `suspended` or `cancelled` clinic with 403, subject to a 60-second clinic-status cache (`CACHE_TTL_MS`, `auth.ts:13`).

### 4.2 FIRST_OWNER_BOOTSTRAP — the blocker, and the fix

**Finding at baseline `ef90dfb` — `BLOCKED_NO_SAFE_PATH`:**

- `POST /api/platform/clinics` creates a tenant with **zero users** (no `user.create` anywhere in the handler).
- `POST /api/users` (`server/src/routes/users.ts:137`) is gated by `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])`, which 403s when `req.user` is absent (`server/src/middleware/auth.ts:216-221`). There is **no** zero-user branch, so it is structurally incapable of creating a tenant's first user.
- The `ClinicInvitation` model exists (`server/prisma/schema.prisma:1757`) but **no live route creates, sends, or redeems one** — its only consumer is a historical backfill in `migrate-to-multibranch.ts`. Production confirms this: **0 rows.**
- `server/prisma/seed.ts` is a whole-database demo wipe (`deleteMany({})` across 17 models), guarded against production, hardcoding demo identities and a shared password — unusable for onboarding a real clinic.
- `server/src/scripts/repair-owner-admin.ts` **repairs** flags on a user that already has `role='admin'`; it creates nothing, is unaudited, defaults to scanning *all* admins across *all* tenants, and its own header ships the equivalent raw SQL.

So the only path that existed was a manual, unaudited, direct DB mutation — which fails the acceptance requirements this task sets out (auditable actor/action, explicit role and scope, no tenant leakage, safe password handling, documented rollback).

**Fix implemented (smallest additive mechanism, architecture order #2 — an additive Platform Admin endpoint reusing the existing auth/audit/password-reset contracts):**

`POST /api/platform/clinics/:id/owner` — `server/src/routes/platformAdmin.ts`. It inherits the router-level `authenticatePlatformAdmin` + `csrfProtection('platform')` chain. Its six safety properties, each asserted by a test:

1. **Bootstrap-only.** Refuses with `409 CLINIC_NOT_EMPTY` if the clinic has **any** user. It counts users, not owners, so it cannot be used to inject an account into an established tenant. This is the property that makes a platform-admin user-creation endpoint acceptable at all.
2. **Tenant scope is derived, never supplied.** `organizationId` comes from the clinic row; a body-supplied `organizationId`/`clinicId` is ignored.
3. **The operator never chooses or learns a long-term password.** A random 32-byte secret is bcrypt-hashed at cost 12 and discarded; the owner sets their real password through the existing `POST /api/auth/reset-password` flow. The one-time link is returned to the operator **only** when the onboarding email could not be delivered.
4. **Atomic with its audit row.** `User` + `UserClinic` + `Organization.ownerId` + `PasswordResetToken` + the `platform_clinic.owner_bootstrapped` audit event all commit together or not at all.
5. **PII minimization.** The audit row keys on the user's id and carries no email — matching the contract already stated at `PATCH /users/:id/status`.
6. **Reversible.** `PATCH /api/platform/users/:id/status` sets `isActive=false`, which blocks login (`auth.ts:93`) *and* invalidates any pending reset token (`auth.ts:458`).

The role written is `role='admin'` + `canAccessAllClinics=true`, which `normalizeRole()` (`server/src/utils/roles.ts:45-61`) resolves to **`OWNER`** — identical in shape to every existing owner account rather than a new special case. `emailVerifiedAt` is set because `auth.ts:107` otherwise rejects the login outright, which would create an account that can never be used.

**Classification: `FIRST_OWNER_BOOTSTRAP = PROVEN_SUPPORTED (repository + tests)`, and `NOT_DEPLOYED`.** For G1 purposes it remains a blocker until this PR is merged and deployed — *implemented* is not *deployed*.

### 4.3 Owner authentication, role and tenant-scope proof

Proven against a disposable PostgreSQL 16 by driving the **real** route handlers (§10, "Owner authentication and tenant scope"): the bootstrap token sets the password through the real `reset-password` handler; the token cannot be replayed; the owner then logs in through the real `login` handler; the resulting session carries `canAccessAllClinics`, normalizes to `OWNER`, includes the owner's own clinic **and** a sibling clinic in the same organization, and **excludes a clinic belonging to a different organization**; a wrong password 401s; a deactivated owner 403s.

Platform-admin identity is structurally distinct from tenant-owner identity: different Prisma models (`PlatformAdmin` has no `clinicId`/`organizationId`), different JWT `type` claims enforced in each middleware, and different signing secrets (`PLATFORM_JWT_SECRET` vs `JWT_SECRET`).

**No real production user was created.** All proof is against the disposable database.

### 4.4 Two findings recorded but deliberately not fixed here

- **`requireFeature()` is dead code.** `server/src/middleware/planLimits.ts:121-152` implements a generic per-plan feature gate, but it is invoked by **zero** routes. Numeric limits (`checkUserLimit`, `checkPatientLimit`) and the SMS add-on *are* backend-enforced; any entitlement expressed only through `Plan.features` is currently frontend-only. This is concrete evidence for R-025, which is a **G2** requirement, and is out of scope here.
- **Platform Admin MFA is optional and mostly unenrolled.** MFA is enforced per-admin (`if (admin.totpEnabledAt)`, `platformAdmin.ts:95`); there is no platform-wide requirement. Production read: **3 active platform admins, only 1 MFA-enrolled — 2 can authenticate with a password alone.** There is also no HTTP route to deactivate a platform admin (only a direct DB write or the recovery CLI). This is not a new category of finding — "platform-admin MFA-enrollment coverage" has stood at `OPEN_EXTERNAL_CONFIGURATION` as an F3 exit-gate criterion-2 item since `F3-SEC-EXIT-001` ([../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) §13) — but this is the first time the actual enrolment count has been measured. See §9.

For completeness on what *is* strong here: platform-admin login is rate-limited 5/15 min per email and 20/15 min per IP before any bcrypt work; sessions carry a `credentialVersion` claim matched exactly against `passwordChangedAt`, so a password recovery instantly invalidates every outstanding token; and `authenticatePlatformAdmin` re-reads the admin row on **every** request with no cache, so setting `isActive=false` revokes access immediately. The gap is enrolment and the missing deactivation route, not the session model.

## 5. Clinic legal profile readiness

Model `ClinicLegalProfile` (`schema.prisma:2382`), one row per clinic (`clinicId @unique`). Routes in `server/src/routes/clinicLegalProfile.ts`: `GET`, `PUT` (409 once published), `POST …/publish` — all gated to OWNER/ORG_ADMIN/CLINIC_MANAGER and tenant-scoped through `resolveEffectiveClinicId` (`utils/clinicScope.ts:147-167`), which requires the clinic to belong to the caller's organization **and** be in their allowed-clinic set, returning 403 otherwise.

Publish validation (`clinicLegalProfile.ts:98-117`) requires `dataControllerTitle`, `address`, `privacyNoticeText`, `privacyNoticeVersion`, `effectiveDate`, and either `privacyRequestEmail` or `email`; `website` is restricted to `http:`/`https:`. 40 assertions pass (§10).

**No demo/default data leaks into it.** `server/prisma/seed.ts` creates **no** `ClinicLegalProfile` row at all; the only synthetic profile lives in `seed.e2e-booking.ts`, an E2E-only script. No "Mustafa Basol" or repository-owner identity appears anywhere in this domain. Each clinic supplies and publishes its own controller details, as the accepted architecture requires.

Two gaps, recorded, neither blocking:
- **No version history table.** `privacyNoticeVersion`/`effectiveDate` are columns on a row that is mutated in place; a re-publish overwrites the previous values. The only durable per-event snapshot is `PublicBookingNoticeEvidence`, which is explicitly *not* a version history.
- **Publication writes no audit or activity record** (see §6).

**`CLINIC_LEGAL_PROFILE_TECHNICAL_READY = YES.`** This is a statement about the application's enforcement of its own required fields and tenant boundary. It is **not** a statement that any clinic's legal text is sufficient — that determination belongs to counsel.

## 6. Audit / activity readiness

| First-clinic action | Audit evidence produced | Where |
|---|---|---|
| Tenant creation (`POST /clinics`) | **YES** — `PlatformAdminAuditEvent` `platform_clinic.created`, atomic with the tenant | `platformAdmin.ts:675` |
| Clinic status change (suspend/reactivate) | **YES** — `platform_clinic.status_updated` | `platformAdmin.ts:715` |
| **OWNER bootstrap** | **YES (new)** — `platform_clinic.owner_bootstrapped`, atomic | §4.2 |
| User deactivation | **YES** — `platform_user.status_updated` | `platformAdmin.ts:1127` |
| Branch/clinic creation inside an org | **YES** — `ActivityLog` + `AuditLog` `branch_created` | `organizationBranches.ts:250-270` |
| Multi-clinic role assignment | **YES** — `AuditLog` `user_clinic_assignment_changed` | `organizationBranches.ts:676` |
| Staff user creation (`POST /api/users`) | **PARTIAL** — `ActivityLog` only; no `AuditLog` row | `users.ts:196` |
| Single-user role edit (`PUT /api/users/:id`) | **PARTIAL** — `ActivityLog` only | `users.ts:301` |
| **Legal profile publication** | **NO** — no `AuditLog`, no `ActivityLog`, no record of any kind | `clinicLegalProfile.ts` (no logging call anywhere in the file) |

Operator read path: `GET /api/ops/audit-logs` (`operationalMonitoring.ts:41`), role-gated and **always** filtered by `req.user.organizationId`, with CLINIC_MANAGER further restricted to their allowed clinics and a 403 for an out-of-scope clinic — cross-tenant leakage is closed at the query, not the UI. `PlatformAdminAuditEvent` and `SecuritySignalEvent` have no tenant-facing read route (platform/DB access only), which is the correct posture.

Production confirms all four stores are live and being written: `AuditLog` 353, `ActivityLog` 386, `PlatformAdminAuditEvent` 104, `SecuritySignalEvent` 51 rows. The platform-admin audit trail shows real, attributed actions (clinic data migration, status updates, MFA enablement, setting changes). `SecuritySignalEvent` hashes IPs (HMAC-SHA256), user-agents and resource ids by construction. No PHI was read or reproduced in gathering any of this.

**Gap for G1:** legal-profile publication produces no audit evidence. Given that publication is the act that makes a clinic's KVKK notice effective, it is the single audit hook most worth adding. Recorded as an exact next task (§11) rather than bundled into this PR, per the one-substantial-runtime-fix rule.

## 7. Meta / WhatsApp first-clinic readiness

Architecture confirmed as **central NoraMedi Meta app + per-organization connection**, not per-clinic apps: `META_APP_ID`/`META_APP_SECRET` are platform-level; `WhatsAppConnection` (`schema.prisma:1869`) is scoped to `organizationId` and holds `metaAccessTokenEncrypted`; `ClinicWhatsAppConnection` (`schema.prisma:1925`) binds a connection to one or many clinics.

Production configuration (names and non-secret values only; **no secret value was printed**):

| Key | State |
|---|---|
| `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_SECRET` | **SET** |
| `META_GRAPH_API_VERSION` | `v23.0` |
| `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` | **`false`** — legacy Evolution env fallback confirmed disabled |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | **MISSING — correct.** Per-connection values live in the database, not in env. Their absence is evidence the per-clinic model is in force, not a gap. |
| `ENCRYPTION_KEY` | SET; `server/src/index.ts:104-118` hard-fails at startup in production if it is unset or invalid |
| `ClinicWhatsAppConnection` rows | 1 (pre-existing tenant) |

Contract checks: webhook verification exists both globally and per connection, with `X-Hub-Signature-256` HMAC-SHA256 validated through `timingSafeEqual` and **fail-closed in production** when no secret is configured (`utils/secrets.ts:13`). Connection tokens are AES-256-GCM encrypted under `ENCRYPTION_KEY`. Embedded signup exists at `POST /organization/whatsapp-connections/meta/callback`, gated to OWNER/ORG_ADMIN, exchanging the OAuth code server-side. Approved-template enforcement is real: `whatsappOutboundMessaging.ts:223-234` refuses to send on `meta_cloud_api` unless `metaTemplateStatus === 'approved'`, with a WABA-drift guard so a template approved against a different WABA is not silently trusted.

**No message was sent and no integration was activated by this task.**

**`META_FIRST_CLINIC_READY = PARTIAL.`** Exact blockers, in order:
1. The embedded-signup route requires an authenticated **OWNER/ORG_ADMIN** — so it is gated behind §4.2 being deployed.
2. Per-clinic inputs that only exist once a real clinic is chosen: its WhatsApp Business number, completion of Meta embedded signup, and **at least one Meta-approved template** (enforced in code, so an unapproved template fails closed at send time rather than silently).

## 8. Operational support and first-clinic rollback model

Placeholders and processes that exist in the repository: incident classification and escalation structure, first-day smoke checklist, first-week monitoring cadence, and a drift check ([PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md](../../operations/pilot/PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md), [PILOT_FIRST_WEEK_MONITORING_PLAN.md](../../operations/pilot/PILOT_FIRST_WEEK_MONITORING_PLAN.md)). **No person is named anywhere, and this document names none** — support owner, escalation contact, rollback authority and evidence owner are all §9 real-clinic inputs.

**Reversible onboarding procedure (no destructive delete at any step):**

| Step | Mechanism | Effect |
|---|---|---|
| 1. Disable communications | Leave the clinic unbound to a `WhatsAppConnection`, or unset its `ClinicWhatsAppConnection` binding | Outbound WhatsApp stops; approved-template gate independently fails closed |
| 2. Revert feature enablement | Set each module back to the disabled default per [PILOT_FEATURE_ENABLEMENT_MATRIX.md](../../operations/pilot/PILOT_FEATURE_ENABLEMENT_MATRIX.md) §0 | Only the explicitly-enabled set was ever on |
| 3. Disable users | `PATCH /api/platform/users/:id/status` `{isActive:false}` per user | Login 403s (`auth.ts:93`); pending password resets invalidated (`auth.ts:458`); audited |
| 4. Disable the clinic | `PATCH /api/platform/clinics/:id/status` `{status:'suspended'}` | **Every** authenticated request 403s within ≤60 s (`auth.ts:174`, 60 s status cache); audited |
| 5. Preserve evidence | Take **no** delete action | `AuditLog`/`ActivityLog`/`PlatformAdminAuditEvent` retained; medical and business data retained intact |
| 6. Reactivation | Set status back to `active`, re-activate users | Fully reversible; each transition independently audited |

**Hard-delete is not part of this model.** No `DELETE /clinics` route exists, and none should be added for this purpose. Schema-level rollback of the KVKK-consent migrations remains a last-resort, explicitly-decided action once real rows exist, per [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §2.D — not a default rollback step.

Deployment rollback: frontend rollback is scripted and production-rehearsed (R-038 `CLOSED`). Backend/database rollback remains **cutback** (redeploy a compatible commit, retain the additive schema, forward-fix) and has been rehearsed only in disposable environments. The change in §4.2 needs neither: it is a purely additive route, and reverting the commit removes it with nothing to unwind (no migration, no schema change, no caller).

## 9. Blocker classification

```
G1_TECHNICAL_BLOCKERS = [
  "R-046 — production cross-tenant negative verification and production audit
   verification for the KVKK-HIGH-007/HIGH-008 migrations have never been
   performed. Named blocker #1 in LAUNCH_GATES.md §2 and G0 mandatory
   condition #1 in RELEASE_GATES.md. Not addressed by this task.",

  "FIRST_OWNER_BOOTSTRAP not yet in production — implemented and tested in this
   PR, but merged/deployed/production-verified are three separate states and
   none of them has been reached.",

  "Platform Admin MFA is optional and 2 of 3 active platform admins are not
   enrolled, so a password alone reaches an account that can create, suspend
   and re-plan any tenant. Close by either enrolling/deactivating the two
   accounts (production configuration) or enforcing mandatory enrolment
   (runtime change). There is also no HTTP route to deactivate a platform
   admin — only a direct DB write or the recovery CLI.",

  "R-030-FILES — the upload/attachment tree is not backed up off-host
   (recovery-status.json: fileBackup.enabled=false). Either close it or record
   it as a governed accepted risk with all ten fields LAUNCH_GATES.md §2
   requires, per clinic.",

  "Legal-profile publication writes no audit or activity record at all — the
   act that makes a clinic's KVKK notice effective leaves no evidence trail."
]

G1_EXTERNAL_LEGAL_BLOCKERS = [
  "Per-clinic KVKK/VERBİS/DPA applicability determination by qualified counsel
   (LAUNCH_GATES.md §2.H) — required before any real patient data is processed.",

  "F4 Workload-B KVKK legal gate for the off-host backup repo2 host — the sole
   remaining blocker on R-030-DB; COUNSEL_PENDING, no counsel evidence in the
   repository.",

  "IHS_KVKK_DSN_HARD_GATE — blocks GlitchTip/error-tracking activation and
   therefore F3_EXIT_CRITERION_2. GlitchTip is deployed as infrastructure but
   no DSN is configured in production and zero events are sent.",

  "F3_EXIT_CRITERION_3 (incident-response drill sufficiency) has never been
   assessed by any task — a decision-owner determination, not a code item."
]

G1_REAL_CLINIC_INPUTS_REQUIRED = [
  "Clinic legal name, slug, address, contact email/phone, currency, timezone,
   default language, and a deliberate (not defaulted) maxUsers/maxPatients.",
  "First OWNER: real first name, last name, email, phone.",
  "ClinicLegalProfile content: dataControllerTitle, address, privacyNoticeText,
   privacyNoticeVersion, effectiveDate, privacyRequestEmail or email.",
  "WhatsApp Business number, completed Meta embedded signup, and at least one
   Meta-approved template — only if communication is in scope at go-live.",
  "Named support owner, escalation contact, rollback authority and evidence
   owner (this document names no one).",
  "Decision owner's accepted-risk record with all ten LAUNCH_GATES.md §2 fields
   for each carried risk (R-001/R-055 app-layer-only isolation, R-029/
   R-030-FILES, R-018, R-035…R-039, CI-coverage gap, monitoring substitution).",
  "Signed DPA and the per-clinic counsel determination."
]
```

Legal and counsel items appear **only** in the second list. No legal item is recorded as a technical blocker, and no technical closure is claimed on the strength of a legal one.

## 10. Tests

All run at the working-tree state of this PR, against a disposable PostgreSQL 16 (`postgres:16-alpine`, 80/80 migrations applied via `prisma migrate deploy`) — never against production.

| Command | Result |
|---|---|
| `npx tsc --noEmit` (server) | **exit 0**, 0 errors |
| `npx tsx src/tests/platformAdminOwnerBootstrap.test.ts` (**new**) | **29 passed, 0 failed, 0 skipped** |
| `npm run test:auth` | **118 passed, 0 failed** |
| `npm run test:platform-admin-session-revocation` | **15 passed, 0 failed** |
| `npm run test:platform-admin-password-recovery` | **22 passed, 0 failed** |
| `npm run test:platform-admin-login-totp-gate` ×3 | **30 / 30 / 30 passed, 0 failed** (re-run 3× against the known leading-zero TOTP flake — no variance observed) |
| `npm run test:clinic-legal-profile` | **40 passed, 0 failed** |
| `npm run test:roles` | **142 passed, 0 failed** |
| `npm run test:staff-onboarding` | **15 passed, 0 failed** |
| `npm run test:user-import-onboarding` | **10 passed, 0 failed** |
| `npm run test:password-reset` | **10 passed, 0 failed** |

**Total: 431 assertions passed, 0 failed, 0 skipped** across 10 suites plus a clean typecheck.

The new suite is registered as `server` script `test:platform-owner-bootstrap`. It is **not** added to the aggregate `npm run test` chain, because its direct peers (`test:platform-admin-session-revocation`, `test:platform-admin-login-totp-gate`, `test:clinic-legal-profile`) are not in that chain either; wiring the platform-admin family into the aggregate is recorded as a next task (§11) rather than done unilaterally here.

## 11. Migrations, mutations, and exact next tasks

**`MIGRATION_CREATED = NO`. `MIGRATION_REQUIRED = NO`. `MIGRATION_DEPLOYED = N/A`.** The change in §4.2 writes only to models that already exist (`User`, `UserClinic`, `Organization`, `PasswordResetToken`, `PlatformAdminAuditEvent`). No schema change, no migration, nothing to roll back at the database level.

**Production mutations performed by this task: none.** Every production interaction was read-only. No clinic, user, patient, or integration was created, activated, or modified. No secret value was printed at any point.

Exact next tasks, in G1 priority order:

1. **Merge and deploy this PR, then production-verify the bootstrap route** — confirm a `409 CLINIC_NOT_EMPTY` against an existing clinic and confirm the route is reachable, without creating a real owner.
2. **Close R-046** — production cross-tenant negative verification and production audit verification for the KVKK-HIGH-007/HIGH-008 migrations. This is the last named G1 blocker whose closure is entirely technical.
3. **Resolve Platform Admin MFA** — enrol or deactivate the two password-only active admins, and decide whether to enforce mandatory enrolment in code.
4. **Add an audit hook to legal-profile publication** (`clinicLegalProfile.ts`), and consider a version-history record for `privacyNoticeVersion`/`effectiveDate`.
5. **Decide R-030-FILES** — enable off-host file backup, or record it as a governed accepted risk with all ten fields.
6. **Wire the platform-admin test family into the aggregate `test` chain.**

## 12. Result

```
FIRST_OWNER_BOOTSTRAP              = PROVEN_SUPPORTED (repository + tests) / NOT_DEPLOYED
CLINIC_LEGAL_PROFILE_TECHNICAL_READY = YES
META_FIRST_CLINIC_READY            = PARTIAL
MIGRATION_CREATED                  = NO
MERGE_SAFE                         = YES
DEPLOY_SAFE                        = YES (additive, no migration, revertible) — not performed by this task
G1_TECHNICAL_READY                 = NO  (5 technical blockers, §9)
G1_LEGAL_READY                     = NO  (external counsel gates, §9)
G1_APPROVAL_STATUS                 = NOT_APPROVED
```

`G1_APPROVAL_STATUS` may only be changed by an authorized decision owner using the approval-record template in [../LAUNCH_GATES.md](../LAUNCH_GATES.md) §7. No agent may set it, and this task does not.

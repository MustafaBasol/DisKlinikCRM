# F3-SEC-EXIT-001 — First-Customer Production Security Hardening Exit Checklist and Gap Closure

**Task ID:** F3-SEC-EXIT-001 · **Phase:** F3 — Production Hardening · **Priority:** CRITICAL / F3 EXIT-GATE
**Branch:** `feature/f3-sec-exit-001-first-customer-security-gate`
**Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-sec-exit-001`
**Baseline:** `origin/main` @ `92fc0c0c5eee34ae71bd2508bbfcc2f0309e3055` (PR #359 / F3-WA-META-COEX-002-R4 merge commit) — confirmed via `git fetch origin --prune` + `git rev-parse origin/main`, exact match, no drift, fresh isolated worktree created from this SHA.

## 0. What this task is and is not

This is the authoritative **first-customer production security-hardening sign-off**, built from current repository evidence. It is explicitly **not** a general security audit, **not** a penetration test, and **not** authorization to redesign authentication. It independently verifies 24 named checklist items (A–X) against `origin/main`, closes only the repository gaps that are small/additive/backward-compatible/not owned by another active parallel task, and documents everything else — including gaps this task deliberately did **not** fix — with exact rationale, evidence, and a recommended remediation path.

**This task's own verdict, stated up front: the F3 exit gate is NOT satisfied by this task.** See §6.

## 1. Method

- CodeGraph (`.codegraph/` exists at the repository root) was queried against the exact targeted surfaces named in the task brief: `server/src/middleware/auth*`, `server/src/middleware/csrf*`, `server/src/middleware/rate*`, `server/src/utils/secrets*`, `server/src/utils/encryption*`, `server/src/utils/databaseUrl*`, `server/src/routes/auth*`, `server/src/routes/platformAuth*`, `server/src/middleware/platform*`, `server/src/index.ts`, `server/.env.example`, `ecosystem.config.cjs`, and nginx-related repository config. No business-domain code was graphed.
- CodeGraph's index lags the fresh worktree by construction (a brand-new worktree has no index of its own); queries were run against the primary repository's index (checked out one commit ahead, at a digidentis-map fix disjoint from every security surface in scope) and every cited finding was independently re-confirmed by direct `Read`/`Grep` against the actual `origin/main` worktree before being recorded below. No finding in this document rests on CodeGraph output alone.
- Four parallel research passes (via subagent) each read the actual worktree source directly (`Read`/`Grep`, no shell `grep`/`find`) to independently verify: (1) MFA and session-invalidation behavior, (2) CORS/webhook-signature/security-headers/error-handling/dev-credential-fallback behavior, (3) environment-variable-validation/Redis-fallback/dependency-scanning/TLS repository evidence, (4) backup-privilege boundaries/tenant-scope safeguards/worker-role isolation/platform-admin audit state.
- Every claim below cites `file:line` and, where practical, a short verbatim excerpt. Where a claim depends on production-only state (a running process, a hosting-provider config, a certificate), it is explicitly marked `PASS_WITH_EXTERNAL_VERIFICATION` with an exact verification command in §5 — never asserted as verified from repository evidence alone.

## 2. Checklist (A–X)

| # | Item | Status | Evidence (file:function/line) | Notes |
|---|---|---|---|---|
| A | Production JWT/session secret fail-hard | **PASS** | `server/src/utils/secrets.ts:1-11` (`getSecret`) — throws in production if unset/equal-to-fallback/<32 chars. Used at `server/src/middleware/auth.ts:9` (`JWT_SECRET`) and `server/src/middleware/platformAuth.ts:7` (`PLATFORM_JWT_SECRET`), both evaluated at module-load time (before `app.listen`). | Also covers `IMAGING_BRIDGE_PAIRING_PEPPER` (`services/imaging/bridgePairing.ts:20`), same helper. |
| B | DATABASE_URL fail-hard | **PASS** | `server/src/utils/databaseUrl.ts:28-42` (`getRequiredDatabaseUrl`) — throws in production if unset/blank; called eagerly from `server/src/db.ts:17`, before any query can run. | Added by F3-IMPL-001 (merged). Non-production behavior unchanged (returns `undefined` verbatim, as before). |
| C | Encryption key production contract | **PASS** | `server/src/utils/encryption.ts:19-28` (`getKey`) — throws in **any** environment if `ENCRYPTION_KEY` is missing or not exactly 64 hex chars (every encrypt/decrypt call fails immediately, not just in production). `server/src/index.ts:90-98` additionally `process.exit(1)`s at startup in production specifically, so a misconfigured production process never accepts a request. | Strictest of all the fail-hard checks in the repo — correct, given it protects patient-data-adjacent secrets at rest. |
| D | Cookies: httpOnly / secure / sameSite | **PASS** | `server/src/utils/sessionCookies.ts:40-50` (`baseCookieOptions`) — session cookie `httpOnly: true` always; `secure` true whenever `NODE_ENV==='production'` or `sameSite==='none'` (line 33-38, `getSecureFlag`), regardless of the `SESSION_COOKIE_SECURE` env var's own value; `sameSite` configurable, defaults to `lax` (line 19-23). CSRF cookie deliberately `httpOnly: false` (readable by JS, by design — double-submit pattern) but same `secure`/`sameSite` contract. | `.env.example:100` ships `SESSION_COOKIE_SECURE=false` as its dev default — harmless, since production forces `secure: true` regardless (line 37). |
| E | CSRF enforcement | **PASS**, with one residual noted under R | `server/src/utils/sessionCookies.ts:135-176` (`signPayload`/`verifyCsrfToken`) — HMAC-SHA256, `crypto.timingSafeEqual` comparison (line 139-144), token bound to session id and type, clock-skew-bounded (`CSRF_CLOCK_SKEW_MS`, line 168-170). Enforced via `server/src/middleware/csrf.ts` (`csrfProtection(type)`), wired on both clinic (`routes/auth.ts`) and platform-admin (`routes/platformAdmin.ts:152`) mutating routes. | See item R for the one CSRF-adjacent gap found (the secret's own fallback chain), which does not defeat this enforcement mechanism itself. |
| F | Session expiry/invalidation | **PASS for clinic users; OPEN_BLOCKER for platform admin** | Clinic: `server/src/middleware/auth.ts:138-150` — `passwordChangedAt`-based revocation (token `iat` checked against the DB column) plus a live `isActive` re-check on every request, via a 15s-TTL cache (`getAuthUser`, line 40-65) that is force-invalidated on password change (`invalidateAuthUserCache`, called at `routes/auth.ts:257,474`). Platform admin: `server/src/middleware/platformAuth.ts:18-63` (`authenticatePlatformAdmin`) does **only** `jwt.verify` — no DB lookup of any kind, so no `isActive` check and no revocation-on-password-change mechanism exists, and the `PlatformAdmin` Prisma model has no `passwordChangedAt` column to check even if one were added casually. Confirmed by the codebase's own admission: `server/src/scripts/platform-admin-recover-password.ts:280-282` — *"No persistent PlatformAdmin session model exists to invalidate... Always 0; not invented here."* | **This is the single most severe finding in this task.** See §3 for why it was documented, not fixed, in this task, and the exact recommended follow-up. Clinic-side logout (`clearAuthCookies`, `sessionCookies.ts:190-193`) also only clears cookies — it does not revoke the JWT server-side for either account type — but this is the industry-standard stateless-JWT tradeoff, bounded by an 8h max age and the `passwordChangedAt` kill-switch for clinic users; accepted as-is. |
| G | Platform-admin MFA | **PASS_WITH_EXTERNAL_VERIFICATION** | `server/src/routes/platformAdmin.ts:94-106` — login is gated on a valid TOTP code whenever `admin.totpEnabledAt` is set (password checked first, so a wrong-password response never leaks MFA-enrollment state). `:171-239` setup/verify, `:242-278` disable (requires current password **and** a valid TOTP code). `server/src/utils/totp.ts`. No bypass path found. | **Residual risk: enrollment is optional, not enforced.** An admin who never enrolls can operate on password-only indefinitely (`platformAdmin.ts:94`, the whole MFA branch is skipped when `totpEnabledAt` is null). Repository evidence cannot prove every *current* PlatformAdmin account has actually enrolled — that is production/data state, not code; see verification command in §5. |
| H | Clinic-user MFA | **DEFERRED_POST_FIRST_CUSTOMER** (roadmap, not a named F3 exit blocker) | Confirmed fully absent: `Grep` for `totp\|mfa\|MFA\|2FA` across `server/src` outside `utils/totp.ts`/its tests/`routes/platformAdmin.ts` returns zero hits in any clinic-user-facing file. `User` model (`schema.prisma`) has no MFA-related column; only `PlatformAdmin` has `totpSecretEncrypted`/`totpEnabledAt` (`schema.prisma:1540,1542`). | Independently confirmed: no accepted program document (`docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/LAUNCH_GATES.md`) names clinic-user MFA as an F3 exit-gate blocker. Per this task's own brief, that means it stays roadmap work, documented as residual risk (see §4), not implemented here. **Residual risk:** a compromised clinic-user password (phishing, credential reuse) has no second factor; mitigated only by rate limiting (`J`) and the `passwordChangedAt` kill-switch (`F`). |
| I | Privileged Platform Admin audit state | **PARTIAL — owned by F3-IMPL-005 (open, unmerged); not touched here** | `~10 of ~25` mutation-style route handlers in `routes/platformAdmin.ts` currently call `writePlatformAdminAuditEvent`/`writePlatformAdminAuditEventInTx` (12 call sites; MFA setup/verify/disable, SMS-provider PUT/DELETE, data-retention & legacy-consent-correction settings PATCH/DELETE, both backup-trigger routes). `~15` do not: `PATCH /organizations/:id/status`\`/plan`\`/trial`, `POST /clinics`, `PATCH /clinics/:id/status`\`/plan`\`/sms-addon`, `POST /sms-providers/:id/test`, `PATCH /users/:id/status`, `POST/PUT /plans`, `POST /file-backups/run`\`/restore-rehearsal`, `POST /mail/test`. (`NORAMEDI_MASTER_TRACKER.md`/`CURRENT_PHASE.md` records a slightly different denominator, "25 of 37," counting all 70 platform-admin routes across 3 files with a different classification scheme — both counts agree qualitatively: roughly 2/3 audited, 1/3 not.) | Per this task's explicit instructions, Platform Admin audit endpoints are **owned by F3-IMPL-005** (worktree `f3-impl-005`, branch `feature/f3-impl-005-platform-admin-audit-final`, currently open/unmerged) — left gated, not touched. |
| J | Auth rate limiting | **PASS** | Clinic login: `routes/auth.ts:37` (`loginIpLimiter`, 20/IP/15min) + `utils/helpers.ts:186` (`loginLimiter`, 5/email/15min). Platform-admin login: `routes/platformAdmin.ts:45-46` (`platformLoginEmailLimiter`/`platformLoginIpLimiter`, 5/email + 20/IP per 15min — comment at line 43 explicitly: *"the most privileged credential in the system"*). | Both scoped by identifier + IP, not IP alone, matching best practice for credential-stuffing resistance. |
| K | Public endpoint rate limiting | **PARTIAL / DEFERRED_POST_FIRST_CUSTOMER** | Webhook receivers, the imaging-bridge pairing endpoints, and inbound AI message processing (`utils/inboundRateLimiter.ts`, 8 msgs/60s per channel+connection+sender) are rate limited. The broad `/api` CRUD surface (patients, appointments, payments, etc.) has **no** general rate limiting — unchanged since F3-IMPL-001 first documented this gap. | Not fixed here: broad API-surface rate limiting requires per-endpoint tuning to avoid breaking legitimate clinic bulk-workflow traffic (e.g. bulk imports, calendar sync) — not a "small" change safely boundable without live load testing. Accepted for a single-pilot-customer deployment; recommended before any multi-customer/public scale-out. |
| L | Redis dependence/fallback behavior | **PASS_WITH_EXTERNAL_VERIFICATION** | `server/src/utils/redis.ts:18-39`, `server/src/utils/counterStore.ts:69-83` — `REDIS_URL` fully optional; unset → silent (no log at all) in-process `Map` fallback; a runtime Redis error also falls back silently (rate-limited warning, once/60s). Explicitly fail-open by design (own comment, `counterStore.ts:5-8`): rate-limit counters become **per-process**, not global, without Redis. | External verification required: confirm `REDIS_URL` is actually configured in production, **and** confirm the current API process topology (single instance vs. PM2-cluster/multiple replicas) — the fallback's correctness impact depends entirely on replica count. See §5 for the exact command. |
| M | Security headers | **PARTIAL / DEFERRED_POST_FIRST_CUSTOMER** | `server/src/index.ts:155-163` sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and (production-only) `Strict-Transport-Security: max-age=15552000; includeSubDomains`. `helmet` is **not** a dependency (`Grep helmet server/package.json` — no match). Missing: `Content-Security-Policy`, `Permissions-Policy`, `Cross-Origin-*` (COOP/COEP/CORP). | Already flagged as a P1 item by F3-IMPL-001 and deliberately not touched then, for the same reason it isn't touched now: a correct CSP requires an allowlist built and tested against the actual frontend's script/style/connect origins — not safely boundable without live testing in this task. Recommended follow-up. |
| N | CORS policy | **PASS** | `server/src/index.ts:114-136` — allowed-origin list built from `CORS_ORIGIN`/`CORS_ORIGINS`, env-driven; `*` is explicitly filtered out of the allow-list (line 121) before being used, so it is never reflected as `Access-Control-Allow-Origin: *` even though `credentials: true` is always set (line 135) — the dangerous wildcard+credentials combination is structurally impossible here. Production with no origins configured defaults to deny-all (line 130-132), not allow-all. | A `*` entry still only produces a `console.warn` (line 123-125), never a startup failure — see item S. |
| O | Webhook signature verification | **PASS_WITH_EXTERNAL_VERIFICATION** | Instagram (`routes/instagramWebhook.ts:299-325`), Meta WhatsApp (`routes/metaWhatsAppWebhook.ts:232,375`), external-calendar/DigiDentiS (`routes/externalCalendarWebhook.ts:83-96`) all verify an HMAC signature via `timingSafeEqual`, gated by `utils/secrets.ts:13-15` (`requireWebhookSecretInProduction`) — **fail-closed in production** (missing secret → request rejected) and **fail-open outside production** (missing secret → request processed unauthenticated; a deliberate dev convenience, not a production code path). | No code-level check forces every production webhook *connection row* to actually have a secret configured — that is admin/config data, not code. External verification required: confirm every active production webhook connection (Instagram, Meta WhatsApp, each DigiDentiS external-calendar connection) has a non-empty secret. See §5. **[Scope corrected 2026-08-13, F3-EXIT-C2-LANE-F:** this list omitted **Evolution-API WhatsApp connections**, which also consume a per-connection `webhookSecret` — as the tenant-identifying inbound credential for the public WhatsApp API (`routes/whatsapp.ts:1107-1113, 1166-1186`), not as an HMAC signature key. They are in scope for the §5 item 4 check and are covered by its corrected query.**]** |
| P | Log secret/PII exposure status | **PARTIAL — Wave 2 owned by F3-IMPL-006 (open, unmerged); not touched here** | F3-IMPL-004 (merged, PR #356) fixed all 43 `SECRET_TOKEN`/`CONFIRMED_PII`/`PHI_MEDICAL`-classified call sites found in its own full-repo inventory (~541 call sites reviewed). `~116` `POTENTIAL_PII` + 2 `MESSAGE_CONTENT` sites remain, explicitly deferred by that task as "Wave 2." | Per this task's explicit instructions, broad logging call-sites are **owned by F3-IMPL-006** (worktree `f3-impl-006`, branch `feature/f3-impl-006-runtime-log-hygiene-wave2`, currently open/unmerged) — left gated, not touched. |
| Q | Production error responses | **PASS** | `server/src/index.ts:280-286` — the global error handler always returns one of exactly two fixed generic strings (`'Internal server error'` for 5xx, `'Invalid request'` for 4xx); `err.stack`/`err.message`/the raw error object are never serialized into the HTTP response, in any `NODE_ENV`. Verbose detail is server-log-only, via `logUnhandledError`. | No development-vs-production branch exists because the response is *already* generic unconditionally — stricter than a typical "verbose in dev" pattern, and correct for a codebase with no separate dev/staging deployment gap to worry about. |
| R | Default/dev credential fallbacks | **PASS, with one documented-not-fixed residual** | `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `IMAGING_BRIDGE_PAIRING_PEPPER` all route through `getSecret()` (item A) — their literal dev fallbacks are provably unreachable in production. `prisma/seed.ts:24-29` gates its `password123` demo password behind `NODE_ENV==='production' && ALLOW_PROD_SEED!=='true' → throw`. **Residual, not fixed:** `sessionCookies.ts:106-113` (`getCsrfSecret`) falls back `CSRF_SECRET → JWT_SECRET → PLATFORM_JWT_SECRET → 'csrf-development-secret-change-this-value'` — this bypasses `getSecret()`'s own fail-hard check entirely; the only production safeguard is a `console.warn` (`getSessionCookieDeploymentWarnings`, line 120-126), not a throw. | **Why this is not exploitable today, and why it was not "fixed" as code:** `auth.ts`/`platformAuth.ts` both call `getSecret()` for `JWT_SECRET`/`PLATFORM_JWT_SECRET` at module-load time, before `app.listen()` — so by the time any HTTP request reaches `getCsrfSecret()`, both of those are *already* guaranteed non-empty, strong, production-validated strings (or the process would already have crashed at startup). The literal fallback is therefore provably unreachable in a running production process. The real, lower-severity residual is **cryptographic key reuse**: if `CSRF_SECRET` is left unset, the CSRF HMAC key silently becomes the JWT signing secret — a key-separation hygiene concern, not a demonstrated exploit path. Making `getCsrfSecret()` throw outright when `CSRF_SECRET` is unset was considered and **rejected** for this task: with no production access to confirm `CSRF_SECRET` is actually set today, that change risks crashing a currently-working production deployment that relies on the cascade — the opposite of "backward compatible." Recommended as a follow-up (§4), not attempted here. |
| S | Environment-variable validation | **PARTIAL / DEFERRED_POST_FIRST_CUSTOMER** | No single consolidated "validate all required production env vars before listening" gate exists. 9 distinct vars have *some* fail-hard/production check, each independently, scattered across `secrets.ts`, `databaseUrl.ts`, `encryption.ts`, `index.ts`, `securitySignalService.ts`, `consentEvidenceSanitizer.ts`, `fileBackupDestination.ts` (the last two only evaluated lazily, on first use of an already-off-by-default feature). Vars with **no** fail-hard check anywhere: `REDIS_URL`, `SMTP_*`, `EVOLUTION_API_*`, `META_*`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `SESSION_COOKIE_DOMAIN` (format-only warn), `CORS_ORIGIN` (warn-only on wildcard, item N). | Already flagged as a P1 item ("a single consolidated startup-validation gate... a larger P1 change, not selected") by the already-merged F3-IMPL-001. Remains correctly out of this task's bounded scope for the identical reason: every one of the un-checked vars gates a feature that is off-by-default (`MAIL_ENABLED=false`, `FILE_BACKUP_ENABLED=false`, legacy WhatsApp env fallback `false`) — silent misconfiguration degrades a disabled feature, not a live security control. |
| T | Backup/admin privilege boundaries | **PASS** | `routes/platformAdmin.ts:152` (`router.use(authenticatePlatformAdmin, csrfProtection('platform'))`) gates both `/backups/run` (line 1703) and `/backups/restore-test` (line 1738); `PlatformAdmin` has no role/tier field, so there is no privilege-escalation path *within* the platform-admin tier, and clinic-level admins cannot reach `/api/platform/*` at all (different JWT `type`, checked at `platformAuth.ts:41`). `backupService.ts`'s `parseDatabaseUrl()`-derived `PGPASSWORD` is used only as a subprocess `env` value (`execFile`), never serialized into any HTTP response or console log (restore-test results explicitly redact even the temp DB name). `BACKUP_DIR` (`/root/noramedi-backups`) has no HTTP download route of any kind — only filename/size/mtime metadata is ever returned. | Clean separation; no changes needed. |
| U | Worker process role isolation | **PASS** | `server/src/utils/processRole.ts:48-76` (`assertProcessRole`) — fails closed on a mismatched/unrecognized `NORAMEDI_PROCESS_ROLE`, no-ops (backward compatible) when unset. Wired at `index.ts:88` (`assertProcessRole('api')`) and `worker.ts:28` (`assertProcessRole('worker')`). `ecosystem.config.cjs` (repo root) defines both `noramedi-api` and `noramedi-worker` PM2 apps with matching `NORAMEDI_PROCESS_ROLE` env values. | Delivered by F3-IMPL-002 (already merged to `main`). Independently re-verified against current `origin/main`, not merely cited from that task's own doc. |
| V | Tenant-scope known safeguards | **PASS_WITH_EXTERNAL_VERIFICATION** (maturity: report-only, not yet enforcing) | Runtime mechanism: `resolveEffectiveClinicId()` (`utils/clinicScope.ts:147-167`) — cross-org and access-list validated, used at ~37 call sites. Static safeguard: F2-GUARDRAIL-IMPL-001's import-graph cross-domain scanner, CI-wired as a genuinely non-blocking, report-only job (`.github/workflows/ci-layers.yml:115-127`, `architecture-guardrail-report-only`) — its own authorizing doc (`F2-SEC-003_SECURITY_GATE_RECONCILIATION.md` §5.2) states CI-blocking enforcement is **"NOT AUTHORIZED"** pending a false-positive validation pass, and the scanner does not detect direct `prisma.<model>.<method>()` calls at all (import-graph only). | This is a known, separately tracked, in-progress program (F2-GUARDRAIL-*) — advancing its enforcement maturity is out of this task's scope. Documented here as current state, not re-litigated. |
| W | Dependency update automation / vulnerability-alert availability | **R1-CORRECTED: PARTIAL — dependency update automation ADDED by this task; vulnerability alerting/security-scanning `PASS_WITH_EXTERNAL_VERIFICATION`/`OPEN_EXTERNAL_CONFIGURATION`** (originally mis-stated as `was OPEN_BLOCKER → FIXED`; see §11) | Before: confirmed absent — no `npm audit`/Snyk/CodeQL script in root or `server/package.json`; all 5 `.github/workflows/*.yml` files grepped for `audit\|snyk\|codeql\|dependency-check` with zero real hits; no `.github/dependabot.yml` existed. After: `.github/dependabot.yml` added (this task) — npm ecosystem for `/`, `/server`, `/bridge-agent` (the repo's 3 `package.json` locations) plus the `github-actions` ecosystem, weekly cadence. **This is dependency *update* automation (scheduled version-update PRs) only.** It does not, by itself, prove that Dependabot vulnerability alerts, Dependabot security updates, GitHub code scanning (CodeQL or equivalent), `npm audit` in CI, or any third-party SAST/dependency-scanning tool (Snyk, etc.) are enabled — each is a separate GitHub repository setting or CI control that a committed file cannot turn on by itself. The broader dependency/security-scanning gap is **not** claimed closed. | See §3.1 (R1-corrected) for exact rationale/blast-radius and §5 item 1 for the one external (repository-settings) step this file cannot automate. |
| X | TLS/nginx repository evidence vs. production-only evidence | **PASS_WITH_EXTERNAL_VERIFICATION** (already correctly separated) | Root `nginx.conf:1-8` explicitly self-documents as container-internal SPA server only — *"TLS sonlandırma, HTTP→HTTPS yönlendirmesi ve HSTS dış katmandaki reverse proxy'nin sorumluluğundadır — bu dosyaya 443/ssl EKLEMEYİN"* (do not add 443/ssl to this file) — and indeed only has `listen 80;`, no `ssl_certificate`/443/HSTS directive anywhere in it. Actual production TLS termination (host Nginx 1.24.0, Let's Encrypt cert, 4 hostnames, expiry `2026-09-26`) is recorded in `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` under the `VERIFIED_PRODUCTION_OBSERVED` classification, distinctly separate from any repo-file claim. | This repository already does the right thing here: it does not claim TLS from repo evidence. External verification checklist item only: re-confirm current cert validity/protocol/cipher via an external scanner — see §5. |

## 3. What this task implemented, and what it deliberately did not (with why)

### 3.1 Implemented: `.github/dependabot.yml` — dependency update automation (item W)

**R1 correction (§11):** the original text of this section overstated this file's effect as closing a "dependency-scanning mechanism" gap. Corrected below; see §11 for the full before/after record.

Before this task, the repository had **zero** dependency *update automation* of any kind. `.github/dependabot.yml` adds Dependabot's scheduled version-update PR mechanism — it opens a pull request on a weekly cadence when a newer version of a dependency is published. This requires no new CI job, no new secret, and — critically — **cannot fail an existing workflow**, since it does not run inside `ci-layers.yml`/`ci-pr.yml`/`ci-main-and-nightly.yml`. It is purely additive configuration. Covers all 3 `package.json` locations (`/`, `/server`, `/bridge-agent`) plus the `github-actions` ecosystem.

**What this does not do, and was previously overstated:** `dependabot.yml`'s version-update configuration is **not**, by itself, evidence that any of the following are enabled: Dependabot vulnerability *alerts*, Dependabot *security updates*, GitHub code scanning (CodeQL or equivalent), `npm audit` in CI, or any third-party SAST/dependency-scanning tool (Snyk, etc.). Each of those is a separate GitHub repository *setting* (Settings → Code security and analysis) or a separate CI control that this committed file cannot turn on by itself. The broader dependency/security-scanning gap is **not** claimed closed by this task — item W's status is corrected to `PASS_WITH_EXTERNAL_VERIFICATION`/`OPEN_EXTERNAL_CONFIGURATION` for those pieces (see §5 item 1 for the one manual verification step this requires).

### 3.2 Deliberately NOT implemented: platform-admin session revocation (item F)

This is the most severe gap this task found, and the one most tempting to "just fix," mirroring the clinic-user pattern almost line-for-line. It was not implemented, for a specific, evidenced reason — not caution for its own sake:

Implementing it requires (1) a schema migration adding `passwordChangedAt DateTime?` to `PlatformAdmin`, and (2) making `authenticatePlatformAdmin` do a DB lookup instead of pure-JWT verification. Step (2) **breaks the established test convention** in `server/src/tests/platformAdmin.test.ts` (and 4 other test files that import `authenticatePlatformAdmin`: `smsModule.test.ts`, `securityIncident.test.ts`, `retentionManualRunAudit.test.ts`, `platformBackup.test.ts`) — at minimum 6 currently-passing assertions in `platformAdmin.test.ts` alone (lines 222-235, 244-249, 257-261, 268-271, 286-290, 304-307, plus two more at 826-833 and 1330-1335) construct JWTs for fabricated, never-persisted admin IDs (`'admin-1'`, `'user-1'`) specifically to test pure-JWT-layer behavior without any DB fixture. Adding a mandatory DB lookup would make every one of these return 401 "admin not found," not because the JWT logic under test is wrong, but because the test's whole premise (no DB row needed) would no longer hold.

That crosses the line this task's own brief draws: *"This is NOT permission to redesign authentication"* and *"Only fix repository blockers if... change is small."* A change that requires rewriting an established cross-file test pattern is not small. This is reported as the **top OPEN_BLOCKER** in this document instead (see §4), with the exact recommended fix already spelled out (mirror `middleware/auth.ts:138-150`, add the migration, update the affected tests to seed real fixture rows — a well-scoped, single-purpose follow-up task).

### 3.3 Deliberately NOT implemented: `CSRF_SECRET` fail-hard (item R)

Considered and rejected for the reason stated in the table row: no production access exists to confirm `CSRF_SECRET` is actually set today, so making `getCsrfSecret()` throw when it's unset risks crashing a currently-working deployment — the opposite of backward-compatible. The actual exploitable severity is low (transitively mitigated by `JWT_SECRET`/`PLATFORM_JWT_SECRET` already being mandatory), so the risk of "fixing" it outweighs the benefit here. Recommended as a follow-up once `CSRF_SECRET`'s production value can be confirmed.

### 3.4 Deliberately NOT implemented: CSP/`helmet`, broad `/api` rate limiting, consolidated env validation (items M, K, S)

All three were already correctly identified and deliberately deferred by the already-merged F3-IMPL-001, for reasons that still hold verbatim: each requires either live-traffic tuning (rate limits, CSP allowlists) or touches a broad, cross-cutting surface incompatible with a "small" change. Re-confirmed, not re-litigated.

## 4. Risk acceptance items (residual risks accepted for first customer)

| Risk | Severity | Accepted rationale | Owner of eventual fix |
|---|---|---|---|
| Platform-admin sessions cannot be revoked (no `isActive`/`passwordChangedAt` check, no session store) | **High** | Not fixed here — bounded-scope/test-blast-radius reasoning in §3.2. Mitigated in practice by: 8h JWT max age, MFA (item G, if enrolled), tight platform-login rate limiting (item J), and the fact that only a small number of trusted operators hold this credential. | Recommended dedicated follow-up task: "Platform-admin session revocation," mirroring `middleware/auth.ts`. |
| Clinic-user accounts have no MFA option | Medium | Not named as an F3 exit-gate blocker in any accepted program doc; roadmap item, not first-customer blocker. Mitigated by rate limiting + `passwordChangedAt` kill-switch. | Roadmap, not yet assigned an F3-* task ID. |
| `CSRF_SECRET` fallback bypasses `getSecret()`'s fail-hard check | Low | Transitively mitigated (see §3.3); fixing it risks a production-breaking regression this task cannot verify against. | Recommended follow-up once `CSRF_SECRET`'s production value is confirmed set. |
| No broad `/api` CRUD-surface rate limiting | Medium | Single-pilot-customer deployment; broad rate limiting needs live-traffic tuning to avoid breaking legitimate bulk workflows. | Recommended before multi-customer/public scale-out. |
| No CSP/`Permissions-Policy`/COOP/COEP/CORP headers | Medium | CSP needs an allowlist built and tested against actual frontend origins; not boundable without live testing. | Recommended follow-up, `helmet` + CSP-report-only rollout. |
| Redis fallback is per-process, silent when `REDIS_URL` is simply unset | Medium (severity depends on replica count — unverified) | Fail-open by design; correctness impact is unknown without confirming production replica count. | See §5 external verification; no code change needed if single-instance confirmed. |
| Webhook secrets are not enforced to exist per-connection at the DB/config layer | Low | Code already fails closed in production if a secret is genuinely absent; the residual is purely a config-completeness question, not a code gap. | Operational — confirm via §5. |
| `~15` platform-admin mutation endpoints remain unaudited (item I) | Medium | Owned by F3-IMPL-005, in progress, not duplicated here. | F3-IMPL-005 |
| `~116` `POTENTIAL_PII` log call sites remain unremediated (item P) | Medium | Owned by F3-IMPL-006, in progress, not duplicated here. | F3-IMPL-006 |
| Tenant-scope guardrail is report-only, not CI-blocking (item V) | Medium | Explicitly not-yet-authorized for enforcement pending false-positive validation (F2-GUARDRAIL program's own decision, not this task's to override). | F2-GUARDRAIL-* program |

## 5. External production verification checklist

None of the items below can be, or were, verified from repository evidence alone. Copy-pasteable where practical.

1. **Dependabot alerts enabled** (item W) — repository Settings → Code security and analysis → confirm "Dependabot alerts" and "Dependabot security updates" are both `Enabled`. (`.github/dependabot.yml` added by this task only controls *version-update* PRs, not vulnerability *alerting* — that toggle is separate.)
2. **Platform-admin MFA enrollment coverage** (item G):
   ```sql
   SELECT count(*) AS total, count(*) FILTER (WHERE "totpEnabledAt" IS NOT NULL) AS mfa_enrolled
   FROM "PlatformAdmin" WHERE "isActive" = true;
   ```
   Confirm `mfa_enrolled = total` for every active account, or explicitly accept the gap per admin.
3. **REDIS_URL configured + API replica count** (item L): on the production host, `pm2 jlist | grep -A2 '"name":"noramedi-api"' ` to confirm instance count, and confirm `REDIS_URL` is present in that process's actual environment (`pm2 env <id>`), not merely in `.env.example`.
4. **Webhook secrets configured per connection** (item O):

   > **[CORRECTED 2026-08-13, F3-EXIT-C2-LANE-F.]** The original two-statement query printed here was **schema-invalid** — it named a column that does not exist on `WhatsAppConnection` and a table that does not exist at all — and it also returned row `id`s, which this program's own redaction rule forbids pasting back from production. It is **superseded**, not deleted: the exact original text, the reason, and the verbatim errors it produced when executed against a disposable local migrated database (never against production) are preserved as dated historical record in [`F3-EXIT-C2_EXTERNAL_SECURITY_SETTINGS_VERIFICATION.md` §18](F3-EXIT-C2_EXTERNAL_SECURITY_SETTINGS_VERIFICATION.md). **The command below is the current governing check.** Do not re-run the superseded one.

   Read-only. Aggregate counts only — no `id`, no secret, no ciphertext, no plaintext is selected or returned. Safe to paste back in full.

   ```sql
   SELECT 'whatsapp_meta_cloud_api__active' AS scope,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE COALESCE("metaWebhookSecret", "webhookSecret") IS NOT NULL) AS with_secret,
          true AS required
     FROM "WhatsAppConnection" WHERE "isActive" = true AND "provider" = 'meta_cloud_api'
   UNION ALL
   SELECT 'whatsapp_evolution_api__active',
          COUNT(*),
          COUNT(*) FILTER (WHERE "webhookSecret" IS NOT NULL),
          true
     FROM "WhatsAppConnection" WHERE "isActive" = true AND "provider" = 'evolution_api'
   UNION ALL
   SELECT 'whatsapp_unrecognized_provider__active',
          COUNT(*),
          COUNT(*) FILTER (WHERE COALESCE("metaWebhookSecret", "webhookSecret") IS NOT NULL),
          true
     FROM "WhatsAppConnection"
    WHERE "isActive" = true AND "provider" NOT IN ('meta_cloud_api', 'evolution_api')
   UNION ALL
   SELECT 'instagram__active',
          COUNT(*),
          COUNT(*) FILTER (WHERE "webhookSecret" IS NOT NULL),
          true
     FROM "InstagramConnection" WHERE "isActive" = true
   UNION ALL
   SELECT 'external_calendar__enabled',
          COUNT(*),
          COUNT(*) FILTER (WHERE "webhookSecretEncrypted" IS NOT NULL),
          true
     FROM "ExternalCalendarIntegration" WHERE "enabled" = true
   UNION ALL
   SELECT 'external_calendar__disabled',
          COUNT(*),
          COUNT(*) FILTER (WHERE "webhookSecretEncrypted" IS NOT NULL),
          false
     FROM "ExternalCalendarIntegration" WHERE "enabled" = false
   UNION ALL
   SELECT 'whatsapp__inactive',
          COUNT(*),
          COUNT(*) FILTER (WHERE COALESCE("metaWebhookSecret", "webhookSecret") IS NOT NULL),
          false
     FROM "WhatsAppConnection" WHERE "isActive" = false
   UNION ALL
   SELECT 'instagram__inactive',
          COUNT(*),
          COUNT(*) FILTER (WHERE "webhookSecret" IS NOT NULL),
          false
     FROM "InstagramConnection" WHERE "isActive" = false
    ORDER BY 1;
   ```

   **PASS condition (both clauses required):**

   ```
   PASS iff (a) with_secret = total for EVERY row where required = true
        AND (b) whatsapp_unrecognized_provider__active.total = 0
   Anything else = NOT_PASS.
   ```

   Clause (b) exists because no webhook receiver in this codebase verifies a signature for any `provider` value other than `meta_cloud_api` / `evolution_api`. A non-zero count there must **not** be waved through as PASS merely because those rows happen to carry a secret — it means an unrecognized/legacy provider is active and needs explicit review. Rows with `required = false` (inactive connections, disabled calendar integrations) are reported deliberately so they are visible rather than silently dropped; they do not gate PASS.

   **Explicit limitation — `with_secret` proves NOT NULL, not decryptable.** These columns store `enc:v1:`-tagged ciphertext, with legacy plaintext rows still readable until re-saved (`schema.prisma:1693-1695, 1702-1703, 1901-1902`). A row holding a corrupted or un-decryptable value counts as `with_secret` here but behaves at runtime exactly like a missing secret: `tryDecryptConnectionSecret` (`server/src/routes/whatsapp.ts:1145-1154`) swallows the decrypt failure and returns `null`. `with_secret = total` is therefore **necessary but not sufficient**. Proving decryptability requires the application's `ENCRYPTION_KEY` and an application-side oracle, which no read-only SQL check can provide — that gap must be recorded as a residual, never assumed away.

   **Column-name provenance** (verified against `server/prisma/schema.prisma` on `origin/main` @ `0ad59802bc5f9dcd567ef1d2fd72ec3797bb3f8b`): `WhatsAppConnection.metaWebhookSecret` (`:1695`) and `.webhookSecret` (`:1703`); `InstagramConnection.webhookSecret` (`:1902`); `ExternalCalendarIntegration.webhookSecretEncrypted` (`:3448`). There is no `ExternalCalendarConnection` model and no `WhatsAppConnection.webhookSecretEncrypted` column.
5. **CSRF_SECRET actually set** (item R, prerequisite for the recommended follow-up): confirm `CSRF_SECRET` is present and ≥32 chars in the production `noramedi-api`/`noramedi-worker` environment before ever making `getCsrfSecret()` fail-hard.
6. **TLS certificate/protocol/cipher** (item X): `openssl s_client -connect app.noramedi.com:443 -servername app.noramedi.com </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer`, or an external scanner (e.g. SSL Labs) against `app.noramedi.com`/`api.noramedi.com`. Confirm expiry is not imminent (repo evidence records `2026-09-26` as of a prior task; re-verify, do not trust that date as current).
7. **Host Nginx config matches repo's stated SPA-only intent** (item X): diff the live `/etc/nginx/sites-enabled/*` against the assumption in `nginx.conf`'s own header comment (TLS/HSTS/redirect handled entirely outside this repo's `nginx.conf`).
8. **Firewall / WAF** — no repository evidence exists either way; this task makes no claim. Verify directly against the hosting provider's console/firewall rules.
9. **Backup storage durability/encryption-at-rest** (item T) — `BACKUP_DIR=/root/noramedi-backups` is a local filesystem path; confirm at the infrastructure level whether the underlying disk/volume is itself encrypted and whether backups are additionally replicated off-host (see `FILE_BACKUP_COVERAGE_001` evidence doc for the separate, already-designed off-host file-backup feature — confirm whether it is actually `FILE_BACKUP_ENABLED=true` in production; `.env.example` ships it `false`).
10. **External error tracking** — confirmed absent in-repo (no Sentry or equivalent dependency); this is unchanged from F3-IMPL-001's own finding and remains an open F3 exit-gate item independent of this task (see §6).

## 6. F3 exit-gate status — explicitly NOT satisfied

This task only owns security-hardening sign-off, and even within that narrow scope, does not claim satisfaction:

- Item F (platform-admin session revocation) is an **OPEN_BLOCKER**, not merely a residual risk — it is the most severe finding in this document and is not closed.
- Items I and P remain open, owned by F3-IMPL-005/F3-IMPL-006, both still unmerged as of this task.
- No live observability dashboard/alarm evidence exists (F3-OBS-001, unmerged) — outside this task's scope, but a named F3 exit-gate requirement regardless.
- No incident-response drill evidence exists (F3-IR-001) — same.
- External error tracking is entirely absent (item C in F3-IMPL-001's own original inventory; unaddressed by any F3 task to date).

**The F3 phase exit gate should remain `NOT SATISFIED`** in `NORAMEDI_MASTER_TRACKER.md`/`CURRENT_PHASE.md` after this task, pending at minimum: F3-IMPL-005 merge, F3-IMPL-006 merge, F3-OBS-001 merge, a resolution for item F above, and the F3-IR-001 drill.

## 7. Files changed by this task

- `.github/dependabot.yml` (new) — item W.
- `docs/program/evidence/F3-SEC-EXIT-001_FIRST_CUSTOMER_SECURITY_HARDENING_GATE.md` (this file, new).
- `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/RISK_REGISTER.md`, `docs/program/evidence/README.md` — tracker entries recording this task (see those files' own diffs for exact wording).

No schema/migration change. No runtime application-code change. No route/response-shape/public-contract change.

## 8. Tests run

Since no runtime file was changed (`.github/dependabot.yml` is CI-adjacent configuration, not application code, and cannot be exercised by any existing test), the only test run was the baseline sanity check the task brief requires at minimum:

| Command | Purpose | Result |
|---|---|---|
| `cd server && npm run typecheck` (`npx prisma generate && tsc --noEmit`) | Baseline sanity — confirm this task introduced zero TypeScript/Prisma-client regressions | **Exit `0`, zero TypeScript errors.** Prisma Client (v7.8.0) generated cleanly. Run against a freshly-installed worktree (`npm install` at repo root, then `npm install` inside `server/` — this worktree's `server/node_modules` is not covered by the root install, both were first-ever installs for this worktree). |

No auth/security-focused suite, secret/database-url test, or CSRF/rate-limit test was re-run beyond the baseline typecheck, because none of those runtime files were modified — per the task brief's own instruction ("Run tests only for runtime files actually changed").

## 9. Rollback

`.github/dependabot.yml`: delete the file (or `git revert` the commit that added it). It has no runtime dependency, no schema/data footprint, and disabling it stops future version-update PRs immediately with zero other effect. Documentation-only changes (tracker files, this evidence doc) roll back via a normal `git revert` with no data-migration concern, per every prior F3-IMPL-00x task's own precedent.

## 10. Status

- **Agent completed?** Yes.
- **Tests passed?** Yes for the one command run (baseline typecheck) — see §8 for exact command; no runtime test suite was in scope to re-run.
- **PR opened?** Yes — [PR #362](https://github.com/MustafaBasol/DisKlinikCRM/pull/362).
- **Merged?** No.
- **Deployed?** No — this task explicitly stops at PR, per its own instructions.
- **Production verified?** No — no production access was used at any point in this task; every production-dependent claim is marked `PASS_WITH_EXTERNAL_VERIFICATION` with an exact command in §5, never asserted as verified.

## 11. F3-SEC-EXIT-001-R1 — Security gate evidence correction and main reconciliation (2026-08-11)

**Trigger:** architecture review accepted this task's security assessment and its top finding (R-073, platform-admin JWT session-revocation gap, item F), but flagged one evidence statement as imprecise: item W and §3.1 originally described `.github/dependabot.yml` as closing a "dependency/security-scanning mechanism" gap and item W's status as `was OPEN_BLOCKER → FIXED by this task`. That overstated what the file actually does.

**What Dependabot version-update configuration does and does not prove:**

Dependabot's *version-update* configuration (what `.github/dependabot.yml` is) provides scheduled dependency-update PR automation only. It does **not**, by itself, prove any of the following are enabled:

- Dependabot vulnerability *alerts* (the Security tab's alerting feature)
- Dependabot *security updates* (auto-generated fix PRs for known vulnerabilities)
- GitHub code scanning (CodeQL or an equivalent SAST tool)
- `npm audit` running in CI
- Snyk or any other third-party dependency/security-scanning tool

Each of those requires a separate repository *setting* (Settings → Code security and analysis) or a separate CI control — none of which a committed `dependabot.yml` file can turn on by itself.

**Corrections made by this R1 pass:**

1. **Item W's checklist status** (§2) changed from `was OPEN_BLOCKER → FIXED by this task` to `PARTIAL — dependency update automation ADDED; vulnerability alerting/security-scanning PASS_WITH_EXTERNAL_VERIFICATION/OPEN_EXTERNAL_CONFIGURATION`. The row's title changed from "Dependency/security scan availability" to "Dependency update automation / vulnerability-alert availability."
2. **§3.1** rewritten to state precisely what `.github/dependabot.yml` does (dependency update automation) and does not do (does not prove vulnerability alerting/security-scanning is enabled), rather than describing it as closing the broader security-scanning gap.
3. **`.github/dependabot.yml`'s own header comment** rewritten to the same accurate description (dependency update automation, not "dependency-scan/update availability"), and its prior wording — which called the version-update mechanism "security-update alerts/PRs" — corrected, since version-update PRs and Dependabot security-update alerts are two distinct Dependabot features.
4. **Every shared program document** that repeated the overstated "gap closed"/"gap fixed"/"closes one dependency-scanning gap" claim corrected to the same accurate description, with the original (now-superseded) wording preserved as historical record where the file's own convention is to keep a dated log (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F3_PRODUCTION_HARDENING.md`, `RISK_REGISTER.md`, `evidence/README.md`).

**What is unchanged by this correction:**

- **R-073 is unchanged and not renumbered.** It remains the platform-admin JWT session-revocation/credential-change kill-switch gap (item F), `OPEN_BLOCKER`, in `RISK_REGISTER.md`. F3-OBS-001 will use R-074 for observability, per the risk-ID contract for this correction.
- The `.github/dependabot.yml` file's own content (the 4 `package-ecosystem` blocks) is unchanged — only its header comment and the surrounding evidence prose were corrected.
- No item other than W changed status.
- **The F3 exit gate remains explicitly NOT satisfied** — unaffected by this correction; see §6 (unchanged).

**Main reconciliation performed in the same pass:** `origin/main` was fetched and merged (`git fetch origin --prune && git merge origin/main`, no rebase, no force-push) now that **PR #361 (F3-IR-001, First-Customer Incident Response Runbook and Tabletop Drill Evidence) has merged** (merge commit `2d87d7dd3f9dcc3818703bf32814e70b091d2c3c`). Previous branch head: `c444ac7217feefb87c36ed058aedf9528636eb93`. Conflicts occurred in the shared program-control docs this task also touches (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `phases/F3_PRODUCTION_HARDENING.md`) — all resolved **additively**: both F3-IR-001's merged incident-response-drill history and this task's full F3-SEC-EXIT-001 checklist history are preserved in full, neither side dropped. `evidence/README.md` auto-merged cleanly. Merge commit: `62ebc4e941cf6c584cb3a3e729a4f6d94603eb69`.

**Scope of this R1 pass:** documentation and CI-adjacent configuration only. No application/schema/migration file touched; no runtime auth fix implemented here (platform-admin JWT revocation, item F/R-073, remains explicitly out of scope for this task line — it belongs to a dedicated follow-up, tracked as F3-SEC-002 per this correction's own instruction). `cd server && npm run typecheck` re-run as the baseline sanity check (§8, unchanged procedure).

**Files touched by this R1 pass beyond the merge itself:** `.github/dependabot.yml` (header comment only), this evidence file (§2 row W, §3.1, this §11), `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F3_PRODUCTION_HARDENING.md`, `docs/program/RISK_REGISTER.md`, `docs/program/evidence/README.md`.
- **F3 exit gate satisfied?** **No** — see §6.

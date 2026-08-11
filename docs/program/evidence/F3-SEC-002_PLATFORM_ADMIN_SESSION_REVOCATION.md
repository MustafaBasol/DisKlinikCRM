# F3-SEC-002 — Platform Admin JWT Session Revocation and Credential-Change Kill Switch

**Task:** F3-SEC-002 (phase F3 — Production Hardening; CRITICAL / first-customer security blocker; risk R-073)
**Branch/worktree:** `feature/f3-sec-002-platform-admin-session-revocation`, dedicated worktree `E:\Ek Gelir\Siteler\DisKlinikCRM-git\.claude\worktrees\feature+f3-sec-002-platform-admin-session-revocation`
**Baseline:** `origin/main` @ `2d87d7dd3f9dcc3818703bf32814e70b091d2c3c` (PR #361/F3-IR-001 merge commit), independently confirmed via `git fetch origin`/`git rev-parse origin/main`, no drift at task start.
**CodeGraph:** no `.codegraph/` directory exists in this repository (consistent with every other recent F3 task's own finding) — `codegraph_explore` (the MCP tool, which does not require a local index) was used instead, targeted exactly to the files this task's brief named: `server/src/middleware/platformAuth.ts`, `server/src/routes/platformAdmin.ts` (no separate `platformAuth*` route file exists — login/MFA live in `platformAdmin.ts`), `server/src/scripts/platform-admin-recover-password.ts`, `server/src/services/platformAdminAudit.ts`, `server/prisma/schema.prisma`, and the existing platform-admin auth test files. No unrelated business domain was scanned.

---

## 1. Root cause (confirmed gap)

`authenticatePlatformAdmin` (`server/src/middleware/platformAuth.ts`) verified only JWT signature/expiry/type/`jti`-presence. Unlike clinic-user auth (`middleware/auth.ts`'s `authenticate`, which does a per-request DB lookup and checks `dbUser.passwordChangedAt` against the token's `iat`), it performed **no persistent lookup at all** — `req.platformAdmin` was populated straight from the decoded JWT payload. Consequences, all confirmed by reading the code before making any change:

- A Platform Admin JWT stayed valid for its full 8h lifetime regardless of a password reset, account deactivation, or the admin row being deleted.
- The emergency recovery CLI (`platform-admin-recover-password.ts`) already knew this and said so in its own `printResult()` output: *"PlatformAdmin sessions are stateless JWTs with no persistent session store; this CLI cannot revoke tokens already issued to this account… (proposed follow-up: passwordChangedAt-based invalidation, mirroring the clinic User model)"* — this task implements exactly that proposal, in the exact place the codebase's own prior task anticipated it.
- No normal (self-service) Platform Admin password-change route exists at all — the emergency recovery CLI is the *only* credential-reset path in this codebase.
- No Platform Admin deactivation route exists in the application either — `PlatformAdmin.isActive` is an operational/DB-level control with no in-app toggle. This is unchanged by this task; the new auth contract now actually *enforces* `isActive`, closing a second, related gap (previously an admin's `isActive` flag was never read by the middleware at all).

## 2. Every credential-invalidating code path — explicit decision per path

| Path | Invalidates sessions? | Reasoning |
|---|---|---|
| Emergency recovery CLI (`platform-admin-recover-password.ts`) | **Yes — mandatory, now implemented** | This is the only credential-reset path and the task explicitly requires it. Sets `passwordChangedAt` in the same `$transaction` as the `passwordHash` update. |
| Normal self-service password change/reset | N/A — does not exist | No such route exists anywhere in `routes/platformAdmin.ts` or elsewhere; nothing to wire. |
| Admin deactivation (`isActive` → `false`) | Enforced by the new `isActive` check (was previously not checked at all), not by `passwordChangedAt` | No in-app route sets `isActive`; it is an operational DB update. The new contract now rejects every token for an inactive admin on the very next request, regardless of the token's `iat` — a stronger, immediate cutoff than a timestamp comparison would be. |
| MFA disable (`POST /auth/mfa/disable`) | **No — deliberate** | Requires re-proof of both the current password *and* a valid TOTP code (`bcrypt.compare` + `verifyTotp`, both checked before the mutation). The caller already holds a live, authenticated session by definition (the route sits behind `authenticatePlatformAdmin`+CSRF). Invalidating other sessions here would not contain an attacker (who, to reach this endpoint at all, already has a valid session or the full credential set) while unexpectedly logging the legitimate admin out of their other devices. Asserted by a new test in `platformAdmin.test.ts` (`passwordChangedAt` stays `null` after a successful MFA disable). |
| MFA setup/verify (enroll) | No | Strictly increases account security; never a credential-compromise-recovery event. Unchanged. |

## 3. Schema decision

Additive, nullable column on `PlatformAdmin`, mirroring the existing `User.passwordChangedAt` field byte-for-byte in shape and semantics (`schema.prisma`):

```prisma
model PlatformAdmin {
  id                  String    @id @default(uuid())
  email               String    @unique
  passwordHash        String
  /// JWTs issued before this moment are rejected — set on every credential
  /// reset (currently: the emergency recovery CLI). Null = never explicitly
  /// invalidated; existing pre-migration tokens keep working until natural
  /// expiry (F3-SEC-002).
  passwordChangedAt   DateTime?
  name                String
  isActive            Boolean   @default(true)
  ...
```

**Field name:** `passwordChangedAt`, not the more generic `credentialsInvalidatedAt` alternative the task brief offered — chosen because it is the *exact* name the recovery CLI's own prior output already promised ("mirroring the clinic User model"), and because only password resets currently set it (see §2) — a generic name would overstate what actually triggers invalidation today.

**Migration:** `server/prisma/migrations/20260811120000_add_platform_admin_password_changed_at/migration.sql`:

```sql
-- F3-SEC-002: invalidate Platform Admin JWTs issued before the admin's last
-- recorded credential change. Additive, nullable — existing rows land NULL,
-- which authenticatePlatformAdmin() treats as "no known invalidation
-- checkpoint" (pre-migration outstanding tokens keep working until their
-- natural 8h expiry; see docs/program/evidence/
-- F3-SEC-002_PLATFORM_ADMIN_SESSION_REVOCATION.md for the migration policy).
ALTER TABLE "PlatformAdmin" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
```

No column renamed or dropped. No other model touched.

**Existing-row / backward-compatibility policy:** every pre-migration `PlatformAdmin` row gets `passwordChangedAt = NULL`. `authenticatePlatformAdmin` treats `null` exactly like the clinic-auth equivalent does — the `iat`-vs-checkpoint comparison is skipped entirely (`if (admin.passwordChangedAt && …)`), so **any JWT already outstanding at deploy time continues to authenticate normally until its own natural 8h expiry** — a bounded, ≤8h window, not an indefinite one, since the token's own `exp` claim is still verified first by `jwt.verify()`. This is the same accepted policy the clinic-auth `passwordChangedAt` migration (`20260701130000_add_user_password_changed_at`) used. No backfill, no forced logout of currently-active admins, no downtime required.

## 4. Auth contract (`server/src/middleware/platformAuth.ts`)

`authenticatePlatformAdmin` is now `async` and, after the existing signature/type/`jti` checks, in order:

1. Rejects if `typeof decoded.iat !== 'number'` (defense in depth — every token this codebase's own `generatePlatformToken` issues always has one; a token that doesn't is either forged/tampered or from a future issuance path that forgot to set it, and must never be trusted to predate any future revocation).
2. Looks up the admin **fresh from the database on every request** — `prisma.platformAdmin.findUnique({ where: { id }, select: { id, email, isActive, passwordChangedAt } })`. **Deliberately no in-process cache**, unlike clinic auth's 15s `getAuthUser` cache: Platform Admin traffic is a handful of privileged operators, not hundreds of concurrent clinics, so a cache's staleness window would directly undermine the point of a "kill switch" (a just-revoked token would still work for up to the cache TTL). The extra per-request query is the correct trade for the highest-privilege identity in the system.
3. Rejects if the admin row is missing or `isActive` is `false`.
4. Rejects if `passwordChangedAt` is set and `decoded.iat < floor(passwordChangedAt.getTime() / 1000)`.
5. On success, `req.platformAdmin` is populated **from the DB row** (`id`, `email`), not from the token payload — a renamed/updated email (if a future task ever adds one) can never be spoofed via an old token, and this is now proven by a test.

**Generic response, no state leaked:** every rejection above returns the identical `401 { error: 'Unauthorized: Invalid token' }` — indistinguishable from an ordinary bad-signature rejection. A caller cannot learn whether an id exists, is inactive, or was recently revoked.

**Fails closed on infra errors:** the entire lookup sits inside the pre-existing `try { … } catch { return 401 }` block that already wrapped `jwt.verify()`. A DB error (including a genuinely unreachable database) is caught and returns the same generic 401 — never a 500, never an open-fail. This is not a new pattern: `server/src/utils/databaseUrl.ts` already documents, and `server/src/tests/platformBackup.test.ts` (a `server:test:non-disposable`/"zero external infra" suite) already relies on, exactly this "construct succeeds, first real query fails gracefully outside production" behavior for `db.ts`'s Prisma client. This task's new DB lookup is simply the first `server:test:non-disposable` member to actually *exercise* that already-designed fallback path, per `databaseUrl.ts`'s own doc comment.

**No sensitive logging:** the pre-existing `console.warn('[platform-auth] Bearer token fallback used for platform auth')` line (bearer path only, no token/email in it) is unchanged; no new log statement was added anywhere in the auth path. Verified by a dedicated test (`platformAdminSessionRevocation.test.ts`) that spies on `console.log`/`warn`/`error` across accept/reject/revoked/malformed outcomes and asserts no token, email, or password hash ever appears.

## 5. Credential-reset integration (`server/src/scripts/platform-admin-recover-password.ts`)

The recovery transaction now writes `passwordChangedAt: credentialsInvalidatedAt` (a single `new Date()` captured once, before the transaction, reused for both the DB write and the returned result) alongside `passwordHash` in the same `$transaction` as the audit-event insert — so a reset can never commit without also invalidating every token issued before it, and the audit-insert-fails-and-rolls-back-the-hash guarantee that already existed now also covers the invalidation checkpoint.

The result interface's `sessionsInvalidated: number` field (always `0`, with a comment explaining no session store existed) is replaced with `credentialsInvalidatedAt: Date | null` — `null` on a dry run (no write happens), the real timestamp on a genuine reset. `printResult()`'s CLI output no longer claims tokens *cannot* be revoked; it now reports `Prior sessions revoked: yes`.

## 6. MFA decision

See §2 table. MFA disable does not touch `passwordChangedAt` — a deliberate threat-model decision (re-proof of password+TOTP already required; caller already holds a live session), asserted by a test rather than left implicit.

## 7. Test architecture and exact results

The pre-existing fabricated-JWT pattern (`generatePlatformToken({ id: 'admin-1', ... })` fed straight into `authenticatePlatformAdmin` with no backing DB row) is exactly the pattern the task warned would break once the middleware requires DB-backed identity. Per-file disposition:

- **`platformAdmin.test.ts`** — the `admin-1` fixture upsert (previously seeded only much later in the file, for an unrelated route-test section) was moved to the top of the file's test section so the "authenticatePlatformAdmin — Middleware doğrulama" tests that immediately follow can rely on it too; the old, now-redundant upsert call site was removed (idempotent `upsert`, so this is a pure move, not new state). One assertion updated: the test's token intentionally carries a stale email claim, and now asserts `req.platformAdmin.email` comes from the DB fixture, not the token — proving claim #5 above. One new assertion added to the existing MFA-disable-success test: `passwordChangedAt` stays `null`.
- **`platformAdminPasswordRecovery.test.ts`** — `sessionsInvalidated`/`0` assertions updated to `credentialsInvalidatedAt`; added a `passwordChangedAt`-persisted-correctly assertion and an updated `safeMetadata` shape assertion; added a new end-to-end test ("a token issued before recovery is rejected… a token issued after it is accepted") that runs the *real* CLI function and the *real* middleware together.
- **`platformBackup.test.ts`** (member of `server:test:non-disposable`, "zero external infra") — the 3 direct `authenticatePlatformAdmin(...)` calls were missing `await` (harmless while the function was synchronous; a real bug once it became `async`, since assertions would then race an unresolved promise). Fixed. The "valid token" test was rewritten to assert against a **fresh random admin id** (not the shared literal `'admin-1'` other suites use) so it stays deterministic — expecting 401 — whether or not a real Postgres happens to be reachable in that job, per the fail-closed design in §4; the positive "real admin accepted" path is covered elsewhere (see next item), against a real database.
- **`adminScriptsLogPrivacy.test.ts`** — two `printResult(...)` fixture literals updated from the old `sessionsInvalidated` field to `credentialsInvalidatedAt` (compile-only fix, no behavior change to what's being tested — the whole point of this suite is print-output privacy, unaffected).
- **New `platformAdminSessionRevocation.test.ts`** — dedicated suite for the 12 required scenarios not already fully exercised above: valid active admin accepted (using the DB row's identity, not the token's); nonexistent admin rejected; inactive admin rejected (including a "deactivated mid-session" same-token-stops-working proof); token-before/after-`passwordChangedAt` (including an exact-second boundary-is-exclusive proof); a `null passwordChangedAt` never rejects on that basis; missing `iat` rejected; non-numeric `iat` rejected (hand-crafted HMAC-signed token — `jwt.sign()` itself refuses to produce one, which is reassuring, but means proving the middleware's own defense-in-depth requires bypassing only the *library's* input validation, not its signature scheme); cross-admin isolation (two independent proofs — one admin's revocation never touches another's, and a token's `sub` fully determines whose state governs, never leaking a different admin's future checkpoint); no sensitive logging.

**Exact commands and results** (disposable PostgreSQL 16, `server/`):

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit `0`, no errors |
| New F3-SEC-002 suite | `npm run test:platform-admin-session-revocation` | `12/12` |
| Recovery CLI | `npm run test:platform-admin-password-recovery` | `22/22` |
| Auth + platform admin | `npm run test:auth` | `82/82` (was `82/82`; the "Middleware doğrulama" section is now DB-backed rather than DB-blind) |
| Security incidents | `npm run test:security-incidents` | `57/57` checks |
| Retention manual-run audit | `npm run test:retention-manual-run-audit` | `29/29` |
| Platform backup (non-disposable member) | `npm run test:platform-backup` | `25/25` |
| Platform backup audit | `npm run test:platform-backup-audit` | `3/3` |
| SMS module | `npm run test:sms` | `77/77` |

**Full orchestrator runs (repository root, disposable PostgreSQL 16, Docker-provisioned per the existing F1-003-P2 mechanism):**

| Run | Command | Result |
|---|---|---|
| `postgres` profile (`server:test:disposable-db`) | `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` | `migration.code: 0`, `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0` |
| `postgres-compat` profile (`server:test:legacy-db-required`) | `npm run test:runtime:postgres-compat -- --summary-file=postgres-compat-run-summary.json` | `migration.code: 0`, `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0` |
| `server:test:non-disposable` (68 members, zero external infra — re-run because this task's changes touch two of its member files, `platformBackup.test.ts`/`adminScriptsLogPrivacy.test.ts`) | `npm run server:test:non-disposable` | exit `0` |

Both orchestrator runs' own Docker containers/networks were torn down cleanly by the orchestrator itself (`cleanup.success: true`, no listed errors) — no manual container cleanup was required.

## 8. Migration verification

- **Migration name:** `20260811120000_add_platform_admin_password_changed_at`.
- **`prisma migrate deploy`** against a disposable PostgreSQL 16 (`postgres:16-alpine`, Docker) carrying all 72 pre-existing migrations: applied cleanly as migration 73/73 — `All migrations have been successfully applied.`
- **`prisma migrate status`** post-deploy: `Database schema is up to date!` (73 migrations found, none pending).
- **Existing-row behavior:** every row created by a prior migration (i.e. every row that existed before this one) has `passwordChangedAt = NULL` — confirmed directly (the column is nullable with no default, and `ALTER TABLE … ADD COLUMN` never backfills). Application behavior for that state is documented in §3.
- **Rollback approach:** per the task's own instruction, the recommended rollback is **application-code revert with the additive column retained** — deploy a prior commit of `platformAuth.ts`/`platform-admin-recover-password.ts` while leaving `passwordChangedAt` in place (harmless: no other code reads or writes it). A manual `DROP COLUMN` is explicitly **not** the recommended path and was not exercised or rehearsed by this task.

## 9. Security / KVKK / tenant impact

**Security — high positive impact.** A compromised or leaked Platform Admin JWT's usable lifetime is now bounded by the next credential reset, not by its full 8h `exp`. This is the highest-privilege identity in the system; closing this gap was this task's entire purpose.

**Tenant impact — none.** No clinic-facing route, clinic JWT (`middleware/auth.ts`), tenant-scoping query, or clinic-visible behavior was touched. Changes are confined to `platformAuth.ts`, the recovery CLI, `schema.prisma`, and tests.

**KVKK — reduces risk.** Directly reduces the window during which a compromised platform-admin credential could be used to access tenant/patient data before an operator's reset takes effect.

## 10. Rollback expectations

See §8. Additive-only; application-level revert is sufficient and preferred.

## 11. R-073 status

R-073 may move to `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` on the strength of this implementation and its DB-backed test evidence (§7/§8) — **not self-marked `CLOSED`**, per the task's own instruction and this program's established convention (see e.g. R-071's own closure history) that a task cannot unilaterally close the risk it just remediated. External/independent confirmation and a merge decision remain outstanding.

## 12. PR / merge / deployment safety

`AGENT_COMPLETED` / `TESTS_PASSED` — PR opened against `main`, not merged. **`NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.** No merge or deploy action was taken or requested by this task, per its own explicit instruction ("STOP AT PR. NO MERGE. NO DEPLOY.").

## 13. Exact next task

Program-owner review/merge decision for this PR. Independently: (1) an explicit human decision on whether a normal (self-service) Platform Admin password-change route should ever be added — today the emergency CLI is the only reset path, which this task treats as a given, not a gap to close; (2) if a Platform Admin deactivation *route* is ever added to the application (today `isActive` is DB/ops-only), it should be wired to nothing extra — the new `isActive` check in `authenticatePlatformAdmin` already covers it immediately, with no `passwordChangedAt` involvement needed.

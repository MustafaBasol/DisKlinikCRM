# F3-WA-META-COEX-002B — Platform-Owned Meta WhatsApp Connection, Implemented

Task ID (ClickUp): `86eyq2wcn` · Parent Epic: F3-WA-META-COEX (`86eykhg28`) · Phase: F3 — Production Hardening

**Outcome: IMPLEMENTED (draft PR, not merged, not deployed).** Implements the minimum architecture the predecessor task (F3-WA-META-COEX-002A) reported as blocked on and proposed: a dedicated, additive `PlatformWhatsAppConnection` Prisma model, a Platform Admin route file reusing the existing Meta Cloud API stack, and a Platform Admin frontend page — for NoraMedi's own (not a customer's) Meta WhatsApp connection.

Evidence tags, same convention as the predecessor document:
- **[REPO]** — directly observed from repository source in this session
- **[TEST]** — confirmed by running an automated test in this session against a real, disposable PostgreSQL instance

---

## 1. Baseline

| Field | Value |
|---|---|
| `origin/main` SHA at branch cut | `b9dab9294ee90aef494ce14dafed5a5c9397ce91` (PR #485's merge commit — the F3-WA-META-COEX-002A architecture-blocker report) |
| Worktree | `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f3-wa-meta-coex-002b-platform-whatsapp-connection` |
| Branch | `feature/f3-wa-meta-coex-002b-platform-whatsapp-connection` |
| Working tree at session start | Clean fast-forward of `origin/main`, no drift |

## 2. Approved architecture implemented

Per F3-WA-META-COEX-002A's §5 proposal and this task's own explicit approval: a **new, dedicated, additive Prisma model**, `PlatformWhatsAppConnection` (`server/prisma/schema.prisma`, right after `ClinicWhatsAppConnection`). It carries:

- No `organizationId`, no `clinicId`, no `ClinicWhatsAppConnection`-style linking relation, no tenant message/inbox relation.
- Every Meta-path field the tenant `WhatsAppConnection` model has (`name`, `provider` fixed to `meta_cloud_api`, `status`, `phoneNumber`, `displayName`, `metaBusinessId`, `metaWabaId`, `metaPhoneNumberId`, `metaAppId`, `metaAccessTokenEncrypted`, `metaWebhookVerifyToken`, `metaWebhookSecret`, `webhookSecret`, `metaTokenStatus`/`metaTokenExpiresAt`/`metaTokenLastCheckedAt`, `lastConnectedAt`, `lastError`, `isActive`, timestamps) — no Evolution-only fields, since this task is Meta-only.
- A `singleton Boolean @default(true) @unique` column, **plus a hand-added `CHECK ("singleton" = true)` constraint in the migration SQL (`PlatformWhatsAppConnection_singleton_true_check`, corrected in review round 3, see §19)** — together, not the `@unique` index alone, a **DB-level**, not just application-level, guarantee that at most one row can ever exist. **Corrected claim:** a `UNIQUE` index on a boolean column by itself only forbids two `TRUE` rows or two `FALSE` rows — it does **not** forbid one of each, since `TRUE` and `FALSE` are distinct non-NULL values and unique constraints only dedupe equal values against each other. The `CHECK` constraint rules out a `FALSE` row ever existing at all; the `UNIQUE` index then rules out a second `TRUE` row; together they guarantee at most one row total, even under a concurrent create race. **[TEST]** proven directly, three ways: (A) the first default/`TRUE` row succeeds; (B) a raw second `prisma.platformWhatsAppConnection.create()` bypassing the service layer's pre-check throws `Unique constraint failed`; (C) a raw SQL `INSERT ... singleton=false` via `prisma.$executeRawUnsafe` — bypassing the service layer AND the Prisma Client's query builder — throws a Postgres check-constraint violation, proving the `CHECK` half of the invariant on its own (a `FALSE` row would not collide with the `UNIQUE` index at all).
- `metaPhoneNumberId String? @unique` and `@@index([provider])`, mirroring the tenant table's own invariants.

## 3. Current → target data ownership

| | Before (002A) | After (002B) |
|---|---|---|
| Platform-owned Meta connection storage | None — did not exist | `PlatformWhatsAppConnection`, exactly one row, no tenant owner |
| Tenant Meta/Evolution connections | `WhatsAppConnection`, `organizationId`-scoped | **Unchanged** — same table, same columns, same routes, same behavior |
| Ownership model | N/A | Platform-owned: no `organizationId`, no `Organization`/`Clinic` relation of any kind |

## 4. Migration

- **Name:** `20260822140000_add_platform_whatsapp_connection`
- **SQL summary (updated in review round 3, §19):** one `CREATE TABLE "PlatformWhatsAppConnection"`, three `CREATE INDEX`/`CREATE UNIQUE INDEX` statements, and one `ALTER TABLE ... ADD CONSTRAINT ... CHECK ("singleton" = true)` — added to this same, not-yet-deployed migration file rather than as a second migration, since it had not been applied to any real environment yet. No `DROP`, no data migration, no backfill.
- **Additive/destructive:** purely additive.
- **Hand-authored, not machine-diffed verbatim** — `npx prisma migrate dev --create-only` against a fresh, empty disposable Postgres produced a diff containing this task's `CreateTable`/`CreateIndex` statements **plus a large amount of unrelated pre-existing schema drift** (index renames, `ALTER COLUMN ... SET DATA TYPE`, dropped/re-added foreign keys on `ImagingStudy`/`InventoryItem`/`InventoryTransaction`/`Patient`/`WhatsAppConversationMessage`, a `Clinic.status` default change) — the exact "never paste `migrate diff` output into a migration" trap this program has hit before. The generated migration file was discarded and replaced with a hand-authored `migration.sql` containing **only** the `PlatformWhatsAppConnection` `CREATE TABLE`/`CREATE INDEX` statements; every other statement from the machine diff was excluded.
- **Status:** `[TEST]` applied cleanly via `npx prisma migrate deploy` against a disposable Postgres 16 container seeded from empty, after all 82 pre-existing migrations were already applied — i.e. tested from both "empty production-like DB" (the container started empty) and "current schema → new schema upgrade" (the container was first brought to the current 82-migration schema, matching origin/main, before this one migration was applied). `npx prisma migrate status` reports `Database schema is up to date!` afterward.

## 5. Files changed

**Schema/migration:**
- `server/prisma/schema.prisma` — new `PlatformWhatsAppConnection` model (additive)
- `server/prisma/migrations/20260822140000_add_platform_whatsapp_connection/migration.sql` (new)

**Backend — reuse refactor (no behavior change for the tenant path):**
- `server/src/services/whatsapp/whatsappService.ts` — extracted `runConnectionTest`, `testResultToPersistData`, `runProviderDisconnect`, `isMetaManualConfigComplete`, `META_MANUAL_SETUP_ERROR` as new exports; `testWhatsAppConnection`/`disconnectWhatsAppConnection` now call the extracted functions instead of inlining the same logic — same net behavior, now shared.
- `server/src/routes/organizationWhatsApp.ts` — imports `isMetaManualConfigComplete`/`META_MANUAL_SETUP_ERROR` from `whatsappService.ts` instead of defining local copies; every call site and every response is unchanged.

**Backend — new:**
- `server/src/services/platformWhatsAppConnectionService.ts` (new)
- `server/src/routes/platformWhatsApp.ts` (new)
- `server/src/index.ts` — mounts `platformWhatsAppRoutes` at `/api/platform` (same pattern as `platformExternalCalendarRoutes`/`platformMigrationRoutes`)

**Backend — tests:**
- `server/src/tests/platformWhatsAppConnection.test.ts` (new, 28 tests)

**Frontend:**
- `src/pages/platform/PlatformWhatsApp.tsx` (new)
- `src/App.tsx` — new lazy route `/platform/whatsapp`
- `src/layouts/PlatformAdminLayout.tsx` — new nav item
- `src/services/api.ts` — one-line pointer comment (platform WhatsApp calls go through `usePlatformApi()` inline, matching `PlatformExternalCalendar.tsx`'s convention — no dedicated service object was added, since none of the sibling platform pages use one either)
- `src/locales/{en,tr,fr,de}/platform.json` — new `whatsapp` translation namespace + one new `nav.whatsapp` key each

## 6. Reuse / refactor — exact existing logic reused

- **Provider dispatch:** `platformWhatsAppConnectionService.ts`'s `testPlatformWhatsAppConnection`/`disconnectPlatformWhatsAppConnection` call the **exact same** `runConnectionTest`/`runProviderDisconnect` functions (`whatsappService.ts`) that the tenant path's `testWhatsAppConnection`/`disconnectWhatsAppConnection` call — same `getWhatsAppProvider('meta_cloud_api')` → `MetaCloudWhatsAppProvider` instance, same Graph API calls, same error handling. **[TEST]** proven: the disconnect/test tests stub `globalThis.fetch` exactly like `whatsappProvider.test.ts` does for the tenant path, and a static-source assertion confirms `platformWhatsAppConnectionService.ts` never references `whatsAppConnection.` (the tenant Prisma delegate) anywhere.
- **Manual-config completeness validation:** `isMetaManualConfigComplete`/`META_MANUAL_SETUP_ERROR`, now exported from `whatsappService.ts` and imported by both `organizationWhatsApp.ts` (tenant) and `platformWhatsAppConnectionService.ts` (platform) — one implementation, not two.
- **Secret encryption — not uniform across all four sensitive fields (corrected in review round 2, see §18):** `metaAccessTokenEncrypted` is encrypted with `encryptSecret`; `metaWebhookSecret` and `webhookSecret` are encrypted with `encryptSecretTagged` (`enc:v1:` prefix) — all three exactly as `utils/encryption.ts` is called by the tenant route's create/update handlers. `metaWebhookVerifyToken` is the exception: it is persisted as **plaintext**, using the exact same tenant-compatible convention `organizationWhatsApp.ts` already uses for this field (Meta's webhook-verification GET handshake compares it directly against the query-string value it receives, so the tenant path never encrypts it either — this task did not change that persistence convention). It is still never returned by any API response (`sanitizePlatformConnection` strips it) and the Platform Admin UI now treats it as a sensitive, replacement-only field (password-style input, blank-on-load, blank-after-save) even though its storage is plaintext.
- **Secret sanitization:** `sanitizePlatformConnection()` in `routes/platformWhatsApp.ts` strips the same four fields (`metaAccessTokenEncrypted`, `metaWebhookVerifyToken`, `metaWebhookSecret`, `webhookSecret`) that `organizationWhatsApp.ts`'s `sanitizeConnection()` strips.
- **Platform Admin routing convention:** `authenticatePlatformAdmin` + `csrfProtection('platform')` on `router.use(...)`, same as `platformExternalCalendar.ts`/`platformMigration.ts`/`platformSecurityIncidents.ts`.
- **Audit convention:** `writePlatformAdminAuditEventInTx`/`writePlatformAdminAuditEvent` from `services/platformAdminAudit.ts`, same action-naming style (`platform_whatsapp_connection.created/updated/tested/disconnected/deleted`), atomic with the mutation via `prisma.$transaction` for create/update/disconnect/delete (test is audited non-atomically, matching `organizationWhatsApp.ts`'s own POST `/test` route, which also calls `writeAuditLog` after `testWhatsAppConnection()` completes, not inside a shared transaction).
- **Frontend page shape:** `PlatformWhatsApp.tsx` follows `PlatformExternalCalendar.tsx`'s structure (`usePlatformApi()`, inline `api.get/post/put/delete` calls, status badge, secret-field "leave blank to keep unchanged" convention) — no shared component was extracted, since the two screens' data shapes (clinic-scoped list+detail vs. a bare singleton) differ enough that extraction would have been a bigger, riskier change than the task calls for.

### What was NOT duplicated

No second `testWhatsAppConnection`-equivalent, no second Meta Graph API client, no second encryption implementation, no second Zod validation rule, no second `sanitizeConnection`-equivalent field list authored independently — every one of those either imports the tenant module's export or is a narrowed copy of the same Zod shape (the Zod *schema object* itself has to be re-declared, since it is a different field subset — Evolution fields and `linkedClinicIds` are absent — but every constraint value (`max(80)`, `max(1000)`, etc.) is copied from `organizationWhatsApp.ts`'s schema, not reinvented).

## 7. Platform Admin UX

- New nav item **"Meta WhatsApp"** under Platform Admin, route `/platform/whatsapp`.
- Single-panel form (no clinic list — this is a singleton, not a per-clinic screen): Name, Phone Number, Display Name, Meta Business ID, WABA ID, Phone Number ID, Meta App ID, Webhook Verify Token, Access Token, Meta Webhook Secret, Shared Webhook Secret.
- **Not shown:** `linkedClinicIds`, clinic assignment, clinic legal-profile/service readiness, template-purpose readiness, Evolution QR controls, Embedded Signup — per the task's explicit exclusion list. This is a **manual-configuration-only** screen; the platform connection is NoraMedi's own App, not a customer's, so there is no Embedded Signup flow to reuse for it.
- Status badge (disconnected/connecting/connected/error), Test connection, Disconnect, Delete actions; the four sensitive fields (`metaAccessTokenEncrypted`, `metaWebhookSecret`, `webhookSecret`, and — since review round 2, see §18 — `metaWebhookVerifyToken`) are all rendered as password-style inputs, always redisplay blank (never pre-filled), and an update only rotates one when the operator actually types a new value — verified against a real bug this task caught and fixed in its own first draft (see §11), with a second, reviewer-caught gap in the same field closed in §18.

## 8. Tenant isolation

- `PlatformWhatsAppConnection` has no relation of any kind to `Organization`, `Clinic`, or `WhatsAppConnection`.
- `platformWhatsAppConnectionService.ts` only ever calls `prisma.platformWhatsAppConnection.*` — **[TEST]** enforced by a source-text assertion in the test suite (`the platform WhatsApp service never imports/queries prisma.whatsAppConnection`), not just a code-review claim.
- **[TEST]** `the tenant OWNER connection list never contains the platform connection` — drives the real tenant `GET /organization/whatsapp-connections` route handler with a real tenant fixture and a real platform connection both present; the platform connection's id never appears.
- **[TEST]** `GET /organization/whatsapp-connections/:id with the platform connection's id 404s` — the platform connection's id cannot be read through the tenant single-connection endpoint (org-scoped `findFirst` simply finds nothing).
- **[TEST]** `mutating the platform connection never touches the tenant WhatsAppConnection row` — a full update+audit cycle on the platform connection is followed by a byte-for-byte `assert.deepEqual` of the tenant row against its pre-mutation snapshot.
- **[REPO]** The global inbound Meta webhook resolver (`server/src/routes/metaWhatsAppWebhook.ts:247-248,340,402`) queries **only** `prisma.whatsAppConnection` (by `metaPhoneNumberId` + `provider: 'meta_cloud_api'` + `isActive: true`) — confirmed by direct grep before writing any code. This file was **not modified**. A `PlatformWhatsAppConnection` row — even one sharing the same `metaPhoneNumberId` value as some tenant row, which nothing prevents since the two tables have independent uniqueness domains — can never become a tenant inbox routing destination, because the resolver never reads this table. No STOP condition per the task's §8 was triggered.
- No `organizationId` nullability change; no fake/synthetic Organization or Clinic was created for this feature (the tenant fixtures in the test suite are real, disposable, cleaned-up rows used only to prove isolation from a real tenant, not a workaround for platform ownership).

## 9. Security / secrets / audit

- `metaAccessTokenEncrypted` is AES-256-GCM encrypted (`encryptSecret`) before persistence — **[TEST]** confirmed the stored value differs from the plaintext input and decrypts back to it.
- `metaWebhookSecret`/`webhookSecret` are tagged-encrypted (`encryptSecretTagged`, `enc:v1:` prefix) — **[TEST]** confirmed.
- `metaWebhookVerifyToken` is **not encrypted** — it is stored as plaintext, using the existing tenant-compatible persistence convention already used by `organizationWhatsApp.ts` for this exact field (see §6). This is a deliberate, pre-existing convention this task reused, not something introduced here, and this task did not change it. It is still never returned by any API response, and the Platform Admin UI now presents it as a sensitive, replacement-only input (password-style field, always blank on load and after save) — see §18.
- **[TEST]** every route response (`create`, `get`) was asserted to never contain the substring `"plaintext"` anywhere in its serialized JSON, and to have `metaAccessTokenEncrypted`/`metaWebhookSecret`/`webhookSecret`/`metaWebhookVerifyToken` all `undefined` (the last one because it is stripped from responses, not because it is encrypted).
- **[TEST]** every audit row's `safeMetadata` carries only field **names** (`{ fields: ['metaAccessTokenEncrypted'] }`), never values; the created-connection audit row's serialized form was asserted to never contain the substring `"plaintext"`.
- No secret value appears in any commit, test fixture, or this document — every test uses synthetic strings (`'plaintext-access-token'`, `'rotated-token'`, etc.), never a real Meta credential.
- Audited actions: `platform_whatsapp_connection.created`, `.updated`, `.tested` (both success and failure outcomes), `.disconnected`, `.deleted`.

## 10. Tests

Exact commands run in this session, all against a disposable local PostgreSQL 16 container (`docker run postgres:16-alpine`, port 55901 — no shared/production database was touched):

| Command | Result | Exit code |
|---|---|---|
| `cd server && npx prisma migrate deploy` | Applied `20260822140000_add_platform_whatsapp_connection` cleanly on top of the 82 pre-existing migrations | 0 |
| `cd server && npx prisma migrate status` | `Database schema is up to date!` | 0 |
| `cd server && npx prisma generate` | Generated Prisma Client v7.9.1 | 0 |
| `cd server && npx tsc --noEmit` (canonical: `npm run typecheck`) | No errors | 0 |
| `npx tsc -b` (root) | No errors | 0 |
| `cd server && npx tsx src/tests/platformWhatsAppConnection.test.ts` | 28 passed, 0 failed (round 1; **29/0 as of review round 3, §19**) | 0 |
| `cd server && npx tsx src/tests/whatsappProvider.test.ts` | 143 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/metaWhatsAppWebhook.test.ts` | 17 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdmin.test.ts` | 118 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminOwnerBootstrap.test.ts` | 29 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminSessionRevocation.test.ts` | 15 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminLoginTotpGate.test.ts` | 30 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/sessionCookieCsrf.test.ts` | 15 passed, 0 failed | 0 |

**Review round 2 (this follow-up), re-run against a fresh disposable PostgreSQL 16 container, port 55902 — see §18:**

| Command | Result | Exit code |
|---|---|---|
| `cd server && npx prisma migrate deploy` | Applied all 83 migrations (incl. `20260822140000_add_platform_whatsapp_connection`) cleanly from empty | 0 |
| `cd server && npx prisma migrate status` | `Database schema is up to date!` | 0 |
| `cd server && npm run test:messaging-connection-scope` | 33 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformWhatsAppConnection.test.ts` | 28 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/whatsappProvider.test.ts` | 143 passed, 0 failed (53 + 90, unchanged) | 0 |
| `cd server && npx tsx src/tests/metaWhatsAppWebhook.test.ts` | 17 passed, 0 failed | 0 |
| `cd server && npm run typecheck` | No errors | 0 |
| `npx tsc -b` (root) | No errors | 0 |

**Review round 3 (this follow-up), re-run against a fresh disposable PostgreSQL 16 container, port 55903 — see §19:**

| Command | Result | Exit code |
|---|---|---|
| `cd server && npx prisma migrate deploy` | Applied all 83 migrations (incl. the amended `20260822140000_add_platform_whatsapp_connection`, now including the `CHECK` constraint) cleanly from empty | 0 |
| `cd server && npx prisma migrate status` | `83 migrations found in prisma/migrations` · `Database schema is up to date!` | 0 |
| `docker exec ... psql ... \d "PlatformWhatsAppConnection"` (manual DB inspection, not an automated test) | Confirms `Check constraints: "PlatformWhatsAppConnection_singleton_true_check" CHECK (singleton = true)` live in the database, alongside the pre-existing `UNIQUE, btree (singleton)` index | n/a |
| `cd server && npx tsx src/tests/platformWhatsAppConnection.test.ts` | **29 passed, 0 failed** (28 in round 1 → 29: the single "raw insert" singleton test was split into three explicit A/B/C tests per §19, net +1) | 0 |
| `cd server && npm run test:messaging-connection-scope` | 33 passed, 0 failed (unchanged) | 0 |
| `cd server && npx tsx src/tests/whatsappProvider.test.ts` | 143 passed, 0 failed (53 + 90, unchanged) | 0 |
| `cd server && npx tsx src/tests/metaWhatsAppWebhook.test.ts` | 17 passed, 0 failed (unchanged) | 0 |
| `cd server && npm run typecheck` | No errors | 0 |
| `npx tsc -b` (root) | No errors | 0 |

No count is invented; every number above is copied from the actual run's summary line. The new test file's 28 cases (round 1; 29 as of round 3) cover, in two layers:

1. **Real HTTP server, real router** (proves the `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` gate on this specific router, which direct-chain invocation would bypass): unauthenticated → 401; a clinic-shaped/wrong-secret token → 401; a valid platform bearer token → 200; a cookie-session POST with no CSRF token → 403; the same request with a correct CSRF cookie+header → 201.
2. **Direct route-handler-chain invocation** (same technique as `platformAdminOwnerBootstrap.test.ts`): Meta manual-config validation, Zod validation, create/secret-encryption/audit, singleton enforcement (both the service pre-check and the raw DB-level unique-constraint race), update leave-unchanged/rotate semantics, re-validation on update, test-connection success/failure paths (provider fetch stubbed, matching `whatsappProvider.test.ts`'s convention), the four tenant-isolation checks in §8, disconnect, delete, and 404s for every operation against a nonexistent connection.

## 11. A real bug this task caught in its own first draft

While writing `PlatformWhatsApp.tsx`, the first draft unconditionally included `metaWebhookVerifyToken: form.metaWebhookVerifyToken` in every save payload. Because `GET` never returns this field back (it is stripped by `sanitizePlatformConnection`, per §6/§9), the form always redisplays it as `''` after a reload — so every subsequent save, even one only changing the display name, would have silently blanked out a previously configured verify token. Cross-checking the tenant screen's `handleSave` (`src/pages/WhatsAppConnections.tsx:406-408`) showed it gates this exact field (`if (form.metaWebhookVerifyToken) payload.metaWebhookVerifyToken = ...`) alongside the other three secret-like fields — the platform screen was updated to match before this was ever shipped, not discovered later. No test in the new backend suite would have caught this (it is a frontend-only defect); it was caught by re-reading the tenant page's reuse contract, which is exactly why this task's §4 instruction to reuse the existing implementation rather than reinvent it matters in practice, not just in principle.

## 12. Backward compatibility

Additive only. `WhatsAppConnection`, `ClinicWhatsAppConnection`, `organizationWhatsApp.ts`'s routes and responses, `WhatsAppConnections.tsx`, `metaWhatsAppWebhook.ts`, and every existing migration are unchanged in behavior. The two `whatsappService.ts`/`organizationWhatsApp.ts` edits are pure extract-and-import refactors with no observable behavior change — proven by the unchanged pass count of `whatsappProvider.test.ts` (143/143) and `metaWhatsAppWebhook.test.ts` (17/17), which exercise the tenant path's `testWhatsAppConnection`/`disconnectWhatsAppConnection`/`isMetaManualConfigComplete` call sites.

## 13. Rollback

Migration is additive. Emergency rollback is: revert the application code to the previous release, reload the previous API/worker, restore the previous frontend bundle. **Do not drop `PlatformWhatsAppConnection`** as part of that rollback — it is not referenced by any other table and no pre-existing code path queries it, so leaving it in place is always safe; it simply becomes unused until the feature is redeployed. Physical `DROP TABLE` is only a later, separately-controlled contract cleanup if the feature is ever retired outright.

## 14. Deployment order (for the next, separately authorized task — NOT performed here)

1. Pull the exact approved release commit on VPS1 (`/var/www/noramedi`).
2. `cd server && npx prisma migrate deploy` — applies `20260822140000_add_platform_whatsapp_connection` only (all prior migrations are already applied in production).
3. `npx prisma migrate status` — confirm `Database schema is up to date!` before proceeding.
4. `npx prisma generate`.
5. Backend typecheck/build (`npm run typecheck`, then the repository's normal build step).
6. Frontend typecheck/build (`npx tsc -b`, then the normal Vite build).
7. `pm2 startOrReload` for `noramedi-api` / `noramedi-worker` (NoraMedi PM2 process names — not the legacy `disklinikcrm` names).
8. Promote the new frontend bundle.
9. Verify the release SHA actually running matches the deployed commit.
10. Platform Admin functional smoke: log in, open **Platform Admin → Meta WhatsApp**, confirm the page loads with `connection: null`, create a connection with real (or a controlled test) Meta credentials, confirm Test Connection reports success, confirm Disconnect/Delete work.
11. Tenant WhatsApp regression smoke: open an existing clinic's **Organization → WhatsApp** screen, confirm its connections list, create/edit/test/disconnect flows are all unaffected.
12. Provider connection test: run the Platform Admin "Test connection" action against the real, newly configured Meta Cloud API credentials and confirm a real, non-stubbed success response.

## 15. Rollback (deployment-time restatement of §13)

Additive migration; application rollback never requires dropping `PlatformWhatsAppConnection`. Revert to the previous release, reload PM2, restore the previous frontend bundle, re-verify tenant WhatsApp still works (step 11 above) — the platform table sits inert and unreferenced by any other code path in the reverted version.

## 16. Risks / blockers

- **No production Meta App/credentials were used or created by this task** — the "Provider connection test" step above (§14.12) can only be performed once real credentials for NoraMedi's own Meta Business/App are available; this task's own automated tests stub the provider's HTTP call, exactly like the pre-existing `whatsappProvider.test.ts` suite does for the tenant path.
- **Unrelated dependency-supply-chain observation (not part of this task's scope, flagged for awareness):** running `node -e "require('dotenv').config()"` in this worktree printed a "tip" line referencing `vestauth.com` / "auth for agents" — not a domain associated with any known `dotenv` promotional-tip feature. This was **not investigated further, not visited, and not acted upon** in this session; it is recorded here only so the program owner can independently check the pinned `dotenv` version/lockfile for tampering. No code in this task depends on that message, and no URL from it was fetched.

## 17. Exact next task

Program owner: (a) obtains/provisions NoraMedi's own Meta Business/App/WABA credentials, (b) reviews and merges this draft PR, (c) follows the deployment order in §14 in a controlled release, (d) performs the real (non-stubbed) provider connection test in §14.12, (e) updates this evidence document's lifecycle fields to reflect `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` once each is actually true — none of those are true as of this document.

## 18. Review round 2 — fixes applied to the same PR (no redesign, no new migration)

A code review of the original implementation found two remaining gaps, both confined to `src/pages/platform/PlatformWhatsApp.tsx` (no backend, schema, or migration change):

1. **`metaWebhookVerifyToken` was not cleared from local form state after a successful save.** The other three sensitive fields (`metaAccessTokenEncrypted`, `metaWebhookSecret`, `webhookSecret`) were reset to `''` in the post-save `setForm` call; `metaWebhookVerifyToken` was left out of that reset. **Fixed:** it is now cleared alongside the other three. The "leave blank = unchanged" semantics were not affected by this bug (the save payload already only included the field when non-empty) — the bug was purely that a just-typed value stayed visible in the input after a successful save, when it should have gone blank like every other secret-like field.
2. **`metaWebhookVerifyToken` was rendered as a plain-text (`type="text"`) input, and had no "leave blank unchanged" hint.** **Fixed:** it is now `type="password"`, shows the same `(leave blank to keep unchanged)` hint and `configuredPlaceholder` text as the other three sensitive fields once a connection exists, and — per fix (1) — starts and ends every save cycle blank, exactly like the other three.

This is a **UI-only, replacement-only-input treatment** of the field, not a change to how it is persisted: as documented in §6/§9, `metaWebhookVerifyToken` remains **plaintext** in the database, unchanged from the existing tenant-compatible convention `organizationWhatsApp.ts` already used before this task existed. No migration, no encryption, no persistence-layer change was made or is needed for this fix; the field was already excluded from every API response before this round (`sanitizePlatformConnection` already stripped it) and the manual-config completeness check (`isMetaManualConfigComplete`) was already unaffected by it either way.

**Evidence-accuracy correction (this round):** the original §6/§9 wording described the encryption treatment of all four sensitive fields together without calling out that `metaWebhookVerifyToken` is the one exception that is not encrypted. §6 and §9 above have been corrected in place to state explicitly, per field: `metaAccessTokenEncrypted` → `encryptSecret`; `metaWebhookSecret`/`webhookSecret` → `encryptSecretTagged`; `metaWebhookVerifyToken` → existing tenant-compatible plaintext convention, never returned by the API, now UI-treated as sensitive/replacement-only. This correction does not change any code behavior — only the accuracy of this document.

**Additional regression run (this round):** `organizationWhatsApp.ts` was modified by the original task's shared-helper extraction (§6), so `npm run test:messaging-connection-scope` — the tenant-isolation/role-scoping suite that exercises that exact route file — was re-run this round: **33 passed, 0 failed**, exit code 0 (see the updated table in §10). No regression.

**Frontend test runner check (this round):** the repository has a frontend test runner (`npm run test:vitest` → `vitest run`), and sibling Platform Admin pages have dedicated suites (e.g. `src/pages/platform/__tests__/PlatformBackups.recovery.vitest.test.tsx`, `PlatformMigration.resume.vitest.test.tsx`). **No such test file exists for `PlatformWhatsApp.tsx`** (`src/pages/platform/__tests__/` contains no matching file, and no `*whatsapp*.test.*` file exists anywhere under `src/`). Stated explicitly, as required: there is nothing to run for this component's frontend behavior in this round, because no test for it exists — this task did not author one, since it was not asked to.

**New HEAD SHA after this round:** see the top of this document / PR #487 — updated to the commit that includes this round's `PlatformWhatsApp.tsx` fix and this document's corrections.

**Lifecycle after this round (unchanged from §16/original report):** `AGENT_COMPLETED=YES · TESTS_PASSED=YES · PR_OPENED=YES · MERGED=NO · MIGRATION_DEPLOYED=NO · APPLICATION_DEPLOYED=NO · PRODUCTION_VERIFIED=NO`. **DO NOT MERGE. DO NOT DEPLOY.**

## 19. Review round 3 — singleton invariant blocker fixed (same PR, same migration, no redesign)

A follow-up review found that the singleton claim in §2/§8/§9 (and in the schema doc-comment) was **not literally true as stated**. The design was:

```
singleton Boolean @default(true) @unique
```

A `UNIQUE` index on a boolean column forbids two rows sharing the *same* value — it permits one `TRUE` row **and** one `FALSE` row simultaneously, since `TRUE` and `FALSE` are two distinct non-`NULL` values and a unique constraint only dedupes equal values against each other. So the schema as originally written did **not**, by itself, guarantee at most one row could ever exist — a second row with `singleton = false` would have been perfectly legal at the database level. This was a correctness gap in the claim, not (yet) an exploited bug, and the finding is accepted as-is; no counter-argument is offered.

**Fix — amended the existing, not-yet-deployed migration, no new migration file:**

`server/prisma/migrations/20260822140000_add_platform_whatsapp_connection/migration.sql` now additionally contains:

```sql
ALTER TABLE "PlatformWhatsAppConnection"
ADD CONSTRAINT "PlatformWhatsAppConnection_singleton_true_check"
CHECK ("singleton" = true);
```

This is safe to do in place because this migration **had not been deployed to production** (per §16/§17, `MIGRATION_DEPLOYED = NO` throughout this task's history) — amending it rather than adding a second migration avoids two migrations that together do what one should have done from the start, and there is no environment anywhere that has the old (incomplete) version of this migration applied that this change could conflict with.

The Prisma schema model (`schema.prisma`) is **unchanged in its field/column list** — `singleton Boolean @default(true) @unique` still stands, because this generator block has no `@@check`/check-constraint preview feature enabled and adding one would be a broader, unrequested change. Instead, the model's doc-comment and a comment directly on the `singleton` field were corrected to state the invariant precisely: `@unique` alone is *not* the guarantee; `CHECK(singleton = true)` (hand-added in migration SQL, not expressible in this schema) **combined with** `UNIQUE(singleton)` together are.

**Corrected invariant, stated exactly (do not cite the old wording):**

> At most one `PlatformWhatsAppConnection` row can ever exist because (a) `CHECK(singleton = true)` makes a `FALSE` row impossible at the database level, and (b) `UNIQUE(singleton)` then makes a second `TRUE` row impossible. Neither constraint alone is sufficient; both together are.

**[TEST] Three explicit DB-level tests added to `platformWhatsAppConnection.test.ts`** (`Singleton enforcement` section), each targeting one part of the corrected claim:

- **A.** the first, default/`TRUE` row succeeds (baseline, re-asserted explicitly rather than only implied by an earlier create).
- **B.** a second `TRUE`/default row fails — both through the route (409, service-layer pre-check) and through a raw `prisma.platformWhatsAppConnection.create()` call that bypasses `platformWhatsAppConnectionService.ts` entirely, throwing `Unique constraint failed` — proving the `UNIQUE` half.
- **C.** a raw SQL `INSERT INTO "PlatformWhatsAppConnection" (... singleton ...) VALUES (..., false, ...)` via `prisma.$executeRawUnsafe` — bypassing **both** the service layer and the Prisma Client's query builder, i.e. a literal SQL statement exactly like an attacker or a future buggy script could run directly — is rejected with a Postgres check-constraint violation (`PlatformWhatsAppConnection_singleton_true_check`). This proves the `CHECK` half on its own: a `FALSE` row does not collide with the `UNIQUE` index at all, so only the `CHECK` constraint can be stopping it, which is exactly what this test isolates.

**Migration re-validation (fresh disposable PostgreSQL 16, port 55903, empty → current):**

- `npx prisma migrate deploy` — all **83** migrations applied cleanly, including the amended `20260822140000_add_platform_whatsapp_connection` with its new `CHECK` constraint.
- `npx prisma migrate status` — `83 migrations found in prisma/migrations`, `Database schema is up to date!`.
- Manual `psql \d "PlatformWhatsAppConnection"` confirms, verbatim: `Check constraints: "PlatformWhatsAppConnection_singleton_true_check" CHECK (singleton = true)`, alongside the pre-existing `UNIQUE, btree (singleton)` index — both present simultaneously in the live schema, as designed.

**Full re-run results:** see the "Review round 3" table in §10 — `platformWhatsAppConnection.test.ts` **29/29** (28 → 29: the old single combined singleton test was split into the three A/B/C tests above, net +1 test), `test:messaging-connection-scope` 33/33, `whatsappProvider.test.ts` 143/143, `metaWhatsAppWebhook.test.ts` 17/17, `server` `npm run typecheck` and root `npx tsc -b` both exit 0. All against a fresh, disposable, then-destroyed Postgres container — no shared/production database touched.

**Not changed in this round:** provider architecture, encryption treatment of any field (§18's `metaWebhookVerifyToken` correction stands unchanged), the frontend, the route file, the audit convention, tenant isolation, or any other migration. This round is confined to the `singleton` invariant's SQL and the tests/docs proving it.

**New HEAD SHA after this round:** see the top of this document / PR #487.

**Lifecycle after this round:** `AGENT_COMPLETED=YES · TESTS_PASSED=YES · PR_OPENED=YES · MERGED=NO · MIGRATION_DEPLOYED=NO · APPLICATION_DEPLOYED=NO · PRODUCTION_VERIFIED=NO`. **DO NOT MERGE. DO NOT DEPLOY.**

## 20. CI failure fixed (Layer 2: non-disposable backend tests) — same PR, no redesign

After round 3 was pushed, GitHub Actions' `ci-layers / Layer 2: non-disposable backend tests` job failed. Root cause: `PlatformWhatsAppConnection` (added in round 1) was never registered in `server/src/utils/tenantModelClassification.ts` — a repo-wide schema/registry drift guard (`tenantModelClassification.test.ts`) that fails closed whenever a Prisma model exists with no explicit tenant-ownership classification, specifically so a new model can never become "effectively unprotected just because it has no `clinicId` column" by omission. This guard is unrelated to, and predates, this task; it was simply never satisfied for the new model.

**Fix:** added one registry entry for `PlatformWhatsAppConnection`, classified `PLATFORM_GLOBAL` (no `organizationId`/`clinicId`, `guardMode: 'NO_TENANT_FILTER'`, `rls: 'NOT_APPLICABLE'`), positioned immediately after `ClinicWhatsAppConnection`'s entry to match the model's declaration position in `schema.prisma` (the guard also checks registry order mirrors schema order). Its `rationale` field cites the singleton invariant from §19, the platform-admin-only mutation surface, and that the tenant inbound webhook resolver never reads this table (§8).

**[TEST]** `npx tsx src/tests/tenantModelClassification.test.ts` — was 23 passed/5 failed before this fix (the 5 failures: missing classification entry, registry-count mismatch 116≠117, registry-order check, an "unprotected by omission" check, and a per-class-count-sum check — all five were the same single root cause manifesting in five separate assertions, not five independent defects); now **28 passed, 0 failed**, `TOTAL` climbs from 116 to 117 and the summary reports `PLATFORM_GLOBAL: 7` (was 6).

**Confirmed no other suite was affected by the same gap:** `test:tenant-context` (29/29), `test:tenant-guard-unit` (73/73), `test:raw-sql-tenant-audit` (12/12), `test:tenant-system-context-inventory` (16/16), `test:outbox-contracts` (53/53), `test:messaging-reliability` (49/49) — all re-run locally, all green, all unaffected (they don't consume this registry the same way). `server` `npm run typecheck` and root `npx tsc -b` both re-run, both exit 0.

**Not changed:** schema, migration, routes, service, frontend, or any other file — this is purely a missing registry entry for an unrelated, pre-existing repo-wide guard that every new Prisma model must satisfy.

**New HEAD SHA after this fix:** `8369d2cf65e660a1f3b5c225000e362add643b0a`.

**GitHub Actions confirmed green on this HEAD** (run [32587051864](https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/32587051864), all 13 checks, including the overall `PR Gate`): Changed-path classification, Layer 1 (architecture guardrail, frontend typecheck+build, log privacy guard, server typecheck, test-runtime tooling, workflow/shell/PowerShell/JSON validation), **Layer 2: non-disposable backend tests (now passing — was the failure this section fixes)**, Layer 3: disposable PostgreSQL tests, Layer 4: disposable PostgreSQL + MinIO storage integration tests, Layer 5 (backend full-suite fail-safe, frontend full-suite fail-safe) — all `pass`.

**Lifecycle after this fix:** `AGENT_COMPLETED=YES · TESTS_PASSED=YES · PR_OPENED=YES · MERGED=NO · MIGRATION_DEPLOYED=NO · APPLICATION_DEPLOYED=NO · PRODUCTION_VERIFIED=NO`. **DO NOT MERGE. DO NOT DEPLOY.**

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
- A `singleton Boolean @default(true) @unique` column: a **DB-level**, not just application-level, guarantee that at most one row can ever exist (a second row's `singleton = true` violates the unique index even under a concurrent create race). **[TEST]** proven directly: a raw second `prisma.platformWhatsAppConnection.create()` bypassing the service layer's pre-check throws `Unique constraint failed`.
- `metaPhoneNumberId String? @unique` and `@@index([provider])`, mirroring the tenant table's own invariants.

## 3. Current → target data ownership

| | Before (002A) | After (002B) |
|---|---|---|
| Platform-owned Meta connection storage | None — did not exist | `PlatformWhatsAppConnection`, exactly one row, no tenant owner |
| Tenant Meta/Evolution connections | `WhatsAppConnection`, `organizationId`-scoped | **Unchanged** — same table, same columns, same routes, same behavior |
| Ownership model | N/A | Platform-owned: no `organizationId`, no `Organization`/`Clinic` relation of any kind |

## 4. Migration

- **Name:** `20260822140000_add_platform_whatsapp_connection`
- **SQL summary:** one `CREATE TABLE "PlatformWhatsAppConnection"` and three `CREATE INDEX`/`CREATE UNIQUE INDEX` statements. No `ALTER TABLE`, no `DROP`, no data migration, no backfill.
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
- **Secret encryption:** `encryptSecret`/`encryptSecretTagged` from `utils/encryption.ts`, unchanged, called identically to the tenant route's create/update handlers.
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
- Status badge (disconnected/connecting/connected/error), Test connection, Disconnect, Delete actions; secret fields always redisplay blank (never pre-filled) and an update only rotates a secret when the operator actually types a new value — verified against a real bug this task caught and fixed in its own first draft (see §11).

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
- **[TEST]** every route response (`create`, `get`) was asserted to never contain the substring `"plaintext"` anywhere in its serialized JSON, and to have `metaAccessTokenEncrypted`/`metaWebhookSecret`/`webhookSecret`/`metaWebhookVerifyToken` all `undefined`.
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
| `cd server && npx tsx src/tests/platformWhatsAppConnection.test.ts` | **28 passed, 0 failed** | 0 |
| `cd server && npx tsx src/tests/whatsappProvider.test.ts` | 143 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/metaWhatsAppWebhook.test.ts` | 17 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdmin.test.ts` | 118 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminOwnerBootstrap.test.ts` | 29 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminSessionRevocation.test.ts` | 15 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/platformAdminLoginTotpGate.test.ts` | 30 passed, 0 failed | 0 |
| `cd server && npx tsx src/tests/sessionCookieCsrf.test.ts` | 15 passed, 0 failed | 0 |

No count is invented; every number above is copied from the actual run's summary line. The new test file's 28 cases cover, in two layers:

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

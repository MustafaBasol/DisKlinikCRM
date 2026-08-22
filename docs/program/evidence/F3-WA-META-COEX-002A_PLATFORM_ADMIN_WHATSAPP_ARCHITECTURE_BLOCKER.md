# F3-WA-META-COEX-002A — Move/Reuse Existing Meta WhatsApp Connection Into Platform Admin

Task ID (ClickUp): `86eyq2rx6` · Parent Epic: F3-WA-META-COEX (`86eykhg28`) · Phase: F3 — Production Hardening

**Outcome: STOP / ARCHITECTURE BLOCKER REPORTED — no code, schema, route, or migration changed.** Per the task's own explicit decision rule ("If the current persistence model HARD-REQUIRES an organization/clinic owner and there is genuinely no safe existing platform-level ownership mechanism: STOP. Do NOT invent a schema migration. Do NOT create a fake tenant. Report the exact blocker and the minimum architecture change required. Default expectation: NO MIGRATION."), this task traced the existing clinic-side Meta WhatsApp connection capability end to end, confirmed it is fully reusable at the application/service layer, and confirmed its persistence layer cannot be reused for a platform-owned connection without either a schema change or a fake/synthetic tenant — both of which the task forbids without separate approval. This document is the required report; no Platform Admin route, page, or migration was implemented.

This document uses the same evidence tags as the predecessor task's evidence file:

- **[REPO]** — directly observed from repository source (`Read`/`Grep`/CodeGraph against tracked files) in this session
- **[UNVERIFIED]** — not confirmed in this session

There are no assumed facts in the decision below; every claim is sourced to an exact file/line.

---

## 1. Baseline

| Field | Value |
|---|---|
| `origin/main` SHA at branch cut | `31eb79f0d2a68445ccd835943d0d67600710f08c` (PR #482's merge commit) |
| Worktree | `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f3-wa-meta-coex-002a-platform-admin-whatsapp` |
| Branch | `feature/f3-wa-meta-coex-002a-platform-admin-whatsapp` |
| Working tree at session start | Clean fast-forward of `origin/main`, no drift |

## 2. Current clinic-side implementation (traced, not redesigned)

**[REPO]** Frontend: `src/pages/WhatsAppConnections.tsx` — full CRUD screen (`WhatsAppConnections` component, lines 263–end). Fields covered by the create/edit form (`ConnectionFormData`, `handleSave` at line 380): `name`, `provider` (`evolution_api` | `meta_cloud_api`), `phoneNumber`, `displayName`, `metaBusinessId`, `metaWabaId`, `metaPhoneNumberId`, `metaAppId`, `metaAccessTokenEncrypted`, `metaWebhookVerifyToken`, `metaWebhookSecret`, `webhookSecret`, plus tenant-specific `linkedClinicIds`. Actions: create/update (`handleSave`), test (`handleTest` → `/test`), get QR (`handleGetQr`, Evolution-only), disconnect (`handleDisconnect`), toggle active/inactive (`handleToggleActive`), hard delete with message-history guard (`handleConfirmDelete`), legacy-env import (`handleImportLegacy`), and Meta Embedded Signup popup OAuth flow (`handleMetaEmbeddedSignup`, line 532) which posts to a dedicated callback route.

**[REPO]** API service: `src/services/api.ts:728-744`, `whatsappConnectionService` — `list`, `get`, `create`, `update`, `test`, `getReadiness`, `getQr`, `disconnect`, `setStatus`, `deleteConnection`, `importLegacy`, `metaCallback`. All target `/organization/whatsapp-connections...`.

**[REPO]** Backend route: `server/src/routes/organizationWhatsApp.ts` (1298 lines). Every state-changing route uses `authorize(['OWNER','ORG_ADMIN'])` (or `+CLINIC_MANAGER` for read/test) plus a second in-handler permission check (`canManageWhatsAppConnections` / `canViewWhatsAppStatus` from `server/src/utils/roles.js`), and every query is scoped `where: { ..., organizationId }` from `req.user!.organizationId`. Validation: `connectionCreateSchema` / `connectionUpdateSchema` (Zod, lines 68–95) plus a manual-setup completeness guard `isMetaManualConfigComplete` (lines 106–112) that requires `metaPhoneNumberId` + an access token before a Meta manual connection can be saved. Secrets are encrypted before persistence with `encryptSecret` (access tokens, Evolution API key) and `encryptSecretTagged` (`metaWebhookSecret`, `webhookSecret`) from `server/src/utils/encryption.ts`, and are stripped from every response via `sanitizeConnection` (lines 54–64) — never returned to the client, never pre-filled on edit (frontend `openEdit`, `WhatsAppConnections.tsx:354-378`, explicitly blanks all four secret fields).

**[REPO]** Underlying service/provider: `server/src/services/whatsapp/whatsappService.ts` (`testWhatsAppConnection`, `getWhatsAppQrCode`, `disconnectWhatsAppConnection`) resolves a `WhatsAppConnectionRecord` **by `id` only** (`prisma.whatsAppConnection.findFirst({ where: { id: connectionId } })`, no `organizationId` filter inside the service itself — org scoping happens one layer up, in the route, before the service is called) and dispatches to `getWhatsAppProvider(record.provider)` (`server/src/services/whatsapp/whatsappProviderFactory.ts`), which returns `MetaCloudWhatsAppProvider` or `EvolutionWhatsAppProvider` implementing the shared `WhatsAppProvider` interface (`server/src/services/whatsapp/WhatsAppProvider.ts`). **This provider layer is genuinely organization-agnostic in behavior** — it only reads fields off the `WhatsAppConnectionRecord` object handed to it (Meta App ID, phone number ID, access token, etc.) and never queries `organizationId` itself.

**[REPO]** Persistence model: `server/prisma/schema.prisma:1873-1928`, `model WhatsAppConnection`. Relevant fields: `organizationId String` (required, not `String?`) with `organization Organization @relation(fields: [organizationId], references: [id])` (required relation, not optional) — see exact excerpt in §3. All the Meta/Evolution/webhook-secret fields listed in the task brief exist exactly as described; nothing is missing, nothing extra was found beyond what the clinic screen already exposes.

## 3. The exact model constraint (why platform scope cannot reuse this table as-is)

**[REPO]** `server/prisma/schema.prisma:1873-1876`:

```prisma
model WhatsAppConnection {
  id             String       @id @default(uuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  ...
```

`organizationId` is a **mandatory, non-nullable, FK-constrained column**, both at the Prisma schema level and (per Prisma's generated migration convention used throughout this schema) at the underlying Postgres `NOT NULL` + foreign-key level. Every read/write path this task traced enforces the same assumption downstream:

- `organizationWhatsApp.ts` — every route requires `req.user!.organizationId` and filters every query by it (12 distinct call sites).
- `whatsappService.ts:32-45` (`buildLegacyConnectionRecord`) — even the *legacy env-var fallback* record sets `organizationId: ''`, i.e. the codebase has no existing convention for a real, non-empty "no organization" sentinel value; empty string is a throwaway in-memory placeholder, never persisted.
- `WhatsAppProvider.ts:44-65` (`WhatsAppConnectionRecord` type) — `organizationId: string` is a required field on the shared TypeScript contract the providers accept, mirroring the DB constraint (this one is a type-level, not DB-level, constraint, and would not by itself force a migration — but it is further evidence the whole stack was designed assuming a real owning organization always exists).

**[REPO]** There is **no existing "platform-owned" organization, reserved organization id, or nullable-ownership convention** for this table. Confirmed by direct inspection, not inference:
- `Organization` (`schema.prisma:1780-1799`) models real customer tenants only (`slug`, `status: trial|active|suspended|cancelled`, `planId`, `trialEndsAt`) — there is no `status` value or flag for an internal/platform-owned row.
- `PlatformAdmin` (`schema.prisma:1728-1743`) has no relation to `Organization` at all.
- A repository-wide search for a reserved/internal-organization pattern (`PLATFORM_ORG`, `platformOrganizationId`, seeded internal org, etc.) found no matches.

## 4. This is a known, already-resolved architectural pattern in this codebase — cited, not invented

**[REPO]** This exact dilemma — a widely-depended-on, organization-scoped table vs. a Platform-Admin-originated record with no natural single organization — has already been hit and resolved once in this schema, and the resolution is documented in the schema comments themselves. `server/prisma/schema.prisma:3443-3455`, the doc-comment immediately above `model SecuritySignalEvent`:

> "Deliberately NOT layered onto the existing `OperationalEvent` model: `OperationalEvent.organizationId` is a required (non-nullable) column depended on by 8+ existing org-scoped call sites ... but some security signals (a Platform Admin login failure, a cross-tenant probe with no resolvable target org) have no natural single `organizationId` — forcing them through `OperationalEvent` would mean either a risky nullability change to a widely-depended-on column or a fake placeholder org id, **both worse than a dedicated table**."

`WhatsAppConnection.organizationId` is in the same situation as `OperationalEvent.organizationId` was: required, non-nullable, depended on by 12+ call sites in `organizationWhatsApp.ts` alone (plus `whatsappService.ts`, `whatsappOutboundMessaging.ts`, and the Meta/Evolution provider factory). The codebase's own established answer to "required-owner column + no natural owner" is **a small dedicated table**, not a nullability change to the shared one and not a placeholder organization — i.e. exactly the two options this task's own instructions independently forbid (Section 4/13: no fake tenant, no migration without approval). Both the task's own rule and this repository's own prior precedent point the same direction: this needs an explicit, approved schema decision before any code is written, not a workaround improvised inside this task.

**[REPO]** One superficially-tempting non-migration workaround was evaluated and rejected: storing a platform-level Meta connection's fields (including the encrypted access token) inside the existing generic `PlatformSetting` key/value table (`schema.prisma:2279-2285`, no schema change needed) and hand-building a `WhatsAppConnectionRecord` object to pass directly to `MetaCloudWhatsAppProvider`, bypassing `whatsappService.ts`'s `prisma.whatsAppConnection.findFirst`. This was rejected because it would require **re-implementing** `testWhatsAppConnection`/`getWhatsAppQrCode`/`disconnectWhatsAppConnection` (they are hardwired to query the `WhatsAppConnection` table by id) and the create/update validation/encryption flow from `organizationWhatsApp.ts` a second time against a different storage shape — i.e. exactly "fork two separate implementations that will drift" and "a second secret storage mechanism," both explicitly disallowed by this task's Section 4 and Section 8. It would satisfy "no migration" but violate "reuse, don't duplicate," which the task weights at least as heavily.

## 5. Decision

**STOP, per this task's own Section 4/13 instruction.** No Platform Admin WhatsApp route, page, or navigation item was added. No schema migration was written or applied. No fake/synthetic organization, clinic, or tenant owner was created.

### Minimum proposed architecture change (not implemented — requires separate approval)

Following the repository's own `SecuritySignalEvent` precedent (§4 above), the minimum change is a **new, small, dedicated Prisma model** — e.g. `PlatformWhatsAppConnection` — that:

- Mirrors only the fields the Meta Cloud API path actually uses today (`name`, `provider` fixed to `'meta_cloud_api'`, `phoneNumber`, `displayName`, `metaBusinessId`, `metaWabaId`, `metaPhoneNumberId`, `metaAppId`, `metaAccessTokenEncrypted`, `metaWebhookVerifyToken`, `metaWebhookSecret`, `webhookSecret`, `status`, `metaTokenStatus`/`metaTokenExpiresAt`/`metaTokenLastCheckedAt`, `lastConnectedAt`, `lastError`, `isActive`, timestamps) — no `organizationId`, no `ClinicWhatsAppConnection`-style linking table, because a platform-owned connection is not tenant-scoped by definition.
- Reuses the existing `MetaCloudWhatsAppProvider`, `WhatsAppProvider` interface, `connectionCreateSchema`'s Meta-field subset (or a narrowed copy of just those fields), `encryptSecret`/`encryptSecretTagged`, and `sanitizeConnection`'s field-stripping list unchanged — the new table changes *where* the row lives, not how it is validated, encrypted, tested, or serialized.
- Gets its own thin `testWhatsAppConnection`-equivalent/`disconnect`-equivalent wrapper (a few lines each, calling the same provider methods) since the existing `whatsappService.ts` functions are hardwired to `prisma.whatsAppConnection`, not because the provider logic itself needs duplicating.
- Backing routes under `authenticatePlatformAdmin` + `csrfProtection('platform')` (the established Platform Admin convention, confirmed in `server/src/routes/platformAdmin.ts:11-12,151,159`), fully separate from — and not weakening — the existing tenant route's `authorize(['OWNER','ORG_ADMIN', ...])`.

**Backward compatibility:** additive only — a new table, new routes, new nav item. Zero changes to `WhatsAppConnection`, `ClinicWhatsAppConnection`, `organizationWhatsApp.ts`, or `WhatsAppConnections.tsx`; the existing clinic screen and its 12+ routes are untouched by this proposal.

**Migration impact:** one new `CREATE TABLE` migration, no `ALTER` of any existing table, no data migration, no backfill.

**Rollback:** drop the new table and its routes/nav entry; nothing else references it (it is not linked to from any existing table by design).

This is a proposal for the next, separately-authorized task — it was **not implemented** here.

## 6. What was explicitly NOT done in this task (per Section 15 / the STOP rule)

No Prisma schema edit. No migration file. No new Platform Admin route file or route added to `platformAdmin.ts`. No new frontend page or `PlatformAdminLayout.tsx` nav item. No fake clinic, fake organization, fake OWNER user, or synthetic `linkedClinicIds`. No change to `organizationWhatsApp.ts`, `whatsappService.ts`, `WhatsAppProvider.ts`, `MetaCloudWhatsAppProvider.ts`, `EvolutionWhatsAppProvider.ts`, or `WhatsAppConnections.tsx`. No test added (nothing new to test). `server` `npm run typecheck` and root `npx tsc -b` were run against the untouched worktree only to confirm the baseline this report is based on is green — see §7.

## 7. Baseline validation (no code changed; confirms the trace above, not a new feature)

See PR/report §13 for exact commands, PASS/FAIL, and exit codes.

## 8. Exact next task

Program owner decides between: (a) approve the minimum schema change in §5 as a new, separately-scoped task (e.g. `F3-WA-META-COEX-002B`), or (b) redefine the goal so Platform Admin manages an *existing customer organization's* connection (selecting a real `Organization` row, with `authenticatePlatformAdmin` replacing tenant auth for that one screen) instead of a connection owned by the platform itself — which would need **no schema change at all**, since `organizationId` would then be a real, already-existing id. Option (b) is a materially different product decision (Platform Admin manages a *customer's* Meta number, not NoraMedi's own) and is called out here only as an alternative interpretation worth an explicit choice, not a recommendation — the task brief's Section 4 language ("must not pretend the NoraMedi platform itself is a customer clinic") reads as intending the platform's own connection, which is why this report treats (a) as the default next step.

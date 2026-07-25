# KVKK H-2 — Cross-Branch Messaging Connection Authorization: Independent Validation

Status: **Evidence / characterization only.** No code, tests, schema, or trackers were modified. This document does not close, does not reopen, and does not itself reclassify any tracker entry — it supplies evidence for a later reconciliation step.

## 1. Task and scope

Validate whether H-2 ("same-organization, cross-branch WhatsApp/Instagram connection authorization gap — `CLINIC_MANAGER` not checked against `allowedClinicIds`") describes a real, currently reachable authorization gap in the WhatsApp/Instagram **connection-management** routes, and if so, exactly which endpoints, roles, and operations are affected.

Explicitly out of scope (not inspected, not commented on): H-4 `/api/payments` field exposure, G-1 raw phone logs, E-1 notification anonymization, E-2 lab attachment legal hold, H1 patient import, the `reports.ts` GROUP BY bug, infrastructure encryption, backup/restore evidence, legal/consent/DPA/subprocessor/transfer topics, general WhatsApp agent/inbox behavior, and frontend UX beyond what's needed to judge backend route reachability.

## 2. Baseline

- `origin/main` at validation time: `0fb94cbfd1943ee698931e26be3c4b1006d259f8` (merge of PR #225, `docs/data-integrity-001-r5-production-closeout`).
- Confirmed ancestor: `git merge-base --is-ancestor 79d1b2d43d36ee2a1ee19aacadff6f10ec987d4f origin/main` → **true**. The stated baseline SHA (containing PR #224 patient-import clinic-scope fix and PR #226 H1 verification) is an ancestor of current `origin/main`; current `origin/main` is later.
- Audit worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-h2-cross-branch-messaging-audit`, created fresh from `origin/main` (HEAD `0fb94cb`), on branch `audit/kvkk-h2-cross-branch-messaging-authorization`. No existing worktree was reused; primary working tree (`docs/kvkk-20260720-production-reconciliation`, with its unrelated untracked file) was not touched.
- H1 remains `CLOSED` / `MERGED_DEPLOYED_PRODUCTION_VERIFIED` per prior evidence; not re-examined here.

## 3. Files inspected

- `server/src/routes/organizationWhatsApp.ts` (full file, 1241 lines)
- `server/src/routes/organizationInstagram.ts` (full file, 738 lines)
- `server/src/utils/roles.ts` (role-capability predicates, `normalizeRole`, `getEffectiveRoleForClinic`)
- `server/src/utils/clinicScope.ts` (the repo's central clinic-scope helper module)
- `server/src/routes/organizationBranches.ts` (`GET /api/organization/clinics` — sibling org-level route, used as the correct-pattern reference)
- `server/src/middleware/auth.ts` (`authenticate`, `authorize`, token/session shape — confirms `req.user.allowedClinicIds` / `canAccessAllClinics` are populated before any route handler runs)
- `server/src/index.ts` (route mounting order; confirms `authenticate` is applied globally at the `/api` level before `organizationWhatsApp`/`organizationInstagram` routers)
- `server/src/services/whatsapp/whatsappService.ts`, `EvolutionWhatsAppProvider.ts`, `MetaCloudWhatsAppProvider.ts` (`testWhatsAppConnection`, `getWhatsAppQrCode`, `disconnectWhatsAppConnection` — to characterize exact response content, not to change behavior)
- `server/prisma/schema.prisma` — `WhatsAppConnection`, `ClinicWhatsAppConnection`, `InstagramConnection`, `ClinicInstagramConnection` models
- `server/src/tests/whatsappProvider.test.ts`, `server/src/tests/instagramProvider.test.ts` (only test files referencing these connection routes/helpers)
- `src/pages/WhatsAppConnections.tsx` (frontend clinic-option source, reachability context only; not modified)

Not read in full (out of scope per task instructions): `server/src/routes/whatsapp.ts` (3999-line messaging/inbox route — general agent behavior, not connection authorization), `whatsappInbox.ts`, `instagramInbox.ts`, `instagramWebhook.ts`, `metaWhatsAppWebhook.ts`.

## 4. Route inventory (WhatsApp — `organizationWhatsApp.ts`)

All routes are mounted at `app.use('/api', organizationWhatsAppRoutes)` (`server/src/index.ts:228`), behind the global `app.use('/api', authenticate)` (`server/src/index.ts:194`). `authenticate` populates `req.user.organizationId`, `req.user.clinicId` (default clinic only, not authorization), `req.user.allowedClinicIds`, `req.user.canAccessAllClinics`. `authorize([...])` is a pure role-string check (`server/src/middleware/auth.ts:216-232`) — it never inspects `allowedClinicIds` or any route parameter.

| Method | Route | `authorize()` roles | Extra role predicate | Target resolution | Clinic-scope check | Org-scope check | CLINIC_MANAGER reachable | Other roles reachable |
|---|---|---|---|---|---|---|---|---|
| GET | `/organization/whatsapp-connections` (L116) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | none (list) | **none** | `organizationId` | Yes | No (403 at `authorize`) |
| POST | `/organization/whatsapp-connections` (L176) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | body | n/a (create) | `organizationId` on linked clinics | No | No |
| GET | `/organization/whatsapp-connections/:id` (L278) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | `:id` | **none** | `organizationId` | Yes | No |
| PUT | `/organization/whatsapp-connections/:id` (L306) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | `:id` + body | n/a | `organizationId` | No | No |
| POST | `/organization/whatsapp-connections/:id/test` (L440) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | `:id` | **none** | `organizationId` | Yes | No |
| GET | `/organization/whatsapp-connections/:id/readiness` (L495) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | `:id` | **none** | `organizationId` | Yes | No |
| GET | `/organization/whatsapp-connections/:id/qr` (L567) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | `:id` | **none** | `organizationId` | Yes | No |
| POST | `/organization/whatsapp-connections/:id/disconnect` (L592) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | `:id` | n/a | `organizationId` | No | No |
| PATCH | `/organization/whatsapp-connections/:id/status` (L638) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | `:id` | n/a | `organizationId` | No | No |
| DELETE | `/organization/whatsapp-connections/:id` (L709) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | `:id` | n/a | `organizationId` | No | No |
| POST | `/organization/whatsapp-connections/import-legacy` (L774) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | n/a | n/a | `organizationId` | No | No |
| POST | `/organization/whatsapp-connections/meta/callback` (L915) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | body | n/a | `organizationId` | No | No |
| GET | `/clinics/:clinicId/whatsapp` (L1107) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewWhatsAppStatus` | `:clinicId` | **none** | `organizationId` (clinic + assignment) | Yes | No |
| PUT | `/clinics/:clinicId/whatsapp` (L1143) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canAssignWhatsAppToClinic` | `:clinicId` + body `whatsappConnectionId` | **none** | `organizationId` (clinic) + `organizationId`+`isActive` (connection) | Yes | No |
| DELETE | `/clinics/:clinicId/whatsapp/:connectionId` (L1199) | OWNER, ORG_ADMIN | `canManageWhatsAppConnections` | `:clinicId`, `:connectionId` | n/a | `organizationId` | **No** | No |

## 5. Route inventory (Instagram — `organizationInstagram.ts`)

Same global `authenticate` gate; mounted at `server/src/index.ts:230`.

| Method | Route | `authorize()` roles | Extra role predicate | Clinic-scope check | Org-scope check | CLINIC_MANAGER reachable |
|---|---|---|---|---|---|---|
| GET | `/organization/instagram-connections` (L158) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewInstagramStatus` | **none** | `organizationId` | Yes |
| POST | `/organization/instagram-connections` (L186) | OWNER, ORG_ADMIN | `canManageInstagramConnections` | n/a | `organizationId` | No |
| GET | `/organization/instagram-connections/:id` (L286) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewInstagramStatus` | **none** | `organizationId` | Yes |
| PUT | `/organization/instagram-connections/:id` (L318) | OWNER, ORG_ADMIN | `canManageInstagramConnections` | n/a | `organizationId` | No |
| POST | `/organization/instagram-connections/:id/test` (L447) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewInstagramStatus` | **none** | `organizationId` | Yes |
| POST | `/organization/instagram-connections/:id/disconnect` (L487) | OWNER, ORG_ADMIN | `canManageInstagramConnections` | n/a | `organizationId` | No |
| PATCH | `/organization/instagram-connections/:id/status` (L533) | OWNER, ORG_ADMIN | `canManageInstagramConnections` | n/a | `organizationId` | No |
| DELETE | `/organization/instagram-connections/:id` (L570) | OWNER, ORG_ADMIN | `canManageInstagramConnections` | n/a | `organizationId` | No |
| GET | `/clinics/:clinicId/instagram` (L617) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canViewInstagramStatus` | **none** | `organizationId` (clinic only; assignment query has no org/clinic filter beyond `clinicId`) | Yes |
| PUT | `/clinics/:clinicId/instagram` (L654) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canAssignInstagramToClinic` | **none** | `organizationId` (clinic + connection) | Yes |
| DELETE | `/clinics/:clinicId/instagram/:connectionId` (L704) | OWNER, ORG_ADMIN, CLINIC_MANAGER | `canAssignInstagramToClinic` | **none** | `organizationId` (clinic only) | **Yes** |

Note: the Instagram `DELETE` assignment route is reachable by `CLINIC_MANAGER` (`canAssignInstagramToClinic` includes `CLINIC_MANAGER`, `organizationInstagram.ts:663,708-716`), whereas the WhatsApp equivalent `DELETE /clinics/:clinicId/whatsapp/:connectionId` requires `canManageWhatsAppConnections` (OWNER/ORG_ADMIN only, `organizationWhatsApp.ts:1203`). The two channels are inconsistent with each other on this one action.

## 6. Role and scope matrix

| Role | `canAccessAllClinics` (typical) | Intended scope | Actual scope enforced by these routes |
|---|---|---|---|
| OWNER | true | Organization-wide (intentional) | Organization-wide — correct |
| ORG_ADMIN | true | Organization-wide (intentional) | Organization-wide — correct |
| CLINIC_MANAGER | **false** (canonical definition, `roles.ts:11-12,57-61`: "admin + canAccessAllClinics=false → CLINIC_MANAGER") | Restricted to `allowedClinicIds` (own branch(es) only) — `roles.ts:271-272,213-214,222-224` document this intent explicitly for related features | **Organization-wide** on 7 of the 15 WhatsApp routes and 6 of the 11 Instagram routes listed above (13 affected routes total) — confirmed gap |
| RECEPTIONIST | false | No connection-management access | Blocked at `authorize()` — not in role list on any inspected route |
| DENTIST | false | No connection-management access | Blocked at `authorize()` |
| BILLING | false | No connection-management access | Blocked at `authorize()` |
| No dedicated "messaging" role exists | — | — | — |

`canAccessAllClinics=true` users and `allowedClinicIds`-restricted users are **not** distinguished anywhere inside `organizationWhatsApp.ts` / `organizationInstagram.ts` — the vulnerable routes never read `req.user.allowedClinicIds` or `req.user.canAccessAllClinics` at all. This is confirmed by absence: neither identifier appears anywhere in either file (checked via full-file read, not just grep).

## 7. Call-path analysis

Full path for, e.g., `PUT /api/clinics/:clinicId/whatsapp`:

1. **Authentication** — `authenticate` (`server/src/middleware/auth.ts`, mounted globally `server/src/index.ts:194`) validates the session/JWT and populates `req.user` with `organizationId`, `allowedClinicIds` (from `UserClinic` rows or the legacy default clinic), `canAccessAllClinics`, `role`.
2. **Role authorization** — `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])` (`organizationWhatsApp.ts:1145`) compares `req.user.role` (canonicalized) against the allow-list. `CLINIC_MANAGER` passes.
3. **Extra role predicate** — `canAssignWhatsAppToClinic(req.user!)` (`roles.ts:274-277`) — again a pure role check; returns `true` for `CLINIC_MANAGER` regardless of `allowedClinicIds`.
4. **Clinic/organization scope resolution** — `prisma.clinic.findFirst({ where: { id: clinicId, organizationId } })` (`organizationWhatsApp.ts:1162-1165`). This blocks a clinic from a **different organization** (404), but a same-organization clinic outside `req.user.allowedClinicIds` passes this check unchanged.
5. **Database lookup (connection)** — `prisma.whatsAppConnection.findFirst({ where: { id: whatsappConnectionId, organizationId, isActive: true } })` (`organizationWhatsApp.ts:1167-1169`). Same pattern: any active connection in the organization qualifies, not just ones already linked to the caller's clinics.
6. **Mutation** — `prisma.clinicWhatsAppConnection.upsert(...)` (`organizationWhatsApp.ts:1174-1180`) writes the new default connection assignment for `clinicId`, unconditionally.

No other middleware, decorator, or downstream helper re-checks `allowedClinicIds` for this route. The same five-step shape (authenticate → role authorize → role predicate → org-only DB lookup → mutation/read) repeats for every route flagged "Yes" in the CLINIC_MANAGER-reachable columns above. This satisfies the task's reachability bar: "a route is vulnerable only if the full current path permits unauthorized cross-clinic access or control" — here it does, for the flagged routes.

## 8. Confirmed reachable paths (same-organization, cross-clinic, CLINIC_MANAGER)

A `CLINIC_MANAGER` with `canAccessAllClinics=false` and `allowedClinicIds=[A]` (i.e., restricted to clinic A only), in an organization that also contains clinic B, can, using only their own valid session:

- `GET /api/organization/whatsapp-connections` — list **every** WhatsApp connection in the organization, including ones never linked to clinic A, with each connection's linked-clinics array (`{id, name}` for every linked clinic, including clinic B and any others) — `organizationWhatsApp.ts:127-137`.
- `GET /api/organization/whatsapp-connections/:id` — fetch full sanitized detail of any connection by ID, including ones belonging only to clinic B — `organizationWhatsApp.ts:288-296`.
- `GET /api/organization/whatsapp-connections/:id/readiness` — view clinic B's KVKK legal-profile publish status and active bookable service counts, sourced through any connection linked to clinic B — `organizationWhatsApp.ts:506-559`.
- `GET /api/organization/whatsapp-connections/:id/qr` — request Evolution API QR/pairing state for any organization connection (only meaningful for `provider=evolution_api` while the instance is unpaired/reconnecting) — `organizationWhatsApp.ts:577-584`, `EvolutionWhatsAppProvider.ts:157+`.
- `POST /api/organization/whatsapp-connections/:id/test` — trigger a live connectivity test against any organization connection's real provider (outbound network call), which also **mutates** that connection's `status`/`lastConnectedAt`/`lastError` fields as a side effect — `organizationWhatsApp.ts:450-477`, `whatsappService.ts:155-179`.
- `GET /api/clinics/:clinicId/whatsapp` (clinicId = B) — view clinic B's WhatsApp connection assignment — `organizationWhatsApp.ts:1117-1136`.
- **`PUT /api/clinics/:clinicId/whatsapp` (clinicId = B)** — reassign clinic B's default WhatsApp connection to any active connection in the organization (including one the manager fully controls, e.g., a connection linked only to clinic A) — `organizationWhatsApp.ts:1161-1191`. **This is the highest-impact confirmed path**: it silently redirects which WhatsApp instance receives/sends messages for a clinic the caller is not authorized for.

The equivalent Instagram set: `GET /organization/instagram-connections`, `GET /organization/instagram-connections/:id`, `POST /organization/instagram-connections/:id/test`, `GET /clinics/:clinicId/instagram`, `PUT /clinics/:clinicId/instagram` (routing-reassignment analog to the WhatsApp PUT above), and additionally **`DELETE /clinics/:clinicId/instagram/:connectionId`** (clinic-B unassignment, more permissive than the WhatsApp DELETE which is OWNER/ORG_ADMIN-only).

All of the above were verified by static code reading of the actual `where` clauses and role predicates at the cited line numbers — not assumed from route naming or comments.

## 9. Paths initially suspicious but blocked elsewhere

- `POST /organization/whatsapp-connections` (create), `PUT /organization/whatsapp-connections/:id` (update/credential replace), `POST /:id/disconnect`, `PATCH /:id/status`, `DELETE /:id`, `POST /import-legacy`, `POST /meta/callback` — all gated by `authorize(['OWNER','ORG_ADMIN'])` **and** `canManageWhatsAppConnections` (`roles.ts:265-268`, OWNER/ORG_ADMIN only). `CLINIC_MANAGER` is rejected at step 2 (role authorize) before any DB lookup runs. Confirmed safe.
- `DELETE /clinics/:clinicId/whatsapp/:connectionId` — gated by `canManageWhatsAppConnections` (OWNER/ORG_ADMIN only), even though the route lives in the "clinic assignment" section alongside CLINIC_MANAGER-reachable routes. Confirmed safe — this one route breaks the pattern in the safe direction.
- Instagram `POST` (create), `PUT` (update), `POST /:id/disconnect`, `PATCH /:id/status`, `DELETE /:id` — same OWNER/ORG_ADMIN-only gate via `canManageInstagramConnections` (`roles.ts:463-467`). Confirmed safe.
- Encrypted secret fields (`evolutionApiKeyEncrypted`, `metaAccessTokenEncrypted`, `metaWebhookVerifyToken`, `metaWebhookSecret`, `webhookSecret` for WhatsApp; `accessTokenEncrypted`, `pageAccessTokenEncrypted`, `webhookVerifyToken`, `webhookSecret` for Instagram) are stripped by `sanitizeConnection()` in **both** files (`organizationWhatsApp.ts:53-63`, `organizationInstagram.ts:47-56`) before every response, including the vulnerable list/detail routes. Confirmed: no secret/token exposure on any path, vulnerable or not.
- RECEPTIONIST, DENTIST, BILLING — rejected by `authorize()` on every route in both files (none of these roles appear in any `authorize([...])` allow-list here). Confirmed not reachable.

## 10. Cross-organization result

**No cross-organization access exists.** Every single query in both files — 26 endpoints total across the two files — includes `organizationId: req.user!.organizationId` (or, for `:clinicId` params, first validates the clinic belongs to `req.user!.organizationId` before touching anything else). This was verified line-by-line for every `prisma.*.findFirst/findMany/update/delete/create/upsert` call in both files; there is no query missing the organization filter. A clinic ID or connection ID from a different organization returns 404 ("Clinic not found" / "Connection not found" / "Not found") at the first DB lookup. This matches the file-header claim ("Cross-org access is blocked at every query") and the existing `whatsappProvider.test.ts` cross-org unit tests (section "Phase 3 — Cross-clinic / cross-org test access guard", L1747+, L1812+) and `instagramProvider.test.ts` equivalents. **Outcome C (no gap) applies specifically to the cross-organization axis.**

## 11. Same-organization cross-clinic result

**Confirmed reachable**, as detailed in §8. This is **Outcome B**: only a subset of routes are vulnerable — specifically, every route that (a) is reachable by `CLINIC_MANAGER` and (b) resolves its target clinic/connection using only an `organizationId` filter rather than an `allowedClinicIds`/`canAccessAllClinics` check. All OWNER/ORG_ADMIN-only routes are unaffected because organization-wide access is that role's intended scope, not a gap (per the task's own framework — "do not classify legitimate organization-wide access as a vulnerability").

## 12. Data/control exposure (precise, per the required checklist)

| Item | Exposed to restricted CLINIC_MANAGER via the vulnerable routes? |
|---|---|
| Provider type (`evolution_api` / `meta_cloud_api`) | Yes |
| Phone number / account identifier | Yes (`phoneNumber`, `instagramUsername`, `instagramAccountId`) |
| Display name | Yes |
| Access token metadata (status only, e.g. `metaTokenStatus`) | Yes (status string only) |
| Encrypted credential fields (token/key ciphertext) | **No** — stripped by `sanitizeConnection()` in both files |
| Webhook data (verify token, webhook secret) | **No** — stripped by `sanitizeConnection()` |
| Connection status (`connected`/`disconnected`/`error`) | Yes |
| WABA / page / phone-number-ID / Instagram-account / business IDs | Yes (`metaWabaId`, `metaPhoneNumberId`, `metaBusinessId`, `facebookPageId`, `instagramAccountId`, `instagramLoginUserId`) |
| View message content | **No** — these routes never return message bodies; that lives in `whatsapp.ts`/`whatsappInbox.ts`/`instagramInbox.ts`, not reviewed here |
| Send messages | **No** — no send action exists in these two files |
| Reassign a connection (change which clinic a connection serves) | **Yes** — `PUT /clinics/:clinicId/whatsapp`, `PUT /clinics/:clinicId/instagram` |
| Replace credentials | **No** — requires OWNER/ORG_ADMIN (`PUT /organization/.../:id`) |
| Disconnect the integration | **No** — requires OWNER/ORG_ADMIN |
| Delete the connection | **No** — requires OWNER/ORG_ADMIN (WhatsApp); Instagram assignment-only delete (unassign, not delete of the connection record) is CLINIC_MANAGER-reachable |
| Generate QR/pairing state | **Yes**, WhatsApp Evolution API provider only, and only meaningful while the target instance is unpaired/reconnecting (`MetaCloudWhatsAppProvider.getQrCode` explicitly returns `available:false` for Meta Cloud API — provider-specific, not universal) |
| Trigger sync/test operations | **Yes** — both channels, causes a real outbound network call plus a DB status mutation as a side effect |
| Alter which clinic receives messages | **Yes** — same mechanism as "reassign a connection" above; this is the most consequential confirmed impact |

No secret, token, or credential value is exposed or replaceable by a restricted `CLINIC_MANAGER` on any path reviewed. The confirmed impact is: (a) organization-wide metadata visibility beyond assigned clinics, and (b) the ability to redirect another clinic's inbound/outbound messaging channel to a connection of the caller's choosing.

## 13. Existing correct authorization pattern

`server/src/routes/organizationBranches.ts:107-119` (`GET /api/organization/clinics`) is the closest sibling route — same `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])` gate, same organization-level concern — and it implements the check the messaging routes are missing:

```ts
const { organizationId, canAccessAllClinics, allowedClinicIds } = req.user!;
const where: any = { organizationId };
// CLINIC_MANAGER yalnızca atandığı şubeleri görür
if (!canAccessAllClinics) {
  where.id = { in: allowedClinicIds };
}
```

More generally, `server/src/utils/clinicScope.ts` provides reusable, already-tested helpers built for exactly this shape of problem: `getAccessibleClinicIds(user)`, `buildClinicScopeWhere`/`validateAndGetScope` (for models with `organizationId`), and `buildClinicIdScope`/`validateAndGetClinicIdScope` (for models without one). `ClinicWhatsAppConnection`/`ClinicInstagramConnection` have `organizationId`, so `validateAndGetScope` (or the simpler inline pattern from `organizationBranches.ts`) is directly applicable without introducing a new abstraction.

## 14. Test coverage and gaps

Only two test files reference this area: `server/src/tests/whatsappProvider.test.ts` and `server/src/tests/instagramProvider.test.ts`. Both are **unit-level logic-simulation tests** — they re-implement small fragments of the route logic inline (e.g., a local `findScoped(id, organizationId)` closure) and assert against that reimplementation; neither file issues an actual HTTP request against the Express routers in `organizationWhatsApp.ts` / `organizationInstagram.ts`. Coverage found:

- Cross-org rejection: covered, but only as a hand-rolled simulation of the `organizationId` filter (`whatsappProvider.test.ts:1747-1820`), not an integration test of the real route.
- Role booleans: `canAssignWhatsAppToClinic`/`canViewWhatsAppStatus`/`canManageWhatsAppConnections` return-value checks for CLINIC_MANAGER, OWNER, ORG_ADMIN, DENTIST, BILLING, RECEPTIONIST, ASSISTANT (`whatsappProvider.test.ts:538-546, 884-896, 1251-1289, 1822-1826`) — these confirm the *role* predicates behave as designed (CLINIC_MANAGER → true for view/assign), which is precisely the design gap: the tests correctly show CLINIC_MANAGER is *authorized by role*, but no test then asks whether that authorization is further narrowed by `allowedClinicIds`.
- Reassignment logic (moving a clinic from one connection to another): covered as a pure data-structure simulation (`whatsappProvider.test.ts:744-757`), with no `allowedClinicIds` dimension at all.

**Missing test scenarios** (not added in this task):
1. `CLINIC_MANAGER` with `allowedClinicIds=[A]` calling `GET /api/organization/whatsapp-connections` (and the Instagram equivalent) should see only connections linked to clinic A — currently untested and, per §8, currently false.
2. Same role/state calling `GET /organization/whatsapp-connections/:id` for a connection linked only to clinic B should 403/404 — untested.
3. Same role/state calling `POST /organization/whatsapp-connections/:id/test` for a clinic-B-only connection should be blocked — untested.
4. Same role/state calling `GET /clinics/:clinicB/whatsapp` and `/instagram` should 403 — untested.
5. **Same role/state calling `PUT /clinics/:clinicB/whatsapp` and `/instagram` (the reassignment path) should 403** — untested; this is the highest-priority missing test given §8's severity finding.
6. Same role/state calling `DELETE /clinics/:clinicB/instagram/:connectionId` should 403 — untested.
7. Positive-path regression guard: `OWNER`/`ORG_ADMIN` (`canAccessAllClinics=true`) must retain full organization-wide access on all of the above after any fix — not currently exercised at the route/integration level, only as isolated role-boolean checks.
8. None of the above exist as actual `supertest`-style HTTP-request tests against the real Express routers for either file; all current assertions operate on hand-copied logic fragments, so a regression in the real route would not be caught by the existing suite even if the missing scenarios above were absent from the vulnerability.

## 15. Severity assessment

- **Authorization boundary:** same-organization cross-clinic bypass (confirmed). Not cross-organization (confirmed blocked, §10). Legitimate organization-wide access for OWNER/ORG_ADMIN is by design and excluded from this finding.
- **Data sensitivity:** connection metadata only — provider type, phone/account identifiers, display names, WABA/page/business/phone-number/Instagram-account IDs, connection status, and (indirectly) another clinic's KVKK legal-profile publish status and active-service counts via the `/readiness` endpoint. No tokens, keys, or webhook secrets (stripped in code, verified). No patient message content.
- **Control impact:** the confirmed reassignment path (`PUT /clinics/:clinicId/whatsapp` and `/instagram`) redirects a clinic's inbound/outbound messaging channel to a connection the caller chooses — a real routing-hijack capability, not merely a read exposure. It does not extend to credential replacement, disconnect, or connection deletion (those remain OWNER/ORG_ADMIN-gated on both channels), except that Instagram's clinic-unassignment (`DELETE /clinics/:clinicId/instagram/:connectionId`) is also CLINIC_MANAGER-reachable cross-clinic.
- **Exploitability:** direct request with a **self-disclosed** identifier — the vulnerable `GET /organization/whatsapp-connections` (and Instagram equivalent) list response itself includes each connection's linked clinics as `{id, name}` pairs, so the attacker does not need to guess or separately enumerate another clinic's UUID; the same over-broad endpoint that under-scopes access also hands over the identifiers needed to exploit the reassignment endpoint. This is the highest exploitability tier in the task's framework (no ownership guard, no required guess, identifier obtained from the app itself).
- **Reachability:** production-enabled, no feature flag, applies to both providers (Evolution API and Meta Cloud API) and both channels (WhatsApp and Instagram) for the metadata-exposure and reassignment paths; the QR-pairing exposure is additionally state-dependent (Evolution API only, only while unpaired/reconnecting) and therefore narrower.
- This requires the caller to already be an authenticated organization member holding the `CLINIC_MANAGER` role with `canAccessAllClinics=false` — i.e., an "insider with restricted scope" threat model, which is exactly the scenario multi-branch KVKK-relevant customers are expected to use (branch managers restricted to their own clinic). It is not a hypothetical or rare configuration; it is the documented purpose of the `CLINIC_MANAGER` + `allowedClinicIds` design (`roles.ts:213-214, 222-224, 271-272`).

## 16. Final classification

**`CODE_REMEDIATION_RECOMMENDED`, with an explicit recommendation to treat it as `CODE_BLOCKER_BEFORE_ONBOARDING` for any organization that (a) operates more than one clinic/branch and (b) has at least one `CLINIC_MANAGER` account with `canAccessAllClinics=false`.**

Reasoning: this is a real, currently reachable, same-organization cross-clinic authorization gap (Outcome A/B, not Outcome C) affecting a subset of endpoints (Outcome B — safe and unsafe routes coexist in the same files). It is not cross-organization (Outcome D does not apply, so automatic escalation to `CRITICAL_CROSS_TENANT_AUTHORIZATION_GAP` is not warranted), and no secrets/tokens are exposed. However, the confirmed control impact — silently redirecting another clinic's messaging channel — combined with self-disclosing exploitability and the fact that `CLINIC_MANAGER` + restricted `allowedClinicIds` is the intended, documented configuration for multi-branch customers (not an edge case), means this is not merely cosmetic. For any customer/pilot that is genuinely multi-branch with restricted branch managers, this gap is live and should block onboarding of that specific configuration until fixed; for single-branch organizations or organizations where all managers hold `canAccessAllClinics=true`, the gap is currently unreachable and the finding remains a non-blocking recommended fix. This conditional framing is offered as the audit's assessment; the actual go/no-go call for the current pilot/launch gate is a program decision, not this document's.

## 17. Remediation recommendation (description only — not implemented here)

Smallest safe fix: apply the same pattern already used in `organizationBranches.ts:107-119` (or the equivalent `clinicScope.ts` helper) to every CLINIC_MANAGER-reachable route identified in §8, narrowing DB lookups from `organizationId`-only to `organizationId` + (`canAccessAllClinics` ? no extra filter : `id`/`clinicId` ∈ `allowedClinicIds`). Concretely:

- List routes (`GET /organization/whatsapp-connections`, `GET /organization/instagram-connections`): filter to connections whose `clinics` include at least one clinic in `allowedClinicIds`, when `!canAccessAllClinics`.
- Detail/test/readiness/qr routes (`GET/:id`, `POST /:id/test`, `GET /:id/readiness`, `GET /:id/qr`, Instagram `GET/:id`, `POST /:id/test`): after the existing `organizationId` lookup, additionally verify the connection is linked to at least one clinic in `allowedClinicIds` when `!canAccessAllClinics`, else 403/404.
- Clinic-assignment routes (`GET/PUT /clinics/:clinicId/whatsapp`, `GET/PUT /clinics/:clinicId/instagram`, `DELETE /clinics/:clinicId/instagram/:connectionId`): require `canAccessAllClinics || allowedClinicIds.includes(clinicId)` before touching the clinic, mirroring `clinicScope.ts`'s `resolveEffectiveClinicId`/`validateAndGetScope` shape.
- For the `PUT` reassignment routes specifically, also verify the **target** `whatsappConnectionId`/`instagramConnectionId` is one the caller may assign — i.e., either already linked to an allowed clinic, or the caller is org-wide — to prevent a restricted manager from pointing an allowed clinic at a connection they discovered via the (to-be-fixed) list endpoint but have no legitimate relationship to. (Exact semantics — e.g., whether unlinked-but-same-org connections should ever be assignable by a restricted manager — is a product decision for the remediation PR, not resolved here.)

## 18. Exact proposed remediation scope (files only — not implemented here)

- `server/src/routes/organizationWhatsApp.ts` — the 7 CLINIC_MANAGER-reachable routes listed in §4 with "none" in the Clinic-scope column.
- `server/src/routes/organizationInstagram.ts` — the 6 CLINIC_MANAGER-reachable routes listed in §5 with "none" in the Clinic-scope column.
- Possibly `server/src/utils/clinicScope.ts` — only if a new small helper (e.g., "is this connection linked to any of the caller's allowed clinics") is judged cleaner than inlining the check per-route; the remediation PR should default to reusing existing exports rather than adding one, unless reuse proves awkward.
- No schema, migration, or frontend change is anticipated; the fix is authorization-logic-only.

## 19. Exact proposed tests (not added in this task)

New integration/route-level tests (ideally `supertest` against the real Express app, not logic simulations) for both `organizationWhatsApp.ts` and `organizationInstagram.ts`, covering the 8 scenarios enumerated in §14 ("Missing test scenarios"), specifically:
1. Restricted `CLINIC_MANAGER` (`allowedClinicIds=[A]`) — list endpoint returns only clinic-A-linked connections.
2. Restricted `CLINIC_MANAGER` — detail/test/readiness/qr on a clinic-B-only connection → 403/404.
3. Restricted `CLINIC_MANAGER` — `GET`/`PUT` `/clinics/:clinicB/whatsapp` and `/instagram` → 403.
4. Restricted `CLINIC_MANAGER` — `DELETE /clinics/:clinicB/instagram/:connectionId` → 403.
5. `OWNER`/`ORG_ADMIN` (`canAccessAllClinics=true`) — full access retained on all of the above (regression guard against over-restricting the intended organization-wide roles).
6. Existing cross-org denial behavior (already covered by simulation tests) re-verified at the real route level.

## 20. Production verification design for a future fix

Once remediated, verification should (design only, not executed here): create a disposable test organization with 2 clinics and 2 WhatsApp/Instagram connections, one `CLINIC_MANAGER` restricted to clinic A only; confirm via authenticated API calls (not direct DB access) that: (a) the manager's list/detail/test/readiness/qr calls are now scoped to clinic A's connections only, (b) the manager cannot reassign or unassign clinic B's connection, (c) `OWNER`/`ORG_ADMIN` behavior is unchanged, (d) no regression in cross-org denial. This mirrors the verification pattern used for the H1 patient-import fix (PR #224) and should be run in a non-production environment with synthetic data only.

## 21. Explicit non-claims and out-of-scope items

This document does **not** claim:
- Full KVKK compliance for messaging, WhatsApp, or Instagram features generally.
- That all messaging authorization is safe — only the specific routes in `organizationWhatsApp.ts`/`organizationInstagram.ts` inspected here were validated; `whatsapp.ts` (message send/inbox, 3999 lines), `whatsappInbox.ts`, `instagramInbox.ts`, and the webhook routes were **not** reviewed and may have their own, separate authorization properties (better or worse) not characterized by this document.
- That onboarding is generally approved — this document characterizes one finding only and does not touch program gates, trackers, or the current phase.
- Any conclusion about H-4, G-1, E-1, E-2, patient import, the `reports.ts` bug, infrastructure encryption, backup/restore, or legal/consent/DPA topics — all explicitly out of scope and not examined.
- That the QR-pairing exposure (§12) is exploitable in a typical steady-state connection — it requires the target connection to be in an unpaired/reconnecting state, which is a narrower, provider-specific, state-dependent condition, not a standing exposure.
- That the severity/classification in §15–16 is final — it is this audit's evidence-based assessment; the actual tracker update, severity sign-off, and blocker/non-blocker decision for the current pilot phase is a separate program-reconciliation step, explicitly not performed here.

No real phone numbers, clinic IDs, tokens, secrets, cookies, credentials, or production PII appear anywhere in this document; all identifiers used above (`clinic A`, `clinic B`, connection IDs) are illustrative placeholders, not values pulled from a live system.

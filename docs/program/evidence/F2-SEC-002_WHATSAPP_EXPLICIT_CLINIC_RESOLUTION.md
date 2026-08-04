# F2-SEC-002 — Remove Global Default-Clinic Resolution from Legacy WhatsApp Public API

Phase: F2 — Modular Monolith Guardrails / Tenant-Safety Hardening (early implementation gate).
Task-local evidence only. Not added to `docs/program/evidence/README.md` in this branch —
shared-doc reconciliation is a separate, pending step (see §11).

## 1. Baseline

- `git fetch origin --prune` + `git rev-parse origin/main` at task start →
  `e9c1765fa191223cb036ebfdb9c72b898e2fc52e`.
- `git merge-base --is-ancestor ed533853568093054b217669b2c91eba538c2459 origin/main` →
  confirmed ancestor (PR #317's merge commit, per the assigning prompt's program baseline).
- Task-local branch `fix/f2-sec-002-whatsapp-explicit-clinic-resolution` created directly from
  freshly-fetched `origin/main` @ `e9c1765`, in a dedicated task-local git worktree (local
  filesystem path intentionally omitted as non-portable environment metadata, per this
  program's established evidence convention).
- The parallel F2-SEC-001 (Instagram inbox clinic membership) worktree/branch was not read,
  modified, or otherwise touched by this task.
- CodeGraph scope: not invoked. This task is a small, targeted source-file investigation
  (`server/src/routes/whatsapp.ts`, `server/src/services/whatsapp/clinicResolver.ts`,
  `server/src/utils/webhookRouting.ts`, `server/src/utils/legacyWhatsApp.ts`,
  `server/src/services/whatsappPublicApi.ts`, `server/prisma/schema.prisma`), all located via
  `Grep`/`Read`, matching the same targeted-inspection precedent as
  F2-GUARDRAIL-PREP-010-D's own consolidation evidence for this exact defect.

## 2. Exact defect (independently re-verified from current main, not trusted from the assigning prompt's summary)

- **Endpoint(s):** 6 routes mounted at `/api/public/whatsapp/*`
  (`server/src/index.ts:183` → `app.use('/api/public/whatsapp', whatsappRoutes)`):
  - `GET /services`, `GET /doctors`, `GET /availability`, `GET /appointment-lookup`,
    `POST /appointment-requests`, `POST /cancel-request`.
- **Trust boundary:** each route is gated only by `authorizeWhatsappApi`, which validates a
  single global shared secret (`process.env.WHATSAPP_WEBHOOK_SECRET`, via
  `validateWhatsappApiSecret` in `server/src/services/whatsappPublicApi.ts`) sent as either an
  `Authorization: Bearer <secret>` header or `x-whatsapp-secret` header. No clinic,
  organization, connection, or instance identity is carried by the request at all — the schemas
  for all 6 routes (`whatsappAvailabilityQuerySchema`, `whatsappAppointmentLookupQuerySchema`,
  `whatsappAppointmentRequestSchema`) contain no clinic/org/instance field.
- **Pre-fix clinic resolution:** every one of the 6 routes called
  `const clinic = await getDefaultClinic();` where
  `getDefaultClinic = async () => prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } })`
  (then at `server/src/routes/whatsapp.ts:1089`, single definition, unconditional, no gate).
- **Unsafe fallback:** any caller in possession of the one global shared secret was served
  against the single oldest clinic in the entire database — database-row-creation-order
  determined the tenant, independent of which clinic (if any) the caller actually intended to
  reach. This is the exact defect flagged by
  `F2-GUARDRAIL-PREP-010-D_PARALLEL_WAVE_CONSOLIDATION.md` §Cross-domain findings
  ("F2-SEC-002 — Remove Global Default-Clinic Resolution from Legacy WhatsApp Public API").
- **Data written after resolution:** `POST /appointment-requests` and `POST /cancel-request`
  create `AppointmentRequest` rows scoped to `clinic.id` (patient lookup, appointment-type
  validation, and practitioner validation are all also scoped to `clinic.id` first). A caller
  with the shared secret could therefore write patient-appointment data into a clinic that was
  never explicitly configured to receive it, and — in a multi-tenant deployment — into a
  completely unrelated organization's clinic.
- **Not the same code path as the Evolution webhook.** `POST /evolution-webhook` (same file,
  `server/src/routes/whatsapp.ts:3616`) already performs explicit, gated, DB-based clinic
  resolution (`resolveClinicForIncomingMessage` in
  `server/src/services/whatsapp/clinicResolver.ts`, keyed off the webhook payload's `instance`
  field → `WhatsAppConnection.evolutionInstanceName`) and only falls back to
  `getClinicForWhatsAppInstance()` — itself gated behind `isLegacyFallbackEnabled()` AND
  `NODE_ENV !== 'production'`, and requiring either an explicit `Setting` mapping
  (`whatsapp.evolution_instance_name`) or an exact `EVOLUTION_INSTANCE_NAME` env-var match —
  when no DB connection matches. That legacy branch is out of scope for this defect: it is
  already gated and already keyed off an explicit instance identity; it was not touched by this
  fix. The defect was isolated to the 6 REST-style routes, which had no gate and no identity of
  any kind.

## 3. Existing trusted explicit binding used (no new identifier invented, no schema change)

- `WhatsAppConnection` (`server/prisma/schema.prisma:1662`) — `organizationId`, `isActive`
  (default `true`), provider credentials.
- `ClinicWhatsAppConnection` (`server/prisma/schema.prisma:1718`) — join table, "Maps one
  WhatsAppConnection to one Clinic. Supports shared (one connection → many clinics) and
  dedicated (one connection → one clinic) topology." (existing model comment, unchanged).
- `selectUniqueProviderConnection` / `resolveSingleLinkedClinic`
  (`server/src/utils/webhookRouting.ts`) — the same two generic "exactly-one-or-null" primitives
  already used by the Evolution webhook's own DB-based resolution. Reused verbatim, not
  reimplemented.
- Because these 6 routes carry no per-request instance/connection/org identity (§2), the only
  sound trust signal available to them is the server's own WhatsApp configuration state: is
  there exactly one active `WhatsAppConnection`, linked to exactly one clinic? This is
  necessarily a system-wide (not per-organization) check — there is no request data to scope it
  by — which is also why it correctly fails closed the moment a second organization configures
  its own connection (§5, scenario 3).

## 4. Fix

New helper `getExplicitPublicApiClinic()` added in `server/src/routes/whatsapp.ts` immediately
after the existing `getClinicForWhatsAppInstance()`:

```ts
const getExplicitPublicApiClinic = async () => {
  const activeConnections = await prisma.whatsAppConnection.findMany({
    where: { isActive: true, provider: 'evolution_api' },
    select: { id: true },
  });
  const uniqueConnection = selectUniqueProviderConnection(activeConnections);
  if (!uniqueConnection) {
    console.warn('[whatsapp-public-api] no unambiguous active WhatsApp connection', {
      activeConnectionCount: activeConnections.length,
    });
    return null;
  }

  const clinicLinks = await prisma.clinicWhatsAppConnection.findMany({
    where: { whatsappConnectionId: uniqueConnection.id },
    select: { clinicId: true },
  });
  const clinicId = resolveSingleLinkedClinic(clinicLinks);
  if (!clinicId) {
    console.warn('[whatsapp-public-api] no unambiguous clinic binding for WhatsApp connection', {
      linkedClinicCount: clinicLinks.length,
    });
    return null;
  }

  return prisma.clinic.findUnique({ where: { id: clinicId } });
};
```

All 6 route call sites changed from `const clinic = await getDefaultClinic();` to
`const clinic = await getExplicitPublicApiClinic();`. `getDefaultClinic()` itself is untouched
and remains in use only by the already-gated `getClinicForWhatsAppInstance()` legacy branch
(§2) — it is no longer reachable from any ungated public entry point.

The active-connection query is scoped to `provider: 'evolution_api'` — this whole file
(`/evolution-webhook`, `getClinicForWhatsAppInstance`) is the Evolution API integration; Meta
Cloud API has its own separate webhook route (`routes/metaWhatsAppWebhook.ts`, mounted at
`/api/public`, not `/api/public/whatsapp`). Without this scope, a clinic with a valid, correctly
-configured Evolution binding would spuriously fail closed the moment any organization anywhere
also had an active Meta connection, since `WhatsAppConnection.isActive` has no provider
discriminator on its own. This was flagged in automated PR review
(`gh pr view 319` review comment, `discussion_r3710276954`) and fixed before merge — see §9's
review-thread record.

Every one of the 6 routes already had `if (!clinic) return res.status(404).json({ error:
'Clinic not found' });` immediately after clinic resolution and before any read/write — this
was not changed. Zero-match and multiple-match both return through this same generic branch, so
external behavior does not distinguish "no binding" from "ambiguous binding" (non-enumeration,
§8).

## 5. Zero-match / multiple-match / propagation behavior (verified by real-DB integration tests, §9)

- **Zero active connections, or zero clinic links on the sole active connection:** resolver
  returns `null` → route returns `404 { error: 'Clinic not found' }` → no read or write of any
  kind occurs (identical generic 404 already used for the pre-existing "empty database" case).
- **Multiple active connections (any organization), or one active connection linked to more
  than one clinic:** resolver returns `null` → same fail-closed 404 → no tenant data created in
  any of the ambiguous clinics. Never "picks the first."
- **Inactive connection:** excluded by the `isActive: true` filter — a connection existing but
  disabled behaves identically to no connection at all.
- **Resolved clinicId propagation:** the single `clinic` object returned by
  `getExplicitPublicApiClinic()` is passed explicitly into every downstream call in each route
  body exactly as `getDefaultClinic()`'s result previously was (`clinic.id` for all
  patient/appointment-type/practitioner/appointment-request queries and creates) — no downstream
  function re-resolves or re-queries a default/global clinic.
- **Spoofed client-supplied `clinicId`:** `whatsappAppointmentRequestSchema` (Zod, non-strict)
  has no `clinicId` field, so a caller-supplied `clinicId` in the request body is silently
  dropped by `.safeParse()` and never reaches the Prisma `create` call — verified directly (not
  merely by schema inspection) in §9.

## 6. Non-enumeration

- Both zero-match and multiple-match resolve to the exact same `404 { error: 'Clinic not
  found' }` response already used pre-fix — no new status code, no new error shape, no
  clinic/organization/connection identity ever appears in a failure response.
- Operational warning logs (`console.warn`) emit only a count
  (`activeConnectionCount` / `linkedClinicCount`) — never a clinic id, org id, connection id, or
  clinic name. Pre-existing operational logs elsewhere in these routes already followed the
  repo's established redaction convention (`summarizeIdentifier` → `{length, suffix}`,
  `redactPhone` → `***xxxx`) and were not modified by this fix.

## 7. Provider verification / signature handling

Unchanged. `authorizeWhatsappApi` (secret validation) runs before clinic resolution in the
Express middleware chain for all 6 routes, exactly as before. Invalid or missing secret still
short-circuits with `401`/`503` before any clinic resolution, patient lookup, or write —
verified in §9 (scenario 9) to create zero side effects.

## 8. Scope discipline

- No Prisma schema change. No migration. Confirmed unnecessary: both `WhatsAppConnection` and
  `ClinicWhatsAppConnection` already exist on current `main` and already carry every field this
  fix needed (`isActive`, the clinic/connection join).
- `POST /evolution-webhook`, `getClinicForWhatsAppInstance()`, `clinicResolver.ts`, Meta
  WhatsApp webhook routes, Instagram routes, and the legacy-fallback env-var gating
  (`isLegacyFallbackEnabled`) are untouched.
- No new service, module, queue, or runtime boundary. No change to booking, consent, patient
  matching, or AI-prompt logic.
- The legacy-code allowlist referenced elsewhere in this program's guardrail-prep evidence is
  descriptive-only and was not expanded or treated as authorization for this change.

## 9. Tests

New file: `server/src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts`
(real disposable-PostgreSQL, real Express route-handler chains extracted from the actual
`whatsapp.ts` router via `getFullChain`/`runChain` — the same `dbVerificationHarness.ts`
convention as `appointmentRequestConversionAtomicity.test.ts`; no mocked Prisma, no mocked
`findFirst`/connection lookup, no mocked ambiguity). Registered as
`test:whatsapp-public-api-explicit-clinic-binding` in `server/package.json` and appended to the
CI-owned `server:test:disposable-db` aggregate (one new member script appended to an existing
aggregate — same precedent as F2-IMPL-001-A / F2-PREP-007-E).

20 scenarios, all passing against the fixed code (19 at initial PR open; scenario 11 below was
added in response to automated review — see §9a):

1. One valid explicit binding resolves the correct clinic — exercised independently for all 4
   GET routes (`/services`, `/doctors`, `/appointment-lookup`, `/availability` with a real
   `appointmentType` fixture).
2. Zero binding: `GET /services` fails closed (404); `POST /appointment-requests` creates zero
   `AppointmentRequest` rows (row-count assertion before/after).
3. Multiple bindings: two independent organizations each with their own valid binding → `GET
   /services` ambiguous/fails closed, response never contains either clinic's id; `POST
   /appointment-requests` creates zero rows in either clinic; a single connection linked to two
   clinics (shared-line, no prior-context case) also fails closed.
4. A foreign clinic seeded **before** the bound clinic (i.e., the foreign clinic is the
   database-oldest / would have been the pre-fix "default") is never selected — direct
   regression proof for the exact defect.
5. Same fixture reversed (foreign clinic seeded **after**) — proves order-independence, not
   merely "avoids clinic #1."
6. Inactive connection: a `WhatsAppConnection` row exists but `isActive: false` → treated as
   zero active connections, fails closed.
7. Cross-tenant write prevention: Organization A's request creates data under Clinic A only,
   never a foreign clinic; when only Organization B has a binding, a request may only ever land
   on B (there is no org-selector in this legacy API), proving it never silently falls through
   to an unrelated/default clinic.
8. Spoofed `clinicId` in the request body (both `/appointment-requests` and `/cancel-request`):
   ignored, resolved clinic wins, zero rows created under the spoofed target.
9. Invalid secret and missing secret header: `401`, zero `AppointmentRequest` rows created.
10. Backward compatibility: `GET /services` and `POST /appointment-requests` remain consistent
    (same clinic, same response shape) for a single explicitly bound clinic — the one
    configuration shape this API was actually designed for.
11. An active Meta Cloud API `WhatsAppConnection` elsewhere in the system does not make the
    Evolution-only legacy API ambiguous — direct regression test for the provider-scoping fix
    in §9a.

**Test-integrity note:** every test that establishes a "single active connection" precondition
tears its own fixtures down immediately after assertions (`isolatedTest`/`cleanupOrgs`), rather
than deferring cleanup to end-of-file — required because the fix's resolution query is
necessarily system-wide (§3), so a connection left behind by an earlier test would silently
turn a later "exactly one binding" scenario into an "ambiguous" one. This was caught empirically
during test development (first draft failed 10/19 for exactly this reason) and fixed by adding
per-test isolation, not by loosening any assertion.

**Regression-catching proof:** with the 6 call sites reverted to `getDefaultClinic()` (fix
removed, no other change), the same 19-scenario suite fails 6/19 — exactly the scenarios that
assert non-selection of a foreign/oldest clinic, ambiguity fail-closed, and cross-tenant/spoofed
-clinicId prevention. Restored immediately after this check; not part of the shipped diff.

### 9a. Automated PR review findings and fixes (before merge, before any thread was resolved)

GitHub's `copilot-pull-request-reviewer` left 2 inline review comments on PR #319
(`discussion_r3710276954`, `discussion_r3710276954+1`), both addressed with code/test changes,
committed, and pushed before this evidence section was written:

1. **Valid, real correctness bug** (`server/src/routes/whatsapp.ts`,
   `getExplicitPublicApiClinic`): the active-connection query had no `provider` filter, so an
   active `WhatsAppConnection` with `provider: 'meta_cloud_api'` anywhere in the system would
   make the uniqueness check ambiguous and cause this Evolution-only legacy API to spuriously
   fail closed even for an otherwise-correctly-configured Evolution deployment. Confirmed by
   independently re-reading `server/src/routes/metaWhatsAppWebhook.ts` (a wholly separate route
   file for Meta Cloud API, mounted at `/api/public`) and `server/src/routes/platformAdmin.ts`
   (which already filters `prisma.whatsAppConnection.count({ where: { provider: 'evolution_api'
   } })` for an analogous Evolution-only count). Fixed by adding `provider: 'evolution_api'` to
   the `where` clause (§4). New regression test added (scenario 11, §9).
2. **Valid test-strength nitpick** (`whatsappPublicApiExplicitClinicBinding.test.ts`, scenario
   3's ambiguity test): `assert.notEqual(res.body.clinic?.id, clinicA.id)` would pass vacuously
   even if `res.body.clinic` were `undefined` (the actual current shape), giving no real
   protection against a future 404 payload that accidentally leaks a clinic id. Strengthened to
   `assert.equal(res.body.clinic, undefined)` — an explicit non-enumeration check.

Both fixes verified against a fresh disposable Postgres instance (20/20 passing, `git diff
--check` clean, `npm run typecheck` clean) before being pushed as a second commit on this
branch. See PR #319 review-thread status in the delivery report for reply/resolution record.

### Exact commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npx tsx src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts` (focused, standalone disposable Postgres) | 20 passed, 0 failed (post-review-fix; 19 passed, 0 failed pre-review-fix) |
| 2 | `npx tsx src/tests/whatsappProvider.test.ts` (`test:whatsapp`) | 143 passed, 0 failed |
| 3 | `npx tsx src/tests/whatsappInbox.test.ts` (`test:inbox`) | 25 passed, 0 failed |
| 4 | `test:meta-wa` (4 files: `metaWhatsAppWebhook`, `whatsappAwaitingServiceStep`, `whatsappStepAwareNlu`, `whatsappIdentityAndPostBooking`) | 17 + 9 + 12 + 62 = 100 passed, 0 failed |
| 5 | `npx tsx src/tests/organizationMessagingConnectionScope.test.ts` (`test:messaging-connection-scope`) | 33 passed, 0 failed |
| 6 | `npx tsx src/tests/multiBranchAccess.test.ts` (`test:roles`) | 142 passed, 0 failed |
| 7 | `npm run typecheck` (server) — `prisma generate` + `tsc --noEmit` | clean, zero errors |
| 8 | `git diff --check` | clean |
| 9 | `npm run test:runtime:postgres` (root orchestrator — official disposable-Postgres run, includes the new test as part of `server:test:disposable-db`) | see §10 |

`npm run test:affected` — no such script exists in this repository (confirmed via `grep` over
both `package.json` files); not invented, per program instruction not to invent scripts.

Full-suite escalation criteria (shared tenant/auth primitives changed, shared WhatsApp
processing changed broadly, focused tests exposed a regression, or CI policy requires it) were
not met — the change is a single new helper function plus 6 call-site substitutions, with zero
edits to any shared tenant/auth primitive, `clinicResolver.ts`, the Evolution webhook, or Meta
WhatsApp/Instagram code. Full `server:test` (77-member legacy aggregate) was not additionally
run.

## 10. Disposable-Postgres orchestrator run (official, root `npm run test:runtime:postgres`)

- Run ID: `20260804T065817Z-2c722a7b-46424`
- Profile: `postgres`
- Container: `nmtest-pg-postgres-20260804t065817z-2c722a7b-46424`
- Network: `nmtest-net-postgres-20260804t065817z-2c722a7b-46424`
- Database: `nmtest_postgres_20260804t065817z_2c722a7b_46424`
- Migration: `{ "code": 0, "step": "ok" }`
- Test (`server:test:disposable-db`, 15 member scripts including the new one): `{ "code": 0 }`
  — every member script's own reported pass count is 0-failed, including
  `whatsappPublicApiExplicitClinicBinding: 19 passed, 0 failed`.
- Cleanup: `{ "success": true, "errors": [] }`
- Outcome: `{ "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }`
- Residual Docker resources after run: `docker ps -a --filter name=nmtest` and
  `docker network ls --filter name=nmtest` both empty — zero residual containers/networks.

## 11. Migration / compatibility / rollback

- **Migration:** none. No Prisma schema change, no data backfill. Both required models
  (`WhatsAppConnection`, `ClinicWhatsAppConnection`) already exist on current `main`.
- **Backward compatibility:** endpoint paths, HTTP methods, response schemas, and provider
  -facing acknowledgment behavior are unchanged. The one existing valid configuration shape
  (exactly one active `WhatsAppConnection` linked to exactly one clinic — i.e., the genuine
  single-tenant legacy deployment this API predates multi-tenancy for) continues to resolve
  identically to before. A deployment that was previously relying on the unsafe "first-created
  clinic" fallback (e.g., zero WhatsApp connections configured, or more than one clinic/org
  sharing the shared secret) will now fail closed (`404`) instead of silently writing to the
  wrong tenant. This is documented here as intentional configuration hardening, not a supported
  backward-compatible behavior change — per program instruction, a previously-misconfigured
  integration beginning to fail closed is the intended security correction, not a regression.
- **Rollback:** revert the focused PR/commit. No migration rollback (none applied), no data
  rollback, no infrastructure rollback, no queue rollback, no provider-configuration rollback.
  Reverting reopens F2-SEC-002.

## 12. Tenant / Security / KVKK impact

- **Tenant:** removes implicit wrong-tenant clinic selection on this API; requires an explicit,
  unambiguous, clinic-owned WhatsApp connection binding; database-row-creation-order can no
  longer influence which clinic receives a request.
- **Security:** rejects both missing and ambiguous bindings (fails closed, not first-match);
  preserves the existing shared-secret verification unchanged; removes the last unconditional
  global/default-clinic fallback reachable from a public, unauthenticated-beyond-shared-secret
  entry point in this file.
- **KVKK:** reduces the risk of patient-identifying appointment-request data
  (`patientName`, `phone`, `email`, `notes`) being written under the wrong clinic or an
  unrelated organization. No retention/deletion change, no consent-text change, no
  physical-storage change. KVKK physical architecture freeze remains active and was not
  touched.
- **Runtime:** narrow clinic-resolution/query change inside an existing route file. No new
  service, no queue change, no worker change, no AI-architecture change, no infrastructure
  change.

## 13. Program-control status (unchanged by this task)

- F2-SEC-001 (Instagram inbox clinic membership) remains a separate, parallel task; its files,
  worktree, and branch were not read or touched by this task.
- Shared program-control files (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`,
  `F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`) were not modified by this task; shared-doc
  reconciliation across F2-SEC-001/F2-SEC-002 remains pending, owned outside this task's scope.
- CI guardrail implementation remains unauthorized and was not implemented (one new script was
  appended to the existing, already-CI-owned `server:test:disposable-db` aggregate — not a new
  CI mechanism).
- Stage 2 Imaging remains blocked; this task did not touch imaging code or evidence.

---

## 14. R1 — Bind the request to one explicit connection credential + organization consistency

Follow-up task on the same PR/branch (`fix/f2-sec-002-whatsapp-explicit-clinic-resolution`,
PR #319), starting from the R0 head `e53116c393d02be900ce48e187e1d90c59a6d015` (the commit
covered by §1-§13 above). Triggered by two blocking findings from re-review of that head.

### 14.1 Blocking finding 1 — R0 was global uniqueness, not request binding

R0's `getExplicitPublicApiClinic()` selected the clinic by requiring exactly one active Evolution
`WhatsAppConnection` **globally** (`prisma.whatsAppConnection.findMany({ where: { isActive: true,
provider: 'evolution_api' } })` with no `where` clause tying the query to anything in the
request). The request carried a credential (`WHATSAPP_WEBHOOK_SECRET` via `authorizeWhatsappApi`)
but that credential was never used to select *which* connection — it only gated whether the
request was allowed to proceed at all. Consequences, exactly as flagged:

- With two organizations each correctly configuring their own Evolution connection, the API
  failed closed for **both** (`activeConnections.length === 2` → ambiguous → 404) — not a
  tenant-safe outcome, just an availability failure with no path for either tenant to be served.
- With only one organization configured, any caller holding the single global shared secret was
  routed to that org's clinic — the secret carried no tenant identity, so "administrator secret"
  and "Clinic B's own secret" were indistinguishable.
- The R0 test named `Organization A request cannot fall through to Organization B when only B has
  a binding` did not construct an Org-A-owned credential at all — it asserted that the *only*
  configured org (labelled "B") received the write, which is precisely the behavior being
  reviewed as unsafe, not evidence against it. Removed in R1 (§14.6).

### 14.2 Blocking finding 2 — organization denormalization was never verified

`WhatsAppConnection.organizationId`, `ClinicWhatsAppConnection.organizationId`, and
`Clinic.organizationId` are three independently-writable columns (no compound DB constraint ties
them together — confirmed by re-reading `server/prisma/schema.prisma:1662-1734`; `@@unique` on
`ClinicWhatsAppConnection` is `[clinicId, whatsappConnectionId]` only, no organization
cross-check). R0's resolver joined by `clinicId`/`whatsappConnectionId` alone and never compared
these three `organizationId` values. A stale or corrupted cross-org link (e.g. a
`ClinicWhatsAppConnection` row whose `organizationId` disagrees with either its `clinic` or its
`whatsappConnection`) would have resolved and served silently.

### 14.3 Root-cause inspection (targeted paths only, no full-repo scan)

- `server/src/routes/whatsapp.ts` — `authorizeWhatsappApi` (global-secret-only gate, no
  connection identity) and `getExplicitPublicApiClinic()` (global uniqueness, no org check); both
  replaced (§14.4).
- `server/src/services/whatsappPublicApi.ts` — `getProvidedWhatsappSecret()` (existing header
  parser: `Authorization: Bearer <secret>` or `x-whatsapp-secret`, already used, reused verbatim,
  not reimplemented) and `validateWhatsappApiSecret()` (still used, unchanged, only by
  `authorizeWhatsappWebhook` for `/evolution-webhook`, which R1 does not touch — see §14.8).
- `server/src/utils/encryption.ts` — `decryptSecretTagged()`: AES-256-GCM, `enc:v1:` version
  prefix, legacy-plaintext-compatible (returns the value as-is if it has no `enc:v1:` prefix, so
  a connection created before this task's fix or manually seeded with a plaintext secret still
  works). Reused verbatim.
- `server/src/utils/webhookRouting.ts` — `resolveSingleLinkedClinic()` reused verbatim (unchanged
  from R0); `selectUniqueProviderConnection()` is no longer used by the R1 resolver (replaced by
  an explicit secret-match filter that also needs `organizationId`/`webhookSecret` per row) but
  remains unchanged and still used elsewhere in this same file (`/evolution-webhook`'s DB-based
  instance resolution) and by `routes/metaWhatsAppWebhook.ts` — not touched.
- `server/src/routes/metaWhatsAppWebhook.ts` — read only, as the existing precedent for
  connection-owned `webhookSecret` usage (`decryptSecretTagged(connection.metaWebhookSecret) ||
  decryptSecretTagged(connection.webhookSecret)`, `server/src/routes/metaWhatsAppWebhook.ts:231`).
  Confirms `WhatsAppConnection.webhookSecret` is an established, already-shipped per-connection
  credential field, not a new concept introduced by this task.
- `server/prisma/schema.prisma:1662-1734` (`WhatsAppConnection`, `ClinicWhatsAppConnection`) —
  read only. No column added, no constraint added.
- `server/src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts` — the R0
  focused suite; extended in place (§14.6), not replaced.

**Answers to the mandatory root-cause questions:**

1. Exact header credential accepted: `x-whatsapp-secret` or `Authorization: Bearer <secret>`
   (`getProvidedWhatsappSecret`, unchanged).
2. Existing per-connection credential fields on `WhatsAppConnection`: `webhookSecret` (generic,
   provider-agnostic), `evolutionApiKeyEncrypted` (Evolution API's *outbound* API key — used by
   this server to call Evolution, not a credential Evolution/a caller presents back to this
   server — wrong direction for this use case, not used), `metaWebhookSecret` (Meta-specific,
   not applicable to the Evolution-only legacy public API).
3. Encryption format: `enc:v1:<iv(24 hex)><authTag(32 hex)><ciphertext(hex)>`, AES-256-GCM,
   `decryptSecretTagged()` (legacy-plaintext-compatible, see §14.3).
4. `WhatsAppConnection.webhookSecret` is tagged-encrypted-with-legacy-plaintext-fallback (schema
   comment `server/prisma/schema.prisma:1697`: "Shared webhook secret for this connection —
   encrypted at rest (enc:v1: prefix)"), and is **already used for connection-specific
   verification elsewhere** — `metaWhatsAppWebhook.ts` (§14.3) uses it as an HMAC key for
   `X-Hub-Signature-256`. R1 is the first place it is used for **direct** secret comparison
   (Evolution's legacy public API presents the secret itself, not an HMAC signature), which is
   the correct usage for this route shape and does not change how the column itself is written.
5. `WHATSAPP_WEBHOOK_SECRET` is retained, but only as LEGACY_SINGLE_CONNECTION_COMPATIBILITY —
   see §14.5.
6. No-migration implementation: confirmed possible and implemented — `webhookSecret` already
   exists on `WhatsAppConnection` (added before this task), already nullable (so existing
   connections created without one keep working via LEGACY_SINGLE_CONNECTION_COMPATIBILITY, no
   backfill required), already has an established decrypt helper and an established sibling usage
   pattern (`metaWhatsAppWebhook.ts`). No schema change, no migration — see §14.9.

### 14.4 Fix — connection-bound authorization + resolution (`server/src/routes/whatsapp.ts`)

`authorizeWhatsappApi` (global-secret-only middleware) and `getExplicitPublicApiClinic()`
(global-uniqueness-only resolver) are removed and replaced by three functions plus one middleware,
implementing the exact AUTHORIZATION ORDER required (parse → verify against connection-specific
config → resolve one connection → resolve one clinic link → validate org consistency → load
clinic → only then let the route body run):

- `timingSafeSecretEquals(provided, candidate)` — `Buffer.from(..., 'utf8')` + length check +
  `crypto.timingSafeEqual`. Length is checked before calling `timingSafeEqual` (which throws on
  mismatched buffer lengths); this is the same length-then-constant-time-compare shape already
  used in `server/src/utils/totp.ts:97`, not a new pattern.
- `tryDecryptConnectionSecret(value)` — wraps `decryptSecretTagged()` in a try/catch that returns
  `null` on any decryption failure, so one corrupted/undecryptable row can never take down
  resolution for the rest of the active connections, and no partial ciphertext or error detail is
  ever logged.
- `resolveWhatsappPublicApiConnection(providedSecret)` — queries `{ isActive: true, provider:
  'evolution_api' }` (same scope as R0 — Meta connections still cannot participate, §14.3/§9
  scenario "mixed provider", now also directly tested against a Meta connection sharing the exact
  secret value, §14.6). Filters to connections whose decrypted `webhookSecret` constant-time-equals
  the provided secret. Exactly one match → resolved (`source: 'connection_secret'`). Zero or more
  than one match → falls through to (zero) the legacy path, or (more than one) fails closed
  immediately — a secret shared by two connections is never "first-matched."
- `resolveWhatsappPublicApiClinic(providedSecret)` — takes the resolved connection and adds the
  organization-consistency invariant (§14.5's core: `connection.organizationId ===
  clinicLink.organizationId === clinic.organizationId`), plus the existing R0
  `resolveSingleLinkedClinic` uniqueness check and a `clinic` row-existence check.
- `authorizeAndResolveWhatsappPublicApi` — the single middleware installed on all 6 routes,
  replacing `authorizeWhatsappApi`. Parses the credential; 401 if absent (no DB read at all).
  Otherwise runs full resolution; 404 on any failure (§14.7 explains why this collapsed from R0's
  401-for-invalid-secret). On success, attaches the verified `Clinic` row to
  `req.whatsappPublicApiClinic` and calls `next()`. Wrapped in try/catch → 500 on unexpected
  errors (e.g. `ENCRYPTION_KEY` misconfigured), matching the existing route-level error-handling
  convention in this file.
- All 6 route bodies now read `(req as WhatsappPublicApiRequest).whatsappPublicApiClinic!` instead
  of calling a resolver themselves — this is what guarantees "all six routes use the same
  connection-bound resolver" structurally, not just by test coverage.

### 14.5 LEGACY_SINGLE_CONNECTION_COMPATIBILITY (retained, explicitly classified)

`WHATSAPP_WEBHOOK_SECRET` cannot identify a tenant (it is one global value), so it is never the
normal multi-tenant resolution mechanism. It is accepted **only** when, in order:

1. Connection-specific matching (§14.4) found **zero** candidates (a connection-specific secret,
   if present, always wins — "prefer connection-specific first").
2. `WHATSAPP_WEBHOOK_SECRET` is configured and the provided secret constant-time-equals it.
3. Exactly **one** active Evolution `WhatsAppConnection` exists globally.

If (3) fails (zero, or two-or-more, active connections) the legacy path itself fails closed —
verified directly: `[whatsapp-public-api] legacy global secret rejected — not a single-connection
topology` fires and the request 404s (test log, §14.10) even though the secret matched the exact
correct global value. The moment a second connection exists anywhere in the system, this path
stops matching anything; it never guesses which of the two connections the caller meant. This
satisfies every one of the required conditions: exactly one active connection, exactly one clinic
link (checked downstream in `resolveWhatsappPublicApiClinic`, same as R0), organization
consistency (§14.6 cross-org tests exercise this against the legacy path too via the pre-existing
R0 scenarios, all of which still use no-connection-secret fixtures and therefore always resolve
through this exact path), the global secret matching, and zero/multiple-connection deployments
failing closed. It is labelled `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` in both the source
(`resolveWhatsappPublicApiConnection`'s `source` field and its `console.warn`) and this evidence
document, and is described here only as a compatibility shim for the genuine single-tenant
deployment this API predates multi-tenancy for — never as the target architecture. The target
architecture is connection-specific `webhookSecret` matching (§14.4), which every R1 test proves
resolves independently of how many other active connections exist in the system (§14.6).

### 14.6 Tests — `server/src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts`

Extended in place (not replaced). Every R0 scenario is preserved with its original assertions,
**except**:

- The misleading test `Organization A request cannot fall through to Organization B when only B
  has a binding` is **removed** — per TEST INTEGRITY, a request cannot be called "Organization
  A's" without an A-owned credential, and that test had none; its premise (a single configured org
  receiving the write) is not evidence of cross-tenant isolation. It is not "corrected" in place
  because there is no way to correct it into a true A-vs-B isolation test without a
  connection-specific credential — which is exactly what the new R1 section below provides,
  properly, for both directions.
- `a secret that is present but matches nothing ... : creates no appointment request` (formerly
  "invalid secret ... 401") is updated from `401` to `404`. This is a deliberate, documented
  status-code change, not an accidental weakening: NON-ENUMERATION requires that once a credential
  is presented, "wrong secret" and "right secret but ambiguous/cross-org topology" be
  indistinguishable from the outside — under R1 a 404 no longer means "this deployment has no
  connections," it can also mean "your secret doesn't belong to any connection," so collapsing
  both into the same generic 404 is what non-enumeration requires. The `missing secret header`
  test is **unchanged** at `401`, because header-presence is checked before any database read and
  therefore reveals nothing about connection/tenant state — this is the one distinction R1
  preserves, and it is explicitly called out in the AUTHORIZATION ORDER code comment
  (`server/src/routes/whatsapp.ts`, §14.4) as the reason it is not folded into the same 404.

New section `R1 — connection-specific secret binds the request to exactly one connection-owned
clinic` (12 new scenarios, all real-DB, no mocked secret comparison, no mocked Prisma):

1. Two simultaneously active connections, each with its own connection-specific secret: all 4 GET
   routes (`/services`, `/doctors`, `/appointment-lookup`, `/availability`) resolve strictly to
   their own clinic for each secret; a cross-check (secret A + clinic B's `appointmentTypeId`)
   returns 404, proving genuine binding rather than "some clinic happened to respond 200."
2. The same topology for both POST routes (`/appointment-requests`, `/cancel-request`): secret A's
   write and secret B's write are each counted (`countAppointmentRequests`) to prove secret A never
   wrote to clinic B and vice versa — not merely that each individual call returned the expected
   `clinicId` in its response. Also includes a spoofed `clinicId=B` in the body while authenticated
   as A: still resolves/writes to A only, count on B unchanged (extends R0's spoofed-`clinicId`
   coverage, §9, to the connection-specific path).
   — Together, (1) and (2) touch all 6 routes with connection-specific credentials, which is the
   direct evidence for "all six routes use the same connection-bound resolver" (§14.4).
3. Unknown/garbage secret with connection-specific secrets already configured elsewhere: 404, row
   count unchanged.
4. The same `webhookSecret` value configured on two different active connections (a
   misconfiguration, not an attack): ambiguous credential, fails closed, zero writes to either
   clinic — proves "no first-match" for the connection-specific path, matching the R0 legacy-path
   equivalent already covered.
5. One connection (with its own secret) linked to two clinics: fails closed, same
   `resolveSingleLinkedClinic` check as R0, now exercised via the connection-specific path too.
6. Cross-org denormalization, variant 1: `ClinicWhatsAppConnection.organizationId` disagrees with
   the connection's real `organizationId` (link falsely claims org B while both the connection and
   the clinic it points at are genuinely org A's). Constructed by direct `prisma.clinicWhatsAppConnection.create`
   (bypassing the test's own `linkClinicConnection` helper, which always writes a consistent
   `organizationId`) — this is the only way to reach the corrupted-link state, since the app code
   itself never writes an inconsistent link. Fails closed, zero writes, caught by the
   connection-vs-link check.
7. Cross-org denormalization, variant 2: the link's `organizationId` matches the connection
   (passes check 6's check) but the `Clinic` row it points at genuinely belongs to a different
   organization. Fails closed, zero writes, caught by the connection-vs-clinic check — proves both
   halves of the `connection.organizationId === clinicLink.organizationId ===
   clinic.organizationId` invariant are independently enforced, not just one of the two equalities.
8. Missing clinic row: a `ClinicWhatsAppConnection` link pointing at a clinic that no longer
   exists. **Not reachable through any normal application code path** — `Clinic` is the referenced
   (parent) side of a real Postgres foreign key from `ClinicWhatsAppConnection.clinicId` with no
   `onDelete` override (default `NO ACTION`/restrict), so the database itself refuses to delete a
   `Clinic` row that is still linked. Reproduced only by temporarily running `ALTER TABLE "Clinic"
   DISABLE TRIGGER ALL` (disabling the FK-enforcement trigger that lives on the parent table),
   deleting the clinic row inside a `try`, then `ALTER TABLE "Clinic" ENABLE TRIGGER ALL` in a
   `finally` (always re-enabled, even on assertion failure) — the same category of raw-SQL
   table-level technique already used elsewhere in this suite family
   (`server/src/tests/retentionManualRunAudit.test.ts`, `RENAME TABLE ... test_disabled`, for an
   analogous "simulate a state the schema itself prevents" need). Confirms the resolver's own
   defensive `if (!clinic) return null` (§14.4) is exercised, not merely present in source.
9. Inactive connection: its **own** connection-specific secret never matches, even when provided
   correctly — the `isActive: true` filter excludes it from the query entirely, so there is no
   secret-comparison branch that could accidentally match an inactive row. Strengthens R0's
   inactive-connection test (which only covered the legacy path).
10. A Meta Cloud connection whose `webhookSecret` is set to the exact same value as a caller's
    request: the `provider: 'evolution_api'` filter excludes it from the query before any secret
    comparison happens, so it does not participate at all — strengthens R0's mixed-provider test
    (which only proved a Meta connection doesn't cause spurious *ambiguity*; this proves it also
    cannot itself be *matched*).

**Regression-catching proof (R1, in addition to R0's own §9's proof):** with `server/src/routes/whatsapp.ts`
reverted to the exact R0 head (`git show e53116c393d02be900ce48e187e1d90c59a6d015:server/src/routes/whatsapp.ts`,
restored via a scratch-directory copy-swap, not a git operation on this branch) and the R1 test
file left as-is, the same run reports **18 passed, 11 failed** — the 11 failures are exactly the
12 new R1 scenarios' assertions minus one (the "unknown secret" test at old-401-vs-new-404 also
fails, listed among the 11; scenarios 1 and 2 above are two `isolatedTest` calls each producing
one failure, and every cross-org/missing-clinic/inactive-secret/meta-secret scenario fails with
`401 !== 404` because the R0 code path never reaches connection-specific resolution at all — it
either 401s on the global-secret mismatch or never distinguishes topology). Full failing-test list
recorded in §14.10. `server/src/routes/whatsapp.ts` was restored to the R1 head immediately after
this check (`cp` from a pre-saved scratch copy) and re-verified at 29/29 passing before any commit
was made — the revert was never committed, staged, or pushed.

### 14.7 Non-enumeration (updated)

Once a credential is presented (any non-empty value), every one of the following returns the
exact same `404 { error: 'Clinic not found' }`, with the response body never containing a
`clinic` field of any kind: unknown secret, secret shared by multiple connections, zero/multiple
clinic links, cross-org denormalization (either half of the invariant), missing clinic row,
zero-or-multiple active connections under the legacy path. Only a **completely absent** credential
short-circuits before any database read, at `401` — this is unchanged from R0 and is not a
topology/secret-mismatch distinction (§14.6). Internal `console.warn` logs (§14.4) carry only
counts (`activeConnectionCount`, `matchCount`, `linkedClinicCount`) or fixed diagnostic strings —
never a connection id, clinic id, organization id, or secret value/fragment.

### 14.8 Scope discipline (R1)

- No Prisma schema change, no migration (`webhookSecret` already existed on `WhatsAppConnection`
  before this task — confirmed in §14.3).
- `authorizeWhatsappWebhook` (used only by `POST /evolution-webhook`) and
  `resolveClinicForIncomingMessage`/`clinicResolver.ts` (used only by that same route) are
  untouched — that route already performs its own DB-based, per-instance connection resolution
  (Sprint 11) and was never part of either blocking finding, which are both scoped to the 6
  secret-gated REST-style routes.
- `server/src/services/whatsappPublicApi.ts` was **not** modified — `getProvidedWhatsappSecret`
  and `validateWhatsappApiSecret` were both already exported; only the import list in
  `whatsapp.ts` changed to also pull in the former.
- F2-SEC-001, Meta webhook route logic (beyond reading its existing `webhookSecret` usage
  pattern), appointment business logic, consent flows, AI flows, and shared program-control docs
  were not touched.

### 14.9 Migration / compatibility / rollback (R1)

- **Migration:** none. `WhatsAppConnection.webhookSecret` already exists and is already nullable;
  no backfill was needed or performed.
- **Backward compatibility:** a deployment with exactly one active Evolution connection and no
  connection-specific `webhookSecret` configured (i.e. every existing R0-shaped fixture and, by
  extension, every genuinely single-tenant production deployment using only
  `WHATSAPP_WEBHOOK_SECRET` today) continues to work identically via
  LEGACY_SINGLE_CONNECTION_COMPATIBILITY (§14.5) — verified by every R0-era test in §9 still
  passing unmodified except the one deliberate 401→404 status-code correction (§14.6). A
  deployment with two or more active connections previously failed closed under R0 for a different
  reason (unconditional global-uniqueness ambiguity) and continues to fail closed under R1 unless
  each connection is given its own `webhookSecret` — this is the intended remediation path, not a
  new regression: operators with more than one Evolution connection must set a per-connection
  secret to regain multi-tenant service; the previous behavior (silently serving whichever single
  connection existed) is what BLOCKING FINDING 1 identified as unsafe.
- **Rollback:** revert this follow-up commit (returns `server/src/routes/whatsapp.ts` and the
  focused test file to the R0 head `e53116c393d02be900ce48e187e1d90c59a6d015`). No migration
  rollback (none applied), no data rollback, no infrastructure/queue/provider-configuration
  rollback. Reverting reopens both R1 blocking findings; R0's own fix (removing the
  global-default-clinic fallback) remains intact either way.

### 14.10 Exact commands, counts, and run IDs (R1)

| # | Command | Result |
|---|---|---|
| 1 | `npx tsx src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts` (focused, standalone disposable Postgres) | **29 passed, 0 failed** (20 R0 scenarios, 1 status-code correction folded into an existing scenario, 12 new R1 scenarios — net +9 test cases vs. R0's 20) |
| 2 | Regression proof: same command, `server/src/routes/whatsapp.ts` swapped to the exact R0 head, test file unchanged | **18 passed, 11 failed** — failing: the corrected invalid-secret test, both new all-six-routes connection-specific-binding tests, unknown-secret-with-connections-configured, duplicate-secret-ambiguity, connection-linked-to-two-clinics (secret variant), both cross-org denormalization variants, missing-clinic-row, inactive-connection-secret, Meta-connection-secret-exclusion. `server/src/routes/whatsapp.ts` restored to the R1 head immediately after; re-verified at 29/29 before proceeding. |
| 3 | `npx tsx src/tests/whatsappProvider.test.ts` (`test:whatsapp`) | 143 passed, 0 failed (53 + 90, unchanged from R0) |
| 4 | `npx tsx src/tests/whatsappInbox.test.ts` (`test:inbox`) | 25 passed, 0 failed (unchanged from R0) |
| 5 | `npm run test:meta-wa` (4 files) | 17 + 9 + 12 + 62 = 100 passed, 0 failed (unchanged from R0) |
| 6 | `npx tsx src/tests/organizationMessagingConnectionScope.test.ts` (`test:messaging-connection-scope`) | 33 passed, 0 failed (unchanged from R0; pre-existing unrelated `Failed to log activity` console noise from an unrelated fixture path, present in R0 too, does not affect the pass count) |
| 7 | `npx tsx src/tests/multiBranchAccess.test.ts` (`test:roles`) | 142 passed, 0 failed (unchanged from R0) |
| 8 | `npm run typecheck` (server) — `prisma generate` + `tsc --noEmit` | clean, zero errors |
| 9 | `git diff --check` | clean |
| 10 | `npm run test:runtime:postgres` (root orchestrator — official disposable-Postgres run, includes the R1-extended test as part of `server:test:disposable-db`) | see below |

**Official disposable-Postgres orchestrator run (R1):**

- Run ID: `20260804T083221Z-2032c986-16808`
- Profile: `postgres`
- Container: `nmtest-pg-postgres-20260804t083221z-2032c986-16808`
- Network: `nmtest-net-postgres-20260804t083221z-2032c986-16808`
- Database: `nmtest_postgres_20260804t083221z_2032c986_16808`
- Migration: `{ "code": 0, "step": "ok" }`
- Test (`server:test:disposable-db`, 15 member scripts, same aggregate membership as R0): `{
  "code": 0 }` — every member script's own reported pass count is 0-failed, including
  `whatsappPublicApiExplicitClinicBinding: 29 passed, 0 failed`.
- Cleanup: `{ "success": true, "errors": [] }`
- Outcome: `{ "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }`
- Residual Docker resources after run: `docker ps -a --filter name=nmtest` and
  `docker network ls --filter name=nmtest` both empty — zero residual containers/networks.

Full-suite escalation criteria (shared tenant/auth primitives changed, shared WhatsApp processing
changed broadly, focused tests exposed a regression, or CI policy requires it) were not met for
the same reasons as R0 (§9): the change is scoped to one route file's public-API resolver plus its
own focused test; `clinicResolver.ts`, `/evolution-webhook`, and Meta/Instagram code are untouched.
Full `server:test` (77-member legacy aggregate) was not additionally run.

### 14.11 R1 program-control status (unchanged)

Same as §13 — F2-SEC-001, shared program-control files, CI guardrail authorization, and Stage 2
Imaging were not touched by this follow-up task either.

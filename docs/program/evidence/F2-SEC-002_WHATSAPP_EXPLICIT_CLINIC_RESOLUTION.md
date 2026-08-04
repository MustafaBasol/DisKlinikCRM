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

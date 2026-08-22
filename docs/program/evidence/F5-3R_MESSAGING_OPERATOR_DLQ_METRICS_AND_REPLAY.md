# F5-3R — Messaging Operator DLQ, Metrics and Replay Authorization

**Task:** ClickUp `F5-3R` ([`869enk953`](https://app.clickup.com/t/869enk953)), under `EPIC F5` ([`869ed1jvf`](https://app.clickup.com/t/869ed1jvf)) — repository phase `F6`.
**Baseline:** `origin/main` @ `31eb79f0d2a68445ccd835943d0d67600710f08c` (PR #482 merge), re-fetched at task start. The F5-3 merge `70ba73e` it builds on is an ancestor.
**Branch:** `feature/f5-3r-messaging-operator-replay`, cut from fresh `origin/main` — **not** stacked on F5-2R.

**72 new tests · 72 PASS · 0 FAIL** — 19 DB-free contract tests appended to the existing messaging suite, and 53 against a real disposable PostgreSQL 16 running the **real Express middleware chain** — plus server typecheck, frontend typecheck/build, the log-privacy guard, the architecture guardrail, and six existing suites re-run.

**No production system was contacted. Nothing is merged, deployed, migrated in production, or activated.** No schema migration was created. `MESSAGING_DURABLE_ACK_ENABLED` is untouched and remains default OFF.

---

## 0. The blocker this closes

F5-3 §13, open item 2:

> **No operator HTTP route.** As in F5-2, DLQ/metrics/replay ship as services. Role authorization for replay is therefore undecided by design — that contract is its own reviewable change.

and the runbook's §0:

> **There is no operator HTTP route yet.** … Until a route with a reviewed authorization contract exists, every action below is an engineer action.

That is the whole scope. **No F5-3 architecture was reopened**: `MessagingInboundEvent` remains the single inbound durability ledger, no Redis/BullMQ path was introduced, the retry job and the terminal-state vocabulary are unchanged, and the three services are *called*, not rewritten.

---

## 1. What was built

| Area | Module | Change |
|---|---|---|
| Operator capabilities | `utils/roles.ts` | two helpers |
| Paginated, scope-aware DLQ page + organization metrics | `messaging/messagingInboundDlq.ts` | **additive**; the F5-3 functions are untouched |
| Operator HTTP contract | `routes/messagingReliability.ts` | **new** |
| Router mount | `index.ts` | one line, behind auth + tenant context + CSRF |
| Platform aggregate metric | `routes/platformAdmin.ts` | one route, aggregate only |
| System-context inventory | `tests/tenantSystemContextInventory.test.ts` | declared call-site count 9 → 18 |
| Contract tests | `tests/messagingReliability.test.ts` | +19 |
| Real-database route tests | `tests/dbVerification/messagingOperatorRoutes.test.ts` | **new**, 53 |

**No migration.** Every field the routes read already exists. **No new `SystemContextReason`** — the routes take no system context at all; system execution stays inside the services under the existing `inbound-webhook-envelope` reason. **No new raw SQL.**

---

## 2. The actor model — derived from the repository, not invented

`utils/roles.ts` already defines seven canonical roles and an established operational gate: `canViewOperations` (audit logs, operational events) admits `OWNER`, `ORG_ADMIN` and `CLINIC_MANAGER`, and `operationalMonitoring.ts` scopes `CLINIC_MANAGER` to `allowedClinicIds` while letting `OWNER`/`ORG_ADMIN` reach every clinic in their own organization.

The messaging DLQ is the same class of data — operational metadata about the organization's own messages — so it inherits that answer rather than inventing a new one. The runbook's §0 role table, accepted in F5-3, already stated who may inspect and who may replay, each marked "(once a route exists)". **Building the route is not licence to change the answer**, so the table is the specification and a test holds the code to it.

| Actor | Metrics | DLQ listing | Replay |
|---|---|---|---|
| `OWNER` / `ORG_ADMIN` | own organization, whole | own organization, whole | ✅ |
| `CLINIC_MANAGER` | own clinics only | own clinics only | ✅ own clinics only |
| `DENTIST` / `RECEPTIONIST` / `BILLING` / `ASSISTANT` | 403 | 403 | 403 |
| Platform admin | **platform-wide aggregate only** | ❌ none exists | ❌ none exists |

Two capabilities were added, `canViewMessagingReliability` and `canReplayMessagingInboundEvent`, with **identical role sets today**. They are separate functions on purpose: they answer different questions — "may this actor read operational metadata" versus "may this actor cause a message to be produced to a patient" — and someone narrowing replay must not be forced to blind operators in the same motion. The repository already sets that precedent: `canViewOperations` and `canResolveOperationalEvents` share a role set and stand apart.

### Scope derivation

Every handler builds its scope from `req.user` and nothing else:

```
organizationId  <- req.user.organizationId
clinicScope     <- OWNER/ORG_ADMIN ? ORGANIZATION_WIDE : EXPLICIT(allowedClinicIds ?? [])
actor           <- req.user.id / req.user.role
```

An **EXPLICIT scope with an empty clinic list reaches nothing.** An empty array has never meant "all" in this repository, and this is one of the places where getting it backwards would be a cross-clinic disclosure. Asserted for listing, metrics and replay independently.

An **unrouted** event (`clinicId` null — routing never resolved a clinic) is reachable only organization-wide, matching `isClinicWithinScope`'s existing rule. It is absent from a clinic-scoped listing *and* refused on replay, so an operator is never shown a row they would then be refused permission to act on.

---

## 3. Route contracts

### `GET /api/ops/messaging/reliability/metrics`

Organization-scoped: status counts, `retryDue`/`retryScheduled`, `oldestUnresolvedAgeMs`, `oldestDeadAgeMs`, `deadByCode`, `byChannelProvider`.

`getMessagingInboundMetrics()` — F5-3's function — is cross-tenant **by design**, and handing it to a clinic operator would disclose how many messages every other organization is failing to process. Not catastrophic, and exactly the kind of small cross-tenant leak that is never noticed and never justified. So `getOrganizationMessagingMetrics()` was added beside it: organization predicate required, clinic scope applied the same way the listing applies it. The F5-3 function is untouched and still serves the platform route.

Cardinality is bounded to status × channel × provider. **No per-clinic, per-connection, per-patient or per-message dimension** — asserted by looking for the fixture's own clinic ids in the response and requiring their absence.

### `GET /api/ops/messaging/reliability/dead`

| Query | Behaviour |
|---|---|
| `page` | 1-based; nonsense/zero/negative → 1 |
| `limit` | default 25, **max 100**; oversized is **clamped**, nonsense falls back to the default |
| `clinicId` | must be inside scope, else **403 `CROSS_CLINIC_REFUSED`** |
| `channel`, `provider` | optional filters |

Clamping rather than rejecting is deliberate: `limit=100000` is far more likely a careless client than an attack, and a 400 teaches it nothing actionable. What must never happen is the value being *honoured*.

A requested clinic outside scope is **refused, not silently intersected away**: "I asked for clinic X and got an empty list" is indistinguishable from "clinic X is clean", and an operator hunting a missing message deserves to know which.

**Deterministic total order:** `deadLetteredAt DESC, id ASC`. The tiebreak is load-bearing — rows dead-lettered by one sweep share a timestamp to the millisecond, and paging a non-total order shows one row twice and silently skips another. Proved by creating seven rows with an identical `deadLetteredAt`, paging through them at `limit=2`, and asserting the union is exactly the seven with no duplicate.

`total` is computed from the **same predicate** as `rows`, scope included, via one shared builder. A listing whose count comes from a different `WHERE` reports a total the operator can never page to, and invites the two to drift apart precisely on the clinic predicate.

Row fields are a closed contract asserted by exact key-set equality: `id`, `channel`, `provider`, `connectionId`, `clinicId`, `providerMessageId`, `attempts`, `lastErrorCode`, `deadLetteredAt`, `createdAt`, `ageMs`, `replayCount`. **No `rawPayload`, `errorMessage`, `fromPhone` or `toPhone`.**

### `POST /api/ops/messaging/reliability/dead/:id/replay`

Body must be empty. Thirteen tenant-describing field names — including snake_case spellings — are **refused 400 `TENANT_FIELDS_NOT_ACCEPTED`** rather than silently ignored. Silent ignoring is safe today and becomes unsafe the moment someone adds `...req.body` to a service call; a refusal is a test that keeps failing until the mistake is removed.

| Status | Codes |
|---|---|
| 200 | `{ eventId, replayCount, maxReplays }` |
| 400 | `TENANT_FIELDS_NOT_ACCEPTED`, `INVALID_REQUEST` |
| 403 | `FORBIDDEN`, `CROSS_CLINIC_REFUSED` |
| 404 | `NOT_FOUND` |
| 409 | `NOT_TERMINAL`, `ALREADY_PROCESSED`, `REPLAY_LIMIT_EXCEEDED` |
| 422 | `NO_REDELIVERY_HANDLER`, `UNROUTABLE`, `NO_STORED_PAYLOAD` |

The map is proved **total** over the service's refusal union by parsing the union out of the service's own source — a refusal the route did not know about would fall through to a generic 400 and tell an operator nothing.

---

## 4. 404 versus 403 — a decision, stated

Cross-**organization** is `404 NOT_FOUND`, indistinguishable from a nonexistent id. Anything else makes the endpoint a cross-tenant id oracle. The service already collapses the two; the route keeps that.

Cross-**clinic inside the caller's own organization** is `403 CROSS_CLINIC_REFUSED`. The caller already knows their organization has other clinics, so the 403 discloses nothing new — and it tells a clinic manager to escalate to an org admin rather than to open a bug saying the event vanished. Collapsing it to 404 would trade a real operational signal for a confidentiality gain that does not exist.

Both are asserted, including the paired test that the **same caller with the clinic added to scope succeeds** — which is what proves the refusal was the scope and not something incidental.

---

## 5. Outbox and messaging stay separate

F5-2's `replayDeadOutboxEvent` creates a **new** event with causation and leaves the dead row as evidence. F5-3's `replayDeadInboundEvent` **reuses the row**, because an inbound event's identity is the provider's own message id and a second row would violate the dedupe constraint that makes the ledger work.

Exposing the outbox through a messaging route would collapse two lifecycles that were deliberately kept apart, and would hand an operator a generic "replay" button whose semantics change with the row it lands on. A structural test asserts the route module contains no outbox import, no `replayDeadOutboxEvent` reference and no `OutboxEvent` reference **in code** — comment lines are excluded, so the decision can be documented in the file without the guard forbidding its own explanation.

**Follow-up recorded, not built:** an outbox operator route (metrics / DLQ / replay over `OutboxEvent`) is still absent. F5-2 §14 open item 2 remains open and is its own task.

---

## 6. Platform-admin privacy

`GET /api/platform/messaging/reliability/metrics` returns the cross-tenant **aggregate only** — status/channel/provider counts summed across organizations, which disclose no single tenant's identity or content.

There is **no** platform-wide dead-event listing and no platform-wide replay, and that is a decision rather than an omission. A dead-letter row names a tenant, a connection and a provider message id; reading one across tenants is support access to a customer's operational data. This repository has **no break-glass / support-access architecture** — no elevation flow, no customer-visible record, no scoped-and-expiring grant (verified: `breakGlass`/`break_glass` appears nowhere in `server/src`). Inventing one inside this task would be exactly the broad support impersonation that must not be introduced casually.

A platform admin needing a specific tenant's rows asks that tenant's `OWNER`/`ORG_ADMIN`, who has the scoped route. Asserted structurally: the platform router references neither `listDeadInboundEventPage` nor `replayDeadInboundEvent`.

---

## 7. Audit

Every **successful** replay writes `AuditLog` `messaging_inbound_event_replayed` — the F5-3 service already did this; F5-3R proves it end to end through the route:

- exactly **one** row per successful replay;
- attributed to the **session user**, not a system principal;
- carrying the correct `clinicId`, `entityId` and `entityType`;
- containing **no** message content and **no** phone number, asserted against fixtures that deliberately carry both;
- **concurrent replays write exactly one row**, matching the one transition — the trail never claims three replays happened.

**Refusals write no audit row**, deliberately: an id-guessing script would otherwise be an unbounded write amplifier against the compliance trail. Refusals remain visible in ordinary request logs.

---

## 8. KVKK / data minimisation

- No response at any status carries `rawPayload`, `errorMessage`, `fromPhone` or `toPhone`. Every fixture row is created **with** a phone number, a raw exception string in `errorMessage`, and a distinctive marker inside `rawPayload`, and every response — success and each of the five refusal shapes — is searched for all three. A test that asserts "no phone was returned" against a row that never had one proves nothing.
- The one place a forbidden field *name* legitimately appears is the 400 body, which echoes **which** field was rejected so the caller can fix their request. A dedicated test pins that split: the name is present, the value the caller sent is not.
- The route module contains no `prisma.`, no `fromPhone`/`toPhone`/`errorMessage` reference, and exactly one occurrence of `rawPayload` — as a refused input field name.
- Metrics carry no unbounded dimension; `byChannelProvider` entries are exactly `{channel, provider, failed, dead}`.
- `log-privacy-guard --strict-baseline`: 311 files, **no new violations**.

---

## 9. Test results

| Command | Layer | Exit | Pass | Fail |
|---|---|---|---|---|
| `npm run test:messaging-reliability` (49 → **68**, +19) | 2 | 0 | 68 | 0 |
| `npm run test:messaging-operator-routes-db` (**new**, real PostgreSQL 16) | 3 | 0 | 53 | 0 |
| `npm run test:messaging-inbound-reliability-db` | 3 | 0 | 28 | 0 |
| `npm run test:roles` | 2 | 0 | 142 | 0 |
| `npm run test:auth` (`platformAdmin.test.ts`) | 2 | 0 | 118 | 0 |
| `npm run test:tenant-system-context-inventory` | 2 | 0 | 16 | 0 |
| `npm run test:raw-sql-tenant-audit` | 2 | 0 | 12 | 0 |
| `npm run test:tenant-model-classification` | 2 | 0 | 28 | 0 |
| `server npx tsc --noEmit` | 1 | 0 | — | — |
| `npx tsc -b` (frontend) | 1 | 0 | — | — |
| `npm run log-privacy-guard:scan -- --strict-baseline` | 1 | 0 | 311 files, no new violations | — |
| `npm run guardrail:scan` | 1 | 0 | — | — |

### Two defects this task found in its own work, and fixed

1. **The system-context inventory drifted.** Adding nine `prisma.messagingInboundEvent.*` sites to `messagingInboundDlq.ts` broke `tenantSystemContextInventory`'s declared count (9 → 18). The registry entry was updated with a justification naming what the new sites are and why they need no new reason. This is the governance control working exactly as intended.
2. **A structural test was passing vacuously.** A regex written through a shell heredoc acquired a literal backspace byte (0x08) where `\b` was intended, so `/\bwhere\s*[,}]/` silently matched nothing. Caught because the assertion *failed* rather than passing — the failure was the honest one. Every changed file was then byte-audited for stray control characters; the count is now zero.

### Coverage against the task's required security matrix

Covered: clinic A cannot inspect clinic B's dead events · clinic A cannot replay clinic B's event · sibling-clinic restrictions (two-clinic manager sees both, not the third) · organization-wide role behaviour · empty explicit scope reaches nothing (listing, metrics **and** replay) · unrouted events organization-wide only · platform-admin minimized view · body-supplied `organizationId` refused (both spellings) · body-supplied `clinicId` refused (both spellings) · eleven more body fields refused · raw payload never returned · replay of a processed event rejected · replay of an already-requeued event rejected · concurrent replay exactly one transition · audit written on successful replay · audit has no PII · audit not written on refusal · pagination bounded · invalid limit clamped · invalid page clamped · deterministic total order across pages · unsupported channel rejected · unroutable rejected · no stored payload rejected · missing actor scope rejected · role gate for the four non-operator roles · no new system bypass · no outbox surface reachable · log-privacy regression.

**Not covered, and honestly so:**
- **No end-to-end HTTP transport test.** The suite runs the real router stack (`authorize()` included) with a mock `req`/`res`, which is this repository's established `dbVerification` convention. What is therefore *not* proved here is CSRF and cookie-session behaviour; those are properties of `authenticate`/`csrfProtection`, already covered by `sessionCookieCsrf.test.ts`, and the mount ordering that puts this router behind both is asserted structurally instead.
- **No load or cardinality measurement.** The page cap is 100 and metrics group by three channel/provider pairs; a projection beyond that would be a guess.
- **No frontend.** See §11.

---

## 10. Rollback

The routes are read-plus-one-guarded-mutation over data that already exists; there is nothing to un-apply and no migration to reverse.

1. **Narrowest** — revoke the capability: move users off the role, or a one-line change to `canReplayMessagingInboundEvent`. Inspection and replay are separate functions precisely so replay can be narrowed without blinding operators.
2. **Whole surface** — remove the `app.use('/api', messagingReliabilityRoutes)` line and redeploy. Nothing else imports the router; the services keep serving the retry job.
3. **Never** by deleting rows, editing `status` by hand, or stopping the retry job.

**`MESSAGING_DURABLE_ACK_ENABLED` is not touched by this task and stays OFF.** These routes are merge- and deploy-ready with the fast-ack path disabled; activating it remains a separate gate.

---

## 11. No frontend, deliberately

There is no existing messaging-reliability admin surface to extend cheaply, and the task's own guidance is to stop at the backend contract when that is sufficient for rollout readiness. It is: the runbook's operator procedures are now executable with an authenticated HTTP client, and a UI would add a review surface (bulk-action affordances, accidental payload rendering, a replay button one click from a patient message) with no rollout gain. A minimal view remains a separate, small task if operators ask for one.

---

## 12. Lifecycle

```
F5_3R_AGENT_COMPLETED      = YES
F5_3R_TESTS_PASSED         = YES   (72 new, 0 failed; 6 existing suites re-run green)
F5_3R_PR_OPENED            = YES   (draft)
F5_3R_CI_PASSED            = see the PR record
F5_3R_MERGED               = NO
F5_3R_MIGRATION_DEPLOYED   = N/A   (no migration was created)
F5_3R_APPLICATION_DEPLOYED = NO
F5_3R_FEATURE_ACTIVATED    = NO
F5_3R_PRODUCTION_VERIFIED  = NO
```

`MERGE_SAFE = YES` (subject to program-owner review) · `DEPLOYMENT_SAFE = YES` — the routes are inert until an operator calls them, and calling them changes nothing a reviewed operation could not already do · **`PRODUCTION_CUTOVER_SAFE = NO`** for `MESSAGING_DURABLE_ACK_ENABLED`, which this document does not authorize.

---

## 13. Non-authorization statement

This document authorizes nothing. It does not merge, deploy, run a production migration, enable `MESSAGING_DURABLE_ACK_ENABLED`, or perform any production cutover. It records what was implemented to close a recorded rollout blocker, what was measured, and what remains open.

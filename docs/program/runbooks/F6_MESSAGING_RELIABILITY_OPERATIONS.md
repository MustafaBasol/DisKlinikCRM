# F6 — Messaging Reliability Operations Runbook

**Status: NOT YET OPERATIONAL.** As of F5-3 this ships unmerged. The terminal states, backoff, timeouts, DLQ view and replay take effect on deploy; the one production-visible behaviour change (durable acceptance before ACK) is behind `MESSAGING_DURABLE_ACK_ENABLED`, default OFF. Nothing here has been exercised in production.

**Scope.** Inbound messaging durability (`MessagingInboundEvent`), the inbound retry job, and outbound provider calls for Meta WhatsApp, Evolution WhatsApp and Instagram. The F5-2 transactional outbox has its own runbook: [`F6_OUTBOX_OPERATIONS.md`](F6_OUTBOX_OPERATIONS.md).

Related: [`../evidence/F5-3_MESSAGING_RELIABILITY_DLQ_AND_REPLAY.md`](../evidence/F5-3_MESSAGING_RELIABILITY_DLQ_AND_REPLAY.md) · [`F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md`](F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md) · [`F4_RECOVERY_OPERATIONS.md`](F4_RECOVERY_OPERATIONS.md)

---

## 0. Who may do what

| Action | Clinic operator | Platform operator | Engineer |
|---|---|---|---|
| See their own clinic's failed/terminal messages | ✅ scoped to their clinics (§14) | ✅ | ✅ |
| See another organization's messages | ❌ never | Only under an explicitly authorized platform contract | ❌ by default |
| Read platform-wide messaging health metrics | ❌ | ✅ | ✅ |
| Replay a terminal inbound message | ✅ within their clinic scope (§14) | Aggregate metrics only — no cross-tenant listing or replay (§14) | Via a reviewed operation |
| Flip `MESSAGING_DURABLE_ACK_ENABLED` | ❌ | ❌ | ✅ |
| Change `MESSAGING_HTTP_TIMEOUT_MS` | ❌ | ❌ | ✅ |
| Edit `status`, `attempts`, `rawPayload` by hand | ❌ | ❌ | ❌ without a reviewed plan |

**F5-3R added the operator HTTP routes — see §14 for the full contract.** `GET /api/ops/messaging/reliability/metrics`, `GET /api/ops/messaging/reliability/dead` and `POST /api/ops/messaging/reliability/dead/:id/replay`, behind the normal clinic session and the role table above. The platform-admin surface is the cross-tenant **aggregate metric only**. `MESSAGING_DURABLE_ACK_ENABLED` remains OFF and is unaffected.

---

## 1. Reading the state

`MessagingInboundEvent.status` now has five meanings, and the point of F5-3 is that they are finally distinguishable:

| Status | Meaning |
|---|---|
| `received` | Accepted, not yet picked up. |
| `processing` | A processor holds it. Stuck >1h → swept back to `failed` as `STUCK_IN_PROCESSING`. |
| `processed` | Done. Terminal, and the good kind. |
| `failed` | **Retryable.** Check `nextAttemptAt`: in the future = in backoff, by design. |
| `dead` | **Terminal.** Nothing will retry it. `lastErrorCode` says why; `deadLetteredAt` says when. |

Before F5-3, the last two were the same value. A `failed` row could be about to retry, or permanently abandoned, with no way to tell.

---

## 2. Alarms and what they mean

| Signal | Meaning | Go to |
|---|---|---|
| `oldestUnresolvedAgeMs` rising past ~30 min | Inbound messages are not being processed | §3 |
| `retryDue` rising while `retryScheduled` is flat | The retry job is not running | §3 |
| `dead` rising | Messages are terminally failing | §4 |
| `deadByCode.PROVIDER_OUTAGE` / `.TIMEOUT` climbing | A provider is down or hanging | §5 |
| `deadByCode.RATE_LIMIT` | We are being throttled | §6 |
| `deadByCode.AUTH_CONFIGURATION` | A clinic's credentials are revoked/invalid | §7 |
| `deadByCode.NO_RETRY_HANDLER` | Evolution/Instagram failures — **expected**, see §8 |
| `deadByCode.RETRY_WINDOW_EXPIRED` | Messages aged out before succeeding | §3, then §9 |
| `deadByCode.STUCK_IN_PROCESSING` | Processors are dying mid-message | §10 |
| `byChannelProvider` skewed to one channel | The problem is that channel, not messaging | §5 |

---

## 3. Inbound backlog is growing

1. **Is the retry job running?** It logs `[inbound-retry] Failed inbound event retry job scheduled (every 10 min).` at startup. A tick with nothing to do is silent by design.
2. **Is it holding its lease?** `withJobLock('inbound-event-retry', …)`. A stale `JobLock` row blocks every replica. Check `JobLock` for `lockedUntil` in the past with nobody renewing.
3. **Are rows in backoff rather than stuck?** `retryScheduled` vs `retryDue` separates them. A large `retryScheduled` during a provider outage is the backoff working, not a fault.
4. **Is a hung outbound call holding the tick?** Before F5-3 this was the likeliest cause and was invisible; now every provider call is bounded at `MESSAGING_HTTP_TIMEOUT_MS` (15s default) and a hang surfaces as `TIMEOUT` rather than a stalled job.

---

## 4. Terminal (dead) messages

Inspect with `listDeadInboundEvents({ organizationId, clinicId?, channel?, provider? })`. It returns identifiers, stable codes, attempt counts, ages and timestamps — **never the message content, never the raw payload, never the patient's phone number**. That is a KVKK property, not an inconvenience: an operator must be able to diagnose without reading a patient's message.

To correlate with what the patient actually sent, use `providerMessageId` + `connectionId` in the **provider's own console**. That is the authoritative record and it is already access-controlled there.

---

## 5. Provider outage

Symptoms: `deadByCode.PROVIDER_OUTAGE` or `.TIMEOUT` climbing, concentrated in one `byChannelProvider` row.

1. Confirm at the provider's status page. `PROVIDER_OUTAGE` is a real 5xx; `TIMEOUT` means they accepted the connection and never answered — often worse, and often not on a status page.
2. **Do nothing to the queue.** Backoff is exponential with full jitter and is already spreading the retries. The pre-F5-3 fixed five-minute floor is exactly what would have produced a synchronised retry storm here.
3. Messages that exhaust their 3 attempts become `dead`/`MAX_ATTEMPTS_EXCEEDED`, and messages older than six hours become `dead`/`RETRY_WINDOW_EXPIRED`. Both are **inspectable and replayable** — this is what F5-3 added.
4. After recovery, replay selectively (§9). Consider whether replaying a hours-old conversational turn is right for the patient before doing it in bulk.

**There is no circuit breaker,** deliberately — see the evidence document §3. If an outage shows the backoff failing to absorb the load, that is the recorded trigger to add one; capture the metrics as the evidence.

---

## 6. Rate limiting (429)

`Retry-After` is now parsed and honoured as a **floor** on the backoff (never a ceiling — a provider may ask for more time than our policy would give, never less), and clamped to one hour so a malformed or hostile header cannot park an event for a week.

If 429s persist beyond the provider's stated window, the cause is send *volume*, not retry behaviour. Look at reminder scheduling and template sends, not at this job.

---

## 7. Invalid provider credentials

`AUTH_CONFIGURATION` is **not retryable**, by design: retrying a rejected credential cannot fix it and can get the account locked. The event goes terminal on the first occurrence.

This is a **tenant configuration problem**. The clinic must fix its WhatsApp/Instagram connection. Once they have, replay the affected messages (§9) — replay re-checks everything and will refuse if the situation has not actually changed.

---

## 8. `NO_RETRY_HANDLER` — expected, not a fault

Evolution WhatsApp and Instagram inbound failures become `dead`/`NO_RETRY_HANDLER`. **This is the designed behaviour, not a regression.** Those channels have never had automatic re-delivery; before F5-3 their failures sat `failed` forever, invisible and indistinguishable from retryable ones. Now they are visible.

They cannot be replayed either — `replayDeadInboundEvent` refuses with `NO_REDELIVERY_HANDLER` rather than reporting a success that silently did nothing. Building those handlers means re-running a conversational AI turn hours late, which is a product decision (see `messaging/messagingRedeliveryRegistry.ts`, where the reasoning lives and where adding a handler is a one-line change).

**What to do when one appears:** treat it as "a patient messaged us on this channel and we did not answer". Have the clinic follow up manually via the provider console.

---

## 9. Manual replay

`POST /api/ops/messaging/reliability/dead/:id/replay` (§14), or `replayDeadInboundEvent({ eventId, authorization })` directly from a reviewed script.

Replay **reuses the row** — it does not clone the envelope, because the provider's message id is the row's identity and a second row would violate the dedupe constraint that makes the ledger work. The row returns to `failed` with `attempts: 0`, `nextAttemptAt: now`, and `replayCount` incremented. Every success writes an `AuditLog` row (`messaging_inbound_event_replayed`) carrying identifiers and stable codes only.

| Refusal | Meaning |
|---|---|
| `NOT_FOUND` | No such event, **or** it belongs to another organization (deliberately indistinguishable) |
| `CROSS_CLINIC_REFUSED` | Outside the caller's clinic scope — including an unrouted (`clinicId: null`) event, which only an organization-wide caller may reach |
| `NOT_TERMINAL` | Only `dead` may be replayed; a `failed` row is already the retry job's |
| `ALREADY_PROCESSED` | It succeeded; replaying would duplicate the patient's reply |
| `REPLAY_LIMIT_EXCEEDED` | 2 replays already |
| `NO_REDELIVERY_HANDLER` | §8 |
| `UNROUTABLE` | No `connectionId`; it cannot be routed to a tenant at all |
| `NO_STORED_PAYLOAD` | No envelope to re-drive |

**There is deliberately no bulk-replay endpoint**, and before replaying several rows by hand after an outage, ask whether the patient still wants the answer. The six-hour retry window exists because a stale AI reply is its own kind of failure.

---

## 10. Stuck processors

`STUCK_IN_PROCESSING` means a row sat in `processing` for over an hour and was swept back to `failed`. `attempts` is **not** reset by the sweep — it was incremented when the attempt was claimed, which is what bounds a crash loop.

A steady trickle is normal (deploys, restarts). A rising count means processes are dying mid-message; find out why. If a row reaches the attempt ceiling purely through repeated sweeps it becomes `dead`/`MAX_ATTEMPTS_EXCEEDED`, which is correct — a message that reliably kills its processor must not retry forever.

---

## 11. Enabling durable acceptance before ACK

`MESSAGING_DURABLE_ACK_ENABLED=true` moves the 200 to **after** the inbound ledger write on the Meta WhatsApp and Instagram webhooks. Evolution already had this ordering.

**Why it matters:** with it off, a crash between the 200 and the ledger write loses the message permanently, and Meta never redelivers a webhook it has already 200'd.

**Rollout:**
1. Deploy the migration and application with the flag OFF. Verify normal traffic.
2. Set the flag on **one** replica if the topology allows, or during a low-traffic window.
3. Watch provider-side webhook error rates for an hour. The ACK now waits on a parse, a lookup, a signature check and one INSERT — a few milliseconds — but if the database is slow, the provider will see it.
4. A 503 from a webhook is the new, intended behaviour when acceptance fails: it makes the provider retry instead of losing the message.

**Rollback:** unset the flag and restart. The 200 returns to the top of the handler. No data change, no migration involved.

---

## 12. Database unavailable

Messaging has no separate failure domain — the ledger is the application's own PostgreSQL. If the database is down, see [`F4_RECOVERY_OPERATIONS.md`](F4_RECOVERY_OPERATIONS.md).

Note the interaction with §11: with durable-ack **on**, a database outage makes the webhooks answer 503 and the providers retry — messages that arrive during the outage are redelivered afterwards. With it **off**, those messages are 200'd and lost. That is the single strongest argument for turning it on.

---

## 14. The operator routes (F5-3R)

As of F5-3R the three services have an authenticated HTTP surface. Everything in §1, §4 and §9 is now an operator action rather than an engineer action, within the scope table in §0.

All three live behind the normal clinic session: `authenticate` → tenant context → `csrfProtection('clinic')` → `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])`. **`MESSAGING_DURABLE_ACK_ENABLED` is untouched and still OFF** — these routes are merge- and deploy-ready with the fast-ack path disabled.

### Who may do what

| | OWNER / ORG_ADMIN | CLINIC_MANAGER | DENTIST / RECEPTIONIST / BILLING / ASSISTANT | Platform admin |
|---|---|---|---|---|
| Read organization metrics | ✅ whole organization | ✅ own clinics only | ❌ 403 | ✅ but only the **platform-wide aggregate** |
| List dead events | ✅ whole organization | ✅ own clinics only | ❌ 403 | ❌ — see below |
| Replay a dead event | ✅ | ✅ own clinics only | ❌ 403 | ❌ |

An **unrouted** event (`clinicId` null — routing never resolved a clinic) is reachable **only** organization-wide. A clinic-scoped operator neither sees it in a listing nor may replay it, so they can never be shown a row they would then be refused permission to act on.

An operator's clinic reach comes from their session, never from the request. An **empty** authorized clinic list reaches **nothing** — an empty array has never meant "all" in this system.

### `GET /api/ops/messaging/reliability/metrics`

Organization-scoped. Status counts, `retryDue`/`retryScheduled`, `oldestUnresolvedAgeMs`, `oldestDeadAgeMs`, `deadByCode`, and a `byChannelProvider` breakdown.

This is **not** the platform-wide metric. A clinic operator asking "is messaging healthy" must not be told how many messages every other organization is failing to process.

### `GET /api/ops/messaging/reliability/dead`

| Query | Behaviour |
|---|---|
| `page` | 1-based. Nonsense, zero or negative → page 1. |
| `limit` | Default 25, **maximum 100**. An oversized value is **clamped**, never honoured; a nonsense value falls back to the default. |
| `clinicId` | Must be inside your scope, or **403 `CROSS_CLINIC_REFUSED`** — deliberately not an empty list, because "I asked for clinic X and got nothing" is indistinguishable from "clinic X is clean". |
| `channel`, `provider` | Optional filters. |

Response: `{ rows, total, page, pageSize, maxPageSize, defaultPageSize }`. `total` is computed from the **same** predicate as `rows`, scope included.

Each row carries: `id`, `channel`, `provider`, `connectionId`, `clinicId`, `providerMessageId`, `attempts`, `lastErrorCode`, `deadLetteredAt`, `createdAt`, `ageMs`, `replayCount`.

It does **not** carry `rawPayload`, `errorMessage`, `fromPhone` or `toPhone`. To see the conversation, use `providerMessageId` + `connectionId` in the provider's own console — that keeps a patient identifier off the operator's screen and out of your browser history.

Sorting is `deadLetteredAt DESC, id ASC`. The `id` tiebreak is load-bearing: rows dead-lettered by one sweep share a timestamp to the millisecond, and paging a non-total order shows one row twice and silently skips another.

### `POST /api/ops/messaging/reliability/dead/:id/replay`

Body must be **empty**. Any of `organizationId`, `clinicId`, `provider`, `channel`, `connectionId`, `providerMessageId`, `rawPayload`, `payload`, `status`, `attempts`, `replayCount` (and the snake_case spellings) is **refused 400 `TENANT_FIELDS_NOT_ACCEPTED`**. Replay re-drives the stored event exactly as it arrived; there is no supported way to alter what gets re-delivered, or whose it is.

| Status | Code | Meaning |
|---|---|---|
| 200 | — | Requeued. `{ eventId, replayCount, maxReplays }` |
| 400 | `TENANT_FIELDS_NOT_ACCEPTED` | The body tried to name a tenant, a provider or a payload |
| 403 | `FORBIDDEN` | Your role may not replay |
| 403 | `CROSS_CLINIC_REFUSED` | The event's clinic is outside your scope — **escalate to an org admin**, the event exists |
| 404 | `NOT_FOUND` | No such event, **or** it belongs to another organization. Deliberately indistinguishable |
| 409 | `NOT_TERMINAL` | Only `dead` may be replayed. A `failed` row is already the retry job's |
| 409 | `ALREADY_PROCESSED` | It succeeded; replaying would duplicate the patient's reply |
| 409 | `REPLAY_LIMIT_EXCEEDED` | 2 replays already |
| 422 | `NO_REDELIVERY_HANDLER` | §8 — this channel has no handler, so a replay would do nothing |
| 422 | `UNROUTABLE` | No `connectionId`; it cannot be routed to a tenant at all |
| 422 | `NO_STORED_PAYLOAD` | No envelope to re-drive |

**404 vs 403 is a deliberate split.** Another organization's id must be indistinguishable from a nonexistent one, or the endpoint is a cross-tenant id oracle. A **sibling clinic inside your own organization** is different: you already know your organization has other clinics, so `403` discloses nothing new and tells you to escalate rather than to file a bug about a vanished event.

### Concurrent replay

The transition is guarded on `status = 'dead'`, so **N simultaneous replays produce exactly one requeue**. The losers get `409 NOT_TERMINAL`. `replayCount` increments once and exactly one `AuditLog` row is written — the audit trail never claims three replays happened.

### Audit

Every **successful** replay writes `AuditLog` `messaging_inbound_event_replayed`, attributed to the session user (not a system principal), carrying `channel`, `provider`, `providerMessageId`, `previousErrorCode` and `previousAttempts`. No message content, no phone number, no provider body.

**Refusals write no audit row.** That is deliberate: an id-guessing script would otherwise be an unbounded write amplifier against the compliance trail. Refusals are visible in the ordinary request logs.

To verify a replay after the fact:

```sql
SELECT "createdAt", "actorUserId", "actorRole", "entityId", metadata
FROM "AuditLog"
WHERE action = 'messaging_inbound_event_replayed'
  AND "organizationId" = '<org>'
ORDER BY "createdAt" DESC LIMIT 20;
```

### Provider outage

During an outage the DLQ fills with `PROVIDER_OUTAGE`/`NO_REDELIVERY_HANDLER`. **Do not page through it replaying rows one at a time** — there is deliberately no bulk replay (§13), and §9's warning still applies: ask whether the patient still wants an answer to a question from six hours ago before re-driving it.

### Platform-admin visibility

`GET /api/platform/messaging/reliability/metrics` returns the **cross-tenant aggregate only** — the same status/channel/provider counts, summed across organizations. There is deliberately **no** platform-wide dead-event listing and no platform-wide replay.

That is a decision, not an omission. A dead-letter row names a tenant, a connection and a provider message id; reading one across tenants is support access to a customer's operational data, and this repository has no break-glass architecture to hang it on — no elevation flow, no customer-visible record, no scoped-and-expiring grant. Inventing one inside this task would be exactly the broad support impersonation that must not be introduced casually. A platform admin who needs a specific tenant's rows asks that tenant's OWNER/ORG_ADMIN, who has the scoped route above.

### Disabling or rolling back the routes

The routes are read-plus-one-guarded-mutation over data that already exists, so there is nothing to un-apply. If they must be withdrawn:

1. **Narrowest** — revoke the capability: move affected users off `CLINIC_MANAGER`/`ORG_ADMIN`, or ship a one-line change to `canReplayMessagingInboundEvent` in `utils/roles.ts`. Inspection and replay are separate functions precisely so replay can be narrowed without also blinding operators.
2. **Whole surface** — remove the `app.use('/api', messagingReliabilityRoutes)` line in `server/src/index.ts` and redeploy. Nothing else imports the router; the services keep working for the retry job.
3. **Do not** disable by deleting rows, editing `status` by hand, or turning off the retry job.

No migration was created by F5-3R, so there is no schema state to reverse.

---

## 13. Things that are NOT operator actions

- **Editing `status`, `attempts`, `nextAttemptAt` or `rawPayload` by hand.** Each defeats a guarantee. Use replay.
- **Setting a `dead` row back to `failed` directly.** That is what replay exists to replace: it skips every authorization and applicability check and writes no audit row.
- **Deleting rows to clear a backlog.** Each is a message a patient actually sent. Inspect and decide.
- **Dropping the F5-3 columns during a rollback.** `dead` rows would become indistinguishable from retryable ones and the replay audit trail would be destroyed.
- **Adding a Redis or BullMQ path for inbound messages.** `MessagingInboundEvent` is the durability ledger; a Redis-only acceptance path would *weaken* the guarantee (F5-1P §7). A test fails the build if any messaging module imports `bullmq`, `ioredis` or `redis`.
- **Raising `MESSAGING_HTTP_TIMEOUT_MS` to "fix" timeouts.** A longer bound on a hung provider just holds the job lease longer. `TIMEOUT` is a diagnosis, not a tuning problem.

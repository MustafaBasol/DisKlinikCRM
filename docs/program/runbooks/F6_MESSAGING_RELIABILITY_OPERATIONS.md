# F6 — Messaging Reliability Operations Runbook

**Status: NOT YET OPERATIONAL.** As of F5-3 this ships unmerged. The terminal states, backoff, timeouts, DLQ view and replay take effect on deploy; the one production-visible behaviour change (durable acceptance before ACK) is behind `MESSAGING_DURABLE_ACK_ENABLED`, default OFF. Nothing here has been exercised in production.

**Scope.** Inbound messaging durability (`MessagingInboundEvent`), the inbound retry job, and outbound provider calls for Meta WhatsApp, Evolution WhatsApp and Instagram. The F5-2 transactional outbox has its own runbook: [`F6_OUTBOX_OPERATIONS.md`](F6_OUTBOX_OPERATIONS.md).

Related: [`../evidence/F5-3_MESSAGING_RELIABILITY_DLQ_AND_REPLAY.md`](../evidence/F5-3_MESSAGING_RELIABILITY_DLQ_AND_REPLAY.md) · [`F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md`](F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md) · [`F4_RECOVERY_OPERATIONS.md`](F4_RECOVERY_OPERATIONS.md)

---

## 0. Who may do what

| Action | Clinic operator | Platform operator | Engineer |
|---|---|---|---|
| See their own clinic's failed/terminal messages | ✅ (once a route exists) | ✅ | ✅ |
| See another organization's messages | ❌ never | Only under an explicitly authorized platform contract | ❌ by default |
| Read platform-wide messaging health metrics | ❌ | ✅ | ✅ |
| Replay a terminal inbound message | ✅ within their clinic scope (once a route exists) | Under an authorized contract | Via a reviewed operation |
| Flip `MESSAGING_DURABLE_ACK_ENABLED` | ❌ | ❌ | ✅ |
| Change `MESSAGING_HTTP_TIMEOUT_MS` | ❌ | ❌ | ✅ |
| Edit `status`, `attempts`, `rawPayload` by hand | ❌ | ❌ | ❌ without a reviewed plan |

**There is no operator HTTP route yet.** `getMessagingInboundMetrics()`, `listDeadInboundEvents()` and `replayDeadInboundEvent()` ship as services. Until a route with a reviewed authorization contract exists, every action below is an engineer action.

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

`replayDeadInboundEvent({ eventId, authorization })`.

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

**Before replaying in bulk after an outage, ask whether the patient still wants the answer.** The six-hour retry window exists because a stale AI reply is its own kind of failure.

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

## 13. Things that are NOT operator actions

- **Editing `status`, `attempts`, `nextAttemptAt` or `rawPayload` by hand.** Each defeats a guarantee. Use replay.
- **Setting a `dead` row back to `failed` directly.** That is what replay exists to replace: it skips every authorization and applicability check and writes no audit row.
- **Deleting rows to clear a backlog.** Each is a message a patient actually sent. Inspect and decide.
- **Dropping the F5-3 columns during a rollback.** `dead` rows would become indistinguishable from retryable ones and the replay audit trail would be destroyed.
- **Adding a Redis or BullMQ path for inbound messages.** `MessagingInboundEvent` is the durability ledger; a Redis-only acceptance path would *weaken* the guarantee (F5-1P §7). A test fails the build if any messaging module imports `bullmq`, `ioredis` or `redis`.
- **Raising `MESSAGING_HTTP_TIMEOUT_MS` to "fix" timeouts.** A longer bound on a hung provider just holds the job lease longer. `TIMEOUT` is a diagnosis, not a tuning problem.

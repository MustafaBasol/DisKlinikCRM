# F6 — Outbox Operations Runbook

**Status: NOT YET OPERATIONAL.** As of F5-2 the outbox exists in the repository with both flags **OFF**; nothing in this runbook has been exercised in production. This document is written now, with the mechanism, so that whoever turns the flags on is not writing it under pressure.

**Scope.** The F5-2 transactional outbox: `OutboxEvent`, `OutboxConsumerExecution`, the dispatcher, and the one registered contract (`appointment_request.confirmation_requested@1`). Messaging inbound/outbound reliability is a separate lane (F5-3) with its own runbook.

Related: [`../evidence/F5-2_TRANSACTIONAL_OUTBOX_AND_EVENT_REGISTRY.md`](../evidence/F5-2_TRANSACTIONAL_OUTBOX_AND_EVENT_REGISTRY.md) · [`../phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md`](../phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md) · [`F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md`](F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md)

---

## 0. Who may do what

| Action | Clinic operator | Platform operator | Engineer |
|---|---|---|---|
| Read backlog counts for their own organization | ✅ (once a route exists) | ✅ | ✅ |
| Read the dead-letter list for their own organization | ✅ (once a route exists) | ✅ | ✅ |
| Read another organization's events | ❌ never | Only under an explicitly authorized platform contract | ❌ by default |
| Replay a dead event | ✅ within their clinic scope (once a route exists) | Under an authorized platform contract | Via a reviewed operation |
| Acknowledge an `AMBIGUOUS_SIDE_EFFECT` and replay | ❌ | ⚠️ only after checking the provider | ⚠️ only after checking the provider |
| Flip `OUTBOX_*` flags | ❌ | ❌ | ✅ |
| Run a migration | ❌ | ❌ | ✅ |
| `DELETE` / `DROP` anything in these tables | ❌ | ❌ | ❌ without a reviewed plan |

**There is no operator HTTP route yet.** F5-2 ships `getOutboxBacklogMetrics()`, `listDeadOutboxEvents()` and `replayDeadOutboxEvent()` as services only. Until a route with a reviewed authorization contract exists, every action below is an engineer action.

---

## 1. Rollout (first activation)

Order matters. Do not collapse these steps.

1. **Deploy the migration.** `20260822120000_add_outbox_event_and_consumer_execution` is strictly additive; the previous application version ignores both tables. Safe to deploy ahead of the application.
2. **Confirm retention is wired.** ⚠️ **BLOCKER as of F5-2.** `OutboxEvent` and `OutboxConsumerExecution` are new retention surfaces and are not yet in `dataRetentionCleanupJob`. Do not activate until they are.
3. **Deploy the application with both flags still OFF.** Verify normal traffic is unchanged; the dispatcher logs `OUTBOX_DISPATCH_ENABLED is not "true" — dispatcher not scheduled.`
4. **`OUTBOX_DISPATCH_ENABLED=true`, restart.** The dispatcher now drains an *empty* table. Confirm it schedules (`[outbox-dispatcher] scheduled`) and that ticks are silent (a tick with nothing to do logs nothing, by design).
5. **`OUTBOX_PRODUCER_ENABLED=true`, restart.** Convert one appointment request at a clinic with **no** external-calendar integration. Expect: one `OutboxEvent` row `pending` → `processed` within a minute, and one `OutboxConsumerExecution` row `completed`/`CONFIRMATION_SENT`.
6. Watch `oldestPendingAgeMs` for an hour.

---

## 2. Rollback

**Never drop the tables.** They are inert without a dispatcher, and dropping them destroys undelivered obligations.

1. `OUTBOX_PRODUCER_ENABLED=false`, restart. The inline post-commit confirmation path resumes immediately — it is the same code path in use today.
2. Leave the dispatcher running until `pending` and `claimed` reach zero. Anything already published still needs delivering.
3. `OUTBOX_DISPATCH_ENABLED=false`, restart.
4. Revert the application version if the rollback is for a broader reason.
5. Leave the tables and their data in place.

Emergency shortcut (both flags off at once) is acceptable but strands whatever was already published: those rows sit `pending` until a dispatcher runs again. They are not lost.

---

## 3. Alarms and what they mean

| Signal | Meaning | First action |
|---|---|---|
| `oldestPendingAgeMs` rising past ~10 min | The dispatcher is not keeping up, or is not running | §4 |
| `staleLeases > 0` | Replicas are dying mid-flight | §5 |
| `dead` rising | Events are failing terminally | §6 |
| `deadByCode.AUTH_CONFIGURATION` | A clinic's provider credentials are revoked/invalid | Tenant configuration, not an outbox fault |
| `deadByCode.AMBIGUOUS_SIDE_EFFECT` | A dispatcher died between a send and its finalisation | §7 — **do not blind-replay** |
| `deadByCode.MALFORMED_PAYLOAD` / `UNSUPPORTED_VERSION` / `UNREGISTERED_EVENT` | A deploy/version skew, or a hand-written row | §8 |
| `deadByCode.NO_CONSUMER` | A contract is registered with no handler | Code defect; fix and replay |
| One organization holding most of `byOrganization[].pending` | The noisy-neighbour condition | §9 |

---

## 4. Backlog is growing

1. Is the dispatcher running at all? Check for `[outbox-dispatcher] scheduled` at process start and for tick lines. **A silent dispatcher is ambiguous** — a tick with no work logs nothing. Check `OUTBOX_DISPATCH_ENABLED` first.
2. Are rows `pending` with `availableAt` in the future? Then they are in **backoff**, not stuck. `delayed` vs `dispatchable` in the metrics separates these. Look at `lastErrorCode`.
3. Are rows `claimed` with a live lease? Work is in flight; a slow provider is the usual cause.
4. If genuinely under-provisioned, raise `OUTBOX_CLAIM_BATCH_SIZE` (default 20) before adding replicas. **This is also the ADR-007 trigger**: if claim contention rather than batch size is the limit, record the measurement — it is the evidence BullMQ was deferred pending.

---

## 5. Stale leases

A stale lease means a dispatcher process died holding claimed rows. This is **self-healing**: the next tick's `reclaimExpiredOutboxLeases()` returns them to `pending`, and `attemptCount` is deliberately *not* reset, so a crash loop is bounded by the same `maxAttempts` as any other failure.

Persistent stale leases mean a crashing process, not an outbox problem. Find out why the process is dying. If a row reaches `maxAttempts` purely through lease expiry it dead-letters as `MAX_ATTEMPTS_EXCEEDED`, which is correct — a consumer that reliably kills its process must not retry forever.

---

## 6. Dead-lettered events

Inspect with `listDeadOutboxEvents({ organizationId, clinicId? })`. It returns identifiers, stable codes, attempt counts and timestamps — **never the payload and never message content**. That is a KVKK property, not an inconvenience: a dead-letter row must be diagnosable without exposing what was in the message.

To decide what to do, read `deadLetterCode`:

- **retryable-category codes** (`TRANSIENT`, `RATE_LIMIT`, `PROVIDER_OUTAGE`) reaching `dead` means the attempt ceiling was hit. Fix the underlying cause, then replay.
- **`AUTH_CONFIGURATION` / `TENANT_CONFIGURATION`** — the clinic must fix its integration. Replay after they have.
- **`PERMANENT_VALIDATION`** — the provider rejected the request itself. Replaying unchanged will fail identically.
- **`MALFORMED_PAYLOAD` / `UNSUPPORTED_VERSION` / `UNREGISTERED_EVENT`** — see §8.
- **`AMBIGUOUS_SIDE_EFFECT`** — see §7.

---

## 7. `AMBIGUOUS_SIDE_EFFECT` — the one that needs a human

This means a previous attempt committed "about to send", and never came back. **Whether the patient received the message is genuinely unknowable from the database.** The system deliberately refuses to guess: it neither re-sends (which would duplicate a patient message on every dispatcher crash) nor silently drops it.

1. Check the **provider** — WhatsApp/Instagram delivery logs for that clinic around `lastAttemptAt`.
2. If the message **was** delivered: do nothing. Leave the event dead. It is an accurate record.
3. If it was **not** delivered: replay with `acknowledgeAmbiguousSideEffect: true`. That clears the ambiguity marker so the consumer can proceed, and the acknowledgement is recorded in the audit row.

Never pass `acknowledgeAmbiguousSideEffect` without step 1. It is an assertion that you checked.

---

## 8. Version / payload failures after a deploy

`UNSUPPORTED_VERSION` in bulk right after a release almost always means rows written by a **newer** application version are being read by an **older** one (a partial rollout or a rollback).

- Do **not** hand-edit `eventVersion` or `payload`. The refusal is working.
- Complete the rollout, or roll fully back, so one version is serving.
- Then replay the affected events. Replay re-checks the contract and refuses `UNSUPPORTED_CONTRACT`/`MALFORMED_PAYLOAD` up front, so a replay that would die identically is refused before anything is written.

A breaking payload change requires a **new registered version**, with both versions registered and both consumable until the old rows have drained. That is the rule the registry exists to enforce.

---

## 9. One tenant dominating the backlog

F5-2 implements **no** fairness mechanism, deliberately: F5-1P measured a naive post-claim per-tenant cap making quiet-tenant p50 latency five times worse (292ms → 1,962ms), because the dispatcher claimed rows only to write them back.

If `byOrganization` shows one organization holding most of the pending backlog while others wait, **that is the trigger, and it is the measurement to record.** The correct fix is selection-time fairness (a per-tenant round-robin or lateral-join claim that never picks more than N rows per tenant in the first place) — the claim query is already shaped for it. Do not reintroduce a post-claim cap.

Do not create a queue or table per clinic.

---

## 10. Manual replay

`replayDeadOutboxEvent({ eventId, authorization, acknowledgeAmbiguousSideEffect? })`.

Replay creates a **new** event. The dead row stays dead as evidence and gains `replayCount`/`lastReplayedAt`/`lastReplayedBy`; the new row carries the same `idempotencyKey` (so the ledger still suppresses a duplicate), `causationId` pointing back, and the preserved `correlationId`.

Refusals, all checked before anything is written:

| Refusal | Meaning |
|---|---|
| `NOT_FOUND` | No such event, **or** it belongs to another organization (deliberately indistinguishable) |
| `CROSS_CLINIC_REFUSED` | Outside the caller's clinic scope |
| `NOT_TERMINAL` | Only a `dead` event may be replayed |
| `REPLAY_IN_FLIGHT` | A previous replay is still `pending`/`claimed` |
| `REPLAY_LIMIT_EXCEEDED` | 3 replays already |
| `UNSUPPORTED_CONTRACT` / `MALFORMED_PAYLOAD` | It would die identically — §8 |
| `ALREADY_APPLIED` | The side effect is recorded done; replaying would duplicate it |
| `AMBIGUOUS_REQUIRES_ACKNOWLEDGEMENT` | §7 |

Every successful replay writes an `AuditLog` row (`outbox_event_replayed`) with identifiers and stable codes only.

---

## 11. Database unavailable

The outbox has no separate failure domain — it lives in the application's own PostgreSQL. If the database is down, the application is down, and this runbook is not the right one: see [`F4_RECOVERY_OPERATIONS.md`](F4_RECOVERY_OPERATIONS.md).

On recovery, nothing special is needed. Published events are durable; claimed events whose dispatchers died are reclaimed by lease expiry; the dispatcher resumes on its next tick.

---

## 12. Things that are NOT operator actions

- **Editing `status`, `attemptCount`, `payload` or `eventVersion` by hand.** Every one of these defeats a guarantee. Use replay.
- **Setting a dead event back to `pending`.** This is exactly what replay exists to replace: it destroys the failure record, is unaudited, and can duplicate an applied side effect.
- **Deleting rows to clear a backlog.** Each row is an obligation someone is owed. Dead-letter and inspect instead.
- **Dropping the tables during a rollback.** §2.
- **Adding a Redis/BullMQ path "temporarily".** ADR-007 defers it pending a measured trigger; `tests/outboxContracts.test.ts` fails the build if an outbox runtime module imports `bullmq` or `ioredis`.

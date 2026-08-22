# F6 — Outbox Operations Runbook

**Status: NOT YET OPERATIONAL.** As of F5-2/F5-2R the outbox exists in the repository with both flags **OFF**; nothing in this runbook has been exercised in production. This document is written now, with the mechanism, so that whoever turns the flags on is not writing it under pressure.

**F5-2R (2026-08-22)** closed the retention rollout blocker: both tables are now governed by the existing data-retention architecture (§13). The flags remain OFF and no production action has been taken.

**Scope.** The F5-2 transactional outbox: `OutboxEvent`, `OutboxConsumerExecution`, the dispatcher, and the one registered contract (`appointment_request.confirmation_requested@1`). Messaging inbound/outbound reliability is a separate lane (F5-3) with its own runbook.

Related: [`../evidence/F5-2_TRANSACTIONAL_OUTBOX_AND_EVENT_REGISTRY.md`](../evidence/F5-2_TRANSACTIONAL_OUTBOX_AND_EVENT_REGISTRY.md) · [`../evidence/F5-2R_OUTBOX_RETENTION_AND_ROLLOUT_READINESS.md`](../evidence/F5-2R_OUTBOX_RETENTION_AND_ROLLOUT_READINESS.md) · [`../phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md`](../phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md) · [`F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md`](F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md)

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
2. **Confirm retention is wired.** ✅ **Closed by F5-2R.** Both tables are governed by `dataRetentionCleanupJob` (§13). Verify with `GET /api/platform/privacy/data-retention/policy`: `outboxProcessedEventDays`, `outboxDeadEventDays` and `outboxConsumerExecutionDays` must all be present, and the third must be ≥ the first two. Optionally run a **dry run** and confirm the three `outbox*` counts come back as numbers — on a fresh deploy they are all `0`, because the tables are new and no row can be 180 days old.
   **Confirm the kill switches still gate it**: with `privacy.dataRetention.runtimeEnabled` false, a manual live run must refuse. Retention being globally OFF is a perfectly acceptable state to activate the outbox in — the tables simply grow until it is turned on.
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

## 13. Retention — what ages out, and what never does (F5-2R)

Both outbox tables are governed by the **existing** data-retention architecture: `jobs/dataRetentionCleanupJob.ts`, on its normal cron, behind both normal kill switches. There is no separate outbox cleanup job, no separate schedule and no separate switch — if data retention is off, outbox retention is off with it.

Which rows are eligible is decided by `server/src/outbox/outboxRetention.ts`, next to the lease/replay code whose semantics define it.

### The three categories

| Category | Rows | Aged on | Default window | Env var |
|---|---|---|---|---|
| `outboxProcessedEvents` | `OutboxEvent` `status = 'processed'` | `processedAt` | **180 days** | `DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS` |
| `outboxDeadEvents` | `OutboxEvent` `status = 'dead'` | `deadLetteredAt` | **365 days** | `DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS` |
| `outboxConsumerExecutions` | `OutboxConsumerExecution` `status = 'completed'` | `completedAt` | **derived** = max of the two above | *(none — deliberately)* |

Minimum for either env var is the shared 30-day floor; anything lower, or non-numeric, silently falls back to the default rather than being honoured.

### What is NEVER eligible, at any age

| Row | Why it is protected |
|---|---|
| `OutboxEvent` `pending` | An undelivered obligation. Age is not evidence of anything — a row can sit `pending` for weeks behind a provider outage and still be owed. |
| `OutboxEvent` `claimed`, live lease | Work in flight. |
| `OutboxEvent` `claimed`, **expired** lease | Also protected. An expired lease is not an abandoned row; it is the crash-recovery mechanism, and the dispatcher's next tick reclaims it. |
| `OutboxConsumerExecution` `in_progress` | The marker is committed *before* the side effect. Deleting it lets a retry re-send. |
| `OutboxConsumerExecution` `ambiguous` | An open operator question — "did the patient actually get this?" Deleting it answers the question by forgetting it, and un-blocks a replay that `outboxReplay.ts` was deliberately refusing. |
| `OutboxEvent` `dead` whose idempotency key has an `ambiguous` ledger row | The dead row is the operator's only handle on that unresolved question. Protected past its window until a human resolves it. |
| `OutboxEvent` `dead` with a `pending`/`claimed` replay descendant | The parent explains why the child exists, and `REPLAY_IN_FLIGHT` reads exactly that relationship. |
| `OutboxConsumerExecution` `completed` whose key is still held by a `pending`, `claimed` or `dead` event | **The replay invariant.** See below. |

### The replay invariant

> There is no supported state in which an `OutboxEvent` still exists while its business idempotency record has already been deleted.

This matters because `replayDeadOutboxEvent` refuses a replay with `ALREADY_APPLIED` by reading the **ledger**, not the event row — an event can be `dead` with the side effect already performed, which is exactly what `AMBIGUOUS_SIDE_EFFECT` means. A ledger row pruned ahead of its event would let a replay re-send a message the patient already received, and nothing would notice.

It is enforced twice:

1. **In policy** — the consumer-execution window is *derived* as `max(processed, dead)` and has no environment variable, so an operator cannot configure the unsafe relationship at all.
2. **Per deletion** — a `completed` ledger row is only removed once no event in `pending`, `claimed` or `dead` carries its `idempotencyKey`. A `processed` event does *not* pin it: a processed event is not replayable (`NOT_TERMINAL`) and so cannot cause a second side effect.

The sweep runs events first, ledger last, for the same reason.

### Where the protection is checked (F5-2R-R1)

The guarded categories — `dead` events and `completed` ledger rows — do **not** delete through Prisma. Each removes rows with a single PostgreSQL statement whose `WHERE` re-derives the status, the age threshold and every protection as a correlated `NOT EXISTS` against the live tables:

```sql
DELETE FROM "OutboxConsumerExecution" AS x
WHERE x."id" = ANY($1::text[])          -- the batch bound
  AND x."status" = 'completed'
  AND x."completedAt" < $2
  AND NOT EXISTS (
    SELECT 1 FROM "OutboxEvent" e
    WHERE e."idempotencyKey" = x."idempotencyKey"
      AND e."status" = ANY($3::text[])   -- pending | claimed | dead
  )
```

**What this means operationally.** A replay you issue, or an ambiguity that opens, **while the nightly sweep is running** still protects its rows. The bounded candidate list the sweep picked seconds earlier cannot override a protection that has since committed — the database re-checks it as the rows are removed. You do not need to time anything around the 03:00 cron, and you do not need to pause retention to replay.

If a row is refused for this reason nothing is logged about it individually: the category simply reports a smaller count. That is normal, not an error, and the next run offers the row again once the protection resolves.

Both statements run inside `runWithAuditedRawSql({ registryKey: 'outbox/outboxRetention' })` and are registered `SYSTEM_ONLY` in the raw-SQL tenant audit inventory.

### Fail-closed guard ceiling

The protection sets (undelivered backlog, dead-letter queue, open ambiguities) are each small in a healthy system. If any of them exceeds **10,000 rows**, that category **deletes nothing**, records itself in `skippedCategories` with `OutboxRetentionGuardLimitError` / `GUARD_SET_LIMIT_EXCEEDED`, and the next run retries. A DLQ that large is an incident, and the worst possible moment to prune idempotency evidence is during one. Nothing is lost by waiting.

Since R1 this ceiling is an **incident circuit-breaker**, not the safety check — it decides whether the category runs at all. The per-row protection is enforced by the guarded statements above, so a category that passes the ceiling is not thereby trusting a stale snapshot.

### Dry run

`POST /api/platform/privacy/data-retention/run` with the dry-run option (platform admin) reports, per category:

```
outboxProcessedEvents=<n> outboxDeadEvents=<n> outboxConsumerExecutions=<n>
```

Counts only. The sweep never selects, returns or logs `payload`, and the summary carries no organization id, clinic id, appointment id or business key. A dry run performs **zero** mutations — a dry run that reached an executor at all would surface as an error in the summary.

The dry-run count is produced by the **same predicate** the delete uses, guards included, so a guarded row is absent from the count as well as from the delete. An operator is never shown a number the sweep would not actually act on.

### Batching

Bounded by `DATA_RETENTION_BATCH_SIZE` (default 500, max 1000), the same knob every other category uses. Each batch selects ids under the limit and deletes by id with the full predicate re-applied, so a row that stops being eligible between the select and the delete is left alone. Partial progress is safe; a rerun resumes.

### Verifying the policy is recognised, without shell access

`GET /api/platform/privacy/data-retention/policy` (platform admin) now returns `outboxProcessedEventDays`, `outboxDeadEventDays` and `outboxConsumerExecutionDays`. Step 2 of §1 is satisfied when all three are present and the third is greater than or equal to the first two.

### Rollback of retention itself

Retention is not a deployment with a cutover. To stop it:

- **Immediate, everything:** set the runtime toggle `privacy.dataRetention.runtimeEnabled` to false (platform admin, audited). Both the cron and the manual live-run route check it.
- **Environment level:** `DATA_RETENTION_CLEANUP_ENABLED=false`, restart. The job does not schedule at all.
- **Outbox only, keeping the rest of retention running:** raise `DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS` and `DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS` to a value beyond any existing row's age and restart. The derived ledger window follows automatically.

There is nothing to un-delete: retention only ever removes rows that were, by construction, no longer able to do anything.

---

## 12. Things that are NOT operator actions

- **Editing `status`, `attemptCount`, `payload` or `eventVersion` by hand.** Every one of these defeats a guarantee. Use replay.
- **Setting a dead event back to `pending`.** This is exactly what replay exists to replace: it destroys the failure record, is unaudited, and can duplicate an applied side effect.
- **Deleting rows to clear a backlog.** Each row is an obligation someone is owed. Dead-letter and inspect instead.
- **Deleting `OutboxConsumerExecution` rows to "unstick" a replay.** That row is the only thing preventing a duplicate patient message. To replay past an ambiguity, use `acknowledgeAmbiguousSideEffect` — which clears the marker under audit — after checking the provider (§7). Retention will never delete one on your behalf while any event still holds its key (§13).
- **Dropping the tables during a rollback.** §2.
- **Adding a Redis/BullMQ path "temporarily".** ADR-007 defers it pending a measured trigger; `tests/outboxContracts.test.ts` fails the build if an outbox runtime module imports `bullmq` or `ioredis`.

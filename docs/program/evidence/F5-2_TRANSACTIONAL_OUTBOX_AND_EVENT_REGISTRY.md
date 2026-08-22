# F5-2 — Transactional Outbox and Versioned Event Registry

**Task:** ClickUp `F5-2` ([`869ed1t14`](https://app.clickup.com/t/869ed1t14)), under `EPIC F5` ([`869ed1jvf`](https://app.clickup.com/t/869ed1jvf)) — repository phase `F6`.
**Baseline:** `origin/main` @ `6e1d2e0b881a96f10aaf92d05984a7369448310b` (PR #479 merge), fetched and verified at task start; no drift.
**Branch:** `feature/f5-2-transactional-outbox-event-registry`, cut from fresh `origin/main` — **not** stacked on anything.

**96 tests · 96 PASS · 0 FAIL** across two suites (53 DB-free contract tests, 43 against a real disposable PostgreSQL 16.14), plus server typecheck, frontend typecheck/build, the architecture guardrail, the log-privacy guard, and five existing tenancy/messaging suites re-run unchanged.

**No production system was contacted. Nothing is merged, deployed, migrated in production, or activated.** Both feature flags default OFF, so deploying this branch changes no runtime behaviour until someone deliberately turns them on.

---

## 0. Entry authority, and what actually changed about it

`F6`'s entry conditions are "F5 çıkışı + ADR-006/007 kabulü". As of `origin/main` @ `6e1d2e0`, ADR-006 and ADR-007 were both `NEEDS_POC`, and the F5-1P evidence document closes by stating in terms that it authorizes nothing and that `ADR_007_FINAL_DECISION = PENDING_HUMAN_REVIEW`.

The program-owner decision of 2026-08-22 is that review. It accepts:

- **ADR-007 `ACCEPTED_WITH_CONDITIONS`** — PostgreSQL transactional outbox plus an in-process dispatcher for the current stage. BullMQ/Redis **DEFERRED** until a measured trigger.
- **ADR-006 `ACCEPTED_WITH_CONDITIONS`** — the outbox is authorized **only** for genuinely outbox-shaped flows: committed database state plus a required side effect that must not be lost. Explicitly **not** authorization to migrate every cron/job.

Both ADRs are updated in [`../ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md) with those statuses and conditions. This task implements against that decision; it does not make it.

---

## 1. What was built

| Area | Module |
|---|---|
| Versioned event contract registry | `server/src/outbox/outboxEventRegistry.ts` |
| Producer (transaction-only) | `server/src/outbox/outboxProducer.ts` |
| Failure classification + retry policy | `server/src/outbox/outboxErrors.ts` |
| Claim / lease / dispatch / dead-letter | `server/src/outbox/outboxDispatcher.ts` |
| Consumer contract (infrastructure↔domain seam) | `server/src/outbox/outboxConsumerRegistry.ts` |
| Business idempotency ledger | `server/src/outbox/outboxIdempotency.ts` |
| Audited replay | `server/src/outbox/outboxReplay.ts` |
| Backlog metrics + DLQ inspection | `server/src/outbox/outboxMetrics.ts` |
| Rollout/cutover flags | `server/src/outbox/outboxConfig.ts` |
| Consumer registration | `server/src/outbox/startOutbox.ts` |
| The one real consumer | `server/src/outbox/consumers/appointmentRequestConfirmationConsumer.ts` |
| Scheduling + graceful shutdown | `server/src/jobs/outboxDispatcherJob.ts` |

Schema: two additive models, `OutboxEvent` and `OutboxConsumerExecution`, in migration `20260822120000_add_outbox_event_and_consumer_execution`.

---

## 2. The OutboxEvent model, field by field

Derived from repository conventions (`AuditLog`/`OperationalEvent` shape: scalar-only, no Prisma relations, so an operational ledger adds no back-relation fields to `Organization`/`Clinic` and can be written in any transaction without ordering constraints), **not** copied from the PoC schema.

| Field | Purpose |
|---|---|
| `id` | uuid primary key. |
| `organizationId` | **NOT NULL.** The complete tenant predicate. Server-derived at publish, never from a request body. |
| `clinicId` | Nullable: an `ORGANIZATION_OWNED` contract legitimately has no single clinic. |
| `eventType`, `eventVersion` | Contract identity. Must resolve in the registry, or the row is refused at publish and dead-lettered at dispatch. |
| `aggregateType`, `aggregateId` | What the event is about. |
| `payload` | **Identifiers only**, held to the contract's field allowlist at publish AND at dispatch. |
| `idempotencyKey` | The business key handed to the consumer. Stable across retries and replays. |
| `dedupeKey` | Optional, `UNIQUE`. Producer-side duplicate suppression as a database property. NULL where an event may legitimately repeat (Postgres treats NULLs as distinct). |
| `correlationId`, `causationId` | Request correlation; `causationId` points at the event that caused this one (a replay records its parent). |
| `status` | `pending` \| `claimed` \| `processed` \| `dead`. |
| `occurredAt`, `createdAt`, `updatedAt` | When the fact happened / row lifecycle. |
| `availableAt` | Not claimable before this. Backoff and delayed dispatch both move it. |
| `attemptCount`, `lastAttemptAt` | Bounded retry. Incremented **at claim** — see §5. |
| `lastErrorCode` | Stable `OutboxErrorCode` only. Never a provider body. |
| `claimedAt`, `claimedBy`, `leaseExpiresAt` | The lease. Crash recovery without a distributed lock. |
| `processedAt`, `deadLetteredAt`, `deadLetterCode` | Terminal states and why. |
| `replayCount`, `lastReplayedAt`, `lastReplayedBy` | Replay audit, visible without a join. |

Six indexes: the claim hot path (`status, availableAt, occurredAt`), the stale-lease sweep, per-organization and per-clinic operator/metric slicing, per-contract slicing, and `idempotencyKey`.

**No dead-letter table.** F5-1P used one so a poison event's payload could be replaced with a digest. That is unnecessary here because the payload is *already* identifier-only by contract, so `status = 'dead'` on the same row keeps replay, audit and inspection natural and avoids a third table. Recorded as a deliberate divergence from the PoC, not an oversight.

### `OutboxConsumerExecution`

`(consumerKey, idempotencyKey)` `UNIQUE`, plus `organizationId`/`clinicId` copied from the event, `status` (`in_progress` \| `completed` \| `ambiguous`), `executedBy`, `leaseExpiresAt`, timestamps and a stable `outcomeCode`. It carries **no message content**.

---

## 3. Tenant classification — a decision, not a default

Both models are classified `ORGANIZATION_SCOPED_DIRECT` / `AUTO_FILTER_ORGANIZATION_ID` in `utils/tenantModelClassification.ts`, matching the `AuditLog` and `OperationalEvent` precedent exactly (organization NOT NULL, clinic nullable).

It would have been easier to call an infrastructure table `SYSTEM_INTERNAL`. That was rejected explicitly: every event registered today asserts a fact about **one** organization, its payload references that tenant's records, and an operator inspecting a dead-letter backlog is answering "whose event is this". `SYSTEM_INTERNAL` would make tenant data reachable through a table nobody filters — precisely the failure the F3-1 registry exists to prevent. The rationale is recorded in the registry entry itself, and `tests/outboxContracts.test.ts` asserts the classification is neither `SYSTEM_INTERNAL` nor `EXPLICIT_REVIEW_REQUIRED`.

`tests/tenantModelClassification.test.ts` (28 tests) passes unchanged: registry size, order and schema agreement all hold.

---

## 4. Atomicity — the invariant, and how the unsafe path was removed

The failure being defended against is not malice, it is convenience:

```ts
await prisma.$transaction(...)   // business change commits
await publishOutboxEvent(...)    // ...and this throws
```

which reintroduces exactly the gap the outbox closes, in code that reads perfectly reasonably in review.

**So there is no `publishOutboxEvent`.** The only exported publisher is `publishOutboxEventInTx(tx: Prisma.TransactionClient, …)`. A `TransactionClient` cannot be obtained outside `prisma.$transaction`, so the unsafe call does not typecheck. `tests/outboxContracts.test.ts` additionally scans the module source to prove exactly one exported publisher exists, that it takes the transaction client first, and that the producer never reaches for the shared client.

Measured against a real database:

| Test | Result |
|---|---|
| ROLLBACK after business mutation + publish | PASS — business mutation absent, 0 events |
| COMMIT of both | PASS — 1 business row, 1 event |
| Contract violation inside the transaction | PASS — throws, **business change rolls back** |
| PHI field in payload | PASS — refused at publish |
| `dedupeKey` reused | PASS — real `P2002`, not an application check |
| `CLINIC_OWNED` contract published with no `clinicId` | PASS — refused |

The third row is a deliberate choice: a broken contract fails the whole conversion loudly rather than committing a business change whose obligation was silently dropped.

---

## 5. Dispatcher: claim, lease, retry, dead-letter

### Why `FOR UPDATE SKIP LOCKED` rather than this repository's guarded-update pattern

`clinicBulkExportPackage.claimQueuedClinicBulkExportJobs()` is the proven in-repo claim, and F5-1P E16 measured it correct under four dispatchers. It was **not** reused, for two reasons specific to an outbox:

1. **Volume shape.** A bulk export claims at most two rows a minute. An outbox claims a batch per tick, per replica, forever. The guarded pattern costs a SELECT plus one UPDATE *per row*, and the losers of each race pay a write to discover they lost.
2. **Fairness has to remain possible.** F5-1P §6 measured a naive post-claim per-tenant cap making quiet-tenant p50 **five times worse** (292ms → 1,962ms), and concluded fairness must act at *selection* time. A `SKIP LOCKED` subquery can later become a per-tenant lateral join with no other change to the dispatcher; a candidate-scan-then-guarded-update cannot.

The statement is registered in `tenancy/rawSqlAuditRegistry.ts` as `SYSTEM_ONLY` (key `outbox/outboxDispatcher`) and executed inside `runWithAuditedRawSql`. It carries **no tenant predicate by design** — a dispatcher that could see only one organization could not drain the queue — which is exactly what `SYSTEM_ONLY` is for. `tests/rawSqlTenantAudit.test.ts` passes with the new entry (21 files, all classified, zero `UNSAFE_BLOCKER`).

### Attempts are counted AT CLAIM

Counting on failure looks tidier and is wrong: a consumer that kills the **process** never reaches its own failure handler, so its attempt is never counted, so the row is reclaimed after every lease expiry, forever. Incrementing inside the claim statement bounds a crash loop by the same `maxAttempts` as an ordinary failure. Asserted directly (`attemptCount === 1` immediately after a claim; a reclaim leaves it at 1 rather than resetting it).

### Retry categories

`TRANSIENT` · `RATE_LIMIT` · `PROVIDER_OUTAGE` · `UNKNOWN` are retried; `AUTH_CONFIGURATION` · `TENANT_CONFIGURATION` · `PERMANENT_VALIDATION` · `POISON` are terminal on first sight. Backoff is exponential with **full** jitter (so N events that failed together against one provider do not return together and re-create the burst), capped at 30 minutes, floored — never capped — by a provider `Retry-After`.

Classification never sniffs message text. A plain `Error` whose message says "429 rate limit exceeded" classifies as `UNKNOWN`; only an explicit `OutboxConsumerError` carries a category. That is what keeps the policy correct when a provider rewords itself, and it keeps PII out of control flow.

### Measured

| Test | Result |
|---|---|
| 3 dispatchers × 12 rows | PASS — 12 claims, 12 distinct, none claimed twice |
| `availableAt` in the future | PASS — not claimed |
| Batch limit | PASS — honoured |
| Expired lease vs live lease | PASS — expired reclaimed, live untouched, `attemptCount` preserved |
| Successful consumer | PASS — `processed`, claim cleared |
| Retryable failure | PASS — `pending`, delayed, stable `lastErrorCode` |
| Permanent failure | PASS — `dead` at attempt 1, retry budget not burned |
| Persistent transient failure | PASS — exactly 5 consumer calls, then `dead`/`MAX_ATTEMPTS_EXCEEDED` |
| Row with unsupported version | PASS — `dead`, consumer **never called** |
| Row with PHI payload written directly | PASS — `dead`/`MALFORMED_PAYLOAD`, consumer never called |
| Unregistered event type | PASS — `dead`/`UNREGISTERED_EVENT` |
| Contract with no registered consumer | PASS — `dead`/`NO_CONSUMER`, not pending forever |
| `SKIPPED` outcome | PASS — `processed`, not retried |

---

## 6. Fairness — deliberately NOT implemented, with the trigger made measurable

F5-1P proved fairness is not free on either candidate and that adding it speculatively made latency worse for everyone. Three questions were asked before deciding:

- **Does current volume require it?** No. First-customer stage; the outbox carries one event type produced by a staff-initiated conversion.
- **Is a minimal selection-time mechanism justified now?** No — there is no measured contention to be fair about.
- **Is observability plus a future trigger sufficient?** Yes, provided the trigger is actually measurable.

That proviso is the part that matters. A deferral whose trigger cannot be measured is not a deferral, it is a decision never to do the thing. So `getOutboxBacklogMetrics()` ships **in the same change** and exposes `byOrganization` (bounded by organization count — never clinic, patient or event id), `oldestPendingAgeMs`, `dispatchable` vs `delayed`, `staleLeases`, and `deadByCode`. One organization holding most of the pending backlog while others wait *is* the noisy-neighbour condition, and it is now visible.

The claim query is shaped so a per-tenant lateral join drops in at selection time without touching anything else.

---

## 7. The first real flow: candidates inspected, and why three were rejected

F0-010 named four candidate outbox-shaped flows. Re-inspected against the repository as it stands at `6e1d2e0`:

| Candidate | Verdict | Why |
|---|---|---|
| Appointment reminders (`jobs/reminders.ts`) | **REJECTED** | Schedule-shaped, not outbox-shaped. Derived from durable appointment state by a daily cron; already writes a `SentMessage` ledger row in `prepared` before sending and transitions it to `sent`/`failed`; a missed tick is recovered by the next tick. No commit→obligation gap. Migrating it is precisely the "every cron/job" ADR-006's conditions refuse. |
| Payment reminders (`runPaymentRemindersForClinic`) | **REJECTED** | Identical shape — cron over `PaymentPlanInstallment`, same `SentMessage` ledger. |
| In-app notification generation (`routes/treatmentCases.ts:checkAndNotifyLowStock`, `routes/notifications.ts`) | **REJECTED** | A same-database write, already idempotent via `upsert` on a stable `externalId`, and recomputable by the next trigger. Its correct fix is to include the write in the caller's transaction — not to publish an event so a dispatcher can write another local row. F0-010's "textbook outbox" framing predates this inspection. |
| Appointment-request confirmation | **SELECTED** | See below. |

### The selected gap, exactly as it exists in the code

`routes/appointmentRequests.ts` `POST /appointment-requests/:id/convert` runs the conversion inside `prisma.$transaction`: request-conversion advisory lock, slot lock, overlap and duplicate re-checks, `Appointment` created, `AppointmentRequest` marked `converted`, and `ensurePendingSyncLinkInConversionTransaction`. The transaction commits, the HTTP response is sent, and **then** `scheduleExternalCalendarSyncOrNotify` runs fire-and-forget.

- When the clinic **has** an external-calendar integration, the `ExternalCalendarAppointmentLink` created *inside* the transaction carries the obligation, and the confirmation rides on that link's retry ledger. Already durable.
- When the clinic has **no** integration — the ordinary case at first-customer stage — `scheduleExternalCalendarSyncOrNotify` sends the confirmation inline with `.catch(logger.error)` **and nothing else**. A process exit, a provider blip or a WhatsApp 5xx in that window loses the patient's confirmation permanently, with no record that it was ever owed.

All five of §20's criteria hold: a business transition commits; a side effect is required; losing it is unacceptable (the patient never learns their appointment was approved); retry and idempotency are definable from the appointment id; and the gap is real in current code.

### The integration

Inside the conversion transaction, when `OUTBOX_PRODUCER_ENABLED=true` **and** no sync link was created, `publishOutboxEventInTx` writes `appointment_request.confirmation_requested@1` with payload `{ appointmentRequestId, appointmentId }`. `ensurePendingSyncLinkInConversionTransaction` now returns `{ syncLinkCreated }` so that question is answered from inside the same transaction rather than re-derived after it.

Post-commit, `scheduleExternalCalendarSyncOrNotify` receives `confirmationOwnedByOutbox` and does not send inline.

**The consumer re-reads durable state** and calls the *same* `sendAppointmentRequestConfirmationNotification` the inline path calls. There is no second copy of the rendering logic to drift, and a confirmation replayed hours later renders from the appointment as it is *now*, not as it was when the event was published.

### The one race, closed rather than hidden

If an integration is enabled in the milliseconds between the conversion transaction committing and the post-commit callback running, a sync link *is* created after all and the sync path would also owe the confirmation. Rather than reach into the outbox's tables from the calendar domain — or pretend a millisecond-wide window does not exist — `sendConfirmationForConvertedAppointment` takes the **same business idempotency key from the same public ledger contract** the outbox consumer uses. Whichever path arrives first sends; the other observes `completed` and does not. This is gated on the producer flag, so with the outbox off that function is byte-for-byte its current behaviour: no extra read, no extra write, no new failure mode on a working path.

---

## 8. Idempotency, and the window that cannot be closed

The dispatcher guarantees **at-least-once**. Anything claiming exactly-once across a process boundary and an external provider is lying about one of the two.

The protocol: commit an `in_progress` marker with a lease **before** the side effect, perform it, mark `completed`. The marker is committed rather than held in an open transaction, because a marker inside the transaction that performs the side effect would be rolled back by the very crash it exists to detect.

Between the side effect and the finalisation there is a window no design closes without a transactional external system, and WhatsApp is not one. A retry that finds an **expired** `in_progress` marker genuinely cannot know whether the patient received the message.

**This implementation refuses to guess.** It does not re-send (every dispatcher crash would duplicate a patient message) and it does not silently drop (a missing confirmation with no trace). It records the execution `ambiguous` and dead-letters the event as `AMBIGUOUS_SIDE_EFFECT`, where an operator can see it, check the provider, and replay deliberately.

| Test | Result |
|---|---|
| Real `UNIQUE (consumerKey, idempotencyKey)` | PASS — second caller gets `IN_FLIGHT_ELSEWHERE`, then `ALREADY_COMPLETED` after finalisation |
| Expired `in_progress` marker | PASS — `AMBIGUOUS`, ledger row records `AMBIGUOUS_SIDE_EFFECT` |
| **Crash after side effect, then retry** | PASS — **1 side effect across 2 attempts**; event `dead`/`AMBIGUOUS_SIDE_EFFECT` |
| Two events asserting the same business fact | PASS — **1 side effect**, both events `processed` |
| Duplicate delivery to the real consumer | PASS — suppressed, exactly one ledger row |

The consumer deliberately does **not** release its marker when a send throws after the provider call was issued: a timeout is precisely the case where the message may still have been delivered.

---

## 9. Replay

Replay is **not** `status = 'pending'`. That one-liner destroys the only record of the failure, is unaudited, ignores *why* the event died, and can duplicate an already-applied side effect.

Instead, replay **creates a new event**. The dead row stays dead as permanent evidence and gains `replayCount`/`lastReplayedAt`/`lastReplayedBy`; a new `pending` row carries the **same** `idempotencyKey` (so the ledger still suppresses a duplicate), `causationId` pointing at the dead row, and the preserved `correlationId`. `dedupeKey` is deliberately not copied — it is producer-side "do not publish this fact twice" suppression, and copying it would make the UNIQUE constraint block a deliberate, authorized operator action.

Every refusal is checked before anything is written, so a refused replay leaves the database byte-identical (asserted).

| Test | Result |
|---|---|
| Replay a dead event | PASS — new event, causation set, correlation preserved, same idempotency key, `replayCount` 1, `AuditLog` row `outbox_event_replayed` written |
| Second replay while the first is in flight | PASS — `REPLAY_IN_FLIGHT` |
| Replay a non-terminal event | PASS — `NOT_TERMINAL` |
| Replay when the effect is recorded applied | PASS — `ALREADY_APPLIED` |
| Replay an `ambiguous` effect | PASS — refused without acknowledgement; with `acknowledgeAmbiguousSideEffect` it clears the marker and proceeds |
| Replay ceiling | PASS — `REPLAY_LIMIT_EXCEEDED` at 3 |
| Cross-organization replay | PASS — `NOT_FOUND` (never "forbidden": that would be an id oracle) |
| Sibling-clinic replay outside scope | PASS — `CROSS_CLINIC_REFUSED`; the same caller **with** the clinic in scope succeeds, proving the refusal was the scope |
| Refused replay | PASS — zero rows created, `replayCount` unchanged |
| Replayed event succeeds, then replayed again | PASS — 1 side effect, second replay `ALREADY_APPLIED` |

**Role authorization is not decided here.** `replayDeadOutboxEvent` enforces tenant scope and event state and takes an already-authorized `OutboxReplayAuthorization`; deciding whether a caller's *role* may replay belongs to the route layer and the existing authorization architecture. **F5-2 adds no route.**

---

## 10. Tenant context and system-context governance

The dispatcher polls across every organization, so it runs under `runAsSystem({ reason: 'background-job', detail: 'outbox-dispatcher' })` — the existing reason, the same "system to claim, tenant to execute" shape `clinicBulkExportWorker` documents. **No new `SystemContextReason` was added.**

Per row, before any consumer runs, it enters `runAsTenant` built from the row's **own server-written** `organizationId`/`clinicId`. Never from the payload — and the registry's field allowlist means a tenant id cannot even *be* a payload field, so a consumer physically cannot read one from attacker-influenced data (F5-1P T5's defence, enforced structurally).

`outboxDispatcherJob.ts` takes **no** `JobLock`: a cluster-wide named lock would mean only one replica could ever drain the outbox, defeating the multi-dispatcher claim. It is registered in `tests/tenantSystemContextInventory.test.ts`'s lock-free list with that recorded reason; that suite passes (16 tests).

Measured: two events from two different organizations dispatched in one tick each ran under their own organization and their own single-clinic `EXPLICIT` scope. Publishing an `organizationId` *as a payload field* is refused.

---

## 11. KVKK / payload minimisation

- `payload` is identifier-only, enforced by a per-contract allowlist at publish **and** at dispatch.
- A registry-level `FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS` net runs at module load: a contract that permits a field whose name contains `name`, `phone`, `email`, `tckimlik`, `token`, `body`, `message`, `diagnos`, … **refuses to import**. A future contract author cannot widen their own allowlist into PHI.
- Validation refusal reasons name **fields, never values** (asserted: a rejected `tcKimlik: '12345678901'` produces a message containing `tcKimlik` and not the number).
- `lastErrorCode` / `deadLetterCode` are stable codes; `safeErrorFields` sees the wrapper error, not its cause, so a provider body attached for a local stack trace can never reach a persisted column.
- `listDeadOutboxEvents` selects **no** payload column and requires an `organizationId` predicate — there is deliberately no "all organizations" mode.
- Metrics slice by organization only, never clinic/patient/event id.
- A source scan asserts no outbox module logs the payload.

**Retention is NOT implemented.** `OutboxEvent` and `OutboxConsumerExecution` are new retention surfaces and must join `dataRetentionCleanupJob`'s categories before any production rollout. Both contracts carry a `retention` class (`HEALTH_ADJACENT_IDENTIFIERS` for the registered one) so the sweep has something to act on. **This is an open item, recorded in §14, not a claim of completeness.**

---

## 12. Migration

`server/prisma/migrations/20260822120000_add_outbox_event_and_consumer_execution/migration.sql` — hand-authored, strictly additive: two `CREATE TABLE` and nine `CREATE INDEX`. Nothing existing is altered, renamed or dropped.

Verified against a disposable PostgreSQL 16.14 (matching the production baseline):

```
npx prisma validate                 -> valid
npx prisma migrate deploy           -> 81 migrations applied, including this one
npx prisma migrate status           -> "Database schema is up to date!"
npx prisma migrate diff             -> zero Outbox-related drift
    --from-config-datasource --to-schema prisma/schema.prisma
```

`prisma migrate dev` was **not** run; `prisma migrate diff` output was **not** pasted into the migration (a known trap — it surfaces pre-existing repository drift). Only this task's own objects are in the file.

**Backward compatibility.** The previous application version has no reference to either table and ignores them entirely. Both flags default OFF, so the application version in this branch also does nothing with them until switched on. The migration is therefore safe to deploy ahead of the application, which is the documented order.

**Rollback: do NOT drop these tables.** See §13.

---

## 13. Rollback and cutover

Two flags, not one, because a single flag has an unsafe intermediate state in both directions (turning on: rows are produced at the instant the dispatcher starts, so a dispatcher that fails to start silently stops confirmations with nothing draining the table; turning off: production and draining stop together, stranding published rows).

**Rollout order:** `OUTBOX_DISPATCH_ENABLED=true` first (drains an empty table, proves it runs) → then `OUTBOX_PRODUCER_ENABLED=true`.

**Rollback order:** `OUTBOX_PRODUCER_ENABLED=false` (the inline path resumes immediately, same code path as today) → let the dispatcher drain → `OUTBOX_DISPATCH_ENABLED=false` → revert the application version if needed.

**Never drop the tables during an emergency rollback.** They are inert without a running dispatcher, and dropping them destroys undelivered obligations. Removal, if ever wanted, is a separate planned migration once the tables are provably empty.

Flag semantics follow the `CLINIC_BULK_EXPORT_ENABLED` convention: the value must be exactly `'true'`. `'1'`, `'yes'`, `'TRUE'`, `'true '` are all OFF — a feature that can be switched on by a typo is not a kill switch. Asserted for both flags across eight spellings. Read at the call site on every publish, never snapshotted at module load (the clinic-bulk-export stale-snapshot remediation is the reason).

Graceful shutdown stops only this job's own scheduled task, releases anything the in-flight tick had just claimed, and waits for the tick to settle. Events already executing are allowed to **finish** rather than being abandoned — cutting one short between its provider call and its idempotency finalisation would manufacture the exact `AMBIGUOUS_SIDE_EFFECT` the design works hardest to avoid. Measured: 0 rows left in `claimed`.

---

## 14. Test results

| Command | Exit | Pass | Fail |
|---|---|---|---|
| `npm run test:outbox-contracts` (Layer 2) | 0 | 53 | 0 |
| `npm run test:outbox-dispatcher-db` (Layer 3, real PostgreSQL) | 0 | 43 | 0 |
| `npm run test:tenant-model-classification` | 0 | 28 | 0 |
| `npm run test:tenant-context` | 0 | 29 | 0 |
| `npm run test:tenant-guard-unit` | 0 | 73 | 0 |
| `npm run test:raw-sql-tenant-audit` | 0 | 12 | 0 |
| `npm run test:tenant-system-context-inventory` | 0 | 16 | 0 |
| `npm run test:external-calendar-outbound-sync` | 0 | 26 | 0 |
| `npm run test:external-calendar-outbound-sync-job` | 0 | 7 | 0 |
| `npm run test:external-calendar-idempotency` | 0 | 8 | 0 |
| `npm run test:background-jobs-ownership` | 0 | 10 | 0 |
| `npm run test:appointment-request-conversion-atomicity` (Layer 3) | 0 | 16 | 0 |
| `npm run test:external-calendar-outbound-sync-atomicity` (Layer 3) | 0 | 9 | 0 |
| `npm run test:tenant-guard-isolation` (Layer 3) | 0 | 36 | 0 |
| **Cutover re-run** — conversion + outbound-sync atomicity with `OUTBOX_PRODUCER_ENABLED=true` | 0 | 16 + 9 | 0 |
| `server npx tsc --noEmit` | 0 | — | — |
| `npx tsc -b` (frontend) | 0 | — | — |
| `npm run log-privacy-guard:scan -- --strict-baseline` | 0 | 309 files, **no new violations** | — |
| `npm run guardrail:scan` | 0 | — | — |
| `npm run test:log-privacy-guard`, `npm run guardrail:test` | 0 | — | — |

The full server suite was **not** run end to end locally; CI Layer 2/3/5 covers it, and the exact suites this change can affect were selected and run individually with counts recorded above.

### Test-matrix coverage against the task's §24

Covered: transaction rollback/commit atomicity · duplicate event · unsupported version · malformed payload · multiple dispatchers · stale lease · retry · max retry · dead transition · replay · duplicate replay · worker crash after side effect · graceful shutdown · forced-shutdown-equivalent (shutdown mid-tick) · tenant A vs tenant B · sibling clinic isolation · forged tenant (payload-borne tenant id refused) · system-context misuse (no new reason; inventory suite) · raw SQL audit · log privacy · migration · event-registry drift · tenant-classification drift · idempotent consumer · backlog metrics.

**Not covered, and honestly so:**
- **DB disconnect/reconnect mid-flight.** F5-1P E10 measured this against the PoC pool; reproducing it here needs container-level control the dbVerification harness does not have. The dispatcher's behaviour on a finalisation failure *is* covered (the claim is released rather than stranded), which is the part that is specific to this code.
- **`worker crash before side effect`** is covered structurally (an unstarted marker is released; an expired claim is reclaimed) rather than by killing a real process.
- **`missing tenant` / `TENANT_CONTEXT_MISSING`** is a property of `tenantContext.ts`, already proved by its own 29-test suite; it is not re-proved here.

### Open items — explicitly NOT done in F5-2

1. **Retention.** Neither new table is in `dataRetentionCleanupJob` yet. Must be resolved before rollout (§11).
2. **No operator route.** `getOutboxBacklogMetrics`, `listDeadOutboxEvents` and `replayDeadOutboxEvent` are services with no HTTP surface. Role authorization for replay is therefore undecided (§9). This is deliberate scope control, not an omission — a platform-admin/clinic-operator authorization contract is its own reviewable change.
3. **Fairness.** Not implemented; trigger made measurable (§6).
4. **Volume projections for ADR-006.** Still genuinely unmet — they require production observability that does not exist (ADR-012 `DEFERRED`).

---

## 15. Lifecycle

```
F5_2_AGENT_COMPLETED       = YES
F5_2_TESTS_PASSED          = YES   (96 new, 0 failed; 14 existing suites re-run green)
F5_2_PR_OPENED             = YES   (draft)
F5_2_CI_PASSED             = see the PR record
F5_2_MERGED                = NO
F5_2_MIGRATION_DEPLOYED    = NO
F5_2_APPLICATION_DEPLOYED  = NO
F5_2_FEATURE_ACTIVATED     = NO
F5_2_PRODUCTION_VERIFIED   = NO
```

`MERGE_SAFE = YES` (subject to program-owner review) · `DEPLOYMENT_SAFE = NO` (retention open item) · `PRODUCTION_CUTOVER_SAFE = NO`.

---

## 16. Non-authorization statement

This document authorizes nothing. It does not merge, deploy, run a production migration, activate either flag, or perform any production cutover. It records what was implemented against an already-taken program-owner architecture decision, what was measured, and what remains open.

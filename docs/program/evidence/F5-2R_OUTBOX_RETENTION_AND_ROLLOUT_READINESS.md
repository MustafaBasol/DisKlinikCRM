# F5-2R — Outbox Retention and Rollout Readiness

**Task:** ClickUp `F5-2R` ([`869enk93x`](https://app.clickup.com/t/869enk93x)), under `EPIC F5` ([`869ed1jvf`](https://app.clickup.com/t/869ed1jvf)) — repository phase `F6`.
**Baseline:** `origin/main` @ `70ba73e0b2d3cc0b92462c281acba4619ad0d634` (PR #481 merge), fetched and verified at task start. Both required merges confirmed as ancestors: `11956cf` (PR #480 — F5-2) and `70ba73e` (PR #481 — F5-3).
**Branch:** `feature/f5-2r-outbox-retention-rollout-readiness`, cut from fresh `origin/main` — **not** stacked on anything.

**59 new tests · 59 PASS · 0 FAIL** — 32 DB-free contract tests appended to the existing retention suite, and 27 against a real disposable PostgreSQL 16 — plus server typecheck, frontend typecheck/build, the log-privacy guard, the architecture guardrail, and eight existing suites re-run.

**No production system was contacted. Nothing is merged, deployed, migrated in production, or activated.** No schema migration was created. Both outbox flags remain default OFF and untouched.

---

## 0. The blocker this closes, stated as F5-2 left it

F5-2 §11 and §14 open item 1:

> **Retention is NOT implemented.** `OutboxEvent` and `OutboxConsumerExecution` are new retention surfaces and must join `dataRetentionCleanupJob`'s categories before any production rollout.

and the runbook's rollout step 2:

> ⚠️ **BLOCKER as of F5-2.** … Do not activate until they are.

That is the whole scope of F5-2R. **No F5-2 architecture was reopened**: the PostgreSQL transactional outbox, the in-process dispatcher, `FOR UPDATE SKIP LOCKED` claiming, the versioned registry, replay-as-a-new-event and the idempotency ledger are all unchanged. Nothing in `server/src/outbox/` was modified except by addition of one new file.

---

## 1. What was built

| Area | Module | Change |
|---|---|---|
| Retention windows + the derived invariant | `services/privacy/dataRetentionPolicy.ts` | two env vars, one derived value, documentation |
| Outbox lifecycle eligibility rules | `outbox/outboxRetention.ts` | **new** |
| Sweep execution | `jobs/dataRetentionCleanupJob.ts` | three categories added to the existing runner |
| Operator verification surface | `routes/platformAdmin.ts` | three fields added to the policy response |
| Contract tests | `tests/dataRetentionCleanupJob.test.ts` | +32 |
| Real-database tests | `tests/dbVerification/outboxRetention.test.ts` | **new**, 27 |

**No migration.** `processedAt`, `deadLetteredAt`, `completedAt`, `status`, `idempotencyKey` and `causationId` already exist and already carry the required meaning, and the `[status, …]` composite indexes F5-2 shipped serve the sweep. Adding a column or an index "for convenience" would have meant a migration for a job that runs once a day at 03:00 over a table that is currently empty.

---

## 2. The lifecycle, classified

### `OutboxEvent`

| Status | Verdict | Why |
|---|---|---|
| `pending` | **NEVER deletable, at any age** | An undelivered obligation. Age proves nothing — a row can sit `pending` for weeks behind a provider outage and still be owed. Deleting one loses a patient's confirmation permanently with no record that it was ever owed, which is precisely the failure the outbox exists to prevent. |
| `claimed`, live lease | **NEVER deletable** | Work in flight. |
| `claimed`, **expired** lease | **NEVER deletable** | This is the case that looks deletable and is not. An expired lease is not an abandoned row; it *is* the crash-recovery mechanism (F5-2 §5), and `reclaimExpiredOutboxLeases` picks it up on the next tick. A retention sweep that "tidied up" stale claims would silently delete exactly the rows a dispatcher crash left behind. |
| `processed` | Deletable past **180 days** on `processedAt` | A discharged obligation. |
| `dead` | Deletable past **365 days** on `deadLetteredAt`, **unless guarded** | An undischarged obligation, and the only object a replay can be issued against. |

### `OutboxConsumerExecution`

| Status | Verdict | Why |
|---|---|---|
| `in_progress` | **NEVER deletable** | The marker is committed *before* the side effect. An expired one is upgraded to `ambiguous` by `beginConsumerExecution`; until then it still means "a side effect may be happening right now". Deleting it lets a retry re-send. |
| `ambiguous` | **NEVER deletable** | An open operator question — "did the patient actually receive this?" — that only a human checking the provider can close. Deleting it answers the question by forgetting it, and un-blocks a replay `outboxReplay.ts` was deliberately refusing. |
| `completed` | Deletable past the **derived** window, **and only when no event still holds its key** | §4. |

These are enforced by the predicates, not by convention: every builder in `outboxRetention.ts` pins `status` to an exact terminal literal, and a DB-free test asserts that no sweep predicate can name anything else.

---

## 3. The retention horizons, and where the numbers come from

Both numbers were derived from this repository's existing retention conventions rather than invented.

**`processed` = 180 days** (`DATA_RETENTION_OUTBOX_PROCESSED_EVENT_DAYS`). A processed event is a discharged obligation: the side effect happened, the ledger recorded it, and what remains is operational diagnostics — "did this confirmation go out, and when". That is the same question `OperationalEvent` answers, and it already carries a 180-day window (`DATA_RETENTION_OPERATIONAL_EVENTS_DAYS`). Inheriting it rather than inventing a fourth number is the point. The durable *outbound* record is `SentMessage`, which this job never touches, so 180 days destroys no delivery evidence.

**`dead` = 365 days** (`DATA_RETENTION_OUTBOX_DEAD_EVENT_DAYS`). Deliberately longer, because a dead row is the record of an obligation that was **not** discharged — a patient who may never have learned their appointment was approved — and it is also the object a replay acts on. 365 days is the one-year family already used for `WhatsAppConversationMessage` (365) and resolved `ContactRequest` rows (365), and it comfortably exceeds any operational triage horizon.

Both are floored at the shared 30-day minimum; a lower or non-numeric value falls back to the default rather than being honoured, using the same `parseSafeDays` the rest of the file uses.

**Nothing is deletable on a first production deploy.** The tables are new and empty; the shortest window is 180 days. A test asserts every outbox window is ≥ 180 days precisely so that a future "tidy default" cannot quietly turn the first deploy after activation into a data-loss event.

### What was NOT added

`OUTBOX_CONSUMER_EXECUTION_RETENTION_DAYS` was on the task's candidate list and is **deliberately absent** — see §4. Three knobs were considered and two shipped: minimal configuration, consistent with the existing policy file, and the third one is withheld for a safety reason rather than an aesthetic one.

---

## 4. The idempotency-ledger question — the high-risk part

The task named this as the high-risk decision, and it is.

> There must not be a normal supported replay path where the event still exists but its business idempotency protection has already been deleted.

**Why it bites.** `replayDeadOutboxEvent` refuses a replay with `ALREADY_APPLIED` by reading the **ledger**, not the event row — and it must, because an event can be `dead` with the side effect already performed. That is exactly what `AMBIGUOUS_SIDE_EFFECT` means. A ledger row pruned ahead of its event would let an operator replay a dead event and re-send a WhatsApp message the patient already received, with nothing in the system able to notice. The failure is silent, months-delayed, and lands on a patient.

**The invariant is enforced twice, at two different layers.**

**(1) In policy — the window is derived, not configured.**

```ts
outboxConsumerExecutionDays = max(outboxProcessedEventDays, outboxDeadEventDays)
```

Every other window in `dataRetentionPolicy.ts` is a policy choice an operator may legitimately tune. This one is not: a lower value is not a shorter retention period, it is a duplicate-patient-message defect with a several-month fuse. Deriving it makes the wrong value **unrepresentable** rather than merely discouraged. A test asserts that no environment variable — including the three plausible names an operator might reach for — can shorten it.

**(2) Per deletion — a structural guard.**

A `completed` ledger row is removed only once **no** `OutboxEvent` in `pending`, `claimed` or `dead` carries its `idempotencyKey`. This survives a hand-edited database, a category that errored out mid-sweep, and a batch limit that left events behind — none of which the policy layer alone would survive.

`processed` events deliberately do **not** pin the ledger. A processed event is not replayable (`replayDeadOutboxEvent` refuses it with `NOT_TERMINAL`) and its side effect is already recorded, so it cannot cause a second one. Including it would pin the ledger to the largest population in the table for no safety gain. This distinction is tested directly, against a real database, in both directions.

**Two further guards protect the dead event itself**, so that "dead events still required for unresolved operator action" is a checkable predicate rather than a hope:

- a dead event whose `idempotencyKey` has an **`ambiguous`** ledger row is retained past its window — that row is the operator's only handle on the unresolved question. Once the ambiguity is resolved (which is what `acknowledgeAmbiguousSideEffect` does: it deletes the marker under audit) the dead event ages out normally. Both halves are tested.
- a dead event with a **`pending`/`claimed` replay descendant** is retained — the parent explains why the child exists, and `REPLAY_IN_FLIGHT` reads exactly that relationship. A *settled* (processed) replay child no longer pins it. Both halves are tested.

The ambiguity guard matches on `idempotencyKey` alone rather than `(consumerKey, idempotencyKey)`: resolving the consumer key would mean re-deriving it from the contract registry per row, and an event whose contract is no longer registered would then silently lose its protection. Over-protecting is the only acceptable direction of error here, and it is recorded as a choice.

**Fail-closed ceiling.** The protection sets are bounded by the undelivered backlog, the dead-letter queue and the open-ambiguity list — each small in a healthy system. If any exceeds 10,000 rows, that category deletes **nothing**, records itself in `skippedCategories` with the stable code `GUARD_SET_LIMIT_EXCEEDED`, and the next run retries. A DLQ that large is an incident, and the worst possible moment to prune idempotency evidence is during one. Nothing is lost by waiting.

### The one question a reviewer will ask, answered

*Deleting a `processed` event frees its `dedupeKey` — can the producer then republish the same fact?* The `dedupeKey` is producer-side "do not publish this fact twice" suppression, and yes, deleting the row frees it. It is safe for two independent reasons: the **business** protection is the consumer ledger, which outlives every event window by construction; and the one registered producer publishes only inside the conversion transaction of an `AppointmentRequest` that is already `converted`, so the fact cannot recur anyway. Recorded here rather than left to be rediscovered.

---

## 5. Cleanup architecture — reuse, not a second framework

`OutboxEvent` and `OutboxConsumerExecution` are three new **categories** inside `runDataRetentionCleanup`, using the existing `DataRetentionCategoryDeps` shape unchanged. There is no new scheduler, no new lock, no new entry point and no new kill switch. Consequences, all tested:

- `DATA_RETENTION_CLEANUP_ENABLED=false` → the job never schedules, so outbox rows are never deleted.
- `privacy.dataRetention.runtimeEnabled` not `true` → both the cron and the platform-admin manual live-run route refuse, so outbox rows are never deleted.
- The shared `data-retention-cleanup` job lock still serialises a manual live run against a scheduled tick.
- A failing outbox category is recorded in `errors`/`skippedCategories` and the sweep continues — the existing per-category isolation, inherited.

A test asserts structurally that `outboxRetention.ts` imports no cron and takes no lock of its own, so a future `outboxRetentionJob.ts` that quietly bypassed both switches would fail the build.

**Why the eligibility rules live in `outbox/` and not in the job.** The job owns *how* cleanup runs. It cannot own *which* outbox rows are safe to delete, because that is answered by leases, replay and the idempotency ledger. Putting the rules next to the code that creates and consumes those rows means a future change to the dispatcher or to replay is made in sight of the retention rule it would break.

### Deletion order

Processed events → dead events → consumer executions, and the order is part of the safety argument rather than cosmetic. Events are swept before the ledger so that within one run every event that is going to disappear already has by the time the ledger category asks "is any event still holding this key?". Reversing them corrupts nothing — the per-batch guard refuses either way, and that is tested by running the ledger sweep first, out of order, and watching it decline — but it would make the ledger lag a full day for no reason.

---

## 6. Dry run

`countEligible` is the dry-run path and is **the same predicate the delete uses, guards included**. A guarded row is absent from the count as well as from the delete, so an operator is never shown a number the sweep would not actually act on. Verified against a real database: a `completed` ledger row pinned by a `dead` event reports `0` eligible *and* deletes `0`.

Output is three integers:

```
outboxProcessedEvents=<n> outboxDeadEvents=<n> outboxConsumerExecutions=<n>
```

No payloads, no identifiers, no organization or clinic ids, no business keys. Asserted twice: DB-free, that the serialised summary contains no `payload` or `idempotencyKey` key; and against a real database, that a summary produced from a populated table contains none of the fixture's organization id, clinic id, appointment id or consumer key.

A dry run performs **zero** mutations. In the DB-free suite the executors are stubs that throw if reached at all (an empty `errors` array is therefore the proof). Against a real database, the row count before and after a dry run over a populated table is identical, and every individual fixture row is still present.

---

## 7. Batching

Bounded by `DATA_RETENTION_BATCH_SIZE` (default 500, max 1000) — the same knob every other category uses. Each batch selects ids under the limit, then deletes by id **with the full predicate re-applied**, so a row that stopped being eligible between the select and the delete (a concurrent replay creating a pending event for its key) is left alone. The select/delete gap is small, but it is exactly the window in which the guard matters most.

Measured against a real database: five eligible rows with `batchSize = 2` delete `2, 2, 1, 0` — never more than the limit, no phantom fifth row, and a clean no-op once drained. Repeat runs reach the same state with no errors and no over-deletion.

There is deliberately no single unbounded `deleteMany` on the predicate: that takes row locks proportional to the whole eligible set in one transaction, which is the long-lock behaviour the retention design forbids.

---

## 8. Tenant and KVKK

**Tenant classification is unchanged.** Both models remain `ORGANIZATION_SCOPED_DIRECT` / `AUTO_FILTER_ORGANIZATION_ID`; `test:tenant-model-classification` passes unchanged (28 tests).

**The sweep is deliberately global, with no tenant predicate.** A retention job that could see only one organization could not clean the table — the same reasoning that makes the dispatcher's claim `SYSTEM_ONLY`. It runs from the existing `dataRetentionCleanupJob`, which establishes no tenant context, exactly as its nine existing categories do. **No new `SystemContextReason` was added; `test:tenant-system-context-inventory` passes unchanged (16 tests).**

**No raw SQL was added.** Everything is Prisma. `test:raw-sql-tenant-audit` passes unchanged (21 files, 37 call sites, zero `UNSAFE_BLOCKER`).

**KVKK / minimisation.**
- Nothing in `outboxRetention.ts` reads, selects, returns or logs `payload`. Queries select `id`, plus `idempotencyKey` for the guards — a contract-derived identifier that never reaches a log line.
- The module contains no `console.*` call at all, asserted by a source scan.
- The job's log line gained three counts and nothing else.
- Deletion, not redaction: an outbox payload is identifier-only by contract, so there is nothing to redact and a redacted row would be provenance pointing at nothing.
- `AuditLog` is untouched. Replay audit rows outlive the events they describe, which is the correct direction — the compliance trail is not a retention surface this job may prune.
- `log-privacy-guard:scan --strict-baseline`: 310 files, **no new violations**.

**Verified cross-tenant behaviour** against a real database: one organization ageing out does not disturb another's protected or young rows; and a ledger row is pinned by an event holding the same key in **any** organization (business keys derive from an appointment id so a cross-organization collision is not realistic, but a key-scoped guard that silently became organization-scoped would be a duplicate patient message waiting to happen).

---

## 9. Rollout sequence for F5-2 — documented, NOT executed

This is the sequence the runbook now carries (§1 and §13). **None of it was performed.**

1. **Deploy the additive migration** `20260822120000_add_outbox_event_and_consumer_execution`. Strictly additive; the previous application version ignores both tables. Safe ahead of the application.
2. **Deploy the application with both outbox flags OFF.** Normal traffic unchanged; the dispatcher logs that it is not scheduled.
3. **Verify migration + application health** by the normal deployment checks.
4. **Verify retention recognises the outbox.** `GET /api/platform/privacy/data-retention/policy` must return `outboxProcessedEventDays`, `outboxDeadEventDays` and `outboxConsumerExecutionDays`, with the third ≥ the first two.
5. **Verify the cleanup switches still gate it.** With `privacy.dataRetention.runtimeEnabled` false, a manual live run must refuse. Retention being globally OFF is an acceptable state to activate the outbox in — the tables simply grow until it is turned on.
6. **Optionally run a retention dry run.** On a fresh deploy all three outbox counts are `0`, because no row can be 180 days old.
7. **`OUTBOX_DISPATCH_ENABLED=true`**, restart.
8. **Verify it drains an empty table** — it schedules, and ticks with nothing to do are silent by design.
9. **`OUTBOX_PRODUCER_ENABLED=true`**, restart.
10. **Verify the first controlled event**: convert one appointment request at a clinic with no external-calendar integration; expect one `OutboxEvent` `pending` → `processed` within a minute and one `OutboxConsumerExecution` `completed`.
11. **Monitor** `oldestPendingAgeMs`, `dead` and `staleLeases`.

### Rollback

Unchanged from F5-2 and re-verified as still correct: `OUTBOX_PRODUCER_ENABLED=false` → let the dispatcher drain → `OUTBOX_DISPATCH_ENABLED=false` → revert the application version if needed. **Never drop the tables.**

Retention itself has no cutover to roll back. To stop it: the runtime toggle (immediate, audited, platform admin), `DATA_RETENTION_CLEANUP_ENABLED=false` (environment), or raise both outbox windows beyond any existing row's age to disable only the outbox categories while the rest of retention keeps running. There is nothing to un-delete — retention only ever removes rows that were, by construction, no longer able to do anything.

---

## 10. Test results

| Command | Layer | Exit | Pass | Fail |
|---|---|---|---|---|
| `npm run test:data-retention` (48 → **80**, +32) | 2 | 0 | 80 | 0 |
| `npm run test:outbox-retention-db` (**new**, real PostgreSQL 16) | 3 | 0 | 27 | 0 |
| `npm run test:outbox-contracts` | 2 | 0 | 53 | 0 |
| `npm run test:auth` (`platformAdmin.test.ts` — policy response) | 2 | 0 | 118 | 0 |
| `npm run test:retention-manual-run-audit` | 2 | 0 | 29 | 0 |
| `npm run test:tenant-model-classification` | 2 | 0 | 28 | 0 |
| `npm run test:raw-sql-tenant-audit` | 2 | 0 | 12 | 0 |
| `npm run test:tenant-system-context-inventory` | 2 | 0 | 16 | 0 |
| `npm run test:background-jobs-ownership` | 2 | 0 | 10 | 0 |
| `npm run test:outbox-dispatcher-db` | 3 | 0 | 43 | 0 |
| `npm run test:appointment-request-conversion-atomicity` | 3 | 0 | 16 | 0 |
| `npm run test:messaging-inbound-reliability-db` | 3 | 0 | 28 | 0 |
| `server npx tsc --noEmit` | 1 | 0 | — | — |
| `npx tsc -b` (frontend) | 1 | 0 | — | — |
| `npm run log-privacy-guard:scan -- --strict-baseline` | 1 | 0 | 310 files, no new violations | — |
| `npm run test:log-privacy-guard` | 1 | 0 | 39 | 0 |
| `npm run guardrail:scan` / `npm run guardrail:test` | 1 | 0 | 74 | 0 |

The Layer 3 suites ran against a hand-provisioned disposable `postgres:16-alpine` with all 82 migrations applied, and the three outbox/messaging DB suites were re-run in **CI order on a freshly created database** (43 + 27 + 28, all green) to prove the new suite does not disturb its neighbours.

### One honest observation

On the very first `test:outbox-dispatcher-db` run — against a database that had just been used by the 118-test `platformAdmin` suite and the retention-manual-run audit suite — the dispatcher suite reported **42 passed, 1 failed**. The failing test's name was not captured. It did **not** reproduce in four subsequent runs (three on the same database, one on a clean database in CI order), all of which reported 43/43. It is recorded here rather than omitted; CI is the authority, and the CI Layer 3 result on this PR is the number that counts.

### Coverage against the task's required test matrix

Covered: pending never deleted · claimed with a live lease never deleted · stale claimed lease consistent with dispatcher recovery (never deleted) · processed old eligible · processed young retained · dead retained until its own longer window · dead retained past its window while an ambiguity is open, and released once resolved · dead retained while a replay is in flight, released once the replay settles · ambiguous execution protected · in-progress execution protected · completed-execution retention invariant (all three holder statuses) · replay-horizon/idempotency invariant end to end, run out of order on purpose · dry run performs zero mutations · dry-run counts agree with the delete predicate · batch limit · repeat-run idempotence · tenant behaviour of a global sweep · no payload read or logged · no PHI in dry-run output · env kill switch honoured · runtime kill switch structurally covered · data-retention regression suite · outbox contract suite · outbox dispatcher DB suite · tenant classification · log privacy.

**Not covered, and honestly so:**
- **The runtime kill switch is not re-proved end to end here.** It is a property of `startDataRetentionCleanupJob` and the platform-admin route, already proved by `platformAdmin.test.ts` and `retentionManualRunAudit.test.ts`, both of which pass unchanged. What F5-2R adds is the structural assertion that the outbox categories have no path around them.
- **The guard ceiling is not exercised with 10,001 real rows.** Its behaviour is proved by injecting the error through the runner (the category deletes nothing, is recorded skipped, neighbours still run) and by asserting the constant is bounded. Materialising 10,001 rows would test PostgreSQL, not this code.
- **No performance measurement of the sweep at volume.** The tables are empty in production and the batch is bounded; a projection would be a guess. The existing backlog metrics are the trigger if that changes.

---

## 11. Lifecycle

```
F5_2R_AGENT_COMPLETED      = YES
F5_2R_TESTS_PASSED         = YES   (59 new, 0 failed; 8 existing suites re-run green)
F5_2R_PR_OPENED            = YES   (draft)
F5_2R_CI_PASSED            = see the PR record
F5_2R_MERGED               = NO
F5_2R_MIGRATION_DEPLOYED   = N/A   (no migration was created)
F5_2R_APPLICATION_DEPLOYED = NO
F5_2R_FEATURE_ACTIVATED    = NO
F5_2R_PRODUCTION_VERIFIED  = NO
```

`MERGE_SAFE = YES` (subject to program-owner review) · `DEPLOYMENT_SAFE = YES` for the F5-2 branch's *deployment* step now that the retention blocker is closed, but **`PRODUCTION_CUTOVER_SAFE = NO`**: activating either outbox flag remains a separate, explicitly gated decision that this document does not make.

---

## 12. Non-authorization statement

This document authorizes nothing. It does not merge, deploy, run a production migration, activate `OUTBOX_PRODUCER_ENABLED` or `OUTBOX_DISPATCH_ENABLED`, enable data-retention cleanup in production, or perform any production cutover. It records what was implemented to close a recorded rollout blocker, what was measured, and what remains open.

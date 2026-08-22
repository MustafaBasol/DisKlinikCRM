# F5-1P — Queue Platform Disposable PoC and ADR-007 Evidence

**Task:** ClickUp `F5-1P` ([`869enfvvu`](https://app.clickup.com/t/869enfvvu)), under `EPIC F5` ([`869ed1jvf`](https://app.clickup.com/t/869ed1jvf)) — repository phase `F6`.
**Baseline:** `origin/main` @ `e7874422a818d8607f4c80032c3a800278550cdb`, verified at task start; no drift.
**Branch:** `feature/f5-1p-queue-platform-disposable-poc`, cut from fresh `origin/main` (**not** stacked on PR #478).
**Raw results:** [`../../architecture/poc/f5-1p-queue-platform/evidence/f5-1p-poc-run.json`](../../architecture/poc/f5-1p-queue-platform/evidence/f5-1p-poc-run.json)

**44 experiments · 44 PASS · 0 FAIL · 0 BLOCKED · 0 N/A**, reproduced across two independent full runs. No production system was contacted.

---

## 0. Entry authority

`docs/architecture/queue-outbox-poc-design.md` §12 and §14 require *"a separate,
future task with its own review"* before any experiment — including the Stage 4
disposable PoC — may run. The program-owner decision of 2026-08-22, which
accepted the F5-1 authorization audit, is that authorization. This is that task.

**Unchanged by this task, deliberately:** ADR-006 and ADR-007 remain `NEEDS_POC`.
BullMQ is **not** selected. Production rollout remains **not authorized**. The
KVKK freeze is untouched. `F6` phase status stays `TODO`.

---

## 1. What was built

Two candidates, same workload, same handler, same failure matrix:

- **Candidate A — PostgreSQL outbox + in-process dispatcher.** Claim implemented
  **both** ways: a guarded status transition (the mechanism
  `clinicBulkExportPackage.claimQueuedClinicBulkExportJobs()` already uses in
  production) and `SELECT … FOR UPDATE SKIP LOCKED`. Lease-based crash recovery,
  exponential backoff with jitter, dead-letter table.
- **Candidate B — BullMQ 6.2.0 + Redis 7.0**, `attempts` + exponential backoff,
  `UnrecoverableError` for permanent failures, failed-job retention.

Two things are shared **on purpose**, because they are the experiment:

1. **Business idempotency lives in PostgreSQL for both candidates**, keyed by a
   domain idempotency key with a `UNIQUE` constraint. This is how the PoC tests
   `queue-outbox-poc-design.md` §9's claim that BullMQ's `jobId` dedupe is a
   *transport* property, not business idempotency.
2. **The real production tenant primitive is imported, not reimplemented.**
   `server/src/tenancy/tenantContext.ts` depends only on `node:async_hooks`, so
   the PoC uses the same `runAsTenant` / `runAsSystem` / `requireTenantContext`
   the application uses. The tenant evidence below is about the real mechanism.

### Isolation, enforced rather than documented

`assertNoProductionEnvLeak()` **refuses to start** if `DATABASE_URL`, `REDIS_URL`
or `DIRECT_DATABASE_URL` is set. Credentials are generated per run; ports are
random and bound to `127.0.0.1`; PostgreSQL storage is `tmpfs`; teardown
(`docker compose down -v`) runs in a `finally`. Versions track the production
baseline (PostgreSQL 16.14, Redis 7.0.15) without touching production. The PoC
schema lives in `docs/architecture/poc/f5-1p-queue-platform/sql/01_schema.sql`,
**outside** `server/prisma/migrations/`, so nothing can apply it by accident.

> **A `finally` block turned out not to be enough.** During development an
> unhandled `error` event killed the process without unwinding, leaving two
> containers running for four hours. The harness now also tears down on
> `uncaughtException`, `unhandledRejection`, `SIGINT` and `SIGTERM`. Verified: a
> full re-run finishes 44/44 and leaves **zero** containers and **zero** volumes.

---

## 2. The decisive structural result

**E11c — a queued job survives a rolled-back business transaction.** With the
business `INSERT` rolled back, the enqueued BullMQ job remained: `waitingJobs: 1`,
`appointments: 0`. An orphan event, pointing at a row that does not exist.

**E11 / E11b — the outbox closes exactly that gap.** Business row and outbox row
commit in one transaction: on rollback both vanish (`appointments: 0, events: 0`);
on commit both exist (`1, 1`).

This is not a performance question or a preference. It is the one property
Candidate A has and Candidate B structurally cannot have on its own, because
Redis cannot enlist in a PostgreSQL transaction. It is also the property
`queue-outbox-poc-design.md` §5 identifies as the actual gap in the four
outbox-shaped NoraMedi flows.

---

## 3. Failure matrix

| # | Experiment | Candidate | Result |
|---|---|---|---|
| E11 | transaction rollback leaves no orphan | A | PASS — 0 appointments, 0 events |
| E11b | commit persists business row + event atomically | A | PASS — 1, 1 |
| E11c | BullMQ cannot offer commit-and-publish atomicity | B | PASS (demonstrated orphan) |
| E16 | 4-dispatcher race, guarded update | A | PASS — 60 claims, 60 distinct |
| E16b | 4-dispatcher race, `SKIP LOCKED` | A | PASS — 60 claims, 60 distinct |
| E02 | crash before claim | A | PASS — event stays reclaimable |
| E03/E17 | crash after claim → lease expiry → recovery | A | PASS — 1 recovered, executed once |
| E04 | crash **after** side effect, before finalise | A | PASS — 2 attempts, **1** side effect |
| E04b | same crash gap under BullMQ | B | PASS — 2 attempts, **1** side effect |
| E01 | duplicate event, shared business key | A | PASS — 1 side effect |
| E01b | duplicate delivery, **distinct** jobIds | B | PASS — 2 deliveries, **1** side effect |
| E12 | poison event | A | PASS — dead at attempt 1, retry budget not burned |
| E13 | transient failure → max attempts | A | PASS — 3/3 then dead, 0 side effects |
| E14 | dead-letter inspectable, no payload | both | PASS — digest only, no `payload` column |
| E15 | replay from dead-letter | A | PASS — executed exactly once |
| E15b | BullMQ failed-job inspection + DLQ mirror | B | PASS |
| E20 | non-minimal payload (PII) | both | PASS — rejected at publish **and** at consume |
| E21 | unsupported event version (v99) | both | PASS — refused, 0 side effects |
| E05 | Redis down **before** enqueue | B | PASS — producer **throws**, no silent drop |
| E05b | Redis down, Candidate A unaffected | A | PASS — no Redis dependency at all |
| E06/E07 | graceful Redis restart (SIGTERM) | B | PASS — job survived, client reconnected |
| E06b | abrupt Redis kill (SIGKILL) | B | PASS — see §5 |
| E08 | BullMQ worker restart | B | PASS — 10/10, no duplicates |
| E09 | dispatcher restart | A | PASS — 10/10 |
| E10 | PostgreSQL backends terminated mid-flight | A | PASS — pool reconnected, 8/8 once |
| E22 | graceful shutdown | A | PASS — 0 rows stuck in `claimed` |
| E23 | forced shutdown | A | PASS — 6 stranded, all lease-recovered, once each |
| E24 | backlog recovery, 3 cold dispatchers | A | PASS — 300 drained, no duplicates |
| E-RETRY-STORM | 40 failing events | A | PASS — exactly 120 attempts (40×3), no spin |
| E25 | queue depth / oldest age | both | PASS |
| M1 | inbound ledger dedupe | both | PASS — see §7 |

### Tenant safety (negative tests, against the real primitive)

| # | Attack | Result |
|---|---|---|
| T1 | tenant A job acts on tenant B | PASS — `CROSS_TENANT_REFUSED`, 0 side effects |
| T2 | same-org sibling clinic outside scope | PASS — `CROSS_CLINIC_REFUSED` |
| T3 | no tenant context at all | PASS — `TENANT_CONTEXT_MISSING` |
| T4 | malformed tenant identity (empty org) | PASS — `TENANT_CONTEXT_INVALID` |
| T5 | forged tenant id in job payload | PASS — rejected by payload minimisation; effect recorded under the **server-derived** org |
| T6 | 8 concurrent workers, one key | PASS — 1 executed, 7 suppressed |
| T7 | invented system reason / system borrowing tenant semantics | PASS — `SYSTEM_CONTEXT_REASON_UNKNOWN`, `TENANT_CONTEXT_MISSING` |

The worker pattern that produced these results is the one
`clinicBulkExportWorker` already documents: **claim under `runAsSystem({ reason:
'background-job' })`** because the owner is not yet known, then **`runAsTenant`
per row** once the row's owner is known. No new system-context reason was needed.

---

## 4. Performance (local disposable containers — **NOT** production capacity)

Both candidates measured with the **same** methodology: the full backlog is
enqueued first, consumers start only afterwards, and the drain is timed from
consumer start.

> **A methodology correction worth recording.** The first run started BullMQ
> workers *before* the enqueue loop, so they drained during it and `drainMs`
> measured only the tail — reporting 21,277/s against PostgreSQL's 1,838/s. That
> was a measurement artefact, not a result. Corrected below.

| | n=100 A / B | n=1000 A / B |
|---|---|---|
| Publish or enqueue p50 | 3ms / 1ms | 3ms / 1ms |
| Publish or enqueue p95 | 4ms / 2ms | 4ms / 2ms |
| Claim p50 / p95 (A only) | 4ms / 7ms | 5ms / 7ms |
| Drain | 137ms / 150ms | 530ms / 594ms |
| Throughput | 730/s / 667/s | **1,887/s / 1,684/s** |

**Throughput is comparable — PostgreSQL is marginally ahead in both runs.** The
enqueue-latency difference (1ms vs 3ms) is real but expected: Candidate A's
"publish" is a full database transaction that also writes the business row,
which is the atomicity being bought.

At this scale the performance argument does not favour BullMQ. That does not
mean it never will — it means the trigger has not been met and is not currently
measurable, exactly as ADR-007 records.

**Connection footprint (E-CONN):** PostgreSQL pool 30 backends (unchanged by
Candidate A — it reuses the existing database). BullMQ with 1 queue + 2 workers
at concurrency 5 held **7 Redis connections**. BullMQ adds a second connection
budget that must be planned separately, and it grows with worker count.

---

## 5. Redis durability — measured, and honestly bounded

- **E06/E07 (SIGTERM):** the job survived a graceful restart. `waiting` 1 → 1.
- **E06b (SIGKILL):** 50 jobs enqueued, Redis killed immediately, **50 survived**
  (`lost: 0`).

**The SIGKILL run is not evidence that no loss window exists.** `appendfsync
everysec` buys at most ~1s of durability by definition; this run simply did not
land inside the window. Reported as observed rather than generalised.

A first version of this experiment mounted Redis `/data` as `tmpfs`, which Docker
destroys on container stop. That measured the harness, not Redis, and reported a
false loss. Fixed to a named volume before the recorded run.

**The load-bearing point stands regardless:** Redis persistence is not
transactional durability. An event that must survive a Redis host failure needs
a durable source of record — which is what the outbox is — with the queue as
transport only.

---

## 6. Fairness — including a negative result about my own design

Measured as **per-tenant completion latency under real contention**: 240 noisy-tenant
events enqueued first and in full, then 3 quiet tenants × 10 events, with a 3ms
handler delay so processing is the bottleneck.

| Configuration | Quiet p50 | Quiet p95 | Noisy p50 |
|---|---|---|---|
| A — no per-tenant cap | **292ms** | 315ms | 175ms |
| A — per-tenant cap = 4 | **1,962ms** | 2,009ms | 1,006ms |
| B — BullMQ plain FIFO | **523ms** | 548ms | 275ms |

**The per-tenant cap made things worse, for everyone.** Quiet-tenant p50 rose
from 292ms to 1,962ms, and the quiet/noisy ratio also worsened slightly
(1.67 → 1.95). The cap did not deliver fairness; it delivered latency.

The cause is the design, not the concept: the cap is applied **after** claiming.
The dispatcher claims a batch, keeps at most N per tenant, and writes the
remainder back to `pending` — so with one dominant tenant most of every batch is
claimed and immediately released, burning two writes per skipped row.

**Correct conclusion: tenant fairness must be enforced at *selection* time, not
after the claim** — a per-tenant round-robin or lateral-join claim that never
picks more than N rows per tenant in the first place. That is a real design task,
and this PoC shows it is not free on either candidate.

**Do not read the A-vs-B rows as a like-for-like comparison.** Effective
in-flight concurrency differed (Candidate A processed a claimed batch of up to 20
concurrently; BullMQ ran 2 workers × concurrency 4 = 8). The *internally valid*
comparison is A-with-cap versus A-without-cap: same dispatcher, same workload,
one variable.

Neither candidate gives fairness for free. BullMQ can address it (groups,
per-key rate limiting) but does not by default; PostgreSQL can address it in the
claim query. Both require explicit design.

---

## 7. `MessagingInboundEvent` — already solved, do not rebuild

**M1:** a modelled provider redelivery of the same `wamid` under the real unique
constraint `(channel, provider, connectionId, providerMessageId)` produced
`first=accepted`, `second=duplicate`, `ledgerRows=1`.

This is what production **already does today** across Meta WhatsApp, Instagram
and Evolution WhatsApp via `createInboundEventOrDetectDuplicate`, with
`inboundEventRetryJob` driving retries. A queue placed *after* this point cannot
improve the guarantee, and a Redis-only acceptance path would **weaken** it.

**Consequence for ClickUp `F5-3`:** durable acceptance, provider deduplication
and bounded retry already exist. The genuine remaining gaps are **DLQ
inspection/replay tooling and queue metrics** — not durable acceptance. F5-3
should be re-scoped against this rather than planned as new construction.

Production inbound behaviour was **not** modified by this task.

---

## 8. KVKK and payload minimisation

`ALLOWED_PAYLOAD_FIELDS` is enforced, not documented: `appointmentId`,
`reminderKind`, `scheduledForIso`. Identifiers only.

**E20** proves it in both directions — a payload carrying `patientName` /
`tcKimlik` is rejected at publish, and an event that somehow bypassed the
producer is dead-lettered at consume as `MALFORMED_PAYLOAD` rather than retried
forever. **E14** proves the dead-letter store holds a `payload_digest` and has no
`payload` column at all, so a poison event cannot park PHI in an operational
table. No token, secret, credential or clinical detail appears in any envelope.

Retention implication: outbox rows and dead-letter rows are new retention
surfaces and would need to join `dataRetentionCleanupJob`'s categories before any
rollout. Not implemented here.

---

## 9. Comparison matrix

| Dimension | A — PostgreSQL outbox + dispatcher | B — BullMQ + Redis |
|---|---|---|
| Transactional atomicity | **Yes** (E11/E11b) | **Structurally impossible alone** (E11c) |
| Durability | business DB; survives Redis loss entirely (E05b) | Redis AOF; ~1s `everysec` window by definition (§5) |
| Retry / backoff | implemented, bounded, jitter (E13, E-RETRY-STORM) | built in, mature (E04b) |
| Poison handling | explicit, no retry burn (E12) | `UnrecoverableError` (E15b) |
| DLQ | own table, digest-only, queryable per tenant (E14) | failed-set + mirrored row for operator visibility |
| Replay | SQL + explicit system context (E15) | `job.retry()` (E15b) |
| Delay / scheduling | `available_at` only | **richer** — delayed jobs, repeatables, schedulers |
| Throughput (local) | 1,887/s @ n=1000 | 1,684/s @ n=1000 |
| Enqueue latency | 3ms p50 (includes business txn) | **1ms p50** |
| Operational complexity | **none new** — existing DB, existing worker | new stateful dependency, new failure domain |
| Redis dependency | **none** | hard; producer correctly fails loudly (E05) |
| DB load | higher — claim/finalise writes | lower |
| Worker scaling | lease + guarded claim, proven to 4 dispatchers | native, proven to 2 workers |
| Fairness | not free; must be at claim time (§6) | not free; needs groups/rate-limit (§6) |
| Observability | one SQL query, arbitrary per-tenant slicing | richer per-state counts built in |
| Tenant context | reconstructed per row (T1–T7) | identical mechanism, same envelope |
| KVKK payload | identical enforcement | identical enforcement |
| HA | inherits PostgreSQL HA | needs Redis HA **as well** |
| First-customer complexity | **lowest** — nothing new to run or back up | new service to secure, monitor, back up |
| Thousands-of-clinics trajectory | claim contention is the eventual limit | designed for this; the eventual answer |

---

## 10. ADR-007 recommendation (evidence, not a decision)

**`ADR_007_RECOMMENDATION = B` — adopt the PostgreSQL outbox + in-process
dispatcher for the current stage; defer BullMQ until a measured trigger.**

Reasoning from the evidence above, not from preference:

1. The one gap that actually loses events — commit-then-publish atomicity — is
   closed by A and structurally cannot be closed by B alone (§2).
2. Throughput is comparable once measured symmetrically (§4), so the usual
   performance argument for B is not currently supported.
3. B adds a new stateful dependency and a second failure domain to a
   single-VPS topology where Redis is presently **optional and fail-open**.
   Making Redis a queue transport silently promotes it to business-critical.
4. Neither candidate gives fairness for free (§6), so that is not a
   differentiator.
5. Much of what F5-3 wants already exists in `MessagingInboundEvent` (§7).

**When option C (hybrid: outbox as source of record, BullMQ as transport)
becomes right:** when a measured trigger appears — claim contention at the
dispatcher, a need for rich scheduling/delayed jobs beyond `available_at`, or
multi-consumer fan-out. None is measurable today because no production
observability exists (ADR-012 `DEFERRED`). That ordering matches
`queue-outbox-poc-design.md` §14 Stage 11 exactly.

**This is a recommendation, not an acceptance.** `ADR_007_FINAL_DECISION =
PENDING_HUMAN_REVIEW`.

## 11. ADR-006 evidence produced

Candidate A necessarily demonstrated transactional-outbox semantics, so this
evidence exists as a by-product and is recorded: atomic commit (E11/E11b), claim
mechanisms compared (E16/E16b), lease crash-recovery (E03/E17, E23), the
crash-after-side-effect gap (E04), retry/poison/DLQ (E12–E14), replay (E15),
payload minimisation (E20), and tenant reconstruction (T1–T7).

**Still missing for ADR-006:** real volume projections, which require production
observability that does not exist. **No general application outbox wiring was
implemented.** `ADR-006` remains `NEEDS_POC` pending human review.

---

## 12. Rollback

Revert the PR. The branch adds a test-only harness, PoC-only SQL, documentation
and one `devDependency`; it changes **no runtime path**, no schema, no migration,
and no configuration. `bullmq` is a devDependency never imported by runtime code —
removing it affects nothing that ships.

## 13. Lifecycle

`F5_1P_AGENT_COMPLETED = YES` · `F5_1P_TESTS_PASSED = YES` (44/44, plus server
typecheck) · `F5_1P_PR_OPENED = YES` · **`MERGED = NO` · `DEPLOYED = NO` ·
`PRODUCTION_VERIFIED = NO`**

`MERGE_SAFE = YES` (subject to program-owner review) · `DEPLOYMENT_SAFE = NO` ·
`PRODUCTION_CUTOVER_SAFE = NO`

**Exact next task:** the human ADR-007 architecture decision. `F5-2` and `F5-3`
remain `TO DO` behind it.

---

## 14. Non-authorization statement

This document authorizes nothing. It does not accept ADR-006 or ADR-007, does not
select a queue platform, does not lift or reinterpret any freeze boundary, does
not declare F6 entry, and does not authorize any production change. It is
disposable-environment evidence and a recommendation for a program-owner decision.

# F0-010 PoC Experiment Matrix — Queue and Transactional Outbox

Companion to [`queue-outbox-poc-design.md`](queue-outbox-poc-design.md). Documentation-only. **None of these experiments are authorized to run by this document** — they are the exact specification a future, separately-scheduled PoC task must execute in a disposable environment (never production, never the shared development database, never existing project migrations).

Format for every experiment: **Setup → Action → Expected result → Failure interpretation → Security significance → Acceptance threshold → Rollback/cleanup.**

All 25 experiments below correspond 1:1 to the 25 experiments required by the F0-010 task specification. Every experiment's environment is destroyed after that experiment's run unless explicitly noted otherwise.

---

### Experiment 1 — Transaction commit creates outbox row atomically

- **Setup:** Disposable PostgreSQL instance. PoC-only `OutboxEvent` table built per `queue-outbox-poc-design.md` §7.3. A harness service performs a business write (e.g. a simulated appointment-request confirmation) that, in the same `prisma.$transaction`, both updates a business row and inserts an outbox row.
- **Action:** Execute N (≥1,000) such transactions under normal conditions.
- **Expected result:** For every committed business-row change, exactly one corresponding outbox row exists with matching `aggregateId`/`organizationId`/`correlationId`.
- **Failure interpretation:** Any committed business change with zero or more-than-one outbox row indicates the transaction boundary is not actually atomic (e.g. the outbox insert was accidentally placed outside the `$transaction` block) — this is the exact anti-pattern already observed in production code today (F010-007's non-transactional appointment-create/request-update pair, F010-008's non-transactional state+audit write).
- **Security significance:** High — this is the base guarantee the entire outbox design depends on; without it, "at-least-once after commit" cannot be claimed.
- **Acceptance threshold:** 1,000/1,000 committed transactions produce exactly one matching outbox row.
- **Rollback/cleanup:** Destroy the disposable environment; no persistent state.

### Experiment 2 — Transaction rollback creates no event

- **Setup:** Same harness as Experiment 1.
- **Action:** Execute N (≥1,000) transactions that perform the same business write + outbox insert, but deliberately throw/abort before commit (simulating a validation failure or a later step in the same transaction failing).
- **Expected result:** Zero outbox rows and zero business-row changes exist for any aborted transaction.
- **Failure interpretation:** Any outbox row present without its corresponding committed business change indicates a "phantom event" risk — a downstream consumer could act on a business change that never actually happened.
- **Security significance:** High — a phantom event is a data-integrity and audit-integrity risk (an event with no corresponding real transition undermines trust in the whole event stream, and any consumer-side side effect based on it is unjustified).
- **Acceptance threshold:** 0/1,000 aborted transactions produce any outbox row.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 3 — Dispatcher claims rows without duplicate ownership

- **Setup:** Disposable environment with N (≥50) pre-seeded `pending` outbox rows. 3 dispatcher instances started concurrently, each implementing the lease-based guarded-`updateMany` claim pattern from `queue-outbox-poc-design.md` §7.10 (the `clinicBulkExportWorker.ts`-derived design).
- **Action:** All 3 dispatchers race to claim the same 50 rows simultaneously.
- **Expected result:** Every row is claimed (`status='claimed', lockedBy=<workerId>`) by exactly one dispatcher; no row is processed by more than one dispatcher.
- **Failure interpretation:** Any row claimed/processed by more than one dispatcher indicates the guarded `updateMany` claim is not actually exclusive under real concurrency (e.g. a missing `WHERE status='pending'` re-check, a non-atomic read-then-write).
- **Security significance:** High — duplicate ownership directly causes duplicate side effects (e.g. duplicate patient-facing messages), which is a patient-trust and (for financial reminders, F010-005) a billing-integrity issue.
- **Acceptance threshold:** Zero double-claims across ≥10 repeated runs of 50-row races with 3 concurrent dispatchers.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 4 — Multiple dispatchers using SKIP LOCKED

- **Setup:** Same as Experiment 3, but the dispatcher's claim query is reimplemented using `SELECT ... FOR UPDATE SKIP LOCKED` instead of the lease-based guarded `updateMany`, as a direct comparison point per `queue-outbox-poc-design.md` §7.10.
- **Action:** Repeat Experiment 3's race exactly, measuring both correctness (no double-claim) and lock-wait time under increasing dispatcher counts (3, 10, 30 concurrent dispatchers).
- **Expected result:** Zero double-claims (same correctness bar as Experiment 3); lock-wait time and claim latency measured and compared against the lease-based approach.
- **Failure interpretation:** Correctness failure here would indicate a `SKIP LOCKED` implementation mistake (e.g. claiming outside the same transaction as the lock), not a fundamental limitation of the mechanism itself. A significant latency regression vs. the lease-based approach under realistic dispatcher counts would argue against `SKIP LOCKED` for this codebase's first implementation, per §7.10's stated preference for the pattern with existing precedent.
- **Security significance:** High — same reasoning as Experiment 3.
- **Acceptance threshold:** Zero double-claims at all three concurrency levels; lock-wait time at p95 reported as a comparison data point, not a pass/fail gate for this experiment.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 5 — Crash before side effect

- **Setup:** Disposable environment, one dispatcher instance instrumented to allow a forced kill (`SIGKILL`) at a specific instrumented point: immediately after claiming a row (`status='claimed'`) but before invoking the consumer/side-effect function.
- **Action:** Trigger the forced kill at that exact point for N (≥20) claimed rows; start a fresh dispatcher instance afterward.
- **Expected result:** The fresh dispatcher's lease-expiry sweep (or `SKIP LOCKED`'s automatic lock release on connection death, if that variant is under test) reclaims every killed-mid-claim row exactly once; the side effect executes exactly once per row, after recovery.
- **Failure interpretation:** A row stuck permanently in `claimed` with no side effect ever executed indicates the lease-expiry recovery mechanism is broken — this is the exact class of gap already observed in production for `SentMessage` (F010-004/005, no stuck-`'prepared'` recovery sweep exists today).
- **Security significance:** High — this is the "event loss after committed transaction" scenario the acceptance criteria (design doc §13.1) treat as absolute.
- **Acceptance threshold:** 20/20 killed-mid-claim rows recover and produce exactly one side-effect execution within the configured lease TTL plus one dispatcher-poll interval.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 6 — Crash after side effect but before acknowledgment

- **Setup:** Same harness as Experiment 5, but the forced kill point moves to immediately after the (simulated) external side effect succeeds — e.g. a mock provider call returns success — but before the outbox row is marked `dispatched`.
- **Action:** Trigger the forced kill at that point for N (≥20) rows, using both (a) a side effect with no idempotency key support (simulating a legacy provider) and (b) a side effect using a provider-supplied idempotency key (simulating a provider that supports one, per design doc §7.11).
- **Expected result:** For (b), recovery re-attempts the call and the provider itself deduplicates via the idempotency key — no duplicate real-world effect. For (a), recovery re-attempts the call and DOES produce a duplicate real-world effect (a second message sent) — this is the expected, not a bug, result for a provider without idempotency support, and must be explicitly documented as such.
- **Failure interpretation:** If (b) still produces a duplicate real-world effect, the provider-idempotency-key integration is broken. If (a) is silently assumed not to duplicate without measurement, that is a documentation failure, not a code failure — this experiment's purpose is precisely to make that risk visible and measured, not to eliminate it (it cannot be eliminated for a provider without an idempotency mechanism).
- **Security significance:** Highest in this matrix — this is the exact unresolved crash window already present in production today (F010-004/005) and the central correctness question the whole outbox design exists to address (design doc §7.11).
- **Acceptance threshold:** (b) 0 duplicate real-world effects across 20 runs; (a) duplicate-effect rate measured and reported (not required to be zero, but must be non-zero-and-documented if the mock provider has no dedup, to prove the experiment is actually exercising the gap rather than trivially passing).
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 7 — Idempotent consumer duplicate delivery

- **Setup:** Disposable environment. A consumer implemented per design doc §7.12 (extending the `createInboundEventOrDetectDuplicate`/`P2002`-catch pattern already used in production for `MessagingInboundEvent`).
- **Action:** Deliver the same event to the consumer N (≥100) times deliberately (simulating at-least-once redelivery, not a bug in the dispatcher).
- **Expected result:** The consumer's business side effect (e.g. a database row created, a notification materialized) happens exactly once across all 100 deliveries; deliveries 2-100 are detected and no-op'd.
- **Failure interpretation:** Any side effect executed more than once indicates the consumer's idempotency key/constraint is missing or incorrectly scoped.
- **Security significance:** High — duplicate business side effects (e.g. duplicate notifications, duplicate financial reminders) directly harm patient trust and, for F010-005, financial-reminder correctness.
- **Acceptance threshold:** Exactly 1 side effect per 100 redeliveries, across ≥10 different event types/consumers tested.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 8 — Poison message behavior

- **Setup:** Disposable environment. An outbox row whose consumer is instrumented to always throw (simulating a permanently malformed event or a permanently broken downstream dependency).
- **Action:** Let the dispatcher retry the poison row up to the configured max-attempts threshold (design doc §7.3/§8, explicit `status='dead'` after the bound, replacing today's implicit `attempts >= 3` exclusion pattern from `inboundEventRetryJob.ts`). Simultaneously run 20 healthy, unrelated rows (including rows from other tenants) through the same dispatcher pool.
- **Expected result:** The poison row reaches `status='dead'` after exactly the configured attempt count and stops consuming dispatcher capacity; all 20 healthy rows (including other tenants') are dispatched normally and are not delayed by the poison row's presence.
- **Failure interpretation:** If healthy rows are measurably delayed or blocked by the poison row's presence in the same claim queue, the dispatcher's claim query or concurrency model has a head-of-line-blocking flaw.
- **Security significance:** High — directly tests the acceptance-criteria requirement "poison messages cannot block unrelated tenants indefinitely" (design doc §13.1).
- **Acceptance threshold:** Poison row reaches `status='dead'` at exactly the configured attempt count (not before, not after); healthy-row dispatch latency in the presence of a poison row is within 10% of dispatch latency measured without one.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 9 — Retry with exponential backoff and jitter

- **Setup:** Disposable environment. A consumer instrumented to fail the first K attempts (configurable, e.g. K=2) then succeed on attempt K+1.
- **Action:** Run 50 such rows with independently randomized K (0-3) and record the wall-clock interval between each retry attempt.
- **Expected result:** Retry intervals grow according to the configured exponential-backoff-with-jitter formula (not the fixed 5-minute delay `inboundEventRetryJob.ts` currently uses); no two rows' retries are perfectly synchronized (jitter is present and measurable).
- **Failure interpretation:** Fixed (non-growing) intervals indicate backoff is not implemented; perfectly synchronized retry timestamps across rows indicate missing jitter, which risks a retry-storm (many rows retrying at the exact same instant, momentarily spiking DB/provider load).
- **Security significance:** Medium — this is primarily an availability/fairness concern (retry storms can look like a self-inflicted denial-of-service against the DB or an external provider), not a data-integrity concern.
- **Acceptance threshold:** Measured backoff intervals fit the configured exponential curve within a defined tolerance; no two rows' retry timestamps coincide within a 1-second window in ≥95% of cases.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 10 — Per-tenant ordering where required

- **Setup:** Disposable environment. A simulated flow requiring strict per-key ordering, modeled on F010-008's real requirement (`revision`-chained consent events, design doc §5, §7.8) — NOT implemented via the outbox in production (F010-008 is `PARTIAL`, narrower-fix), but modeled here specifically to prove the outbox pattern COULD support it if a future flow needed it.
- **Action:** Publish 100 events for the same `(organizationId, aggregateId)` key in a known sequence, interleaved with events for 10 other keys, across multiple concurrent dispatcher workers.
- **Expected result:** Events for the same key are delivered to their consumer in publish order; events for different keys may interleave freely.
- **Failure interpretation:** Any out-of-order delivery within the same key indicates the claim/dispatch design does not actually preserve per-key ordering under concurrent dispatch (e.g. two dispatchers picked up two events for the same key simultaneously).
- **Security significance:** Medium-High — for a KVKK-relevant flow like consent, out-of-order processing could apply a stale consent state after a newer one, a compliance-relevant correctness bug.
- **Acceptance threshold:** 0 out-of-order deliveries within a key across ≥10 repeated runs with 3+ concurrent dispatchers.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 11 — No ordering where not required

- **Setup:** Disposable environment. A simulated flow modeled on F010-018 (notification generation) where cross-aggregate ordering is explicitly not required (design doc §5).
- **Action:** Publish 200 events across 20 different aggregates with no ordering expectation, across multiple concurrent dispatchers, and measure total dispatch throughput.
- **Expected result:** Events dispatch out of publish order across different aggregates with no correctness issue, and throughput is measurably higher than the ordering-constrained Experiment 10 scenario (since no per-key serialization is needed).
- **Failure interpretation:** If throughput is NOT measurably higher than the ordered case, the dispatcher may be over-serializing (e.g. accidentally applying per-key locking globally rather than only where declared necessary) — an efficiency defect, not a correctness one.
- **Security significance:** Low — this experiment is about not over-constraining the common case, not about a security property.
- **Acceptance threshold:** Measured throughput in the unordered scenario is at least 2x the per-key-serialized throughput measured in Experiment 10, given equal dispatcher/resource configuration.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 12 — Tenant-context reconstruction

- **Setup:** Disposable environment, ≥5 simulated tenants (organizationId/clinicId pairs). Consumer implemented to derive tenant context exclusively from the event row's own `organizationId`/`clinicId` columns (design doc §7.7), never from payload body inspection or an unscoped re-fetch.
- **Action:** Deliver events for all 5 tenants through a shared consumer/dispatcher pool, then have the consumer re-fetch the referenced aggregate (e.g. the appointment/patient) using the reconstructed tenant context.
- **Expected result:** Every re-fetch is correctly scoped to the event's own tenant; no re-fetch ever returns or is capable of returning another tenant's data.
- **Failure interpretation:** Any re-fetch returning cross-tenant data indicates the consumer trusted an unscoped query path rather than the event's own tenant columns — a direct violation of ADR-002's application-level scoping baseline.
- **Security significance:** Highest — this is the base tenant-isolation guarantee every other experiment in this matrix assumes holds, directly parallel to Experiment 1 in the F0-009 PoC test matrix.
- **Acceptance threshold:** Zero cross-tenant data returned across ≥10,000 simulated event-consumption cycles spanning all 5 tenants.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 13 — Cross-tenant consumer denial

- **Setup:** Same harness as Experiment 12, but the consumer is deliberately instrumented with an injected bug: it attempts to process an event using a DIFFERENT tenant's context than the event's own `organizationId` (simulating a coding mistake, e.g. a stale/cached tenant context from a prior event in a shared worker loop).
- **Action:** Run 100 such deliberately-mismatched event/context pairs through the full pipeline including any guard/validation layer the PoC builds.
- **Expected result:** Every mismatched attempt is rejected/blocked before any cross-tenant read or write occurs; the event is NOT silently processed under the wrong tenant.
- **Failure interpretation:** Any successful cross-tenant processing under this deliberately adversarial setup is a critical finding — it proves the design has no independent guard beyond "the consumer author remembered to use the right field," which is not a defense-in-depth guarantee.
- **Security significance:** Highest — this is the design's explicit test of whether tenant isolation is enforced independently of correct consumer code, not merely assumed from correct code (the same "defense-in-depth, not just discipline" principle ADR-002 already requires at the application layer).
- **Acceptance threshold:** 0/100 mismatched attempts result in any cross-tenant read or write; 100/100 are rejected with an auditable denial record.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 14 — Payload data-minimization validation

- **Setup:** Disposable environment. A schema-validation harness that inspects every published event's payload against the `payloadClassification` field and the "identifiers only by default" rule (design doc §7.4-7.5).
- **Action:** Publish events for every event type the PoC defines, including deliberately-malformed test cases that attempt to include PHI/PII fields (patient name, phone, free-text message content) without an explicit `payloadClassification` exception.
- **Expected result:** Events without an explicit exception and containing a field on a defined PHI/PII denylist (name, phone, email, free-text clinical/message content) are rejected at publish time, not merely flagged after the fact.
- **Failure interpretation:** Any PHI/PII field reaching a persisted outbox row without an explicit, reviewed exception indicates the minimization rule is advisory rather than enforced — directly repeating the `MessagingInboundEvent.rawPayload` pattern this design explicitly set out to avoid (design doc §7.4).
- **Security significance:** High — this is a KVKK-relevant data-minimization gate, not merely a style preference.
- **Acceptance threshold:** 100% of deliberately-malformed test payloads are rejected at publish time; 0 false rejections of legitimate identifiers-only payloads.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 15 — Anonymized/deleted patient reference behavior

- **Setup:** Disposable environment modeling `dataRetentionCleanupJob.ts`'s existing anonymize-not-delete pattern for `ContactRequest` (design doc §7.6). A simulated `Patient`-referencing event is published, then the referenced patient/contact row is anonymized (fields nulled, per the existing production pattern) before the event is consumed.
- **Action:** Deliver the event to a consumer after the referenced row has already been anonymized; repeat for a row that has been hard-deleted (simulating a stricter future retention policy, even though today's `dataRetentionCleanupJob.ts` never hard-deletes `Patient`).
- **Expected result:** For the anonymized case, the consumer resolves the reference at consumption time and receives the anonymized (null-name) values, not a stale cached name from publish time, and does not error. For the hard-deleted case, the consumer detects the missing reference and routes the event to the poison/dead-letter state (§8) rather than crashing or silently proceeding with a dangling reference.
- **Failure interpretation:** If the consumer either crashes on a missing reference, or silently proceeds using stale/cached PII captured at publish time instead of re-resolving at consumption time, both are failures — the first is a reliability gap, the second is exactly the "PHI/PII should not appear in payloads" principle (Experiment 14) being defeated indirectly via a cached reference.
- **Security significance:** High — directly tests whether the "identifiers only, resolve at consumption time" design principle actually holds under the messiest real-world case (anonymization racing with event delivery).
- **Acceptance threshold:** 100% of anonymized-reference deliveries resolve correctly to current (anonymized) state with no error; 100% of hard-deleted-reference deliveries route to the dead-letter state with no crash and no silent data fabrication.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 16 — External-provider idempotency

- **Setup:** Disposable environment, mock external providers simulating (a) a provider that accepts a client-supplied idempotency key and deduplicates server-side, and (b) a provider that does not (matching real WhatsApp/SMS provider heterogeneity — this experiment must first enumerate which real providers in `whatsappProviderFactory.ts`-equivalent code actually support this, per design doc §7.11's "provider-by-provider question").
- **Action:** Simulate a network partition that causes the dispatcher to believe a provider call failed/timed out when it actually succeeded, for both provider types, then let the dispatcher retry.
- **Expected result:** For provider type (a), the retried call is deduplicated by the provider and no duplicate message reaches the end recipient. For provider type (b), the retried call DOES produce a duplicate message — documented as an accepted, provider-specific limitation, not silently hidden.
- **Failure interpretation:** Same interpretation logic as Experiment 6(a)/(b) — this experiment is the provider-facing counterpart, focused on cataloguing which real providers this codebase integrates with actually support idempotency keys, which the current production code does not do today (F010-004/005 have zero provider-idempotency-key usage found in this investigation).
- **Security significance:** High — duplicate external messages to a patient are a real-world, patient-visible failure mode, not merely an internal-consistency concern.
- **Acceptance threshold:** For every real provider found to support idempotency keys, 0 duplicate deliveries across 50 simulated partition-retry cycles; for every provider found NOT to support them, the duplicate rate is measured and documented, and the PoC report explicitly lists which providers fall into which category.
- **Rollback/cleanup:** Destroy the disposable environment; no real provider is ever called (mocks only).

### Experiment 17 — Replay authorization and audit

- **Setup:** Disposable environment. Admin-replay tooling built per design doc §7.14 (platform-admin-authorized, `writeAuditLogInTx`-style transactional audit write).
- **Action:** (a) Attempt a replay as a platform-admin-authorized actor; (b) attempt a replay as a non-admin (clinic-level) actor; (c) replay an already-successfully-delivered event and verify no duplicate business side effect occurs (tying back to Experiment 7's idempotency guarantee).
- **Expected result:** (a) succeeds and produces an `AuditLog` row naming the operator, the replayed event ID(s), and the reason, written in the same transaction as the replay action itself (not fire-and-forget). (b) is rejected before any replay occurs. (c) produces zero duplicate side effects.
- **Failure interpretation:** Any successful non-admin replay is a critical authorization gap. Any successful admin replay with no corresponding audit row is an unaudited-bypass finding — explicitly named as unacceptable in the task's acceptance criteria ("zero unaudited replay"). Any duplicate side effect from replaying an already-delivered event indicates the consumer-idempotency guarantee does not actually cover the replay path.
- **Security significance:** Highest — this experiment directly tests the two absolute acceptance criteria "system/bypass access is explicit and audited" and "zero unaudited replay" (design doc §13.1).
- **Acceptance threshold:** 0/50 non-admin replay attempts succeed; 50/50 admin replay attempts produce a matching transactional audit row; 0 duplicate side effects across 50 replay-of-already-delivered-event trials.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 18 — Dispatcher restart and backlog recovery

- **Setup:** Disposable environment. Seed a backlog of 10,000 pending outbox rows across 20 simulated tenants. Start a dispatcher pool, let it run briefly, then kill and restart it (simulating a deploy or crash-restart).
- **Action:** Measure time-to-first-claim after restart, and total time to drain the full 10,000-row backlog, both before and after the forced restart.
- **Expected result:** The dispatcher resumes claiming rows within one poll interval of restart; the full backlog drains with no rows lost or permanently stuck, and total drain time is not disproportionately worse than an equivalent uninterrupted run (accounting for the restart's own downtime).
- **Failure interpretation:** Rows permanently stuck after restart indicate a lease-recovery gap (same class of bug as Experiment 5, but exercised via a real process restart rather than a single forced kill). Disproportionate drain-time regression indicates a cold-start inefficiency (e.g. no batched claiming, one row per query).
- **Security significance:** Medium — this is primarily a reliability/availability concern; a stuck backlog after every deploy would be an operationally serious but not directly security-critical gap, though a large stuck backlog of consent-adjacent events would compound into a KVKK timeliness concern if this pattern were ever applied to F010-008-shaped flows.
- **Acceptance threshold:** 0 permanently stuck rows after restart; full 10,000-row backlog drains within a defined multiple (e.g. 1.5x) of the uninterrupted-run baseline drain time.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 19 — Database connection impact

- **Setup:** Disposable environment matching the production connection-pool configuration documented by F0-009 (`DB_POOL_MAX` default 10, `server/src/db.ts:9-21`). Run the dispatcher pool at varying worker counts (1, 3, 10) alongside a simulated baseline application-request load.
- **Action:** Measure total connection count, connection-wait time, and any connection-exhaustion errors as dispatcher worker count increases.
- **Expected result:** Connection usage scales predictably with dispatcher worker count and stays within the documented pool budget at the PoC's target worker count; no connection-exhaustion errors occur under the target load.
- **Failure interpretation:** Connection exhaustion or unpredictable connection growth indicates the dispatcher's claim/query pattern is not connection-efficient (e.g. holding connections open across the side-effect call rather than releasing them, relevant to the `SKIP LOCKED` variant tested in Experiment 4 which requires a held transaction).
- **Security significance:** Low-Medium — this is primarily an availability concern (connection exhaustion could starve the main application, not just the dispatcher), directly relevant to already-`OPEN` risk R-008 (DB connection exhaustion).
- **Acceptance threshold:** Zero connection-exhaustion errors at the PoC's target worker count; connection count at that worker count is reported as a concrete number for R-008's evidence trail.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 20 — Performance under representative load

- **Setup:** Disposable environment. A synthetic load generator producing event volumes at multiples of a best-effort current-baseline estimate (since no real observability exists, per design doc §11, the PoC must state its assumed baseline explicitly as an assumption, not a measured fact) — e.g. 1x, 5x, 20x that assumed baseline.
- **Action:** Run each load level for a sustained period (e.g. 30 minutes) and measure: enqueue transaction latency delta vs. a no-outbox baseline, dispatcher throughput, p50/p95/p99 delivery delay, DB CPU/IO, worker memory/CPU, and per-tenant fairness under a synthetic single-tenant flood at the highest load level.
- **Expected result:** All measurements listed above are produced as concrete numbers at each load level; no specific pass/fail number is asserted in advance (per design doc §13.2, these are PoC outputs, not prior claims).
- **Failure interpretation:** N/A in the pass/fail sense for most metrics — this experiment's "failure" is producing no usable measurement (e.g. the load generator itself being unrepresentative, or a metric that cannot be captured with available tooling), which must be reported as a PoC limitation, not silently omitted.
- **Security significance:** Low directly, but High indirectly — this experiment's output is the primary evidence ADR-006/007's "volume projections" gap (design doc §17) still needs, and is a direct input to the Kafka trigger evaluation (design doc §11, items 1/5).
- **Acceptance threshold:** A complete measurement set (all named metrics) is produced at all three load levels; the enqueue-latency delta specifically must be reported with enough precision to compare against the acceptance proposal in design doc §13.2.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 21 — BullMQ comparison

- **Setup:** A SEPARATE disposable environment with a disposable Redis instance (the only experiment in this matrix requiring one — see design doc §10). The same synthetic workload from Experiment 20 is replayed against a BullMQ-based implementation of the same claim/dispatch/retry semantics.
- **Action:** Run the identical load levels and measurement set as Experiment 20 against the BullMQ implementation.
- **Expected result:** A side-by-side comparison table: Postgres-outbox-dispatcher vs. BullMQ, on every metric from Experiment 20, plus BullMQ-specific capabilities (native rate-limiting, native delayed jobs, Bull Board observability) assessed for whether they solve a gap the Postgres approach could not close.
- **Failure interpretation:** N/A in the pass/fail sense — this experiment's purpose is comparative evidence for ADR-007, not a pass/fail gate on either technology.
- **Security significance:** Low — an operational/architectural comparison, not itself a security test (Experiments 1-19 must be re-run conceptually against whichever candidate is eventually chosen for implementation, not assumed to transfer).
- **Acceptance threshold:** A complete comparison table is produced; the PoC report explicitly states whether any measured gap justifies BullMQ over the Postgres-outbox default, per design doc §9's "not selected by this document" framing — this experiment is what would change that framing in a future task, not this one.
- **Rollback/cleanup:** Destroy both disposable environments including the Redis instance.

### Experiment 22 — Queue unavailable while primary DB remains available

- **Setup:** The BullMQ-comparison environment from Experiment 21 (only relevant if a queue product is in scope; if the PoC's primary candidate — Postgres outbox — is the only thing built, this experiment instead simulates "dispatcher process unavailable while DB remains available," which is the equivalent failure mode for that architecture).
- **Action:** Stop the Redis/queue process (or the dispatcher process, for the Postgres-only variant) while continuing to send normal application write traffic (business transactions that create outbox rows) against the still-healthy primary DB.
- **Expected result:** Business transactions continue to succeed (outbox rows accumulate as a backlog); no application-facing error occurs from the queue/dispatcher being down, since publishing (write) and dispatching (read+claim) are decoupled. When the queue/dispatcher resumes, the accumulated backlog drains per Experiment 18's recovery behavior.
- **Failure interpretation:** Any application-facing write failure caused by the queue/dispatcher being unavailable indicates an accidental coupling between the publish path and the dispatch path — the publish path (inside the business transaction) must never depend on the queue/dispatcher being reachable.
- **Security significance:** Medium — this is an availability-isolation guarantee; conflating publish and dispatch availability would turn an operational/infrastructure outage into a patient-facing application outage.
- **Acceptance threshold:** 0 application-facing write failures attributable to queue/dispatcher unavailability across a sustained outage window (e.g. 10 minutes) with normal write traffic continuing.
- **Rollback/cleanup:** Destroy the disposable environment(s).

### Experiment 23 — Primary DB unavailable while queue remains available

- **Setup:** Same environment as Experiment 22 (queue/dispatcher variant, if a queue product is in scope).
- **Action:** Simulate primary PostgreSQL unavailability while the queue/Redis instance remains up.
- **Expected result:** Documented, not necessarily "successful" — since the outbox row itself lives in Postgres in the primary candidate design (§9), primary-DB unavailability necessarily halts new event publication regardless of queue availability. This experiment's purpose is to make that dependency explicit and measured (time-to-detect, error behavior), not to eliminate it. For the BullMQ-comparison environment specifically, this experiment also tests whether ALREADY-enqueued BullMQ jobs can continue to be dispatched/consumed while Postgres (used for the business data those jobs act on) is down — likely also failing at the consumer side, but the queue's own internal operation continuing is a genuine BullMQ-specific behavior worth recording.
- **Failure interpretation:** N/A in the strict pass/fail sense for the Postgres-outbox variant (failure IS the expected, documented behavior). For BullMQ, any crash or data-loss in the queue itself (as opposed to expected consumer-side failures) during a Postgres outage would be a BullMQ-specific finding worth recording.
- **Security significance:** Low-Medium — primarily an architecture-documentation experiment establishing an honest dependency graph, relevant input to any future SLA/availability discussion (out of scope for F0-010 itself).
- **Acceptance threshold:** The dependency behavior is fully documented with measured detection/error-surfacing time; no silent data corruption occurs in either variant during the outage.
- **Rollback/cleanup:** Destroy the disposable environment(s).

### Experiment 24 — Graceful shutdown and lease release

- **Setup:** Disposable environment, dispatcher pool actively processing a backlog. Instrumented to receive `SIGTERM`, modeled directly on `clinicBulkExportWorker.ts`'s existing graceful-shutdown behavior (`stopClinicBulkExportWorker`, design doc §3 — "unusually mature shutdown handling for this codebase").
- **Action:** Send `SIGTERM` mid-batch (some rows claimed and in-flight, others still pending) and observe behavior over a bounded grace period.
- **Expected result:** In-flight rows either complete and are acknowledged before shutdown, or have their lease explicitly released (not left to expire naturally) so the next dispatcher instance can claim them immediately rather than waiting out the full lease TTL; the process exits cleanly within the grace period.
- **Failure interpretation:** A row left claimed with no explicit lease release on graceful shutdown is a correctness gap even though it self-heals via lease expiry — explicit release (as `clinicBulkExportWorker.ts` already does) is strictly better than relying on expiry, since it avoids an unnecessary processing-delay window during routine deploys, which would happen on every deploy, not just crashes.
- **Security significance:** Low — an operational-quality concern (deploy-time backlog latency), not a security/correctness concern per se, since lease-expiry recovery (Experiment 5) already provides the correctness backstop.
- **Acceptance threshold:** 100% of in-flight rows either complete or have an explicitly released lease within the grace period across ≥20 forced-shutdown trials; process exits within the configured grace period in all trials.
- **Rollback/cleanup:** Destroy the disposable environment.

### Experiment 25 — Observability completeness

- **Setup:** Disposable environment, full dispatcher pool running the combined workload from Experiments 1-24 (or a representative subset), with whatever logging/metrics instrumentation the PoC builds.
- **Action:** Attempt to answer, using ONLY the PoC's own instrumentation (no direct DB inspection): current backlog size per tenant, current dead-letter count, p95 delivery delay, and "which specific event IDs failed and why" for a deliberately-injected failure batch.
- **Expected result:** Every one of those four questions is answerable from the instrumentation alone.
- **Failure interpretation:** Any question answerable only via direct DB inspection (not the PoC's own metrics/logs) indicates an observability gap that would be invisible in a real deployment — directly relevant given ADR-012 (observability standard) is itself `DEFERRED` and no production log/metrics inventory exists today (design doc §3, §17). This experiment's findings should be treated as required input to a future ADR-012 evidence-gathering pass, not solved by this PoC alone.
- **Security significance:** Medium — an undetectable backlog or dead-letter accumulation is an operational blind spot that could mask exactly the "poison messages blocking tenants" and "event loss" failure modes Experiments 8 and 5/6 test for directly; without observability, those failures could recur in production without anyone noticing.
- **Acceptance threshold:** All four listed questions answerable from instrumentation alone; any gap is explicitly named in the PoC report rather than silently left unanswered.
- **Rollback/cleanup:** Destroy the disposable environment.

---

## Coverage statement

This matrix specifies exactly the 25 experiments required by the F0-010 task instruction — no more, no fewer — chosen to exercise every acceptance-criteria item in `queue-outbox-poc-design.md` §13 at least once. It does not claim to be an exhaustive test suite for a future real implementation; a future implementation task's own test plan would need to expand well beyond this list (e.g. per-real-provider integration tests, real-schema migration tests) once a concrete design is authorized.

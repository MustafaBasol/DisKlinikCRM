# F5-3 — Messaging Fast-Ack, Retry/Backoff, DLQ and Replay

**Task:** ClickUp `F5-3` ([`869ed1t5e`](https://app.clickup.com/t/869ed1t5e)), under `EPIC F5` ([`869ed1jvf`](https://app.clickup.com/t/869ed1jvf)) — repository phase `F6`.
**Baseline:** originally `origin/main` @ `6e1d2e0b881a96f10aaf92d05984a7369448310b`. **Restacked 2026-08-22 onto `origin/main` @ `11956cfcce37a56f5be2f9bb4e8b9e5340a50f35`** — the PR #480 (F5-2) merge commit — after F5-2 landed. See §1.
**Branch:** `feature/f5-3-messaging-reliability-dlq-replay`, rebased (not merged) onto the post-F5-2 `main`.
**Stacked?** **NO** — see §1. The reasons held, and the predicted conflict was resolved additively on the restack.

**77 tests · 77 PASS · 0 FAIL** (49 DB-free contract tests, 28 against real disposable PostgreSQL 16.14), plus twelve existing suites re-run green and three webhook suites re-run a second time with the new flag **enabled**.

**No production system was contacted. Nothing is merged, deployed, migrated in production, or activated.**

---

## 1. Stacking decision: NOT stacked on F5-2, and why

F5-3 could plausibly have been stacked on F5-2 to reuse its retry-category vocabulary. It is not, for three reasons, in order of weight:

1. **`ci-pr.yml` triggers on `pull_request: branches: [main]` only.** A PR stacked onto `feature/f5-2-transactional-outbox-event-registry` would receive **zero checks** — no typecheck, no Layer 2/3/4/5, no guardrail. `F5_3_CI_PASSED` could not be satisfied at all. Stacking would trade a nice-to-have code reuse for the loss of the entire CI gate.
2. **F5-3 needs nothing F5-2 introduced.** Its whole surface is `MessagingInboundEvent`, the retry job, the three provider clients and two webhook routes — all present on `main`. It publishes no `OutboxEvent`, uses no dispatcher, and imports nothing from `server/src/outbox/`.
3. **Merge order becomes free.** Either PR can merge first, in either order, with no conflict beyond `package.json` script lines and two aggregate suite strings.

**The duplication this costs, stated plainly:** `messaging/messagingFailureClassification.ts` defined the same failure categories and the same full-jitter backoff shape as F5-2's `outbox/outboxErrors.ts`. Recorded at the time as a follow-up rather than pretended away.

### 1.1 The restack, and what happened to that follow-up (2026-08-22)

F5-2 merged first as PR #480. F5-3 was rebased onto the resulting `main` (`11956cf`). Three files conflicted, all additively, all resolved with **both** tasks' entries surviving: `NORAMEDI_MASTER_TRACKER.md` §13 (the F5-3 lane entry now sits above the F5-2 one, which stands verbatim), `F6_QUEUE_OUTBOX_AND_RELIABILITY.md` (both change-history rows present, ascending as that table is ordered), and `server/package.json` (the aggregate suites now run the outbox **and** the messaging suites; no duplicated entries).

The follow-up was then re-examined against the merged F5-2 code rather than against the assumption. **It was half right, and the half that was wrong is the more important one.**

| | Identical? | Disposition |
|---|---|---|
| Full-jitter backoff arithmetic | **Yes** — line for line, differing only in which base table and ceiling were read | **Unified.** Extracted to `utils/backoff.ts` as `computeFullJitterBackoffMs`; both domains delegate. |
| Failure categories | **No** — messaging has `TIMEOUT`, which the outbox has no way to raise (the dispatcher runs in-process; no socket to time out) | Retained per domain |
| Per-category base delays | **No** — messaging is 4–5x the outbox in every retryable category, because a provider redelivery is a far slower loop than an in-process dispatch | Retained per domain |
| Retry ceiling | **No** — 30 minutes (outbox) vs 1 hour (messaging) | Retained per domain |
| Persisted error codes | **No** — seven members each, sharing exactly one (`MAX_ATTEMPTS_EXCEEDED`); the rest are `UNREGISTERED_EVENT`/`NO_CONSUMER`/`AMBIGUOUS_SIDE_EFFECT` against `MISSING_CONNECTION`/`NO_RETRY_HANDLER`/`STUCK_IN_PROCESSING` | Retained per domain |
| Error classes | **No** — `OutboxConsumerError` carries `cause`; `MessagingProviderError` carries `httpStatus` | Retained per domain |

So the unification is real but deliberately narrow: **one pure function, no domain vocabulary moved.** `utils/backoff.ts` imports nothing, knows nothing of Prisma, tenants, the outbox or messaging, and is therefore safe for both to depend on. There is **no `outbox` → `messaging` import and no `messaging` → `outbox` import** in either direction, and no cycle.

Forcing the vocabularies together would have handed each domain codes it can never emit — exactly the cross-domain business coupling both lanes exist to prevent — so it was not forced. The remaining difference is **intentional, not residual debt**, and is recorded here so nobody re-opens it as an oversight.

The behaviour-preservation of the one change that touches F5-2 code is proven rather than asserted: `test:outbox-contracts` (53 passed, 0 failed) exercises `computeBackoffMs` through its cap, growth, zero-jitter, `Retry-After` floor and per-category ordering assertions, and passes unchanged against the delegating implementation.

---

## 2. Current-state audit — what was actually measured

Read from `origin/main` @ `6e1d2e0`, not assumed.

### Inbound

| | Meta WhatsApp | Evolution WhatsApp | Instagram |
|---|---|---|---|
| Durable acceptance | ✅ | ✅ | ✅ |
| **ACK ordering** | ❌ **200 sent BEFORE the ledger write** | ✅ ledger write precedes every 200 | ❌ **200 sent BEFORE the ledger write** |
| Provider dedupe | ✅ real `UNIQUE` | ✅ | ✅ |
| Automatic retry | ✅ | ❌ **never retried** | ❌ **never retried** |
| Backoff | ❌ fixed 5-min floor, no growth, no jitter | — | — |
| Attempt limit | ✅ 3 | — | — |
| Terminal state | ❌ none | ❌ none | ❌ none |
| DLQ inspection | ❌ | ❌ | ❌ |
| Manual replay | ❌ | ❌ | ❌ |
| Metrics | ❌ | ❌ | ❌ |
| KVKK on failure | ❌ raw `error.message` persisted | ❌ | ❌ |

### Outbound

| | Meta WhatsApp | Evolution WhatsApp | Instagram |
|---|---|---|---|
| **Timeout** | ❌ **none** | ❌ **none** | ❌ **none** |
| Error classification | ❌ one opaque string | ❌ | partial |
| `Retry-After` | ❌ | ❌ | ❌ |
| 429 vs 5xx vs 401 | ❌ indistinguishable | ❌ | ❌ |
| Retry | ❌ none | ❌ none | ❌ none |
| Circuit breaker | ❌ | ❌ | ❌ |
| KVKK | ❌ provider body concatenated into the error | ❌ | ✅ redacts |

Reminder flows (`jobs/reminders.ts`) write a `SentMessage` ledger row `prepared → sent/failed` and never retry; that is schedule-shaped, self-healing on the next tick, and was already rejected as outbox-shaped in F5-2 §7.

### The four findings that drove the work

1. **ACK-before-durable-write on two of three inbound channels.** `res.status(200)` is the first statement of the Meta handler and `res.sendStatus(200)` the first of both Instagram handlers. Between that line and `createInboundEventOrDetectDuplicate` sit a JSON parse, a connection lookup, a signature check and a clinic resolution. A crash, a pool exhaustion or a database blip in that window loses the message **permanently** — and Meta never redelivers a webhook it has already 200'd. The retry job cannot help: it retries rows in the ledger, and this message never reached it.

2. **`failed` meant four different things.** Retryable-soon; out of attempts; aged past the six-hour window (still `attempts: 1`, so it *looks* retryable forever); or from a channel the retry job never selects. Cases 2–4 are terminal and nothing said so.

3. **Zero of 16 outbound `fetch` calls had a timeout.** Node's `fetch` has no default. A provider that accepts a connection and never answers blocks the caller indefinitely — including inside `jobs/reminders.ts`, which holds a `withJobLock` lease while it sends, so one hung send stalls *every other clinic's* reminders for that tick.

4. **A raw exception message was persisted.** `markInboundEventFailed` stored `error.message.slice(0, 1000)`, and provider error strings are built by concatenating the provider's raw response body (`...failed with ${status}: ${errorText}`). A provider body can echo the recipient's phone number or the message content, so an operational column an operator reads could hold communication content nobody decided to retain.

---

## 3. What was implemented — and what was deliberately not

### Implemented

| Area | Module |
|---|---|
| Failure categories, `Retry-After` parsing, jittered backoff | `server/src/messaging/messagingFailureClassification.ts` |
| Bounded outbound HTTP (ref'd timer) | `server/src/messaging/messagingHttp.ts` |
| Terminal state, DLQ inspection, metrics | `server/src/messaging/messagingInboundDlq.ts` |
| Authorized, audited replay | `server/src/messaging/messagingInboundReplay.ts` |
| Which channels can be re-driven, and why not | `server/src/messaging/messagingRedeliveryRegistry.ts` |
| Durable-ack flag | `server/src/messaging/messagingReliabilityConfig.ts` |
| Exactly-one-response gate | `server/src/messaging/webhookAckGate.ts` |

Plus: six additive columns and one index on `MessagingInboundEvent`; the retry job rewritten around the registry, backoff and terminal states; `markInboundEventFailed` hardened; timeouts and classification in all three provider clients; the ACK moved behind durable acceptance in both Meta and both Instagram POST routes.

### NOT implemented, deliberately

- **No re-delivery handlers for Evolution or Instagram.** Building them means re-running a conversational AI turn from a stored envelope — replying to a question the patient has moved on from, or re-entering a booking flow whose slot is gone. The existing six-hour `RETRY_WINDOW_MS` exists precisely because that risk was already recognised for Meta (*"bayat AI yanıtı göndermeyi önler"*). F5-3 makes the absence **visible and terminal** (`NO_RETRY_HANDLER`) instead of silently permanent; writing the handlers is a product decision, not a reliability one. `messagingRedeliveryRegistry.ts` is where that answer lives, and a test holds it to the real ledger writers so a fourth channel cannot appear unclassified.
- **No circuit breaker.** §33 requires evidence of a real retry storm. There is none, and the reason is structural: **outbound has no retry at all today**, so there is nothing to storm. Inbound retries are capped at 3 attempts on a 10-minute cron with a 50-row batch — a ceiling of 15 attempts/minute across the entire platform. Adding a breaker now would be the same speculative mechanism F5-1P measured making things worse for fairness. **Trigger recorded:** introduce one when metrics show sustained `PROVIDER_OUTAGE`/`RATE_LIMIT` at a rate the backoff does not absorb, or when outbound retry is added. The classification and `Retry-After` plumbing it would need already exist.
- **No outbox routing for outbound messages.** §34 authorizes it only for flows with outbox semantics. Reminders are schedule-shaped (F5-2 §7); the confirmation flow is already covered by F5-2. Routing every outbound message through `OutboxEvent` because the infrastructure exists is exactly what ADR-006's acceptance conditions refuse.
- **No operator HTTP route.** As in F5-2, DLQ/metrics/replay ship as services. Role authorization for replay is therefore undecided by design — that contract is its own reviewable change.
- **No ordering guarantees.** §35: no evidence was found that per-conversation ordering is currently violated or relied upon, and the inbound path is already effectively per-message. Promising ordering without evidence would be a claim, not a feature.

---

## 4. Fast-ack — the one production-visible change, and why it is flagged

The shape is now `validate → durably accept/dedupe → ACK → process asynchronously`, which is exactly §29's requirement. **Only the durable write moved**; processing stays after the ACK. There is no in-memory queue and no Redis-only path anywhere in F5-3 — `MessagingInboundEvent` remains the single inbound durability ledger, and a test asserts no second ledger model was invented.

Introducing this meant the response could no longer be the first statement, so every early-return branch (malformed payload, unresolved connection, rejected signature, nothing to route) had to answer for itself — and answer exactly once, since a second `res.status(200)` is an `ERR_HTTP_HEADERS_SENT` crash in a public route. `webhookAckGate.ts` makes that a property of an object rather than something four branches per route must remember, and preserves each route's **existing response shape byte for byte** (Meta answers `200 {"status":"ok"}`, Instagram a bare `sendStatus(200)`).

The `fail()` path is the actual win: when acceptance itself fails, the gate answers **503** so Meta's own redelivery becomes the backstop, instead of a 200 nobody can take back.

**`MESSAGING_DURABLE_ACK_ENABLED` defaults OFF.** With it off the 200 goes out first exactly as today and `gate.fail()` is a no-op — deploying this branch is behaviourally identical. Everything else in F5-3 ships unflagged, because gating a strict improvement behind a flag nobody remembers to turn on is how a fix ships and never takes effect.

---

## 5. Retry, backoff and terminal states

`nextAttemptAt` carries exponential backoff with **full jitter**, floored by a provider `Retry-After`, capped at one hour. The pre-F5-3 behaviour was a fixed five-minute floor with no growth and no jitter — the exact shape that brings every event failed by one outage back together, every five minutes, for as long as the outage lasts.

`nextAttemptAt: null` deliberately keeps its old meaning ("eligible once the five-minute minimum age has passed"), and it is NULL on every pre-existing row. **That is what makes the migration safe to deploy ahead of the application.**

Terminal codes: `MAX_ATTEMPTS_EXCEEDED` · `RETRY_WINDOW_EXPIRED` · `NO_RETRY_HANDLER` · `MISSING_CONNECTION` · `CONNECTION_INACTIVE` · `UNPARSEABLE_PAYLOAD` · plus the non-retryable categories (`AUTH_CONFIGURATION`, `TENANT_CONFIGURATION`, `PERMANENT_VALIDATION`, `POISON`). Retryable: `TRANSIENT`, `TIMEOUT`, `RATE_LIMIT`, `PROVIDER_OUTAGE`, `UNKNOWN` — an unclassified failure is retryable on the shortest budget, which is the fail-safe direction.

Classification **never sniffs message text**: an `Error` whose message reads "429 rate limited" is `UNKNOWN`. That keeps the policy correct when a provider rewords itself and keeps PII out of control flow.

---

## 6. Provider outage and timeouts

`fetchWithTimeout` bounds every messaging provider call at 15s by default.

**It deliberately does not use `AbortSignal.timeout()`**, which looks like exactly the right tool and is a trap: its timer is **unref'd**, so in a short-lived worker tick the event loop can drain while a `fetch` is still outstanding — leaving a promise that will never settle and no handle keeping the process alive to settle it. The bound is an ordinary ref'd `setTimeout` driving an `AbortController`, cleared in a `finally`, composing with (not replacing) any caller-supplied signal. A test asserts `AbortSignal.timeout` does not appear in the module.

The timeout is proved **against a real local HTTP server that accepts the connection and never answers** — a timeout that only works against a mock is not a timeout.

Outbound errors now carry `errorCode`, `httpStatus` and `retryAfterMs` alongside a message built solely from a stable code and a numeric status. `classifyProviderHttpStatus` takes the status and headers and **never the body** — a function that never receives the body cannot leak it, and a test asserts the signature has no body parameter.

---

## 7. DLQ, metrics and replay

**DLQ inspection** requires an `organizationId` predicate; there is no "all organizations" mode. It returns identifiers, stable codes, attempt counts, ages and timestamps — and deliberately **not** `rawPayload`, `errorMessage`, `fromPhone` or `toPhone`. `providerMessageId` plus `connectionId` is enough to find the conversation in the provider's own console without putting a patient identifier on an operator's screen.

**Metrics** are platform-wide by design — "is messaging healthy" is not a tenant question, and the point is to see an outage affecting every clinic at once. Dimensions are bounded to status, channel and provider: no per-clinic, per-patient or per-message slice.

**Replay** reuses the row rather than creating a new one, which is the opposite of F5-2's outbox replay and for a precise reason: an outbox event is an *obligation the system owes* and its failure record must survive, whereas an inbound event is a record of something that *happened*, whose identity is the provider's own message id. A second row for one real message would violate the very dedupe constraint that is the point of the ledger.

Refusals, all checked before anything is written: `NOT_FOUND` (cross-organization — never "forbidden", which would be an id oracle) · `CROSS_CLINIC_REFUSED` · `NOT_TERMINAL` · `ALREADY_PROCESSED` · `REPLAY_LIMIT_EXCEEDED` · `NO_REDELIVERY_HANDLER` · `UNROUTABLE` · `NO_STORED_PAYLOAD`. Payload mutation is not expressible — there is no argument for it.

---

## 8. Tenant and KVKK impact

**No new `SystemContextReason`.** Everything reuses `inbound-webhook-envelope`, the reason `messagingInboundIdempotency.ts` already declares for this model, and a test asserts no other reason appears in the new modules. `MessagingInboundEvent` stays `EXPLICIT_REVIEW_REQUIRED` / `BLOCKED_PENDING_REVIEW` — F5-3 adds columns, not a reclassification. `tests/tenantSystemContextInventory.test.ts` records the two new files and the retry job's changed call-site count.

**KVKK improvements are net-positive and measured:** the raw exception message is gone from the write path; provider bodies no longer reach any returned error string; the DLQ view exposes no content and no phone number; metric dimensions are bounded. `MessagingInboundEvent` was **already** in `dataRetentionCleanupJob` (unlike F5-2's new outbox tables), so no new retention surface is introduced — the new columns are codes and timestamps on an already-swept row.

**One honest residual:** rows written *before* this change still hold raw exception text in `errorMessage`. F5-3 stops writing it and never reads it back, but does not rewrite history — a data migration over an operational column was judged the more dangerous option. The existing retention sweep removes those rows on its normal schedule.

---

## 9. Migration

`20260822130000_add_messaging_inbound_reliability_fields` — hand-authored, strictly additive: six nullable/defaulted columns and one index on `MessagingInboundEvent`. Nothing altered, renamed or dropped; no existing row rewritten.

Verified against a **clean** disposable PostgreSQL 16.14: `prisma validate` valid · `migrate deploy` applied · `migrate status` → *"Database schema is up to date!"* · `migrate diff --from-config-datasource --to-schema` shows **zero drift for any of the new objects** (the single `MessagingInboundEvent` line it does report is a pre-existing index-name truncation rename, present on `main` and untouched here).

**Backward compatible:** the previous application version selects named columns and never sees these. `nextAttemptAt` is NULL on every existing row, which is deliberately the same meaning the pre-F5-3 retry job already had — so a database migrated ahead of the application behaves exactly as it does today.

**Rollback: do NOT drop these columns.** `status = 'dead'` rows written while the new version was live would silently become indistinguishable from retryable ones, and the replay audit trail would be destroyed. Reverting the application is sufficient and safe.

---

## 10. Test results

| Command | Exit | Pass | Fail |
|---|---|---|---|
| `npm run test:messaging-reliability` (Layer 2) | 0 | 49 | 0 |
| `npm run test:messaging-inbound-reliability-db` (Layer 3) | 0 | 28 | 0 |
| `npm run test:meta-wa` | 0 | 62 | 0 |
| `npm run test:whatsapp` | 0 | 90 | 0 |
| `npm run test:instagram` | 0 | 28 | 0 |
| `npm run test:inbox` | 0 | 25 | 0 |
| `npm run test:data-retention` | 0 | 48 | 0 |
| `npm run test:jobs-utils-log-privacy-wave2` | 0 | 37 | 0 |
| `npm run test:meta-wa-log-privacy` | 0 | 7 | 0 |
| `npm run test:meta-whatsapp-webhook-log-privacy` | 0 | 7 | 0 |
| `npm run test:instagram-log-privacy` | 0 | 11 | 0 |
| `npm run test:tenant-system-context-inventory` | 0 | 16 | 0 |
| `npm run test:tenant-model-classification` | 0 | 28 | 0 |
| `npm run test:raw-sql-tenant-audit` | 0 | 12 | 0 |
| `npm run test:tenant-guard-isolation` (Layer 3) | 0 | 36 | 0 |
| `npm run test:meta-whatsapp-post-booking` (Layer 3) | 0 | 6 | 0 |
| `npm run test:whatsapp-public-api-explicit-clinic-binding` (Layer 3) | 0 | 29 | 0 |
| **Flag-on re-run** — `meta-wa`, `instagram`, `meta-whatsapp-post-booking` with `MESSAGING_DURABLE_ACK_ENABLED=true` | 0 | 62 + 28 + 6 | 0 |
| server `tsc --noEmit` · frontend `tsc -b` | 0 | — | — |
| `log-privacy-guard:scan -- --strict-baseline` | 0 | 308 files, **no new violations** | — |
| `guardrail:scan` | 0 | — | — |

**Two genuine defects were caught by these tests during development, not by review:**
- `parseRetryAfterMs('-5')` returned `0` instead of `undefined`, because `Date.parse` reads `-5` as a year — turning a malformed header into "retry immediately". Fixed with an explicit numeric-shape rejection before the date branch.
- The structural scan found two `errorText` concatenations still live in `sendTemplateMessage` and `testConnection` after the first pass fixed only `sendMessage`. The connection-test one is shown to clinic staff.

### Security tests (§39) — coverage

Covered: cross-clinic inspection rejected · cross-clinic replay rejected · sibling-clinic access rejected unless scope permits · replay of a successful event rejected · duplicate/concurrent replay resolves to exactly one requeue · malformed (no-payload) event cannot be replayed · unsupported channel cannot be replayed blindly · logs and persisted columns expose no payload or PII · provider auth failure (`AUTH_CONFIGURATION`) is not retried.

**Not covered, honestly:** a live provider outage against the real Meta/Evolution/Instagram endpoints. The classification is proved against real HTTP statuses and a real hanging socket; the *provider's* behaviour under outage is not something a disposable environment can assert, and F5-1P's honesty about the Redis SIGKILL window is the precedent for saying so rather than generalising.

---

## 11. Rollback

1. `MESSAGING_DURABLE_ACK_ENABLED=false` (or unset) — the 200 returns to the top of the handler, exactly as today.
2. Revert the application version if needed. The retry job returns to its previous selection and backoff; `dead` rows simply stop being produced.
3. **Do not drop the migration's columns.** See §9.

Rows already marked `dead` remain terminal and inspectable by any version that understands the column; a reverted application treats them as an unknown status and will not retry them — which is the correct, conservative outcome for an event that was already judged terminal.

---

## 12. Runbook

[`../runbooks/F6_MESSAGING_RELIABILITY_OPERATIONS.md`](../runbooks/F6_MESSAGING_RELIABILITY_OPERATIONS.md) covers provider outage, retry backlog, terminal events, manual replay, poison events, stale processors, database unavailability, invalid credentials, rate limiting, backlog recovery, and disabling the durable-ack path — with a per-role table for clinic operator, platform operator and engineer.

---

## 13. Lifecycle

```
F5_3_AGENT_COMPLETED       = YES
F5_3_TESTS_PASSED          = YES   (77 new, 0 failed; 17 existing suites re-run green)
F5_3_PR_OPENED             = YES   (draft)
F5_3_CI_PASSED             = see the PR record
F5_3_MERGED                = NO
F5_3_MIGRATION_DEPLOYED    = NO
F5_3_APPLICATION_DEPLOYED  = NO
F5_3_FEATURE_ACTIVATED     = NO
F5_3_PRODUCTION_VERIFIED   = NO
```

`MERGE_SAFE = YES` (subject to program-owner review) · `DEPLOYMENT_SAFE = NO` · `PRODUCTION_CUTOVER_SAFE = NO`.

---

## 14. Non-authorization statement

This document authorizes nothing. It does not merge, deploy, run a production migration, enable `MESSAGING_DURABLE_ACK_ENABLED`, or perform any production cutover. It records what was measured on `main`, what was implemented against it, what was deliberately deferred with its trigger, and what remains open.

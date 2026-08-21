# F5-1 — Redis Production Policy and BullMQ Platform: Authorization Audit and Current-State Evidence

**Task:** ClickUp `F5-1` (`869ed1rx2`), child of `EPIC F5 — BullMQ, Transactional Outbox ve Messaging Dayanıklılığı` (`869ed1jvf`).
**Baseline:** `origin/main` @ `e7874422a818d8607f4c80032c3a800278550cdb` (PR #477 merge), verified by `git fetch origin --prune` + `git rev-parse origin/main` at task start. No drift.
**Branch:** `docs/f5-1-queue-platform-authorization-audit`. **Worktree:** `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f5-1-queue-platform-audit`.
**Class:** Documentation and read-only repository evidence only. **No** application, schema, migration, dependency, configuration, or runtime file was touched. No production system was contacted.

---

## 0. Headline

**F5-1 as specified in ClickUp cannot be implemented at this baseline, and the block is not a matter of engineering judgement.** Four independent governance gates each prohibit it on their own, and one of them — `docs/architecture/queue-outbox-poc-design.md` — is the very document that would otherwise have supplied the authorization, in the same way `tenant-rls-pgbouncer-poc-design.md` §12 supplied it for F3-3.

This document does the part of F5-1 that **is** authorized: the current-state audit (Redis classification, queue/job inventory, `JobLock`, `MessagingInboundEvent`), plus an exact statement of what must happen before implementation can begin. It does not implement a queue platform, install a dependency, or change a failure policy.

`F5_1_ACCEPT = NO` — see §8.

---

## 1. What F5-1 asks for

ClickUp `869ed1rx2`, verbatim:

> Make Redis mandatory in production, define security fail-closed vs usage fail-open policies, queue naming/concurrency/tenant fairness, health metrics and module ownership for inbound/outbound/notifications/AI/exports/imaging/integrations.

Two distinct kinds of work are bundled here:

| Component | Class | Authorized at this baseline? |
|---|---|---|
| Audit current Redis usage and classify failure policy | Read-only evidence | **YES** — §3 below |
| Define/document policy proposals | Documentation | **YES** — but recorded as proposals, §6 |
| Make Redis mandatory in production (invert fail-open) | Runtime behaviour + production config change | **NO** — §4 |
| Install BullMQ, build queue platform | New dependency + implementation | **NO** — §4 |

---

## 2. Phase-numbering reconciliation (governance mismatch, recorded not guessed)

ClickUp and the repository use **different, offset phase numbering**. This is a real mismatch and is recorded here rather than silently normalized.

| Concern | ClickUp | Repository |
|---|---|---|
| Tenant RLS / database isolation | `F3-1`/`F3-2`/`F3-3` (merged, PRs #475/#476/#477) | `phases/F5_TENANT_RLS_AND_DATABASE.md` |
| Queue / outbox / messaging reliability | `EPIC F5` (`F5-1`, `F5-2`, `F5-3`) | `phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md` |

**Therefore ClickUp `EPIC F5` == repository phase `F6`.** Every repository gate written against "F6 entry" governs this ClickUp epic. Read the two together or the gates appear to be about a different phase than they are.

Two further tracker defects found while establishing this, neither introduced by this task:

1. **`NORAMEDI_MASTER_TRACKER.md` §4 phase-summary table is missing its `F4` and `F5` rows entirely.** The table jumps `F3` → `F6`. Both phase documents exist (`phases/F4_STORAGE_AND_BACKUP.md`, `phases/F5_TENANT_RLS_AND_DATABASE.md`) and both phases have real recorded activity (the F4 recovery/storage lanes, and the tenant work merged under ClickUp F3 IDs). The rows appear to have been lost in an edit.
2. **The three governance documents named in the F5 task brief do not exist** in the repository at any path: `NORAMEDI_PROJECT_BOOTSTRAP_INDEX.md`, `NORAMEDI_CURRENT_STATE.md`, `NORAMEDI_TASK_SELECTION_AND_REOPEN_PROTOCOL.md` (verified via `git ls-files`). Their functional equivalents are `docs/program/README.md` (source hierarchy, task-ID rules), `docs/program/CURRENT_PHASE.md` (append-only current-state narrative) and `NORAMEDI_MASTER_TRACKER.md` §2 (authoritative status rules).

Neither defect changes any gate below. Both are flagged for program-owner correction.

---

## 3. Current-state audit (read-only, evidence-backed)

### 3.1 Redis: present, optional, deliberately fail-open

| Fact | Evidence |
|---|---|
| `ioredis@^5.11.1` is a real dependency | `server/package.json:251` |
| **No** queue library exists anywhere — no BullMQ, Bull, bee-queue, agenda, amqp, Kafka, RabbitMQ client | dependency grep over `server/package.json` + root `package.json`, zero hits |
| Single client factory, memoized | `server/src/utils/redis.ts:19` `getRedis()` |
| Redis is **optional**: `REDIS_URL` unset ⇒ returns `null`, callers use in-memory `Map` | `utils/redis.ts:22-27` |
| Redis is **fail-open when configured but down**: `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, `connectTimeout: 5000` — commands reject immediately and callers fall back rather than block | `utils/redis.ts:29-33` and its header comment |
| Connection-error logging is throttled to 1/min and routed through `safeErrorFields()` so `REDIS_URL` credentials cannot reach logs | `utils/redis.ts:34-40`; regression test `tests/jobsUtilsLogPrivacyWave2.test.ts:373` |
| Graceful shutdown path exists | `utils/redis.ts:46` `closeRedis()` |
| Redis is **not** readiness-blocking; reported for visibility only | `utils/readiness.ts:19-27`, `index.ts:234` |
| Production has Redis `7.0.15` active with `REDIS_URL` **set** | `docs/program/ENVIRONMENT_MATRIX.md:40`, `PRODUCTION_TOPOLOGY.md:69` |

**The only current consumer of Redis is the rate-limit counter store** (`utils/counterStore.ts` → `utils/helpers.ts` `createRateLimiter`, `utils/inboundRateLimiter.ts`). There is no cache, no session store, no distributed lock, and no queue on Redis.

**Classification per the F5-1 brief's own taxonomy:**

| Category | Present today? | Current policy |
|---|---|---|
| SECURITY-CRITICAL | Partially — rate limiting is a security control | **fail-open** (deliberate, documented) |
| BUSINESS-RELIABILITY-CRITICAL | No | — |
| OPTIONAL / PERFORMANCE | Yes — multi-replica counter sharing | fail-open |
| QUEUE TRANSPORT | **No** | — |

**Finding F5-1-A (security, needs a decision — not fixed here).** Rate limiting is the one security-relevant Redis use, and it fails open. With Redis down and *N* API replicas, a shared limit of *L* degrades to an effective *N × L*, silently. The current design chose this consciously and wrote down why (`readiness.ts:19-27`: avoid removing a healthy API from the load balancer over a non-critical dependency), so this is **a recorded trade-off, not an oversight**. It nevertheless deserves a per-limiter re-decision: brute-force/login limiters have a different risk profile than general throughput limiters. That re-decision is exactly what F5-1's "security fail-closed vs usage fail-open" clause is asking for — and it is a **behaviour change to a live security control**, which is why it needs authorization rather than initiative.

**Finding F5-1-B.** "Make Redis mandatory in production" is therefore **not a provisioning task** — Redis is already provisioned and connected in production. It is an **inversion of a deliberate, documented fail-open design** across `redis.ts`, `counterStore.ts` and `readiness.ts`. It would make Redis a hard dependency of `/readyz`, meaning a Redis outage takes the API out of load-balancer rotation. That is a production-availability decision, not a refactor.

### 3.2 Job infrastructure: mature, lock-based, and working

14 jobs under `server/src/jobs/`, a dedicated `server/src/worker.ts` entrypoint, and **every one of the 14 uses `JobLock`**:

```
clinicBulkExportCleanupJob   clinicBulkExportWorker      dataRetentionCleanupJob
externalCalendarInboundRetry externalCalendarOutboundSync fileBackupJob
imagingBridgeOfflineJob      inboundEventRetryJob         metaTemplateSyncJob
patientPrivacyExportCleanup  publicBookingNoticeEvidence  recoveryStatusJob
reminders                    restoreRehearsalJob          (+ startBackgroundJobs)
```

`RUN_BACKGROUND_JOBS=false` on the API is confirmed read from production (tracker §13, G1-TECH-PREFLIGHT-001), so the worker process is the **sole** job owner — the single-owner property a queue migration would otherwise have to establish from scratch already holds.

**This is the concrete basis for the brief's own §21/§22 warning against migration churn.** These jobs already have distributed locking, bounded concurrency and crash recovery. `clinicBulkExportWorker.ts`'s claim pattern is the one `queue-outbox-poc-design.md` §7.10 explicitly recommends *extending*, not replacing.

### 3.3 `MessagingInboundEvent`: the durable inbound ledger already exists

`server/prisma/schema.prisma`, model `MessagingInboundEvent`:

- `@@unique([channel, provider, connectionId, providerMessageId])` — **database-enforced provider-level idempotency**, the exact guarantee an at-least-once queue would need and could not itself provide.
- `attempts`, `status`, `errorMessage`, `processedAt` — retry/terminal-failure state already modelled.
- Four indexes including `[organizationId, status, createdAt]` and `[clinicId, status, createdAt]` — tenant-scoped querying already supported.
- Wired into **all three** inbound providers via `createInboundEventOrDetectDuplicate` (`services/messagingInboundIdempotency.ts:37`): Meta WhatsApp (`routes/metaWhatsAppWebhook.ts:123`), Instagram (`routes/instagramWebhook.ts:504`), Evolution WhatsApp (`routes/whatsapp.ts:3856,3950`).
- Retry driven by `jobs/inboundEventRetryJob.ts`.

**Finding F5-1-C.** Durable inbound acceptance, provider deduplication and bounded retry are **already implemented and in production**. A meaningful part of ClickUp `F5-3` ("Messaging fast-ack, retry/backoff, DLQ and replay") is therefore already satisfied by existing code. F5-3 should be re-scoped against this ledger before it is planned as new construction — the genuine remaining gaps are DLQ *inspection/replay tooling* and *metrics*, not durable acceptance.

---

## 4. Authorization analysis — four independent blockers

Each of the following independently prohibits F5-1's implementation half. None is discretionary.

### Blocker 1 — The queue PoC design document explicitly refuses to authorize this

This is the decisive one, and it is the exact inverse of the F3-3 precedent.

F3-3 (the merged RLS/PgBouncer PoC, commit `2e02197`) justified itself with, verbatim from its commit message: *"Entry authority, checked rather than assumed: `tenant-rls-pgbouncer-poc-design.md` section 12 classifies 'Rollout Stage 7 (disposable RLS PoC execution)' and 'Stage 9 (PgBouncer staging PoC)' as allowed now, isolated disposable PoC only, conditional on a future task explicitly scheduling them. This is that task."*

The corresponding queue document says the opposite at every level:

- §12: *"**This document does not authorize running any of these experiments.**"*
- §14: *"**This document explicitly does not authorize any stage above.** Stage 4 (disposable PoC) is the earliest point at which any experiment would even run in a throwaway environment, and even that requires a separate, future task with its own review."*
- §16 freeze-impact table, row "Any future queue dependency (BullMQ/Redis)": *"Frozen … would be a new stateful infrastructure dependency requiring its own separate review | **Not installed, not authorized**."*
- Closing non-authorization statement: names *"queue dependency installation, Redis deployment, BullMQ or Kafka adoption, worker refactoring, event publication from production flows, or production configuration changes"* as blocked.

**The F3-3 precedent does not transfer.** The RLS design pre-authorized its own execution; the queue design pointedly withholds that authorization and requires a separate reviewed task.

### Blocker 2 — ADR-007 reserves the platform decision; BullMQ is not selected

`ARCHITECTURE_DECISIONS.md`, ADR-007 (`NEEDS_POC`), F0-010 review: *"**no external queue product is selected** — BullMQ remains a non-binding comparison candidate to be measured in Experiment 21, not adopted on the basis of familiarity."* Its recommended primary candidate is a **PostgreSQL-outbox-plus-in-process-dispatcher** modelled on `clinicBulkExportWorker.ts`.

Building "the BullMQ platform" would pre-empt a decision the program has explicitly reserved for evidence. Worse, the rollout order inverts: `queue-outbox-poc-design.md` §14 Stage **11** is *"Queue adoption only after measured trigger"* — after Stages 1-10, which include a production canary of the Postgres outbox. **ClickUp F5-1 asks for Stage 11 content first**, and ADR-006/ADR-007 are both still `NEEDS_POC` where the ADRs' own acceptance is an F6 entry condition. Per the F5 brief §40 and tracker §2.2/§2.3, an agent cannot accept an ADR.

### Blocker 3 — KVKK architecture freeze

`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 14 blocks *"queue/outbox implementation that rewires current consent/audit flows"*; §2 row 19 gives queue/outbox architecture the exit condition **"F6 entry"**. §5 states the §3 default freeze rules are gated on **condition 5** — an external declaration that the KVKK baseline is stable — which is recorded **"Not satisfied."**

Freeze exceptions in this program are not inferred; they are explicit, program-owner-authorized and narrow. Tracker §8 records exactly two (`F4-1A`, `F4-1A2`), both for storage-key work, both stating they cannot be generalized. **No queue/outbox exception exists.**

### Blocker 4 — Phase entry conditions are unmet, and the tracker says so in as many words

`phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md`: status `TODO`; entry conditions *"F5 çıkışı"* (F5 exit) and *"F0-010 tasarımı ve ADR-006/007 **kabulü**"* (acceptance). Neither holds.

`NORAMEDI_MASTER_TRACKER.md` §13 states directly: **"F5 is NOT authorized"**, alongside `F3_EXIT_GATE = NOT SATISFIED`, `F3_COMPLETE = NO`, `F4_TRANSITION_AUTHORIZED = NO`, and F4 phase status `TODO`. The tracker's live lanes are F1/F2/F3/F4 plus the G1 pilot lane — the program has not reached the queue phase by its own record.

---

## 5. What was deliberately **not** done

No dependency installed. No `server/src/queue/` created. No `OutboxEvent` model, migration or `prisma validate` run. No change to `redis.ts`, `counterStore.ts`, `readiness.ts` or any limiter. No job migrated off `JobLock`. No `MessagingInboundEvent` change. No disposable PoC executed — **including** the Postgres-outbox PoC, because `queue-outbox-poc-design.md` §14 requires a separately reviewed task for Stage 4 as well. No ADR status changed. No production system contacted. No ClickUp task closed.

---

## 6. Proposed scope for an authorized F5-1 (proposals only — not decisions)

Offered as input to the program owner, in dependency order. None is enacted here.

1. **Split F5-1.** Its audit/policy half is unblocked and is delivered by this document. Its implementation half belongs after ADR-006/007 acceptance.
2. **Re-decide the rate-limiter failure policy per limiter** (Finding F5-1-A) — the smallest genuinely valuable, genuinely security-relevant piece. It is *independent of the queue question* and could proceed under its own narrow review, since it touches no queue, no schema and no consent/audit flow.
3. **Correct the ClickUp↔repository phase-numbering mismatch** (§2) so gates are legible.
4. **Re-scope F5-3 against `MessagingInboundEvent`** (Finding F5-1-C) — durable acceptance, dedupe and retry already exist; the real gaps are DLQ inspection/replay tooling and queue metrics.
5. **If a queue PoC is wanted**, schedule it the way F3-3 was scheduled: an explicit task, citing explicit entry authority, executing `f0-010-poc-test-matrix.md`'s 25 experiments in throwaway Docker — with the Postgres-outbox candidate first and BullMQ measured against it in Experiment 21, per ADR-007's own recommendation rather than in place of it.

---

## 7. Exact conditions that unblock implementation

1. External/program-owner acceptance of **ADR-006** and **ADR-007** (agent-level acceptance is forbidden by tracker §2.2/§2.3 and F5 brief §40).
2. A program-owner decision on **which platform** ADR-007 selects — the Postgres-outbox candidate or an external queue. BullMQ is not currently selected.
3. **KVKK freeze condition 5** — external declaration that the KVKK baseline is stable — or a narrow, explicitly recorded program-owner freeze exception for queue/outbox work, in the form tracker §8 already uses for `F4-1A`/`F4-1A2`.
4. **F6 phase entry**, which itself requires F5 (repo numbering) exit; the tracker currently records "F5 is NOT authorized".
5. For a PoC specifically: a separately scheduled and reviewed task, per `queue-outbox-poc-design.md` §14.

---

## 8. Lifecycle

| Gate | State |
|---|---|
| `AGENT_COMPLETED` | **YES**, for the authorized audit/documentation scope only |
| `TESTS_PASSED` | **N/A** — no code changed; no test suite is applicable to a documentation-only change |
| `PR_OPENED` | YES (draft) |
| `CI_PASSED` | pending |
| `MERGED` | **NO** |
| `MIGRATION_DEPLOYED` / `APPLICATION_DEPLOYED` / `FEATURE_ACTIVATED` / `PRODUCTION_VERIFIED` | **N/A** — documentation only, nothing to deploy |

`F5_1_ACCEPT = NO` — the F5 brief's §41 gates B, D-H, J-M, P (implementation, lifecycle, shutdown, retry, DLQ, tenant reconstruction, fairness, Redis-failure, idempotency, metrics) cannot be satisfied without authorization that does not exist. Gates A (Redis audit), N (`JobLock` policy), O (`MessagingInboundEvent` preserved), Q (no production mutation), R (rollback), U (draft PR) and V (evidence recorded) are satisfied by this document.

`F5_1_MERGE_SAFE = YES` for this documentation-only branch, subject to program-owner review.
`F5_1_DEPLOY_SAFE = N/A` — nothing deployable.

**Rollback:** revert the PR. This branch adds documentation and changes no executable path, so revert is complete and side-effect-free.

---

## 9. Non-authorization statement

This document authorizes nothing. It does not accept ADR-006 or ADR-007, does not select a queue platform, does not lift or reinterpret any freeze boundary, does not declare F6 entry, and does not change the status of any ClickUp task beyond recording evidence. It is read-only repository evidence plus proposals for a program-owner decision.

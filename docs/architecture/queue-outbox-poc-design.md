# F0-010 — Queue and Transactional Outbox Proof-of-Concept Design

Task: F0-010 · Phase: F0 — Baseline, Program Control, and Architecture Validation
Status: `AGENT_COMPLETED` (documentation only; external review required before merge)
Baseline commit: `origin/main` @ `23db9c3f1c93a564e094ae5f13be71ca3daa81ce` (PR #177 merge commit, "docs(architecture): design tenant RLS and PgBouncer PoC (F0-009)") — matches the program-status instruction's stated known merge commit exactly; confirmed via `git fetch origin --prune && git rev-parse origin/main` at task start. **No baseline drift.**
Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-010-queue-outbox-poc`, branch `docs/f0-010-queue-outbox-poc-design`
Primary worktree (`D:\Mustafa\Siteler\DisKlinikCRM`): not read, not modified — only `git status --short`/`git branch --show-current`/`git rev-parse HEAD`/`git worktree list` were run against it, before this worktree was created.
Parallel task: F0-009-S1 (SecurityIncident raw-SQL tenant-ownership hardening) — separate worktree/branch, not read, not touched by this task.

**Self-reference lag found at this task's own baseline:** this worktree's checked-out `NORAMEDI_MASTER_TRACKER.md` §5 and `CURRENT_PHASE.md`, at commit `23db9c3f1c93a564e094ae5f13be71ca3daa81ce` (F0-009's own merge commit for PR #177), still narrate F0-009 as `PR_OPEN` — the identical pattern every task from F0-002 through F0-009 found in its predecessor (a task's own tracker update is committed as part of its own merge commit, so the committed snapshot necessarily predates knowledge of its own merge). Independently verified in this task: `gh pr view 177 --json state,mergedAt,mergeCommit` → `{"state":"MERGED","mergedAt":"2026-07-19T15:53:24Z","mergeCommit":{"oid":"23db9c3f1c93a564e094ae5f13be71ca3daa81ce"}}` — the merge commit SHA is identical to this worktree's baseline HEAD. Corrected in the tracker/phase-doc updates accompanying this task (see §17 below).

> **Non-authorization statement (required, verbatim):**
> F0-010 defines transactional-outbox and queue PoC evidence requirements only. It does not authorize an OutboxEvent schema or migration, queue dependency installation, Redis deployment, BullMQ or Kafka adoption, worker refactoring, event publication from production flows, or production configuration changes. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR receives evidence-based acceptance.

---

## 1. Purpose and scope

This document is a **design specification for a future, isolated Proof of Concept**, not an implementation. It answers whether NoraMedi needs a transactional outbox now or later, which business transitions would justify outbox semantics, whether a queue is required at all for a first implementation, whether BullMQ is technically suitable, what would justify Kafka, and what exact evidence ADR-006 (transactional outbox) and ADR-007 (queue platform selection) need before either can move past its current status.

It is bound by, and does not attempt to loosen, `docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`. Per that document's §2 row 19, "Queue/outbox architecture" is currently `N/A (does not exist yet)`, with allowed parallel work explicitly scoped to "F0-010 PoC **design** only" and prohibited work scoped to "any queue/outbox implementation that rewires current consent/audit flows." §3 item 14 restates the same prohibition as a program-wide default freeze rule, independent of KVKK-HIGH-007's merge status (§5 condition 2, satisfied, does **not** unfreeze row 19 — row 19 is gated on F6 entry, not on the KVKK-HIGH-007-specific conditions). §6 explicitly lists "F0-010 — Queue/outbox PoC design (design only)" among tasks allowed to proceed now; §7 explicitly lists "F0-009/F0-010/F0-011 implementation (as opposed to design)" as blocked regardless of KVKK status. This document does not change any of that.

Scope is documentation and design only: no file under `server/src/`, `server/prisma/schema.prisma`, `server/prisma/migrations/`, `src/`, deployment scripts, CI workflows, or environment files was touched to produce it.

## 2. Program status verified at task start

- F0-002 through F0-009: all `MERGED` (F0-009 corrected in this task, see header above and §17).
- ADR-006 (Transactional outbox): `DEFERRED` (F0-008, 2026-07-19) — direction not yet accepted; F0-010 named as the evidence-gathering step. Narrow principle "events must be versioned and consumers idempotent if/when an outbox is built" already accepted as a binding invariant, independent of this ADR's own status.
- ADR-007 (Queue platform): `DEFERRED` (F0-008, 2026-07-19) — "BullMQ preferred near-term candidate" recorded as a non-binding preference only.
- Kafka: explicitly not the default (program direction, `enterprise-foundation-decision-set.md` §E).
- Queue/outbox implementation: blocked by the F0-007 KVKK architecture freeze boundary (§3 item 14) independent of ADR status.
- F0-010 dependencies: F0-004, F0-008 — both `MERGED`. Dependency-ready confirmed.
- F6 phase doc (`docs/program/phases/F6_QUEUE_OUTBOX_AND_RELIABILITY.md`) already exists but is kickoff-era (last touched 2026-07-17, F0-001) — thin, names F0-010 as its design input, and cites risks R-009/R-010/R-011/R-012/R-022. This document's findings are intended to inform a future refresh of that phase doc; refreshing it is not itself one of this task's required deliverables and is not attempted here beyond the cross-references below.

## 3. Current repository evidence — async architecture summary

Full evidence and file:line citations: [`evidence/f0-010-async-flow-inventory.json`](evidence/f0-010-async-flow-inventory.json) (18 business flows + 3 infrastructure primitives, bounded coverage — see its own `generated_from.coverage_statement`). Method: targeted investigation of `server/src/jobs/`, the webhook/messaging/consent/export/notification route and service files named in the task's "at minimum inspect" list, and `server/prisma/schema.prisma`. No `.codegraph/` index exists in this worktree; investigation used Glob/Grep/Read directly.

**Headline facts:**

- **No queue product exists today.** Every background execution mechanism is `node-cron` polling plus a Postgres-table-based lease lock (`JobLock`, `server/src/utils/jobLock.ts`) — not Redis, not Postgres advisory locks. A Redis `SET NX PX` alternative was explicitly considered and rejected in a code comment to avoid extra infrastructure (`jobLock.ts:15-17`).
- **9 job files** are registered from `server/src/jobs/startBackgroundJobs.ts`, run either in the API process (`server/src/index.ts:258-268`, gated by `RUN_BACKGROUND_JOBS`) or in a dedicated `worker.ts` process — both can run simultaneously; `JobLock` (not the registration code) is the only thing preventing duplicate execution (see R-034, already `OPEN`).
- **Exactly one true attempt-counted retry mechanism exists**: `inboundEventRetryJob.ts` (`MAX_ATTEMPTS=3`, fixed 5-minute backoff, 1-hour crash-recovery sweep), and it only covers `channel='whatsapp', provider='meta_cloud_api'` — Evolution-provider WhatsApp and Instagram inbound webhooks are explicitly excluded and silently drop on failure (flows F010-001, F010-003).
- **No outbound message ever reaches `status='delivered'`/`'read'` in production code** — repository-wide grep confirms only a test fixture uses those literals. "Sent" means "the provider API call returned success," nothing more; there is no delivery-receipt webhook consumer.
- **One flow already does this well**: `clinicBulkExportWorker.ts` (F010-009) — a genuine queued-worker pattern with an atomic guarded-claim (`updateMany` on `status:'queued'→'generating'`), bounded concurrency across multiple replicas, lease-expiry crash recovery, typed terminal failure codes, and graceful-shutdown cancellation. This is the strongest existing precedent in the codebase for what a formalized dispatcher should look like, and this design treats it as the primary internal reference model rather than starting from a greenfield design.
- **`OperationalEvent`** (`schema.prisma:1551-1579`) has a `dedupeKey` unique column explicitly documented for atomic upsert-based dedup — structurally the closest existing thing to an outbox row — but has no processing-status field, and is written by only one flow (F010-009) and read by only one other (F010-008's audit summary). `recordOperationalEvent()` has no callers in the webhook/reminder/appointment-request paths that would most benefit from it.
- **`AuditLog`** already has, in miniature, the two-tier pattern an outbox formalizes at scale: most writes are fire-and-forget (`writeAuditLog()`, swallows errors, frequently called without `await`), while a small allowlist of security-critical writes in `clinicBulkExportPackage.ts` use `writeAuditLogInTx()` inside the same `$transaction` as the state change. This is direct evidence that some of the gaps found below have a narrower fix available (wrap the state+audit write in one transaction) that does not require a queue or outbox at all.

## 4. Async-flow classification summary

Of the 18 business flows classified (see JSON for full detail):

| Classification | Count | Flows |
|---|---|---|
| `candidate_outbox_need: YES` | 4 | F010-004 (appointment reminder send), F010-005 (payment reminder send), F010-007 (appointment-request confirmation), F010-018 (notification generation) |
| `candidate_outbox_need: PARTIAL` | 1 | F010-008 (consent audit write — narrower `$transaction` fix available) |
| `candidate_outbox_need: NO` | 12 | Includes F010-009 (already solved), F010-006 (already atomic via `Setting` upsert), F010-011/012/014/016/017 (cron sweeps with no gap), F010-001/002/003 (inbound acceptance, not outbox-shaped), F010-010, F010-013 |
| `candidate_outbox_need: AMBIGUOUS` | 1 | F010-015 (imaging bridge study upload — insufficient evidence in this bounded pass) |
| `candidate_queue_need: YES` | 5 | F010-001, F010-003, F010-004, F010-005, F010-007 |
| `candidate_queue_need: PARTIAL` | 4 | F010-002 (retry job exists, could be generalized), F010-010, F010-013, F010-018 |
| `candidate_queue_need: NO` | 8 | F010-006, F010-008, F010-009, F010-011, F010-012, F010-014, F010-016, F010-017 |
| `candidate_queue_need: AMBIGUOUS` | 1 | F010-015 |

**This inventory explicitly does not label every background process as needing a queue** — 8 of 18 flows (44%) show no queue gap, and one (F010-006) is included specifically as a counter-example: it already achieves atomic duplicate-send prevention via a `Setting.clinicId_key` unique-constraint upsert, with no race window, proving the pattern is achievable today without new infrastructure.

## 5. Which business transitions justify outbox semantics (answering objective #1–2)

**NoraMedi does not need a transactional outbox today.** The evidence supports a narrower conclusion: a small number of flows (4 `YES`, 1 `PARTIAL` — 28% of classified flows) show a real "commit a DB state change, then reliably deliver a side effect" gap, but each currently has an available fix that does **not** require a general-purpose outbox:

- F010-008 (consent audit write): wrap the preference write and the audit write in one `prisma.$transaction`, exactly as `clinicBulkExportPackage.ts` already does for its own security-critical writes (`writeAuditLogInTx`). This is a same-process, same-database fix — no outbox needed. **This flow is also inside the KVKK freeze boundary and is not itself authorized by this document.**
- F010-004/F010-005 (reminder sends): the crash gap (external call succeeds, `SentMessage` status update never happens) could be closed by a stuck-row reconciliation sweep modeled on `inboundEventRetryJob.ts`'s existing `STUCK_PROCESSING_MS` pattern — a scoped job, not necessarily a full outbox+dispatcher rearchitecture.
- F010-007 (appointment-request notification): the appointment-create/request-update pair should be wrapped in one `$transaction` regardless of any outbox decision — a narrower, unrelated fix.

**What would change this conclusion and justify building an outbox:** the count of independently-reimplemented "prepared → external call → finalize" patterns is already at four in the current codebase (`SentMessage`, `MessagingInboundEvent`, `ClinicBulkExportArchive`, `PatientPrivacyExportArchive`) plus at least one growing need (F010-018, in-app notifications, is the clearest textbook outbox use case found — reacting to a committed business-state transition to materialize a derived read-model row, currently done via a stale polling-upsert-on-read anti-pattern instead of an event). **The concrete, evidence-based trigger recommended by this design:** if a fifth distinct flow needs the same "commit, then reliably do something else" shape (F010-018 would be the fifth), consolidating onto one outbox+dispatcher becomes more efficient than maintaining a fifth bespoke status-flag/reconciliation-sweep pair. That is a measurable count-based trigger, not a subjective one, and it is not yet crossed by evidence gathered in this task (F010-018 is diagnosed, not yet built).

**Which flows require at-least-once delivery (objective #3):** F010-001, F010-002, F010-003 (inbound webhook acceptance — provider will not necessarily redeliver, so the internal system must not lose an accepted event) and, if built, any outbox-backed version of F010-004/005/007/018 (a committed state change must not silently fail to produce its side effect).

**Which consumers must be idempotent (objective #4):** any future consumer of F010-001/002/003's events (already true today, via the `MessagingInboundEvent` unique constraint); any future dispatcher for F010-004/005/007/018-shaped work, because at-least-once delivery implies duplicate delivery is possible and the consumer — not the transport — must be the source of exactly-once *effect*. This is the principle already accepted as binding by ADR-006's F0-008 review, independent of the ADR's own DEFERRED status, and this design does not relax it.

## 6. Whether a queue is required for the first implementation (objective #5)

**No.** The evidence in §3–5 supports a PostgreSQL-outbox-table-plus-in-process-dispatcher as the first candidate, modeled directly on the already-working `clinicBulkExportWorker.ts` claim pattern, with **no new infrastructure dependency**. A queue product (BullMQ or otherwise) is not required to solve any of the four `YES`-classified flows — each is a same-database, same-deployment-unit problem today. See §9 for the full alternative comparison and §10 for the measurable Kafka trigger.

## 7. Outbox design (isolated PoC candidate — not implemented)

### 7.1 Table ownership and module boundary

Per `MODULE_MAP.md`, the closest existing domain is "Shared Events / Queue Contracts / Idempotency" (`EVQ`), already classified "partially bounded" and already a declared platform dependency (`P`) of four domains (`PRV`, `WHA`, `REC`, `BRG` — `DEPENDENCY_MAP.md` §10.3). An outbox table should be owned by this shared/common-infrastructure domain, not by any single business domain (Messaging, Privacy, Appointments) — the same reasoning ADR-001 already applied to keep infrastructure primitives (like `JobLock`) outside domain boundaries. Domain services publish events into the shared table via a narrow, versioned contract (§8); they do not own the table's schema or dispatcher.

### 7.2 Common infrastructure vs. domain-owned event contracts

The **outbox table and dispatcher mechanics** (claiming, retry, lease, dead-letter) are common infrastructure, owned by `EVQ`. The **event payload contracts** (shape, versioning, minimization rules per event type) are domain-owned, following the same split ADR-015 already establishes for public contracts generally: infrastructure provides the pipe, domains own what flows through it and its schema evolution.

### 7.3 Required fields (evaluated, not schema-authorized)

Mapped against the task's required field list, using existing repository conventions where a precedent exists:

| Field | Type | Precedent in repo | Notes |
|---|---|---|---|
| `id` | UUID/cuid | All models use `cuid()` (schema-wide convention) | — |
| `aggregateId` / domain identifier | String | `MessagingInboundEvent.connectionId`, `ClinicBulkExportArchive.clinicId` | The ID of the entity the event is about (e.g. `appointmentId`) |
| `organizationId` | String, indexed | Present on 68+/91 models per F0-009's tenant inventory | **Mandatory**, not nullable, for any event this design would authorize (see §7.9 on the nullable-tenant-key precedent risk already flagged as R-055) |
| `clinicId` | String?, indexed | `ClinicBulkExportArchive.clinicId` | Nullable only for genuinely org-scoped events |
| `eventType` | String | New — `MessagingInboundEvent` has no analogue; nearest is `OperationalEvent.source` enum | Namespaced, e.g. `appointment.request.confirmed.v1` |
| `schemaVersion` | Int | New | See §8.4 |
| `occurredAt` | DateTime | `MessagingInboundEvent.createdAt`, `AuditLog.createdAt` | Set at transaction-commit time, not dispatch time |
| `availableAt` | DateTime | New concept; nearest precedent is `JobLock.lockedUntil`'s expiry semantics | Enables delayed/scheduled dispatch |
| `status` | Enum | `ClinicBulkExportArchive.status` (`queued/generating/ready/failed/expired`), `MessagingInboundEvent.status` (`received/processing/processed/failed`) | Recommend: `pending/claimed/dispatched/failed/dead` |
| `attempts` | Int | `MessagingInboundEvent.attempts` | — |
| `lockedAt` / `lockedBy` | DateTime? / String? | `JobLock.lockedUntil`/`lockedBy` — direct precedent | Per-row lease, not a single global lock |
| `deliveredAt` | DateTime? | `SentMessage` has no true "delivered" (§3) — this would be the first honest delivered-timestamp field in the schema | — |
| `idempotencyKey` | String, unique | `MessagingInboundEvent`'s composite unique constraint, `OperationalEvent.dedupeKey` | Composite of `(eventType, aggregateId, ...)` per event type |
| `correlationId` | String? | None found — new concept | Ties an event to the originating request/job run |
| `causationId` | String? | None found — new concept | Ties an event to the event/command that produced it |
| `payload` | Json | `MessagingInboundEvent.rawPayload`, `OperationalEvent.metadata`, `AuditLog.metadata` | See §7.4–7.5 for minimization |
| `payloadClassification` | Enum | None found — new concept | Recommend: `identifiers_only` / `minimized` / `full` (full should require an explicit, reviewed exception) |
| `failureReason` | String? | `ClinicBulkExportArchive.failureCode` — direct precedent, typed reason codes | — |
| `poisonState` | Boolean or derived from `attempts >= max` | `MessagingInboundEvent`'s implicit `attempts >= 3` exclusion (F010-002/013) — currently implicit, should become explicit | An explicit `status='dead'` is recommended over `inboundEventRetryJob.ts`'s current implicit exclusion pattern, so operators can query/alert on it directly |

### 7.4 Should PHI/PII appear in payloads?

**No, as a default rule.** Evidence for this: `MessagingInboundEvent.rawPayload` already stores raw webhook PII/PHI (phone numbers, message text, possible symptom/complaint text — F010-001/002/003) with **no retention-aware minimization** — it is deleted wholesale by `dataRetentionCleanupJob.ts` (F010-011) rather than minimized at write time. An outbox event schema should not repeat this pattern for a table whose whole purpose is inter-process delivery, not a compliance record. `AuditLog`/`PatientCommunicationConsentEvent` are the correct place for compliance-grade PII capture (both already exist and are governed by the KVKK freeze boundary); outbox events should carry references into those tables, not duplicate their content.

### 7.5 Payload minimization

Recommended default: **identifiers only** — `aggregateId`, `organizationId`, `clinicId`, and any non-PII classification/status fields the consumer needs to decide what to do, plus a pointer (foreign key) the consumer uses to re-fetch the authoritative, currently-scoped record. This mirrors the existing `MessagingInboundEvent` → `SentMessage`/reply-context pattern already in use (F010-001), just formalized. A `payloadClassification` field (§7.3) makes any deviation from "identifiers only" an explicit, auditable exception rather than a silent default.

### 7.6 Deleted/anonymized patient references

This is a genuinely open design question this PoC must answer, not one this document decides. Repository evidence relevant to it: `dataRetentionCleanupJob.ts` (F010-011) **anonymizes** `ContactRequest` rows (nulls out phone/name/note) rather than hard-deleting them, and explicitly never touches `Patient` — so a `Patient`-referencing event that outlives the patient's anonymization would resolve to a null/anonymized name on re-fetch, not a dangling foreign key. The PoC (Experiment 15, test matrix) must verify this "resolve at consumption time, not at publish time" behavior holds for an outbox consumer the same way it holds for `dataRetentionCleanupJob.ts`'s existing consumers, and must decide whether an event whose aggregate has since been anonymized should still be delivered (informational) or should be suppressed.

### 7.7 Tenant-context restoration by consumers

Recommended: the event's own `organizationId`/`clinicId` columns are the source of truth a consumer uses to reconstruct tenant context before touching any other table — the consumer must not infer tenant scope from the payload body or from an unscoped re-fetch. This mirrors the `clinicScope`/`tenantGuard` application-level pattern ADR-002 already accepts as the mandatory baseline. A consumer that cannot establish `organizationId` from the event row itself (e.g. a malformed or legacy-shaped event) must reject the event into the poison state (§7.3), not guess.

### 7.8 One global dispatcher, or per-tenant dispatch?

**Neither a single naive global dispatcher nor one dispatcher-per-tenant is recommended.** Evidence: `clinicBulkExportWorker.ts` (F010-009) already demonstrates the right middle ground — one shared worker pool with bounded concurrency (`CLINIC_BULK_EXPORT_WORKER_CONCURRENCY`) that claims rows across all tenants but is explicitly designed (per its own code comment, `clinicBulkExportWorker.ts:5-13`) so no single tenant's backlog can starve another, because the claim query is not tenant-partitioned but the concurrency limit prevents any one tenant from monopolizing every worker slot. This directly addresses R-022 (noisy-neighbor tenant, already `OPEN`, `F6`-scoped). A PoC must measure whether this pattern holds under an adversarial single-tenant flood (test matrix Experiment 10/13).

### 7.9 Required indexes

Minimum: `(status, availableAt)` for the dispatcher's claim query (mirrors `ClinicBulkExportArchive`'s `status`-filtered claim); `(organizationId, clinicId)` for tenant-scoped operational queries; `(idempotencyKey)` unique; `(aggregateId, eventType)` for replay/audit lookups. Exact index design is a PoC measurement question (test matrix Experiment 19-20), not decided here.

### 7.10 Claiming mechanism comparison

| Mechanism | How it works | Existing repo precedent | Trade-off |
|---|---|---|---|
| `SKIP LOCKED` (Postgres `SELECT ... FOR UPDATE SKIP LOCKED`) | Row-level lock held for the duration of the claiming transaction; concurrent claimers skip already-locked rows | None currently in use — the codebase has never used this Postgres feature | Requires holding a DB transaction open across the claim; strongest safety guarantee, but ties up a connection for the claim window |
| Postgres advisory locks | Session or transaction-scoped named lock, not tied to a specific row | None currently in use (explicitly considered and rejected for `JobLock`, `jobLock.ts:15-17`, in favor of a lease-row) | Requires careful lock-key design to avoid contention across unrelated rows; the codebase has already decided against this pattern once |
| Lease-based claiming (guarded `updateMany`, e.g. `status:'queued'→'claimed', lockedAt:now, lockedBy:workerId WHERE status='queued'`) | Optimistic, no long-held transaction/lock; a stale claim is recovered by lease expiry | **Direct precedent**: `JobLock.acquireJobLock` (mutual exclusion) and `ClinicBulkExportArchive`'s guarded claim (work distribution) both already use this shape | Requires a reconciliation sweep for lease-expiry recovery (already implemented twice in this codebase); simplest to reason about given existing team familiarity |

**Recommendation for the PoC's primary candidate:** lease-based claiming, directly extending the `clinicBulkExportWorker.ts` pattern — not because `SKIP LOCKED` or advisory locks are unsuitable, but because the codebase has zero precedent for either and two working precedents for lease-based claims. The PoC should still measure `SKIP LOCKED` (Experiment 4) as a comparison point, since it is the more commonly recommended pattern in general Postgres-outbox literature and the comparison itself is valuable evidence.

### 7.11 Dispatcher crash after side effect, before acknowledgment

This is the central correctness question for any outbox+external-call design and is explicitly the shape of the existing gap in F010-004/005 (external send succeeds, `SentMessage.status` update never happens). The PoC must test this directly (Experiment 6) using the same "confirm before claiming a one-time resource" pattern `clinicBulkExportPackage.ts` already uses for its download-token claim (`clinicBulkExport.ts:434-436`) as a design starting point: the side effect (e.g. calling an external API) must itself be made idempotent or checkable-after-the-fact wherever the external provider supports it (e.g. a client-supplied idempotency key on the provider call, if the provider API supports one — this is a provider-by-provider question the PoC must enumerate, not assume).

### 7.12 Duplicate delivery handling

Consumer-side idempotency, not transport-side exactly-once delivery, is the accepted principle (already binding per ADR-006's F0-008 review). Precedent: `MessagingInboundEvent`'s unique constraint plus `createInboundEventOrDetectDuplicate`'s insert-then-catch-`P2002` pattern (F010-001/002/003) is the model to extend to any outbox consumer.

### 7.13 Retention strategy

Must not repeat `dataRetentionCleanupJob.ts`'s current unscoped-global-delete pattern without adjustment — an outbox table's retention window must stay compatible with the dispatcher's own retry/lease windows (the same coupling already implicitly present between `dataRetentionCleanupJob.ts` and `MessagingInboundEvent`/`inboundEventRetryJob.ts`, flagged in the JSON inventory's F010-011 row). Exact retention period is a PoC/ADR-013-adjacent question, not decided here.

### 7.14 Replay authorization and audit

No existing admin-triggered replay tooling was found anywhere in the codebase (F010-001/002/003 all note "no tooling to trigger a replay" despite raw payloads being retained). Recommended principle for the PoC: any replay must (a) require platform-admin-level authorization (mirroring `platformAdmin.ts`'s existing pattern for other sensitive operations), (b) write an `AuditLog` row via `writeAuditLogInTx` (the transactional variant, not the fire-and-forget default) naming the operator, the replayed event ID(s), and the reason, and (c) be itself idempotent (replaying an already-delivered event must not double-execute the consumer's side effect — this is the same guarantee §7.12 already requires of normal delivery). "Who may use it" is an authorization-model question for the future implementation task, not decided here beyond "platform-admin, never a clinic-level role."

### 7.15 Rollback when consumers have already produced external side effects

Not generally possible for consumers whose side effect is an external, irreversible action (e.g. an already-sent WhatsApp message) — this is a fundamental property of at-least-once delivery to external systems, not something an outbox design can eliminate. The design implication: consumers of externally-irreversible side effects must treat "rollback" as "compensate," not "undo" (e.g. a follow-up corrective message, not a retraction), and this compensation logic is domain-owned, not infrastructure-owned. This should be documented per-event-type in the future domain event contract (§8), not solved generically here.

## 8. Domain event contract rules

| Rule | Specification |
|---|---|
| Domain owner | Each event type is owned by exactly one domain (per `MODULE_MAP.md`'s domain list); the owning domain is the only one authorized to change the event's schema |
| Public event name | `<domain>.<aggregate>.<transition>.v<N>`, e.g. `appointments.appointmentRequest.confirmed.v1` |
| Version | Integer, starts at 1, incremented on any breaking change |
| Compatibility policy | Additive-only within a version (new optional fields); any field removal/type change/semantic change requires a new version |
| Required metadata | `organizationId`, `clinicId?`, `eventType`, `schemaVersion`, `occurredAt`, `correlationId`, `causationId?`, `idempotencyKey` |
| Data minimization | Identifiers + status/classification fields only by default (§7.5); PHI/PII payloads require an explicit, named, reviewed exception |
| No direct ORM model serialization | Events must be hand-authored DTOs, never `JSON.stringify(prismaModelInstance)` — this prevents internal schema changes (column renames, new sensitive columns) from silently becoming a public contract break or a PII leak, the same principle ADR-015 already applies to public API contracts |
| No internal database-row leakage | Internal-only fields (soft-delete flags, internal foreign keys not meaningful to consumers, raw provider payloads) must never appear in an event payload |
| Additive version evolution | New optional fields may be added to a version without incrementing it; anything else requires a new version, published alongside the old one during the deprecation window |
| Deprecated-version support window | Not decided here — a future implementation task must set a concrete window (e.g. "N days after the last known consumer migrates"), informed by actual consumer count, which does not exist yet |
| Consumer idempotency | Mandatory (§7.12) — not optional per consumer |
| Consumer ownership | Each consumer is owned by exactly one domain/service; cross-domain consumption happens through the event contract, not through direct reads of the producing domain's tables (preserves the modular-monolith boundary ADR-001/ADR-015 already establish) |
| Retry classification | Each event type's producer must classify failure modes as retryable vs. non-retryable at publish time or the consumer must classify at consumption time — not decided here which, but one of the two is mandatory (undecided today: none of F010-001 through F010-018's current ad hoc failure handling makes this distinction explicitly except `ClinicBulkExportArchive`'s typed `failureCode`) |
| Poison-message handling | Explicit `status='dead'` after a bounded attempt count (§7.3), queryable and alertable — not the current implicit-exclusion pattern (F010-002/013) |
| Audit requirements | Every dispatch attempt, terminal failure, and replay must be attributable — not necessarily every successful delivery (that would duplicate `AuditLog`'s purpose); exact granularity is a PoC/future-task decision |

**Explicit constraint (per task instruction):** a queue or outbox must not become a new mechanism for uncontrolled cross-domain database access. Event payloads carry identifiers and status, not enough information for a consumer to reconstruct and directly manipulate another domain's internal tables — this is the same boundary DEPENDENCY_MAP.md's 9 existing `X`-severity violations (WhatsApp/Instagram → Patients/Appointments direct writes) show what happens when it is *not* enforced, and this design explicitly does not want to add a tenth path to the same failure mode.

## 9. Queue alternatives comparison

| | No queue: Postgres outbox + DB dispatcher | BullMQ/Redis | Postgres-native job queue (e.g. `pg-boss`, or a bespoke extension of the existing `JobLock`/claim pattern) | Managed queue abstraction (SQS-compatible, provider-agnostic) | Kafka / distributed log |
|---|---|---|---|---|---|
| Repository fit | **Best** — directly extends `clinicBulkExportWorker.ts`'s already-working, already-understood pattern; zero new infrastructure | Requires Redis, which does not exist in this deployment today (`PRODUCTION_TOPOLOGY.md`/F0-006: no Redis found in production topology) | Good — same DB, but a new library dependency and a second claiming convention alongside `JobLock`'s existing one | Requires an external managed service + network dependency + vendor/data-residency review (KVKK-relevant) | Requires a new distributed system class the team has zero operational experience with (confirmed: no queue library found anywhere in `MODULE_MAP.md`/`DEPENDENCY_MAP.md`) |
| Operational complexity | Low — one more table, one more cron-style worker loop, same deploy unit as everything else | Medium — new process/connection type to monitor, Redis persistence/eviction policy decisions | Low-Medium — new library surface, same DB | High — new vendor relationship, IAM/network config | Very High — brokers, partitions, consumer-group rebalancing, ZooKeeper/KRaft |
| HA impact | Same as current Postgres HA story (single primary, no read replica confirmed — `PRODUCTION_TOPOLOGY.md`) | Adds a second stateful system needing its own HA story (Redis persistence is not durable by default) | Same as current Postgres HA story | Delegated to vendor | New HA domain entirely |
| Ordering | Achievable per-aggregate via `(aggregateId, occurredAt)` ordering in claim queries — no native partition-ordering guarantee, but none of the `YES`-classified flows in §4 need cross-aggregate ordering (F010-008, which DOES need per-key ordering, is a `PARTIAL`/not-a-queue-need flow, see §5) | Native per-queue FIFO available (BullMQ supports ordered/rate-limited queues) | Similar to Postgres outbox | Varies by provider (SQS FIFO exists but with its own throughput caveats) | Native, partition-key-based — but no evidenced current need for it (§10) |
| Retries | Must be built (this design specifies the shape, §7) | Built-in, configurable backoff/attempts | Varies by library; `pg-boss` has built-in retry | Varies by provider | Requires application-level implementation on top of the log |
| Delayed jobs | `availableAt` column (§7.3) — same mechanism `node-cron` scheduling already approximates | Native | Varies | Varies | Not a native concept — requires a separate scheduler |
| Throughput | Bounded by Postgres write throughput on one more table — no evidence this table's write rate would approach current DB limits, given current message/event volumes are themselves unmeasured (no observability exists, ADR-012 `DEFERRED`) | Higher raw throughput ceiling than Postgres-polling, but current evidenced volume does not require it | Similar to Postgres outbox | Provider-dependent | Highest ceiling, irrelevant without evidenced need |
| Observability | None exists today for any option (ADR-012 `DEFERRED`, R-018 `OPEN`) — this is a shared gap across every alternative, not specific to the recommended one | Has an ecosystem of dashboards (Bull Board etc.) if adopted | Minimal ecosystem tooling | Provider dashboards | Rich ecosystem, irrelevant without evidenced need |
| Replay | Table scan/re-flag by admin tooling (§7.14) — same mechanism regardless of dispatcher choice | Same, plus BullMQ's own job-retention/replay APIs | Same as Postgres outbox | Provider-dependent, often limited retention windows | Native, long-retention replay — the single strongest Kafka-specific capability, but not evidenced as needed (§10) |
| Tenant isolation | Same guarantees as the rest of the application-layer scoping model (ADR-002) — an event row is just another tenant-scoped table | Same, but requires the queue-key/tenant-scoping discipline to be re-implemented outside Postgres's existing scoping conventions | Same as Postgres outbox | Same discipline required, plus a new trust boundary (the managed vendor) | Same discipline required at a new layer (partition/topic ACLs) |
| KVKK/data residency | No new data-location question — stays in the existing PostgreSQL instance, already inside the KVKK-reviewed deployment | No new data-location question if self-hosted; a managed Redis would add one | No new data-location question | **New KVKK/data-residency review required** — a managed queue outside the current VPS is a new data location (ADR-008's "NEEDS EXTERNAL VENDOR/LEGAL DECISION" precedent applies analogously) | Same new-data-residency concern as managed queue, likely worse (multi-region replication is a common Kafka deployment pattern) |
| Backup implications | Already covered by existing Postgres backup process (itself flagged `HIGH`-risk/incomplete — R-030/031/032) — no new backup surface | New backup/persistence surface (Redis AOF/RDB) not currently part of any backup process | Already covered by existing Postgres backup process | Vendor-managed | New backup/retention surface |
| Deployment burden | Lowest — no new process type beyond what `worker.ts` already is | New process/service to deploy and keep running (worsens, not fixes, R-033's already-`OPEN` "no deploy automation for `noramedi-worker`" finding) | Low | New deployment target entirely | Highest |
| Local development | Already works — `npm run dev`-equivalent, no new local service | Requires a local Redis (Docker or native install) — new onboarding step | Works, same as Postgres outbox | Requires local emulation (e.g. LocalStack) or a shared dev-account, both with their own friction | Requires a local Kafka (heavyweight) |
| Failure modes | Postgres unavailable → whole app already down (no queue-specific new failure mode); dispatcher crash → lease-expiry recovery (§7.10) | Redis unavailable → jobs cannot be enqueued/dequeued even if Postgres is healthy — a **new** failure mode not present today (Experiment 22/23 in the test matrix directly targets this) | Same as Postgres outbox (no new failure mode) | Vendor outage → same new-failure-mode class as BullMQ/Redis | Broker outage → same new-failure-mode class, worse blast radius |
| Rollback | Trivial — drop the table/stop the worker, no schema the rest of the app depends on | Requires decommissioning a running service and its data | Trivial, similar to Postgres outbox | Requires vendor account teardown | Requires decommissioning a cluster |
| Measurable adoption trigger | N/A — this is the recommended default, requiring no trigger to adopt | Sustained throughput or delayed-job/rate-limiting needs the Postgres-outbox dispatcher cannot meet under measurement (Experiment 21) | N/A — a smaller step up from the recommended default if the bespoke dispatcher proves under-featured | A named vendor/data-residency decision plus an evidenced need the self-hosted options cannot meet | See §10 |

**Recommendation for the PoC's primary candidate:** No external queue. PostgreSQL outbox table + an in-process dispatcher (extending `worker.ts`, using the lease-based claiming pattern from §7.10) is the first thing the isolated PoC should build and measure. BullMQ is evaluated as the PoC's comparison candidate (Experiment 21) specifically to produce the evidence ADR-007 needs, **not selected by this document** — consistent with the task's instruction not to select BullMQ merely because it is familiar.

## 10. BullMQ suitability assessment (objective #6)

BullMQ is technically suitable **as a library** — it is a mature, well-documented Node.js queue library with built-in retry/backoff/delayed-jobs/rate-limiting, and nothing in the current codebase's stack (Node/Express/Prisma) is incompatible with it. The open question is not technical suitability of the library but **necessity**: it requires Redis, which does not exist anywhere in the current production topology (confirmed absent, F0-006 evidence) and would be the first new stateful infrastructure dependency added since the program began. Per §9, no currently-evidenced flow requires BullMQ's specific capabilities (native ordering, rate-limiting, delayed jobs) beyond what `availableAt`-column scheduling and lease-based claiming already provide. **BullMQ remains a non-binding candidate**, to be measured against the Postgres-outbox baseline in the PoC (Experiment 21), not adopted on the basis of familiarity or general industry popularity.

## 11. Kafka trigger (objective #7)

Per the task's own rule, "thousands of clinics" alone is not sufficient evidence. The following **measurable** trigger is proposed — Kafka (or another distributed log) becomes justified only when repository/production evidence shows **at least two** of the following, gathered from real observability data that does not exist yet (ADR-012 is `DEFERRED`; this is itself evidence the trigger is not currently measurable, let alone met):

1. **Sustained event throughput** exceeding a measured Postgres-outbox dispatcher's demonstrated ceiling (from PoC Experiment 20) by a sustained margin (not a single spike) over a rolling 7-day window.
2. **Multiple independent consumer groups** genuinely needing to replay the same event stream from different offsets simultaneously (e.g. a real-time notification consumer and a separate analytics/reporting consumer both needing independent replay position) — not evidenced today; F0-010's flow inventory found exactly one flow (F010-018) that would benefit from any event-driven consumption at all, and it names one consumer, not several.
3. **Replay requirements exceeding the outbox's retention mechanism** — e.g. a compliance or analytics need to replay 90+ days of events, beyond what a Postgres outbox table's practical retention window supports.
4. **Partition-ordering requirements** that per-aggregate ordering in a Postgres claim query cannot satisfy — not evidenced by any flow in §4/§5.
5. **Measured PostgreSQL/Redis contention** from the chosen simpler design, under real production load, that the PoC's own measurements (§12) show crossing an unacceptable threshold.
6. **Organizational capacity to operate it** — a distinct, non-technical gate: the team has zero current operational experience with distributed log systems (confirmed: none exist anywhere in the codebase or `MODULE_MAP.md`/`DEPENDENCY_MAP.md`), and adopting Kafka without that capacity is itself an operational risk independent of technical throughput numbers.

**Current status against this trigger: not met, not measurable yet** (no observability exists to measure #1/#3/#5). Kafka is explicitly rejected as a current default, consistent with `enterprise-foundation-decision-set.md` §E and ADR-001's "no premature Kafka" principle.

## 12. Isolated PoC design

Full experiment specification (25 experiments): [`f0-010-poc-test-matrix.md`](f0-010-poc-test-matrix.md).

**Environment (mandatory, non-negotiable):** a disposable PostgreSQL instance, never production, never the shared development database, never existing project migrations applied against it in a way that could be confused with a real migration history. No Redis/BullMQ instance is provisioned until Experiment 21 specifically requires one, and that instance is equally disposable. All experiments are destroyed after the PoC run; no state persists between PoC executions unless a specific experiment's design calls for it (none do).

**This document does not authorize running any of these experiments.** They are the exact specification a future, separately-scheduled PoC task must execute.

## 13. Acceptance criteria

### 13.1 Security and correctness — absolute, not negotiable

- Zero cross-tenant event consumption (Experiment 13).
- Zero unaudited replay (Experiment 17).
- Zero event loss after a committed business transaction, for any flow the PoC migrates onto the outbox pattern (Experiment 1-2, 6).
- Duplicate delivery produces no duplicate business side effect (Experiment 7, 16).
- Rollback (transaction abort) emits no event (Experiment 2).
- System/bypass access (e.g. an admin replay) is explicit and audited (Experiment 17).
- PHI/PII payload minimization rules pass (Experiment 14).
- Poison messages cannot block unrelated tenants indefinitely (Experiment 8, 10).

### 13.2 Performance — PoC proposals, not established facts

All of the following are **measurement targets the PoC must produce evidence for**, not current facts:

- Enqueue transaction latency delta (added write time vs. baseline, Experiment 20).
- Dispatcher throughput (events/sec sustained, Experiment 20).
- p50/p95/p99 delivery delay (Experiment 20).
- Maximum acceptable backlog (proposed initial target: informed by current message volumes, which are themselves unmeasured — the PoC's first job is to establish a baseline, not assume one).
- Backlog recovery time after a simulated outage (Experiment 18).
- Retry volume under representative failure-injection (Experiment 9).
- Duplicate delivery count under simulated at-least-once redelivery (Experiment 7).
- DB CPU/IO impact of the outbox table under load (Experiment 19-20).
- Connection count impact (Experiment 19).
- Lock-wait time under concurrent dispatcher claims (Experiment 4).
- Worker memory/CPU under load (Experiment 20).
- Per-tenant fairness under an adversarial single-tenant flood (Experiment 10).
- Queue-outage recovery time, if a queue product is later measured (Experiment 22-23).

No numeric threshold is asserted as an established fact anywhere in this document — every number above is explicitly a PoC output, not a prior claim.

## 14. Rollout design (future, staged sequence — not authorized by this document)

| Stage | Content | Dependency | Feature/config flag | Observability | Backward compatibility | Rollback | Stopping condition | Required evidence |
|---|---|---|---|---|---|---|---|---|
| 1. Domain/event inventory | Formalize this document's §4 findings into a maintained catalog | This document | N/A | N/A | N/A | Discard the catalog | Catalog covers all flows this design's §5 trigger would eventually name | This document + future flow additions |
| 2. Contract templates and versioning rules | Turn §8 into enforceable templates/lint rules | Stage 1 | N/A | N/A | N/A (net-new) | Remove templates | ADR-006 acceptance | ADR-006 moves off `DEFERRED`/`NEEDS_POC` |
| 3. Idempotency library design | Formalize the `createInboundEventOrDetectDuplicate`/`P2002`-catch pattern (F010-001) into a shared utility | Stage 2 | N/A | N/A | N/A | Remove library | Library passes its own unit tests in isolation | Design review |
| 4. Disposable PostgreSQL outbox PoC | Execute the 25-experiment matrix | Stages 1-3 | N/A (isolated environment only) | PoC-local only | N/A | Destroy environment | All 25 experiments produce a result (pass or documented fail) | Experiment results |
| 5. Dispatcher prototype in isolated PoC only | Build the §7.10 lease-based claimer against the disposable DB | Stage 4 | N/A | PoC-local only | N/A | Destroy environment | Experiments 3-6, 9-10 pass acceptance thresholds | Experiment results |
| 6. One low-risk internal consumer | Wire F010-018 (notifications) as the first real consumer — chosen because it has the lowest PII sensitivity of the `YES`-classified flows and no external-delivery irreversibility concern (§7.15) | Stage 5 + a separate future implementation task's own review | New feature flag, default off | Dispatch/consume counters, per-tenant backlog | Old polling-upsert path stays live in parallel (shadow) | Disable flag, old path unaffected | Shadow output matches old polling-upsert output for N days | Comparison report |
| 7. Shadow/audit-only observation | Run the outbox path alongside the legacy path without cutting over | Stage 6 | Same flag, audit-only sub-mode | Full comparison dashboarding (requires ADR-012 acceptance first) | Full — legacy path is authoritative | Disable flag | Zero material divergence over the observation window | Comparison report |
| 8. Staging canary | Cut over in a non-production environment | Stage 7 | Same flag, staging-scoped | Full | Full rollback to legacy path | Disable flag | Staging soak period clean | Staging evidence |
| 9. Production canary | **Only after freeze release** (KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md §5 condition 5, plus F6 phase entry, plus ADR-006/007 acceptance) | Stage 8 + freeze release + ADR acceptance | Same flag, production-scoped, single low-risk tenant first | Full | Full | Disable flag | Canary tenant soak period clean | Production evidence |
| 10. Broader adoption by domain | Migrate additional `YES`/`PARTIAL`-classified flows (F010-004/005/007, then F010-008's narrower fix) one at a time | Stage 9 | Per-flow flag | Full | Full, per flow | Per-flow flag disable | Each flow's own soak period clean | Per-flow evidence |
| 11. Queue adoption only after measured trigger | Only if §11's Kafka trigger (or a BullMQ-specific measured gap from Experiment 21) is actually met | Stage 10 + §11 trigger evidence | New infrastructure, new flag | Full | Full | Decommission queue, fall back to Postgres outbox | Trigger conditions independently verified | Production measurement data |

**This document explicitly does not authorize any stage above.** Stage 4 (disposable PoC) is the earliest point at which any experiment would even run in a throwaway environment, and even that requires a separate, future task with its own review — this document is design input to that future task, not its authorization.

## 15. High-risk areas — explicit treatment

- **Tenant isolation:** §7.7-7.9 mandate tenant-context reconstruction from the event row itself, bounded worker concurrency to prevent noisy-neighbor starvation (R-022), and Experiment 13's cross-tenant-denial test as an absolute (§13.1) acceptance gate.
- **KVKK and health data:** §7.4-7.6 mandate identifiers-only payloads by default; F010-008 (consent) is explicitly flagged `PARTIAL`/narrower-fix, not outbox-authorized, and remains inside the freeze boundary (§16 below).
- **Communication consent:** covered by F010-008's classification and by the freeze boundary's §3 item 14 — this design does not touch or authorize any change to consent-flow code.
- **Official integrations:** ADR-010 already names ADR-006/ADR-007 as its own dependencies; this document's findings are upstream input to a future F9 adapter-platform design, not a decision about it.
- **Imaging/DICOM:** F010-014/015 show minimal current async surface; F010-015 (studies upload) is explicitly `AMBIGUOUS`, not classified as needing anything, pending a future targeted investigation.
- **AI workflows:** out of scope — no AI-specific async flow was found beyond F010-001/002/003's inline AI-processing step, which this design does not propose moving off the request path (that would be a latency/architecture decision for ADR-009's own future work, not this task's).
- **Payment/financial events:** F010-005 (payment reminder send) is the only payment-adjacent flow found; classified `YES`/`YES` (outbox/queue candidate) with the same crash-gap reasoning as F010-004, no financial-transaction-processing flow was found in this bounded investigation.
- **Audit evidence:** §8's "audit requirements" rule and §7.14's replay-audit requirement are the design's answer; F010-INFRA-03 (`AuditLog`'s existing two-tier pattern) is the concrete precedent this design builds on rather than inventing a new audit concept (avoiding the R-047-style duplicate-concept risk already flagged for consent-audit).
- **Storage lifecycle:** not directly touched — F010-009/010 (export flows) are the closest adjacent domain and are explicitly NOT proposed for outbox migration (F010-009 already works; F010-010's migration-onto-the-existing-worker-pattern question is a separate, narrower, future decision, §4's `PARTIAL` classification).
- **External provider delivery:** §7.11 (crash-after-side-effect) and §9's provider-idempotency-key caveat are the design's direct answers; Experiment 16 tests this specifically.
- **Data retention:** §7.13 explicitly requires the outbox's own retention window to stay compatible with `dataRetentionCleanupJob.ts`'s existing categories, avoiding the coupling risk flagged in F010-011's inventory row.
- **Replay risk:** §7.14 (authorization + audit) and Experiment 17 are the design's answer; "who may replay" is explicitly deferred to a future implementation task's authorization-model design, not decided here beyond "platform-admin only."

## 16. Freeze-boundary impact mapping

| Item | Freeze status | This document's relationship to it |
|---|---|---|
| This document itself (design, JSON inventory, test matrix) | Allowed now — `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 19, §6 | Fully compliant; documentation only |
| Any future outbox table/migration | Frozen — §3 item 14, §2 row 19 ("N/A, does not exist yet," exit condition "F6 entry") | Not created, not authorized, by this document |
| Any future queue dependency (BullMQ/Redis) | Frozen — same as above, plus would be a new stateful infrastructure dependency requiring its own separate review | Not installed, not authorized |
| F010-008 (consent audit `$transaction` fix) | Frozen — inside §2 rows 1-5's consent/audit area, §3 item 14 explicitly names "queue/outbox implementation that rewires current consent/audit flows" | Diagnosed only; this document does not implement or authorize the narrower fix it describes |
| F010-004/005/007/018 (reminder sends, appointment-request notification, in-app notifications) | Not explicitly named in §2's 20-row matrix (none of these areas appear as a distinct frozen row); implicitly covered by §3's general "queue/outbox implementation" freeze if and only if a future implementation routes them through a new outbox — the flows' EXISTING code is not itself frozen (it predates and is unrelated to KVKK-HIGH-007) | Diagnosed only; no code touched |
| ADR-006/ADR-007 status | Governed by `ARCHITECTURE_DECISIONS.md`'s own status model, not directly by the freeze boundary | See §17 |

## 17. ADR-006 and ADR-007 status

This document is the named evidence-gathering step both ADR-006 and ADR-007 cite as their reevaluation trigger ("F0-010 PoC design + volume projections" / "F0-010 PoC: candidate comparison, current job-infra inventory" — `adr-foundation-review.md` §4). Both ADRs' `DEFERRED` reevaluation trigger required an F0-010 design document to exist; it now does, produced by this task. Consistent with the same agent-authority limits F0-008/F0-009 already applied (an agent can move an ADR to a documentary, not final, status — see `ARCHITECTURE_DECISIONS.md`'s "F0-008 notu"), this task's own recommendation, recorded in `ARCHITECTURE_DECISIONS.md` and `adr-foundation-review.md` (see the accompanying updates to those files), is:

- **ADR-006 (Transactional outbox): `DEFERRED` → `NEEDS_POC`.** The PoC design and measurement criteria (§12, full matrix) now exist, satisfying the "PoC tasarımı" half of the ADR's stated evidence gap. The "hacim projeksiyonları" (volume projections) half remains genuinely unmet — no production observability exists to produce real volume numbers (ADR-012 `DEFERRED`), so this task's §4/§5 flow-count-based reasoning is offered as a **structural** substitute for a **volume** projection, not a replacement for one. Implementation remains frozen regardless (§16).
- **ADR-007 (Queue platform selection): `DEFERRED` → `NEEDS_POC`.** The candidate comparison (§9) and current job-infrastructure inventory (§3, JSON) now exist. The ADR's own reevaluation trigger ("measurable event-volume/replay/multi-consumer need") remains unmet — this task does not claim it is met, only that the PoC whose results would measure it is now fully specified. "BullMQ preferred near-term candidate" remains a non-binding preference (§10); this task does not elevate it.

Both recommendations require external (ChatGPT/user) review before being treated as final program policy, per `NORAMEDI_MASTER_TRACKER.md` §2.2/§2.3 — this task, like every F0 task before it, can reach `AGENT_COMPLETED` but cannot itself accept an ADR status change as binding.

## 18. Unresolved questions (explicitly not answered by this document)

- Exact deprecated-event-version support window (§8) — depends on a future consumer count that does not exist yet.
- Whether `OperationalEvent` should be extended with a processing-status field or a new table introduced (F010-INFRA-02) — a genuine design fork the PoC should resolve by building both against Experiment 3-4 and comparing, not by this document picking one.
- F010-015 (imaging bridge study upload) — flagged `AMBIGUOUS` throughout; needs a dedicated future read of the full `imagingBridgePublic.ts` studies-upload handler before any classification.
- Exact retention period for outbox rows (§7.13) and exact index set beyond the minimum named (§7.9) — both PoC measurement questions.
- "Who may replay" beyond "platform-admin only" (§7.14) — a future authorization-model design question.
- Whether F010-010 (patient privacy export) should migrate onto F010-009's worker pattern — flagged as a future decision, explicitly out of scope for this task.

## 19. Implementation blockers (restated)

1. `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 14 and §2 row 19 — queue/outbox implementation frozen regardless of KVKK-HIGH-007 status, gated on F6 entry.
2. F6 phase entry itself requires F5 exit (RLS/tenant-isolation work, itself frozen and `NEEDS_POC` per ADR-004/005/F0-009) plus ADR-006/007 acceptance (per `F6_QUEUE_OUTBOX_AND_RELIABILITY.md`'s own entry conditions) — this document does not and cannot satisfy either.
3. ADR-006/007 acceptance itself requires external review (§17) — not available to any agent.
4. No observability exists (ADR-012 `DEFERRED`) to produce the volume-projection evidence ADR-006 still needs even after this document's structural analysis.

---

**Non-authorization statement (restated):** F0-010 defines transactional-outbox and queue PoC evidence requirements only. It does not authorize an OutboxEvent schema or migration, queue dependency installation, Redis deployment, BullMQ or Kafka adoption, worker refactoring, event publication from production flows, or production configuration changes. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR receives evidence-based acceptance.

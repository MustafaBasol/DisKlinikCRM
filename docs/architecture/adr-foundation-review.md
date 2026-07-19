# ADR Foundation Review — F0-008

Task: F0-008 — ADR Review and Enterprise Foundation Decision Set
Phase: F0 — Baseline, Program Control, and Architecture Validation
Type: Documentation and architecture-decision review only. No runtime, schema, migration, deployment, dependency, or CI change is included in this task.

Baseline: `origin/main` @ `7cf7a827277779091b9e34e726eebccd39f624ae` (merge commit for [PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174), `docs(privacy): establish F0-007 KVKK baseline and freeze boundary (#174)`, confirmed `MERGED` via `gh pr view 174 --json state,mergedAt,mergeCommit` → `state: MERGED`, `mergedAt: 2026-07-19T13:44:32Z`, `mergeCommit.oid: 7cf7a827277779091b9e34e726eebccd39f624ae` — matches `git log -1 HEAD` exactly).
Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-008-adr-foundation-review`, branch `docs/f0-008-adr-foundation-decisions`.
Primary worktree (`D:\Mustafa\Siteler\DisKlinikCRM`): not read, not modified. Only `git status --short` / `git branch --show-current` / `git rev-parse HEAD` / `git worktree list` were run against it, before this worktree was created and again before push, per task protection rules.

## 0. Correction of a self-reference lag found during sourcing

Per the source hierarchy this task must follow (git evidence and merged-PR evidence outrank in-repo narrative text — see `docs/program/README.md` §2 and `docs/program/NORAMEDI_MASTER_TRACKER.md` §2.1), the following is recorded as fact before the review proceeds:

`docs/program/NORAMEDI_MASTER_TRACKER.md` §5 (`Active task`), `docs/program/CURRENT_PHASE.md`, and `docs/program/phases/F0_BASELINE_AND_VALIDATION.md`, **as checked out at this task's own baseline commit**, all still narrate F0-007 as `PR_OPEN`. This is the same self-reference lag pattern those same documents describe for F0-002 through F0-006 (a task's tracker update is committed as part of its own merge commit, so the committed snapshot necessarily predates knowledge of its own merge). Independent verification in this task:

- `git log --oneline -1` on the worktree's baseline HEAD: `7cf7a82 docs(privacy): establish F0-007 KVKK baseline and freeze boundary (#174)` — a GitHub squash-merge commit title.
- `gh pr view 174 --json state,mergedAt,mergeCommit`: `{"state":"MERGED","mergedAt":"2026-07-19T13:44:32Z","mergeCommit":{"oid":"7cf7a827277779091b9e34e726eebccd39f624ae"}}` — the merge commit SHA is identical to this worktree's baseline HEAD.
- `gh pr view 175 --json state,title,headRefName`: `{"state":"OPEN","headRefName":"feature/kvkk-high007-consent-reconciliation-ux",...}` — confirms the KVKK-HIGH-007 continuation remains open and unmerged, unchanged from F0-007's own finding.

**Finding: F0-007 is `MERGED` (PR #174), not `PR_OPEN`.** This matches the task's own PROGRAM STATUS instruction ("F0-007 MERGED via PR #174") and is independently confirmed via `gh pr view`, not merely assumed. This correction is applied to the master tracker and phase document in this task's own file changes (§6 below) as a targeted, evidence-backed edit — the same self-reference-lag correction pattern F0-003 through F0-007 each applied to their predecessor. It does **not** change any F0-007 architecture-freeze-boundary finding: the KVKK-HIGH-007 continuation (PR #175) remains `OPEN`, unmerged, and its content remains uninspected by this task, so every freeze condition tied to "PR #175 merged" in `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §5 condition 2 remains unsatisfied. The freeze boundary is unaffected; only F0-007's own task status is corrected.

## 1. Sources reviewed

Read in full, in this worktree, before any file was edited:

| Source | Path |
|---|---|
| Agent instructions | `AGENTS.md` |
| Master tracker | `docs/program/NORAMEDI_MASTER_TRACKER.md` |
| F0 phase document | `docs/program/phases/F0_BASELINE_AND_VALIDATION.md` |
| Current phase summary | `docs/program/CURRENT_PHASE.md` |
| Program docs index | `docs/program/README.md` |
| ADR index (ADR-001…017) | `docs/program/ARCHITECTURE_DECISIONS.md` |
| Domain/module ownership map | `docs/program/MODULE_MAP.md` |
| Cross-module dependency map + matrix | `docs/program/DEPENDENCY_MAP.md` |
| Test inventory/ownership | `docs/program/TEST_OWNERSHIP.md` |
| Release gates G0–G6 | `docs/program/RELEASE_GATES.md` |
| Risk register (R-001…R-053) | `docs/program/RISK_REGISTER.md` |
| KVKK active-work baseline | `docs/program/KVKK_ACTIVE_WORK_BASELINE.md` |
| KVKK architecture freeze boundary | `docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` |
| F0-007 evidence | `docs/program/evidence/F0-007_KVKK_BASELINE_EVIDENCE.md`, `evidence/F0-007_kvkk_work_inventory.json` |
| KVKK compliance docs (imaging, bulk export, incident response, comms/consent) | `docs/compliance/53-kvkk-attachment-imaging-lifecycle.md`, `54-kvkk-secure-clinic-bulk-export.md`, `55-kvkk-security-incident-response-foundation.md`, `56-kvkk-communication-preference-and-consent-management.md` |
| KVKK compliance audit/remediation tracker | `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` |

**Repository paths named in the task instructions that do not exist in this repository, and their nearest equivalents actually used:**

- `docs/architecture/module-map.md` → does not exist. Equivalent: `docs/program/MODULE_MAP.md`.
- `docs/architecture/current-runtime-inventory.md` → does not exist. Nearest equivalents: `docs/program/PRODUCTION_TOPOLOGY.md`, `docs/program/ENVIRONMENT_MATRIX.md`, `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`.
- `docs/architecture/test-baseline.md` → does not exist. Equivalent: `docs/program/TEST_OWNERSHIP.md`.
- `docs/architecture/launch-gates.md` → does not exist. Equivalent: `docs/program/RELEASE_GATES.md`.
- "Architecture assessment", "current-vs-target matrix", "ADR backlog" → no separate files exist under these names. The ADR backlog is `docs/program/ARCHITECTURE_DECISIONS.md` itself; the closest thing to an assessment/current-vs-target matrix is the combination of `MODULE_MAP.md` + `DEPENDENCY_MAP.md` §10 (current-state matrix) plus `NORAMEDI_MASTER_TRACKER.md` §9/§10 (target program direction).
- "NoraMedi enterprise architecture/modularization roadmap v2 (Word)" → not present in the repository in any form (`.docx` or otherwise). `docs/09-development-roadmap.md` exists but is the pre-program MVP roadmap (phases: project setup → core data model → …, dated before the F0 program existed) — it is superseded by `docs/program/` and is **not** cited as evidence anywhere in this review, consistent with the rule that the Word roadmap is guidance only and cannot override repository evidence.

This document, `docs/program/ARCHITECTURE_DECISIONS.md`, and `docs/architecture/enterprise-foundation-decision-set.md` (new, this task) together are this repository's architecture-assessment/current-vs-target/ADR-backlog artifact set going forward.

`docs/program/evidence/` files for F0-002 through F0-006 were consulted via their summaries in the master tracker and phase document rather than re-read line-by-line in full, since F0-008's dependencies are explicitly F0-003 and F0-004 (both `MERGED`) and the ADR questions this task answers are architectural-direction questions, not a re-audit of already-`MERGED` inventory tasks.

## 2. Existing accepted decisions found

**Zero ADRs are `ACCEPTED`.** `docs/program/ARCHITECTURE_DECISIONS.md` (last updated 2026-07-17, F0-001) states explicitly: "Tüm ADR'ler şu an `PROPOSED` durumundadır. Hiçbir teknik ayrıntı kabul edilmiş sayılmaz" (all ADRs are currently `PROPOSED`; no technical detail is considered accepted). All 17 ADR-001…017 entries carry `Status: PROPOSED`.

Separately, `NORAMEDI_MASTER_TRACKER.md` §9 records 17 items as `PROGRAM DIRECTION` — explicitly **not** ADR acceptance ("Aşağıdakiler PROGRAM DIRECTION niteliğindedir; kesinleşmiş ADR değildir"). These are directional statements made at program-kickoff (F0-001), before F0-003's module-ownership evidence or F0-004's dependency evidence existed. This review's job is to determine which of those directional statements, and which of the 17 proposed ADRs, are now mature enough — given F0-003/F0-004/F0-006/F0-007 evidence that did not exist when they were written — to become the first `ACCEPTED` or `ACCEPTED WITH CONDITIONS` architecture decisions in the program.

## 3. Classification legend

| Classification | Meaning |
|---|---|
| ACCEPT NOW | Binding as of this task. Repository evidence is sufficient, no conflicting accepted ADR exists, and acceptance does not require any implementation (documentation-only, consistent with the F0-007 freeze). |
| ACCEPT WITH CONDITIONS | The directional/principle-level decision is binding now; a named sub-decision (component choice, threshold, contract syntax, etc.) is explicitly deferred to a later PoC/design task and is not binding yet. |
| DEFER | Not enough repository evidence exists yet to accept even the direction; a specific F0-0xx/F-phase task is named as the evidence-gathering step. |
| NEEDS POC | The decision cannot be made responsibly without a proof-of-concept whose measurement criteria do not yet exist; implementation is frozen under F0-007/tracker §8 regardless of PoC outcome. |
| SPLIT | The ADR's scope decomposes into an already-separately-tracked ADR; no new ADR is created, cross-reference recorded instead. |
| SUPERSEDED / REJECT / NEEDS EXTERNAL DECISION | Used where applicable per ADR; see matrix. |

## 4. Decision matrix

| ADR | Title | Proposed status | Reviewed status | Repository evidence | Dependency | F0-007 freeze impact | PoC / external decision required | Reevaluation trigger | Conflict / supersession notes |
|---|---|---|---|---|---|---|---|---|---|
| ADR-001 | Modular monolith (+ no-rewrite, stack retention) | `PROPOSED` | **ACCEPT NOW** | `MODULE_MAP.md` (37/39 domains classified, ownership evidenced); `DEPENDENCY_MAP.md` §10.3 (833 edges, 9 X-severity violations, 35 two-domain cycles — evidence of a monolith with weak but discoverable seams, not a system requiring service extraction) | F0-003, F0-004 (both `MERGED`) | None — documentation only, no code/schema touched | None to accept the direction; boundary *enforcement* mechanism is ADR-015's job | Sustained, evidenced inability to ship a bounded module without touching ≥3 other domains despite ADR-015 contracts existing | Absorbs tracker §9 items 1–8 (no rewrite; Express/React-Vite/Prisma/PostgreSQL retained; modular-monolith target; service extraction only for evidenced boundaries; no premature microservices/Kafka/Kubernetes) — see §5.1 |
| ADR-002 | Tenant isolation layers (defense-in-depth) | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `MODULE_MAP.md`: "Tenant Security and Scope … clearly bounded", `clinicScope.ts`/`clinicAccess.ts`/`tenantGuard.ts`; `docs/compliance/54§3`/`56§9`: 40+ callers use `validateAndGetScope`/`validateAndGetClinicIdScope`, never `req.user.clinicId` directly | F0-007 | `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 15: tenant scoping is `STABLE`; RLS/backfill/tenant-extension implementation is item 2-4/11-12 of the program-wide freeze (`NORAMEDI_MASTER_TRACKER.md` §8) | RLS layer: NEEDS POC (F0-009). PgBouncer interaction: NEEDS POC (ADR-004) | RLS PoC (F0-009) produces measured latency/connection-budget data under realistic tenant-count load | Decomposes into this ADR (accepted baseline) + ADR-004/ADR-005 (still NEEDS POC) — see §5.2 |
| ADR-003 | Shared vs dedicated tenant databases | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `MODULE_MAP.md`: single shared `PrismaClient` today, no per-tenant DB code found; `RISK_REGISTER.md` R-023 (large enterprise tenant overload, `OPEN`, `UNVERIFIED` control) | ADR-002 | None — direction only | Dedicated-tenant trigger thresholds and operational model: DEFER to F5/F11 with pilot-customer requirements as input | A named enterprise pilot customer's contractual/compliance requirement, or a measured noisy-neighbor incident (R-022/R-023), that shared-schema cannot satisfy | Formally rejects schema-per-tenant as a default (tracker §10 already lists this `REJECTED`) — this ADR makes that rejection binding rather than merely directional |
| ADR-004 | Prisma and PgBouncer strategy | `PROPOSED` | **NEEDS POC** | `RISK_REGISTER.md` R-008 (`OPEN`, `UNVERIFIED`); F0-006 evidence: PgBouncer presence itself is `UNVERIFIED` in production (`PRODUCTION_TOPOLOGY.md` open item) | F0-009 | Implementation frozen — tracker §8 items 3-4 | F0-009 PoC: pooling mode vs. RLS `SET`/prepared-statement behavior under load | F0-009 PoC produces a working pooling-mode recommendation with measured connection-exhaustion behavior | None |
| ADR-005 | PostgreSQL RLS | `PROPOSED` | **NEEDS POC** | `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 items 11 explicitly names RLS rollout as frozen program-wide | F0-009, ADR-004 | Implementation frozen — tracker §8 item 3, freeze boundary §3 item 11 | F0-009 PoC: policy model, role strategy, Prisma integration, performance impact | F0-009 PoC evidence + KVKK baseline external stabilization (freeze boundary §5) | Directional intent ("RLS is an *additive* defense-in-depth layer on top of app-level scoping, not a replacement for it") is affirmed as non-binding guidance for the PoC's design, not accepted as an ADR |
| ADR-006 | Transactional outbox | `PROPOSED` | **DEFER** (principle-level idempotency/versioning requirement: ACCEPT NOW) | `MODULE_MAP.md`: "Shared Events / Queue Contracts / Idempotency … partially bounded", `MessagingInboundEvent`/`JobLock` exist but no outbox table found; `RISK_REGISTER.md` R-010/R-011 (`OPEN`) | F0-010 | Implementation frozen — tracker §8-adjacent, freeze boundary §3 item 14 ("queue/outbox implementation that rewires current consent/audit flows") | F0-010 PoC design + volume projections | F0-010 design document exists and is reviewed | The narrow principle "if/when an outbox is built, event contracts must be versioned and consumers idempotent" is accepted now as a binding invariant for any future implementation (task's own minimum decision set), independent of *whether/when* outbox is built |
| ADR-007 | Queue platform selection | `PROPOSED` | **DEFER** | No queue library found in `MODULE_MAP.md`/`DEPENDENCY_MAP.md`; existing job execution is PM2 cron + `JobLock` (Postgres advisory-lease), not a queue | F0-010, ADR-006 | Implementation frozen | F0-010 PoC: candidate comparison, current job-infra inventory | Measurable event-volume/replay/multi-consumer need (per task's own trigger rule: "No Kafka without a measurable event-volume/replay/multi-consumer trigger" — and no queue at all is currently justified by volume evidence either) | "BullMQ preferred near-term candidate" is recorded as a **non-binding preference** per the task's minimum decision set, not an ADR acceptance — no queue selection is binding until F0-010 |
| ADR-008 | Object-storage abstraction | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `services/fileStorage.ts` (local disk or S3-compatible via `S3_BUCKET`), `buildStorageKey(clinicId, originalName)` and `buildExportStorageKey(clinicId, exportId)` already tenant-scoped (`docs/compliance/53§4.1`, `54§6`); `isSafeStorageKey()` rejects path traversal; production is confirmed `LOCAL_VPS_STORAGE`, no S3 in use (`RISK_REGISTER.md` R-029, `HIGH`) | F0-011 | `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 16: storage/attachment lifecycle `STABLE`; storage-key migration is item 8 of the frozen list | Provider selection + data-residency (KVKK) decision: **NEEDS EXTERNAL VENDOR/LEGAL DECISION**. Migration/lifecycle/rollback design: DEFER to F0-011 (separate user decision required to start, per tracker §13) | F0-011 design doc exists, reviewed, and a provider/data-residency decision is made | The *interface* (provider-agnostic abstraction, tenant-scoped non-identifying keys) already exists in code and is affirmed as the pattern to build on — this ADR does not authorize any storage-key migration |
| ADR-009 | AI Gateway | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `MODULE_MAP.md` "Planned / Not Implemented": confirmed absent — only `services/googleAiStudio.ts`, no provider registry/routing/metering; all AI usage embedded in WhatsApp orchestration (`whatsappConversationAgent.ts` et al., classified "shared/ambiguous") | ADR-001 | None — no AI Gateway exists to freeze; principle constrains *future* expansion only | Gateway architecture (routing, metering, PII/PHI minimization, provenance log): DEFER to F8 | Any proposal to expand AI usage beyond the current WhatsApp-embedded scope, or to add a second AI-consuming channel | Principle only: "no wider AI/clinical expansion without passing through a governed gateway" is binding now; it does not require building a gateway before F8, since current AI usage is not being expanded by this task |
| ADR-010 | Official integration adapter platform | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `MODULE_MAP.md` "Planned / Not Implemented": confirmed absent — "No Sağlık Bakanlığı or other official-integration code found; each channel has its own bespoke provider-factory pattern" (WhatsApp/Instagram/SMS) | ADR-006, ADR-007 | None — nothing to freeze; principle constrains future work only | **NEEDS EXTERNAL OPERATIONAL/VENDOR DECISION** (Ministry of Health technical/administrative requirements, certificate management) before adapter contract design; concrete design DEFER to F9 | A named target official API with published integration requirements | Principle: adapter-boundary + delivery-ledger discipline, not domain-route embedding, is binding for any future official-integration work — even the existing bespoke per-channel provider-factory pattern used by WhatsApp/Instagram/SMS should not be extended to a new official channel without this discipline |
| ADR-011 | DICOM/PACS architecture | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `MODULE_MAP.md`: Imaging domains exist and are "mixed"/"partially bounded" maturity (`routes/imaging.ts`, 1303 lines/27 routes; bridge domain separate); no PACS component found | ADR-008 | `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 17: imaging lifecycle `STABLE`, redesign frozen program-wide | Component selection (Orthanc/DICOMweb) and clinical validation: **NEEDS POC + NEEDS EXTERNAL LEGAL/CLINICAL DECISION** (`RELEASE_GATES.md` G4 explicitly requires "ayrı yasal ve klinik validasyon") | G4 gate technical-evidence checklist satisfied (`RELEASE_GATES.md`) | Negative constraint ("do not build PACS from scratch") is binding now; positive component choice is not |
| ADR-012 | Observability standard | `PROPOSED` | **DEFER** | `RISK_REGISTER.md` R-018 (PII/PHI-in-logs, `OPEN`, `UNVERIFIED`), R-037 (PM2 restart counts uninvestigated); no current log/monitoring inventory exists in the repository | none named | None | Evidence-gathering: a current log/monitoring inventory (not yet produced by any F0 task) | An F3-scoped evidence-gathering task produces the current-state inventory this ADR needs | None |
| ADR-013 | Backup, PITR, and DR | `PROPOSED` | **DEFER** | `RISK_REGISTER.md` R-030/R-031/R-032 (all `HIGH`, `OPEN`): no offsite backup copy, PITR `NOT_CONFIGURED` (`archive_mode=off`), restore-test evidence absent despite `runRestoreTest()` capability existing in `backupService.ts` | ADR-008 | `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 row 18: `STABLE`, F0-011 design only | RPO/RTO targets: DEFER to F0-011. Retention-period components: **NEEDS EXTERNAL LEGAL DECISION** (`docs/compliance/53§16`, `56§15`: clinical-image/consent retention periods explicitly deferred to legal counsel) | F0-011 design doc names concrete RPO/RTO targets and a DR topology | R-030/R-031/R-032 are `HIGH`-impact and already documented, not created by this review; this task does not resolve them — resolving them is implementation, blocked by both F0-007 freeze and this ADR's own DEFER classification |
| ADR-014 | Feature flags, entitlements, and permissions | `PROPOSED` | **ACCEPT NOW** | `MODULE_MAP.md`: "Entitlements and Release Flags … No dedicated entitlement service found; `Plan.features` (JSON) and per-domain ad hoc flags (`ClinicSmsSettings.addonEnabled`, `PlatformSetting`) are the current de-facto mechanisms"; `DEPENDENCY_MAP.md` §9 rules 7-8 already state entitlements must be backend-enforced and disabled-module workers/jobs must not keep running | ADR-001 | None — documentation only | None to accept the principle; a unified entitlement *service* design is future F2 work | A concrete entitlement-service design proposal is reviewed against this ADR at F2 entry | None |
| ADR-015 | Module boundaries and public contracts | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `DEPENDENCY_MAP.md` §10.3: 15 evidence-based contract candidates identified, highest-priority CC-04 (Appointment booking/cancellation command) closes 4 of 9 X-severity violations; 833-edge matrix gives this ADR real current-state input for the first time | F0-003, F0-004, ADR-001 | None — documentation only; no contract is implemented by accepting this principle | Contract syntax/location, versioning scheme, lint/CI enforcement: DEFER to F2 | A pilot contract (recommended: CC-04) is implemented and reviewed at F2 entry | Cross-domain infrastructure/repository imports are prohibited going forward *except* as a documented transitional exception (per task's minimum decision set) — the 9 existing X-severity `WHA`/`IGM`→`PAT`/`APT` violations are the first candidates for such a documented exception, not an immediate violation of this ADR |
| ADR-016 | Container and orchestration strategy | `PROPOSED` | **ACCEPT WITH CONDITIONS** | `PRODUCTION_TOPOLOGY.md`/F0-006 evidence: confirmed bare-VPS + PM2 + host Nginx; `docs/35-docker-deploy-runbook.md` confirmed stale/aspirational (R-039); no orchestrator in use | ADR-012 | None — documentation only | Concrete container-evolution plan (single-VPS → multi-instance): DEFER to F7 | Independent service count, multi-node autoscaling need, and operational capacity all measured and evidenced (task's own trigger rule) — none of which exist today | Confirms the Docker Compose runbook does not describe current reality; recommends (not mandates, since doc changes outside `docs/program/`+`docs/architecture/` are out of this task's scope per `RISK_REGISTER.md` R-039) that a future documentation-only task mark it deprecated |
| ADR-017 | Analytics and OLAP strategy | `PROPOSED` | **DEFER** | `DEPENDENCY_MAP.md` §10.3: `RPT` (Reporting) has 67 fan-out edges and the widest raw-SQL read footprint, but no report-load measurement exists | ADR-013 | None | Evidence-gathering: report-load measurement (not yet produced by any F0 task) | F11-scoped evidence-gathering task produces load data this ADR needs | None |

## 5. Per-ADR review detail

Each subsection below answers the task's key review questions for ADRs reaching `ACCEPT NOW` or `ACCEPT WITH CONDITIONS`, using the required ADR quality fields. ADRs classified `DEFER`/`NEEDS POC` are intentionally left thin here — expanding them further would be exactly the "premature implementation detail" the task instructs this review to avoid; their full ADR content is written when their named dependency (F0-009/F0-010/F0-011/F3/F7/F8/F9/F10/F11 evidence) exists.

### 5.1 ADR-001 — Modular monolith (accepted)

- **Context.** F0-003 (`MODULE_MAP.md`) evidences 37 domains across Core Platform, Core Clinical Operations, and Optional/Operational categories, each mapped to real files/models at commit `368bcc8`. F0-004 (`DEPENDENCY_MAP.md` §10) evidences 833 dependency edges across those domains, with 9 `X` (high-risk boundary violation) edges concentrated in two domains (`WHA`, `IGM`) and 35 two-domain cycles. This is the first time the program has had real current-state evidence, rather than the F0-001 pre-evidence `PROGRAM DIRECTION` statement, to evaluate whether a modular monolith remains appropriate.
- **Decision.** NoraMedi remains a modular monolith. No framework rewrite. Express, React/Vite, Prisma, and PostgreSQL are retained unless a later accepted ADR presents evidence of unsuitability (none has). Service extraction is justified only for domains with evidenced, sustained cross-cutting friction that public contracts (ADR-015) cannot resolve — no such domain is evidenced today; the worst offenders (`WHA` at 106 fan-out edges, `PRV` at 97) are messaging/privacy domains whose problem is internal-file bloat (`routes/whatsapp.ts`, 3999 lines) and boundary discipline, not a scaling or deployment-isolation need that extraction would solve.
- **Scope.** Applies to the whole backend (`server/src/`) and frontend (`src/`) monorepo structure. Does not itself define module boundaries (ADR-015's job) or the entitlement/flag model (ADR-014's job).
- **Alternatives considered.** (a) Full rewrite on a different stack — rejected: no repository evidence of framework unsuitability exists; F0-002/F0-006 show the current stack is functioning in production. (b) Immediate microservice decomposition along the 37 domains — rejected: 833-edge dependency density and 35 cycles show the domains are not yet cleanly separable; extracting now would freeze today's ad hoc coupling into network boundaries. (c) NestJS/Next.js migration — rejected, consistent with tracker §10's existing `DEFERRED/REJECTED` entries; no new evidence changes that.
- **Reasons alternatives were rejected.** Absence of evidence of unsuitability for (a); presence of evidence of high coupling for (b); no change in facts for (c).
- **Positive consequences.** Avoids paying network/deployment/observability tax for domains not yet proven to need isolation; keeps the KVKK-sensitive Privacy/Consent domain (`PRV`, 97 fan-out edges) inside one transactional boundary, which matters for the active KVKK-HIGH-007 consent-reconciliation work.
- **Negative consequences / operational cost.** The 9 X-severity violations and 35 cycles are not fixed by this ADR — they remain technical debt to be addressed via ADR-015 contracts, not via extraction. `routes/whatsapp.ts` (3999 lines) and `routes/platformAdmin.ts` (1201 lines/40 routes) remain hotspots.
- **Security impact.** None directly; tenant/security controls are unaffected by this decision (see ADR-002).
- **Tenant-isolation impact.** None directly — a monolith with a shared `PrismaClient` is the current tenant model regardless of this ADR (see ADR-002/003).
- **KVKK/data-handling impact.** Keeps Privacy/Consent domain logic co-located, which is favorable for the active KVKK-HIGH-007 reconciliation work's transactional needs; this ADR does not touch or authorize any change to that work.
- **Backward-compatibility requirement.** N/A — no code change.
- **Migration approach.** N/A.
- **Rollback/reversal approach.** Revert this documentation commit; no runtime state to roll back.
- **Dependencies.** F0-003, F0-004 (both satisfied, `MERGED`).
- **Validation/PoC requirement.** None for acceptance of the direction; ADR-015 contract implementation is validated separately at F2 entry.
- **Measurable reevaluation trigger.** Sustained, evidenced inability to ship a bounded module change without touching ≥3 other domains' internals, *after* ADR-015 public contracts exist for the domains involved (i.e., contracts existing and still being bypassed, not merely a high edge count today).
- **Status:** ACCEPTED. **Date:** 2026-07-19. **Supersedes:** none. **Superseded by:** none.

### 5.2 ADR-002 — Tenant isolation layers (accepted with conditions)

- **Context.** `MODULE_MAP.md` classifies "Tenant Security and Scope" as `core platform`/`regulatory-tenant-critical`/`clearly bounded`, backed by `middleware/clinicAccess.ts`, `utils/clinicScope.ts`, `utils/tenantGuard.ts`. Compliance evidence (`docs/compliance/54§3`, `56§9`) shows 40+ call sites using `validateAndGetScope`/`validateAndGetClinicIdScope` rather than reading `req.user.clinicId` directly. No RLS, no Prisma tenant extension, and no PgBouncer-confirmed presence exist in the repository today (`PRODUCTION_TOPOLOGY.md` open item; `RISK_REGISTER.md` R-001 `OPEN`/`UNVERIFIED`).
- **Decision.** Application-level tenant scoping (the existing `clinicScope`/`clinicAccess`/`tenantGuard` pattern) is the current binding baseline and **remains mandatory even after any future RLS or Prisma-guard layer is added** — RLS is additive defense-in-depth, not a replacement. Whether and how to add the RLS/Prisma-guard layer is not decided by this ADR; that decision requires the F0-009 PoC (tracked separately as ADR-004/ADR-005, both `NEEDS POC`).
- **Scope.** All tenant-scoped Prisma models and API routes.
- **Alternatives considered.** (a) Defer scoping-mandatory decision until RLS PoC completes — rejected: the application layer is the *only* enforced isolation control today; leaving it non-binding pending a PoC that is itself frozen would leave tenant isolation formally undecided indefinitely. (b) Accept RLS as decided now, ahead of PoC — rejected: no PoC evidence exists; violates the task's explicit "RLS implementation requires dedicated PoC" rule and the F0-007 freeze.
- **Reasons alternatives were rejected.** (a) creates an unacceptable documentation gap for a regulatory/tenant-critical control; (b) has no evidence and is expressly frozen.
- **Positive consequences.** Makes explicit, for the first time, that no future RLS/Prisma-extension work is permitted to *replace* app-level scope checks — closing a risk this review identified while reading `DEPENDENCY_MAP.md` (0 net-new evidence of any code path that bypasses `clinicScope`, but also 0 evidence of a second enforcement layer).
- **Negative consequences / operational cost.** None — no implementation is authorized or changed.
- **Security impact.** Formalizes the current single point of enforcement; does not add a second layer yet, so a bug in `clinicScope.ts`/`clinicAccess.ts` remains a single point of failure until F5.
- **Tenant-isolation impact.** Direct — this is the tenant-isolation ADR.
- **KVKK/data-handling impact.** Tenant scoping is a precondition for KVKK data-subject-rights correctness (patients must not be visible cross-clinic); this ADR does not change that behavior, only formalizes it as binding.
- **Backward-compatibility requirement.** N/A — no code change.
- **Migration approach.** N/A.
- **Rollback/reversal approach.** Revert this documentation commit.
- **Dependencies.** F0-007 (`MERGED`, freeze boundary defined).
- **Validation/PoC requirement.** RLS/PgBouncer layer: F0-009 PoC required before any further ADR-004/ADR-005 decision.
- **Measurable reevaluation trigger.** F0-009 PoC produces measured RLS performance/connection-budget data under realistic tenant-count concurrency.
- **Status:** ACCEPTED WITH CONDITIONS. **Date:** 2026-07-19. **Supersedes:** none. **Superseded by:** none (decomposes forward into ADR-004/ADR-005 for the still-undecided layer).

### 5.3 ADR-003 — Shared vs dedicated tenant databases (accepted with conditions)

- **Context.** No per-tenant database or schema-per-tenant code exists anywhere in the repository (`MODULE_MAP.md`, `DEPENDENCY_MAP.md` — single shared `PrismaClient`, no evidence otherwise). `RISK_REGISTER.md` R-023 (`OPEN`, large-tenant-overload) is the only evidenced pressure toward a dedicated model, and it is `UNVERIFIED`/hypothetical (no named customer, no measured overload).
- **Decision.** Shared database, shared schema remains the default and only implemented tenant model. Schema-per-tenant is rejected as a default strategy (formalizing tracker §10's existing directional rejection). Dedicated tenant infrastructure for individual large/enterprise customers is a legitimate future capability but is **trigger-based, not universal** — no trigger is currently met.
- **Scope.** All tenant data storage.
- **Alternatives considered.** (a) Schema-per-tenant — rejected: operational complexity (per-tenant migrations, connection multiplexing) is unjustified at current scale and conflicts with the task's explicit constraint against it as a default. (b) Database-per-tenant as universal default — rejected on the same grounds, explicitly disallowed by task decision principles. (c) Leave the question fully open/undecided — rejected: the negative decisions (a)/(b) are well-supported by both evidence and task constraints and are worth locking in now to prevent future drift.
- **Reasons alternatives were rejected.** No evidence justifies the operational cost of either universal per-tenant model at current scale (37 domains, single shared client, no measured noisy-neighbor incident).
- **Positive consequences.** Prevents premature architectural complexity; keeps the dedicated-tenant door open for a real enterprise trigger without committing engineering effort now.
- **Negative consequences / operational cost.** None from accepting this now; the cost of *not* having dedicated infrastructure ready is deferred until a real trigger appears.
- **Security impact.** None directly.
- **Tenant-isolation impact.** Confirms shared-schema isolation continues to rely entirely on ADR-002's application-level scoping (and, later, RLS) — there is no database-level tenant boundary today.
- **KVKK/data-handling impact.** None directly; a future dedicated-tenant path could be relevant to KVKK data-residency requirements for a specific enterprise customer, but no such requirement is evidenced today.
- **Backward-compatibility requirement.** N/A.
- **Migration approach.** N/A — no migration authorized.
- **Rollback/reversal approach.** Revert this documentation commit.
- **Dependencies.** ADR-002.
- **Validation/PoC requirement.** None to accept this direction. A concrete dedicated-tenant operational model requires F5/F11 design work once triggered.
- **Measurable reevaluation trigger.** A named enterprise pilot customer's contractual/compliance requirement that shared-schema cannot satisfy, or a measured (not hypothetical) noisy-neighbor incident tied to R-022/R-023.
- **Status:** ACCEPTED WITH CONDITIONS. **Date:** 2026-07-19.

### 5.4 ADR-008 — Object-storage abstraction (accepted with conditions)

- **Context.** `services/fileStorage.ts` already implements a provider-abstracted interface (local disk, or S3-compatible when `S3_BUCKET` is set). `buildStorageKey(clinicId, originalName)` and the newer `buildExportStorageKey(clinicId, exportId)` (`docs/compliance/53§4.1`, `54§6`) already produce tenant-scoped, non-identifying keys (e.g. `exports/<clinicId>/<uuid>.zip`), and `isSafeStorageKey()` rejects path traversal. Production, however, is confirmed `LOCAL_VPS_STORAGE` with no S3 in use (`RISK_REGISTER.md` R-029, `HIGH`).
- **Decision.** The existing provider-agnostic storage abstraction and tenant-scoped key convention is affirmed as the pattern all future storage work builds on. This ADR does **not** decide a storage provider, does not authorize a storage-key migration (explicitly frozen — `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 8), and does not resolve R-029.
- **Scope.** `services/fileStorage.ts` and its call sites; attachment and imaging storage.
- **Alternatives considered.** (a) Design a new abstraction from scratch — rejected: one already exists and matches the shape this ADR would otherwise mandate. (b) Accept a specific provider now — rejected: no vendor/data-residency decision has been made (see below).
- **Reasons alternatives were rejected.** Redesigning working, evidenced code without a stated defect would be premature implementation detail this review must avoid.
- **Positive consequences.** Confirms F0-011 can design the migration path on top of a stable abstraction rather than also having to design the abstraction.
- **Negative consequences / operational cost.** R-029 (local-VPS-only storage, `HIGH`) remains open and unresolved; this ADR does not authorize fixing it.
- **Security impact.** None new; `isSafeStorageKey()` path-traversal protection is unchanged.
- **Tenant-isolation impact.** Confirms storage keys are already tenant-scoped by construction — a positive existing property, not a new decision.
- **KVKK/data-handling impact.** Data-residency (where S3-compatible storage physically resides) is unresolved and is flagged below as needing an external decision.
- **Backward-compatibility requirement.** Any future migration must preserve `isSafeStorageKey()` validation and the existing key shape or provide a documented, reversible transition (expand-migrate-contract, per task decision principles).
- **Migration approach.** Not decided by this ADR — F0-011's job.
- **Rollback/reversal approach.** Revert this documentation commit; no code touched.
- **Dependencies.** F0-011 (dependency-ready per tracker §13, but starting it requires a separate user decision).
- **Validation/PoC requirement.** Provider selection needs a data-residency/vendor decision (KVKK-relevant, per `docs/compliance/53§16` open items) — **NEEDS EXTERNAL VENDOR/LEGAL DECISION**, not a PoC.
- **Measurable reevaluation trigger.** F0-011 design document exists, is reviewed, and a provider/data-residency decision is made.
- **Status:** ACCEPTED WITH CONDITIONS. **Date:** 2026-07-19.

### 5.5 ADR-009, ADR-010, ADR-011 — Gateway/adapter/PACS principles (accepted with conditions, summarized)

All three share a pattern: **the underlying capability is confirmed absent** (`MODULE_MAP.md` "Planned / Not Implemented": AI Platform/Gateway, Integration Platform, and — separately, imaging exists but no PACS component does), so there is nothing to freeze, but a **negative constraint** on any future work in that area is mature enough to accept now:

- **ADR-009 (AI Gateway):** no AI usage may expand beyond the current WhatsApp-embedded scope without passing through a governed gateway (routing/metering/PII-PHI minimization). Gateway architecture itself: DEFER to F8.
- **ADR-010 (Official integration adapters):** any future official-integration work (Ministry of Health or otherwise) must use adapter-boundary + delivery-ledger discipline, not the bespoke per-channel provider-factory pattern already used ad hoc by WhatsApp/Instagram/SMS. Concrete adapter contract: DEFER to F9, and selection of a first target integration **NEEDS EXTERNAL OPERATIONAL/VENDOR DECISION** (government technical/administrative requirements are outside repository control).
- **ADR-011 (DICOM/PACS):** PACS is not built from scratch. Component selection (Orthanc/DICOMweb candidate) NEEDS POC, and clinical/legal validation is explicitly a separate gate (`RELEASE_GATES.md` G4) — **NEEDS EXTERNAL LEGAL/CLINICAL DECISION**.

Security/tenant/KVKK impact for all three: none today (no implementation exists or is authorized); each principle exists specifically to constrain *future* implementation's KVKK/security posture. Rollback: revert documentation. Dependencies/triggers: per matrix (§4). Status: ACCEPTED WITH CONDITIONS, 2026-07-19, for the stated negative-constraint scope only.

### 5.6 ADR-014 — Feature flags, entitlements, and permissions (accepted)

- **Context.** `MODULE_MAP.md` finds no dedicated entitlement service; `Plan.features` (JSON) and ad hoc per-domain flags (`ClinicSmsSettings.addonEnabled`, `PlatformSetting`) are today's de-facto mechanism. `DEPENDENCY_MAP.md` §9 rules 7-8 (already part of the *target* dependency principles, unchanged since F0-001) already state entitlements must be backend-enforced and that disabled-module workers/jobs must not keep running.
- **Decision.** Feature/release flags, commercial entitlements, and user permissions are three distinct control planes and must not be conflated. Security, tenant isolation, core KVKK evidence, audit, encryption, backup, and privacy controls can never be gated behind a commercial entitlement. All entitlement checks must be enforced server-side (route/service/job layers), never frontend-only.
- **Scope.** All three control planes across the backend.
- **Alternatives considered.** Deferring this decision until a unified entitlement service is designed — rejected: the *principle* (three distinct planes; server-side enforcement; security/KVKK controls exempt from commercial gating) does not require a service design to be true or binding, and `ClinicSmsSettings.addonEnabled` already demonstrates the pattern works today without one.
- **Reasons alternatives were rejected.** No repository evidence contradicts the principle; deferring it would leave a known-good existing pattern (`ClinicSmsSettings.addonEnabled`) without a governing rule to extend consistently.
- **Positive consequences.** Gives F2 (unified entitlement-service design) a settled starting principle rather than an open question.
- **Negative consequences / operational cost.** None — no code change.
- **Security impact.** Directly protective: explicitly forbids ever gating security/audit/privacy controls behind a commercial flag.
- **Tenant-isolation impact.** None directly.
- **KVKK/data-handling impact.** Directly protective: KVKK evidence/audit/privacy controls are explicitly exempted from entitlement gating.
- **Backward-compatibility requirement.** N/A.
- **Migration approach.** N/A.
- **Rollback/reversal approach.** Revert this documentation commit.
- **Dependencies.** ADR-001.
- **Validation/PoC requirement.** None for the principle; a unified service design is validated separately at F2 entry.
- **Measurable reevaluation trigger.** A concrete entitlement-service design proposal is reviewed against this ADR at F2 entry.
- **Status:** ACCEPTED. **Date:** 2026-07-19.

### 5.7 ADR-015 — Module boundaries and public contracts (accepted with conditions)

- **Context.** `DEPENDENCY_MAP.md` §10.3 provides, for the first time, 15 evidence-based contract candidates and identifies CC-04 (Appointment booking/cancellation command) as highest priority — it alone would close 4 of the 9 X-severity boundary violations.
- **Decision.** Cross-domain reads/writes must go through an accepted public contract, domain event, or explicit application-service contract. Direct cross-domain infrastructure/repository imports are prohibited **except as a documented transitional exception** — the 9 existing X-severity `WHA`/`IGM`→`PAT`/`APT` violations are recorded as exactly such a transitional exception (pre-existing, evidenced, not newly introduced), not as an immediate violation requiring emergency remediation under this ADR.
- **Scope.** All cross-domain data access.
- **Alternatives considered.** Treating the 9 existing violations as an immediate breach requiring urgent fix — rejected: that would be implementation work, which this documentation-only task and the current F0-007 freeze do not authorize; it would also contradict the task's own instruction not to introduce urgency-driven scope creep.
- **Reasons alternatives were rejected.** No authorization exists to fix code in this task; freezing the *rule* now while explicitly grandfathering the known exceptions is the only option consistent with task scope.
- **Positive consequences.** Gives F2 a concrete, evidence-ranked starting contract (CC-04) instead of an abstract mandate.
- **Negative consequences / operational cost.** The 9 violations remain unresolved technical debt; this ADR does not fix them.
- **Security impact.** None directly; contract discipline is a precondition for later enforcing tenant/permission checks consistently at contract boundaries.
- **Tenant-isolation impact.** None directly today; future contracts should carry tenant context explicitly (per `DEPENDENCY_MAP.md` §4).
- **KVKK/data-handling impact.** The `PRV↔WHA` cycle (Privacy's anonymization flow writing directly into WhatsApp tables while WhatsApp calls Privacy's consent-gate service) is the most KVKK-relevant of the 35 documented cycles (`DEPENDENCY_MAP.md` §10.3) and is a priority candidate for a future Privacy/Consent public contract — not resolved by this ADR.
- **Backward-compatibility requirement.** Any contract introduced later must not break existing callers without a versioned, additive rollout.
- **Migration approach.** Not decided by this ADR — F2's job; expand-migrate-contract per task decision principles.
- **Rollback/reversal approach.** Revert this documentation commit.
- **Dependencies.** F0-003, F0-004, ADR-001.
- **Validation/PoC requirement.** A pilot contract (recommended: CC-04) implemented and reviewed at F2 entry.
- **Measurable reevaluation trigger.** CC-04 (or an equivalent pilot contract) is implemented and either resolves or fails to resolve its targeted violations.
- **Status:** ACCEPTED WITH CONDITIONS. **Date:** 2026-07-19.

### 5.8 ADR-016 — Container and orchestration strategy (accepted with conditions)

- **Context.** F0-006 evidence (`PRODUCTION_TOPOLOGY.md`) confirms bare-VPS + PM2 + host Nginx in production; `docs/35-docker-deploy-runbook.md` is confirmed stale/aspirational (references a topology not in production use — `RISK_REGISTER.md` R-039).
- **Decision.** No Kubernetes adoption without an independently evidenced trigger: measured independent-service count, multi-node autoscaling need, and operational capacity to run it — none of which exist today. Current bare-VPS+PM2 topology is retained as-is; this ADR does not mandate containerization either.
- **Scope.** Deployment/orchestration topology.
- **Alternatives considered.** Adopting Docker Compose now (matching the stale runbook) — rejected: no evidence the current single-VPS topology is capacity-constrained; would add operational complexity (image builds, registry, compose orchestration) without a measured need.
- **Reasons alternatives were rejected.** No trigger evidence exists for either Docker Compose or Kubernetes.
- **Positive consequences.** Avoids adopting infrastructure complexity ahead of evidenced need; flags the stale runbook so a future documentation task can reconcile or deprecate it.
- **Negative consequences / operational cost.** R-033 (no deploy automation for `noramedi-worker`) and R-040 (config-source ambiguity) remain open; this ADR does not resolve them (F3/operational task, not this review).
- **Security impact.** None directly.
- **Tenant-isolation impact.** None directly.
- **KVKK/data-handling impact.** None directly.
- **Backward-compatibility requirement.** N/A.
- **Migration approach.** Not decided — F7's job once triggered.
- **Rollback/reversal approach.** Revert this documentation commit.
- **Dependencies.** ADR-012.
- **Validation/PoC requirement.** None to accept the negative constraint; a concrete container-evolution plan requires F7 design work once triggered.
- **Measurable reevaluation trigger.** Independent service count, multi-node autoscaling need, and operational capacity are all measured and evidenced (per task's own trigger rule).
- **Status:** ACCEPTED WITH CONDITIONS. **Date:** 2026-07-19.

## 6. Conflicts and contradictions identified and resolved

1. **F0-007 status self-reference lag** (§0 above) — corrected in this task's master-tracker/phase-doc edits, following the exact precedent F0-003 through F0-007 each set for their predecessor.
2. **`docs/compliance/56` staleness re: PR #169** — the Explore-agent sourcing pass for this review found `docs/compliance/56-kvkk-communication-preference-and-consent-management.md` still narrates PR #169 as unmerged ("this branch's base... not merged"), even though `git log`/`gh pr view` (via F0-002/F0-007 evidence, reused here) confirm PR #169 merged `2026-07-18T22:05:26Z` and deployed. This is the same staleness `RISK_REGISTER.md` R-042 already recorded and explicitly scoped as out of this program's `docs/program/`-only editing authority for that task. This review does not edit `docs/compliance/` (out of scope, same as R-042's finding) but notes the staleness affected only *sourcing context* here (enforcement-flag default value, channel/purpose taxonomy), not any ADR's classification.
3. **No conflict found between any of the 17 ADR reviewed-statuses and any already-`MERGED` F0-002…F0-007 output.** Every `ACCEPT NOW`/`ACCEPT WITH CONDITIONS` classification above is a direct restatement or narrow extension of evidence already gathered by F0-002 through F0-006, or of `NORAMEDI_MASTER_TRACKER.md` §9's pre-existing `PROGRAM DIRECTION` items — this review's contribution is formalizing them into ADR status with evidence citations, not introducing new technical claims.
4. **No conflict found with the active KVKK-HIGH-007 continuation (PR #175).** Every ADR touching an area the freeze boundary (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2) marks `MUTABLE` (rows 1-11, 20) is classified `NEEDS POC`/`DEFER` in this review, or — where `ACCEPT WITH CONDITIONS` (ADR-002) — is scoped to affirm only the pre-existing, `STABLE` (freeze boundary row 15) application-scoping baseline, not to touch the mutable schema/consent-service rows. PR #175's content remains uninspected by this task, consistent with the freeze boundary's own rules.

## 7. Classification summary

| Classification | Count | ADRs |
|---|---|---|
| ACCEPT NOW | 2 | ADR-001, ADR-014 |
| ACCEPT WITH CONDITIONS | 8 | ADR-002, ADR-003, ADR-008, ADR-009, ADR-010, ADR-011, ADR-015, ADR-016 |
| DEFER | 5 | ADR-006 (outbox pattern itself), ADR-007, ADR-012, ADR-013, ADR-017 |
| NEEDS POC | 2 | ADR-004, ADR-005 |
| SPLIT | 0 | (ADR-002 decomposition into ADR-004/005 is recorded as a cross-reference, not a formal split — both already exist as separate ADRs) |
| SUPERSEDED / REJECT | 0 | (specific alternatives rejected *within* several ADRs' "alternatives considered" — no whole ADR entry rejected) |
| NEEDS EXTERNAL DECISION (secondary tag) | 4 | ADR-008 (vendor/data-residency), ADR-010 (government/operational), ADR-011 (legal/clinical), ADR-013 (legal — retention periods) |

10 of 17 ADRs reach some form of acceptance in this task; 7 remain DEFER/NEEDS POC pending named future evidence-gathering or PoC tasks. No ADR is rejected outright, superseded, or split — none of the 17 as scoped conflict with each other or with repository evidence once appropriately conditioned.

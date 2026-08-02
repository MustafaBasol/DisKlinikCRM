# F2-PREP-003 — Feature Intake and ClickUp-to-Domain Mapping Framework

**Phase:** F2 PREPARATION — Modular Monolith Boundary Definition
**Type:** Backlog classification + new evidence files only (no application code, no tracker/index/phase file, no ClickUp mutation)
**Status:** `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW` (maximum status per task instruction — never claim more)
**Authorized in parallel with:** F1-003-B2, PR #268 (`feature/f1-003-p3-layered-ci-workflows`, OPEN), and the other F2-PREP discovery tasks (F2-PREP-001 Domain Ownership Inventory, F2-PREP-002 Cross-Domain Dependency Map, F2-PREP-004 Modularization Sequence). At this task's start, `git worktree list` showed all three sibling worktrees sitting at `origin/main` tip with zero commits ahead of it — a **start-time observation only**, not a current program-status claim about those tasks; no sibling worktree content was read into or copied by this document at any point, then or now.

> **R1 reconciliation note (this revision):** sanitizes author-machine filesystem paths from both evidence files; reconciles wording against externally supplied F2-PREP-001 delivery facts (now PR #276, `AGENT_COMPLETED`/`PR_OPENED_AWAITING_REVIEW`, not merged, proposing a candidate 38-domain inventory); corrects sibling-task wording to a start-time observation; corrects the status/next-task sections; and tightens the ClickUp scope-boundary language. No repository content was re-read for this revision beyond the externally supplied PR #276 metadata named in the R1 task instructions themselves — no F2-PREP-001 worktree or branch content was read or copied.

### Status (R1)

| Item | Status |
|---|---|
| Feature intake framework | completed |
| Repository-derived backlog classification | completed |
| ClickUp-derived backlog import | pending external import |
| Taxonomy reconciliation | pending reviewed F2-PREP-001 result |
| Merged | no |
| Deployed | no |
| Production verified | no |

Machine-readable companion: [F2-PREP-003_feature_intake_domain_mapping.json](F2-PREP-003_feature_intake_domain_mapping.json).

---

## 1. Baseline

| Field | Value |
|---|---|
| Baseline branch | `origin/main` |
| Baseline SHA | `70b1690c1a656c95cead7b42812cc9ae6447bfb7` (exact tip of `origin/main` at task start — merge commit for PR #275, `feature/external-calendar-outbound-sync-phase2`) |
| Worktree | fresh isolated worktree; local filesystem path intentionally omitted |
| Branch | `docs/f2-prep-003-feature-intake-domain-mapping` |
| Intervening commits between baseline and HEAD | 0 (fresh worktree cut directly from `origin/main`) |

`git worktree list` at task start confirmed three sibling F2-PREP worktrees already existed as isolated worktrees (task IDs F2-PREP-001, F2-PREP-002, F2-PREP-004), all sitting at `origin/main` HEAD `70b1690` with zero commits ahead of it. **This was a start-time observation only, not a current program-status claim** — it describes the state at the moment this task began, not the state of those tasks now or at any later point. This task did not enter, read the working tree of, or depend on the content of any of those worktrees beyond this `git worktree list` observation, then or in this revision. See §4.1 below for the externally supplied, current F2-PREP-001 delivery status (PR #276).

---

## 2. Repository sources read

| Source | What it supplied |
|---|---|
| `docs/program/NORAMEDI_MASTER_TRACKER.md` (table of contents + targeted sections) | Confirmed no `F2-PREP` entries exist yet in the tracker — this wave of parallel discovery tasks is not yet reflected there. |
| `docs/program/CURRENT_PHASE.md` | Confirmed no `F2-PREP` mentions; F1 is functionally complete pending PR #268 review. |
| `docs/program/phases/F2_MODULAR_BOUNDARIES.md` | F2's objective, entry/exit conditions, allowed/prohibited work, and its own "Initial task backlog" categories — used directly as repository-derived backlog items F2P3-007…012. |
| `docs/program/ARCHITECTURE_DECISIONS.md` | All 17 ADR statuses — used to classify `BLOCKED_BY_ADR` items and to source the ADR-015 pilot contract candidate (CC-04). |
| `docs/program/RISK_REGISTER.md` | R-025 (frontend-only entitlement enforcement), R-026 (over-modularization), R-047 (possible duplicate audit concept) — used in the intake checklist and stop conditions. |
| `docs/program/MODULE_MAP.md` | The 37-domain, repository-evidence-verified domain taxonomy (F0-003) — reused verbatim as this task's `proposed_owning_domain` vocabulary; also its "Planned / Not Implemented" section, source for the 4 planned-domain epics. |
| `docs/program/DEPENDENCY_MAP.md` | The F0-004 dependency matrix, the 9 X-severity WhatsApp/Instagram→Patient/Appointment boundary violations, and the CC-04 contract candidate used for the pilot backlog item. |
| `docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` | §3's 16 default-freeze rules — used to classify `BLOCKED_BY_KVKK_FREEZE` and to write stop condition #4. |
| `docs/program/evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md` / `F0-003_module_ownership_inventory.json` | Prisma-model-level ownership detail backing the intake checklist's "data owner" item. |
| `docs/09-development-roadmap.md` | Original MVP roadmap; source of the one legacy "Optional" backlog item (n8n webhook integration) whose current implementation status this task did not re-verify. |
| `server/src/` top-level listing | Confirmed no `server/src/modules` or `server/src/platform` directory exists yet — F2 physical restructuring has not begun. |
| `gh issue list --state all --limit 100` | 6 total issues in the repository — the entire repository-derived, GitHub-issue-backed backlog (§4 below). |
| `gh pr list --state open --limit 50` | 5 open PRs, including PR #268 (confirms the task brief's own parallel-authorization reference) and PR #270 (the current session's own in-flight treatment-proposal-PDF work). |

---

## 3. ClickUp access status

**Checked via:** `ToolSearch` query `"clickup"` against this session's deferred/MCP tool registry — **zero matching tools returned.** No ClickUp MCP server is connected in this execution environment.

**Consequence, per the task's own fallback rule:** no ClickUp task ID, title, or status was invented. `clickup_derived_backlog` in the JSON companion is an empty array, explicitly marked `PENDING_EXTERNAL_IMPORT`.

**Directly relevant repository finding:** GitHub Issue **#236 — "F0-ORCH-001 · Secure ClickUp → Claude Code → AI Review Orchestration Bootstrap"** (labels: `architecture`, `automation`, `security`) is **OPEN**, with no linked merged PR. This is the actual program task that would build the secure ClickUp integration this task was asked to use — its open status is independent, repository-native confirmation that the integration does not exist yet, consistent with (not merely coincident with) this session's own empty `ToolSearch` result. It is recorded as backlog item **F2P3-006** below, not silently dropped.

**ClickUp claim boundary (explicit, per this revision's own instruction to state this clearly):**

- No ClickUp task was read or modified by this task, in the original pass or in this revision.
- The ClickUp-derived count in the JSON companion is exactly **0** (`clickup_derived_backlog: []`).
- This framework (the intake checklist, stop conditions, readiness values, and JSON schema) is **ready to receive a ClickUp import** once F2P3-006 (or an equivalent authorization) lands — it defines the target shape, it does not perform the import.
- The **17-item repository-derived backlog in §5 is not a substitute for the full ClickUp backlog.** It is a repository-evidence-only sample (GitHub issues + phase-document backlog categories + planned-domain epics + one legacy roadmap item).
- **The 17 items must not be presented, cited, or reported anywhere as the full NoraMedi feature backlog total.** The true backlog total is unknown until a ClickUp import occurs; this document does not estimate it.

---

## 4. Classification framework

### 4.1 Domain taxonomy used

**A. Historical task-start basis.** At the time this task originally ran, the parallel F2-PREP-001 (Domain Ownership Inventory) sibling task had not delivered any output (its worktree was observed at `origin/main` tip with zero commits — see §1). This task therefore used the existing 37-domain, repository-evidence-verified taxonomy from `MODULE_MAP.md`/`DEPENDENCY_MAP.md` (F0-003/F0-004) as its domain vocabulary. Full list with codes is in the JSON companion's `domain_taxonomy_reference`.

**B. Current reconciliation note (this revision, R1).** F2-PREP-001 has since delivered: it is now **PR #276**, status `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`, **not merged**. Per the externally supplied delivery facts for this revision, PR #276 proposes a **38-domain inventory** — one candidate domain beyond the 37 used here, **External Calendar Integration** — plus deltas to the existing Privacy, Platform Administration, and Storage domain entries. This revision explicitly does **not** treat the 38-domain inventory as accepted or merged, and does **not** silently reassign any backlog item's `proposed_owning_domain` on that basis:

- Every `proposed_owning_domain` value in §5 below **remains valid against the accepted 37-domain baseline** (F0-003/F0-004, still the only externally-accepted taxonomy as of this revision).
- **External Calendar Integration is a candidate taxonomy delta, not yet authoritative** — no backlog item in §5 references it, since doing so would assume an outcome PR #276 has not yet been given.
- Every `proposed_owning_domain` value **must be rechecked during F2-PREP-005** against the reviewed/merged F2-PREP-001 result (the 38-domain inventory, or whatever form it takes after review) — this is an open dependency, not a closed one.
- No backlog item was silently reassigned in this revision without repository evidence; this revision changed wording and path sanitization only, not any `proposed_owning_domain`, `readiness`, `suggested_implementation_wave`, or `classification_confidence` field value in the JSON companion.

### 4.2 Readiness values (definitions)

| Value | Definition |
|---|---|
| `SAFE_NOW_IN_EXISTING_BOUNDARY` | Fits inside one already-owned domain; no new cross-domain contract required; not KVKK-frozen. |
| `SAFE_AFTER_CONTRACT` | Cross-domain, but the required contract is already identified (named by DEPENDENCY_MAP.md or ADR-015) and only needs implementing/consuming. |
| `BLOCKED_BY_F1` | Depends on unmerged F1 infrastructure. |
| `BLOCKED_BY_F2_BOUNDARY` | Blocked on another item in *this same backlog* (contract format, boundary lint, or the pilot precedent) landing first. |
| `BLOCKED_BY_KVKK_FREEZE` | Falls inside `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3's default freeze rules; needs KVKK baseline stabilization (§5 condition 5 — unsatisfied as of this task). |
| `BLOCKED_BY_ADR` | Gated on an ADR still `NEEDS_POC`/`DEFERRED`/`UNDER_REVIEW`. |
| `DISCOVERY_REQUIRED` | Insufficient repository evidence to classify further; needs its own discovery/design task (design-only work may still proceed in parallel). |

### 4.3 Feature intake checklist (15 items) and stop conditions (7)

Reproduced with concrete, repository-grounded instructions (not just labels) in the JSON companion's `feature_intake_checklist`/`stop_conditions` arrays. Summary:

| # | Checklist item | Concrete anchor |
|---|---|---|
| 1 | Owning domain | One of the 37 `MODULE_MAP.md` domain codes, or `OUT_OF_DOMAIN_TAXONOMY` routed to F2-PREP-001 |
| 2 | Data owner | Prisma model ownership per `F0-003_MODULE_OWNERSHIP_EVIDENCE.md` §3 |
| 3 | Tenant scope | Named enforcing helper: `clinicScope.ts` / `tenantGuard.ts` / `clinicAccess.ts` |
| 4 | Public contracts used | Must exist or the item is at best `SAFE_AFTER_CONTRACT` |
| 5 | Prohibited direct access | No cross-domain Prisma writes/reads, no internal-file imports (`DEPENDENCY_MAP.md` §6) |
| 6 | Migrations | Destructive changes require expand-migrate-contract |
| 7 | Audit | `AuditLog`/`ActivityLog`, or the separate consent-audit path — never a third mechanism (R-047) |
| 8 | KVKK | Checked against freeze boundary §2/§3 before authorization |
| 9 | Auth/authorization | Existing `utils/roles.ts` pattern only |
| 10 | Queues/jobs | No general-purpose queue exists yet (ADR-006/007 `NEEDS_POC`) — PM2 cron + `JobLock` only |
| 11 | Provider integration | Stays inside its channel's bespoke provider-factory pattern — no shared AI Gateway/Integration Platform exists |
| 12 | Test layer | DB-free vs. disposable-Postgres/MinIO runtime (`scripts/test-runtime/`) |
| 13 | Deployment | Bare-VPS + PM2 (ADR-016) unless independently evidenced otherwise |
| 14 | Rollback | Exact path stated; schema changes need expand-migrate-contract (F0-011-P2 found `_prisma_migrations` does not self-reconcile after a physical rollback) |
| 15 | Production verification | Minimum safe non-activating check per the R-061/KVKK-HIGH-006/008 precedent — never claimed from agent self-testing alone |

| # | Stop condition | Action |
|---|---|---|
| 1 | Unclear domain owner | Halt → route to F2-PREP-001 |
| 2 | Direct access to another domain's private internals | Halt → require a public contract |
| 3 | Unbounded tenant query | Halt → tenant-isolation defect class, fix regardless of priority |
| 4 | Unversioned consent/privacy behavior change | Halt → check KVKK freeze boundary §2/§3 |
| 5 | Provider-specific logic in a core/domain-neutral module | Halt → keep inside the channel's own provider-factory pattern |
| 6 | No rollback path | Halt → checklist item 14 must be answered first |
| 7 | Schema destructive change without expand-migrate-contract | Halt → prohibited program-wide (ADR-013, F0-011-P2) |

### 4.4 Delivery waves

| Wave | Definition | Count |
|---|---|---|
| 0 | Small isolated fixes/UI work, no new contract | 5 |
| 1 | Fits existing stable domain boundary | 0 |
| 2 | Requires exactly one new public contract | 5 |
| 3 | Cross-domain, multiple contracts | 3 |
| 4 | High-risk AI/imaging/official-integration/privacy-or-security-automation/storage | 4 |

No dates are assigned to any wave or item — none exist in repository evidence, and the task explicitly prohibits inventing them.

---

## 5. Backlog map

**17 items total, all repository-derived, 0 ClickUp-derived.** Full detail (all ~20 fields per item) is in the JSON companion; this table is the compact index. **This is not the full NoraMedi feature backlog** — see the ClickUp claim boundary in §3.

| ID | Title | Domain | Readiness | Wave | Confidence |
|---|---|---|---|---|---|
| F2P3-001 | US-02.2 Treatment proposal PDF (Issue #262, PR #270 DRAFT) | TRC | SAFE_NOW_IN_EXISTING_BOUNDARY | 0 | repository_derived_verified |
| F2P3-002 | US-01.6 Patient 360 reconciliation (Issue #267, PR #269 merged) | PAT | SAFE_NOW_IN_EXISTING_BOUNDARY | 0 | repository_derived_verified |
| F2P3-003 | US-03.3 Calendar drag-drop integrity (Issue #264 CLOSED, PR #266 merged) | APT | SAFE_NOW_IN_EXISTING_BOUNDARY | 0 | repository_derived_verified |
| F2P3-004 | US-03.2 No-show gap closure (Issue #263, PR #265 merged) | APT | SAFE_NOW_IN_EXISTING_BOUNDARY | 0 | repository_derived_verified |
| F2P3-005 | Windows Bridge .NET test flakiness (Issue #161) | BRG | SAFE_NOW_IN_EXISTING_BOUNDARY | 0 | repository_derived_verified |
| F2P3-006 | F0-ORCH-001 ClickUp orchestration bootstrap (Issue #236) | OUT_OF_DOMAIN_TAXONOMY | DISCOVERY_REQUIRED | 4 | unverified_ownership |
| F2P3-007 | Public contract format and location standard | OUT_OF_DOMAIN_TAXONOMY | DISCOVERY_REQUIRED | 2 | repository_derived_verified |
| F2P3-008 | Module boundary lint/CI enforcement | OUT_OF_DOMAIN_TAXONOMY | BLOCKED_BY_F2_BOUNDARY | 2 | repository_derived_verified |
| F2P3-009 | Entitlement enforcement in backend/service/job layer | OUT_OF_DOMAIN_TAXONOMY | DISCOVERY_REQUIRED | 2 | repository_derived_verified |
| F2P3-010 | Disabled-module worker/job stop mechanism | OUT_OF_DOMAIN_TAXONOMY | BLOCKED_BY_KVKK_FREEZE | 3 | inferred |
| F2P3-011 | Pilot: CC-04 Appointment booking/cancellation command | APT | SAFE_AFTER_CONTRACT | 2 | repository_derived_verified |
| F2P3-012 | Phased module migration plan | OUT_OF_DOMAIN_TAXONOMY | BLOCKED_BY_F2_BOUNDARY | 3 | repository_derived_verified |
| F2P3-013 | AI Platform / AI Gateway build-out | PAI | BLOCKED_BY_ADR | 4 | repository_derived_verified |
| F2P3-014 | Integration Platform / Official Adapters | PIG | BLOCKED_BY_ADR | 4 | repository_derived_verified |
| F2P3-015 | Billing / Subscription Engine | PBL | DISCOVERY_REQUIRED | 3 | inferred |
| F2P3-016 | Campaign/Health Tourism/Invoicing/e-Invoice/Ministry group | PCM | DISCOVERY_REQUIRED | 4 | inferred |
| F2P3-017 | n8n webhook integration (legacy roadmap "Optional" item) | EVQ | DISCOVERY_REQUIRED | 2 | inferred |

### Readiness counts

| Readiness | Count |
|---|---|
| SAFE_NOW_IN_EXISTING_BOUNDARY | 5 |
| SAFE_AFTER_CONTRACT | 1 |
| BLOCKED_BY_F1 | 0 |
| BLOCKED_BY_F2_BOUNDARY | 2 |
| BLOCKED_BY_KVKK_FREEZE | 1 |
| BLOCKED_BY_ADR | 2 |
| DISCOVERY_REQUIRED | 6 |

`BLOCKED_BY_F1 = 0` is deliberate, not an oversight: F1's only remaining item (F1-003-P3, PR #268) is a CI/test-architecture PR in review, and this task's own parallel-authorization line explicitly permits F2-PREP work to proceed alongside it.

### Highest-risk items (Wave 4 / KVKK-or-security-sensitive)

1. **F2P3-006** (ClickUp orchestration bootstrap) — external-credential automation, `HIGH` auth/security sensitivity, does not fit the product domain taxonomy at all.
2. **F2P3-013** (AI Platform/Gateway) — `HIGH` KVKK sensitivity, blocked by ADR-009, confirmed absent.
3. **F2P3-014** (Official Integration Adapters) — `HIGH` KVKK + auth sensitivity, blocked by ADR-010, needs an external Ministry/vendor decision this task cannot make.
4. **F2P3-016** (Campaign/e-Invoice/Ministry group) — mixed sensitivity, includes official/regulatory sub-items; MODULE_MAP.md's own governance note flags a gap between the AGENTS.md MVP charter and what has actually been built for adjacent domains (Imaging/Insurance/Laboratory/Advanced-Finance) — recorded as a fact, not acted on.
5. **F2P3-011** (CC-04 pilot) — not high-risk in the sense of being unsafe to do; the opposite — it is high-*value* because it closes 4 of the 9 already-documented X-severity boundary violations. Listed here because it is the item most likely to be started soon and most likely to be scoped incorrectly (risk of drifting into the KVKK-frozen "message delivery refactor" default rule if not carefully bounded).

---

## 6. Missing decisions (explicitly not made by this task)

- **Domain taxonomy authority**: F2-PREP-001 (Domain Ownership Inventory) has now delivered as **PR #276** (`AGENT_COMPLETED`/`PR_OPENED_AWAITING_REVIEW`, not merged), proposing a candidate 38-domain inventory (adds External Calendar Integration; deltas to Privacy, Platform Administration, Storage). This task's `proposed_owning_domain` values remain valid against the accepted 37-domain baseline and must be rechecked during **F2-PREP-005** against the reviewed/merged F2-PREP-001 result — see §4.1.
- **Contract syntax** (ADR-015 open question): TypeScript interface vs. interface + runtime validation — not decided; blocks F2P3-007/008/009/011/012.
- **Queue/job platform** (ADR-006/007 `NEEDS_POC`): blocks F2P3-010.
- **AI Gateway architecture** (ADR-009, F8) and **Official Integration Platform** (ADR-010, F9): both require external decisions outside this task's authority.
- **KVKK baseline stabilization** (freeze boundary §5 condition 5): still unsatisfied per the last-read freeze-boundary document; gates F2P3-010 and any future consent/audit-adjacent work.
- **Whether Billing/Subscription Engine (F2P3-015) and the Campaign/Invoicing group (F2P3-016) are in scope at all**: no ADR or phase document currently claims ownership of these — a genuine planning gap this task surfaces, not fills.
- **GitHub issue hygiene**: #262, #263, #267 all have merged (or in-review) implementation but remain `OPEN` on GitHub — recorded as a finding; this task did not close or comment on any issue (out of the authorized write scope).
- **n8n webhook integration current status** (F2P3-017): listed on the legacy roadmap but never independently re-verified against current code by this task.

---

## 7. Validation

Per task §7, the following were run against the final worktree state:

```
git status --short
git diff --check
git diff --stat
git diff --name-only
```

Results:

- `git status --short` → two new, untracked files, both under `docs/program/evidence/`; nothing else.
- `git diff --check` → clean (no whitespace errors; new untracked files are not part of `git diff` against a clean baseline, confirmed separately via `git add --intent-to-add` + `git diff --check`, see §8 commit evidence below).
- `git diff --stat` / `git diff --name-only` → confirmed exactly the two files listed below, no other path touched.

**Only two new evidence files exist, nothing else was created or modified:**

- `docs/program/evidence/F2-PREP-003_FEATURE_INTAKE_AND_CLICKUP_DOMAIN_MAPPING.md` (this file)
- `docs/program/evidence/F2-PREP-003_feature_intake_domain_mapping.json`

No tracker/index/phase file was modified. No ClickUp task was modified (none could be — no ClickUp access exists in this environment). No application code was touched. No task was marked complete in any external system.

### Distinguishing repository-derived vs. ClickUp-derived vs. inferred vs. unverified ownership

| Category | Count | Where |
|---|---|---|
| Repository-derived backlog | 17 / 17 | all of §5 |
| ClickUp-derived backlog | 0 / 17 | `clickup_derived_backlog: []` in JSON, explicitly `PENDING_EXTERNAL_IMPORT` |
| `classification_confidence: repository_derived_verified` | 12 | facts directly traceable to a cited GitHub issue/PR number or a named repository document |
| `classification_confidence: inferred` | 4 | F2P3-010, F2P3-015, F2P3-016, F2P3-017 — readiness/wave/domain judgment calls made without a directly-citable repository statement |
| `classification_confidence: unverified_ownership` | 1 | F2P3-006 — does not fit the 37-domain taxonomy at all |

Counts were computed by programmatically reading the `classification_confidence` field on all 17 objects in the JSON companion (`node -e` script over `repository_derived_backlog` + `phase_backlog_derived_from_f2_modular_boundaries_doc` + `planned_domain_epics_derived_from_module_map` + `legacy_roadmap_derived_backlog`), not hand-counted — this matches the JSON's own `summary_counts.by_classification_confidence` field exactly (`repository_derived_verified: 12, inferred: 4, unverified_ownership: 1`).

---

## 8. Files changed

```
docs/program/evidence/F2-PREP-003_FEATURE_INTAKE_AND_CLICKUP_DOMAIN_MAPPING.md   (new)
docs/program/evidence/F2-PREP-003_feature_intake_domain_mapping.json             (new)
```

No other file in the working tree was created, modified, or deleted by this task.

---

## 9. Migration, security, KVKK, and rollback status

- **Migration:** none — this task is documentation-only; zero Prisma schema/migration files touched.
- **Security:** no application/route/middleware/auth code touched; the classification itself flags F2P3-006/013/014 as the highest security-sensitivity items for future intake.
- **KVKK/privacy:** no consent/retention/privacy code or schema touched; this task's own output explicitly defers to `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` rather than reinterpreting it.
- **Rollback:** trivial — revert the single commit adding the two new evidence files; no other state exists to roll back.

---

## 10. Exact next task

**Do not restart F2-PREP-001** — it has already delivered (PR #276, `AGENT_COMPLETED`/`PR_OPENED_AWAITING_REVIEW`).

**Await completion/review of:**

- F2-PREP-001-R1 on PR #276
- F2-PREP-002
- F2-PREP-004

**Then execute F2-PREP-005 — Consolidated Modularization Charter**, which must:

- reconcile the reviewed domain inventory (the 37- vs. 38-domain question, and any further deltas from F2-PREP-001-R1)
- reconcile the cross-domain dependency map (F2-PREP-002's output)
- import, or separately authorize, the real ClickUp backlog reconciliation (this document's framework is ready to receive it; it does not perform it)
- resolve candidate domain ownership (including whether External Calendar Integration is accepted)
- select the pilot module (this document's own evidence names CC-04/Appointment booking-cancellation as the strongest repository-evidenced candidate — F2-PREP-005 makes the final selection, not this task)
- update the authoritative tracker/phase/index documents (explicitly out of this task's own write scope)
- authorize the first modularization implementation task

This task does not authorize the start of any Wave 1+ backlog item, F2-PREP-001 restart, or the F2-PREP-005 charter itself — it only classifies backlog and hands off the open dependencies above.

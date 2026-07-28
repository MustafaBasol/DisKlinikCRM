# F1-001 — Impact-Based Test-Selection Architecture and Test-Scope Classification

Task ID: F1-001 · Phase: F1 — CI and Test Architecture · Status: `AGENT_COMPLETED` (documentation/design only — see [evidence/README.md](../evidence/README.md) for evidence classification, [NORAMEDI_MASTER_TRACKER.md §2.2](../NORAMEDI_MASTER_TRACKER.md) for task-status vocabulary).

**This document is a design.** It defines a mechanism. It does **not** implement it. No CI workflow file, test file, `package.json` script, application/runtime/schema/migration/dependency/deployment/environment file, or KVKK-implementation file is touched by this task. See the companion evidence document, [F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md](../evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md), for the full process record, baseline reconciliation, and validation results.

Companion machine-readable files (normative — this document narrates them, it does not restate every field):
- [evidence/f1-001-test-scope-classification.json](evidence/f1-001-test-scope-classification.json) — taxonomy, risk classification, module-domain inventory, test-scope levels, confidence model.
- [evidence/f1-001-impact-selection-rules.json](evidence/f1-001-impact-selection-rules.json) — escalation rules, fail-safe conditions, full-suite triggers, shadow-mode rollout, metrics, rollback design, 17 example scenarios.

## 0. Evidence basis and a known limitation

This design is built from [`DEPENDENCY_MAP.md`](../DEPENDENCY_MAP.md) (F0-004, 37 domains / 833 edges), [`MODULE_MAP.md`](../MODULE_MAP.md) (F0-003), [`TEST_OWNERSHIP.md`](../TEST_OWNERSHIP.md) (F0-005), and the three F0 evidence JSON files they summarize (`evidence/F0-003_module_ownership_inventory.json`, `evidence/F0-004_dependency_inventory.json`, `evidence/F0-005_test_inventory.json`). Per this task's own required evidence standard, every classification rule below cites one of these sources — no invented or assumed test-to-path mapping.

**CodeGraph was not available in this task's execution environment** (checked via tool discovery before starting; no matching tool found). Per this task's own stop/fallback instruction, no broad replacement scan was performed. Instead, targeted read-only `Grep`/`Read` inspection of `server/src/routes/`, `server/src/services/`, `server/src/utils/`, `server/src/tests/`, and `src/services|pages|components` was used to sanity-check the F0-003/F0-004/F0-005 evidence against the current worktree HEAD (`d03116368e6c55cfa87ff1e35b95c485f7ff240d`) for the representative domains listed in this task's instructions (auth, clinic/tenant scope, patient, appointment, payments, WhatsApp/messaging, privacy/KVKK, storage/attachments, audit, AI, imaging). See §9 of the evidence document for the exact inspection performed.

**Known limitation, disclosed rather than hidden:** `F0-005_test_inventory.json` is pinned to commit `7fcf2f850f151241266f07349c4bf4442c72bbca` (2026-07-19). The current worktree HEAD (2026-07-28) has `server/src/tests/` at 96 files versus the evidence's 72, and the frontend now has 9 test files (including two new `*.vitest.test.tsx` component tests) versus the evidence's 6. Module/domain *boundaries* do not churn this fast — the classification below remains accurate at the domain level — but a literal file-count enumeration is stale. This is recorded as a new risk, **R-072**, in `RISK_REGISTER.md`, and as an explicit prerequisite in §7 below. This design's own confidence model (§6) treats evidence staleness as a first-class input specifically so this gap degrades gracefully (wider scope, not silent narrowing) rather than being ignored.

---

## 1. Given a set of changed files, how are affected modules/domains determined?

A changed file is resolved to one or more `DEPENDENCY_MAP.md` domain codes (IDA, ORG, TSC, PRV, WHA, …) in three steps, in order, stopping at the first that succeeds:

1. **Exact ownership lookup.** Match the file path against `MODULE_MAP.md`'s per-domain `backend{routes,services,middleware,jobs,utils}`/`frontend{pages,components,services}` path lists (mirrored in `evidence/F0-003_module_ownership_inventory.json`'s `domains[].backend`/`domains[].frontend`). This is the **HIGH**-confidence path.
2. **Directory-convention inference.** If the file is new since the F0-003 evidence baseline but sits inside an already-owned directory (e.g. a new file under `server/src/services/whatsapp/`), infer ownership from that directory's existing domain. This is **MEDIUM**-confidence and widens the selected scope by one level (see §6).
3. **No match.** If neither succeeds — a new top-level directory, a path outside every evidence-covered root, generated code, or a dynamically-`require`d module — ownership is **UNKNOWN**. Per §6/§7, `UNKNOWN` always forces the S4 full-suite scope; it is never treated as "no impact."

Once the owning domain(s) are known, **directly affected modules** are read off `DEPENDENCY_MAP.md`'s edge matrix as every domain with an edge *into* the owning domain (fan-in) for a change that alters the owning domain's outputs/contract, or every domain the owning domain has an edge *into* (fan-out) for a change that alters what the owning domain consumes. **Transitively affected modules** are the fan-in/fan-out closure one hop further, bounded to the domains actually enumerated in the 833-edge matrix — this design does not attempt a live, unbounded graph traversal; see §3 for why that bound exists and §8 for how it fails safe.

## 2. How are tests mapped to modules, domains, contracts, and risk classes?

Every test file's `canonicalOwner` (primary domain) and `secondaryDomains[]` (per `TEST_OWNERSHIP.md` §10's own "behavior protected, not folder location" rule and `evidence/F0-005_test_inventory.json`'s schema) are joined against the module-domain resolution in §1. A test is "in scope" for a change if its `canonicalOwner` **or** any `secondaryDomains[]` entry matches an affected module from §1. Contract-level mapping uses `evidence/F0-003_module_ownership_inventory.json`'s `contract_candidates[]` field — a test is contract-relevant if its owning domain is a documented consumer of the same contract the change touches (per `ARCHITECTURE_DECISIONS.md` ADR-015). Risk-class mapping is the `changeClassificationTaxonomy` → `riskClassification` join documented in `evidence/f1-001-test-scope-classification.json` — see §3 there for the measurable criteria (fan-in/fan-out thresholds, high-risk dimension flags), not subjective severity wording.

## 3. What is the minimum safe test set for a change?

The minimum safe set is never "just the one file that changed." It is: (a) every test whose `canonicalOwner` matches the changed file's resolved domain, plus (b) every test whose `secondaryDomains[]` names that domain, plus (c) for any domain flagged CRITICAL in `riskClassification`, the domain's own full owned-test set regardless of which specific file inside it changed. For a LOW-risk, HIGH-confidence, single-domain change (e.g. a frontend presentation-only edit), this reduces to test-scope level **S1**. For anything touching a CRITICAL dimension (§5), the minimum safe set is explicitly the **entire backend and/or frontend suite** (S4) — "minimum" and "narrow" are not synonyms in this design; the minimum safe set is exactly as large as the risk requires, no larger and no smaller, per the taxonomy defaults in `evidence/f1-001-test-scope-classification.json`.

## 4. Which changes always require broader or full-suite execution?

See `evidence/f1-001-impact-selection-rules.json`'s `fullSuiteTriggers` array (15 entries) and `mandatoryEscalationRules` (12 entries, ESC-01…ESC-12), summarized in §5 and §8 below. In short: shared auth/tenant primitives, schema/migrations, raw SQL, public contracts, high-fan-out shared utilities, the test-selection engine's own code, unknown ownership, and multi-domain refactors.

## 5. How are tenant isolation, KVKK, auth, audit, storage, AI, imaging, queues, official integrations, migrations, and public contracts treated as high-risk overrides?

Each is a named `highRiskDimension` (HRD-01…HRD-18) in `evidence/f1-001-test-scope-classification.json`, evidence-cited to a specific `MODULE_MAP.md`/`DEPENDENCY_MAP.md`/`RISK_REGISTER.md` row. Touching **any two** of these dimensions in one change automatically classifies the change **CRITICAL** (composition rule in `riskClassification.CRITICAL.measurableProperties`), which forces test-scope level **S4** (or **S5** for migrations) regardless of how narrow the taxonomy default for the specific file would otherwise be. This is deliberate: a change that is individually "just a route file" (CT-05, S2 default) but also touches tenant scoping (HRD-01) is not a route-file change for scoping purposes — it is a CRITICAL change, full stop. See `exampleScenarios` SC-07 and SC-11 in the rules JSON for two worked examples where two independent rules agree on the same widened scope.

Per this task's own required tenant/security/KVKK impact statement: the tenant-isolation/cross-tenant-negative/permission-matrix test files this program already tracks (`TEST_OWNERSHIP.md`'s "Tenant Security and Scope" and "Identity and Access" domains, 14+4 test files at the evidence baseline) are named explicitly in `moduleDomainInventory` (domain codes `TSC`, `IDA`) and are structurally impossible to exclude from the S4 mandatory set under ESC-02 — they are not an optional "nice to include," they are the rule's own trigger condition.

## 6. What fail-safe behavior applies when impact cannot be determined confidently?

See `confidenceModel` in the classification JSON and `failSafeConditions` in the rules JSON. Four confidence levels — HIGH, MEDIUM, LOW, UNKNOWN — and ten named fail-safe conditions (unknown ownership, low confidence, incomplete test ownership, stale dependency graph, generated/dynamic paths, runtime reflection, unbounded raw-SQL impact, undocumented cross-domain calls, high-risk module touched, and the hard rule that **zero selected tests is never a valid outcome for a non-documentation code change**). MEDIUM confidence widens the scope by one S-level from taxonomy default; LOW and UNKNOWN both force S4 minimum. This is not a tuning knob to be relaxed later without a new authorization — it is this design's central safety property, and it is why §0's evidence-staleness disclosure is treated as a "lower confidence, don't guess" finding rather than something to paper over.

## 7. What evidence is required before this design can later be implemented in CI?

In order, blocking each other:

1. **A refreshed F0-005-equivalent test inventory** against the actual implementation task's own execution baseline (not this design's evidence, which is already 7+ days/24+ files stale per §0) — this is the direct remediation prerequisite for R-072.
2. **A decision, by that future task, on path-based vs. dependency-graph-based selection mechanics at the implementation level** — this design deliberately does not pick a single mechanism (a static JSON snapshot, as delivered here, versus a live graph query at CI time); §12 records this as an explicit open question rather than a hidden default, because the two have different staleness-failure modes (§6 stale-graph fail-safe covers a live-query implementation; a static-snapshot implementation instead needs its own periodic-refresh cadence — see R-072).
3. **Confirmation that CodeGraph (or an equivalent tool) is available and current** in the implementation task's environment, or an explicit decision to proceed on repository-evidence-only grounds (as this design itself had to, per §0) with the same disclosed-staleness discipline.
4. **A disposable-Postgres provisioning mechanism**, since `evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md` confirms every `DATABASE_INTEGRATION`-tagged test is currently blocked (`ECONNREFUSED`) in ordinary task environments — S5 (migration verification) cannot be exercised without it, and this program has already built the pattern once (F0-011-P2's disposable-Postgres rehearsal).
5. **External review and merge of this design itself** — an agent cannot self-declare F1-001 `MERGED`, and F1-001's own completion does not by itself satisfy F1's exit gate (`phases/F1_CI_AND_TEST_ARCHITECTURE.md`'s own completion rule for this task).

## 8. What measurable criteria determine whether the mechanism is safe enough to automate?

The four-phase shadow-mode rollout in `evidence/f1-001-impact-selection-rules.json`'s `shadowModeRollout` object, gated by the `metrics` object's eight measurable series. The one non-negotiable acceptance criterion, unchanged at every phase: **`falseNegativeRate` for any CRITICAL-risk change is 0 — always, permanently, with no phase authorized to relax it.** Phase 3 (the first phase allowed to actually skip any suite) is additionally gated on zero missed failures for the LOW-risk class it activates on, sustained across a defined window (100 PRs or 30 days). See §D of the rules JSON for the full phase-by-phase exit criteria.

---

## A. Change classification taxonomy

24 categories, CT-01…CT-24, each with example paths and a default (risk floor, test-scope floor) — full table in `evidence/f1-001-test-scope-classification.json`'s `changeClassificationTaxonomy`. Categories map 1:1 to this task's required minimum list (documentation-only, test-only, frontend presentation-only, frontend service/API client, backend route/controller, domain service, shared utility, auth/authz, tenant/clinic scoping, DB schema/migration, raw SQL, public contract, cross-domain dependency, queue/outbox/background job, webhook/integration, WhatsApp/Instagram/messaging, AI, DICOM/CBCT/imaging, storage/attachment/export, audit/logging/observability, financial/billing, privacy/KVKK, deployment/infrastructure, dependency/package update).

## B. Risk classification

LOW / MEDIUM / HIGH / CRITICAL, each defined by **measurable properties** (fan-in/fan-out thresholds sourced from `DEPENDENCY_MAP.md`'s own matrix, count of high-risk-dimension flags set, taxonomy-category membership) — see `riskClassification` in the classification JSON. All 18 required high-risk dimensions (tenant isolation, org/clinic scope, auth/session/CSRF, role authorization, KVKK/privacy/consent, audit/log integrity, financial calculations, migrations/data integrity, raw SQL, storage/attachments, backup/restore, queues/retries/idempotency, webhooks, AI decisions, imaging/DICOM, official integrations, public API contracts, shared cross-domain utilities) are enumerated as HRD-01…HRD-18 with an evidence citation each.

## C. Affected-module resolution model

Direct dependency = a `DEPENDENCY_MAP.md` edge one hop from the owning domain. Transitive dependency = the closure of direct edges, bounded to the 833-edge matrix (not a live unbounded traversal — see §7 item 2 on why a future implementation must decide whether to keep this bound or replace it with a live graph query). Public-contract dependency = an `F0-003 contract_candidates[]` match. Forbidden direct cross-domain dependency = the 9 documented ADR-015 X-violations (WHA/IGM → PAT/APT) — these are treated as **already-HIGH-risk by definition**, not as ordinary edges, because they are debt the program has explicitly chosen not to fix yet. Shared-utility fan-out = any `server/src/utils/*.ts` file (34 files, per F0-003) or `src/services/api.ts`. Database/shared-schema fan-out = any Prisma model with more than one owning-domain reader, per `DEPENDENCY_MAP.md`'s DATA_READ/DATA_WRITE edge types.

## D. Test-scope levels

S0 (docs validation) → S1 (narrow unit/static) → S2 (module suite) → S3 (cross-module suite) → S4 (full backend+frontend) → S5 (disposable-DB migration verification) → S6 (production-safe verification package). **S6 is never automatically executed by any CI implementation of this design** — it requires the same kind of separate, explicit, per-change human authorization every existing production verification in this program's history has required (KVKK-HIGH-006 smoke, R-061 packages, DATA-INTEGRITY-001 production smoke). Full definitions: `testScopeLevels` in the classification JSON.

## E. Mandatory escalation rules

Twelve rules, ESC-01…ESC-12, each with an exact trigger, forced scope, and evidence-based rationale — `mandatoryEscalationRules` in the rules JSON. They directly implement this task's own required minimum list (unknown ownership, shared auth/tenant helper, schema/migration, raw SQL, public-contract, high-fan-out shared utility, webhook/messaging, KVKK/privacy, payment/financial, storage/imaging, AI, and CI/test-selection-engine-self-change).

## F. Fail-safe behavior

Ten named conditions in `failSafeConditions` (rules JSON), all converging on the same principle: **when in doubt, run more, never less; and "zero tests selected" is a forbidden output for any non-documentation code change, not merely a discouraged one.**

## G. Confidence model

HIGH / MEDIUM / LOW / UNKNOWN, with an explicit, dated staleness threshold (30 days or 50 merged PRs) after which even a HIGH-confidence-looking match must be treated as LOW until the backing evidence is refreshed — see `confidenceModel` in the classification JSON. LOW and UNKNOWN both escalate to S4 minimum, per this task's own required rule.

## H. Full-suite triggers

15 concrete, reviewable entries — `fullSuiteTriggers` in the rules JSON — matching this task's required minimum list exactly (auth middleware, tenant scope utilities, shared Prisma client behavior, schema/migrations, shared role helpers, shared validation/error serialization, public contracts, high-fan-out utilities, CI/test infrastructure, unknown ownership, multi-domain PRs, lockfile/core-dependency changes, broad refactor/rename, generated client changes, test-selection-rule changes themselves).

## I. Shadow-mode rollout design

Four phases (shadow-compute-only → metric-collection → reduced-execution-for-LOW-risk-only → cautious-expansion-with-rollback), each with its own exit criteria — `shadowModeRollout` in the rules JSON. The required eight metrics (false-negative rate, missed-failing-suite count, selected-suite precision/recall, average runtime saved, high-risk-override frequency, unknown-ownership frequency, stale-graph-detection frequency) are all defined in `metrics`. **The acceptable false-negative rate for CRITICAL-risk changes is zero, at every phase, with no exception** — this is stated three times across this document deliberately (§8, here, and in the rules JSON itself) because it is the one number a future implementation task is never authorized to trade off against runtime savings.

## J. Rollback design

One config/environment switch forces full-suite execution unconditionally. No destructive migration is introduced by this design (it introduces none at all). No dependency on an unavailable graph service — if a future implementation queries a live tool (CodeGraph or otherwise), unavailability must fail closed to S4, mirroring exactly how this design itself behaved when CodeGraph was unavailable during its own authoring (§0). Selector failure of any kind (exception, timeout, malformed input, unrecognized path) defaults to S4. Every selection decision must be auditable after the fact — which rule fired, what confidence level, what scope resulted — not just pass/fail. Full detail: `rollbackDesign` in the rules JSON.

## K. Example scenarios

17 repository-grounded scenarios, SC-01…SC-17 (exceeding the required minimum of 15), each with changed paths, owning module, risk class, selected scope, mandatory suites, full-suite-required flag, rationale, confidence, and fail-safe fallback — `exampleScenarios` in the rules JSON. Covers every category this task's instructions required: docs-only (SC-01), React formatting (SC-02), shared API error helper (SC-03), payment field narrowing (SC-04), clinic-scope helper (SC-05), WhatsApp webhook log redaction (SC-06), messaging connection authorization (SC-07), patient import scope (SC-08), Prisma migration (SC-09), public booking overlap logic (SC-10), privacy anonymization (SC-11), attachment/storage service (SC-12), AI appointment flow (SC-13), DICOM/imaging path (SC-14), public-contract change (SC-15), plus two additional scenarios (dependency lockfile bump, SC-16; broad multi-domain refactor, SC-17) covering `fullSuiteTriggers` cases not otherwise exercised by the required 15.

---

## Open questions (carried to a future implementation task, not resolved here)

1. **Static snapshot vs. live graph query.** This design is written against static, repository-committed evidence (F0-003/F0-004/F0-005-style JSON). A future implementation task must decide whether to keep that model (with a defined refresh cadence — see R-072) or query a live dependency-graph tool at CI time (with its own fail-closed behavior on unavailability, per §J). Both are compatible with every rule in this document; neither is selected here.
2. **AIO (Messaging AI Orchestration) risk-tracking gap.** `AIO` currently inherits `WHA`'s risk tier only by proximity/association, not by its own `RISK_REGISTER.md` row. Flagged in `openQuestions` of the classification JSON; not resolved by this design.
3. **Bridge-agent/windows-bridge evidence gap.** `MODULE_MAP.md`/F0-003 explicitly note these subtrees as unscanned. This design's fail-safe model handles the gap (LOW confidence → S4, see scenario SC-14) but does not close it — a future task should extend F0-003-equivalent evidence to cover them before narrowing their default scope below S4.
4. **Where the one-switch rollback flag lives** (environment variable, `PlatformSetting` row, CI workflow input) is intentionally left to the implementation task — this design specifies the requirement (§J), not the storage mechanism.

## Non-authorization statement

This document authorizes nothing beyond itself. It does not declare the KVKK baseline stable, does not approve G1 or G2, does not close R-046 or R-071, does not modify any ADR status, does not enable any CI workflow, and does not by itself satisfy F1's exit gate. The next task in F1's roadmap ("PR / main / nightly / release CI katmanlarının kurulumu") requires its own separate authorization, per `phases/F1_CI_AND_TEST_ARCHITECTURE.md`.

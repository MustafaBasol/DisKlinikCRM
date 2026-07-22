# Affected-Module Test Selection and CI Architecture — Strategy

Task: ARCH-TEST-001 · Type: repository analysis and design only.

**Status: PROPOSED / NOT ACTIVE.** Nothing in this document, [`AFFECTED_MODULE_TEST_MATRIX.md`](AFFECTED_MODULE_TEST_MATRIX.md), or [`CI_TEST_SELECTION_DECISION_TREE.md`](CI_TEST_SELECTION_DECISION_TREE.md) is wired into any CI workflow, `package.json` script, git hook, or runtime code. No test file, route file, middleware file, Prisma schema, or GitHub Actions workflow was modified to produce these three documents. They are a design proposal for a future, separately-scheduled implementation task (see §9).

Baseline: commit `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c` (`origin/main` HEAD at task start), worktree `D:/Mustafa/Siteler/DisKlinikCRM-worktrees/affected-module-test-strategy`, branch `docs/affected-module-test-strategy`.

**Rebaseline (2026-07-22):** `origin/main` advanced to `7c2aea5a084c38de5732fda65ca0874aa8d46024` (merge of PR #208, "docs(pilot): add controlled customer onboarding package") before this branch was committed. Reviewed `git log`/`git diff --name-status 3b4ec9d..7c2aea5`: the only change is 5 new files under `docs/operations/pilot/` (pilot onboarding/rollback/monitoring docs). **No technical impact** — that commit touched no route/module ownership file, no test or `package.json` script, no `middleware/`/`auth`/`clinicScope` file, no Prisma schema/migration, no CI workflow, and none of the F0-003/F0-004/F0-005 evidence files this design cites. All analysis, module boundaries, test-command mappings, and evidence citations in this document and its two companions remain accurate as authored against `3b4ec9d`; only this baseline reference and its two companion documents' baseline references were updated to `7c2aea5` to reflect the current `origin/main` tip.

## 1. Purpose

The repository has no affected-module test selection today: there is no CI workflow for the main application at all (§3), and the one workflow that exists (`windows-bridge-pr.yml`) uses hand-maintained `paths:` triggers for a single, separately-deployed component. This task designs — but does not implement — a mapping from "files changed in a PR" to "which of the repository's ~100 hand-rolled test targets must run," so that a future CI-implementation task has an evidence-based specification to build against instead of inventing one from scratch.

## 2. Evidence base — this is a synthesis, not a fresh audit

This design reuses three already-committed, repository-evidence-verified documents in full rather than re-deriving their findings:

| Prior task | What it produced | Used here for |
|---|---|---|
| **F0-003** — [`MODULE_MAP.md`](../program/MODULE_MAP.md) / [evidence](../program/evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md) | 37-domain ownership map: every route/service/middleware file and all 88 Prisma models assigned to exactly one primary domain, with criticality/maturity | The base taxonomy this task's 13-module map is coarsened from (§4) |
| **F0-004** — [`DEPENDENCY_MAP.md`](../program/DEPENDENCY_MAP.md) / [evidence](../program/evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md) | 833-edge cross-domain import/data dependency graph, 9 high-risk boundary violations, 35 mutual-dependency cycles, 15 contract candidates | Direct dependencies (§7), high-risk escalation rules, cross-module contract-test rules |
| **F0-005** — [`TEST_OWNERSHIP.md`](../program/TEST_OWNERSHIP.md) / [evidence](../program/evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md) / [JSON](../program/evidence/F0-005_test_inventory.json) | 100 test/verification targets inventoried with canonical domain owner, command, DB requirement, runtime result | Module → test-command mapping (§6), test taxonomy (§3) |

**This task's own new analysis**, not present in F0-003/4/5:

- F0-005's `F0-005_test_inventory.json` was generated at commit `7fcf2f8` (2026-07-19). This task's worktree is at `3b4ec9d` (2026-07-22), which has **20 additional backend test files** (14 `.test.ts` + 6 `dbVerification/*.test.ts`) not present in that JSON, all from merged KVKK-HIGH-006/007/008 work. This task read each new file's header and import/route-source reference to place it in the module map (§10, `AFFECTED_MODULE_TEST_MATRIX.md` §2 "files added since F0-005").
- A direct `prisma.<model>` grep across all 57 `server/src/routes/*.ts` files, to confirm/cross-check F0-003's model-ownership table against the current tree.
- A direct fan-in count for the three highest-leverage shared files (`middleware/auth.ts`: 48/57 routes; `utils/clinicScope.ts`: 36/57 routes; `utils/roles.ts`: 10/57 routes) — the concrete basis for §8's mandatory full-suite triggers.
- The changed-file → module path-prefix table, module → test-command table, decision algorithm, and PR-evidence requirements (the actual deliverable of this task) — none of these existed before.

## 3. Current test execution reality (unchanged by this task)

- **No JS/TS test framework exists.** Every `server/src/tests/*.test.ts` and `src/**/__tests__/*.test.ts` file uses the same hand-rolled `node:assert/strict` + local `test()`/`section()` helper, executed one process per file via `tsx`. The only framework-based JS/TS tests are 2 Vitest component tests (`src/**/*.vitest.test.tsx`, run via `npm run test:vitest`).
- **No test discovery.** Every test target must be individually wired into a `package.json` script. F0-005 §6 already found 6 backend files with no script at all and 6 scripts never called by the aggregate `npm run test` chain — confirmed still true in this baseline (§10).
- **No CI for the main application.** `.github/workflows/` contains exactly two workflows, both `windows-bridge`-only (`windows-bridge-pr.yml`, `windows-bridge-release.yml`). Neither runs `server/`'s `npm run test`, root `npm run test:vitest`, or any of the individual `test:*` scripts for the main app. This is the gap this design closes.
- **`windows-bridge-pr.yml` is the one existing precedent for affected-path test selection in this repo** — it already triggers on a `paths:` allow-list (`windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts`, `src/components/imaging/**`) and runs a fixed subset of tests. This design generalizes that existing, working pattern to the rest of the application rather than inventing a new mechanism — consistent with the task's constraint not to introduce a new tool or framework.
- **DB-dependent tests are currently unrunnable in this environment** (no committed disposable-Postgres provisioning — F0-005 §8). This constrains §8's fallback design: a future CI implementation cannot silently skip DB-required tests; it must either provision a disposable database or explicitly mark the run `BLOCKED` in the PR evidence (§9 of the decision-tree doc), exactly as F0-005's own runtime measurement did.

## 4. Module taxonomy — 13 required modules, mapped from F0-003's 37 domains

The task requires a module map covering (at least) 13 named modules. F0-003's 37-domain map is the right granularity for *ownership*, but too fine-grained for *CI test selection* — a PR touching `dashboard.ts` should not need to reason about 37 possible affected domains. This task therefore defines 13 (+1 already-externally-CI'd) **test-selection modules**, each an explicit, documented union of one or more F0-003 domains. No F0-003 domain is silently dropped; §4.1 accounts for all 37.

| # | Test-selection module | F0-003 domain(s) folded in (primary domain first) |
|---|---|---|
| 1 | **Auth / Tenant Scope** | Identity and Access; Tenant Security and Scope; Organization/Clinic/User Membership; Permissions/Roles; Entitlements and Release Flags |
| 2 | **Patients** | Patients; (secondary) Storage Abstraction — attachments; Tasks and Follow-up |
| 3 | **Appointments** | Appointments and Availability |
| 4 | **Appointment Requests** | (carved out of Appointments and Availability + Public Booking) — `appointmentRequests.ts`, `contactRequests.ts`, `publicBooking.ts`'s `AppointmentRequest`-creation path |
| 5 | **Dental Chart** | Dental Chart/Procedures; (secondary) Treatment Cases; Dental Laboratory/Prosthetics Tracking; Imaging — Server Ingest and Viewer |
| 6 | **Payments** | Basic Payments; (secondary) Advanced Finance — Compensation and Payouts |
| 7 | **Inventory** | Inventory |
| 8 | **Insurance** | Insurance |
| 9 | **Messaging** (channel-agnostic) | Messaging — SMS; Messaging — Email; Automations/Reminders/Follow-up/Recall; Notifications; Cross-Domain Contract (`MessageTemplate`) |
| 10 | **WhatsApp / Meta** | Messaging — WhatsApp; Messaging — Instagram; Messaging AI Orchestration |
| 11 | **Privacy / KVKK** | Privacy/Consent/Retention/Data Subject Rights; (secondary) Security Incident Response and Detection; Audit and Activity |
| 12 | **Reports** | Reporting/Analytics; Observability/Operational Events |
| 13 | **Platform Admin** | Platform Administration; (secondary) Configuration and Secrets |
| 14† | **Imaging Device Bridge** (out of primary scope) | Imaging — Device Bridge/Windows Bridge |

† Module 14 already has its own dedicated CI (`windows-bridge-pr.yml`) and its own separate `bridge-agent/`/`windows-bridge/` deployables outside `server/`/`src/`. It is listed for completeness and cross-reference only; this design does not change its existing trigger.

### 4.1 F0-003 domains not yet placed above

All remaining F0-003 domains fall into one of the 13+1 modules as a "secondary" per the table, **except** the following, which are cross-cutting core-platform domains consumed by (almost) every module rather than owned by one:

- Audit and Activity, Configuration and Secrets, Observability/Operational Events, Shared Events/Queue Contracts/Idempotency, Storage Abstraction — these are exactly F0-004 §1's "target domain → always `A` (ACCEPTED_PLATFORM)" rule-derived list. A change to one of their owning files (`utils/activity.ts`, `utils/auditLog.ts`, `utils/secrets.ts`, `utils/encryption.ts`, `services/operationalEventService.ts`, `services/messagingInboundIdempotency.ts`, `utils/jobLock.ts`, `services/fileStorage.ts`) is treated as a **shared-platform change** under §8's full-suite trigger rules, not attributed to a single module.

No domain from F0-003's 37 is unaccounted for; the full reconciliation table is in `AFFECTED_MODULE_TEST_MATRIX.md` §1.

## 5. Per-module detail — see the matrix document

For each of the 13+1 modules: owned runtime paths, direct dependencies (F0-004-sourced), public contracts (`src/services/api.ts` path prefixes + direct-`api.*` page calls), test files, mandatory regression set, and full-suite trigger conditions are tabulated in [`AFFECTED_MODULE_TEST_MATRIX.md`](AFFECTED_MODULE_TEST_MATRIX.md) §2. This document (the strategy) states the *rules*; the matrix states the *data* the rules operate on, so the matrix can be regenerated/updated independently as the codebase changes without rewriting the rules.

## 6. Design 1 — changed-file → affected-module mapping

A changed file is attributed to module(s) by longest-matching owned-path prefix, per the table in `AFFECTED_MODULE_TEST_MATRIX.md` §3. Three shapes:

1. **Single-module file** (e.g. `server/src/routes/dentalChart.ts`) → exactly one module (Dental Chart).
2. **Multi-owner file** — none currently exist after F0-004's §2.1 canonicalization (`organizationDashboard.ts` → Reports; `treatmentStockDeduction.ts` → Inventory); this design follows those same canonical single-owner resolutions.
3. **Unmapped file** (matches no known prefix — e.g. a brand-new top-level directory, a root config file) → **fallback to full suite** (§8), never silently ignored.

## 7. Design 2 — module → test-command mapping

Each module's **mandatory regression set** is the list of already-existing `npm run test:*` scripts (or direct `tsx`/`vitest` invocations for the handful of currently-unwired files, per F0-005 §6) whose `canonicalOwner` or `sourceFilesProtected` matches that module, per `AFFECTED_MODULE_TEST_MATRIX.md` §2's "Test files" / "Mandatory regression set" columns. No new script is introduced; the mapping only groups and invokes what already exists (task constraint: no new tool or framework).

## 8. Design 3 — high-risk escalation rules

Two independent, evidence-sourced escalation triggers, both from F0-004:

1. **The 9 high-risk boundary-violation edges** (F0-004 §3): any change touching `routes/whatsapp.ts`, `routes/whatsappInbox.ts`, `services/whatsapp/metaWhatsAppAiProcessor.ts`, or `services/instagram/instagramAiConversationProcessor.ts` escalates beyond its own module (WhatsApp/Meta) to **also** run the Patients and Appointment Requests mandatory regression sets, because these 4 files write `Patient`/`Appointment` records directly, bypassing those modules' own routes.
2. **The 5 individually-reviewed mutual-dependency cycles** (F0-004 §5.1): a change to either side of a cycle pair escalates to include the other side's mandatory regression set. Concretely: Appointments↔Org/Membership, Privacy↔WhatsApp, Dental Chart/Treatment-Cases↔Inventory, Dental-Chart-Imaging↔Device-Bridge (module 14, path-triggered separately, already covered by `windows-bridge-pr.yml`), Auth/Tenant-Scope↔Auth/Tenant-Scope (Identity↔Org/Membership — internal to module 1, no cross-module escalation needed since both folded into the same module per §4).

Full escalation table: `AFFECTED_MODULE_TEST_MATRIX.md` §5.

## 9. Design 4 — cross-module contract-test rules

F0-004 §10 lists 15 evidence-derived contract candidates (`CC-01`…`CC-15`), none implemented today. Per this task's own constraint (design only, no runtime change), this design does **not** propose implementing any contract. It proposes only: **where a contract candidate's "replaces" edge set overlaps a module pair in this map, a change to either module runs a documented minimum cross-module smoke check** — today, that check is simply "run the other module's existing mandatory regression set" (there is no dedicated contract test file for any `CC-*` candidate yet, confirmed by grep — none exists). This is recorded as a gap, not fabricated. See `AFFECTED_MODULE_TEST_MATRIX.md` §6.

## 10. Design 5 — CI decision algorithm (specification only)

The full step-by-step algorithm, in decision-tree form, is [`CI_TEST_SELECTION_DECISION_TREE.md`](CI_TEST_SELECTION_DECISION_TREE.md). Summary: compute changed files → map to modules (§6) → union mandatory regression sets (§7) → apply high-risk escalation (§8) → apply fallback rules (§11) → emit the exact command list to run → require the PR description evidence block (§12).

## 11. Design 6 — fallback to full suite

A future implementation must fall back to the full `server/` `npm run test` chain + root `npm run test:vitest` + all currently-unwired `test:*` scripts (the F0-005 §6 orphans) whenever **any** of the following holds — each grounded in evidence from F0-003/4/5, not invented:

1. A changed file is unmapped to any module (§6.3).
2. A changed file is inside a shared-platform path with fan-in ≥ 10 route files (this task's own measurement, §2): `server/src/middleware/*`, `server/src/utils/clinicScope.ts`, `server/src/utils/roles.ts`, `server/src/db.ts`, `server/src/index.ts`.
3. `server/prisma/schema.prisma` or any file under `server/prisma/migrations/**` changed (66 migrations exist today; a schema/migration change has no bounded blast radius by construction — every module reads the same `PrismaClient`).
4. `server/package.json`'s `scripts` block or root `package.json`'s `scripts` block changed (F0-005 §6 already found this wiring is fallible; a script-block change is exactly the failure mode that produced the `overdueInstallments.test.ts` orphan regression).
5. More than 5 modules are simultaneously affected by one PR's changed-file set (a fixed, documented threshold — not evidence-derived, flagged as a judgment call an external reviewer should confirm or adjust).
6. Any file matched by more than one module's owned-path table simultaneously (should not occur per §6.2's canonicalization, but is checked defensively — an unexpected match indicates the matrix is stale, not that it's safe to guess).

## 12. Design 7 — evidence required in PR descriptions

Specified in full in `CI_TEST_SELECTION_DECISION_TREE.md` §5. Summary of the required block: changed-file list, computed affected-module set, exact test commands executed, pass/fail/blocked counts per command, whether full-suite fallback triggered and which §11 rule caused it, and — mirroring F0-005's own "BLOCKED, not silently skipped" discipline — explicit disclosure of any DB-required test that could not run in the CI environment rather than a silently green check.

## 13. Limitations

1. **F0-005's JSON inventory is stale relative to this baseline** (§2) — 20 test files added since are placed into modules by this task's own header/import reading, not by F0-005's original 5-parallel-agent classification methodology. This should be treated as a first-pass placement, not re-verified with F0-005's original rigor.
2. **No dedicated contract test exists for any of F0-004's 15 contract candidates** (§9) — cross-module "contract tests" in this design are today only "run the neighboring module's existing regression set," a weaker guarantee than a real consumer-driven contract test would provide.
3. **The full-suite fan-in thresholds in §11 rule 2 (≥10 files) and rule 5 (>5 modules) are this task's own judgment calls**, not derived from an incident history or measured false-negative rate (none exists to measure against, since no affected-test selection has ever run in this repository). Flagged for explicit external confirmation per the task's "stop for external review" instruction.
4. **DB-required tests remain unrunnable in this environment** (§3, F0-005 §8 carried forward unchanged) — this design's fallback rules assume a future CI environment either solves this (disposable Postgres provisioning, out of this task's scope) or the decision tree's `BLOCKED` disclosure path (§12) is exercised routinely, not treated as a rare edge case.
5. **This design was produced by reading, not running, the test suite.** No command in this document's cited sources was re-executed by this task; all runtime facts (pass/fail counts, blocked tests, orphan scripts) are cited from F0-005's already-committed evidence, current as of `7fcf2f8`.
6. **Module 14 (Imaging Device Bridge) is intentionally out of primary scope** — it already has working CI; this design does not audit or change it, only cross-references its existing `paths:` trigger as prior art.
7. **`bridge-agent/`'s 9-file test suite has zero CI enforcement today** (F0-005 §11) and is not addressed by this design beyond noting the gap — `bridge-agent/` was out of the task's targeted roots (`server/src`, `src`, `server/src/tests`).

## 14. What this task did not do

Per its own constraints: no runtime code was modified; no CI workflow was created or changed; no shared program tracker file (`docs/program/*.md` outside `docs/architecture/`) was updated; no test file was added, changed, or re-run; no new tool, framework, or test runner was introduced; no contract (`CC-01`…`CC-15`) was implemented; this design was not marked or treated as active. CodeGraph was used only for the targeted roots (`server/src`, `src`, `server/src/tests`) requested by the task, supplemented by direct `Read`/`Grep`/`Bash` inspection for coverage CodeGraph's single-pass query didn't reach (all 57 route files, the full test-file list, `package.json` scripts).

## 15. Exact implementation task (for a future, separately-scheduled task)

**Title:** Implement affected-module test selection in CI (implements ARCH-TEST-001's design)
**Scope:**
1. Add a new `.github/workflows/main-app-affected-tests.yml` (or extend an existing workflow) that: computes the changed-file list against the PR base, applies `AFFECTED_MODULE_TEST_MATRIX.md` §3's path-prefix table (encoded as a committed JSON/YAML manifest, not re-derived ad hoc), applies §5/§8's escalation rules, and runs the resulting command set.
2. Wire the 6 orphan `test:*` scripts and 6 no-script test files (F0-005 §6, re-confirmed current in this baseline) into the manifest so they are reachable by the new workflow even though they remain absent from the aggregate `npm run test` chain.
3. Provision a disposable Postgres in CI (blocked prerequisite, F0-005 §8) so DB-required tests (`securityIncident.test.ts`, `communicationConsent.test.ts`, `communicationPreferenceBackfill.test.ts`, all 6 `dbVerification/*.test.ts` files, 3 `server/scripts/verify-*.ts` scripts) can actually execute in CI rather than being permanently `BLOCKED`.
4. Implement the PR-evidence block (§12) as a workflow-generated PR comment or check summary, not a manually-authored section.
5. Run the new workflow in **shadow mode** (report-only, non-blocking) for a defined trial period before it gates merges, given this task's own §13 flags on unverified thresholds.
6. Revisit this document's §11 thresholds against the shadow-mode false-negative/false-positive data before promoting it to a required check.

This document explicitly stops here per the task's instruction — no part of item 1-6 above was started.

## 16. Explicit scope statement

Stated plainly, consolidating language that otherwise appears distributed across §1-§15, so none of it can be missed or paraphrased away in a future read:

1. **CI/test selection as designed here is a proposal, not active policy.** Nothing in this document or its two companions gates a merge, runs in any workflow, or is authorized for anyone to treat as "the rule" until a separate implementation task (§15) ships it and it exits shadow mode.
2. **The >5-module (§11 rule 5) and ≥10-file-fan-in (§11 rule 2) thresholds are unverified design defaults**, not derived from measured false-positive/false-negative rates (§13 item 3) — they are this task's own placeholder judgment calls, explicitly flagged for external review before anyone relies on them operationally.
3. **Targeted testing does not replace full-suite gates for high-risk or shared-platform changes.** §8's escalation rules and §11's fallback rules are not optional optimizations layered on top of a "real" gate — for the file classes they cover (the 9 high-risk WhatsApp/Meta write paths, shared auth/tenant-scope files, schema/migration changes), the full suite (or the escalated multi-module set) *is* the gate. A future implementation must not treat module-scoped testing as sufficient on its own for these classes.
4. **The 20 test files this task classified beyond F0-005's own inventory (§2, §10; matrix §7) are a local reconciliation for this design's purposes only — not an authoritative update to F0-005's committed evidence.** F0-005's own 5-parallel-agent classification methodology was not re-run; this task's single-pass header/import read is a lighter-weight placement, explicitly flagged as such (§13 item 1), and should not be cited as if it carries F0-005's original rigor.
5. **WhatsApp/Meta's complete absence of DB-required test coverage (matrix §8 note 4) remains an open, unresolved gap.** This design's escalation rules make sure the *right* tests run for this module's changes, but none of those tests exercise a real Prisma call site — targeted selection cannot manufacture coverage depth that does not exist in the underlying suite.
6. **Disposable PostgreSQL provisioning in CI is a hard prerequisite, not a nice-to-have, before any DB-required test's result in this design can be trusted.** Until it exists (§15 item 3), every DB-required command in the matrix must surface as `BLOCKED` in the PR evidence block (decision-tree doc §5), never as a silently-passing or silently-skipped check.
7. **No test framework, test runner, or new tooling is proposed anywhere in this design.** Every command referenced in the matrix and decision-tree documents already exists in the repository today; this design only groups and sequences existing commands.
8. **No GitHub Actions workflow implementing any part of this design exists yet.** `.github/workflows/` is unchanged by this task and remains exactly as it was before this design was authored (`windows-bridge-pr.yml`, `windows-bridge-release.yml` only).

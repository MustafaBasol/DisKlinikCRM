# F2-ADR-ORG-DASH-002 — organizationDashboard Domain Ownership Resolution

Task: F2-ADR-ORG-DASH-002 — Resolve organizationDashboard Domain Ownership Ambiguity
Phase: F2 — Modular Monolith Boundary Remediation / Guardrail Signal Quality
Type: ADR + one-value static-analysis config change + documentation. No application source, Prisma schema, migration, route, response shape, authorization rule, CI workflow, or dependency is modified.
ADR: [`docs/architecture/f2/ADR-F2-ORG-DASH-OWNERSHIP.md`](../../architecture/f2/ADR-F2-ORG-DASH-OWNERSHIP.md)

## 1. Baseline verification

| Fact | Verified value |
|---|---|
| `git fetch origin --prune` | run at task start; fetched `99436e5..46acae8  main` |
| `git rev-parse origin/main` | `46acae8415020cb0bd340fbc854c4187c43e3662` |
| `git status --short` (this worktree, before any edit) | clean (empty) |
| Worktree | `E:\Ek Gelir\Siteler\DisKlinikCRM-git\.claude\worktrees\agent-af5c5bafdd95dc5f1` (agent-isolated worktree, pre-created by the harness) |
| Branch | `docs/f2-adr-org-dashboard-002-ownership`, created via `git checkout -b … origin/main`; HEAD confirmed `46acae8…` before any file was written |
| PR #329 | `gh pr view 329` → `state: MERGED`, `mergedAt: 2026-08-06T10:32:43Z`, `mergeCommit.oid: 99436e5ba0823fcc82d86eb9b731dc5dffd04ccb` |
| PR #328 | `gh pr view 328` → `state: MERGED`, `mergedAt: 2026-08-06T11:37:39Z`, `mergeCommit.oid: 46acae8415020cb0bd340fbc854c4187c43e3662` |
| `git merge-base --is-ancestor 99436e5… origin/main` | exit 0 |
| `git merge-base --is-ancestor 46acae8… origin/main` | exit 0 (it is the tip) |
| Latest `main` CI | `gh run list --branch main` → run `31098023681` (`ci-main-and-nightly`), headSha `46acae8…`, `status: completed`, `conclusion: success` |
| `npm ci` (root) | exit 0 |
| `npm ci` (server) | exit 0 |

**Correction to the assigning brief's stated predecessor state.** The brief listed PR #329's merge SHA (`99436e5…`) first and PR #328's second, and instructed not to assume `origin/main` still equals PR #328's merge SHA. Verified ordering is: #329 merged first (`99436e5`), #328 merged second (`46acae8`), and `46acae8` **is** the current `origin/main` tip. The agent worktree was pre-created at `99436e5` — one commit behind — so the task branch was explicitly created from `origin/main` rather than from the inherited worktree HEAD. This is recorded because it would otherwise have silently produced a stale baseline.

**Predecessor facts independently re-verified, not trusted:**
- `financeDashboard.ts` no longer imports `organizationDashboard`: confirmed by direct read — `server/src/routes/financeDashboard.ts:21` is `import { getDateRange } from '../utils/helpers.js';`.
- `getDateRange` belongs to `core-shared-platform-infrastructure`: confirmed — defined at `server/src/utils/helpers.ts:26`, mapped at `domain-map.json` → `"server/src/utils/helpers.ts": "core-shared-platform-infrastructure"`.
- `organizationDashboard.ts` was `UNRESOLVED`: confirmed by direct read of `domain-map.json` before any edit, and by the before-scan (§6), which shows exactly 5 findings with `callerDomain: "UNRESOLVED"` and 0 `UNRESOLVED` entries anywhere else in the map.
- Blocking enforcement remains unauthorized: confirmed — not enabled, not touched; `scripts/architecture-guardrail/cli.ts`'s exit-code contract (findings → exit 0) is unmodified, and `guardrail:test` still asserts it (74/74 passing, §8).

## 2. Tooling note — CodeGraph

A `.codegraph/` index exists, but the MCP `codegraph_explore` tool resolved to the **primary** worktree's index (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, HEAD `255392c`), not this agent worktree, and the tool emitted an explicit warning to that effect. Its output was demonstrably stale: it still showed `getDateRange` defined inside `organizationDashboard.ts:31`, i.e. the pre-PR-#328 state.

**Consequence for this evidence:** CodeGraph output is used **only** for corroborating the shape of the caller graph (it independently surfaced `routes/auth.ts` as a second caller of `canAccessOrganizationDashboard`, and `src/App.tsx` as the sole caller of `src/pages/OrganizationDashboard.tsx`). Every ownership-relevant fact below comes from direct source reads at HEAD `46acae8`, and every such fact was re-verified by grep/read against this worktree. No stale CodeGraph claim is carried into any conclusion. Per the brief's scope constraint, only `organizationDashboard.ts` and its direct dependency graph were queried; no whole-repository exploration or re-indexing was performed.

## 3. Endpoint inventory — `server/src/routes/organizationDashboard.ts` (250 lines)

| # | Method | Path (as registered) | Handler lines | Middleware | Notes |
|---|---|---|---|---|---|
| 1 | `GET` | `/api/organization/dashboard` | `49–248` | `authorize(['OWNER','ORG_ADMIN'])` | the file's only route |

- Router mount: `server/src/index.ts:46` (`import organizationDashboardRoutes from './routes/organizationDashboard.js';`) and `:242` (`app.use('/api', organizationDashboardRoutes);`). Route path inside the file is `/organization/dashboard`, so the effective path is `/api/organization/dashboard`.
- **Exports:** `export default router` (`:250`) — and nothing else. After PR #328 removed `export function getDateRange`, the file exposes **zero** named symbols.
- Query parameters: `range` (default `'this_month'`), `from`, `to` — passed verbatim to `getDateRange`; a throw maps to `400 { error: 'Invalid date range parameters' }` (`:61–69`).
- Response sections: `summary` (14 scalar fields), `clinics` (per-clinic rows, 18 fields each), `insights` (6 named clinic references). Early returns: `403` (`:53–55`), `400` (`:68`), `200` with `EMPTY_SUMMARY` when scope is empty (`:83–85`), `200` with empty `insights` when no clinics (`:220–222`), `500` on error (`:243–246`).

### 3.1 Caller / importer graph

| Importer | Kind | Evidence |
|---|---|---|
| `server/src/index.ts` | default import, route registration only | `:46`, `:242` |
| *(none other)* | — | repo-wide grep for `organizationDashboard` returns only: `index.ts`, the two test files (which import `getDateRange` from `utils/helpers.js`, not from this route), `utils/helpers.ts` (a *comment* citing the relocation), `src/layouts/MainLayout.tsx` (an i18n key + the frontend URL path `/organization/dashboard`, not an import), `src/locales/de/common.json`, and evidence/config JSON |

**No other route imports this file.** Independently confirmed by the guardrail scan: findings whose `targetModelOrSymbol` is `routes/organizationDashboard.ts` = **0** in both the before- and after-scan. This is the durable confirmation that PR #328 closed the route-to-route violation.

## 4. Authorization and tenant-scope inventory

| Aspect | Value | Source |
|---|---|---|
| Route gate | `authorize(['OWNER', 'ORG_ADMIN'])` | `:51` |
| Second-layer check | `canAccessOrganizationDashboard(req.user!)` → `403` if false | `:53–55` |
| Effective allowed roles | `OWNER`, `ORG_ADMIN`, and legacy `admin` **only when** `canAccessAllClinics === true` (normalizes to `OWNER`) | `utils/roles.ts:45–75, 118–133` |
| Explicitly denied | `CLINIC_MANAGER` (incl. legacy `admin` + `canAccessAllClinics=false`), `DENTIST`, `RECEPTIONIST`, `BILLING`, `ASSISTANT` | `roles.ts`; asserted by 8 tests in `organizationDashboard.test.ts` |
| Organization scope | `orgId = req.user!.organizationId`, applied to `prisma.clinic.findMany` in **both** branches (`:75` and `:88`) | `:57, 74–90` |
| Clinic scope | `canAccessAllClinics=true` → all org clinics with `status != 'cancelled'`; otherwise `req.user!.allowedClinicIds` | `:72–81` |
| Defence in depth | the second query re-asserts `organizationId: orgId` even for ids that came from `allowedClinicIds` (`:88`), so a stale/incorrect `allowedClinicIds` entry cannot cross organizations | `:87–90` |
| Empty-scope behaviour | returns `EMPTY_SUMMARY` without issuing any per-clinic query | `:83–85` |

### 4.1 The authorization contrast that decides ownership

| File | Domain | Gate |
|---|---|---|
| `routes/reports.ts` (×5 endpoints, `:11,155,221,323,394`) | `reporting-analytics` | `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER','BILLING'])` |
| `utils/roles.ts:200` `canAccessReports()` | `core-permissions-roles` | `OWNER \| ORG_ADMIN \| CLINIC_MANAGER \| BILLING` — identical set |
| `routes/financeDashboard.ts` | `finance-advanced-compensation` | `OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING` (its header, `:6–7`) |
| `routes/organizationBranches.ts` (`:186,333,425`) | `core-org-clinic-membership` | `authorize(['OWNER','ORG_ADMIN'])` |
| **`routes/organizationDashboard.ts` (`:51`)** | **under adjudication** | **`authorize(['OWNER','ORG_ADMIN'])`** |

`organizationDashboard.ts`'s gate matches the organization-administration anchor exactly and is strictly narrower than every reporting endpoint's gate. A reporting-owned classification would assert that a reporting endpoint deliberately excludes the two roles (`CLINIC_MANAGER`, `BILLING`) that every other reporting endpoint admits — which is not a reporting access pattern.

## 5. Prisma model and service/helper dependency inventory

### 5.1 Direct imports (all four are cross-domain)

| Import | Symbols | Target file | Target domain |
|---|---|---|---|
| `../db.js` | `default` (`prisma`) | `server/src/db.ts` | `core-shared-platform-infrastructure` |
| `../middleware/auth.js` | `authorize`, `AuthRequest` | `server/src/middleware/auth.ts` | `core-identity-access` |
| `../utils/roles.js` | `canAccessOrganizationDashboard` | `server/src/utils/roles.ts` | `core-permissions-roles` |
| `../utils/helpers.js` | `getDateRange` | `server/src/utils/helpers.ts` | `core-shared-platform-infrastructure` |

No service module is imported. No other route is imported. `express` is the only third-party import.

### 5.2 Prisma models accessed

| Model | Operations | Lines | Owning domain (F0-003 / F2-PREP-001) | Same-domain under this decision? |
|---|---|---|---|---|
| `Clinic` | `findMany` ×2 (scope derivation + directory read) | `74, 87` | `core-org-clinic-membership` | **yes** |
| `UserClinic` | `count` ×2 (`staffCount`, `doctorCount`) | `159, 163` | `core-org-clinic-membership` | **yes** |
| `Appointment` | `count` ×5 (today / period / completed / cancelled / no-show) | `113,117,121,125,129` | `clinical-appointments-availability` | no — open debt |
| `Patient` | `count` ×2 (new / total, both `deletedAt: null`) | `133, 137` | `clinical-patients` | no — open debt |
| `TreatmentCase` | `count` ×2 (active / completed-in-period) | `141, 145` | `clinical-treatment-cases` | no — open debt |
| `Payment` | `aggregate` ×2 (`_sum.amount`: collected / pending) | `149, 154` | `clinical-basic-payments` | no — open debt |

All 13 queries are `clinicId`- or `primaryClinicId`-scoped to a member of the already-authorized `scopeClinicIds`. Read-only: there is **no** write, update, delete, or transaction anywhere in the file.

**Honest accounting:** 2 of the 6 model families are `core-org-clinic-membership`-owned; 4 are not. Those 4 remain open cross-domain-read debt under this decision — see §10.

## 6. Responsibility decomposition

The file contains one route and one composed response, so the decomposition is by coherent block rather than by handler.

| Block | Lines | Route | Models read | Services called | Output semantics | Auth / tenant semantics | Proposed owner | Confidence | Accepted evidence |
|---|---|---|---|---|---|---|---|---|---|
| B1 — module header, imports, `EMPTY_SUMMARY` constant | `1–46` | — | none | none | shape contract for the empty case | none | `core-org-clinic-membership` | HIGH | trivially follows the file |
| B2 — authorization gate | `49–55` | `GET /api/organization/dashboard` | none | `canAccessOrganizationDashboard` (`core-permissions-roles`) | `403` on failure | **organization-administration gate**, identical to `organizationBranches.ts` | `core-org-clinic-membership` | HIGH | F0-003 ORG routes; `roles.ts:118–133`; §4.1 contrast |
| B3 — date-range parsing | `57–69` | same | none | `getDateRange` (`core-shared-platform-infrastructure`) | `400` on invalid range | none | already resolved — helper is platform-owned | HIGH | **F2-ADR-ORG-DASH-001 (PR #328, merged)** |
| B4 — tenant/clinic scope derivation | `71–90` | same | `Clinic` (ORG) | none | `scopeClinicIds` + clinic directory rows | **the security boundary itself**: `organizationId` + `canAccessAllClinics` + `allowedClinicIds`, re-asserted at `:88` | `core-org-clinic-membership` | HIGH | `Clinic` is an ORG-owned model in F0-003 and F2-PREP-001 |
| B5 — per-clinic metric aggregation | `92–195` | same | `Appointment`, `Patient`, `TreatmentCase`, `Payment` (cross-domain); `UserClinic` (ORG) | none | 18-field per-clinic row: 5 directory fields + 13 metrics | inherits B4's scope; no independent auth | **mixed** — composition ORG-owned, the 4 cross-domain reads belong behind future read contracts | MEDIUM | F2-PREP-001 model ownership; ADR §4 Option D |
| B6 — organization summary rollup | `197–218` | same | none (pure reduction over B5) | none | 14 org-level totals | none | `core-org-clinic-membership` | HIGH | pure function over B5's output |
| B7 — branch insight ranking | `220–242` | same | none (pure reduction over B5) | none | 6 "which branch is best/worst at X" references | none | `core-org-clinic-membership` — branch-comparison is an organization-management concern | MEDIUM-HIGH | D4/D5 in the ADR; output keys are `clinicId`/`clinicName` |
| B8 — error handling | `243–247` | same | none | none | `500` + `console.error` | none | `core-org-clinic-membership` | HIGH | trivially follows the file |

**Blocks by proposed owner:** 6 of 8 unambiguously `core-org-clinic-membership`; 1 (B3) already resolved to `core-shared-platform-infrastructure` by merged PR #328 and no longer resident in this file; 1 (B5) genuinely mixed — its *composition* is ORG, its *four cross-domain reads* are debt. **No block resolves to `reporting-analytics`.** That is the decomposition's central finding: the reporting-shaped content (B5's counting, B6/B7's rollups) is either pure computation over data the ORG domain already authorized and scoped, or cross-domain reads that belong behind contracts owned by four *clinical/finance* domains — not by `reporting-analytics`, which owns none of those models.

**Conclusion:** Option A. Decomposition does not produce a reporting-owned block to extract, so Option C (split) has no clean seam and Option B (reporting-owned) contradicts every block's own semantics. Full option analysis in ADR §4.

## 7. Focused test coverage and gaps

`server/src/tests/organizationDashboard.test.ts` (303 lines, 35 assertions, script `test:orgdash`).

| Area | Covered | How |
|---|---|---|
| `getDateRange` behaviour | yes (9) | imported from `utils/helpers.js` since PR #328 |
| `noShowRate` math incl. divide-by-zero | yes (5) | re-implemented locally as `calcNoShowRate` |
| Insight selection incl. single-clinic and empty | yes (8) | re-implemented locally as `selectInsights` |
| Summary rollup incl. empty organization | yes (5) | re-implemented locally as `buildSummary` |
| Role gate (8 roles + both legacy-`admin` branches) | yes (8) | calls the **real** `canAccessOrganizationDashboard` from `utils/roles.js` |

**Gaps (pre-existing, unchanged by this task, not introduced by it):** the test is a pure unit test — it does not mount the router, so there is no HTTP-level assertion of the `403`/`400`/`500` responses, no assertion that the two `prisma.clinic` queries carry `organizationId`, no cross-organization leakage test at this endpoint, and the metric/summary/insight logic is *re-implemented* in the test rather than imported from the route (so a change to the route body would not fail these tests). Cross-organization isolation for the organization-scope pattern is covered elsewhere by `test:roles` (142 assertions, includes "Cross-org access impossible — different organizationId") and `test:dashboard` (38). **These gaps are recorded, not closed:** closing them requires either exporting the route's internal functions (re-creating exactly the route-as-utility-module pattern PR #328 removed) or introducing route-level HTTP tests — both are code changes outside this task's ADR/config scope.

## 8. Tests executed

All from the task branch, after the domain-map change.

| # | Exact command | Exit | Result |
|---|---|---:|---|
| 1 | `npm ci` (repo root) | 0 | ok |
| 2 | `npm ci` (`server/`) | 0 | ok |
| 3 | `cd server && npm run typecheck` (`npx prisma generate && tsc --noEmit`) | 0 | Prisma Client v7.8.0 generated; **0 type errors** |
| 4 | `cd server && npm run test:orgdash` | 0 | **35 passed, 0 failed** |
| 5 | `npm run guardrail:test` | 0 | **74 passed, 0 failed** |
| 6 | `npm run test:runtime:unit` | 0 | **74 passed, 0 failed** |
| 7 | `npm run typecheck:guardrail` | 0 | **0 type errors** (added because the change is to a guardrail config file) |
| 8 | `cd server && npm run test:finance` | 0 | **25 passed, 0 failed** |
| 9 | `cd server && npm run test:dashboard` | 0 | **38 passed, 0 failed** |
| 10 | `cd server && npm run test:roles` | 0 | **142 passed, 0 failed** |
| 11 | `git diff --check` | 0 | clean (no whitespace errors) |

**Script-name substitutions and additions vs. the brief:** every script the brief named exists verbatim and was run as named (`npm ci`, `server` `typecheck`, `server` `test:orgdash`, `guardrail:test`, `test:runtime:unit`, `git diff --check`) — no substitution was required. Items 7–10 are *additions*: 7 because a guardrail config file changed; 8–10 because they are the focused suites for the domain-adjacent files examined (`financeDashboard.ts`, `dashboard.ts`, `roles.ts`).

**Non-disposable backend suite (`server:test:non-disposable`) not run — and not required:** it is mandated by the brief only "if implementation changes route or service code". No route or service code is changed by this task (§9), so the trigger condition is not met. This is recorded as a deliberate, condition-checked decision rather than an omission. Post-merge `main` CI remains the independent gate.

## 9. Files changed

| File | Change | Category |
|---|---|---|
| `scripts/architecture-guardrail/config/domain-map.json` | one value: `"server/src/routes/organizationDashboard.ts": "UNRESOLVED"` → `"core-org-clinic-membership"`; plus an additive `provenance.subsequentCorrections[]` array recording this task | static-analysis config |
| `docs/architecture/f2/ADR-F2-ORG-DASH-OWNERSHIP.md` | new — the ADR | docs |
| `docs/program/evidence/F2-ADR-ORG-DASH-002_ORGANIZATION_DASHBOARD_OWNERSHIP.md` | new — this document | docs |
| `docs/program/evidence/tooling/F2-ADR-ORG-DASH-002_{before,after}_scan_run{1,2}.json` | new — 4 checked-in scan reports | evidence |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | new dated entry + header update | docs |
| `docs/program/CURRENT_PHASE.md` | new dated entry | docs |
| `docs/program/phases/F2_MODULAR_BOUNDARIES.md` | new dated log row | docs |
| `docs/program/evidence/README.md` | new index row | docs |

**Not modified (verified byte-identical to `origin/main`):** every file under `server/src/**`, `src/**`, `server/prisma/**`, `scripts/architecture-guardrail/{lib,cli.ts,__tests__}`, `scripts/architecture-guardrail/config/scan-roots.json`, `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (the guardrail baseline), `docs/program/ARCHITECTURE_DECISIONS.md`, `package.json`, `server/package.json`, and all CI workflow files.

**Historical entries preserved.** The pre-existing `provenance.ambiguousFilesMappedToUnresolved[0]` record (which names this file's F0-003 collision) and the `provenance.corrections` block authored by F2-GUARDRAIL-VAL-002 are left **unmodified** — they remain accurate statements as of their own dates. The new record is added as a sibling `subsequentCorrections[]` array that explicitly states it supersedes without rewriting. `provenance` is typed `Record<string, unknown>` in `lib/types.ts:36` and is never read by the scanner, so the addition cannot affect scan behaviour; `fileCount` (249) and the key set are unchanged.

## 10. Domain-map before / after

```
BEFORE: "server/src/routes/organizationDashboard.ts": "UNRESOLVED"
AFTER:  "server/src/routes/organizationDashboard.ts": "core-org-clinic-membership"
```

| Metric | Before | After |
|---|---:|---:|
| `fileCount` field | 249 | 249 |
| actual `files` keys | 249 | 249 |
| distinct domains | 37 | 37 |
| entries valued `UNRESOLVED` | 1 | **0** |
| open F0-003 ownership collisions | 1 | **0** |

No domain is introduced. No key is added or removed. No wildcard, glob, or path-prefix entry is used — `domain-map.json` supports only exact `filePath → domainId` keys (`lib/classification.ts`: exact lookup, `?? 'UNRESOLVED'`, "ownership is never guessed").

## 11. Guardrail evidence

Command (run four times total — twice before the config change, twice after):

```
npm run guardrail:scan -- --repo-sha=46acae8415020cb0bd340fbc854c4187c43e3662 --deterministic \
  --out=docs/program/evidence/tooling/F2-ADR-ORG-DASH-002_{before|after}_scan_run{1|2}.json
```

| Field | BEFORE | AFTER |
|---|---:|---:|
| Files discovered / parsed / **skipped** | 247 / 247 / **0** | 247 / 247 / **0** |
| Total findings | 1,039 | **1,039** |
| `NEW` | 1,024 | **1,024** |
| `EXISTING` | 15 | **15** |
| **Errors / Warnings** | **0 / 0** | **0 / 0** |
| Exit code | 0 | 0 |
| `resolvedBaselineEdgeIds` | `["CDA-072"]` | `["CDA-072"]` (unchanged) |
| `baselineEdgeCount` | 71 | 71 |
| Findings where **caller** is `organizationDashboard.ts` | 5 | 5 |
| Findings where **target** is `organizationDashboard.ts` | **0** | **0** |
| Findings with `callerDomain: UNRESOLVED` | 5 | **0** |
| Findings with `ownerDomain: UNRESOLVED` | 0 | 0 |
| High-risk-domain-touching findings | **526** | **526** (identical set: 0 added, 0 removed, by finding ID) |

**Determinism:** two `--deterministic` runs before the change were byte-identical (415,403 bytes each, `cmp` clean); two after the change were byte-identical (415,483 bytes each, `cmp` clean). The 80-byte delta is exactly the five `"callerDomain"` string values growing from `UNRESOLVED` (10 chars) to `core-org-clinic-membership` (26 chars): 5 × 16 = 80.

### 11.1 Exact added / removed tuples

**Added: 0. Removed: 0.**

Computed by diffing the 5-field semantic tuple sets (`callerPath|callerSymbol|ownerDomain|targetModelOrSymbol|accessKind`) of both scans: the sets are equal. Finding IDs are likewise unchanged (0 added, 0 removed) because `computeFindingId` (`lib/findingId.ts`) hashes only those five fields and **deliberately excludes `callerDomain`**.

### 11.2 The exact five findings, before → after

All five are `callerPath: server/src/routes/organizationDashboard.ts`, `accessKind: import`, `baselineStatus: NEW`, `baselineEdgeId: null`, and retain their IDs:

| Finding ID | `callerSymbol` | `ownerDomain` | target | `callerDomain` before | `callerDomain` after |
|---|---|---|---|---|---|
| `78acdc8c7ff088da` | `AuthRequest` | `core-identity-access` | `middleware/auth.ts` | `UNRESOLVED` | `core-org-clinic-membership` |
| `4285663cbc690e31` | `authorize` | `core-identity-access` | `middleware/auth.ts` | `UNRESOLVED` | `core-org-clinic-membership` |
| `719208fa9920d414` | `canAccessOrganizationDashboard` | `core-permissions-roles` | `utils/roles.ts` | `UNRESOLVED` | `core-org-clinic-membership` |
| `acc8cc0a4f0697d3` | `default` | `core-shared-platform-infrastructure` | `db.ts` | `UNRESOLVED` | `core-org-clinic-membership` |
| `0729e383fef7532f` | `getDateRange` | `core-shared-platform-infrastructure` | `utils/helpers.ts` | `UNRESOLVED` | `core-org-clinic-membership` |

**Total findings whose `callerDomain` label changed: exactly 5.** No other finding in the 1,039-finding set differs in any field.

### 11.3 Acceptance criteria

| Criterion | Result | Proof |
|---|---|---|
| `organizationDashboard` must not remain `UNRESOLVED` unless the ADR concludes a split is a prerequisite | **met** | ADR §5: high-confidence single owner, split explicitly **not** a prerequisite (zero importers, only `export default router`) |
| No real violation suppressed | **met** | all 5 edges survive with identical IDs; total 1,039 → 1,039; 0 tuples removed. None of the 4 targets is `core-org-clinic-membership`, so **not one edge became same-domain and disappeared** |
| No wildcard allowlist | **met** | `domain-map.json` has no glob support (`lib/classification.ts` exact lookup); one exact key's value changed |
| No baseline change without exact accepted-contract evidence | **met** | `F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` untouched; `baselineEdgeCount` 71→71; `resolvedBaselineEdgeIds` `["CDA-072"]`→`["CDA-072"]` |
| No high-risk finding hidden | **met** | high-risk-touching set 526→526, identical by finding ID (0 added / 0 removed). Note 3 of the 5 relabelled findings *target* high-risk domains and all 3 remain present |
| Errors / skipped remain zero | **met** | 0/0 errors, 0 skipped, in all four runs |

### 11.4 What the guardrail cannot see (stated, not hidden)

`lib/edgeExtraction.ts` (`:8-10`) is "deliberately syntactic only… detectable symbol imports, **not semantic Prisma-model access**". The four cross-domain model-read families in §5.2 are therefore invisible to this scanner **both before and after** this change. This change neither hides nor exposes them. They are recorded here and in ADR §5.1 as explicitly open debt, and are the subject of follow-up task 1.

## 12. Security and tenant review

Every item below is proved by the fact that **no application source file is modified** (§9) — verifiable in one step via `git diff origin/main...HEAD --stat`, which touches no path under `server/src/`, `src/`, or `server/prisma/`.

| Claim | Verdict | Basis |
|---|---|---|
| Organization filter unchanged | **proved** | `organizationId` applied at `:75` and `:88`; file byte-identical to baseline |
| Clinic filter unchanged | **proved** | `scopeClinicIds` derivation at `:72–81`, re-asserted at `:88`; file unchanged |
| No cross-tenant query broadening | **proved** | no query is modified; all 13 remain `clinicId`/`primaryClinicId`-scoped to an authorized id |
| No new PII exposure | **proved** | response shape byte-identical; patient data is exposed only as **aggregate counts** (`prisma.patient.count`), never as records; `deletedAt: null` filters intact |
| No audit/logging regression | **proved** | the only logging is the pre-existing `console.error('[org-dashboard] error:', …)` at `:244`, unchanged; no audit-log call existed before (a read-only dashboard) and none is removed |
| No role expansion | **proved** | `authorize(['OWNER','ORG_ADMIN'])` and `canAccessOrganizationDashboard()` unchanged; 8 role assertions still pass (`test:orgdash`) |
| No authorization middleware weakening | **proved** | `middleware/auth.ts` and `utils/roles.ts` unmodified; `test:roles` 142/142 |
| No new direct model ownership violation | **proved, with a nuance** | no query is added or moved. The 4 pre-existing cross-domain reads (§5.2) are **re-labelled**, not created: they were already occurring under `UNRESOLVED`. This ADR makes them *more* visible, not less (ADR §5.1) |
| No official-integration or imaging impact | **proved** | this file touches no integration, webhook, external-calendar, WhatsApp/Instagram/SMS, or imaging path; the domain-map change affects only this one file's key |
| Blocking enforcement not enabled | **proved** | `cli.ts` unmodified; findings still exit 0; `guardrail:test` asserts the exit-code contract, 74/74 |

## 13. Migration and deployment classification

| Dimension | Status |
|---|---|
| Agent completed | **YES** |
| Tests passed | **YES** (§8, 11 commands, all exit 0) |
| PR opened | **YES** (§14) |
| Merged | **NO** — not performed, out of this task's authority |
| Deployed | **NO** — not performed |
| Production verified | **NO** — explicitly not claimable by this task |
| Prisma migration | **NONE** — no schema or migration file touched; none expected, none created |
| **Deployment classification** | **docs/config-only — no application deployment required.** The only non-documentation file changed is `scripts/architecture-guardrail/config/domain-map.json`, a static-analysis config consumed exclusively by the developer/CI-time `guardrail:scan` script. It is not imported by `server/src/**` or `src/**`, is not bundled, and is not read at application runtime. No backend or frontend artifact changes. |

## 14. PR

| Field | Value |
|---|---|
| PR | **#331** — https://github.com/MustafaBasol/DisKlinikCRM/pull/331 |
| Title | `docs+config(F2-ADR-ORG-DASH-002): resolve organizationDashboard ownership to core-org-clinic-membership` |
| Base | `main` @ `46acae8415020cb0bd340fbc854c4187c43e3662` |
| Head branch | `docs/f2-adr-org-dashboard-002-ownership` |
| Commits | 2 (the implementation commit, plus a PR-number reconciliation commit — the docs were authored before the number was known and provisionally said `#330`; corrected to `#331` rather than left wrong) |
| Merged | **NO** — this task does not merge |
| Deployed | **NO** — this task does not deploy |

Exact merge command, **for later human use — not executed by this task**:

```
gh pr merge 331 --squash --match-head-commit <HEAD_SHA>
```

`--match-head-commit` must be given the PR's head SHA as verified immediately before merging, so the merge aborts if anything was pushed in between.

## 15. Rollback

`git revert <implementation-commit-sha>` — a single, self-contained commit revert that restores `"UNRESOLVED"` and removes the `subsequentCorrections` provenance entry. No data, schema, migration, or deployment rollback is implied because none was performed. Reverting cannot break the application: the file is not read at runtime.

## 16. Remaining open risks

1. **Four cross-domain Prisma read families remain open debt** (`Appointment`, `Patient`, `TreatmentCase`, `Payment`) — ADR §5.1, follow-up task 1. Undetectable by the current guardrail (§11.4).
2. **Option D is not reached.** The file is a correctly-owned monolithic handler, not yet a contract-consuming composition shell.
3. **Route-level test gaps persist** (§7): no HTTP-level `403`/`400`/`500` assertions and no endpoint-level cross-organization leakage test for this specific route.
4. **ADR carries no registry number.** `docs/program/ARCHITECTURE_DECISIONS.md` is intentionally not modified; numbering is a program-owner action.
5. **B5 and B7 are MEDIUM / MEDIUM-HIGH confidence**, not HIGH (§6). The file-level decision is HIGH confidence because 6 of 8 blocks are unambiguous and no block resolves to `reporting-analytics`; a future Option D task will revisit B5's internal seam.
6. **CodeGraph could not be used authoritatively** in this worktree (§2). All conclusions rest on direct source reads, which is the stronger source, but this is recorded as a tooling limitation rather than glossed over.
7. **Enforcement remains not-ready.** This task closes one documented blocker; the 88 pre-classified-`NEW` findings and the `callerSymbol` match-key limitation (F2-GUARDRAIL-VAL-002 §9/§10) remain open.

## 17. Exact next task

**`F2-ORG-DASH-METRICS-CONTRACT`** (proposed ID, not yet scheduled) — execute ADR Option D: introduce accepted public read contracts for the appointment / patient / treatment-case / payment metric reads in block B5, converting `organizationDashboard.ts` from a correctly-owned monolithic handler into a correctly-owned composition shell. Prerequisites: this PR merged and post-merge `main` CI green.

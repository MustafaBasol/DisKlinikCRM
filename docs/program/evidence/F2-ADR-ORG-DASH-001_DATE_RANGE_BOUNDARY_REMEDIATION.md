# F2-ADR-ORG-DASH-001 — Remove financeDashboard→organizationDashboard Route-Module Coupling

**Phase:** F2 — Modular Monolith Boundary Remediation
**Task type:** Narrow, additive, backward-compatible boundary correction. Repository-only. No Prisma schema/migration change, no dependency added, no API response-shape change, no date-range semantic change, no authorization change.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `GUARDRAIL_DELTA_VERIFIED` / `PR_OPENED` (once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Isolated worktree/branch: `refactor/f2-org-dashboard-date-range-boundary` (local path intentionally omitted, matching this program's established convention).

---

## 1. Baseline verification

| Fact | Verified value |
|---|---|
| `git fetch origin` | run at task start |
| `origin/main` SHA | `61ca9d82507b3f24f3c943104cb6aa20ad13faa0` (PR #327's own merge commit, `docs/f1-004-p1-r2-production-closeout`) |
| Worktree created | `git worktree add -b refactor/f2-org-dashboard-date-range-boundary <path> origin/main`, HEAD confirmed `61ca9d8` before any file was written |
| `npm ci` (root) | succeeded, 77 packages |
| `npm ci` (server) | succeeded, 400 packages |
| F2-GUARDRAIL-IMPL-001 / F2-GUARDRAIL-VAL-001 | Confirmed complete via `docs/program/evidence/F2-GUARDRAIL-VAL-001_SIGNAL_QUALITY_VALIDATION.md`, which is the source of this task's assigned violation |
| F2 security blockers (F2-SEC-001/F2-SEC-002) | Confirmed `MERGED`/`MAIN_CI_PASSED` per `evidence/README.md`'s F2-SEC-002 post-merge-CI-confirmation row — not re-verified independently by this task (out of scope; this task makes no security-relevant change) |
| F2-GUARDRAIL-VAL-002 | Not present on `origin/main` @ `61ca9d8` (no such evidence file, no such tracker entry) — this task has no implementation dependency on it per its own brief, but must rebase onto current `main` and reconcile the tracker before finalizing the PR, per the brief's own parallel-work rule (§F below) |

## 2. Exact violation evidence (Investigation A)

Verified by direct source read (CodeGraph available and used first: `.codegraph/` present at repo root; `codegraph_explore` confirmed only these four files reference `getDateRange` anywhere under `server/src/`), not by name/heuristic.

- **Importing file:** `server/src/routes/financeDashboard.ts`
- **Imported route module:** `server/src/routes/organizationDashboard.ts`
- **Exact symbol:** `getDateRange`
- **Exact import line (before):** `server/src/routes/financeDashboard.ts:21` — `import { getDateRange } from './organizationDashboard.js';`
- **Every caller of the helper (before):**
  - `server/src/routes/financeDashboard.ts:90` (`GET /api/finance/dashboard` handler)
  - `server/src/routes/organizationDashboard.ts:94` (`GET /api/organization/dashboard` handler, its own local definition)
- **Every test covering its behavior (before):**
  - `server/src/tests/financeDashboard.test.ts` — imported from `'../routes/organizationDashboard.js'`, 7 dedicated assertions (`today`/`this_month`/`last_30_days`/`this_week`/`custom`/`custom`-throws/`unknown`-fallback)
  - `server/src/tests/organizationDashboard.test.ts` — imported from `'../routes/organizationDashboard.js'`, 9 dedicated assertions (same range set plus two `from <= to` invariant checks)
- **Domain ownership of each caller:**
  - `financeDashboard.ts` → `finance-advanced-compensation` (checked in `config/domain-map.json:74`)
  - `organizationDashboard.ts` → `UNRESOLVED` (checked in `config/domain-map.json:89`; F0-003 lists it under both `core-org-clinic-membership` and `reporting-analytics` — the sole genuine, program-owner-deferred ownership ambiguity documented in F2-GUARDRAIL-VAL-001 §9 collision #4, **not resolved by this task**, out of this task's own scope per its explicit "no broad reporting refactor" constraint)
- **Does the helper depend on Express request/response objects?** No — signature is `getDateRange(range: string, from?: string, to?: string): { from: Date; to: Date }`, pure function of its three string arguments plus the ambient wall-clock `new Date()`.
- **Does it perform DB access?** No — zero Prisma/`db.ts` references anywhere in its body.
- **Does it use clinic locale/timezone?** No — uses only `Date`'s local (server-process) getters/setters (`setHours`, `getDate`, `getDay`, `getFullYear`, `getMonth`); no `Intl.DateTimeFormat`, no `timeZone` parameter, no clinic-record lookup. (Contrast with `utils/helpers.ts`'s own `getZonedDateParts`/`formatClinicDateTime`, which do take an explicit `timeZone` — `getDateRange` was and remains timezone-naive, unchanged by this task.)
- **Exact default/validation semantics (unchanged, verified byte-identical below):** `range` defaults to `'this_month'` at each call site (route-level default, not inside the helper); unrecognized `range` values fall through the helper's own `default` branch (also `this_month`); `range: 'custom'` throws `Error('custom range requires from and to')` when either `from` or `to` is missing/empty; `to` boundaries always set to `23:59:59.999`; `from` boundaries for `today`/`this_week`/`last_30_days`/`this_month` always set to `00:00:00.000`.

## 3. Ownership decision (Investigation B)

**Chosen: Option 2 — relocate to the existing platform-shared date/query utility, `server/src/utils/helpers.ts`.**

`helpers.ts` is not a new location: it already houses a family of generic, request-context-optional date/time helpers with no domain-model coupling (`timeToMinutes`, `minutesToTime`, `getZonedDateParts`, `getZonedDateTimeParts`, `formatClinicDateTime`) and is itself already classified `UNRESOLVED` in `config/domain-map.json` (i.e. absent from the 179-entry map, not disputed-ownership) with 72 pre-existing cross-domain caller edges spanning many domains — independently confirmed by F2-GUARDRAIL-VAL-001 §9 as the largest instance of a documented, already-characterized "domain-map coverage gap," and explicitly recommended there (not applied by that task) as a future platform/shared classification target. `getDateRange` has zero reporting-specific business logic (no revenue/appointment/patient computation, no domain model, no clinic-scoping) — it is exactly the kind of domain-neutral helper that class of file already exists to hold, and it is consumed by two different, non-reporting-exclusive domains (`finance-advanced-compensation` directly, and `organizationDashboard.ts` whose own domain is itself the deferred org/reporting ambiguity).

**Rejected options and why:**

- **Option 1 (move to an existing reporting-domain utility location, e.g. `server/src/services/reports/`):** Rejected. That directory's existing member (`revenueByPeriodQuery.ts`) holds reporting-*specific* business logic (revenue aggregation, clinic-scope SQL) extracted from `routes/reports.ts` — a materially different shape from a domain-neutral date-math helper. Classifying `getDateRange` as reporting-owned would also implicitly presuppose the very ownership question (`organizationDashboard.ts`: org-administration vs. reporting) that F2-GUARDRAIL-VAL-001 §9 explicitly deferred to a program-owner ADR — this task's brief explicitly has no dependency on that resolution and must not decide it by a side effect of where a helper function lands.
- **Option 3 (minimal reporting public-contract facade):** Rejected. A facade is the right shape when a *reporting-owned* capability is consumed *across reporting subdomains*. Neither premise holds here: the helper is not reporting-owned (see above), and its second consumer (`financeDashboard.ts`) is not a reporting subdomain — it is a wholly separate `finance-advanced-compensation` route. Introducing a facade would be an unneeded new abstraction layer for a helper whose entire body is generic `Date` arithmetic.
- **Keeping the route-to-route import:** Rejected — this is the violation being closed; route modules must not be reused as utility/public-contract modules (task constraint 2).
- **Duplicating the helper (one copy per route):** Rejected — reintroduces exactly the kind of "two independently-maintained copies" risk this program has explicitly avoided elsewhere (see `revenueByPeriodQuery.ts`'s own header comment, which cites the identical rationale for its own extraction).
- **New generic "common" dumping ground (e.g. a fresh `utils/dateRange.ts` or `utils/common.ts`):** Rejected in favor of the *existing* `utils/helpers.ts` file, which already holds this exact category of generic date helper — adding a new file would fragment, not consolidate, and Option 2 as specified in the brief calls for an *existing* platform-shared location.
- **Moving organization-dashboard route logic wholesale, changing date semantics, or adding a new service/framework layer:** None of these were considered viable — all four are explicitly out of this task's scope per its own constraints.

## 4. Implementation (Investigation C)

- **`server/src/utils/helpers.ts`:** added `getDateRange` immediately after `minutesToTime` (its nearest pure-date-helper sibling), verbatim body relocated unchanged (only a one-line provenance comment added — no logic, branch, boundary, or default changed).
- **`server/src/routes/organizationDashboard.ts`:** removed the local `export function getDateRange(...)` definition (11→0 lines of helper body remaining in this file); added `import { getDateRange } from '../utils/helpers.js';`; its own internal caller (`:62`, was `:94`) is otherwise byte-identical, still calling `getDateRange(String(range), ...)` the same way.
- **`server/src/routes/financeDashboard.ts`:** import specifier changed from `'./organizationDashboard.js'` to `'../utils/helpers.js'`; caller site (`:90`) unchanged.
- **Old exported route helper deleted:** yes — no backward-compatible internal caller remains inside `organizationDashboard.ts` other than its own (now-relocated) import, so nothing depends on the route file continuing to export it. No compatibility re-export was added, per the task's explicit "route modules must not be reused as utility/public-contract modules" constraint — a re-export would have re-created exactly that pattern.
- **Circular dependencies:** none introduced — `utils/helpers.ts` imports only `middleware/auth.ts` (type-only `AuthRequest`), `db.ts`, and `utils/counterStore.ts`; neither route file is imported by `utils/helpers.ts`.
- **API/runtime behavior:** unchanged — see §6 below.

## 5. Import graph

**Before:**
```
routes/financeDashboard.ts  --import getDateRange-->  routes/organizationDashboard.ts (local definition)
routes/organizationDashboard.ts  (defines getDateRange locally, uses it internally)
```

**After:**
```
routes/financeDashboard.ts       --import getDateRange-->  utils/helpers.ts
routes/organizationDashboard.ts  --import getDateRange-->  utils/helpers.ts
```

No route imports another route's module for `getDateRange` after this change. `utils/helpers.ts` imports neither route file — no cycle.

## 6. Behavior compatibility

Function signature, branch structure, and every boundary value are byte-identical to the pre-move source (diffed by inspection: the relocated body in `utils/helpers.ts` §Investigation C is a verbatim copy). No caller's argument-passing changed. No API response shape changed — both routes still return the exact same JSON they did before; `dateRange.from`/`dateRange.to` are consumed identically in both handlers' Prisma `where` clauses (unchanged code, unchanged import target only). No authorization/validation code touched (`authorize([...])`, `canAccessOrganizationDashboard(...)`, `normalizeRole(...)`, `resolveClinicScope(...)` all unmodified). No timezone/locale behavior changed — the helper was and remains process-local-time-based, not clinic-timezone-aware.

## 7. Tests (Investigation D)

Both existing dedicated test files were updated (import path only) and re-run — no test assertion was weakened, removed, or added, since the required behavioral proof (default range, explicit range, invalid-input, boundary values, both dashboards receiving identical semantics) was already fully covered pre-existing and remains word-for-word unchanged:

| File | Change | Result |
|---|---|---|
| `server/src/tests/financeDashboard.test.ts` | `import { getDateRange } from '../routes/organizationDashboard.js';` → `'../utils/helpers.js'`; header comment updated to name the new shared location | 25/25 passed |
| `server/src/tests/organizationDashboard.test.ts` | same import-path change | 35/35 passed |

**Exact commands run (from the worktree root unless noted):**

| Command | Purpose | Result | Exit |
|---|---|---|---|
| `cd server && npm run typecheck` | server typecheck (`npx prisma generate && tsc --noEmit`) | clean, no errors | 0 |
| `cd server && npm run test:finance` | focused finance-dashboard tests | 25 passed, 0 failed | 0 |
| `cd server && npm run test:orgdash` | focused organization-dashboard tests | 35 passed, 0 failed | 0 |
| `npm run guardrail:test` | architecture-guardrail's own unit suite (unchanged by this task) | 74 passed, 0 failed | 0 |
| `git diff --check` | whitespace/conflict-marker check | clean | 0 |

No dedicated "reporting/date-range utility" test target exists as a separate package script (`getDateRange` has never had one — it was always tested via the two consuming routes' own suites, unchanged by this task); both consuming-route suites above are exactly that coverage, and both prove the helper's own behavior in addition to each route's surrounding logic.

**"No route-module import remains" / "no new cross-domain edge introduced":** proved mechanically in §8 below via the guardrail's own exact-edge extraction, not asserted from source reading alone.

## 8. Guardrail before/after (Investigation E)

Methodology: `git stash`/`git stash pop` inside the task worktree to obtain two scans of the identical commit (`61ca9d82507b3f24f3c943104cb6aa20ad13faa0`) — one with this task's changes absent (BEFORE), one with them present (AFTER) — eliminating any risk of comparing against a stale or drifted baseline checkout.

```
npm run guardrail:scan -- --repo-sha=61ca9d82507b3f24f3c943104cb6aa20ad13faa0 --deterministic --out=<scratch>/before_scan.json   # pristine, stashed
npm run guardrail:scan -- --repo-sha=61ca9d82507b3f24f3c943104cb6aa20ad13faa0-WIP --deterministic --out=<scratch>/after_scan.json  # implementation applied
```

| Metric | BEFORE | AFTER |
|---|---:|---:|
| Files discovered/parsed/skipped | 247 / 247 / 0 | 247 / 247 / 0 |
| Total findings | 1,031 | 1,031 |
| Errors | 0 | 0 |
| Warnings | 0 | 0 |
| `baselineComparison.newCount` | 1,018 | 1,018 |
| Findings touching a high-risk domain (`core-tenant-security`/`core-identity-access`/`core-permissions-roles`/`core-security-incident-detection`/`core-config-secrets`/`core-audit-activity`/`core-privacy-consent-retention-dsr`) | 499 | 499 (byte-identical set) |

**Exact-edge-tuple diff** (`(callerPath, callerSymbol, ownerDomain, targetModelOrSymbol, accessKind)`, programmatic set diff, not eyeballed):

- **Removed (1):** `server/src/routes/financeDashboard.ts | getDateRange | UNRESOLVED | routes/organizationDashboard.ts | import` — **this is the exact violating edge F2-GUARDRAIL-VAL-001 classified `REAL_BOUNDARY_VIOLATION`.**
- **Added (1):** `server/src/routes/financeDashboard.ts | getDateRange | UNRESOLVED | utils/helpers.ts | import` — a same-shape edge (`callerSymbol`/`accessKind` unchanged, only the target file changed), joining the already-existing 72-member family of edges targeting `utils/helpers.ts` (F2-GUARDRAIL-VAL-001 §9's own already-characterized, already-classified-mostly-`B`/`C` domain-map coverage-gap bucket) — not a new distinct violation category.
- **AFTER findings still targeting `routes/organizationDashboard.ts`: 0** — confirms no route-to-route edge remains anywhere in the scanned scope.

**Proof this is not merely allowlisted:** no baseline file, allowlist, or `config/domain-map.json` entry was modified by this task (`git status` scoped to `scripts/architecture-guardrail/` and `config/` — no diff). The violating edge is gone because the underlying import no longer exists between two route files — a structural fix, not a suppression. The new edge's own `baselineStatus` is `NEW` (not artificially marked `EXISTING`), identical treatment to before.

**No new violation category:** the added edge is target-shape-identical to 72 pre-existing, already-sampled-and-mostly-legitimate edges into the same file (F2-GUARDRAIL-VAL-001 §7/§9) — it does not introduce a new `(ownerDomain, targetModelOrSymbol, accessKind)` family, only one more instance of an already-large existing one.

**Scan errors/skipped files:** 0 in both runs. **Tenant/security findings:** the 499-count high-risk-domain-touching set is byte-identical before/after (verified by direct count, not sampled) — neither `core-tenant-security` nor any other high-risk domain's finding set changed.

`npm run guardrail:test` (74/74, §7 above) confirms the scanner/classifier code itself is untouched and its own regression suite is unaffected.

## 9. Documentation (Investigation F)

Evidence file: this document, plus updates to `docs/program/evidence/README.md`, `docs/program/CURRENT_PHASE.md`, and `docs/program/NORAMEDI_MASTER_TRACKER.md` (all three follow this program's established append-only/prepend convention — no prior entry rewritten in place).

**Parallel-work reconciliation with F2-GUARDRAIL-VAL-002:** at this task's own baseline (`origin/main` @ `61ca9d82507b3f24f3c943104cb6aa20ad13faa0`), no `F2-GUARDRAIL-VAL-002` evidence file, tracker entry, or branch exists anywhere in this repository or its remote (`git log --all --grep`, `gh pr list` scoped search — none found). Per this task's own instruction, this PR is not finalized until: (1) `git fetch origin` is re-run, (2) this branch is rebased onto whatever `main` looks like after Agent A's F2-GUARDRAIL-VAL-002 work merges, (3) all focused tests and guardrail scans above are re-run against the rebased head, (4) tracker entries are reconciled without deleting Agent A's entry, and (5) any domain-map interaction is explicitly resolved. **As of this evidence file's authoring, step (2)'s prerequisite (F2-GUARDRAIL-VAL-002 merged) has not yet occurred** — this is recorded honestly as a pending precondition, not silently skipped.

## 10. Security and tenant review (Investigation G)

- **Authorization middleware:** unchanged — `authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING'])` (finance) and `authorize(['OWNER', 'ORG_ADMIN'])` + `canAccessOrganizationDashboard(...)` (org dashboard) are byte-identical to before this task.
- **Tenant-scoping queries:** unchanged — `resolveClinicScope(...)` (finance) and the `organizationId`/`allowedClinicIds`-scoped `prisma.clinic.findMany` (org dashboard) are byte-identical; neither was read for modification, only left untouched.
- **DB query change:** none — `getDateRange` itself performs no DB access before or after this task (§2 above); no other line in either route file was touched.
- **PII/logging:** no logging statement touched; no PII read, written, or newly exposed.
- **Cross-clinic behavior:** unchanged — both routes' clinic/organization scoping logic is untouched code.
- **API contract:** unchanged — no request/response shape, status code, or error-message text (`'Invalid date range parameters'`, `'custom range requires from and to'`) was altered.
- **Migration:** none — `server/prisma/` untouched (`git status` scoped to that path: no diff).

## 11. Rollback (Investigation H)

`git revert <implementation-commit-sha>` restores the pre-existing imports (`financeDashboard.ts` back to `./organizationDashboard.js`, `organizationDashboard.ts`'s local `getDateRange` definition restored) and removes the relocated function from `utils/helpers.ts` — a single, self-contained commit revert. No data or schema rollback is needed or implied, since none was performed.

## 12. Accepted findings vs. rejected/unverified claims

**Accepted (verified in this document):** the exact violating import/edge and every one of its callers/tests (§2); the ownership decision and why the two rejected options are inferior (§3); the relocation is behavior-preserving byte-for-byte (§4, §6); no circular dependency introduced (§4); both consuming test suites pass unchanged in assertion content, updated only in import path (§7); the guardrail's own before/after exact-edge diff proves the specific violation is gone, not merely allowlisted, and that no new violation category or tenant/security-finding-set change resulted (§8); no security/tenant/API/migration-relevant line was touched (§10).

**Explicitly not claimed:** that `organizationDashboard.ts`'s own dual-domain (`core-org-clinic-membership`/`reporting-analytics`) ownership ambiguity (F2-GUARDRAIL-VAL-001 §9 collision #4) is resolved — it is not, and this task's brief explicitly does not require it to be. That the broader 23-file/~250-finding domain-map coverage gap (F2-GUARDRAIL-VAL-001 §9) is closed — it is not; this task adds one more edge to that already-characterized, already-mostly-benign bucket, consistent with 72 pre-existing ones, and closes none of the others. That CI has been re-run on the actual opened PR head, or that this branch has been rebased onto a post-F2-GUARDRAIL-VAL-002 `main` — neither has happened as of this evidence file's authoring (§9 above records this honestly as a pending precondition). Merged/deployed/production-verified status (all explicitly `NOT_*`).

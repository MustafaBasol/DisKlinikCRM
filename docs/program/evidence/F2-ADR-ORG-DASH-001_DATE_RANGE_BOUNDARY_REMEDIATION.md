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

**Parallel-work reconciliation with F2-GUARDRAIL-VAL-002:** at this task's own baseline (`origin/main` @ `61ca9d82507b3f24f3c943104cb6aa20ad13faa0`), no `F2-GUARDRAIL-VAL-002` evidence file, tracker entry, or branch exists anywhere in this repository or its remote (`git log --all --grep`, `gh pr list` scoped search — none found). Per this task's own instruction, this PR is not finalized until: (1) `git fetch origin` is re-run, (2) this branch is rebased onto whatever `main` looks like after Agent A's F2-GUARDRAIL-VAL-002 work merges, (3) all focused tests and guardrail scans above are re-run against the rebased head, (4) tracker entries are reconciled without deleting Agent A's entry, and (5) any domain-map interaction is explicitly resolved. **As of this evidence file's authoring, step (2)'s prerequisite (F2-GUARDRAIL-VAL-002 merged) has not yet occurred** — this is recorded honestly as a pending precondition, not silently skipped. **Corrected 2026-08-06, §13 below (F2-ADR-ORG-DASH-001-R2): F2-GUARDRAIL-VAL-002 has since merged as PR #329 — all five steps above are now complete; see §13 for the actual rebase evidence.** (An earlier R1 addendum recorded a re-check on 2026-08-06 that found the precondition still unmet at that time and made no code change; superseded by R2 and not preserved verbatim in this file's history, since R2 performs the actual rebase R1 could only describe as pending.)

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

**Explicitly not claimed:** that `organizationDashboard.ts`'s own dual-domain (`core-org-clinic-membership`/`reporting-analytics`) ownership ambiguity (F2-GUARDRAIL-VAL-001 §9 collision #4) is resolved — it is not, and this task's brief explicitly does not require it to be; this remains the one genuinely open item. Merged/deployed/production-verified status (all explicitly `NOT_*`).

**Corrected 2026-08-06 (F2-ADR-ORG-DASH-001-R2, §13 below):** the two claims immediately above about a broader domain-map coverage gap, and CI/rebase not yet having happened, are now stale and are corrected, not merely superseded silently. F2-GUARDRAIL-VAL-002 (PR #329, merged) closed the then-broader domain-map completeness gap entirely — independently re-verified at 0 of 247 scan-root files unmapped (was 70 pre-VAL-002; the "23-file" figure cited above referred to a still-earlier, already-superseded VAL-001-era count). `server/src/utils/helpers.ts` specifically is no longer `UNRESOLVED`: `domain-map.json` now maps it to the real `core-shared-platform-infrastructure` domain. This branch has since been rebased onto `origin/main` (post-VAL-002), and all tests/guardrail scans have been re-run against the rebased head — see §13.

## 13. Rebase onto post-F2-GUARDRAIL-VAL-002 main (F2-ADR-ORG-DASH-001-R2)

**Precondition verification.** `git fetch origin --prune` re-run. `gh pr view 329`: `state: MERGED`, `mergedAt: 2026-08-06T10:32:43Z`, `mergeCommit.oid: 99436e5ba0823fcc82d86eb9b731dc5dffd04ccb`. `git merge-base --is-ancestor 99436e5... origin/main` confirmed the merge commit is (as of this task) the exact tip of `origin/main` — trivially its own ancestor. Post-merge `main` CI (`gh run list --branch main`): workflow `ci-main-and-nightly`, run `31093678375`, `headSha 99436e5...`, `status completed`, `conclusion success`. All three named preconditions (merged, ancestor-of-main, CI success) independently confirmed before rebasing, not assumed.

**Rebase.** `git rebase origin/main` on branch `refactor/f2-org-dashboard-date-range-boundary` (old head `8037002a5fdf188c63829bae5315cb86571b0c3c`), rebasing 2 commits onto `99436e5`. Conflicts in `docs/program/CURRENT_PHASE.md` and `docs/program/NORAMEDI_MASTER_TRACKER.md` on the first commit (`67a3ab7`, the real implementation commit) — both are additive-narrative program-tracker files where F2-GUARDRAIL-VAL-002's own entry (added directly to `origin/main`) and this task's original entry both needed to survive; resolved by keeping both entries (VAL-002's entry, then this task's original entry) and correcting this task's own stale in-line claims about `utils/helpers.ts`'s domain-map status and the domain-map coverage gap to match the post-VAL-002 map (see §9/§12 corrections above and the `NORAMEDI_MASTER_TRACKER.md` F2 phase-summary row, which now cites VAL-002's closure of the coverage gap directly). `docs/program/evidence/README.md` merged cleanly (no conflict — VAL-002 and this task added independent table rows). `scripts/architecture-guardrail/config/domain-map.json` merged cleanly with **no conflict at all** — VAL-002's 72 additions and this task's code-only change never touched the same lines; this task's own commits never edited `domain-map.json`. The second, pre-existing commit on this branch (`8037002`, `F2-ADR-ORG-DASH-001-R1`, a no-op precondition-recheck commit authored before F2-GUARDRAIL-VAL-002 existed) conflicted on the same two tracker files for the same reason, but its entire textual content — "F2-GUARDRAIL-VAL-002 does not yet exist," "23-file coverage gap," "`utils/helpers.ts` still `UNRESOLVED`" — was independently false as of this task's own fetch, so rather than reconciling stale prose it was dropped via `git rebase --skip`; this §13 section is its replacement, stating only independently-reverified current facts. New head after rebase: `f762d6d8ecda5970399ed50f560ec6663403e329` (before this evidence commit is added on top). `git merge-base --is-ancestor origin/main HEAD` confirms a clean rebase (no divergent history left).

**Final mapped domain of `server/src/utils/helpers.ts`.** Direct read of `scripts/architecture-guardrail/config/domain-map.json` at the rebased head: `"server/src/utils/helpers.ts": "core-shared-platform-infrastructure"` — resolved by F2-GUARDRAIL-VAL-002 (introducing that domain), not `UNRESOLVED`. `server/src/routes/organizationDashboard.ts` remains `"UNRESOLVED"` in the same file — deliberately, per VAL-002's own note, pending the still-not-performed program-owner ADR for its dual-domain ambiguity; this is the one finding from the original ADR brief that genuinely remains open, and is stated as such rather than silently dropped.

**Re-run verification, all against the rebased head:**
- `cd server && npm run typecheck` — clean (Prisma Client regenerated, `tsc --noEmit` no errors).
- `cd server && npm run test:finance` — **25/25 passed**.
- `cd server && npm run test:orgdash` — **35/35 passed**.
- `npm run guardrail:test` — **74/74 passed** (scanner/classifier code itself untouched by this task).
- `npm run test:runtime:unit` — **74/74 passed** (`orchestratorUnit` suite; unrelated to this task's change, re-run per the assigning brief's explicit checklist).
- `git diff origin/main...HEAD --check` — clean, no whitespace errors.

**Deterministic full guardrail scan, run twice.** `npx tsx scripts/architecture-guardrail/cli.ts --deterministic`, invoked twice independently against the rebased head, output byte-diffed: **identical**. Each run: exit `0`, `247/247` files discovered and parsed, `0` skipped, `0` errors, `0` warnings, `1,039` total findings (`1,024` `NEW` / `15` `EXISTING`), `resolvedBaselineEdgeIds: ["CDA-072"]`.

**Before/after exact-edge diff**, isolating exactly this task's own change from everything F2-GUARDRAIL-VAL-002 already contributed: before = detached checkout of `99436e5` (origin/main tip, i.e. post-VAL-002 but pre-this-task's-fix) scanned `--deterministic`; after = the rebased branch head (same scan, §above); both scans' `[callerPath, callerSymbol, ownerDomain, targetModelOrSymbol, accessKind]` tuples diffed programmatically (not eyeballed). Before: `1,038` findings (`1,023` `NEW`/`15` `EXISTING`). After: `1,039` findings (`1,024` `NEW`/`15` `EXISTING`). Exactly one edge removed:

- `server/src/routes/financeDashboard.ts|getDateRange|UNRESOLVED|routes/organizationDashboard.ts|import` — **the violation itself, now gone.**

Exactly two edges added:

- `server/src/routes/financeDashboard.ts|getDateRange|core-shared-platform-infrastructure|utils/helpers.ts|import`
- `server/src/routes/organizationDashboard.ts|getDateRange|core-shared-platform-infrastructure|utils/helpers.ts|import`

Net `+1` (not `+0`) is expected and explained, not anomalous: pre-fix, `organizationDashboard.ts` defined `getDateRange` locally and so generated no import-edge for it; post-fix, it too imports the relocated helper, so it gains an edge symmetric to `financeDashboard.ts`'s. Zero other edges changed anywhere in the 1,038/1,039-finding sets.

**Proof requirements, each independently checked against the diffed data above:**
1. **`financeDashboard` → `organizationDashboard` edge is absent:** confirmed — the removed edge above was the only edge ever targeting `routes/organizationDashboard.ts`; findings targeting `organizationDashboard.ts` went `1 → 0` (direct count, both scans).
2. **Replacement edge targets the final mapped domain:** confirmed — both added edges carry `ownerDomain: "core-shared-platform-infrastructure"`, exactly `utils/helpers.ts`'s domain-map entry (above), not `UNRESOLVED` and not any other domain.
3. **No `REAL_BOUNDARY_VIOLATION` introduced:** the two added edges are same-shape members of the pre-existing, already-characterized "generic platform-shared utility, many-domain caller" family targeting `utils/helpers.ts` (`79 → 81` findings targeting that file, before/after — a `+2` consistent with exactly the two added edges, no other change); this is the same edge shape VAL-001's classification taxonomy already treats as `EXPECTED_PLATFORM_SHARED_EDGE` for the rest of that family, not a novel violation category. `errorCount: 0` in both scans — the scanner itself raised no findings-independent error.
4. **Errors/skipped remain zero:** confirmed — `errorCount: 0`, `warningCount: 0`, `filesSkipped: 0` in both the before and after scans.
5. **No high-risk finding is hidden:** the high-risk-domain set (`core-tenant-security`, `core-identity-access`, `core-permissions-roles`, `core-security-incident-detection`, `core-config-secrets`, `core-audit-activity`, `core-privacy-consent-retention-dsr`, per F2-GUARDRAIL-VAL-001 §definitions) touching count is **`526 → 526`, byte-identical** (direct count, not sampled) — neither the removed nor the two added edges touch any high-risk domain on either side (`finance-advanced-compensation`, `core-shared-platform-infrastructure` are both outside that set), so this change cannot have hidden or newly exposed a high-risk finding. `resolvedBaselineEdgeIds` unchanged (`["CDA-072"]` both scans) — no baseline-file interaction.

**Stale documentation corrected (not left standing).** §9 and §12 above now carry explicit `Corrected 2026-08-06` notes retracting: (a) the claim that no `F2-GUARDRAIL-VAL-002` PR/branch/evidence exists (PR #329, merged, cited throughout this section); (b) the "23-file"/broader domain-map coverage gap being still-current (VAL-002 closed it to 0/247 unmapped); (c) `utils/helpers.ts` remaining `UNRESOLVED` (it is now `core-shared-platform-infrastructure`, per the domain-map read above). The R1 no-op commit's equivalent stale claims in `docs/program/CURRENT_PHASE.md` and `docs/program/evidence/README.md` were not carried forward at all (that commit was dropped via `git rebase --skip`, §above) rather than corrected in place. `organizationDashboard.ts`'s own dual-domain ownership ADR is the one item that remains genuinely open post-VAL-002 (VAL-002 deliberately left it `UNRESOLVED`, confirmed by direct read above) — this is stated as still-open, not incorrectly marked resolved.

**PR review state at rebase time:** 1 automated review (`copilot-pull-request-reviewer`, `COMMENTED`, submitted against the pre-rebase head `67a3ab74a7a0909cbcb59299fda9785d5293b32d`, no line-level comments — "reviewed 9 out of 9 changed files ... generated no comments"). **0 inline review threads** (`gh api graphql reviewThreads.totalCount: 0`). No human review yet.

**Task status: `AGENT_COMPLETED` / `TESTS_PASSED` / `GUARDRAIL_DELTA_VERIFIED` / `REBASED_ONTO_POST_VAL_002_MAIN` / `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.** Per this task's explicit instruction, the new head is pushed but **not merged** — external review/merge decision remains a separate, later step. **Exact next task:** the program-owner ADR for `organizationDashboard.ts`'s own dual-domain ownership ambiguity (F2-GUARDRAIL-VAL-001 §9 collision #4, still open, unaffected by this task) remains the next open F2 guardrail-signal-quality item; otherwise this PR is ready for external review and merge consideration.

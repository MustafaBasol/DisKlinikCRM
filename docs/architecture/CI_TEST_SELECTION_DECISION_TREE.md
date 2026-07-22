# CI Test Selection — Decision Tree

Task: ARCH-TEST-001 · Companion to: [`AFFECTED_MODULE_TEST_STRATEGY.md`](AFFECTED_MODULE_TEST_STRATEGY.md), [`AFFECTED_MODULE_TEST_MATRIX.md`](AFFECTED_MODULE_TEST_MATRIX.md)

**Status: PROPOSED / NOT ACTIVE.** This is a specification for a future CI workflow. No `.github/workflows/*.yml` file was created or modified to produce this document. No step below has been executed by this task.

Baseline: authored against `origin/main` `3b4ec9d468f6f93dc67aae5c1fe8fbfe6c7ce80c`, rebaselined 2026-07-22 to `7c2aea5a084c38de5732fda65ca0874aa8d46024` (PR #208 merge, `docs/operations/pilot/**` only — no technical impact; see `AFFECTED_MODULE_TEST_STRATEGY.md`'s rebaseline note for the full drift review).

---

## 1. Inputs

- `BASE`: the PR's target branch tip (e.g. `origin/main`)
- `HEAD`: the PR's current commit
- `CHANGED_FILES` = `git diff --name-only BASE...HEAD`

## 2. Algorithm (pseudocode)

```
modules = {}                      # set of affected modules
fullSuite = false
fullSuiteReasons = []             # list of (rule, file) pairs — always populated when fullSuite=true

for file in CHANGED_FILES:
    match = longest_prefix_match(file, MATRIX_SECTION_3_TABLE)

    if match is None:
        fullSuite = true
        fullSuiteReasons.append(("11.1 unmapped file", file))
        continue

    if match in SHARED_PLATFORM_FANIN_FILES:      # middleware/*, clinicScope.ts, roles.ts, db.ts, index.ts
        fullSuite = true
        fullSuiteReasons.append(("11.2 shared fan-in file", file))
        continue

    if file starts with "server/prisma/schema.prisma" or "server/prisma/migrations/":
        fullSuite = true
        fullSuiteReasons.append(("11.3 schema/migration change", file))
        continue

    if file == "server/package.json" or file == "package.json":
        if scripts block changed:                 # diff the "scripts" key specifically, not the whole file
            fullSuite = true
            fullSuiteReasons.append(("11.4 script-block change", file))
            continue

    if file == "src/services/api.ts":
        fullSuite = true
        fullSuiteReasons.append(("11.1-equivalent: single shared frontend client", file))
        continue

    modules.add(match.module)

    for escalationRule in MATRIX_SECTION_5_TABLE:
        if file in escalationRule.triggerFiles:
            modules.update(escalationRule.alsoRun)

if not fullSuite and len(modules) > 5:
    fullSuite = true
    fullSuiteReasons.append(("11.5 more than 5 modules affected", list(modules)))

if not fullSuite:
    for file in CHANGED_FILES:
        matches = all_matching_modules(file, MATRIX_SECTION_3_TABLE)
        if len(matches) > 1:
            fullSuite = true
            fullSuiteReasons.append(("11.6 file matched by >1 module — matrix likely stale", file))

if fullSuite:
    commandSet = FULL_SUITE_COMMAND_SET     # §4 below
else:
    commandSet = union(MATRIX_SECTION_2[m].mandatoryRegressionSet for m in modules)

run(commandSet)
emit(PR_EVIDENCE_BLOCK)              # §5 below
```

## 3. Step-by-step walkthrough

1. **Compute `CHANGED_FILES`.** Use the PR's merge-base diff, not a two-dot diff against a possibly-stale local branch — consistent with how a GitHub Actions `pull_request` trigger already exposes `github.event.pull_request.base.sha`.
2. **Map each file to a module** via `AFFECTED_MODULE_TEST_MATRIX.md` §3's path-prefix table, encoded as a committed manifest (JSON/YAML — format left to the implementation task, not prescribed here per the "no new tool" constraint: a plain data file read by a shell/Node script, not a new dependency).
3. **Apply escalation** (`AFFECTED_MODULE_TEST_MATRIX.md` §5) — a triggering file adds modules beyond its own, it never removes them.
4. **Apply fallback rules** (`AFFECTED_MODULE_TEST_MATRIX.md` §11, restated in §2's pseudocode above) — any single fallback condition forces the entire run to the full suite; fallback conditions are cumulative-OR, never overridden by a smaller matched module set.
5. **Union the mandatory regression sets** of every affected module (or use the full-suite command set if any fallback fired).
6. **Execute.** DB-required commands (`AFFECTED_MODULE_TEST_MATRIX.md` marks these per-module) only run if the CI environment has provisioned a disposable Postgres (a prerequisite this task does not implement — strategy doc §15 item 3); if not provisioned, they are marked `BLOCKED`, not silently skipped (§5 below).
7. **Emit the PR evidence block** (§5) as a required part of the check's output, whether the check is currently advisory (shadow mode, strategy doc §15 item 5) or blocking.

## 4. Full-suite command set

When any §2/§11 fallback condition fires, run the equivalent of:

```
cd server && npx prisma generate && npm run test          # aggregate 56-script backend chain
cd server && npm run typecheck
root:  npm run build
root:  npm run test:vitest
root:  npm run test:dicom-helpers && npm run test:onboarding-helpers && npm run test:pairing-poller \
       && npm run test:booking-widget-helpers && npm run test:clinic-bulk-export-selection \
       && npm run test:communication-consent-matrix
```

Plus every currently-orphaned script and no-script test file (`AFFECTED_MODULE_TEST_MATRIX.md` §2's per-module "no script" / "not in aggregate" callouts — `test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`, the 8 no-script files via direct `tsx`, and `test:kvkk-high006-db-verification` if a disposable Postgres is available) — **full suite means everything reachable, not just the aggregate `npm run test` chain**, since that chain alone already excludes 14+ files per F0-005's own finding.

## 5. Evidence required in PR descriptions

A future CI implementation must produce (as a check-run summary or an auto-posted PR comment — not a manually-authored section a human is trusted to remember) a block containing:

```
## Affected-Module Test Selection

**Changed files:** <count> (<list, or link to the diff if long>)
**Computed affected modules:** <list, or "FULL SUITE" with the triggering rule(s) from §11>
**Commands executed:**
  - <command 1>: PASS (N assertions) | FAIL (N assertions, M failed) | BLOCKED (<reason>)
  - <command 2>: ...
**Full-suite fallback:** <yes/no> — <if yes: which §11 rule and which file triggered it>
**DB-required tests:** <list> — <RAN against disposable Postgres | BLOCKED: no DATABASE_URL provisioned in this environment>
**High-risk escalation applied:** <yes/no> — <if yes: which §5 escalation rule and trigger file>
```

This mirrors F0-005's own evidence discipline (§9 of its evidence doc: "0 confirmed product-runtime defects... nothing was fixed, weakened, or skipped to make any of these go away") — a `BLOCKED` line is an honest, required outcome, not a failure of the CI design. A check that silently shows green while a DB-required test never ran is a worse outcome than one that visibly shows `BLOCKED`.

## 6. What this document does not specify

- The exact YAML/workflow syntax to implement §2-§4 (left to the implementation task, strategy doc §15).
- How the disposable Postgres prerequisite is provisioned (Docker service container, ephemeral RDS, etc. — a separate, blocked prerequisite per strategy doc §15 item 3).
- Whether this becomes a required or advisory check, and for how long it stays in shadow mode before promotion (strategy doc §15 item 5) — an operational rollout decision for whoever implements this, not a design question this task resolves.
- Any change to `windows-bridge-pr.yml` (module 14's existing, working, separate CI) — explicitly out of scope, cited only as prior art (`AFFECTED_MODULE_TEST_MATRIX.md` §2.14).

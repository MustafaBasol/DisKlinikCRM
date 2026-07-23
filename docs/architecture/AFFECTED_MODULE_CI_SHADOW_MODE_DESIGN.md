# Affected-Module CI Shadow-Mode Implementation Design

Task: ARCH-TEST-002 · Type: implementation-ready design only, no runtime change.

**Status: PROPOSED / NOT ACTIVE.** No `.github/workflows/*.yml` file, `package.json`, test file, or shared program tracker was created or modified to produce this document. No script referenced below exists on disk. This document specifies what a future, separately-scheduled implementation task must build.

Baseline: `origin/main` `8906e66af5169220a4aed48fe4cfea8524976fb8` (merge of PR #212, "fix(appointments): make request conversion atomic") at authoring time, worktree `D:/Mustafa/Siteler/DisKlinikCRM-worktrees/affected-module-ci-shadow-design`, branch `docs/affected-module-ci-shadow-design`.

**Drift note (reconciled 2026-07-23):** `origin/main` has since advanced to `9e80571cf78a0e83e0f5219e09223011fddf1955`, 4 commits ahead of the authoring baseline (PR #214 "docs/data-integrity-001-r2-evidence" and PR #215 "audit/r061-residual-reset-production-verification", plus their constituent commits `c24e7ca` and `b942f5c`). `git diff --stat` between the authoring baseline and current `origin/main` shows every changed file lives under `docs/program/**` (`KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`, `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `DATA-INTEGRITY-001-R2_INDEPENDENT_VERIFICATION.md`, `PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md`, `REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md`, `R-061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md`) — none touch `server/`, `src/`, `.github/workflows/`, `package.json`, or any of §0's authoritative architecture inputs. This design's technical content, evidence base, and file/script-count claims (§0.1, §5.1, §5.2, confirmed again directly against the current tree while reconciling this drift) are unaffected. The authoring baseline above is retained as the accurate `sourceCommit` for §1.1's manifest example, since it is the commit this design's evidence was actually gathered against.

## 0. Files reviewed (authoritative inputs)

| File | Used for |
|---|---|
| `docs/architecture/AFFECTED_MODULE_TEST_STRATEGY.md` (ARCH-TEST-001) | Module taxonomy, escalation rules, fallback rules, and their own evidentiary basis (F0-003/4/5) — this design does not re-derive any of it |
| `docs/architecture/AFFECTED_MODULE_TEST_MATRIX.md` (ARCH-TEST-001) | Per-module owned paths, test-command lists, DB requirements, full-suite triggers — the direct data source for the manifest in §1 |
| `docs/architecture/CI_TEST_SELECTION_DECISION_TREE.md` (ARCH-TEST-001) | The resolver pseudocode this design implements-in-detail (§2) and the PR-evidence block this design's shadow-mode output (§6) extends |
| `server/package.json` | Confirmed directly (not just cited from the matrix): the aggregate `"test"` script excludes `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`, `test:meta-template`, `test:outbound`, `test:consent-resume` (6 scripts, matches matrix's own count); `test:kvkk-high006-db-verification` (an aggregate of 6 DB-required scripts) is also excluded from `"test"` |
| `.github/workflows/windows-bridge-pr.yml`, `windows-bridge-release.yml` | The repo's only existing CI precedent: `paths:`-triggered job selection (cited by ARCH-TEST-001 as prior art), and — new to this task — its **action/image pinning convention** (`uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`), used in §4 and §8 as the basis for pinning the disposable-Postgres image the same way |
| `docs/program/evidence/KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md` | The repo's one existing, executed disposable-PostgreSQL run (`postgres:16-alpine`, ephemeral container, 66/66 migrations clean, harness-level fixture isolation/truncation, verified teardown) — the concrete precedent §4's CI-service-container design translates from a manual `docker run` workflow into a GitHub Actions `services:` block |
| `server/src/tests/**`, `server/src/tests/dbVerification/**` (current tree) | Ground-truthed one live manifest-drift example used throughout this design (§0.1) |

Two prior-task documents were consulted for context but are not re-cited as evidence: `docs/program/evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md` (superseded by the matrix's own reconciliation) and `docs/program/evidence/DATA-INTEGRITY-001-R2_INDEPENDENT_VERIFICATION.md` (unrelated, untracked file present in the primary worktree at task start — not read, not relevant to CI design).

### 0.1 A live manifest-drift example, found while reviewing the current tree

`server/src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts` was added in commit `bda3880` ("fix(appointments): make request conversion atomic"), **after** the matrix's `7c2aea5` rebaseline. It has a real `package.json` script (`"test:appointment-request-conversion-atomicity": "tsx src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts"`, confirmed by direct read) — but:

- it is **not** listed under Auth/Tenant Scope's (or any module's) test files in matrix §2, and
- it is **not** in matrix §7's "files added since F0-005" reconciliation table, and
- it is **not** in `server/package.json`'s aggregate `"test"` chain or the `test:kvkk-high006-db-verification` DB aggregate.

This is not a hypothetical scenario invented to justify §5's manifest-validation design — it is the matrix going stale in the same worktree this design was authored against, five commits later. §5 and §7 (matrix-freshness acceptance criterion) are built to catch exactly this.

**This design does not correct that gap by editing the matrix.** `docs/architecture/AFFECTED_MODULE_TEST_MATRIX.md` is ARCH-TEST-001's authoritative output and is out of this task's scope (§7 below: "Change only" this document); this task neither adds the missing test to matrix §2/§7 nor silently absorbs it into §1.2's illustrative manifest example as if the matrix already accounted for it. Instead, §5.3 specifies a validation step whose job is exactly this class of drift: **fail** (not warn — a registered `.test.ts` file with no manifest/exclusion-list entry is treated as a hard validation failure, §5.3 point 4) whenever a test file that exists on disk is absent from the manifest. The matrix itself remains stale until a separate, explicitly-scoped task reconciles it — this design only guarantees that staleness becomes loud (a failing check) instead of silent (a manifest that quietly under-selects).

---

## 1. Manifest format

**Format choice: JSON, one object per module, schema-validated.** "Committed JSON" here means the *proposed* shape a future manifest file should take when the implementation task creates and commits it — not a claim that any manifest file exists or was committed by this design task; §1's `jsonc` blocks below are illustrative examples embedded in this document, not a committed data file (see "What this task did not do"). The decision-tree document left the exact format open ("JSON/YAML — format left to the implementation task"). This design picks JSON for a plain reason: `server/package.json` already establishes JSON as this repo's native machine-readable-config format, and a `JSON.parse` + a hand-rolled shape check (no new dependency — consistent with ARCH-TEST-001's "no new tool" constraint) is enough to validate it. This is a recommendation the implementation task may override; it is not mandated by any authoritative input.

### 1.1 Top-level shape

```jsonc
{
  "$schemaVersion": "1.0.0",
  "generatedFrom": {
    "strategyDoc": "docs/architecture/AFFECTED_MODULE_TEST_STRATEGY.md",
    "matrixDoc": "docs/architecture/AFFECTED_MODULE_TEST_MATRIX.md",
    "sourceCommit": "8906e66af5169220a4aed48fe4cfea8524976fb8"
  },
  "thresholds": {
    "maxAffectedModulesBeforeFullSuite": 5,
    "sharedPlatformFanInFiles": [
      "server/src/middleware/",
      "server/src/utils/clinicScope.ts",
      "server/src/utils/roles.ts",
      "server/src/db.ts",
      "server/src/index.ts"
    ]
  },
  "modules": [ /* §1.2, one entry per matrix §2 module (13 + module 14 excluded — see §1.4) */ ]
}
```

`thresholds` is a **top-level, editable block**, not a constant buried in resolver code. Per the task instruction to treat current thresholds as provisional: `maxAffectedModulesBeforeFullSuite` (strategy §11 rule 5) and `sharedPlatformFanInFiles` (strategy §11 rule 2 — the *membership* of this list, not a live per-PR fan-in count; see §3.9) must be changeable by editing this file alone, with no resolver code change, so shadow-mode findings (§7) can retune them without a PR touching workflow logic.

### 1.2 Per-module entry

```jsonc
{
  "moduleId": "auth-tenant-scope",
  "displayName": "Auth / Tenant Scope",
  "matrixSection": "AFFECTED_MODULE_TEST_MATRIX.md#21-auth--tenant-scope",
  "ownedPaths": [
    "server/src/routes/auth.ts",
    "server/src/routes/clinicRegistration.ts",
    "server/src/routes/users.ts",
    "server/src/routes/usersImport.ts",
    "server/src/routes/organizationBranches.ts",
    "server/src/middleware/auth.ts",
    "server/src/middleware/clinicAccess.ts",
    "server/src/middleware/csrf.ts",
    "server/src/middleware/planLimits.ts",
    "server/src/utils/clinicScope.ts",
    "server/src/utils/roles.ts",
    "server/src/utils/sessionCookies.ts",
    "server/src/utils/authFallback.ts",
    "server/src/utils/totp.ts",
    "server/src/utils/passwordResetToken.ts"
  ],
  "escalatesTo": [],
  "escalationTriggerFiles": [],
  "testCommands": [
    { "cmd": "npm run test:auth",                 "cwd": "server", "db": "none" },
    { "cmd": "npm run test:email-verification",   "cwd": "server", "db": "none" },
    { "cmd": "npm run test:password-reset",       "cwd": "server", "db": "none" },
    { "cmd": "npm run test:totp",                 "cwd": "server", "db": "none" },
    { "cmd": "npm run test:staff-onboarding",     "cwd": "server", "db": "none" },
    { "cmd": "npm run test:user-import-onboarding","cwd": "server", "db": "none" },
    { "cmd": "npm run test:roles",                "cwd": "server", "db": "none" },
    { "cmd": "npm run test:billing-financial-select","cwd": "server", "db": "none" },
    { "cmd": "npm run test:billing-patient-access","cwd": "server", "db": "none" },
    { "cmd": "npm run test:treatment-case-scope", "cwd": "server", "db": "none" },
    { "cmd": "npm run test:appointment-request-record-scope", "cwd": "server", "db": "none" },
    { "cmd": "npm run test:dental-chart-clinic-scope", "cwd": "server", "db": "none" },
    { "cmd": "npm run test:reports-clinic-scope", "cwd": "server", "db": "none" },
    { "cmd": "npm run test:messages-record-scope","cwd": "server", "db": "none" },
    { "cmd": "npm run test:kvkk-high006-batch3",  "cwd": "server", "db": "none" },
    { "cmd": "npx tsx src/tests/treatmentPackagePermissions.test.ts", "cwd": "server", "db": "none", "orphan": "no-package-script" },
    { "cmd": "npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts", "cwd": "server", "db": "none", "orphan": "no-package-script" },
    { "cmd": "npm run test:kvkk-high006-db-verification", "cwd": "server", "db": "db-verification" }
  ],
  "riskLevel": "high",
  "riskReason": "48/57 route files import middleware/auth.ts, 36/57 import utils/clinicScope.ts (F0-004 fan-in measurement) — any regression here has the widest blast radius of any module",
  "fullSuiteTriggers": {
    "anyChangeToOwnedPathSubset": [
      "server/src/middleware/auth.ts",
      "server/src/middleware/clinicAccess.ts",
      "server/src/utils/clinicScope.ts",
      "server/src/utils/roles.ts"
    ],
    "reason": "strategy-11-rule-2 (shared-platform fan-in, not module-local)"
  }
}
```

Field notes:

- **`moduleId`** — kebab-case, derived from matrix §2's numbered headings (`2.1 Auth / Tenant Scope` → `auth-tenant-scope`). Stable identifier; never reused for a different module even if a module is later split.
- **`ownedPaths`** — exact file paths or directory-prefix globs (trailing `/`), taken verbatim from matrix §3. Module 14 (Imaging Device Bridge) is **excluded from the manifest entirely** (§1.4) — it already has its own CI and this design must not touch its trigger, per both ARCH-TEST-001 and this task's own scope.
- **`escalatesTo`/`escalationTriggerFiles`** — parallel arrays sourced from matrix §5's escalation table; a file in `escalationTriggerFiles[i]` adds every module in `escalatesTo[i]` to the affected set (never removes). Kept as a **module-level** field here for readability, but see §2.3 for why the resolver must actually index this by file, not by module.
- **`testCommands[].db`** — one of `none` | `live-db` (imports `db.ts` directly — the matrix's "DB-live" tag) | `db-verification` (the dedicated `dbVerification/` suite). This is not the same axis as pass/fail severity — it only gates whether the disposable-Postgres job (§4) must be up for that specific command.
- **`testCommands[].orphan`** — present only for the "no package script" class (§5.1); the resolver must run these via direct `npx tsx`, never assume a script exists.
- **`riskLevel`** — `standard` | `high`. This is a **new field for this task** (ARCH-TEST-001 didn't need it; §8's phased rollout does). Assigned `high` when any of: the module is one of the 9 high-risk-boundary-violation sources (WhatsApp/Meta), the module's full-suite-trigger condition is "any change at all" because it has zero-or-near-zero dedicated coverage (Inventory, Insurance — matrix §2.7/§2.8 notes), or the module is itself a shared-platform fan-in source (Auth/Tenant Scope). All other modules default `standard`. This classification is this task's own judgment call, grounded in F0-004's fan-in/risk data cited in the matrix, not a new measurement — flagged in §8 as feeding the phased-gating rollout, not merge-blocking on its own.

### 1.3 Docs-only / non-code exemption list

A sibling top-level array, **new to this task** (§3.6 explains why it's required):

```jsonc
"nonCodePathPrefixes": [
  "docs/",
  "*.md",
  "README.md",
  "LICENSE",
  ".gitignore"
]
```

A changed file matching one of these is **excluded from the changed-file set before module resolution runs at all** — distinct from, and evaluated before, the "unmapped file → full suite" fallback (§3.1). See §3.6 for the full rationale and failure mode this prevents.

### 1.4 What is deliberately not in the manifest

- **Module 14 (Imaging Device Bridge)** — has its own CI (`windows-bridge-pr.yml`), explicitly out of scope for both ARCH-TEST-001 and this task.
- **Frontend per-module path prefixes beyond the 6 explicit ones the matrix already names** (`src/pages/platform/**`, `src/services/api.ts`, and the 4 individually-matrixed frontend test files: `bookingWidgetHelpers.test.ts` → Appointment Requests, `dicomHelpers.test.ts` → Dental Chart, `clinicBulkExportSelectionHelpers.test.ts` → Privacy/KVKK, `communicationConsentMatrixHelpers.test.ts` → Messaging). The matrix itself states this gap in its own §3 closing note ("not exhaustively re-tabulated ... `src/services/api.ts` is a single shared client with no per-module file split on the frontend"). This design does not invent a frontend module map that no authoritative input provides — doing so would be new architectural analysis outside this task's reviewed inputs. It is carried forward as an explicit unresolved decision (§8 below) with a defined, safe interim behavior (§3.7).

---

## 2. Changed-file resolver algorithm

This elaborates decision-tree §2's pseudocode into an implementation-ready specification — same control flow, with the ambiguities that pseudocode left implicit made explicit.

### 2.1 Inputs

- `CHANGED_FILES = git diff --name-only <merge-base(BASE, HEAD)> HEAD` — **merge-base diff, not two-dot** (decision-tree §3 step 1's own requirement, restated because it is easy to implement wrong: `git diff BASE..HEAD` on a stale local `BASE` ref silently produces the wrong file set if the PR's target branch has moved since the runner's checkout — a GitHub Actions `pull_request` trigger exposes `github.event.pull_request.base.sha` precisely to make merge-base computation reliable without an extra fetch).
- The manifest (§1), loaded and schema-validated (§5.3) before any resolution begins — **a manifest that fails validation must abort the run as a CI infrastructure failure, not silently fall back to full suite**, because a corrupt manifest could just as easily under-select as over-select; treating it as "full suite" would hide the corruption instead of surfacing it.

### 2.2 Step 1 — strip non-code files

Remove every file matching `nonCodePathPrefixes` (§1.3) from `CHANGED_FILES` before anything else runs. If the resulting set is empty, resolution ends immediately: **zero commands selected, zero fallback, explicit "docs-only — no runtime module affected" status** (§6). This must happen before longest-prefix matching, not as a special case inside it — see §3.6 for why folding it into the "unmapped" path is wrong.

### 2.3 Step 2 — per-file module resolution

For each remaining file, longest-prefix match against every module's `ownedPaths` (§1.2), collecting **all** matches, not just the first:

```
matchesByFile = {}
for file in CHANGED_FILES:
    matches = []
    for module in manifest.modules:
        for prefix in module.ownedPaths:
            if isPrefixOrExactMatch(file, prefix):
                matches.append({module: module.moduleId, prefix, prefixLength: prefix.length})
    matchesByFile[file] = matches
```

- **Longest-prefix tie-break**: if a file matches multiple prefixes *within the same module* (e.g. a file under both a broad directory prefix and a more specific file-level entry — should not occur given matrix §3's canonicalization, but the resolver must not assume it can't), keep only the longest; this is a same-module dedup, not a cross-module ambiguity.
- **Cross-module ambiguity** (`matchesByFile[file]` contains entries from >1 distinct `moduleId` after the same-module dedup above) is **not resolved by picking one** — it is passed through to §3.2 (multi-module match → full-suite fallback), because per decision-tree rule 11.6 this indicates the manifest itself is stale, not that a tie-break is safe to guess.
- A file with zero matches after this step is **unmapped** (§3.1).

### 2.4 Step 3 — apply escalation

For each file that matched exactly one module, check `escalationTriggerFiles` (indexed by exact file path, sourced from matrix §5 — these are always specific named files, e.g. `services/channelConsentGate.ts`, never a directory prefix) and union in the corresponding `escalatesTo` modules. Escalation only adds modules; it is applied after the primary module set is fully resolved for the PR (not per-file in isolation), so a PR touching both `whatsapp.ts` and `patients.ts` directly does not double-count Patients.

### 2.5 Step 4 — apply fallback rules, in this fixed order

1. Any file unmapped after step 2 (§3.1) → full suite.
2. Any file matching a `sharedPlatformFanInFiles` prefix (§1.1 `thresholds` block) → full suite. This check is independent of step 2's module match — a shared-fan-in file is *also* owned by Auth/Tenant Scope per matrix §3, but the fan-in rule fires regardless of ownership, per strategy §11 rule 2's own framing ("escalates ... rather than staying module-local").
3. Any file under `server/prisma/schema.prisma` or `server/prisma/migrations/**` → full suite.
4. `server/package.json` or root `package.json` changed **and** the `"scripts"` object differs between the two revisions (resolver must `JSON.parse` both blob versions at `BASE` and `HEAD` and do a structural comparison of `.scripts` only — a dependency-version bump or a non-`scripts` key change must **not** trigger this rule, or every routine `npm audit fix` PR would force a full suite for no reason connected to the actual risk this rule targets, which is "a test's wiring silently broke," strategy §11 rule 4).
5. `src/services/api.ts` changed → full suite (matrix §3's frontend fan-in-equivalent).
6. Cross-module ambiguity from step 2 → full suite (11.6).
7. After steps 1–6, if the accumulated module set (from step 2 + step 3's escalation) exceeds `thresholds.maxAffectedModulesBeforeFullSuite` (default 5) → full suite.

Each fallback hit appends a `{rule, file}` (or `{rule, moduleList}` for rule 7) entry to `fullSuiteReasons` — **all** applicable reasons are collected, not just the first, so the PR evidence block (§6) can show every independent cause rather than only whichever check happened to run first.

### 2.6 Step 5 — emit command set

If `fullSuite`: the manifest's full-suite command set (§4 of the decision-tree doc, unchanged by this task — restated in §6 below for the evidence-block shape). Otherwise: the union (deduplicated) of `testCommands` across every module in the final affected set.

---

## 3. Behavior for specific cases

### 3.1 Unmapped file

Full-suite fallback (§2.5 rule 1), per strategy §11 rule 1 / decision-tree 11.1 — unchanged from ARCH-TEST-001. The one refinement this task adds: "unmapped" is evaluated **after** the non-code strip (§2.2/§3.6), so this rule now means "an actual runtime-code file with no owning module," not "any file the matrix's authors didn't think to list a doc for."

### 3.2 Multi-module match

Full-suite fallback (§2.5 rule 6), per decision-tree 11.6, unchanged. Design note carried forward from the matrix's own framing: this is treated as a **matrix-staleness signal**, not a legitimate steady-state outcome — if this fires routinely in shadow-mode data, that is itself evidence the manifest needs a canonicalization pass (matrix §6's own reconciliation precedent) before promotion (§7).

### 3.3 Schema / migration change

Full-suite fallback (§2.5 rule 3), per strategy §11 rule 3, unchanged — "every module reads the same `PrismaClient`," no bounded blast radius by construction.

### 3.4 Auth / tenant-scope shared files

Full-suite fallback (§2.5 rule 2) — **not** "run Auth/Tenant Scope's module set," a common misreading of strategy §11 rule 2 this design guards against explicitly. `middleware/auth.ts`, `middleware/clinicAccess.ts`, `utils/clinicScope.ts`, `utils/roles.ts`, `server/src/db.ts`, `server/src/index.ts` are structurally owned by Auth/Tenant Scope in the matrix's ownership table, but their *fallback treatment* is fan-in-based and repo-wide, independent of ownership — the manifest's `thresholds.sharedPlatformFanInFiles` list exists specifically so this rule is checked separately from, and takes precedence over, ordinary module resolution.

### 3.5 Package-script changes

Full-suite fallback **only if the `scripts` object itself changed** (§2.5 rule 4) — not on any `server/package.json`/`package.json` edit. This is a deliberate elaboration beyond decision-tree §2's literal pseudocode (which says "if scripts block changed: ..." without specifying *how* to detect that). A naive whole-file-diff check would force full suite on every dependency bump; a structural `.scripts`-only comparison avoids that false-positive class while still catching exactly the failure mode strategy §11 rule 4 is grounded in (the `overdueInstallments.test.ts` orphan-script class of bug).

### 3.6 Docs-only PR

**Not addressed in ARCH-TEST-001** — this is new design work required for shadow mode to produce a usable signal at all. Without an explicit non-code exemption (§1.3, §2.2), the literal decision-tree §2 pseudocode as written would classify every file under `docs/**` as "unmapped" (no module owns `docs/`) and force full suite — meaning every one of this repository's own program/architecture-documentation PRs (a large fraction of this repo's actual commit history, this very task included) would show "FULL SUITE" in shadow mode. That would not be a meaningful false positive to fix later; it would make the shadow-mode runtime-reduction metric (§7) meaningless from day one, since a large share of observed PRs would trivially be 100%-full-suite regardless of how good the module resolution logic is.

Design: `nonCodePathPrefixes` (§1.3) is checked **before** module resolution (§2.2), not as a fallback rule. A docs-only PR (after the strip, zero files remain) short-circuits to an explicit **"no runtime module affected"** result — zero commands, zero fallback, distinct in the evidence block (§6) from both "targeted set selected" and "full suite." A PR mixing docs and code changes is unaffected by this rule — the docs files are simply removed from consideration before the normal algorithm runs on the remaining files.

### 3.7 Frontend-only PR

**Partially unresolved — flagged, not silently patched over.** The matrix provides exactly 6 explicit frontend mappings (§1.4): `src/pages/platform/**`, `src/services/api.ts` (full-suite trigger), and 4 individually-named component/page test files. No general `src/pages/**`/`src/components/**` → module table exists in any authoritative input — the matrix's own §3 says so directly.

Interim design (safe default, not a fix for the gap): a frontend-only PR is resolved file-by-file exactly like any other PR —

- files matching one of the 6 explicit frontend entries resolve normally (correctly scoped, no fallback);
- `src/services/api.ts` triggers full suite by design (§2.5 rule 5);
- every other `src/**` file falls through to §3.1 (unmapped) → full suite, **because it is real runtime code with no owning module in any authoritative input, not because it was misclassified as docs.**

This means, today, the large majority of frontend-only PRs will show "FULL SUITE / unmapped frontend file" in shadow mode. That is the correct, safe behavior given the actual state of the inputs — but it also means the runtime-reduction acceptance metric (§7) cannot be evaluated fairly on frontend-heavy PRs until a frontend module-path table exists. **This is listed as an unresolved decision (§8) and a prerequisite, not something this task should invent** — building that table requires the same evidence-based methodology F0-003/F0-004 used for the backend (a frontend domain/ownership survey), which is outside this task's reviewed inputs and scope.

### 3.8 >5 proposed module threshold

`thresholds.maxAffectedModulesBeforeFullSuite` (default `5`, §1.1), applied at §2.5 rule 7 — **after** escalation (§2.4), matching decision-tree §2's own pseudocode ordering (`if not fullSuite and len(modules) > 5`). This is explicitly carried forward as **provisional, not accepted policy** per strategy §13 item 3 and this task's own instruction — its value lives in the manifest specifically so shadow-mode data (§7) can retune it without touching resolver code. No PR observation data exists yet to justify `5` over any other value; it is ARCH-TEST-001's placeholder, unchanged here.

### 3.9 ≥10 fan-in threshold

This is a **different kind of threshold from §3.8** and must not be conflated with it — a distinction this design makes explicit because the two are easy to blur:

- The **>5-module threshold** (§3.8) is evaluated **per PR, at resolution time**, over the *set of modules a specific PR's changed files happen to touch*.
- The **≥10 fan-in threshold** is not evaluated per PR at all. It was used **once, historically, by ARCH-TEST-001's own analysis** (a direct fan-in grep across all 57 route files, cited in strategy §2/§29) to decide *which specific files* belong in `thresholds.sharedPlatformFanInFiles` (§1.1) — `middleware/auth.ts` (48/57), `utils/clinicScope.ts` (36/57), `utils/roles.ts` (10/57, the threshold's own boundary case), plus `db.ts`/`index.ts`/`middleware/clinicAccess.ts` by inspection rather than measured fan-in.

Because this list is frozen at authoring time, it will drift as the route count changes — a currently-9/57 file could cross 10/57 after a handful of new routes land, or an already-listed file's fan-in could rise further without anyone re-running the grep. This design adds a requirement ARCH-TEST-001 did not specify: **the fan-in measurement (`grep -rl "from.*<file>"` / equivalent import-count across `server/src/routes/*.ts`) must be re-run and `sharedPlatformFanInFiles` re-synced as part of the same matrix-freshness check §7 already requires for manifest drift (§0.1)** — not a one-time classification frozen forever at ARCH-TEST-001's baseline.

---

## 4. Disposable PostgreSQL lifecycle

Translates the one executed, evidenced precedent in this repo (`docs/program/evidence/KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md` — `postgres:16-alpine`, ephemeral `docker run --rm`, 66/66 migrations clean, harness-level fixture isolation, verified teardown) from a manual local workflow into a GitHub Actions job-scoped service container. Nothing here is a new invention; every property below is either lifted directly from that evidence doc or is a mechanical consequence of running the same pattern inside a GitHub-hosted, always-ephemeral runner VM instead of a developer's machine.

### 4.1 Image and version

`postgres:16-alpine`, **pinned by digest, not floating tag** — a requirement this task adds by extending an existing repo convention rather than inventing one: `windows-bridge-pr.yml` already pins every third-party action by commit SHA with a version comment (`uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`). The disposable-Postgres image must follow the same pattern (`postgres@sha256:<digest> # 16-alpine as of <date>`), for the same supply-chain-consistency reason, not a new policy invented for this design. The exact digest is an implementation-task detail (resolved at authoring time via `docker pull postgres:16-alpine && docker inspect --format='{{index .RepoDigests 0}}'`), not prescribed here.

### 4.2 Health check

GitHub Actions `services:` blocks the job from starting steps until the container's `--health-cmd` passes, but the evidence doc's own practice (confirmed `pg_isready` "ready on the first attempt" *before* any Prisma command) is kept as defense-in-depth — an explicit `pg_isready`-polling step before `prisma migrate deploy` runs, not solely trusting the platform's health gate, matching the evidence doc's own two-layer confirmation (readiness check, then migration).

```yaml
services:
  postgres:
    image: postgres@sha256:<pinned-digest>   # postgres:16-alpine
    env:
      POSTGRES_USER: ci_affected_module_runner
      POSTGRES_PASSWORD: ${{ github.run_id }}-${{ github.run_attempt }}   # placeholder — see §4.3
      POSTGRES_DB: noramedi_affected_module_ci
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

### 4.3 Migration deploy

```
cd server
npx prisma generate
npx prisma migrate deploy
```

Expected baseline result, per the evidence doc: **all 66 (as of this task's baseline — the count will grow) existing migrations apply cleanly, in order, with zero errors and zero drift.** This is the "positive control" for the whole DB job: `prisma migrate deploy` failing is a CI-infrastructure/migration-authoring problem, not a `BLOCKED` state, and must fail the job loudly (§4.6) rather than being absorbed into the same `BLOCKED` disclosure used for "no DB was provisioned at all" (decision-tree §5).

### 4.4 Database isolation

Two independent layers, both already proven by the evidence doc, kept distinct here because they solve different problems:

1. **Container-level isolation (cross-run):** every job gets its own ephemeral service container — GitHub Actions services are job-scoped by construction, with no cross-run persistence, no shared volume, no shared network beyond the job's own runner. This is a strict improvement over the evidence doc's manual `docker run --rm -d` pattern, not a design decision this task had to make — it's the platform's default behavior for `services:`.
2. **Fixture-level isolation (within a run):** each DB-required test file creates its own org/clinic/user fixtures with random UUID suffixes and deterministically truncates everything it created at the end (`dbVerificationHarness.ts`, confirmed in the evidence doc §5 and directly present in `server/src/tests/dbVerification/` on the current tree). This means multiple DB-required commands can run sequentially against the **same** service-container instance within one job without cross-test contamination — the CI design does not need to spin up a fresh container per test file, only per job.

### 4.5 Cleanup

**No manual step required.** GitHub Actions tears down service containers automatically at job end, unconditionally (success or failure) — a deliberate simplification versus the evidence doc's manual `docker stop`/`docker ps -a` verification sequence (§11 there), valid specifically because GitHub-hosted runners are always-fresh ephemeral VMs destroyed after the job regardless. No volume is ever created (`POSTGRES_DB` initializes fresh each run; no `-v` equivalent in the `services:` block above), matching the evidence doc's "fully ephemeral" container storage.

### 4.6 Failure evidence

Two distinct failure classes, which the PR evidence block (§6) must never collapse into one:

| Class | Cause | Evidence-block treatment |
|---|---|---|
| **Provisioning failure** | `pg_isready` never succeeds within the health-check retry budget, or `prisma migrate deploy` exits non-zero | Job **fails** (not `BLOCKED`); full `migrate deploy` stdout/stderr is captured as job log (default CI behavior — no extra artifact step needed); PR evidence line reads `DB provisioning FAILED: <first line of error>` — this must be loud, because it means the CI environment itself cannot currently validate any DB-required test, which is worse than a missing test and must not read the same as an environment limitation |
| **Environment not provisioned** | The disposable-Postgres job step was skipped entirely (e.g. during an early shadow-mode rollout stage that hasn't wired the service block into every workflow variant yet) | Every DB-required command in the selected set is marked `BLOCKED: no DATABASE_URL provisioned in this environment`, per decision-tree §5's existing evidence-block contract — unchanged from ARCH-TEST-001, restated here because §4.6's provisioning-failure row must not be implemented as a variant of this row |

---

## 5. Orphan script handling

### 5.1 Tests without package scripts

The matrix already names these (confirmed present on the current tree, §0.1's file added since is a 7th case of the same class): `patientSharedPhone.test.ts`, `treatmentPackagePermissions.test.ts`, `kvkkHigh006Batch2ClinicScope.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `aiPrivacyBoundary.test.ts`, `platformBackup.test.ts` (matrix §8 note 5 flags this last one as unverified — no script found by its own search). Design: the manifest carries these as direct `{ "cmd": "npx tsx src/tests/<file>.test.ts", "orphan": "no-package-script" }` entries (§1.2) — **no `package.json` script is added** (this task, like ARCH-TEST-001, must not modify `package.json`). The resolver never assumes a `npm run` script exists for a file in a module's owned paths; it only ever runs exactly what the manifest's `testCommands` says.

### 5.2 Scripts that exist but sit outside the aggregate `npm run test` chain

Confirmed directly against `server/package.json` (not merely cited from the matrix, §0): `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`, `test:meta-template`, `test:outbound`, `test:consent-resume`, and the `test:kvkk-high006-db-verification` aggregate. These have real scripts and are correctly listed as `npm run <script>` entries in their owning module's `testCommands` (§1.2) — the point of a per-module manifest instead of "just run `npm run test`" is precisely that the aggregate chain is known-incomplete (matrix §8, F0-005's original finding), so the affected-module CI must invoke individual scripts, never delegate to the aggregate.

### 5.3 Manifest validation

**New design surface for this task** — not specified by ARCH-TEST-001, and directly motivated by §0.1's live drift finding. A validation step (specified here, not implemented — it would live as a script invoked by the CI workflow, e.g. `node .github/scripts/validate-affected-module-manifest.mjs`, itself out of this task's implementation scope per the "do not implement scripts" instruction) must:

1. Enumerate every `server/src/tests/**/*.test.ts` and `src/**/__tests__/*.test.ts` / `*.vitest.test.tsx` file on disk.
2. Enumerate every file path referenced by any `testCommands[].cmd` across the manifest (resolving `npm run <script>` back to its `server/package.json` command string to extract the underlying test file path).
3. Diff the two sets.
4. **Fail the validation step** (not the overall shadow-mode run — see §8 rollout stage boundaries) if a test file exists in neither the manifest nor an explicit, manifest-declared exclusion list (for files that are deliberately not run in CI — e.g. fixture/helper files like `whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts`, `dbVerificationHarness.ts`, which are not test files themselves despite living under `src/tests/`).

§0.1's `appointmentRequestConversionAtomicity.test.ts` is the concrete proof this check has real, present-tense findings to catch on day one, not a hypothetical.

---

## 6. Shadow-mode output

Because shadow mode is explicitly **non-blocking**, every PR run executes **both** the targeted command set and the full-suite command set (§4 of the decision-tree doc) — this dual-run is the entire mechanism that produces §7's accuracy data; there is no other way to measure a false negative than to have the full-suite result available to compare against.

### 6.1 Machine-readable block (JSON, emitted as a job artifact / check-run output)

```jsonc
{
  "prNumber": 0,
  "changedFiles": { "count": 0, "list": [] },
  "nonCodeFilesExcluded": { "count": 0, "list": [] },
  "resolution": {
    "outcome": "targeted" /* | "full-suite" | "no-runtime-module-affected" */,
    "selectedModules": [],
    "fullSuiteReasons": [ /* {rule, file} entries, §2.5 — empty unless outcome == "full-suite" */ ],
    "highRiskEscalationApplied": [ /* {rule, triggerFile, addedModules} */ ]
  },
  "targetedRun": {
    "commandsSelected": [ /* {cmd, db, result: "PASS"|"FAIL"|"BLOCKED", assertions, durationMs} */ ],
    "commandsSkippedOrBlocked": [ /* DB-required commands with no provisioned DATABASE_URL, §4.6 row 2 */ ],
    "estimatedDurationMs": 0,
    "actualDurationMs": 0
  },
  "fullSuiteRun": {
    "result": "PASS" /* | "FAIL" */,
    "actualDurationMs": 0
  },
  "comparison": {
    "falseNegative": false,
    "falseNegativeDetail": null,
    "falsePositiveCommands": [],
    "runtimeReductionPct": 0
  }
}
```

- **`falseNegative`**: `true` when the targeted run is entirely `PASS`/`BLOCKED` but the full-suite run contains a `FAIL` in a command that was **not** part of the targeted set — i.e. the resolver would have missed a real regression had it been gating. This is the single most important field in the whole design; §7's promotion gate is built around it being `false` across an entire observation window.
- **`falsePositiveCommands`**: commands the targeted set included that the full-suite run shows would have passed regardless of the module boundary reasoning that included them (e.g. an escalation rule firing on a file whose change turned out unrelated to the escalated module's actual behavior). Not a correctness risk — a false positive only costs runtime, it never hides a regression — but tracked because it directly erodes the runtime-reduction metric (§7) and is the leading indicator that an escalation/fan-in rule is over-broad and a candidate for the §3.8/§3.9 threshold retuning.
- **`estimatedDurationMs`**: has **no data source yet** — no historical per-command timing exists anywhere in this repo's evidence base (F0-005's own runtime measurements are point-in-time, not a running average). Shadow mode's own accumulated `actualDurationMs` history is the only way to bootstrap this field; until enough runs exist, this field should read `null`/absent rather than a fabricated estimate — an explicit design choice, not an oversight.

### 6.2 Human-readable PR comment (extends decision-tree §5's block, does not replace it)

```
## Affected-Module Test Selection (SHADOW MODE — non-blocking)

**Changed files:** <count> (<N> non-code files excluded)
**Resolution:** targeted (7 modules) | FULL SUITE — reason: <rule + file>
**Targeted run:** 34/34 commands PASS, 2 BLOCKED (no disposable Postgres in this job)
**Full-suite run (comparison only):** PASS
**False negative:** NO
**Estimated runtime saved:** 71% (targeted 4m12s vs full-suite 14m30s)
**High-risk escalation applied:** yes — routes/whatsapp.ts also ran Patients + Appointments + Appointment Requests
```

---

## 7. Acceptance criteria before merge blocking

All of the following are **this task's own provisional defaults**, presented in the same spirit ARCH-TEST-001 flagged its own thresholds (strategy §13 item 3, §16 item 2) — explicit candidates for external review before anyone treats them as policy, not derived from any incident history or measured rate (none exists to measure against yet, since no affected-test selection has ever run in this repository).

| Criterion | Provisional default | Rationale |
|---|---|---|
| **Minimum PR observations** | ≥50 PRs total, with at least 1 PR touching every one of the 13 modules and at least 3 PRs that triggered each individual full-suite fallback rule (§2.5) | A window with zero observed full-suite triggers proves nothing about whether those rules work; each rule needs its own positive observation, not just aggregate PR count |
| **Zero missed mandatory regressions** | Zero `falseNegative: true` occurrences across the entire observation window | Per §6.1 — a single false negative resets the window; this is a hard gate, not a rate threshold, because a missed regression is exactly the failure mode targeted selection exists to never produce |
| **Acceptable runtime reduction** | ≥40% median `runtimeReductionPct` across targeted-outcome PRs (full-suite-outcome PRs are excluded from this specific metric, since they are 0% by construction and would dilute it) | No baseline exists to compare against; 40% is a placeholder informed only by the fact that a majority of the module-level command sets in §1.2/matrix §2 are visibly smaller than the 60+ command aggregate `"test"` chain, not by measured data |
| **Matrix freshness** | Zero unresolved findings from §5.3's validation step at the time of the promotion decision, re-run within 7 days of that decision | §0.1 proves staleness can happen within days, not months — a freshness check done once at ARCH-TEST-001's authoring time is already insufficient evidence by the time this document was written |
| **Deterministic selection** | Running the resolver twice against the identical `CHANGED_FILES` input must produce byte-identical output | Verifies the resolver has no hidden nondeterminism (unordered set iteration affecting `fullSuiteReasons` ordering, etc.) before it is trusted as a gate — cheap to check, catches an entire class of "flaky CI" complaint before it starts |
| **DB job reliability** | ≥99% of jobs that attempt disposable-Postgres provisioning succeed (health check + `migrate deploy` both clean, §4.6 row 1 not triggered) over the observation window | A flaky DB step either masks DB-required regressions (if ever miscategorized as `BLOCKED` instead of failed, §4.6) or generates enough noise that a future required check would be routinely overridden/ignored — both outcomes defeat the point of gating |

---

## 8. Rollout

1. **Shadow only.** Both full suite and targeted set run on every PR; results post as a non-blocking PR comment/check (§6); zero required-status-check wiring. Sole purpose: accumulate the §7 observation data, including the false-negative/false-positive/runtime-reduction signal, and validate the manifest against real PR traffic (catching drift like §0.1's example as it happens, not after the fact).
2. **Warning mode.** The targeted-only check becomes a **named, visible** GitHub check (so it appears in the PR checks list) but remains non-required; on any mismatch (targeted PASS + full-suite FAIL) it renders as a visible ⚠️, not a red ❌ — full suite is still the actual gate underneath. This stage exists to surface the targeted check's presence to reviewers before anyone can possibly be blocked by it, and to catch UI/reporting bugs in the check itself separately from the resolver's correctness.
3. **Partial required checks.** The targeted check becomes a **required** status check only for `riskLevel: "standard"` modules (§1.2); any PR touching a `riskLevel: "high"` module, a shared-fan-in file, or a schema/migration change continues to require the full suite unconditionally, regardless of stage. This is a risk-tiered promotion, not a single flip — the modules with the thinnest coverage or highest blast radius (Inventory, Insurance, Auth/Tenant Scope's fan-in files, WhatsApp/Meta) are the last to have their targeted result trusted as sufficient on its own, mirroring strategy doc §16 item 3's own framing that targeted testing must never be treated as a substitute for the full-suite/escalated gate on these classes.
4. **Final gating.** The targeted check becomes the sole required check for all modules; the full suite moves to a scheduled (e.g. nightly) job or an on-demand manual trigger rather than a per-PR gate. Contingent on §7's criteria being met **continuously** through stages 1–3, not just once at the moment of promotion — a criterion that regresses after promotion (e.g. matrix freshness lapsing, §5.3 findings reappearing) should trigger a demotion back to an earlier stage, not be ignored because "it already passed once."

---

## 9. Rollback

- **Disable workflow.** Because this task must not modify any CI workflow, the concrete kill-switch mechanism is left to the implementation task, with two options recorded here as the candidates evaluated: (a) a repo-variable-gated `on:`/`if:` condition on the new workflow file, defaulting to disabled until explicitly turned on (no precedent for this pattern exists yet in this repo's two current workflows, both of which are always-on), or (b) a plain `git revert` of the commit that added the workflow file — this repo's only currently-demonstrated pattern for removing CI behavior. Neither is prescribed; the implementation task should pick based on how quickly a rollback needs to take effect versus how much operational overhead a feature-flag adds.
- **Full-suite fallback.** The safety net rollback restores is unusually thin, and this design states that plainly rather than implying otherwise: **per this document's own baseline (§0), this repository currently has no CI at all for the main application** — `.github/workflows/` contains only the two `windows-bridge`-only workflows. Disabling a future affected-module-CI workflow does not "fall back" to an existing full-suite gate, because no such gate exists today; it falls back to the pre-existing status quo of zero CI enforcement for `server/`/`src/`. If a full-suite-only (non-targeted) gate is ever stood up as an interim step **before** targeted selection ships — a sequencing option ARCH-TEST-001's strategy doc §15 item 5 leaves open but does not mandate — then rolling back *targeted* selection specifically should fall back to that interim full-suite gate, not all the way to zero CI. This is a sequencing recommendation for whichever task actually implements CI, not something either this task or ARCH-TEST-001 builds.

---

## Unresolved decisions

Restated/consolidated from inline flags above, so none require re-reading the whole document to find:

1. **§3.8/§3.9 thresholds (>5 modules, ≥10 fan-in list membership) remain unverified**, carried forward from strategy §13 item 3/§16 item 2 — unchanged status, now also given a concrete re-sync mechanism (§3.9) they didn't have before.
2. **No frontend module-path table exists beyond the matrix's 6 explicit entries** (§1.4, §3.7) — a real, evidence-confirmed gap, not an oversight of this task. Its absence means most frontend-only PRs will show "full suite" in shadow mode by design until a frontend-domain-ownership survey (methodologically equivalent to F0-003/F0-004 for the backend) is separately commissioned. This blocks a fair evaluation of §7's runtime-reduction metric specifically for frontend-heavy PRs.
3. **Manifest format (JSON) is this task's recommendation, not a mandate** (§1) — the decision-tree doc left it explicitly open.
4. **All of §7's numeric acceptance thresholds are placeholders** needing explicit external sign-off before promotion decisions rely on them, per this task's own "treat thresholds as provisional" instruction.
5. **No data exists on this repo's CI-minutes budget or runner cost constraints** — shadow mode's design (§6) requires running *both* the targeted and full-suite command sets on every PR, which is more expensive than either alone; whether that dual-run cost is acceptable at this repo's actual PR volume is a question for whoever owns CI infrastructure spend, not something any authoritative input for this task addresses.
6. **Rollback kill-switch mechanism** (§9) — repo-variable gate vs. commit revert — left to the implementation task.
7. **Exact Postgres image digest pin** (§4.1) — the *policy* (pin by digest, matching `windows-bridge-pr.yml`'s existing action-pinning convention) is decided here; the specific digest value is an implementation-time detail.

---

## Implementation file scope

For the future, separately-scheduled implementation task — **not created by this task**:

- `.github/workflows/main-app-affected-tests.yml` (or equivalent) — the shadow-mode workflow itself, wiring §2's resolver, §4's disposable-Postgres service block, and §6's dual-run/evidence emission.
- A manifest file encoding §1's schema (suggested location: co-located with the design docs it's generated from, e.g. `docs/architecture/affected-module-ci-manifest.json`, or under a dedicated `.github/ci/` directory closer to the workflow that consumes it — either is defensible; this task does not mandate one).
- A resolver script implementing §2 (e.g. `.github/scripts/resolve-affected-modules.mjs`), consuming the manifest and `CHANGED_FILES`, emitting §6.1's JSON.
- A manifest-validation script implementing §5.3 (e.g. `.github/scripts/validate-affected-module-manifest.mjs`).
- PR-comment/check-run emission logic implementing §6.2, and the historical `estimatedDurationMs` data store §6.1 flags as currently nonexistent (even a flat file accumulating `actualDurationMs` per command across runs would satisfy this — implementation task's choice of mechanism).

No test file, `package.json`, or existing workflow is touched by any of the above per this design; all are net-new files.

---

## What this task did not do

Per its own constraints: no CI workflow was created or modified (`.github/workflows/` is unchanged — confirmed identical to `windows-bridge-pr.yml`/`windows-bridge-release.yml` only, same as ARCH-TEST-001's own baseline); no `package.json` (root or `server/`) was modified; no script of any kind (resolver, validator, workflow) was implemented or committed; no shared program tracker (`docs/program/*.md`) was updated; no test file was added, changed, or re-run; the manifest in §1 is a specification embedded in this document, not a committed data file. CodeGraph/direct file reads were used only against this task's authoritative-input list (§0) plus the current `server/src/tests/dbVerification/` directory listing and `server/package.json`'s `scripts` block, both read directly to confirm (not merely cite) the two concrete findings this design is built on (§0.1's manifest drift, §5.2's aggregate-chain exclusions).

Stated explicitly, because each is easy to imply by accident in a design document this detailed: **this document does not claim** (a) that a shadow-mode CI workflow exists — it does not, per the paragraph above; (b) that a disposable-PostgreSQL CI job exists — §4 is a translation of one manual, evidenced local run into an unimplemented design, not a running job; (c) that any shadow-mode observation has ever occurred — §7's acceptance criteria (≥50 PR observations, zero false negatives, ≥40% runtime reduction, ≥99% DB-job reliability) are all provisional targets against a zero-observation baseline, not measured results; (d) that any of §7's numeric thresholds, or §1.1's `maxAffectedModulesBeforeFullSuite`/`sharedPlatformFanInFiles` values, are accepted policy — all are carried forward as provisional per §3.8/§3.9/§7 and the "Unresolved decisions" list, pending external sign-off; (e) that targeted (affected-module) testing can replace full-suite testing for high-risk modules — §8 stage 3 states the opposite directly: `riskLevel: "high"` modules, shared-fan-in files, and schema/migration changes remain on the full suite unconditionally at every rollout stage, and even §8 stage 4's "final gating" is contingent on §7's criteria holding continuously, not a one-time pass.

## Exact next task

**Title:** Implement affected-module CI shadow mode (implements ARCH-TEST-002's design)
**Scope:**
1. Author the manifest file per §1, generated from `AFFECTED_MODULE_TEST_MATRIX.md` §2/§3/§5 — with an explicit process (script or documented manual procedure) for regenerating it, since §0.1 proved manual/one-time authoring goes stale within days.
2. Implement the resolver script per §2, including the non-code exemption (§2.2/§3.6) and the structural `scripts`-block diff (§3.5) — both new logic beyond a literal reading of the decision-tree doc's pseudocode.
3. Add `.github/workflows/main-app-affected-tests.yml` running in **shadow mode only** (§8 stage 1): both command sets, non-blocking, PR-comment output per §6.
4. Wire the disposable-Postgres service container per §4, including the digest-pinning requirement (§4.1) and the two-class failure handling (§4.6).
5. Implement §5.3's manifest-validation step and run it once immediately against the then-current tree to resolve §0.1's concrete finding (the `appointmentRequestConversionAtomicity.test.ts` gap) before shadow mode's first real PR run.
6. Begin §7's observation-data collection; do not proceed to §8 stage 2 (warning mode) until the minimum-observations and zero-false-negative criteria are met, and treat every numeric threshold in §7/§1.1/§3.8/§3.9 as explicitly open for revision based on that data, not as this document's final word.

This document explicitly stops here per the task's instruction — no part of items 1–6 above was started.

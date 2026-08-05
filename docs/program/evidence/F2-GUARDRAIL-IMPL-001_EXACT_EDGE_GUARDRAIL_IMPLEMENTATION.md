# F2-GUARDRAIL-IMPL-001 — Exact-Edge Architecture Guardrail, Report-Only Baseline (Implementation)

**Phase:** F2 — Modular Monolith Guardrails, Entitlements and Feature Flags
**Task type:** Implementation. Repository-only, report-only, non-blocking. No production/runtime behavior change, no Prisma migration, no schema change, no production environment variable, no microservice/framework migration, no tenant-filter change.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (own PR, once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Isolated worktree/branch: `feature/f2-guardrail-impl-001-report-only-exact-edge` (local path intentionally omitted as non-portable environment metadata, matching this program's established convention).

---

## 1. Baseline verification (independently confirmed, not assumed)

| Fact | Verified value |
|---|---|
| `git fetch origin --prune` | run at task start |
| `origin/main` SHA | `da23f6fd4b86d4a37dc56f90859b0806f8ce60c6` |
| PR #321 | `gh pr view 321` → `state: MERGED`, `mergeCommit.oid: da23f6fd4b86d4a37dc56f90859b0806f8ce60c6`, `mergedAt: 2026-08-05T10:09:53Z`, base `main` |
| PR #321 merge commit == `origin/main` tip | confirmed — `git rev-parse origin/main` returns the identical SHA |
| `git merge-base --is-ancestor` | confirmed ancestor (exit 0) |
| Main CI | `gh run view 30996305595` → `workflowName: ci-main-and-nightly`, `headSha: da23f6fd4b86d4a37dc56f90859b0806f8ce60c6`, `status: completed`, `conclusion: success` |

Worktree created via `git worktree add -b feature/f2-guardrail-impl-001-report-only-exact-edge origin/main`, HEAD confirmed at `da23f6f` (PR #321's own merge commit) before any file was written.

**Local-`main` staleness note (transparently recorded, not a discrepancy in `origin/main` itself):** the primary local working tree's own `main` branch was several commits behind `origin/main` at task start (`e9c1765` locally vs. `da23f6f` on `origin/main` — the primary tree had not yet been fast-forwarded past PR #321's own merge). This was resolved by working entirely from the fresh, task-isolated worktree created directly from `origin/main` (table above), never from the stale local branch. No file in the primary working tree was read, reset, or modified by this task.

## 2. Accepted authorization (F2-SEC-003, F2-GUARDRAIL-PREP-010-A/B/C/D)

`docs/program/evidence/F2-SEC-003_SECURITY_GATE_RECONCILIATION.md` §5.2 explicitly authorizes: **"(A) Repository-only guardrail implementation: AUTHORIZED, narrowly, as defined in §6 below (F2-GUARDRAIL-IMPL-001)."** §5.2 explicitly withholds: **"(B) Production enforcement: NOT AUTHORIZED. Enforcement must remain advisory/report-only, not CI-blocking, until"** a false-positive validation pass and F2-SEC-001/002 deployment + production verification, neither of which this task performs or claims. §6 names the exact frozen tuple this task must use: `(callerPath, callerSymbol, ownerDomain, targetModelOrSymbol, accessKind)`, frozen by PR #313 and adopted unchanged by `F2-GUARDRAIL-PREP-010-D`.

`F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (PR #313, 71 edges) is the accepted baseline evidence this task consumes read-only, per F2-SEC-003 §6's directive: *"Consume the existing evidence inventories... as its input baseline — do not re-derive them from scratch."*

**Discrepancy note (resolved during precondition verification, not a stop condition):** the assigning prompt's authoritative-sources list included `docs/program/evidence/F2-GUARDRAIL-PREP-011*`. No file matching that pattern exists anywhere in this repository at `origin/main` (`git ls-tree -r origin/main -- docs/program/evidence | grep -i PREP-011` returns nothing). This is recorded as a factual correction, not acted on further — F2-SEC-003 itself supersedes and does not reference any PREP-011 document, and independently supplies everything F2-GUARDRAIL-IMPL-001 needs (the frozen tuple, the authorization decision, and the exact next-task scope in its own §6). No PREP-011 content is fabricated or assumed anywhere in this task's own output (the implementation's `codeGraphLimitationNote` string was corrected during self-review to remove an initial erroneous `/011` reference).

## 3. Design selected

A small TypeScript CLI under `scripts/architecture-guardrail/`, following this repository's existing `scripts/test-runtime/` convention (own `tsconfig.json`, `tsx`-run via root `package.json` scripts, no build step, hand-rolled test harness matching `scripts/test-runtime/__tests__/orchestratorUnit.test.ts`'s own pattern — no new test-framework dependency).

Layered, single-responsibility modules under `scripts/architecture-guardrail/lib/`:

| File | Responsibility |
|---|---|
| `types.ts` | Shared types/schema (the exact-edge tuple, report shape) |
| `configLoader.ts` | Load/validate `config/scan-roots.json` and `config/domain-map.json` |
| `sourceDiscovery.ts` | Enumerate `.ts` files under the configured scan roots only |
| `moduleResolution.ts` | Resolve a relative import specifier to an on-disk file |
| `edgeExtraction.ts` | TypeScript-compiler-API syntactic parse → cross-domain import edges |
| `classification.ts` | File → domain lookup (exact match against the checked-in map; `UNRESOLVED` if absent, never guessed) |
| `normalization.ts` | POSIX/repo-relative path normalization, OS-independent |
| `globMatch.ts` | Minimal dependency-free glob matcher (`**`, `*`, `{a,b,c}`) for excludePatterns and baseline `callerPathGlob` |
| `findingId.ts` | Deterministic SHA-256-derived finding IDs from the semantic tuple |
| `baseline.ts` | Load/normalize/match the F2-GUARDRAIL-PREP-010-A baseline |
| `redact.ts` | Defense-in-depth secret-pattern redaction applied to report text |
| `report.ts` | Deterministic sort + final JSON report assembly |

`cli.ts` is the orchestration entry point (argument parsing, wiring, exit-code decision); `config/generateDomainMap.ts` is a small, separately-run (not part of the scan-time runtime path) provenance tool that mechanically derives `config/domain-map.json` from the already-accepted `F0-003_module_ownership_inventory.json`.

No file exceeds ~180 lines; each module has one clearly named responsibility, matching the task's "no huge single file" requirement.

## 4. Alternatives rejected and reasons

- **ESLint / eslint-boundaries** — rejected. The root project has no ESLint devDependency today (`grep eslint package.json` → none); adding one solely to satisfy an old roadmap mention, or repairing the currently non-functional root `lint` script, is explicitly out of this task's authorized scope.
- **A new AST/dependency-graph npm package (e.g. `dependency-cruiser`, `madge`)** — rejected. `F2-GUARDRAIL-PREP-010-A`'s own scope note ("No dependency-graph/AST tool currently exists") and this task's own dependency inspection (root `devDependencies.typescript: ^5.5.3`, `server/devDependencies.typescript: ^6.0.3`) confirmed the TypeScript compiler API is already available and sufficient for V1's syntactic-import-only scope. No new supply-chain dependency was added; `package-lock.json` is unchanged by this task.
- **Fragile unrestricted regex over source text** — rejected per the task's own explicit instruction. `edgeExtraction.ts` uses `ts.createSourceFile` + AST traversal of `ImportDeclaration` nodes, not string/regex matching, so multi-line imports, comments containing import-like text, and string literals elsewhere in a file cannot produce false edges.
- **Committing a new, self-referential baseline snapshot of the guardrail's own current findings** — rejected for this task. F2-SEC-003 §5.2 conditions any CI-blocking enforcement on "a baseline snapshot of the new guardrail's own report-only output is captured and reviewed (false-positive validation)" — that review has not happened yet. This task instead consumes the *existing*, already-accepted `F2-GUARDRAIL-PREP-010-A` evidence JSON directly (read-only) as its comparison baseline, per F2-SEC-003 §6's explicit "consume... do not re-derive" directive. Freezing a new baseline of this task's own 1,031 findings is documented here as a candidate **future** task, gated on the same false-positive-review prerequisite — not invented as authorization in this task.
- **Adding the guardrail job to any other job's `needs:` list, or gating Layer 2-5 on it** — rejected. Doing so would make application tests conditional on the guardrail tool succeeding, which the task explicitly forbids. The new job runs standalone.

## 5. Files changed

- `scripts/architecture-guardrail/` (new directory — CLI, `lib/`, `config/`, `__tests__/`, `.gitignore`, `tsconfig.json`)
- `package.json` (three new scripts: `guardrail:scan`, `guardrail:test`, `typecheck:guardrail` — no dependency change)
- `.github/workflows/ci-layers.yml` (one new standalone Layer 1 job, `architecture-guardrail-report-only`, plus header-comment updates)
- `.gitignore` (three new ignore entries for locally-generated report/test artifacts: `architecture-guardrail-report.json`, `det-run1.json`, `det-run2.json`)
- `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md` (status reconciliation)
- `docs/program/evidence/F2-GUARDRAIL-IMPL-001_EXACT_EDGE_GUARDRAIL_IMPLEMENTATION.md` (this file, new)
- `docs/program/evidence/F2-GUARDRAIL-IMPL-001_exact_edge_guardrail_implementation.json` (new, machine-readable companion)

No file under `server/prisma/migrations/`, no `server/prisma/schema.prisma`, no production route/service/repository/worker/auth/storage/messaging/imaging/integration source file was touched. `server/package.json` and root `package-lock.json` are unchanged.

## 6. New dependency details

**None.** No new npm dependency was added to either `package.json` or `package-lock.json`. The TypeScript compiler API is consumed via the already-installed root `typescript` devDependency (`^5.5.3`). `npm ci` was re-run in the task worktree and succeeds unchanged (427 packages, matching the pre-existing lockfile).

## 7. Guardrail scope (authorized)

Scan roots (exact match to `F2-GUARDRAIL-PREP-010-A`'s own `scope.scanRootsUsed`, checked in at `scripts/architecture-guardrail/config/scan-roots.json`):

- `server/src/routes`
- `server/src/services`
- `server/src/jobs`
- `server/src/middleware`
- `server/src/utils`

Only `.ts` files are scanned; `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts` are excluded. Domain ownership is resolved via `scripts/architecture-guardrail/config/domain-map.json` (179 file→domain entries), mechanically derived from the already-accepted `docs/program/evidence/F0-003_module_ownership_inventory.json` by `scripts/architecture-guardrail/config/generateDomainMap.ts`, restricted to the five roots above. 4 files that F0-003 itself lists under more than one domain's own evidence section (`server/src/utils/secrets.ts`, `server/src/utils/encryption.ts`, `server/src/services/treatmentStockDeduction.ts`, `server/src/routes/organizationDashboard.ts`) are mapped to `UNRESOLVED` rather than an invented single winner — see `generateDomainMap.ts`'s own header comment and the `ambiguousFilesMappedToUnresolved` field recorded in the generated config.

## 8. Excluded scope

- No CodeGraph tool was available in this environment (independently re-confirmed; same limitation `F2-GUARDRAIL-PREP-010-A` itself recorded). This is honestly recorded in every report's `executionMetadata.codeGraphUsed: false` field — no CodeGraph analysis is claimed anywhere.
- No whole-repository or whole-project scan is ever performed; a missing/renamed scan root is a hard, reported, exit-1 configuration failure (see §16), not a silent scope expansion elsewhere.
- Frontend (`src/`), `bridge-agent/`, `windows-bridge/` — out of scope, matching `F2-GUARDRAIL-PREP-010-A`'s own exclusions.
- Direct Prisma model access (`prisma.<model>.<method>()`) is **not** detected in this version — only relative-import-based cross-domain edges are. This is a deliberate first-version scope decision (see §24, known false negatives).
- ESLint, `eslint-boundaries`, the root `lint` script, and any CI-blocking rule are untouched.
- Tenant-scope *enforcement* (as opposed to advisory tenant-scope disclaimer text) is out of scope — see §18.

## 9. Detection algorithm

For every file discovered under the five authorized scan roots (excluding test files):

1. Read the file's text content (an unreadable file is recorded in `errors[]` with only an OS error code, never a raw fs-error message that could echo an absolute path, and the scan continues over the remaining files).
2. Parse it with `ts.createSourceFile` (syntactic parse only; no `ts.Program`/type-checker is constructed). TypeScript's parser is error-tolerant, so a syntactically broken function body elsewhere in the file does not prevent extraction of a valid top-level `import` statement (verified by a dedicated fixture test).
3. For every top-level `ImportDeclaration` whose module specifier is relative (`./` or `../`— bare/package specifiers are never followed), resolve it to an on-disk `.ts`/`.tsx` file. An unresolvable specifier is recorded in `warnings[]`, not `errors[]`, and does not stop the scan.
4. Classify the caller file's domain and the resolved target file's domain via the checked-in domain map (§7). If they are equal (including both `UNRESOLVED`), this is not a cross-domain edge — no finding.
5. Otherwise, for every imported binding in the statement (each named import, the default import, the namespace import, or — for a side-effect-only import with no binding — the literal symbol `module`), emit one finding with the exact five-field tuple (§10).

## 10. Exact finding tuple/schema

Per finding, unchanged field names/order from the frozen identity:

```json
{
  "callerPath": "server/src/services/postTreatmentMessaging.ts",
  "callerSymbol": "sendPostTreatmentWhatsApp",
  "ownerDomain": "messaging-whatsapp",
  "targetModelOrSymbol": "services/whatsapp/whatsappOutboundMessaging.ts",
  "accessKind": "import"
}
```

`callerPath` is repo-relative (`server/src/...`); `targetModelOrSymbol` is relative to `server/src/` (no prefix) — this asymmetry is not an inconsistency introduced by this task, it is copied exactly from `F2-GUARDRAIL-PREP-010-A`'s own accepted `proposedEnforcementKey` shape (verified against its `CDA-067`..`CDA-072` entries). `accessKind` is always `"import"` in this version — see §24.

Each `Finding` additionally carries `id` (stable hash, §11), `callerDomain` (informational — the caller's own domain, not part of the frozen tuple), `baselineStatus` (`EXISTING`/`NEW`), and `baselineEdgeId` (the matched baseline entry, or `null`).

## 11. Stable ID method

`SHA-256(callerPath + " " + callerSymbol + " " + ownerDomain + " " + targetModelOrSymbol + " " + accessKind)`, hex-truncated to 16 characters. Line number, column, or any other non-semantic detail is never part of the hash input — confirmed by a dedicated unit test that changes each of the five fields independently and asserts the ID changes, and by two independent full scans over the same commit producing byte-identical `findings[]` (§17).

## 12. Baseline behavior

No **new** baseline artifact is committed by this task (see §4). Baseline comparison consumes `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` directly, read-only, at scan time. Match key: `(ownerDomain, targetModelOrSymbol, accessKind, callerPath)` — `callerPath` matches either an exact string or a `callerPathGlob` pattern (the guardrail's own minimal glob matcher).

**Documented, deliberate limitation:** `callerSymbol` is excluded from the match key. Of the 71 frozen baseline edges, only the 6 corrected in the `F2-GUARDRAIL-PREP-010-A-R1` pass (`CDA-067`..`CDA-072`) carry an exact, single-identifier `callerSymbol`; the rest store free-text/descriptive values (e.g. `"logActivity / writeAuditLog callers"`). Matching strictly on all five fields would classify the large majority of the baseline as absent on every run, which is not a useful drift signal. `callerSymbol` is still reported on every finding for human review; `matchKeyLimitation` in the report's own `baselineComparison` field states this explicitly so no downstream reader mistakes the comparison for exact five-field matching.

`RESOLVED` status is computed **only** for baseline entries with an exact (non-glob) `callerPath`, since "resolved" is not well-defined for a pattern that could still match many files. Per the task's own caution, a `RESOLVED` classification is never asserted as confirmed remediation — the report's `tenantScopeDisclaimer` and this document both state that a finding's disappearance requires source-level human verification, not automatic trust.

## 13. Exit-code behavior

- **0** — the scan executed, regardless of finding count. Architectural findings (0 or 1,031) never produce a non-zero exit.
- **1** — a genuine tool/configuration/execution failure only: malformed/unreadable `scan-roots.json`, malformed/unreadable `domain-map.json`, malformed/unreadable baseline JSON, or a **configured scan root** missing/unreadable on disk (the tool did not cover its promised/authorized scope). A single unreadable or syntactically broken **source file** within an otherwise-present scan root does **not** cause a non-zero exit — it is recorded in `errors[]`/handled by TypeScript's tolerant parser, and the scan continues.

Tested end-to-end both as a pure function (`runGuardrail()`) and as a real spawned child process (`cli.test.ts`, "cli: real process invocation" section) — see §21/§22.

## 14. CI integration behavior

A new, standalone Layer 1 job, `architecture-guardrail-report-only`, added to `.github/workflows/ci-layers.yml` (the existing reusable workflow called by both `ci-pr.yml` and `ci-main-and-nightly.yml` with no path filters — this job therefore runs on every PR and every main push/nightly/manual-dispatch trigger, same as every other Layer 1 job). Steps: checkout (SHA-pinned, matching every existing job), setup-node (SHA-pinned), `npm ci`, guardrail typecheck, guardrail unit tests, run the scan (`--out=architecture-guardrail-report.json`), validate the JSON, grep-scan it for the same prohibited secret patterns the existing disposable-runtime jobs already use, upload it as an artifact (`actions/upload-artifact`, SHA-pinned, 30-day retention).

**Design choice — separate job, not a step in an existing job:** a dedicated job gives the guardrail its own clear pass/fail status and its own artifact, without adding runtime to (or coupling failure modes with) `tooling-typecheck-and-unit` or any other existing job. It also lets `needs:` semantics stay simple and correct: this job is in **no** other job's `needs:` list, and nothing needs it — a guardrail-tool crash must never gate application tests, and existing Layer 2-5 jobs' own `needs:` lists are unchanged (still exactly `[frontend-typecheck-and-build, server-typecheck, tooling-typecheck-and-unit, workflow-and-syntax-lint]`).

`continue-on-error` is **not** used anywhere in the new job — a genuine tool crash still turns the job (and only this job) red, per the task's own explicit requirement. No existing job's steps, path coverage, or `needs:` list was narrowed, removed, or weakened. `actionlint v1.7.12` (same pinned version the repository's own `workflow-and-syntax-lint` job uses) was run locally against the full `.github/workflows/**` tree and against `ci-layers.yml` specifically — both clean, exit 0 (§21/§22).

Whether this new job is marked a *required* GitHub branch-protection check is a repository-admin setting outside this PR's file-level scope. Given the task's non-blocking mandate, this document recommends it **not** be marked required until the F2-SEC-003 §5.2 false-positive-validation prerequisite is met — that is an operational decision for the repository owner, not something this task configures.

## 15. Security and tenant impact

No security-sensitive or tenant-scoping source file was modified. The tool never reads `.env`, secrets, or production configuration — its only inputs are TypeScript source syntax (import statements) under the five scan roots, two small checked-in JSON config files, and (read-only) the already-committed `F2-GUARDRAIL-PREP-010-A` evidence JSON. Every report includes a `tenantScopeDisclaimer` array stating verbatim: static findings are advisory signals only; absence of findings is not proof of tenant isolation; runtime tenant tests, authorization tests, ORM guards, and any future row-level security remain independent controls; raw SQL and dynamic Prisma access may require explicit human review (this version does not analyze either). No tenant filter, `clinicScope`/`tenantGuard` logic, or authorization check was read, modified, or relied upon for any correctness claim.

## 16. Backward compatibility

Purely additive: a new directory, three new `package.json` scripts, one new standalone CI job, four documentation-status updates, and two `.gitignore` entries. No existing script, workflow job, `needs:` list, or path filter was changed or removed. `npm ci` (root and server) succeeds unchanged. Root frontend build (`npm run build`) and server typecheck (`npm run typecheck`) both still pass (§21/§22).

## 17. Rollback

Repository-only, exact:

1. `git rm -r scripts/architecture-guardrail`
2. Revert the three added lines from `package.json`'s `scripts` block (`guardrail:scan`, `guardrail:test`, `typecheck:guardrail`)
3. Revert the `architecture-guardrail-report-only` job block and the three header-comment edits in `.github/workflows/ci-layers.yml`
4. Revert the three added `.gitignore` lines
5. Revert the documentation-status edits in `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`
6. Delete the two new evidence files

Equivalently: `git revert` this task's single merge commit once merged (not done by this task). **No database migration, no runtime rollback, no production configuration rollback, and no deployment rollback is needed or implied** — no such changes were made.

## 18. Known false-positive risk (high, expected, explicitly anticipated by F2-SEC-003 §5.2)

Scanning the real, authorized scope on `origin/main` @ `da23f6f` produced **1,031 findings (1,018 `NEW`, 13 `EXISTING`)** against the 71-edge frozen baseline — see §22 for the exact command/output. This is expected, not a defect: `F2-GUARDRAIL-PREP-010-A`'s 71 edges are a **curated, manually-classified sample** (its own methodology groups many call sites into one edge and explicitly excludes same-domain findings, disabled routes, and frontend edges); this guardrail is **exhaustive** — it emits one finding per imported binding per call site. A single broadly-imported shared utility can legitimately produce dozens of `NEW` findings that are not new architectural violations, merely a finer decomposition than the manual baseline ever attempted. **This is precisely the false-positive-validation gap F2-SEC-003 §5.2 names as the prerequisite before any CI-blocking use** — this task does not attempt to close that gap; it is out of this task's own authorized scope (advisory/report-only only).

## 19. Known false negatives / limitations

- **No direct-Prisma-access detection.** `accessKind` is always `"import"`; a caller directly calling `prisma.<model>.<method>()` on a foreign domain's model (several `F2-GUARDRAIL-PREP-010-A` baseline edges, e.g. the `TRC -> INV` `treatmentStockDeduction.ts` edge) is not detected by this version. Requires semantic Prisma-model-ownership analysis, deferred to a future task.
- **`callerSymbol` excluded from baseline matching** — see §12.
- **Domain-ownership collisions map to `UNRESOLVED`, not resolved** — see §7 (4 files).
- **No CodeGraph** — targeted TypeScript-compiler-API parsing was used instead; see §8.
- **Bare/package-specifier imports (npm dependencies) are never followed** — by design; this guardrail detects internal cross-domain boundary crossings, not third-party dependency usage.
- **A target outside `server/src/` is never followed** (e.g. an import reaching outside the server package); such edges are silently out of scope, not flagged as `UNRESOLVED`.

## 20. Tenant/security implications

See §15. No tenant-isolation claim is made or implied by a clean (zero-`NEW`) run.

## 21. Exact test commands, results, and exit codes

All commands run from the task worktree root unless noted.

| Command | Result | Exit code |
|---|---|---|
| `npm run guardrail:test` (56 focused unit tests: extraction, normalization, classification, deterministic IDs/sorting, no-absolute-paths, empty/multiple findings, malformed config/baseline, unreadable/missing configured path, exit-code contract via both pure-function and real spawned-subprocess invocation, JSON shape, secret redaction, Windows/POSIX path normalization) | **56 passed, 0 failed** | 0 |
| `npm run typecheck:guardrail` (`tsc --noEmit -p scripts/architecture-guardrail/tsconfig.json`) | clean, no output | 0 |
| `npm run guardrail:scan -- --repo-sha=da23f6fd4b86d4a37dc56f90859b0806f8ce60c6 --out=architecture-guardrail-report.json` (authorized repository scope) | 247 files discovered/parsed, 0 skipped, 1,031 findings (1,018 NEW / 13 EXISTING), 0 errors, 0 warnings | 0 |
| `node -e "JSON.parse(...)"` against the generated report | `report JSON valid` | 0 |
| `grep -EiI` (exact pattern from `ci-layers.yml`'s own existing secret-scan steps) against the generated report | `no prohibited secret patterns` | 0 |
| Determinism check: two independent `--deterministic` runs, `diff`'d | `IDENTICAL` (byte-for-byte) | 0 |
| `npm run build` (root frontend typecheck + Vite build, Layer 1 `frontend-typecheck-and-build`) | build succeeded | 0 |
| `cd server && npm ci && npm run typecheck` (Prisma generate + `tsc --noEmit`, Layer 1 `server-typecheck`) | clean | 0 |
| `npm run typecheck:runtime` (Layer 1 `tooling-typecheck-and-unit`, unaffected-regression check) | clean | 0 |
| `npm run test:runtime:unit` (same job, unaffected-regression check) | **74 passed, 0 failed** | 0 |
| `actionlint v1.7.12` (same pinned version as `workflow-and-syntax-lint`) against `.github/workflows/**` and against `ci-layers.yml` specifically | no findings | 0 |
| `node -e "JSON.parse(...)"` against `package.json` and `server/package.json` | both OK | 0 |

Shell/PowerShell syntax validation (`bash -n`, PowerShell `Parser::ParseFile`) was **not** re-run — this task added no `.sh`/`.ps1` file, so `workflow-and-syntax-lint`'s existing shell/PowerShell steps have nothing new to validate; they are unaffected and were not expected to change.

Full CI-layer jobs triggered by the PR (`ci-pr.yml` → `ci-layers.yml`, all 10 jobs including the new one) have **not yet run** as of this document — the PR had not been opened at the time this evidence was authored (see the delivery report's own PR section for the run link once available). This document does not claim CI-green on the actual PR; only the locally-reproduced equivalent of each affected job's own commands, above.

## 22. Generated report summary (real repository scope, `da23f6f`)

```json
{
  "summary": { "totalFindings": 1031, "newFindings": 1018, "existingFindings": 13, "errorCount": 0, "warningCount": 0 },
  "scope": { "scanRoots": ["server/src/jobs", "server/src/middleware", "server/src/routes", "server/src/services", "server/src/utils"] },
  "executionMetadata": { "filesDiscovered": 247, "filesParsed": 247, "filesSkipped": 0, "codeGraphUsed": false, "durationMs": ~750 }
}
```

## 23. Migration status

No Prisma migration exists, was created, or is required by this task. `server/prisma/migrations/` and `server/prisma/schema.prisma` are unchanged (confirmed by `git status` scoped to `server/prisma/`).

## 24. Accepted findings vs. rejected/unverified claims

**Accepted (verified in this document):** baseline preconditions (§1); authorization (§2); no new dependency (§6); no absolute paths / no secret patterns in the generated report (§21); deterministic output (§21); exit-code contract (§13, tested both ways); no runtime/production/migration change (§16, §23).

**Explicitly not claimed:** that 1,018 `NEW` findings are 1,018 real architectural violations (§18 — most are expected to be false positives pending a dedicated review pass); that this tool proves tenant isolation (§15); that CI has gone green on the actual opened PR (§21, last paragraph); merged/deployed/production-verified status (all `NOT_*`, per §header).

## 25. Next authorization gate

Per F2-SEC-003 §5.2 and this document's own §18: **(1)** a dedicated false-positive-review pass over this task's own report-only output (program-owner reviewed, not self-verified) before any CI-blocking behavior is even proposed; **(2)** F2-SEC-001/F2-SEC-002 deployed and production-verified (independent of this task, tracked by F2-SEC-003 §3-§4); **(3)** only after both, a future task may define measurable promotion criteria and propose (not silently enable) CI-blocking enforcement, and separately, may propose committing a self-referential baseline snapshot. This task authorizes neither.

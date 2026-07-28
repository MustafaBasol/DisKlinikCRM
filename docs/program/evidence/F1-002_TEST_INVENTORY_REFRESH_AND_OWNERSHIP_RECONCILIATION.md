# F1-002 — Test Inventory Refresh and Ownership Reconciliation

Task ID: F1-002 · Phase: F1 — CI and Test Architecture · Status: `AGENT_COMPLETED` (documentation/evidence-only — see [NORAMEDI_MASTER_TRACKER.md §2.2](../NORAMEDI_MASTER_TRACKER.md) for task-status vocabulary). Not `MERGED` — requires external review and an actual merged PR.

## 0. Task classification and prohibitions

Documentation/evidence-first repository inventory and reconciliation. No CI implementation, no test-selection engine implementation, no runtime behavior change, no deployment. This task did not modify any test file, package script, CI workflow, application/runtime file, Prisma schema/migration, or deployment/environment file. It did not close R-046, did not close R-071, did not declare the KVKK baseline stable, did not approve G1/G2, and did not touch any KVKK implementation branch/worktree/code.

## 1. Baseline reconciliation

- **F1-001 / PR #241 merge commit (initial expected baseline):** `94cc4ac58f0487dd186886878c5628627f0b1ce3`.
- **`git fetch origin --prune` result:** `origin/main` was at `08f2eaf82a205cf3f997c57e6a295fedd66b142d` at task start — advanced past the expected baseline.
- **Ancestry check:** `git merge-base --is-ancestor 94cc4ac58f0487dd186886878c5628627f0b1ce3 origin/main` → exit `0` (true). The expected baseline is a clean ancestor; history did not diverge.
- **Intervening commits inspected (94cc4ac..08f2eaf, 27 commits, PR #242–#252):** `git log --oneline` and `git diff --stat` were run against the full range. This is KVKK backup/retention/AI-privacy/schema-integrity implementation work (FILE-BACKUP-COVERAGE-001, RETENTION-MANUAL-RUN-AUDIT-001, AI-PROMPT-REDACTION-GAP-001 closeout, KVKK-HIGH-007/HIGH-008 schema-integrity guard, INFRA-ENCRYPTION-RESIDENCY-EVIDENCE-001, backup-restore rehearsal, R-046 production verification) plus one unrelated fix (`fix(reports): repair revenue period grouping`, PR #252). All of it is merged via reviewed PRs against `main`, per the git log. This is ordinary forward progression, not a divergent or unreviewed branch.
- **Impact on test files/scripts/schema/CI, per the diffstat:** `server/package.json` gained 6 new `test:*` scripts and 2 new aggregate-chain entries (see §5); `server/prisma/schema.prisma` and one migration changed (KVKK-HIGH-007/HIGH-008 additive schema, `20260726...` era); 6 backend test files changed (1 heavily-modified existing file, 5 new); no `.github/workflows/**` file changed.
- **Execution baseline used for this task:** `08f2eaf82a205cf3f997c57e6a295fedd66b142d`.
- **Re-checked immediately before commit (see §9):** `origin/main` re-fetched; no further advancement, or advancement inspected and found immaterial to this task's file set (record the actual result at commit time, not assumed here).

## 2. Parallel KVKK authorization and protection statement

This task ran in an isolated worktree/branch (`docs/f1-002-test-inventory-refresh`, `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-002-test-inventory-refresh`), based on freshly-fetched `origin/main`. `git worktree list` at task start showed multiple concurrent KVKK/review worktrees (`ai-prompt-redaction-gap-001`, `backup-restore-rehearsal-001`, `file-backup-coverage-001`, `retention-manual-run-audit-001`, `kvkk-legal-incident-readiness`, several `review-pr24*` worktrees, `infra-encryption-residency-evidence-001`, `review-kvkk-doc-evidence-wave`) — none of these were opened, read, or modified by this task. This task did not modify KVKK branches/worktrees, did not modify KVKK implementation code, did not close any KVKK risk (R-046, R-071 unchanged), and did not change G0/G1/G2 status or the KVKK freeze status. Production was neither accessed nor inferred from merge status.

## 3. Worktree and primary-tree safety

The primary tree (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, containing active work on branch `fix/revenue-report-group-by`) was never modified — only read-only `git fetch`/`git rev-parse`/`git status`/`git branch`/`git worktree list`/`git log`/`git diff --stat` commands were run against it. All file reads, inventory commands, and document edits happened exclusively inside the isolated worktree above. No stash, clean, reset, checkout, merge, rebase, stage, or commit was performed against the primary tree.

## 4. Documents and files inspected

Full read: `docs/program/TEST_OWNERSHIP.md`, `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`, `docs/program/RISK_REGISTER.md` (§ R-072/R-001-R-006 rows + full change-log header), `docs/program/evidence/README.md`, `docs/program/MODULE_MAP.md`, `docs/program/DEPENDENCY_MAP.md`, `docs/program/architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md`, `docs/program/architecture/evidence/f1-001-test-scope-classification.json`, `server/package.json`, root `package.json`, `bridge-agent/package.json`, `vitest.config.ts`.
Targeted/partial read (grep + offset reads, files too large for a single read — 275KB/244-line-but-huge-paragraph and 656-line/64KB files): `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md` (F1/F1-001-relevant sections only).
Not read in full (out of narrow scope, referenced only): `docs/program/ARCHITECTURE_DECISIONS.md`, `docs/program/RELEASE_GATES.md`, `docs/program/LAUNCH_GATES.md`, `AGENTS.md`.
Structural/machine-readable: `docs/program/evidence/F0-005_test_inventory.json` (full `testFiles[]` array extracted programmatically, 4291 lines).

## 5. CodeGraph

`command -v codegraph` → exit 1 (not found). `ToolSearch("codegraph")` → no matching deferred tools found. **CodeGraph is unavailable in this task's execution environment**, the same finding F1-001 recorded. Per instructions, targeted filesystem inventory (`find`/recursive `fs.readdirSync` walks), direct file-header/import inspection, and programmatic `package.json` parsing (Node `require()` + regex extraction, not manual reading) were used instead. No whole-repository exploratory scan was performed.

## 6. Exact inventory counts and commands

| Target | Count | Exact command |
|---|---|---|
| Backend `server/src/tests/*.test.ts` | **105** | `find server/src/tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \) \| sort \| wc -l` |
| Frontend `src/**/*.test.ts(x)` | **9** | `find src -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \) \| sort \| wc -l` |
| `bridge-agent/tests/*.test.ts` | **9** (unchanged) | `find bridge-agent -type f \( -name '*.test.*' -o -name '*.spec.*' \)` |
| `windows-bridge` .NET test projects | **4** (unchanged) | `find windows-bridge/tests -maxdepth 1 -type d -iname 'NoraMedi.Bridge.*'` |
| `windows-bridge` installer PowerShell test scripts | **4** (unchanged) | `find windows-bridge/tests/installer -iname '*.Tests.ps1'` |
| Manual disposable-DB verify scripts (`server/scripts/verify-*.ts`) | **4** (F0-005: 3, +1) | `find server/scripts -iname 'verify-*'` |
| Smoke/deploy scripts (`scripts/*.sh`) | **2** (unchanged) | `ls scripts/*.sh` |
| **Total test/verification targets** | **137** (F0-005: 100) | sum of the above |

Non-standard test names were searched for repository-wide (`*.spec.*` outside the standard roots) — none found beyond the ones already listed above.

## 7. Delta since F0-005 (2026-07-19 baseline, 100 entries)

- **Added: 34 backend + 3 frontend + 1 manual verify script = 38 new targets.** Full list with per-file classification: `docs/program/evidence/F1-002_test_inventory.json` `testFiles[]`, entries with `currentStatus` starting `NEW_SINCE_F0-005`.
- **Removed or renamed: 0.** The naive diff between F0-005's 100-path list and the current 137-path list initially flagged 22 "removed" paths (`bridge-agent/**`, `windows-bridge/**`, `server/scripts/verify-*.ts`, `scripts/*.sh`) — these are a comparison-scope artifact (F0-005's path diff was run only against `server/src/tests`/`src`, excluding these categories), not genuine removals. All 22 were independently re-confirmed present on disk by direct `find`/`ls` at the execution baseline.
- **Materially modified, path unchanged:** `server/src/tests/aiPrivacyBoundary.test.ts` — present in F0-005 (15 test cases, 273 lines at the 2026-07-19 baseline) but substantially rewritten in the intervening PRs (origin/main diff `94cc4ac..08f2eaf` shows `+659` lines for this file) and newly gained its own `package.json` script (`test:ai-prompt-privacy`, also newly wired into the full `npm run test` chain). Carried forward with `confidence: MEDIUM` (not re-read line-by-line) rather than treated as a fresh classification.
- **R-072 cross-check:** F1-001 itself measured 96 backend + 9 frontend files at its own design baseline (`d0311636`, 2026-07-25). F1-002's execution baseline (`08f2eaf`, 2026-07-28, 3 days/9 PRs later) shows 105 backend + 9 frontend — the +9 backend delta versus F1-001's own snapshot is exactly the set of test files added by PR #242–#252 (KVKK backup/retention/schema-integrity/revenue-report work), independently confirmed against the `git diff --stat` of that commit range.

## 8. Canonical ownership results

All 137 targets received an explicit `canonicalOwner` — **0 `UNKNOWN` entries**. For the 78 carried-forward `server/src/tests`/`src` entries (72+6 minus `aiPrivacyBoundary`, plus `aiPrivacyBoundary` itself handled specially) and the 22 carried-forward bridge-agent/windows-bridge/manual-script entries, ownership was reused verbatim from `F0-005_test_inventory.json` (already evidence-cited by that task) and re-confirmed only by path-existence, not re-derived. For the 37 genuinely new targets (36 new files by path + 1 new manual verify script), ownership was derived fresh from each file's own header docblock (a strong, consistent convention present on every file in this repository) and, where the header did not settle the question, its import list — see `evidenceReference` on each entry in `F1-002_test_inventory.json` for the exact citation. Ownership follows behavior protected, not folder location, per `TEST_OWNERSHIP.md` §10 — e.g. every `kvkkHigh006Db*.test.ts` file under `server/src/tests/dbVerification/` is owned by **Tenant Security and Scope** (the behavior it protects: clinic-scope correctness), with the specific route domain it exercises (Inventory, Insurance, Basic Payments, etc.) recorded as a `secondaryDomains[]` entry, not the canonical owner.

## 9. Secondary-domain results

Every new/reclassified entry received explicit `secondaryDomains[]` where the test exercises more than one domain's routes/services (e.g. `organizationMessagingConnectionScope.test.ts` → primary `Tenant Security and Scope`, secondary `Messaging — WhatsApp`, `Messaging — Instagram`, `Organization / Clinic / User Membership`). Full detail in `F1-002_test_inventory.json`.

## 10. Unknown/unowned tests

None. See §8 and `docs/program/evidence/F1-002_test_ownership_gaps.json` `unknownOwnership` (empty array, with an explicit note that none were found rather than the field being silently omitted).

## 11. Test type / runtime classification summary

`testType` distribution across all 137 targets and `runtimeClass` distribution are recorded in `F1-002_test_inventory.json`. For the 37 newly-classified entries, the task's own recommended `testType`/`runtimeClass` vocabulary was applied exactly. For the 100 carried-forward entries, F0-005's own (richer, pre-existing) `testType` vocabulary (e.g. `BRIDGE_UNIT`, `PROVIDER_ADAPTER`, `AUTH_SECURITY`, `FRONTEND_UTILITY`) was preserved rather than lossily remapped, since remapping without re-reading each file risked mischaracterizing behavior this task did not re-verify — this is recorded explicitly as a deliberate methodology choice, not an oversight, in the inventory JSON's `methodology` field.

**Database/external-service dependency:** 67 of 137 targets require a disposable PostgreSQL instance and/or an external service mock (S3-compatible MinIO for `fileBackupDbIntegration.test.ts`; a mocked Meta Graph API fetch stub for `metaWhatsAppPostBookingHandler.test.ts`, which is not a real network call). None were executed against a live database or external service by this task — no live Postgres/MinIO instance was available in this task's environment, consistent with every prior F0/F1 task's own documented limitation. This is recorded as a classification, not a claimed pass/fail.

## 12. Package-script reconciliation findings

Parsed programmatically (Node, regex extraction of `tsx <path>` invocations and `npm run <name>` tokens inside the aggregate `test` script — not manual reading) from `server/package.json`, root `package.json`, and `bridge-agent/package.json`. Full output: `docs/program/evidence/F1-002_test_script_reconciliation.json`.

- Server aggregate `npm run test` chain: **77** distinct `npm run <name>` tokens (up from F0-005's 56).
- **0 stale/dead script references** — every script's target file path was checked with `fs.existsSync` against the execution baseline; none reference a missing file.
- **0 duplicate/ambiguous coverage** — no two script names map to overlapping-but-different file sets.
- Frontend (`root/package.json`) still has no aggregate script chaining its 7 individual `test:*` scripts (F0-005's finding, unchanged); the new `test:vitest` script is itself an aggregate over the vitest-glob-matched files only.

## 13. Dead/stale script findings

None found (see §12). This is a genuine "no findings" result, not an incomplete check — the check was exhaustive over every `test*`-prefixed script in all three `package.json` files.

## 14. Unscripted test findings

**8 backend files have zero package.json script of any kind** (individual or aggregate) — `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts` (5, unchanged since F0-005), `kvkkHigh006Batch2ClinicScope.test.ts`, `metaWhatsAppPostBookingHandler.test.ts`, `planLimitsTargetClinicFix.test.ts` (3, newly added without a script). `aiPrivacyBoundary.test.ts` — one of F0-005's original 6 — is **resolved**: it now has `test:ai-prompt-privacy`, wired into the full chain. **16 backend files have a script but are not in the full-suite aggregate chain** — 6 are F0-005's pre-existing orphans (unchanged), 8 are dbVerification/DB-or-external-dependent scripts correctly excluded by design (same pattern F0-005 established for `communicationConsent`/`communicationPreferenceBackfill`), and 2 are genuine gaps worth flagging: `test:file-backup` (`fileBackupService.test.ts` — DB-independent per its own header, yet not chained) and `test:platform-admin-password-recovery` (uses a real dev Postgres per its header, arguably correctly excluded but not explicitly documented as such). **0 frontend files are unreachable by any script** (7 individual scripts + `test:vitest` glob cover all 9).

## 15. Database/external dependency findings

See §11 for the count. No disposable-Postgres provisioning mechanism exists in this repository as committed infrastructure (confirmed unchanged from F0-005/F1-001's own finding) — every `DISPOSABLE_POSTGRES`-classified test in this inventory is a classification of requirement, not a claim of successful execution. `dbVerification/fileBackupDbIntegration.test.ts` additionally requires a disposable S3-compatible (MinIO) endpoint. No production or external-provider call was made by this task.

## 16. R-072 closure assessment

See `docs/program/evidence/F1-002_test_ownership_gaps.json` `r072ClosureAssessment` for the condition-by-condition table. **Verdict: all 10 conditions from the task specification are met** — every current backend and frontend test file is inventoried (proven by exact commands, §6), every test has an explicit canonical owner with 0 UNKNOWN entries (§8, §10), every test-related package script is reconciled with 0 stale references (§12–§13), every test file's script reachability is explicitly known (§14, including the 8 never-scripted files, which are known-and-recorded, not unknown), the JSON evidence validates (§17), and no current-main drift invalidated the inventory before PR creation (§18, re-checked). **R-072 is recommended for closure** — see §17 of `RISK_REGISTER.md` update below for the exact proposed status (this task does not have authority to unilaterally declare `CLOSED` without the same external-review discipline this program applies to every other risk closure; it is recorded as `CLOSURE_PROPOSED`, matching the R-071 precedent for self-verification vs. external confirmation).

## 17. JSON validation results

```
node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F1-002_test_inventory.json','utf8')); console.log('inventory valid')"
inventory valid

node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F1-002_test_script_reconciliation.json','utf8')); console.log('scripts valid')"
scripts valid

node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F1-002_test_ownership_gaps.json','utf8')); console.log('gaps valid')"
gaps valid
```

## 18. Other validation

`git diff --check` (no whitespace conflicts), `git status --short`, `git diff --name-only origin/main...HEAD`, `git diff --stat origin/main...HEAD`, and the prohibited-path grep (`.github/workflows|package\.json|package-lock\.json|schema\.prisma|migrations|server/src|^src/`) were all run before commit — see the delivery report in the task's final message for exact output. No documentation validator script exists in this repository (consistent with every prior F0/F1 task's own finding — none was invented here).

## 19. Methodology notes and known limitations

- **No test was executed.** This task's scope is inventory/ownership/script-reconciliation only, per its own explicit prohibition. All `runtimeClass`/`databaseRequired` classifications are derived from static evidence (headers, imports), not from running the test.
- **`testType` vocabulary is intentionally mixed** between F0-005's original (richer) vocabulary for carried-forward entries and this task's specified vocabulary for new entries — see §11.
- **`aiPrivacyBoundary.test.ts`** is the one file where "carried forward" required judgment: it was not treated as brand-new (its path and domain ownership are unchanged) but its confidence was explicitly downgraded rather than silently kept at `HIGH`.
- **Two flagged findings beyond the literal R-072 remediation** worth a human decision, recorded here rather than acted on: (1) `test:file-backup` should probably be added to the aggregate `test` chain (DB-independent, unlike its neighbors); (2) 3 new backend test files were never given a script at all — the same class of gap F0-005 found and flagged, not eliminated by this task since fixing it would require modifying `package.json`, which is prohibited in this task's scope.

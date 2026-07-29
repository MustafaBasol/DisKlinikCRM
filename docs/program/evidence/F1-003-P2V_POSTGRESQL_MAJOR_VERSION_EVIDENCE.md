# F1-003-P2V — PostgreSQL Major-Version Evidence Closure

**Task type: PARALLEL INFRASTRUCTURE EVIDENCE / DOCUMENTATION ONLY. Status: `AGENT_COMPLETED` — evidence gathered, conclusion reached, not merged, not a new production verification event.**

## 1. Task identity and parallel authorization

| Field | Value |
|---|---|
| Task ID | F1-003-P2V |
| Parent task | F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness |
| Phase | F1 — CI and Test Architecture |
| Task type | Parallel infrastructure evidence / documentation only |
| Explicitly authorized parallel task | F1-003-P2 — Disposable PostgreSQL and MinIO Provisioning and Collision Avoidance. F1-003-P2 owns all runtime/tooling/package-script/test/evidence files for its own implementation; this task does not touch any of them. |
| Production access | None. No SSH, no live database query, no secret read. Every finding below is sourced from repository-committed, already-accepted evidence files. |

## 2. Baseline and worktree

- Primary repository (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, branch `fix/revenue-report-group-by`): `git status --short` → clean, untouched by this task.
- `git fetch origin --prune` → `origin/main` at `ed568c9db3b0d62a049bc291d2137f5c913a7ac7` — this is exactly the expected authoritative ancestor named in the task brief (PR #256's own merge commit).
- `git merge-base --is-ancestor ed568c9db3b0d62a049bc291d2137f5c913a7ac7 origin/main` → exit `0` (trivially true — `origin/main` and this commit are identical).
- `git log --oneline --decorate -12 origin/main` → no commits exist after PR #256's merge commit; `origin/main` is exactly at the expected baseline, zero drift.
- `gh pr view 256 --json state,mergedAt,mergeCommit` → `state: MERGED`, `mergedAt: 2026-07-28T22:50:43Z`, `mergeCommit.oid: ed568c9db3b0d62a049bc291d2137f5c913a7ac7` — confirms PR #256 (F1-003-P2A/R1/R1A/R1B disposable-runtime design lineage) is now merged. This is newer information than that lineage's own self-referential text (its explicit non-claims list states "PR #256 is merged (still open as of F1-003-R1B, 2026-07-29)" — accurate when written, superseded by the actual merge shortly after). This task does not edit that document (out of scope, §7 below); it is noted here only because it explains why this document was able to read `F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` as accepted, merged `origin/main` content rather than an open-PR branch.
- `git worktree list` → an active P2 worktree exists: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-p2-disposable-runtime`, branch `feature/f1-003-p2-disposable-runtime`, at `ed568c9` (identical to `origin/main`, no divergent commits yet). **Not touched, not read beyond this `git worktree list` listing, not entered.**
- New isolated worktree created for this task: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-p2v-postgres-version-evidence`, branch `docs/f1-003-p2v-postgres-version-evidence`, created from `origin/main` at `ed568c9db3b0d62a049bc291d2137f5c913a7ac7`. No other worktree was opened, modified, reset, cleaned, or stashed by this task.

## 3. Authoritative sources reviewed

- `AGENTS.md` — no PostgreSQL version reference found (`grep -i "postgres"` → 0 matches).
- `docs/program/NORAMEDI_MASTER_TRACKER.md` — at the time of this read, prose text described F1-003-P2 as `not started`; no PostgreSQL version claim. **Corrected by F1-003-P2V-R1 (§15 below, same PR #259): the isolated F1-003-P2 worktree observed by §2 above already contains pre-existing, uncommitted/unverified implementation work — the correct status is `AGENT_WORK_IN_PROGRESS`, not `NOT_STARTED`.**
- `docs/program/CURRENT_PHASE.md` — full F1-003 lineage read (F1-003-P1/B1/R1/R1A/R1B entries); no PostgreSQL version claim beyond the provisional `postgres:16-alpine` choice already recorded by F1-003-P2A.
- `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md` — at the time of this read, prose text described F1-003-P2 as not started, not blocked on any further merge, not yet authorized to begin. **Corrected by F1-003-P2V-R1 (§15 below): status is `AGENT_WORK_IN_PROGRESS`** — see that section.
- `docs/program/RISK_REGISTER.md` — R-070 row (line 142) read directly: status `OPEN`. R-046 row (line 116) read directly: status `OPEN`. Neither row makes a production PostgreSQL major-version claim; R-046's own narrative mentions disposable-rehearsal Postgres versions (`16.14`, `postgres:16-alpine`) used to *rehearse* the KVKK-HIGH-007/008 migrations, not a production-inventory statement in its own right — it itself cites `PRODUCTION_TOPOLOGY.md` as the source of the production figure it matches against.
- `docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` (§13/§G, §22 item 1) and `docs/program/evidence/F1-003-P2A_disposable_runtime_contract.json` (`postgresVersionEvidence`) — both explicitly state "no authoritative repository/deployment inventory recording production PostgreSQL's major version was found," recording `postgres:16-alpine` as provisional with no parity claim. **This task finds this statement to be an incomplete search, not a false one** — see §7.
- `docs/program/PRODUCTION_TOPOLOGY.md` — §1 (topology diagram, line 51) and §6 (PostgreSQL table) — the program's own synthesized, evidence-cited production reference document. States `PostgreSQL 16.14 — database noramedi_crm (16 MB)`, citing F0-002 Stage B as its underlying evidence.
- `docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md` — the primary production evidence record (§B.3 line 54, §B.7 line 108) — see §5 below.
- `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` — §1 and §6 — independent reconciliation of a second, task-supplied production evidence snapshot against F0-002 Stage B; the PostgreSQL version field is one of the fields explicitly cross-checked and found consistent.
- `docs/program/evidence/KVKK-HIGH-008-PMVR_POST_MERGE_READINESS_EVIDENCE.md` (§5, line 43) and `docs/program/evidence/R046_PRODUCTION_VERIFICATION.md` (§3, line 46) — two independent, later evidence tasks that each deliberately provisioned a disposable PostgreSQL container specifically to match the production version already recorded in `PRODUCTION_TOPOLOGY.md`, and record that citation explicitly.
- `server/prisma/schema.prisma` — `datasource db { provider = "postgresql" }` — engine-agnostic, no version pin (`grep -n "datasource\|provider"`).
- `server/.env.example` — `DATABASE_URL="postgresql://crm_user:change-me@localhost:5432/noramedi_crm?schema=public"` — no version string, no secret value present or read.
- `.github/workflows/` — only `windows-bridge-pr.yml` and `windows-bridge-release.yml` exist; neither references PostgreSQL.
- Repository-wide check for `Dockerfile*`/`docker-compose*`/`compose*.yml` — none exist anywhere in the repository (confirmed independently by this task; consistent with every prior F0/F1 evidence pass that made the same finding).

## 4. CodeGraph commands and findings

- `ToolSearch(query="CodeGraph code graph analysis", max_results=5)` → zero matching deferred tools found.
- This is the **sixth independent confirmation** of CodeGraph's unavailability in this program, after F1-001, F1-002-P1, F1-002-P2, the original F1-003-P2A design, and F1-003-P2A's own F1-003-R1 reconciliation pass.
- Fallback used, scoped exactly to the task brief's target-path list: `Grep` for PostgreSQL version strings across `docs/program/**`, `server/.env.example`, `server/prisma/schema.prisma`; `Bash`/`Glob`-equivalent existence checks for `docker-compose*`, `Dockerfile*`, `deployment/`, `deploy/`, `infra/`, `infrastructure/`, `ops/`, `scripts/deploy/`; `Read` of `.github/workflows/` directory listing. No repository-wide, unscoped scan was performed.

## 5. PostgreSQL version references found

| # | Path | Line/section | Exact reference | Environment | Evidence date | Still active? | Authority level |
|---|---|---|---|---|---|---|---|
| 1 | `docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md` | §B.3, line 54 | `PostgreSQL \| 16.14 \| ... \| VERIFIED_PRODUCTION_OBSERVED` | Production (`disklinik-prod-01`) | `2026-07-19T13:43:12+03:00` | Yes — most recent production evidence collection this program has recorded for this field; no later, contradicting production read exists | `PRODUCTION_AUTHORITATIVE` |
| 2 | `docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md` | §B.7, line 108 | `PostgreSQL version \| 16.14 (same as §B.3) \| VERIFIED_PRODUCTION_OBSERVED` | Production | same session, `2026-07-19T13:43:12+03:00` | Yes | `PRODUCTION_AUTHORITATIVE` (same evidence session as #1, not an independent second observation — restated within one document) |
| 3 | `docs/program/PRODUCTION_TOPOLOGY.md` | §1 topology diagram, line 51; §6 PostgreSQL table | `PostgreSQL 16.14 — database noramedi_crm (16 MB)` | Production | Synthesized reference, cites F0-002 Stage B (`2026-07-19T13:43:12+03:00`) as its own underlying evidence | Yes — this file is explicitly the program's own "confirmed production architecture" reference | `PRODUCTION_AUTHORITATIVE` (derivative citation of #1/#2, not an independent measurement) |
| 4 | `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` | §1 (reconciliation), §6 (PostgreSQL table) | "same runtime versions (... PostgreSQL `16.14` ...)" — a second, task-supplied production evidence snapshot, cross-checked field-by-field against F0-002 Stage B and found consistent, "no field contradicts Stage B" | Production | Same calendar date as F0-002 Stage B, reconciled as a corroborating re-confirmation, not treated as an independent second timestamp | Yes | `PRODUCTION_AUTHORITATIVE` (independent corroborating observation, same underlying production state) |
| 5 | `docs/program/evidence/KVKK-HIGH-008-PMVR_POST_MERGE_READINESS_EVIDENCE.md` | §5, line 43 | "PostgreSQL version: **16.14** (matches the production topology evidence in `docs/program/PRODUCTION_TOPOLOGY.md`...). All three scenarios ran in disposable Docker containers (`postgres:16.14` official image)..." | Disposable rehearsal, deliberately version-matched to production | 2026-07-20 (task date) | Historical — describes a since-completed disposable rehearsal, not a live system | `TEST_ONLY` (deliberately matched to #1-#4; corroborates by citation, is not itself a new production observation) |
| 6 | `docs/program/evidence/R046_PRODUCTION_VERIFICATION.md` | §3, line 46 | "disposable Docker Postgres container created for this task only (... image `postgres:16-alpine`, resolved version `PostgreSQL 16.14` — matches production's documented version per `PRODUCTION_TOPOLOGY.md`...)" | Disposable rehearsal, deliberately version-matched to production | 2026-07-28 (task date) | Historical | `TEST_ONLY` (corroborates by citation; also incidentally shows `postgres:16-alpine` resolved to exactly `16.14` at pull time on that date — not a guaranteed future pin, see §6) |
| 7 | `docs/program/evidence/F0-011-P2_KVKK_HIGH007_HIGH008_ROLLBACK_TENANT_VERIFICATION.md` | line 33 | `Image: postgres:16-alpine` | Disposable rehearsal | 2026-07-20 | Historical | `TEST_ONLY` |
| 8 | `docs/program/evidence/DATA-INTEGRITY-001-R2_INDEPENDENT_VERIFICATION.md` | lines 250, 284, 326 | `postgres:16-alpine` (two ephemeral containers) | Disposable rehearsal | 2026-07-23 (task date) | Historical | `TEST_ONLY` |
| 9 | `docs/program/evidence/KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md` | line 53 | `Image \| postgres:16-alpine` | Disposable rehearsal | 2026-07-21 (task date) | Historical | `TEST_ONLY` |
| 10 | `docs/program/evidence/F1-002-P2_test_runtime_requirements.json` / `F1-002-P2_disposable_environment_capabilities.json` | multiple | `postgres:16-alpine`, "ad hoc docker run postgres:16-alpine + npx prisma migrate deploy, repeated per task, never committed to the repository as a script or Compose file" | Disposable rehearsal (pattern description, not a single instance) | 2026-07-27/28 (F1-002-P2 task date) | Historical/descriptive | `TEST_ONLY` |
| 11 | `server/prisma/schema.prisma` | `datasource db` block | `provider = "postgresql"` | N/A — engine-agnostic | N/A | Yes, current | `THIRD_PARTY_TOOLING` (Prisma provider identifier, not a version) — explicitly **not** usable to infer a version, per the task's own decision rules |
| 12 | `server/.env.example` | `DATABASE_URL` line | `postgresql://crm_user:change-me@localhost:5432/noramedi_crm?schema=public` | Example only | N/A | Yes, current | `EXAMPLE_ONLY` — no version string present |
| 13 | `docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` | §13/§G, §22 item 1 | `postgres:16-alpine` recorded as the **provisional** disposable-test-runtime choice, "no authoritative repository/deployment evidence exists" for production parity | Disposable test-runtime design decision | 2026-07-28 (F1-003-R1 reconciliation date) | Current (this is F1-003-P2's actual contract) | `TEST_ONLY` (the design decision itself); the document's own "no authoritative evidence" *finding* is superseded by this task's own search — see §7 |

No `postgres:14`, `postgres:15`, `postgres:17`, or unversioned `postgres`/`postgres:latest` image reference was found anywhere in the repository. No Docker Compose or Dockerfile exists in this repository at all — the only PostgreSQL image references found are inside evidence-document prose (ad hoc `docker run` commands recorded for reproducibility), not committed infrastructure-as-code.

## 6. Production topology conclusion

Per `PRODUCTION_TOPOLOGY.md` and `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` §6 (both already-accepted program evidence, unchanged by this task): production PostgreSQL is **not containerized** — it runs as an OS-level service on the same bare VPS (`disklinik-prod-01`) as the application processes, not provisioned by any repository script (assumed pre-installed), with no committed Compose/Dockerfile anywhere describing it. This is a single-environment topology: no repository evidence of a separate staging PostgreSQL instance was found, and no evidence of multiple environments with different PostgreSQL versions exists. `docs/35-docker-deploy-runbook.md` describes a Docker Compose topology that has never run in production (confirmed stale/aspirational by F0-006 §3, unchanged by this task, not re-verified here).

## 7. Production PostgreSQL major-version conclusion — CASE A

**Production PostgreSQL major version: 16.**

- Evidence source: `docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md` §B.3 (line 54) and §B.7 (line 108), classification `VERIFIED_PRODUCTION_OBSERVED` — read-only commands executed directly against the production VPS by the user, per this program's own evidence-classification legend (`docs/program/evidence/README.md`).
- Evidence date: `2026-07-19T13:43:12+03:00`.
- Exact patch/minor version: **known** — `16.14`.
- Independent corroboration: `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` §1 reconciled a second, task-supplied production evidence snapshot against F0-002 Stage B and found the PostgreSQL version field (along with every other runtime-version field) consistent, "no field contradicts Stage B." `PRODUCTION_TOPOLOGY.md` — the program's own synthesized production reference — restates the same figure. Two later, independent evidence tasks (`KVKK-HIGH-008-PMVR`, `R046_PRODUCTION_VERIFICATION`) each deliberately provisioned a disposable PostgreSQL instance specifically to match this recorded production version, each explicitly citing `PRODUCTION_TOPOLOGY.md` as their source — a total of five documents across three separate task lineages (F0-002, F0-006, and two later independent verification tasks) either directly observe or explicitly rely on the same `16.14` figure, with zero contradicting production observation found anywhere in the repository.
- Does P2's disposable image major match? **Yes, at the major-version level.** F1-003-P2A's provisional choice, `postgres:16-alpine`, is major-version `16` — the same major version as the `16.14` production observation.
- **Correction of a stale claim (in scope per this task's "correction of objectively stale PostgreSQL-version claims" allowance):** `F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` §13/§G and its companion JSON's `postgresVersionEvidence.authoritativeProductionMajorVersionFound` both state no authoritative repository/deployment evidence for production's PostgreSQL major version exists. That search was scoped to "`docs/program/` evidence and tracker files (grep for postgres version strings)," `server/.env.example`, `schema.prisma`'s datasource block, and "deployment-related evidence documents cited by `RISK_REGISTER.md`'s R-046/R-070 rows" — it did not directly open `F0-002_PRODUCTION_BASELINE_EVIDENCE.md`, `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`, or `PRODUCTION_TOPOLOGY.md` themselves (R-046/R-070's own rows reference `PRODUCTION_TOPOLOGY.md` and F0-011-P2's evidence, not F0-002/F0-006 by direct citation in the row text, so a citation-chain-only search would miss them). This task does **not** modify `F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` or its JSON companion — both are explicitly out of this task's scope (P2A/R1/R1A/R1B evidence artifacts, a separate task lineage). This document records the correction independently; a future task in that lineage (or F1-003-P2 itself) may choose to update those files' own text.

## 8. Exact-version conclusion

Production's exact observed version is `16.14`, as of the `2026-07-19T13:43:12+03:00` evidence session — the most recent production PostgreSQL-version read this program has on record. No production PostgreSQL read has occurred since that date (this task performed none; no later evidence document records a different reading). This is therefore the best-available exact-version figure, not a guarantee that production remains at exactly `16.14` as of today (`2026-07-29`) — PostgreSQL patch releases can apply via routine OS package updates the application-level evidence collected here would not detect. This is recorded as a **point-in-time observation**, consistent with `F0-002_PRODUCTION_BASELINE_EVIDENCE.md`'s own stated evidence model (`docs/program/evidence/README.md`: `VERIFIED_PRODUCTION_OBSERVED` = "point-in-time," not an ongoing-correctness certification).

## 9. Provisional P2 image decision

Per the task brief's Case A path, `postgres:16-alpine` **may be retained** as F1-003-P2's disposable test-runtime image — it already matches production's major version (16). This task does not instruct F1-003-P2 to change its image choice; F1-003-P2A's §14 MinIO-adjacent policy (exact digest/tag pinning required for CI, `latest` prohibited) already governs image-pinning rigor for that separate concern, and this task does not modify it.

**Optional, non-mandatory observation for F1-003-P2's own implementation-time decision (not an instruction, not a requirement imposed by this task):** if exact minor/patch parity with production is ever desired (e.g. for behavior that differs across `16.x` patch releases), `postgres:16.14-alpine` or `postgres:16.14` would achieve that; `postgres:16-alpine` alone floats to whatever the latest `16.x` patch is at pull time (as R046_PRODUCTION_VERIFICATION.md's own incidental observation shows — it happened to resolve to `16.14` on `2026-07-28`, matching production, but this is not a guaranteed pin for future pulls). This task does not require this change; F1-003-P2's own acceptance criteria (§L of the P2A design) do not name exact-minor parity as a requirement.

## 10. Parity status

**Major-version parity: established (16 = 16).** **Exact-version parity: not guaranteed by image tag** — `postgres:16-alpine` is a floating major-version tag, not pinned to `16.14`. Parity is therefore **major-only**, not exact, unless F1-003-P2 chooses to pin an exact tag (§9, optional). No claim of exact production parity is made or should be inferred from this document alone.

## 11. Conflicts or ambiguities

**None found.** Every PostgreSQL version reference located in the repository is internally consistent: all production-environment references state `16.14` (five documents, three task lineages, zero contradictions); all disposable/test-environment references use `postgres:16-alpine` or an explicit `postgres:16.14` pin (deliberately version-matched to the same production figure); no `postgres:14`/`15`/`17` or conflicting production claim exists anywhere. This task is **not** `BLOCKED_BY_CONFLICTING_INFRASTRUCTURE_EVIDENCE` — Case A applies cleanly.

## 12. Security / tenant-isolation / KVKK impact

- Security: none. No application authorization/authentication code path touched; no new production access performed; no credential read, referenced, or exposed anywhere in this document.
- Tenant isolation: none. No fixture, scoping, or authorization logic touched.
- KVKK/privacy: none. No patient data referenced; the `16.14` figure and `noramedi_crm` database name are already-published, non-secret operational facts (already present in five pre-existing, accepted evidence documents this task only reads and cites).
- R-070: **remains `OPEN`**, verified by direct read of `RISK_REGISTER.md` line 142 (unchanged by this task).
- R-046: **remains `OPEN`**, verified by direct read of `RISK_REGISTER.md` line 116 (unchanged by this task).

## 13. Explicit non-claims

This task does **not** claim: F1 is complete; F1-003 is complete; the disposable runtime is ready; CI is ready; production is newly verified (the `16.14` figure is cited from a pre-existing, already-accepted `2026-07-19` evidence session, not re-collected by this task); PostgreSQL exact-patch parity is established (only major-version parity is); R-070 is closed; R-046 is closed; G1/G2 approval status has changed; the KVKK baseline is stable; F1-003-P2 (disposable runtime implementation) has started or is authorized to start by this task; this task reached any status beyond `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.

## 14. Files touched by this delivery

Created: this document, and its machine-readable companion `F1-003-P2V_postgresql_version_evidence.json`. Minimally updated (allowed list only): `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`, `docs/program/evidence/README.md`. No application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, Docker/Compose file, Nginx file, environment file, or runtime configuration was created or modified. No P2 implementation file, runtime script, package script, test file, or P2 evidence artifact was touched. No production system was changed or accessed by this task — every production fact cited here traces to pre-existing, already-accepted evidence (`F0-002_PRODUCTION_BASELINE_EVIDENCE.md` Stage B, `2026-07-19`).

## 15. R1 correction — active P2 status reconciliation (F1-003-P2V-R1, 2026-07-29)

**Contradiction found:** §2 above directly observed, via `git worktree list`, that the isolated F1-003-P2 worktree (`f1-003-p2-disposable-runtime`) already exists and contains pre-existing, uncommitted/unverified implementation work under `scripts/test-runtime/`. Despite that, other text this task originally wrote — in this document's §3, in `docs/program/NORAMEDI_MASTER_TRACKER.md` item 18, in `docs/program/CURRENT_PHASE.md`, and in `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`'s F1-003-P2V subsection — described F1-003-P2 simply as "not started." Those two statements are in tension: a worktree containing uncommitted implementation files is evidence of started, in-progress agent work, not of no work.

**Method:** This correction used only the worktree-listing-level observation already recorded by F1-003-P2V itself (§2). The F1-003-P2 worktree was **not** inspected, read, diffed, modified, staged, cleaned, or stashed by this reconciliation — no new entry into that worktree occurred, consistent with this task's own isolation boundary.

**Canonical corrected status: F1-003-P2 — `AGENT_WORK_IN_PROGRESS`**, with qualifiers: isolated worktree exists; uncommitted/unverified implementation work observed (worktree-listing level only); no F1-003-P2 delivery report received; no F1-003-P2 runtime verification reviewed; no F1-003-P2 commit evidence available to this task; F1-003-P2's own PR not opened; not merged; not deployed; not production-verified. F1-003-P3 remains blocked until F1-003-P2 is delivered, reviewed, and merged.

**Strict status separation (honored):** agent work started: yes. Implementation delivered: no. Implementation validated: no. Tests passed: no evidence yet. Commit created: no evidence from this task. PR opened: no. Merged: no. Deployed: no. Production verified: no.

**PostgreSQL conclusion unchanged:** production major version `16`, exact `16.14`, F1-003-P2's provisional `postgres:16-alpine` remains major-only parity. This correction performs no new production verification.

**Files touched by this correction:** this document (§3, this §15); `docs/program/evidence/F1-003-P2V_postgresql_version_evidence.json` (new `p2StatusCorrection` field); `docs/program/NORAMEDI_MASTER_TRACKER.md` (new item); `docs/program/CURRENT_PHASE.md` (new dated entry); `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md` (corrected row + new `F1-003-P2V-R1` subsection + change-history row); PR #259 description. **Not touched:** the F1-003-P2 worktree or branch, `scripts/test-runtime/**`, `server/package.json`, any test file, any application/schema/migration/Docker/Compose/CI-workflow/deployment file, `RISK_REGISTER.md`.

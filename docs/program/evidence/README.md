# Evidence Directory — F0 Baseline and Validation

This directory holds task-scoped, reproducible evidence reports produced during Phase F0. Evidence files are **not** the authoritative live-status source — that remains [`NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md) per its source hierarchy (§2.1). Evidence files back the claims made in the tracker with reproducible locators (repository path, function/constant/script name, line range where practical) and an explicit evidence classification.

## Evidence classifications

| Classification | Meaning |
|---|---|
| `VERIFIED_GIT` | Confirmed directly from local Git metadata (SHA, branch, ancestry, worktree state) |
| `VERIFIED_GITHUB` | Confirmed via authenticated GitHub CLI/API against github.com (PR state, merge commit, branch protection) |
| `VERIFIED_REPOSITORY` | Confirmed by direct inspection of tracked repository files (source, config, scripts, manifests) |
| `OBSERVED_LOCAL_ONLY` | Observed in the local working environment but not confirmed against any external system of record |
| `UNVERIFIED_PRODUCTION` | A production-environment fact that has not been checked against the live VPS; repository evidence may exist but does not by itself prove production reality |
| `VERIFIED_PRODUCTION_OBSERVED` | Confirmed by read-only commands run directly on the production VPS by the user (F0-002 Stage B or later). An observed operational fact, point-in-time — not a `PRODUCTION_VERIFIED` task-status/release-gate claim (see [`NORAMEDI_MASTER_TRACKER.md` §2.2](../NORAMEDI_MASTER_TRACKER.md)) |
| `CONFLICTING_EVIDENCE` | Two or more repository/documentation sources disagree; both are cited, neither is assumed correct |
| `NOT_APPLICABLE` | The row/field does not apply to the current repository state (e.g. a capability that doesn't exist) |

These are evidence-quality labels, not task status values. Task status values (`TODO`, `READY`, `IN_PROGRESS`, `AGENT_COMPLETED`, `REVIEW_REQUIRED`, `MERGED`, etc.) are defined in [`NORAMEDI_MASTER_TRACKER.md` §2.2](../NORAMEDI_MASTER_TRACKER.md) and are never conflated with evidence classifications in these files.

## Files in this directory

| File | Task | Purpose |
|---|---|---|
| [F0-002_REPOSITORY_BASELINE.md](F0-002_REPOSITORY_BASELINE.md) | F0-002 Stage A | Factual, reproducible repository/deployment-capability inventory as of the F0-002 worktree HEAD. §6.9 has been reconciled with Stage B; a few rows remain `UNVERIFIED_PRODUCTION`/`UNVERIFIED` where no evidence was supplied. |
| [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) | F0-002 Stage B (input) | Copy-pasteable, read-only command set for the user to run on the production VPS. Reusable runbook — kept for future re-verification (e.g. F0-006). |
| [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) | F0-002 Stage B (output) | Sanitized summary of the production/VPS evidence supplied 2026-07-19T13:43:12+03:00 in response to the evidence request above: host, runtime, PM2 topology, health, TLS, database/migrations, configuration presence, storage, backup/PITR/restore-test status, accepted findings, and risks. |
| [F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) | F0-006 | Source-level process/deployment/config/storage/backup/security tracing (entrypoints, job scheduling, graceful shutdown, storage/backup client code), reconciliation of a second task-supplied production evidence snapshot against F0-002 Stage B, and the required drift/contradiction table. Does not duplicate F0-002's evidence — cites it by section. |
| [F0-006_configuration_inventory.json](F0-006_configuration_inventory.json) | F0-006 | Structured machine-readable inventory: topology, configuration sources/variables, deployment steps, drift findings, risks, unverified fields. |

## Stage model for F0-002

- **Stage A**: repository-only evidence collection (2026-07-18). No production access. Production-dependent rows were recorded as `UNVERIFIED_PRODUCTION`, never guessed or inferred from repository capability.
- **Stage B**: the user ran `F0-002_PRODUCTION_EVIDENCE_REQUEST.md` against the production VPS (read-only, 2026-07-19) and supplied the output; it is documented in `F0-002_PRODUCTION_BASELINE_EVIDENCE.md` and reconciled against `F0-002_REPOSITORY_BASELINE.md` §6.9. **Both stages are now complete.** F0-002's overall task status is `AGENT_COMPLETED` pending a pull request (see the tracker) — this is an inventory/documentation outcome, not a `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` claim, and several risks (storage locality, PITR, restore-test verification, offsite backup) remain open and unremediated by design.

Repository capability (e.g. "the code supports S3-compatible storage") is never treated as proof of production configuration (e.g. "production uses S3"). The two are kept in separate columns everywhere in these evidence files.

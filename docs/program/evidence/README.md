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
| `CONFLICTING_EVIDENCE` | Two or more repository/documentation sources disagree; both are cited, neither is assumed correct |
| `NOT_APPLICABLE` | The row/field does not apply to the current repository state (e.g. a capability that doesn't exist) |

These are evidence-quality labels, not task status values. Task status values (`TODO`, `READY`, `IN_PROGRESS`, `AGENT_COMPLETED`, `REVIEW_REQUIRED`, `MERGED`, etc.) are defined in [`NORAMEDI_MASTER_TRACKER.md` §2.2](../NORAMEDI_MASTER_TRACKER.md) and are never conflated with evidence classifications in these files.

## Files in this directory

| File | Task | Purpose |
|---|---|---|
| [F0-002_REPOSITORY_BASELINE.md](F0-002_REPOSITORY_BASELINE.md) | F0-002 Stage A | Factual, reproducible repository/deployment-capability inventory as of the F0-002 worktree HEAD. Production facts are marked `UNVERIFIED_PRODUCTION` pending Stage B. |
| [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) | F0-002 Stage B (input) | Copy-pasteable, read-only command set for the user to run on the production VPS. Output feeds Stage B verification; it does not itself constitute Stage B completion. |

## Stage model for F0-002

- **Stage A** (this delivery): repository-only evidence collection. No production access. Production-dependent rows are recorded as `UNVERIFIED_PRODUCTION`, never guessed or inferred from repository capability.
- **Stage B** (later, external): the user runs `F0-002_PRODUCTION_EVIDENCE_REQUEST.md` against the production VPS (read-only) and returns the output. A follow-up agent turn reconciles that output against `F0-002_REPOSITORY_BASELINE.md`, resolves the `UNVERIFIED_PRODUCTION` rows, and only then can F0-002 as a whole move past `IN_PROGRESS`.

Repository capability (e.g. "the code supports S3-compatible storage") is never treated as proof of production configuration (e.g. "production uses S3"). The two are kept in separate columns everywhere in these evidence files.

# F1-003-B2-R1 — Admission-Point Lock Closure, Current-Main Reconciliation, Remote CI Verification, and Evidence Sanitization

| Field | Value |
|---|---|
| Task ID | F1-003-B2-R1 |
| Phase | F1 — CI and Test Architecture |
| Parent task | F1-003-B2 — Retention Manual/Scheduled Run Mutual-Exclusion Race |
| Continues | Existing branch `fix/f1-003-b2-retention-run-lock-race`, existing PR [#280](https://github.com/MustafaBasol/DisKlinikCRM/pull/280) — no new branch, no new PR |
| Maximum status | `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW` — not merged, not deployed, not production-verified |

## Status-language legend (used throughout this document)

- **CODE_PATH_CONFIRMED** — verified by direct source-code read and/or `tsc` typecheck; the code genuinely does what is claimed.
- **TEST_REPRODUCED** — verified by actually running a test locally against real PostgreSQL and observing the result.
- **REMOTE_CI_VERIFIED** — a GitHub Actions workflow run on this PR's branch actually executed and passed. Not claimed unless a real run with that outcome exists.
- **PRODUCTION_VERIFIED** — not claimed anywhere in this document. No production access occurred.

## 1. Current-main reconciliation

- Pre-merge `HEAD`: `5811d39ecaecdd93d00c9156a3cb6a929956b5b5` (F1-003-B2's own commit, branch `fix/f1-003-b2-retention-run-lock-race`).
- `origin/main` at fetch time: `e8e05f669f049c4895e0c9a7f95db6f3fbd463fe` (PR #277 merge commit).
- `git merge-base --is-ancestor origin/main HEAD` before reconciliation: **false** (branch was behind main by PR #276 and #277).
- Confirmed both named merge commits are genuine ancestors of `origin/main` before merging: `git merge-base --is-ancestor 0de9a04a8c7b4fefe5e7f525f9cab031b55fcb83 origin/main` → exit `0`; `git merge-base --is-ancestor e8e05f669f049c4895e0c9a7f95db6f3fbd463fe origin/main` → exit `0`.
- `git merge --no-ff origin/main` — **zero conflicts**, clean automatic merge. Only new files were introduced (all additive, no shared-file overlap with this branch's own changes):
  - `docs/program/evidence/F2-PREP-001_DOMAIN_OWNERSHIP_AND_BOUNDARY_INVENTORY.md` (new)
  - `docs/program/evidence/F2-PREP-001_domain_ownership_inventory.json` (new)
  - `docs/program/evidence/F2-PREP-003_FEATURE_INTAKE_AND_CLICKUP_DOMAIN_MAPPING.md` (new)
  - `docs/program/evidence/F2-PREP-003_feature_intake_domain_mapping.json` (new)
- No `--ours`/`--theirs`, no rebase, no force-push, no reset — a plain `--no-ff` merge commit.
- Merge commit: `2fc2d9b1985a33125d14251bca6077c149f589c4`.
- Post-merge `git merge-base --is-ancestor origin/main HEAD` → **true**. `origin/main` is confirmed an ancestor of `HEAD`.
- **Evidence classification: `CODE_PATH_CONFIRMED`** (direct `git` command output, reproduced above verbatim).
- No schema/migration changes were introduced by this merge (`git diff` between the pre- and post-merge trees on `server/prisma/schema.prisma` and `server/prisma/migrations/` is empty) — F2-PREP-001/003 are documentation-only.

## 2. Residual race root cause (why F1-003-B2 alone was not sufficient)

F1-003-B2's own evidence (`F1-003-B2_RETENTION_RUN_MUTUAL_EXCLUSION_RACE.md` §9) explicitly recorded, as an accepted-but-unsolved residual limitation: the live-run route still called `getPlatformSetting` (the runtime/policy read) *before* `acquireJobLock`. Moving the lock ahead of the "started" audit write (F1-003-B2's fix) closed the *larger* part of the original race, but this one remaining DB round trip — performed independently by both concurrent racers, with its own connection-pool/network-latency variance — was still capable, in principle, of staggering two genuinely-simultaneous requests enough that the first request's entire admission→cleanup→release cycle could complete before the second request ever attempted admission.

**CODE_PATH_CONFIRMED**, by direct read of the pre-R1 route body (`server/src/routes/platformAdmin.ts`, live-run branch): the call order was `getPlatformSetting(...)` → `buildPolicyResponse(...)` → `acquireJobLock(...)`.

## 3. Final admission-lock ordering (this task's fix)

Extracted the entire route body into an exported factory, `createDataRetentionRunHandler(overrides?)`, so the real `getPlatformSetting` dependency can be substituted only in tests (production always uses the default). New required order for a live attempt:

1. **Acquire the shared `data-retention-cleanup` lock** — now the very first variable-latency DB operation of a live attempt, before any policy/runtime-toggle read.
2. **If the lock is unavailable:** read policy (needed only to build accurate audit metadata — this can no longer affect who holds the lock, since admission already happened in step 1), write the `started` + `blocked`/`concurrent_run_in_progress` audit pair, return `409`. No cleanup is ever invoked.
3. **If the lock is acquired:** read policy, then evaluate the runtime/environment gate while still holding the lock.
4. **If the policy gate rejects:** release the lock immediately; write the single terminal-only `blocked` row (no `started` precursor) exactly as before this fix — the pre-existing policy-block response/audit shape is unchanged; return `403`.
5. **If policy lookup itself throws** (after the lock was acquired, or while contended): release the lock if held; no audit row is written (no valid policy values exist to build one — consistent with the established "never fabricate audit metadata" discipline); return a sanitized `500`.
6. **Genuine attempt:** write the `started` row. If this write fails, release the lock and return a sanitized `500` — the destructive run is refused and the lock is never orphaned for its full TTL just because this write failed.
7. **Run cleanup**, wrapped in `try { ... } finally { releaseJobLock(...) }` — released on success, on a thrown error, and on any other exit.
8. **Record the terminal outcome** (success/partial_failure/error) sharing the `started` row's `runId`.
9. **The lock is released on every code path** — contention rejection (never acquired, nothing to release), policy-gate rejection (released in step 4), started-write failure (released in step 6), and cleanup success/throw (released in step 7's `finally`).

**CODE_PATH_CONFIRMED** by direct read of `server/src/routes/platformAdmin.ts`'s `createDataRetentionRunHandler`. **TEST_REPRODUCED** — see §7.

Scheduled-cron locking (`dataRetentionCleanupJob.ts` → `withJobLock`), the lock key (`'data-retention-cleanup'`), and the TTL (2 hours) are all unchanged. No new locking subsystem, no Redis/BullMQ/Kafka, no process-local mutex, no sleep.

## 4. Deterministic concurrency test design

The primary regression proof is **not** a repeated `Promise.all` timing-luck loop (that remains supplementary — see §7) but a genuinely deterministic test:

`retentionManualRunAudit.test.ts` → *"deterministic admission proof: two concurrent live requests, BOTH deliberately parked mid-policy-lookup via a controllable barrier (no sleep) ..."*

Mechanism: a `getPlatformSetting` override is injected via `createDataRetentionRunHandler({ getPlatformSetting: barrieredGetPlatformSetting })`. `barrieredGetPlatformSetting` immediately signals (resolves a per-call `Deferred`) the instant it is entered — proving the calling racer has already completed admission (`acquireJobLock`) and reached the post-admission policy step — then blocks on its own `Deferred` promise (never a timer) until the test explicitly releases it. The test:

1. Fires both racers concurrently (`Promise.all`, no `await` between dispatch).
2. Awaits both "reached policy step" signals — at this point **both** racers have already completed their own `acquireJobLock` call, deterministically, with zero dependency on real-time scheduling.
3. Queries the `JobLock` row directly and asserts exactly one row is held (`lockedUntil` in the future) — proving admission was already fully decided, *before either policy lookup has been allowed to resolve at all*.
4. Releases both barriers (order irrelevant — admission cannot change at this point) and awaits both request promises.
5. Asserts the final result is exactly `[200, 409]`, that the seeded row was deleted exactly once, and that both racers still wrote their own `started` row.

This proves the property required by the task: outcome is decided by admission ordering, not by relative policy-lookup latency, **regardless of how long that latency is** — not merely "usually" true under favorable timing.

## 5. Failure-branch tests and counts

All new tests are in `server/src/tests/retentionManualRunAudit.test.ts`, run against real PostgreSQL (no mocked Prisma):

| # | Test | Type |
|---|---|---|
| 1 | Deterministic admission proof (barrier-based, §4) | New |
| 2 | Policy disabled after live lock acquisition: `403`, no cleanup, lock immediately reusable | New |
| 3 | Policy lookup throws after lock acquisition: no cleanup, lock released, sanitized `500`, no fabricated audit row | New |
| 4 | `releaseJobLock()` never rejects even when the underlying DB update genuinely fails (table renamed out from under it); documents and tests the chosen trade-off: a completed cleanup's success is never retroactively reported as a failure, and the lock is honestly left held (not silently cleared) until its own TTL expires | New |

Two failure branches required by the task were already covered by F1-003-B2's own test suite and are unaffected by this reordering (verified still passing, not re-derived): "started audit write fails → lock released immediately" and "cleanup throws → terminal audit remains correct, lock released" (the latter proven at the `acquireJobLock`/`releaseJobLock` primitive level, mirroring the route's exact `try/finally` shape, since `runDataRetentionCleanup` has no production-safe uncaught-throw injection point without restructuring its own internal per-category error handling — out of this task's scope).

**Test file totals: 25 → 29 assertions.** `TEST_REPRODUCED`: run 6 consecutive times against a real disposable PostgreSQL container this task provisioned — **29/29 every time**, zero failures.

## 6. Regression commands and exact results

| Command | Result |
|---|---|
| `npm run typecheck` (from `server/`) | Exit `0`, 0 errors |
| `npm run test:retention-manual-run-audit` (from `server/`) | `Toplam: 29 ✓ 29 ✗ 0` — run 6 consecutive times, 29/29 every time |
| `npm run test:data-retention` (from `server/`) | `Results: 42 passed, 0 failed` (unaffected — exercises the cleanup function via injected deps, not the route) |
| `npm run server:test:non-disposable` (from `server/`) | Exit `0`, 0 failure markers across the combined log |
| `npm run test:runtime:postgres` (from root) | Exit `0` — `server:test:disposable-db` exit `0`, `"cleanup": {"success": true, "errors": []}`, `"outcome": {"exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"]}` |
| `git diff --check` | Clean |
| `docker ps -a` / `docker network ls --filter label=com.noramedi.test-runtime=true` (after every disposable run) | Zero residual containers/networks (this task's own manually-provisioned repro container was removed at the end of local testing, confirmed empty) |

All: **TEST_REPRODUCED**. No schema/migration file was changed by this task.

## 7. Remote CI

- Pushed the code commit (`2b71750...`) to the existing branch `fix/f1-003-b2-retention-run-lock-race` — same branch, same PR #280, no new branch/PR created.
- `gh pr checks 280 --repo MustafaBasol/DisKlinikCRM` → **"no checks reported on the 'fix/f1-003-b2-retention-run-lock-race' branch."**
- `gh pr view 280 --json statusCheckRollup` → `{"statusCheckRollup": []}`.
- `gh run list --branch fix/f1-003-b2-retention-run-lock-race` → exactly one run, "Running Copilot Code Review" (an automated code-review bot, not a test/CI workflow), `completed`/`success`. **This is not a test-execution signal and is not counted as REMOTE_CI_VERIFIED.**
- **Diagnosis (why no test workflow triggered):** `origin/main` currently has exactly two workflow files — `.github/workflows/windows-bridge-pr.yml` (triggers on `pull_request` to `main`, but is `paths:`-filtered to `windows-bridge/**`, `server/src/services/imaging/**`, `server/src/routes/imaging*.ts`, `server/src/tests/imaging*.ts` — none of which this PR touches) and `.github/workflows/windows-bridge-release.yml` (`workflow_dispatch` only, never auto-triggers). The layered CI system that would actually exercise `test:retention-manual-run-audit` in CI (`.github/workflows/ci-layers.yml`, `ci-pr.yml`, `ci-main-and-nightly.yml`) **exists only on PR #268 (F1-003-P3), which is not yet merged to `main`.** This is a genuine, pre-existing structural gap in the current CI topology, not a defect introduced by this task, and not something this task is authorized or able to fix (F1-003-P3 is explicitly the task that installs that CI system, and it remains open/blocked pending its own external review).
- **Explicit non-claim:** `REMOTE_CI_VERIFIED` is **not** claimed anywhere in this document or the updated program tracker entries. All verification above is `TEST_REPRODUCED` (local, against real disposable PostgreSQL) or `CODE_PATH_CONFIRMED` (direct source read).
- PR #268 was not modified, not merged, not closed by this task — confirmed via `gh pr view 268` (`state: OPEN`, `headRefName: feature/f1-003-p3-layered-ci-workflows`, unchanged).

## 8. Migration status

**None.** No `schema.prisma` change, no new migration file, no `_prisma_migrations` change — by this task or by the `origin/main` reconciliation merge (§1). `CODE_PATH_CONFIRMED` via `git diff --stat` on this task's own commit and the merge commit.

## 9. Tenant/KVKK/security impact

- No tenant-scoped behavior change. The lock remains global/job-type-scoped (`'data-retention-cleanup'`), unchanged — still correct because a single live cleanup pass spans all tenants.
- Audit trail: every attempt (winner, lock-contention loser, policy-gate-rejected, policy-lookup-failed, started-write-failed) writes the exact audit shape the pre-existing, already-accepted contract requires for its category — no row is fabricated when the required inputs (accurate policy values) are unavailable (see §3 step 5).
- This task closes the last theoretical (never empirically observed, in either F1-003-B2's or this task's own testing) window in which two manual triggers could avoid genuine lock contention. It does not change what data is or is not eligible for cleanup, and does not change the destructive operation itself.
- Backward compatible: same route path, same response shapes/status codes, same audit action/outcome vocabulary.

## 10. Crash/TTL limitations (unchanged, not claimed as newly solved)

Identical to F1-003-B2's own §8: crash/connection-loss recovery relies on the pre-existing, unmodified 2-hour TTL lease-expiry mechanism. **Not independently re-verified by this task.** No claim of mathematical impossibility is made for process crashes, lease expiry, DB partitions, or TTL expiration — per instruction, only what was directly tested is claimed. The one new, explicitly-tested and explicitly-accepted trade-off this task adds: if `releaseJobLock`'s own underlying DB update genuinely fails, the function still never rejects (§5 test #4) — the lock is honestly left held until its TTL expires, and this is now logged (previously silent), not silently and incorrectly cleared.

## 11. Evidence sanitization

Searched all task-owned evidence/docs for author-machine absolute paths (`D:\`, `D:/`, `C:\`, `C:/`, `E:\`, `E:/`, `DisKlinikCRM-worktrees`, local usernames/home paths). Found and corrected exactly one occurrence: `F1-003-B2_RETENTION_RUN_MUTUAL_EXCLUSION_RACE.md`'s "Branch/worktree" field, which named the literal local worktree path — replaced with `fresh isolated worktree; local filesystem path intentionally omitted`, branch name and baseline SHA preserved. No occurrence was found in this task's own newly-authored files (this document, its JSON companion, or the tracker/phase/README entries below) — none was ever written with a local path in the first place. Pre-existing, unrelated historical evidence files elsewhere in `docs/program/evidence/` (dozens of documents from prior, unrelated task lineages) were left untouched — out of this task's scope (`F1-003-B2`/`F1-003-B2-R1` owns only its own evidence, not the entire program's historical corpus).

## 12. Rollback

Single `git revert` of this task's commit (`2b71750...`) fully restores F1-003-B2's own admission ordering (lock acquired before the "started" write, but after the policy read) — no data migration, no schema change, no lock-table cleanup required.

## 13. Status (unchanged by this task, explicitly reaffirmed)

- F1: `IN_PROGRESS`. F1-003: `IN_PROGRESS`. F1-003-P3 (PR #268): **open, blocked, not merged, not modified by this task.** F1-003-P4: blocked.
- R-070: `OPEN`, untouched. R-046: `OPEN`, untouched. R-071: unchanged.
- G1/G2: `NOT_APPROVED`.
- KVKK physical/architecture freeze: `ACTIVE`, untouched. KVKK baseline-stable declaration: **NOT GRANTED**, unaffected by this task.
- This task's own maximum status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`. **Not merged. Not deployed. Not production-verified. `REMOTE_CI_VERIFIED` not claimed (§7). External review required before merge.**

# F1-003-B2 — Retention Manual/Scheduled Run Mutual-Exclusion Race

| Field | Value |
|---|---|
| Task ID | F1-003-B2 |
| Phase | F1 — CI and Test Architecture |
| Parent task | F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness |
| Type | Blocking production-behavior defect, discovered by F1-003-P3's Layer 5 compatibility CI (PR #268, still `AGENT_COMPLETED`/`PR_OPENED_AWAITING_REVIEW`, **left open and unmodified by this task**) |
| Branch/worktree | `fix/f1-003-b2-retention-run-lock-race`, fresh isolated worktree; local filesystem path intentionally omitted — created fresh from `origin/main` — **not** the F1-003-P3 worktree, not PR #268 |
| Baseline | `origin/main` @ `70b1690c1a656c95cead7b42812cc9ae6447bfb7` (merge commit for PR #275, `feature/external-calendar-outbound-sync-phase2`), `git merge-base --is-ancestor` implicit — worktree created directly from `origin/main` with zero intervening commits |
| Maximum status | `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW` — not merged, not deployed, not production-verified |

## 1. Discovery lineage and authoritative failure evidence

- Real GitHub Actions failure, PR #268 (`feature/f1-003-p3-layered-ci-workflows`, head SHA `930cc70620c6431da9425df5d7ad3ee6971c156a`), run **30542271302**, job **`ci-layers / Layer 5: full-suite/compatibility fail-safe (backend, legacy server:test DB-required members)`** (`databaseId 90872034493`), step "Provision disposable PostgreSQL, run server:test:legacy-db-required, tear down" — `conclusion: failure`.
- Retrieved via `gh run view --job=90872034493 --log`. Exact failing assertion, from `server/src/tests/retentionManualRunAudit.test.ts`'s `"concurrent live runs..."` test:

  ```
  ✗ concurrent live runs: the shared job lock serializes execution — only one run actually deletes; both attempts get their own started+terminal audit pair, the loser terminal is manual_run_blocked/concurrent_run_in_progress
      exactly one concurrent live run must execute (200) and the other must be rejected as already-in-progress (409)
  + actual - expected
    [
      200,
  +   200
  -   409
    ]
  ```

  Test suite result for that run: `Toplam: 20  ✓ 19  ✗ 1`. The scheduled/manual lock-collision test immediately below it in the same run **passed** (`✓ scheduled/manual lock collision...`).
- Task brief states this reproduced twice remotely and did not reproduce on local Windows runs. This task independently reproduced that same asymmetry: the pre-fix code, run against a real disposable PostgreSQL container on this Windows/Docker-Desktop machine, passed **9/9 consecutive full-suite runs** (20/20 assertions each) — consistent with a narrow, timing-dependent race that is easier to trigger under GitHub Actions' runner characteristics than a quiet local Docker Desktop instance.

## 2. Root-cause investigation (proved before any fix was written)

Per instruction, the test was not "fixed" before the application behavior was proved. Investigation order:

1. **`server/src/utils/jobLock.ts` (`acquireJobLock`/`releaseJobLock`/`withJobLock`)** — the shared lease-lock primitive used by both the manual route and the scheduled cron (`DATA_RETENTION_JOB_LOCK_NAME = 'data-retention-cleanup'`, identical lock key both paths, confirmed by direct read). `JobLock.name` is the Prisma `@id` (primary key) — confirmed in `server/prisma/migrations/20260706150000_add_job_lock/migration.sql` (`CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")`), not merely descriptive in `schema.prisma`.
2. **Empirical stress-test of the primitive itself**, against a real disposable PostgreSQL container (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, the same digest-pinned image F1-003-P2 uses), using the exact production `@prisma/client` + `@prisma/adapter-pg` (Prisma `7.8.0`, driver-adapter/"client engine runtime" mode — confirmed via `server/src/db.ts`) configuration:
   - 30 rounds × 2-way concurrent `prisma.jobLock.create()` on a freshly-deleted row: **0/30 double-successes** — Postgres's unique-index insert conflict correctly serializes concurrent creates (one throws `P2002`).
   - 50 rounds × 4-way concurrent create-path racers + 50 rounds × 4-way concurrent update-path (expired-lock reclaim) racers, with `query`-event SQL logging enabled: **0/100 double-grants**. The logged SQL confirms `acquireJobLock` issues exactly one `UPDATE ... WHERE lockedUntil < $now` (or one `INSERT ... RETURNING`) per call, each its own auto-committed statement — no multi-statement decomposition, no observed non-atomic behavior from the Prisma 7.8.0 driver-adapter engine.
   - **Conclusion: `jobLock.ts`'s acquire/release primitive is atomic and race-free.** The bug is not there.
3. **Route-level flow, `server/src/routes/platformAdmin.ts`, `POST /privacy/data-retention/run`** (pre-fix): for a genuine live-run attempt, the handler performed, in order: `loadDataRetentionConfig()` (sync) → `await getPlatformSetting(...)` (DB read) → policy-gate check → `await recordManualRunStarted(gateCtx)` (a durable audit-write DB transaction, intentionally placed **before** any lock attempt so a destructive run is never uninstrumented) → **only then** `await withJobLock(name, ttl, () => runDataRetentionCleanup(...))`.
4. **Reproduced the full route+test 9 times locally** against real disposable Postgres (pre-fix code): 9/9 clean, 20/20 each time — consistent with a narrow window, not a fundamentally broken primitive.
5. **Root-cause statement:** two manual live-run requests fired together (`Promise.all`, no `await` between them — exactly what the failing test does) each pay their own, independently-variable-latency sequence of DB round trips (`getPlatformSetting` read, `recordManualRunStarted` transaction) **before either one ever attempts to acquire the shared lock**. Because a live-run cleanup against a small/disposable dataset completes in single-digit milliseconds (confirmed by the SQL timing captured during the stress test above — each `jobLock` operation took 2–5 ms), it is possible for requestor A's entire acquire→cleanup→release cycle to finish **before** requestor B's own (slightly slower) pre-lock work even reaches its first `acquireJobLock` call. When that happens, B finds the lock already free — legitimately, sequentially, not concurrently — and also acquires it, also runs cleanup (on an already-emptied dataset, so no double-deletion), and also returns `200`. **This was never a flaw in the lock's own atomicity** (§2 above proves that directly); it is a structural gap: the actual mutual-exclusion decision (`acquireJobLock`) happened too late relative to two other, unprotected, variable-latency DB round trips that both racers perform identically but not necessarily in lockstep. GitHub Actions' shared/virtualized runners introduce materially more scheduling/network jitter between two "simultaneous" requests than a quiet local Docker Desktop box, which is consistent with the observed CI-flaky/local-clean asymmetry.
6. **Test-vs-application-contract determination:** the application contract genuinely was violated — the task's required contract ("a manual/manual collision must allow only one executor") is not satisfied by "the lock is technically never held by two processes at once" if two genuinely-simultaneous attempts can avoid actual contention through pure timing luck. The test's assumption (two `Promise.all`-fired attempts must collide) is the correct one to hold the application to; the fix is application-side, not a test weakening.

## 3. Fix

**Design: smallest correction to the existing distributed `JobLock` contract — reorder, do not replace.**

- `server/src/utils/jobLock.ts`: `acquireJobLock`/`releaseJobLock` (previously private, only reachable through `withJobLock`) are now **exported**. No SQL changed. `withJobLock` itself is untouched (still used unchanged by the scheduled cron in `dataRetentionCleanupJob.ts` and every other job in the codebase — `clinicBulkExportCleanupJob.ts`, `fileBackupService.ts`, `imagingBridgeOfflineJob.ts`, `inboundEventRetryJob.ts`, `metaTemplateSyncJob.ts`, `patientPrivacyExportCleanupJob.ts`, `publicBookingNoticeEvidenceCleanupJob.ts`, `reminders.ts`).
- `server/src/routes/platformAdmin.ts`, `POST /privacy/data-retention/run`, live-run branch: the shared lock is now acquired **first** — before either the "started" audit write or the cleanup call — via the newly-exported `acquireJobLock(DATA_RETENTION_JOB_LOCK_NAME, DATA_RETENTION_JOB_LOCK_TTL_MS)`. This makes the lock attempt the very first DB operation of the "genuine attempt" path (after the unavoidable, identical-shape `getPlatformSetting` policy-gate read that both dry-run and live paths already require), closing almost all of the previously-unprotected window: two `Promise.all`-fired requests now reach their lock attempt in near-lockstep (bounded by Node's own synchronous dispatch, not by independently-variable-latency audit-write timing), so Postgres's already-proven-atomic acquire genuinely contends.
- **Audit-shape contract preserved exactly**: both the winner and the loser still write their own `manual_run_started` row (moved to right after the lock decision, still strictly before any mutation) — the existing, already-accepted "both racers reach the 'started' write" requirement (asserted by the test itself) is unchanged. The loser branches immediately to a `manual_run_blocked` / `concurrent_run_in_progress` terminal row and `409` — no cleanup is ever invoked on the losing path.
- **New failure-mode handled correctly:** if the lock is now held first and the subsequent `recordManualRunStarted` write then fails (forced in tests via an FK violation, same technique as the pre-existing test), the lock is released immediately (`releaseJobLock`) before the `500` response — otherwise this would newly orphan the lock for its full 2-hour TTL, which did not exist as a risk in the old ordering (where the lock was never touched until after the started-write succeeded).
- **Lock release on the cleanup path** is now `try { summary = await runDataRetentionCleanup(...) } finally { await releaseJobLock(...) }` — released on success, on a thrown error, and on any other non-local exit, mirroring exactly what `withJobLock` already guaranteed, just decomposed so the "started" write can sit between acquisition and cleanup.
- An `acquireJobLock` call that itself throws (e.g. DB unreachable) is treated as "not holding the lock" — fail-safe, matching the pre-existing external behavior `withJobLock` already produced in that case (this is a deliberate, documented non-change, not a new cross-mode rule).
- **No new locking subsystem, no Redis/BullMQ/Kafka, no process-local mutex, no sleep, no schema/migration change.** The scheduled cron's own call path (`dataRetentionCleanupJob.ts` → `withJobLock`) is completely untouched.

### Lock scope/key (unchanged by this fix)

- Lock name/key: `'data-retention-cleanup'` (module constant `DATA_RETENTION_JOB_LOCK_NAME`, `server/src/jobs/dataRetentionCleanupJob.ts`).
- Scope: **global**, one row for the entire platform (not per-organization/clinic/job-type) — correct for this job, because a single live retention-cleanup pass scans and mutates rows across **all** tenants in one run (confirmed by the existing, unmodified "no cross-tenant leakage" test and `runDataRetentionCleanup`'s own category queries, which carry no `clinicId`/`organizationId` filter). A per-tenant lock would not prevent two tenant-spanning sweeps from racing each other.
- TTL: 2 hours (`DATA_RETENTION_JOB_LOCK_TTL_MS`), unchanged — large cleanups may run long; unaffected by this fix.
- Ownership: unchanged — `LOCK_OWNER` (`hostname:pid:random`), so `releaseJobLock` only ever clears a lock this exact process instance acquired.

## 4. Tests added/strengthened (all real PostgreSQL, no mocked Prisma)

All in `server/src/tests/retentionManualRunAudit.test.ts`, run via `tsx` against a real disposable PostgreSQL container — **25 assertions total (was 20)**:

1. **Race gate** (new): `race gate: 10 consecutive concurrent live-run rounds against real PostgreSQL — zero double-success, zero double-block observations` — repeats the exact `Promise.all`-fired 2-way concurrent live-run scenario 10 consecutive times in one test, fresh `JobLock`/audit-row/seeded-row state each round, asserting `[200, 409]` and exactly-one-deletion every round. Directly targets the CI regression (run 30542271302).
2. **JobLock primitive, exercised directly** (new section, 3 tests): 4-way truly-concurrent `acquireJobLock()` on a fresh key (exactly one grant); acquire→release→re-acquire (no orphaning after success); acquire→(simulated throw inside the exact `try/finally` shape the route now uses)→release still happens (no orphaning after a thrown exception).
3. **Lock reserved-then-abandoned edge case** (new): forces the "started" audit write to fail via FK violation **after** the lock has already been acquired (the new ordering's own new risk) — confirms zero audit rows are left behind (existing invariant) **and** that the lock is released immediately (new invariant), re-verified by successfully re-acquiring it.
4. **Scheduled/manual collision test strengthened** (existing test, extended): now seeds an eligible row and asserts it is untouched after the `409` (concrete proof of "no cleanup", not just a status code), and asserts the simulated scheduled-cron's lock ownership (`lockedBy`) is untouched by the rejected manual attempt.
5. The original concurrent-runs and scheduled-collision tests are otherwise unchanged (same assertions, same 200/409 contract, not weakened).
6. Multi-connection: every concurrent test fires real `Promise.all`-launched, no-`await`-between calls against the shared Prisma connection pool (`max: 10`, `@prisma/adapter-pg`) — never simulated with sequential calls.

No test was skipped, quarantined, retried-until-green, or weakened. No sleeps were added anywhere. No test-only serialization was introduced.

## 5. Exact commands and results

All against a disposable PostgreSQL container (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, matching F1-003-P2's pinned image), migrated via `prisma migrate deploy` (all repository migrations applied cleanly, exit `0`).

| Command (from `server/`, `DATABASE_URL` pointed at the disposable container unless noted) | Result |
|---|---|
| `npm run typecheck` | Exit `0`, 0 errors |
| `npm run test:retention-manual-run-audit` (post-fix) | `Toplam: 25  ✓ 25  ✗ 0` — **run 8 consecutive times in this task, 8/8 clean** (80 total race-gate rounds embedded across those runs, 0 double-successes, 0 double-blocks) |
| `npm run test:data-retention` | `Results: 42 passed, 0 failed` (unaffected — exercises `runDataRetentionCleanup` via injected deps, does not go through the route or the lock) |
| `npm run server:test:non-disposable` (root-level DB-free aggregate, from `server/`) | Exit `0`, 0 `✗` markers across the full combined log (68+ member scripts) |
| From repo root: `npm run test:runtime:postgres` | Exit `0` — `"test": {"scriptName": "server:test:disposable-db", "code": 0}`, `"cleanup": {"success": true, "errors": []}`, `"outcome": {"exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"]}` |
| `docker ps -a --filter label=com.noramedi.test-runtime=true` (after every disposable run) | Zero residual containers (this task's own manually-provisioned repro container, also labeled, was removed at the end of the session — confirmed empty) |
| `docker network ls --filter label=com.noramedi.test-runtime=true` (after every disposable run) | Zero residual networks |
| `git diff --check` | Clean |

**Note on `server:test:legacy-db-required`:** this script/aggregate does not exist on `origin/main` — it is defined only inside PR #268's (F1-003-P3, not merged) `.github/workflows/ci-layers.yml`. Per instruction, this task did not copy the P3 CI aggregate onto this branch; instead the exact failing test (`test:retention-manual-run-audit`) was run directly against a disposable PostgreSQL provisioned the same way F1-003-P2's accepted runtime provisions one (same pinned image, same `prisma migrate deploy` step), as a bounded one-off command — documented above.

## 6. Ten-run race gate (task requirement §6.7)

- The new embedded test (`race gate: 10 consecutive concurrent live-run rounds...`) ran the exact `Promise.all`-fired 2-way race **10 consecutive times per invocation of the test file**.
- The test file itself was run **8 consecutive times** in this task (interrupted by a tooling timeout after 8, not a failure) — **80 total race-gate rounds, 0 double-successes, 0 double-blocks, 100% exactly-`[200,409]`**.
- Combined with the isolated primitive stress test (§2: 130 total concurrent-acquisition rounds against the raw `jobLock.ts` functions, 0 double-grants), this task observed **zero double-success races across 210+ concurrent-acquisition trials** against real PostgreSQL, post-fix.

## 7. Migration status

**None.** No `schema.prisma` change, no new migration file, no `_prisma_migrations` change. The existing `JobLock` model/table (migration `20260706150000_add_job_lock`) is reused exactly as-is — this fix is a pure application-code reordering plus two new exports from an existing module.

## 8. Security / tenant / KVKK review

- **Tenant-scoped data behavior:** unchanged. The retention cleanup itself (`runDataRetentionCleanup`) is not modified by this fix — same categories, same thresholds, same batch logic.
- **Lock scope:** global/job-type-scoped (one row for `'data-retention-cleanup'`), not tenant-scoped — correct, per §3 above, because the protected operation itself spans all tenants in one pass.
- **Audit impact:** every attempt (winner and loser, in every branch including the two new failure edge-cases) still writes the required started/terminal audit pair with the correct action/outcome/`errorCategory`, exactly as the pre-existing, already-accepted audit contract requires. No audit row is newly lost or newly duplicated by this change; the new "lock acquired, then started-write fails" edge case still leaves zero audit rows behind (same invariant as the pre-existing analogous test), now additionally guaranteeing the reserved lock itself is not orphaned.
- **KVKK impact:** this fix closes a real concurrent-deletion/anonymization *risk* (two live cleanup executions could, under the pre-fix race, both believe they held exclusive access to the same tenant-spanning delete/anonymize operation — even though empirically no double-deletion was ever observed, since the second attempt's cleanup only ever found already-emptied categories). The fix removes the possibility of two "successful" manual triggers being silently accepted for what an operator would reasonably expect to be a single, exclusive destructive action — directly relevant to KVKK/data-retention operational integrity, without touching what data is or is not eligible for deletion.
- **Concurrent deletion/anonymization risk existed:** yes, in the narrow sense described above (two sequential-but-not-overlapping executions, not two *simultaneous* deletions of the same rows — the shared lock, proven atomic in §2, always prevented true overlap). No evidence of any actual double-processing of the same row was found in any reproduction, including the pre-fix CI failure log (`deletedOperationalEvents` was `1` for the winner and the loser's own summary was never observed to double-count).
- **Backward compatibility:** full. Same route path, same request/response shape, same status codes (`200`/`403`/`409`/`500`), same audit action/outcome vocabulary. Callers (frontend platform-admin UI) require no change.
- **Rollback:** a single `git revert` of this task's commit fully restores the pre-fix ordering — no data migration, no schema change, no lock-table cleanup required (the `JobLock` row format is identical before and after).
- **Behavior under API process crash (between lock acquisition and release):** unchanged from the pre-existing distributed contract — the lease has a 2-hour TTL; a crashed process's lock is reclaimed by the next successful `acquireJobLock` call once `lockedUntil` has passed. **Not tested by this task** (would require killing a live process mid-request); this is an existing, pre-fix limitation of the lease-based design, not newly introduced or newly claimed-safe by this fix.
- **Behavior under worker/scheduled-job process crash:** identical mechanism and identical limitation — the scheduled cron path (`dataRetentionCleanupJob.ts`) is untouched by this fix. **Not tested by this task.**
- **Behavior under DB connection loss:** `acquireJobLock` throwing is treated as "did not acquire" (fail-safe, no execution) — verified by code inspection and by the pre-existing `withJobLock` catch behavior this preserves; **not verified with an injected live connection-loss test** in this task (out of scope; no claim of crash-guarantee beyond what is directly tested is made here, per instruction).

## 9. Residual limitations (explicitly not claimed as solved)

- ~~The fix makes the pre-lock unprotected window *much* smaller (one shared `getPlatformSetting` read, identical in shape for both racers, instead of that plus a full audit-write transaction), not provably zero. A sufficiently pathological scheduler could theoretically still stagger two requests' `getPlatformSetting` reads by more than the new critical section's duration. This is accepted as the practical limit of a DB-lease-based distributed lock without a new locking subsystem (explicitly prohibited by the task brief) — the empirical race-gate result (§6, 210+ trials, 0 failures) is offered as evidence of practical robustness, not a mathematical proof of zero probability.~~ **[SUPERSEDED 2026-08-02 by F1-003-B2-R1]:** this residual gap is now closed — `acquireJobLock` was moved ahead of `getPlatformSetting` entirely, so admission is decided before ANY variable-latency DB operation a live attempt performs, not merely before the audit write. See `docs/program/evidence/F1-003-B2-R1_ADMISSION_LOCK_CLOSURE.md` for the deterministic (barrier-based, non-timing-luck) proof and its own residual-limitation statement. This sentence is preserved verbatim as dated historical evidence, not silently rewritten.
- Crash/connection-loss recovery paths described in §8 rely on the pre-existing 2-hour TTL lease-expiry mechanism, unchanged and untouched by this fix, and were not independently re-verified by this task. **Unchanged by F1-003-B2-R1** — see that document's own §9 for the current statement.

## 10. Status (unchanged by this task, explicitly reaffirmed)

- F1: `IN_PROGRESS`. F1-003: `IN_PROGRESS`. F1-003-P3 (PR #268): **open, blocked, not merged, not modified by this task.** F1-003-P4: blocked.
- R-070: `OPEN`, untouched. R-046: `OPEN`, untouched. R-071: unchanged.
- G1/G2: `NOT_APPROVED`.
- KVKK physical/architecture freeze: `ACTIVE`, untouched. KVKK baseline-stable declaration: **NOT GRANTED**, unaffected by this task.
- This task's own maximum status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`. **Not merged. Not deployed. Not production-verified. External review required before merge.**

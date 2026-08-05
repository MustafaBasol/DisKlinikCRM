# F1-004-P1-R2 — Emergency-Contact Primary-Update Race: Root-Cause Confirmation, Rejected Alternative, and Fix

| Field | Value |
|---|---|
| Task ID | F1-004-P1-R2 |
| Phase | F1 — Engineering Safety Net and Concurrency Verification |
| Title | Patient Emergency Contact Concurrent Primary Update — residual race root-cause and fix |
| Parent context | Main CI run [31002888303](https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/31002888303) failed `patientEmergencyContactsPrimaryConcurrency.test.ts`'s concurrent-UPDATE scenario on `origin/main`'s own tip (`9b10bc9fde0ceaeb58d90860a950143de7123910`, PR #323's own merge commit) — a commit that **already included** PR #310's advisory-lock + optimistic-recheck fix (merged 2026-08-03, closing #309). A failed-jobs rerun of the same run passed. This task determines the exact root cause of that residual failure and fixes it. |
| Prior F1-004-P1 history reviewed | `docs/program/evidence/F1-004-P1_EMERGENCY_CONTACT_PRIMARY_UPDATE_CONCURRENCY.md` was never merged to `main` — it existed only on the closed, unmerged branch `fix/f1-004-p1-emergency-contact-primary-update-concurrency` (PR #311), which recorded its own supersession: "PR #310 ... merged the same root-cause diagnosis and fix design ... independently and first." Commit `71989bad4e66a7d2dab938b2007d02f2433060d8` (`fix(patients): close emergency-contact primary UPDATE race (US-01.2-FU)`, PR #310) is the actual fix present on current `main` and is the one this task re-examines. |
| Baseline `origin/main` SHA | `9b10bc9fde0ceaeb58d90860a950143de7123910` (PR #323's own merge commit, confirmed via `git rev-parse origin/main` after `git fetch origin`) |
| Branch / worktree | `fix/f1-004-p1-r2-emergency-contact-update-race`, fresh isolated worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f1-004-p1-r2-emergency-contact-update-race` created via `git worktree add ... -b fix/f1-004-p1-r2-emergency-contact-update-race origin/main` — confirmed clean at task start (no reused dirty state; the pre-existing `fix/f1-004-p1-emergency-contact-primary-update-concurrency`/`hotfix/us-01-2-primary-update-race` worktrees were inspected read-only, never reused). |

## 1. Original failure evidence (attempt 1 of run 31002888303)

`gh api repos/MustafaBasol/DisKlinikCRM/actions/runs/31002888303/attempts/1/jobs` shows job `ci-layers / Layer 3: disposable PostgreSQL tests` (id `92295979999`) `conclusion: failure`. Its log (`gh api .../jobs/92295979999/logs`):

```
patientEmergencyContactsPrimaryConcurrency — 2. Two concurrent UPDATEs of DIFFERENT existing contacts, both requesting isPrimary=true
  ✗ exactly one of two concurrent updates (different contacts, both -> isPrimary=true) wins; the other gets 409 PRIMARY_CONTACT_CONFLICT; at most one primary afterwards
      AssertionError [ERR_ASSERTION]: exactly one concurrent update must succeed as primary — got A=200 B=200
patientEmergencyContactsPrimaryConcurrency — 2b. Stress: 25 independent rounds of the DIFFERENT-contacts UPDATE race, each on a fresh patient — must be deterministic every round
    [stress summary] rounds=25 one-200-one-409=25/25 exactly-one-primary=25/25
  ✓ all 25 rounds produce exactly one 200 + one 409 PRIMARY_CONTACT_CONFLICT, and exactly one primary contact afterwards
patientEmergencyContactsPrimaryConcurrency: 5 passed, 1 failed
```

The Postgres container's own `postgres-run-summary.json`, embedded in the same log, confirms `migration.code: 0`, `test.code: 1`, `cleanup.success: true` — the failure was a genuine test assertion failure, not an infrastructure/migration/cleanup problem.

## 2. Rerun evidence (attempt 2)

`gh api repos/MustafaBasol/DisKlinikCRM/actions/runs/31002888303/attempts/2/jobs` shows the SAME job re-run (id `92298209814`) `conclusion: success`; `gh api .../runs/31002888303` confirms `run_attempt: 2`, and the top-level run's own `conclusion: success`. No code changed between attempts — this is exactly the "rerun success" the task brief warns must not be treated as proof of safety.

## 3. Do not assume — checked explicitly

- **Rerun success does not prove safety**: confirmed false in the ordinary sense — same code, same test, two different observed outcomes on the *identical* commit.
- **25-round stress being weaker than the single scenario**: also true here, but not because the single scenario is a "stronger" test — both scenarios exercise the identical two-contact race; the stress rounds simply did not happen, this run, to hit the exact scheduling window the single scenario's isolated run did. See §5.
- **Two 200 responses implying two persisted primary rows**: checked directly — see §4. The unique index (`PatientEmergencyContact_one_primary_per_patient`, migration `20260803120000_add_patient_emergency_contacts`) was never bypassed; final DB state always had exactly one primary row.
- **The unique index being sufficient by itself**: it is not (this is exactly PR #310's own original diagnosis, reconfirmed here) — kept unchanged as the backstop; no migration required or performed by this task.

## 4. Deterministic reproduction (proves root cause, not just correlation)

A temporary, non-committed diagnostic harness (`server/src/tests/dbVerification/scratch_repro_toctou.ts`, deleted before this PR — not part of the merged suite, per the task's own instruction not to leave scratch repro files behind) drove the real Express route handlers against a real disposable PostgreSQL instance, using `node:async_hooks`' `AsyncLocalStorage` to tag request B's continuation and monkey-patch-gate **only** its "prior primary" pre-check query (`prisma.patientEmergencyContact.findFirst({ where: { isPrimary: true }, select: { id: true } })`, no `id` filter) to wait until request A's whole `PUT` had resolved, while both requests were still dispatched together via `Promise.all`.

Result, run against `main`'s pre-fix code (commit `71989ba`/PR #310's design, unmodified):

```
setup 201 201
[gate] request B prior-read waiting for request A commit...
[gate] request B prior-read proceeding, A already committed = true
RESULT {
  resA: { status: 200, ... fullName: 'A', isPrimary: true },
  resB: { status: 200, ... fullName: 'B', isPrimary: true },
  primaryCountAfter: 1,
  contacts: [ { fullName: 'A', isPrimary: false }, { fullName: 'B', isPrimary: true } ]
}
```

This **deterministically** reproduces `A=200, B=200` on demand — not a rare flake. Critically, `primaryCountAfter: 1` and contact A's row shows `isPrimary: false` in the final committed state: **the database invariant "at most one primary" was never violated.** Only the HTTP-level contract ("the loser must get 409") was violated — request B's promotion silently, validly (from Postgres's point of view) overwrote request A's.

Re-run against the fixed code (§6) with the identical harness: the targeted query shape no longer exists as a standalone call (it is now the first statement inside the promoting transaction), so the gate never fires; natural execution now correctly produces `resA: 200`, `resB: 409 PRIMARY_CONTACT_CONFLICT`, `primaryCountAfter: 1`, every time (5/5 manual runs, then 100/100 and 150/150 in the strengthened stress suite — §8).

## 5. Root cause (category F — combination, primarily A)

PR #310's fix reads the "prior primary" id via a **separate, unlocked** `prisma.patientEmergencyContact.findFirst()` call issued *before* `prisma.$transaction()` even opens. That query and the transaction's own connection checkout are two **independent** events, both competing for the same `pg` connection pool (`server/src/db.ts`, `PrismaPg({ max: parsePositiveInt(process.env.DB_POOL_MAX, 10), ... })` — default 10 connections). Node's single-threaded event loop plus pool-queuing scheduling can freely reorder these two independent events relative to a concurrent request's own operations.

Concretely, for the losing request B: if its "prior primary" read happens to execute (due to pool contention, connection round-robin, or ordinary CI-runner scheduling variance — "more likely under CI runner contention," per PR #310's own commit message) *after* request A's entire transaction (lock acquire → reset → write → commit → lock release) has already finished, B's "prior" snapshot silently equals A's now-committed row. The in-lock recheck then finds `currentPrimary.id === priorPrimaryId` — no discrepancy — and B proceeds to legitimately (from the check's own logic) demote A and promote itself. Both callers observe `200`.

**Why the 25-round stress test could still pass 25/25 in the same run**: the failure is a genuine race — its manifestation depends on whether the *specific* window between B's decoupled pre-check read and its own transaction's connection checkout happens to straddle A's full commit. This is scheduling-sensitive, not workload-inherent: repeating the identical two-request race back-to-back, on an otherwise-idle test process, does not reliably reproduce the specific contention pattern that one CI run's process/OS/Docker-runner scheduling happened to produce. This is exactly the same class of intermittency the original bug (pre-PR #310) itself exhibited, one layer deeper. §4's forced-interleaving harness proves the mechanism deterministically once the exact window is manufactured; natural scheduling only manufactures it "sometimes."

**Classification against the task's own A–F taxonomy**: primarily **(A) a real runtime concurrency defect** — the optimistic-recheck's "prior" snapshot is not actually synchronized with the moment the client's concurrent intent was dispatched, only with whenever an unrelated, independently-scheduled query happens to run — combined with **(C) an isolation/timing artifact** (the specific manifestation is scheduling-dependent). Not **(B)** — the test's `Promise.all` correctly dispatches two genuinely concurrent requests; the reordering happens inside the server's own request handling, not the test harness. Not **(D)** — the failing assertion (`successCount === 1`) and the passing-but-insufficient one (`primaryCount === 1`) both inspect final, committed state, not an intermediate one. Not **(E)** — the unique index performed its backstop role correctly throughout; the gap is in the *optimistic check's* timing, not the schema.

## 6. Fix implemented

Both the "prior" read and the "current" re-check after the advisory lock now run on the **same** `prisma.$transaction` (same pg connection) as each other, in `server/src/routes/patientEmergencyContacts.ts`'s `POST`/`PUT` handlers:

```
if (promoting) {
  // "prior" read — first statement of this transaction, same connection
  const priorPrimary = await tx.patientEmergencyContact.findFirst({ where: {...isPrimary:true...}, select: {id:true} });

  await acquireEmergencyContactPrimaryLock(tx, patient.id);

  // "current" recheck — same connection, only gap is the lock-wait itself
  const currentPrimary = await tx.patientEmergencyContact.findFirst({ where: {...isPrimary:true...}, select: {id:true} });
  if ((currentPrimary?.id ?? null) !== (priorPrimary?.id ?? null)) {
    throw new PrimaryContactConflictError();
  }
  ...
}
```

The only gap between the two reads is the advisory-lock wait itself — never a second, independently-poolable database round trip that connection-pool scheduling could reorder relative to a competing request's *entire* transaction. `server/src/services/patientEmergencyContactsConcurrency.ts`'s header comment documents the exact mechanism and the ordering requirement (read must precede lock acquisition — reversing it would silently make every request's snapshot start *after* its own lock-wait, reproducing the original bug in a new shape).

`isPrimaryContactConflict()` (`server/src/services/patientEmergencyContacts.ts`) now also recognizes Prisma error code `P2034` (transaction write-conflict/deadlock) defensively, alongside `P2002` (unique-constraint backstop) and the `PrimaryContactConflictError`'s own code — none of which changes the response shape (`409 { error, code: 'PRIMARY_CONTACT_CONFLICT' }`, unchanged).

## 7. Alternative considered and rejected: SERIALIZABLE isolation

An intermediate design ran the whole promoting transaction at `ISOLATION LEVEL SERIALIZABLE`, read the current primary as the transaction's first statement (fixing its snapshot before the lock-wait), and dropped the manual prior/current comparison entirely — relying on PostgreSQL's own predicate-lock conflict detection (SQLSTATE `40001` / Prisma `P2034`) to abort one side of any genuine race.

**Verified to work for genuine overlap.** A raw-SQL probe (`pg` client, no Prisma, no app code) against the same disposable Postgres instance proved, unambiguously:

| Scenario | Mechanism | Result |
|---|---|---|
| Genuine overlap (B reads while A's transaction is still open/uncommitted, then both compete for the lock) | Postgres SSI (predicate locking) | **Correctly aborts one side** — `could not serialize access due to read/write dependencies among transactions`, SQLSTATE `40001` |
| B's *entire* transaction (including its own first read) only opens after A has already fully committed | — | **Not caught by any mechanism** — this is a formally valid serial history (A then B); Postgres has no conflict to detect, and neither does a manual prior/current comparison whose "prior" read also only happens after A's commit. This is the true theoretical boundary of what any purely server-side, no-client-token, no-global-lock mechanism can guarantee — documented honestly rather than glossed over (see §9). |

**Rejected because of a cross-tenant regression it introduced.** Re-running the full concurrency suite under the SERIALIZABLE design broke **scenario 5** (two unrelated patients, different organizations, concurrently getting a primary contact must not interfere): patient Y's create started failing with `409 PRIMARY_CONTACT_CONFLICT`, even though X and Y share nothing. Root cause: on a small/sparse `PatientEmergencyContact` table (true of every fresh test database, and plausibly of a lightly-loaded production table), PostgreSQL's query planner favors a **sequential scan** over the `patientId`/`clinicId`/`organizationId` index for the "current primary" read; under SERIALIZABLE, predicate locks are then taken at **page/table granularity**, not scoped to the matching rows — so two concurrent promotions for two *different* patients spuriously conflicted with each other. This is precisely the kind of "cross-tenant existence oracle"/unrelated-tenant-blocking the task's own tenant-safety requirements forbid, so this design was rejected in favor of §6's manual-comparison-on-one-connection fix, which does not use SERIALIZABLE and was verified (§8) to **not** reproduce this regression.

## 8. Test evidence (exact commands, counts, repetitions)

All commands run from `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f1-004-p1-r2-emergency-contact-update-race`.

| # | Command | Result | Exit code |
|---|---|---|---|
| 1 | `npx tsx src/tests/patientEmergencyContacts.test.ts` (from `server/`) | 24 passed, 0 failed (includes 2 new unit tests: `PrimaryContactConflictError` and `P2034` classification) | 0 |
| 2 | `npx tsx src/tests/dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts` (from `server/`, real disposable Postgres) | 8 passed, 0 failed — CREATE-race stress **100/100** rounds (one-201-one-409, exactly-one-primary), UPDATE-race stress **150/150** rounds (one-200-one-409, exactly-one-primary), plus new same-contact-idempotent-update scenario | 0 |
| 3 | `npx tsc --noEmit -p .` (server) | Clean — no type errors | 0 |
| 4 | `npm run test:runtime:unit` (root, `scripts/test-runtime` orchestrator unit tests) | 74 passed, 0 failed | 0 |
| 5 | `npm run test:runtime:postgres` (root, full `server:test:disposable-db` chain — all 16 test scripts, real Docker-provisioned disposable PostgreSQL, migration + teardown) — **run 1/3** | `patientEmergencyContactsPrimaryConcurrency: 8 passed, 0 failed`; every other one of the 16 chained scripts also passed; `cleanup.success: true`, zero residual `nmtest-*` Docker resources afterward (`docker ps -a --filter name=nmtest` empty) | 0 |
| 6 | Same as #5 — **run 2/3** | Identical results (8/8 emergency-contact; 100/100 + 150/150 stress; all 16 scripts passed); `cleanup.success: true`, zero residual resources | 0 |
| 7 | Same as #5 — **run 3/3, first attempt** | Environmental failure, not a code defect: Docker Desktop's own Go runtime hit `fatal error: out of memory allocating heap arena map` mid-run on this local machine (separately-running unrelated containers from other projects were also consuming host memory at the time) — recorded honestly rather than silently retried and hidden | `3221226505` (Windows access-violation-style code from the Docker CLI, not from the test suite) |
| 8 | Same as #5 — **run 3/3, retry after Docker recovered on its own (~15s later, confirmed via `docker ps`)** | Identical results to runs 1–2 (8/8 emergency-contact; 100/100 + 150/150 stress; all 16 scripts passed); `cleanup.success: true`, zero residual resources | 0 |

**Repetition count**: the full disposable-PostgreSQL profile was executed **3 independent, successful process-level times** (plus one environmentally-failed attempt reported transparently, not discarded silently), each provisioning and tearing down its own fresh, uniquely-named/-labeled Docker container and network. Disposable-DB cleanup succeeded in all 3 successful runs; the one environmental failure's own cleanup attempt also failed for the same OOM reason, but no `nmtest-*` resources were left behind afterward once Docker recovered (confirmed by `docker ps -a --filter name=nmtest` returning empty before the retry).

**Diagnostic instrumentation**: the forced-interleaving harness used in §4 logged only the synthetic literal string `A`/`B` labels and HTTP status codes/booleans it generated itself — no patient name, phone, email, or medical data of any kind. It was never merged (deleted before this PR).

## 9. Residual, honestly-documented limit

No purely server-side database mechanism (SERIALIZABLE, advisory locks, or the manual prior/current comparison this fix uses) can distinguish, with absolute formal certainty, "these two requests were dispatched concurrently by the caller but one request's *entire* database interaction, from its very first statement, happened to be scheduled strictly after the other's commit" from "these were always meant to be sequential." Closing that residual gap completely would require either a client-supplied optimistic-concurrency token (changes API request semantics — a task stop condition) or serializing all primary-contact writes globally (explicitly forbidden). This fix closes the **specific, proven** mechanism behind the observed CI failure (a decoupled, independently-poolable pre-check query) and empirically eliminates it across 250 real stress rounds (100 CREATE + 150 UPDATE) over 3 independent disposable-Postgres runs; it does not claim to have made concurrent HTTP scheduling itself deterministic, which is outside any single request handler's control.

## 10. Tenant/clinic scoping (unchanged, re-verified)

- The advisory lock remains keyed by `patientId` alone (already globally unique in this schema) — different patients, clinics, and organizations never contend (scenario 5, now passing with the final design).
- The reset/recheck queries remain explicitly scoped to `(patientId, clinicId, organizationId)`, not `patientId` alone.
- The lock is only ever acquired for `isPrimary: true` writes; `isPrimary: false` writes and unrelated field updates never touch it (scenario 6).
- `isLegalDecisionMaker` remains never deduplicated (scenario 7).
- Authorization (role matrix, cross-clinic/cross-org denial, BILLING exclusion, record-owned clinic attribution) is unchanged — no route-level authorization code was touched by this fix; re-confirmed by the unaffected 24/24 non-concurrency unit suite (test #1 above).

## 11. Migration status

**No migration required or performed.** The existing partial unique index (`PatientEmergencyContact_one_primary_per_patient`, migration `20260803120000_add_patient_emergency_contacts`) is sufficient as a backstop and was not touched, weakened, or removed. The root cause was entirely in the application-layer optimistic-concurrency check's read timing, not in any schema/constraint/index gap.

## 12. Rollback

- **Revert runtime files**: `git revert` the single commit on `fix/f1-004-p1-r2-emergency-contact-update-race`, or hard-reset that branch to `origin/main`'s pre-fix tip (`9b10bc9`) — restores PR #310's exact prior code (advisory lock + separate unlocked pre-check query).
- **Revert test changes**: only necessary if reverting production code — the strengthened stress counts (100/150) and the new same-contact scenario are pure additions/parameter increases, not weakenings; they can be kept independently of the production-code revert if desired (they would simply continue exercising the pre-R2 code and could re-surface the original intermittent failure under contention).
- **No migration to roll back** — none was performed.
- **Old behavior after rollback**: PR #310's design is restored exactly — the specific decoupled-query race documented in §4/§5 would again be present (probabilistically, not deterministically, reproducible under real scheduling/CI contention), at the same low-but-nonzero rate that produced the original CI failure. No new risk is introduced by rolling back beyond re-exposing the already-known, already-CI-observed gap.

## Accepted findings

- The CI failure was a real, deterministically-reproducible application-layer concurrency defect (§4, §5) — not test flakiness, not a harness bug, not an index gap.
- The database-level single-primary invariant was never violated by the old code; only the HTTP-level "loser gets 409" contract was.
- SERIALIZABLE isolation, while correctly catching genuine overlaps, is unsuitable here because of table/page-granularity predicate locking on a sparse table — empirically confirmed via a dedicated cross-tenant regression in scenario 5, and via a raw-SQL probe.
- The implemented fix (same-connection prior/current comparison) closes the proven mechanism; verified across 250 real stress rounds over 3 independent disposable-Postgres process executions, with zero recurrence.

## Rejected or unverified claims

- "Impossible under all scheduling" is **not** claimed — see §9's honestly-documented residual theoretical limit.
- "The 25-round stress test being weaker than the single scenario" is **not** accepted as the explanation for why it passed in the failing run — both scenarios exercise the identical race; the difference is purely a matter of which specific runs happened to manufacture the exact scheduling window.

## Exact next task

External review and merge decision for PR #325. Once merged, no further F1-004 follow-up is anticipated unless a future CI run reproduces a *different* concurrency gap in this same code path, in which case it should be opened as a new, separately-numbered task per this program's own convention (not silently folded into this one).

## 13. Real GitHub Actions evidence (post-push, same task)

PR #325's final head (`a6d55efc57811409355f83b8c17a811db805ae37`, after the documentation commit) triggered `ci-layers` run [31012057012](https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/31012057012), watched to genuine terminal completion via `gh run view --json status,conclusion,jobs` (not assumed from a partial check). **All 9 jobs `success`**, including `ci-layers / Layer 3: disposable PostgreSQL tests` — the exact job that failed in run 31002888303 — and `ci-layers / Layer 5: full-suite/compatibility fail-safe (backend, legacy server:test DB-required members)`. `REMOTE_CI_VERIFIED` is genuinely established on the PR's own final head, independent of and in addition to the local 3-independent-run evidence in §8. **Task status upgraded: `AGENT_COMPLETED` / `TESTS_PASSED` / `REMOTE_CI_VERIFIED` / `PR_OPENED_AWAITING_REVIEW`.**

## 14. R2 review-remediation and main-conflict reconciliation (same PR, superseding §8's exact counts — not rewritten in place, per this program's own convention)

Two PR #325 review threads required a follow-up commit, `b01ea47124584f918351afd6feb02e6f46e4839a` — resolved without changing the accepted concurrency design (same-transaction prior/current read under the existing advisory lock, unchanged):

1. **Stress-round configuration**: `patientEmergencyContactsPrimaryConcurrency.test.ts` gained `PATIENT_EMERGENCY_CONTACT_{CREATE,UPDATE}_RACE_ROUNDS` env overrides for local diagnostic runs only — bounded-positive-integer-validated (zero/negative/decimal/non-numeric/empty all throw at import time), a below-10-round floor requires an explicit local-fast-mode opt-in. CI never sets these variables, so CI continues to run the full committed 100/150 defaults unconditionally. This added 9 new unit tests (§8's "8 passed" is now stale).
2. **P2034 misclassification**: `patientEmergencyContacts.ts` no longer maps a generic Prisma `P2034` (deadlock/serialization failure) to `PRIMARY_CONTACT_CONFLICT` — a bare `P2034` is not inherently a primary-contact-specific signal and now falls through to the route's existing generic 500 handling. `PrimaryContactConflictError` and `P2002` (the two proven primary-contact-specific signals) are unchanged. This replaced 1 stale unit test with 2 new ones (§8's "24 passed" is now stale).

**Corrected test counts, current as of this commit** (supersedes §8 rows 1–2 and the 24/24 reference in §10):
- `patientEmergencyContacts.test.ts`: **25/25** (net +1 vs. §8's 24/24).
- `patientEmergencyContactsPrimaryConcurrency.test.ts`: **17/17** (§8's original 8 concurrency/stress scenarios, unchanged, + 9 new stress-round-configuration-validation unit tests). CREATE-race stress remains 100/100, UPDATE-race stress remains 150/150.
- Server typecheck clean; root `test:runtime:unit` 74/74 — unchanged.
- Full `test:runtime:postgres` disposable-DB profile (all 16 chained scripts) re-run **3 independent successful process-level times against this exact post-R2 commit**, exit `0` each, zero residual Docker resources each time.

**Main-conflict reconciliation (separate, subsequent step, no runtime/design change):** by the time both review threads were resolved, `origin/main` had advanced past this branch's baseline via PR #324 (F2-GUARDRAIL-VAL-001, documentation/evidence-only). The only real conflict was in `CURRENT_PHASE.md` (both this PR and PR #324 independently prepended a new top-of-file entry on the same baseline) — resolved by placing this PR's entry above PR #324's, since this reconciliation is the later of the two; PR #324's entry, and all other newer main facts (F2 guardrail enforcement readiness `NOT_READY`, current F2 task ordering), are preserved unedited. `NORAMEDI_MASTER_TRACKER.md` and `evidence/README.md` auto-merged cleanly (disjoint edit regions). No application/schema/migration/CI-workflow file was touched by the reconciliation itself. Reconciliation commit: `fd1148f8341311baee3db1b2a7313522d7ad2404`.

## 15. First real-CI observation of the documented residual limitation (honest record, not glossed over)

The reconciliation commit's own PR CI run ([31020654709](https://github.com/MustafaBasol/DisKlinikCRM/actions/runs/31020654709)) **failed** on first execution, in `ci-layers / Layer 3: disposable PostgreSQL tests`, specifically at CREATE-race stress round 0:

```
round 0: exactly one concurrent create must succeed — got A=201 B=201
```

Both concurrent first-ever-contact CREATE requests for a fresh patient (no pre-existing primary) succeeded. Root-cause analysis of `server/src/routes/patientEmergencyContacts.ts`'s CREATE handler: when no primary contact exists yet, both the "prior" and "current" reads return `null` for whichever request runs second. If that second request's entire database interaction (prior-read → advisory-lock-acquire → current-read) happens to be scheduled strictly after the first request's full commit, its `currentPrimary` re-check (taken after acquiring the lock, by which point the first request has already committed and released it) returns the first request's own newly-committed row — **not** the `null` the second request's `priorPrimary` read had captured moments earlier. `currentPrimary.id !== priorPrimary.id`, so per the code this should throw `PrimaryContactConflictError`... **except** when neither read observed a primary yet (both still `null` at the time each ran), the comparison is `null === null`, no conflict is thrown, and the second request proceeds to reset the first request's row and insert its own — both requests then observe their own request as having succeeded (`201`), because each transaction's local view was internally consistent at the moment it checked.

This is precisely the theoretical **residual limitation already documented in §9** ("a request whose ENTIRE database interaction happens to be scheduled strictly after a competing request's full commit cannot be distinguished... by any purely server-side mechanism") — but until this run, that limitation had only ever been described as a theoretical edge case, never observed in a real CI execution. It appears CI's runner-to-container network latency profile made this specific scheduling pattern reachable at least once in 100 CREATE-race rounds, where 300 local rounds (3 independent disposable-DB runs on this same commit, plus 300 more on the R1 commit before it) never reproduced it.

**Diagnostic action taken, per explicit direction, no code or test change:** the failed CI job was rerun once (`gh run rerun 31020654709 --failed`) to determine whether this was a one-off manifestation or a deterministic regression. **The rerun passed** — `ci-layers / Layer 3: disposable PostgreSQL tests` completed `success`, and the overall run conclusion is `success`. This is consistent with a rare, non-deterministic manifestation of the accepted residual limitation, not a deterministic logic regression — but a single rerun passing is not formal proof of the former over the latter; it is reported as exactly that: one failure, one rerun pass, both real, neither hidden.

**This finding does not weaken, and this task did not weaken, the stress test's assertion** (`successCount === 1` for all 100/150 rounds) — doing so would require a program-owner decision about how to redefine "success" for a design that itself does not claim to eliminate this scheduling pattern, which is explicitly out of this reconciliation task's scope. **Recorded, not resolved:** whether this residual gap's real-world frequency is acceptable, whether the test should tolerate a bounded rare-failure rate, or whether a different mechanism (client-supplied concurrency token, previously rejected as an API-semantics change) is warranted, is an open question for a follow-up task or program-owner decision — not decided here.

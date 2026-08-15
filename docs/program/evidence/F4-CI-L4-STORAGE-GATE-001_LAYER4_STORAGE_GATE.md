# F4-CI-L4-STORAGE-GATE-001 — Layer 4 storage integration CI integrity remediation

**Phase:** F4 — blocking CI integrity remediation for F4-FCR-002A
**Baseline:** `def01bf` (`origin/main`, "ops(f4-fcr-002a): harden the PITR restore drill before the first production run (#422)")
**Branch:** `fix/f4-ci-l4-storage-gate-001` (isolated git worktree; PR #423 untouched)
**Status of PR #423 at time of writing:** OPEN, head `8d804625bc808cf5d0fe21beb189e38683343646` — **must not be merged** until Layer 4 executes for real.

---

## 1. The finding

The Layer 4 job (`storage-integration-tests` in `.github/workflows/ci-layers.yml`) has
been reporting **success while executing nothing**.

Observed on PR #423, run `31888544850`, job `95022748802`, step 6 ("Provision
disposable PostgreSQL + MinIO, run `server:test:storage-integration`, tear
down"):

| Fact | Value |
|---|---|
| Step conclusion | `success` |
| Step duration | 9.76 s (14:10:21.82 → 14:10:31.58) |
| Bytes of orchestrator stdout/stderr | **0** (verified against the raw job-log archive, not just the rendered view) |
| Run summary printed | none — not even the `JSON.stringify(summary)` the orchestrator prints on *every* handled path |
| `cleanup-stale --live --ttl-hours=0.01` result | `candidates: []` — **no Docker resource was ever created** |
| Steps 7–9 (summary validation, secret scan, artifact upload) | `skipped` — all three were gated `if: failure()` |

This is not a one-off. Every recent Layer 4 job completes in ~38–40 s total
with the same empty 10 s provision step:

| Run | Job | Duration | Orchestrator output |
|---|---|---|---|
| 31815530511 (F4-1A, #419) | 94819449062 | 38 s | none |
| 31831065501 (F4-FCR-001, #420) | 94866932145 | 43 s | none |
| 31876047418 (F4-FCR-002, #421) | 94991944979 | 38 s | none |
| 31881118341 (F4-FCR-002A) | 95003840280 | 40 s | none |
| 31888544850 (PR #423) | 95022748802 | 34 s | none |

For comparison, Layer 3 (`postgres` profile — the *same* provisioning code
path) spends 17.5 s before its first output and minutes in total.

**The existing Layer 4 green is not evidence of storage coverage.**

## 2. Root cause

### 2.1 Structural (the fail-open itself)

`scripts/test-runtime/orchestrator.ts` derived success from *the absence of a
recorded failure*, not from the presence of a result:

- Every handled failure inside `runDisposableProfile()` is caught, converted
  into a printed summary, and assigned an explicit `process.exitCode`.
- **Node's default exit code is 0.** Any termination that never reaches the
  end of `main()` — most importantly, the event loop draining while `main()`'s
  promise is still pending — exits **0**, prints **nothing** (all diagnostics
  live *after* the point of death), and writes **no summary file**.
- Nothing downstream compensated: the npm aggregate only forwards an exit
  code, and the CI job validated the summary artifact **`if: failure()`**, so
  on the vacuous path the artifact was never parsed, never scanned and never
  even uploaded. Nobody ever looked.
- Even a *correctly* exiting run proved nothing about coverage: an npm script
  that runs zero commands, or a suite that returns before its first assertion,
  also exits 0. There was no executed-test count anywhere in the chain.

**Reproduced deterministically** (`scratchpad/mutation-proof.sh`, summarised in
§6): injecting a never-settling `await` into the baseline orchestrator
reproduces the CI symptom exactly — exit `0`, zero output, no summary file.
The same injection against the fixed tree exits `91` with a named stage.

### 2.2 Secondary (the MinIO / off-host contradiction)

Independently, the storage suite could not have passed had it run.
`server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` asserted:

```ts
assertEqual(dest.isFileBackupDestinationOffHost(), true, 'off-host');
```

against a MinIO reached at `http://127.0.0.1:<published port>`. F4-FCR-001
(PR #420) correctly tightened `isFileBackupDestinationOffHost()` so a
**loopback** S3 endpoint is *not* reported as off-host — that value drives an
operator-facing "off-host ✓" badge, the recovery status file and the host
monitor's failure-domain alarm, and over-claiming it is exactly the false
assurance R-030 exists to prevent. So the suite and production policy
contradicted each other, and the vacuous green hid it.

## 3. The fix

### Lane B — the orchestrator can no longer exit 0 without a result

`scripts/test-runtime/orchestrator.ts`

1. **Stage tracing.** Every stage writes a marker with `fs.writeSync(2, …)` —
   synchronous, so it survives a process that dies without flushing. A silent
   death now names the stage it died in.
2. **Abnormal-termination trap.** A `runCompleted` sentinel is set only on the
   line that finishes a run normally. `process.on('exit')` converts
   "terminated without completing, would have exited 0" into exit **91**;
   `beforeExit` additionally reports event-loop drain.
   `uncaughtException`/`unhandledRejection` exit **92**.
3. **Execution proof.** The orchestrator hands the suite a receipt path
   (`NMTEST_EXECUTION_RECEIPT_FILE`) and its own run id
   (`NMTEST_EXECUTION_RUN_ID`). After the test child exits it reads that
   receipt and requires: present, parsable, bound to *this* run id, non-zero
   executed count (≥ 20), zero failed cases, and every one of the eight
   contractual member ids executed **and passed**. Anything else → exit **90**,
   regardless of the child's exit code. (`scripts/test-runtime/lib/executionProof.ts`)
4. **Summary is evidence, not decoration.** A requested-but-unwritten
   `--summary-file` downgrades an otherwise-passing run to exit **94**. It can
   never upgrade a failing one.
5. Cleanup ordering is unchanged and still unconditional: the receipt is read
   *before* teardown (its temp dir is a teardown target) but *outside* the
   run-body `try`, so no receipt problem can skip cleanup.

`.github/workflows/ci-layers.yml`

6. A new **always-on gate step** runs
   `verify:storage-run -- storage-run-summary.json --require-offhost-destination`
   (`scripts/test-runtime/verify-storage-run.ts` +
   `scripts/test-runtime/lib/storageRunSummary.ts`). It is an *independent*
   second check on the artifact and treats **absence as failure** everywhere:
   missing file, unparsable JSON, `test: null`, `migration: null`, missing or
   unsatisfied `executionProof`, `executedCount` below the floor, failed
   cleanup, missing `minio` topology block, or a topology/classification
   contradiction.
7. The secret scan and artifact upload moved from `if: failure()` to
   `if: always()`, so the evidence exists for green runs too.
8. Layer 1 gains `npm run test:runtime:storage-gate` (Docker-free).

### Lane C — a genuinely off-host-shaped disposable destination, with production policy untouched

**`isFileBackupDestinationOffHost()` is not modified.** Not one line of
`server/src/services/fileBackupDestination.ts` changed.

Instead the *test topology* changed. `provisionMinio()` now also resolves the
MinIO container's **own IPv4 address on this run's user-defined Docker
network** (`docker inspect … .NetworkSettings.Networks`). That address (e.g.
`172.18.0.3:9000`) is a non-loopback identity in a separate network
namespace, so the **unmodified production predicate answers `true` on its own
merits**. Where a container network is not routable from the host (Docker
Desktop on Windows/macOS), the run falls back to the published
`127.0.0.1:<port>` mapping, records `addressMode: 'loopback-fallback'`, and
the suite asserts the honest answer (`false`) instead of pretending.

Safety of that widening is deliberately narrow
(`scripts/test-runtime/lib/guard.ts`): `assertSafeMinioEndpoint()` still
requires loopback **unless** the host is (a) an exact member of the addresses
Docker itself reported for *this run's own* MinIO container **and** (b) inside
RFC 1918 space. HTTPS and the production-hostname patterns remain rejected
unconditionally. This is the same identity-check shape `assertSafeDatabaseUrl`
already applies to the run-id-bearing database name — not a general relaxation.

The suite's assertion becomes topology-derived rather than hard-coded, and
gains a hard failure when CI promised an off-host-shaped destination but
handed over loopback (a silent coverage downgrade).

### Lane D — regression coverage

- `scripts/test-runtime/__tests__/storageGate.test.ts` (new, 60 cases,
  Docker-free) — receipt parsing, proof evaluation (including one case per
  required member), fail-closed outcome combination, the CI summary gate, the
  **mutation/negative proof** against the verbatim vacuous-summary shape, the
  guard's new identity check, container-address parsing and endpoint
  selection.
- `server/src/tests/fileBackupOffHostClassification.test.ts` (new, 17 cases,
  no Docker/DB/network) — the production definition of off-host, locked down
  in both directions, including under `NODE_ENV=production`. Wired into
  `server:test:non-disposable`, so it runs in **Layer 2 on every PR**
  independently of whether Layer 4 ran at all.
- `fileBackupDbIntegration.test.ts` gains a live loopback-is-never-off-host
  case against the real module.

## 4. Changed files

| File | Change |
|---|---|
| `scripts/test-runtime/orchestrator.ts` | stage tracing, abnormal-termination trap, execution-proof wiring, MinIO topology selection, summary-write enforcement |
| `scripts/test-runtime/lib/executionProof.ts` | **new** — receipt parsing + proof evaluation (pure) |
| `scripts/test-runtime/lib/storageRunSummary.ts` | **new** — CI summary contract (pure) |
| `scripts/test-runtime/verify-storage-run.ts` | **new** — the CI gate CLI |
| `scripts/test-runtime/lib/outcome.ts` | optional `executionProof` in `combineOutcome`; dedicated exit codes 90/91/92/94 |
| `scripts/test-runtime/lib/minio.ts` | container-network address mode, candidate selection with injectable probe |
| `scripts/test-runtime/lib/docker.ts` | `parseContainerNetworkAddress` / `getContainerNetworkAddress` |
| `scripts/test-runtime/lib/guard.ts` | `isPrivateIpv4Address`; run-scoped container-address allowance in `assertSafeMinioEndpoint` |
| `scripts/test-runtime/lib/summaryFile.ts` | `writeSummaryFileReporting` (reports the write outcome) |
| `scripts/test-runtime/__tests__/storageGate.test.ts` | **new** — Lane D tooling coverage |
| `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` | execution receipt; topology-derived off-host assertions; member ids |
| `server/src/tests/fileBackupOffHostClassification.test.ts` | **new** — production off-host policy lock |
| `.github/workflows/ci-layers.yml` | always-on Layer 4 gate/scan/upload; Layer 1 storage-gate tests |
| `package.json`, `server/package.json` | script registration and aggregate membership |

**Not changed:** `server/src/services/fileBackupDestination.ts`,
`server/src/services/fileBackupService.ts`, any route, any migration, any
production configuration.

## 5. Commands and results

Run from the isolated worktree (`E:/Ek Gelir/Siteler/wt-f4-l4-storage`).

| Command | Result |
|---|---|
| `npm run typecheck:runtime` | pass (0 errors) |
| `cd server && npx tsc --noEmit` | pass (0 errors) |
| `npm run test:runtime:unit` | **74 passed, 0 failed** |
| `npm run test:runtime:storage-gate` | **60 passed, 0 failed** |
| `cd server && npx tsx src/tests/fileBackupOffHostClassification.test.ts` | **17 passed, 0 failed** |
| `npm run test:ci-classify` | **22 passed, 0 failed** |
| `npm run guardrail:test` | **74 passed, 0 failed** |
| `npm run test:log-privacy-guard` | **37 passed, 0 failed** |
| `npm run log-privacy-guard:scan -- --strict-baseline` | no new violations (267 files) |

Not runnable locally: the full Layer 4 storage suite itself needs a Docker
daemon, which is not available on the authoring machine. It is exercised by
Layer 4 in CI on this PR — see §5.1.

### 5.1 CI verification on this PR (run `31891866307`, job `95029378747`)

Layer 4 executed **for real** for the first time. Stage trace:

```
15:10:04.089  stage: storage:start
15:10:04.089  stage: storage:docker-available-check
15:10:04.129  stage: storage:network-create
15:10:05.304  stage: storage:postgres-provision
15:10:19.523  stage: storage:postgres-readiness
15:10:21.969  stage: storage:minio-provision
15:10:25.281  stage: storage:minio-readiness
15:10:26.312  MinIO destination topology: container-network (172.18.0.3:9000)
              — off-host classification expected: true
15:10:26.312  stage: storage:migrations
15:10:32.979  stage: storage:run-tests(server:test:storage-integration)
15:10:34.362  fileBackupDbIntegration: 25 passed, 0 failed
15:10:34.362  execution receipt written: 25 passed, 0 failed
15:10:34.408  stage: storage:collect-execution-proof
15:10:34.408  stage: storage:teardown
15:10:34.887  stage: storage:complete(exit=0)
15:10:35.218  [layer4-gate] PASS: storage suite executed 25 test case(s) against a
              container-network MinIO destination, migrations applied, cleanup clean.
```

Emitted `storage-run-summary.json` (uploaded as an artifact on this green run —
previously it was uploaded only on failure):

```json
"minio":          { "addressMode": "container-network", "endpointHost": "172.18.0.3",
                    "endpointPort": "9000", "offHostClassification": true },
"executionProof": { "required": true, "satisfied": true, "executedCount": 25,
                    "failures": [], "suite": "fileBackupDbIntegration",
                    "passedCount": 25, "failedCount": 0, "missingRequiredMemberIds": [] },
"outcome":        { "exitCode": 0, "reasons": ["tests passed",
                    "execution proof satisfied (25 test case(s) executed)",
                    "cleanup succeeded"] }
```

Note the off-host case in particular: it passed against `172.18.0.3:9000`
through the **unmodified** production predicate, which is the whole point of
Lane C.

### 5.2 On the proximate trigger

The **structural** cause in §2.1 is proven and fixed. The **proximate** trigger
of the specific pre-fix terminations is characterised but not fully
determined, and this is stated deliberately rather than guessed at:

- the pre-fix process died ≈9.5 s after start, which the stage trace above
  places inside `provisionPostgres()`'s `docker run` (the disposable-Postgres
  image pull spans 05.3 → 19.5 here);
- that call is a **synchronous** `spawnSync`, and every synchronous failure of
  it is caught and printed — so the orchestrator process itself must have been
  terminated from outside, and its wrapper reported that as exit 0;
- the provisioning code on that path is byte-for-byte unchanged by this PR
  (only stage markers were added around it), so this PR did not "fix" the
  trigger, and the trigger may recur.

**That is acceptable and is the point of the fix.** If it recurs, the run is
now RED, not green: the abnormal-termination trap forces exit 91 where it can,
and — independently of whether the orchestrator process survives long enough
to run any of its own code — the always-on gate step fails because
`storage-run-summary.json` does not exist. The stage marker will also name the
exact stage it died in, which the previous zero-output failure never did.

## 6. Mutation / negative proof of the fail-open fix

`scratchpad/mutation-proof.sh` injects `await new Promise(() => {})` (the exact
abnormal-termination mode) immediately after `registerCleanupTargets(...)` in
two trees and runs the `storage` profile:

```
================ before (baseline def01bf) ================
EXITCODE=0
SUMMARY=absent
================ after (this PR) ================
[test-runtime] stage: storage:start
[test-runtime] FAIL-CLOSED: the Node event loop drained while the orchestrator run
               was still in progress (last stage: storage:start). No test result was
               ever produced.
[test-runtime] FAIL-CLOSED: the orchestrator terminated before completing a run
               (last stage: storage:start) but would have exited 0. Forcing exit 91 —
               a run that produced no test execution and no summary is never a pass.
EXITCODE=91
SUMMARY=absent
```

The `before` column reproduces the CI symptom exactly: exit 0, zero output, no
summary.

CI-gate negative proof (`verify-storage-run.ts`):

- verbatim vacuous summary → exit 1, naming the un-invoked test command, the
  absent execution proof, the never-run migration and the missing topology block;
- no summary file at all → exit 1 ("absence is failure").

Both are also asserted as standing tests in the `MUTATION PROOF` section of
`storageGate.test.ts`, so a future regression turns that section red.

## 7. Migration, rollback, security

- **Migration impact:** none. No Prisma migration, no schema change, no data
  change, no environment-variable change in any deployed environment. The new
  variables (`NMTEST_EXECUTION_RECEIPT_FILE`, `NMTEST_EXECUTION_RUN_ID`,
  `NMTEST_MINIO_ADDRESS_MODE`, `NMTEST_EXPECT_OFFHOST_DESTINATION`) exist only
  inside a disposable CI/test process and are unset everywhere else, in which
  case behaviour is unchanged.
- **Rollback:** revert the single merge commit. Nothing to undo outside the
  repository — no deployment, no restore, no migration. Reverting restores the
  previous (fail-open) Layer 4 behaviour and re-opens this finding.
- **Security / tenant isolation:** the production off-host predicate is
  byte-for-byte unchanged, and `fileBackupOffHostClassification.test.ts` now
  makes that permanent. The only widening anywhere is the test-runtime guard,
  and it is bounded to an RFC 1918 address Docker reported for the run's own
  container; production hostnames and HTTPS stay rejected. No tenant-scoping
  logic is touched.
- **KVKK:** no change to what is collected, stored, transmitted or retained.
  The execution receipt records test *names and pass/fail status only* — no
  patient data, no clinic data, no credentials — and lives in a per-run temp
  directory removed during teardown. The run-summary artifact records
  host/port only (never the MinIO credentials or any connection string) and
  still passes the workflow's prohibited-pattern scan, which now runs on every
  outcome rather than only on failure.
- **No deployment and no restore was executed by this task.**

## 8. Known remaining gap (deliberately out of this task's scope)

Layers 3 and 5b run the same orchestrator with the `postgres` /
`postgres-compat` profiles, and this task's scope is Layer 4 storage. They
**do** inherit the profile-independent half of the fix — stage tracing and the
abnormal-termination trap, so a silent exit-0 death is now impossible for them
too. They do **not** yet have:

- an execution-receipt contract (their aggregates chain dozens of leaf
  scripts, so a per-suite receipt is a larger design question), or
- an always-on summary gate — their summary-validation, secret-scan and
  upload steps are still `if: failure()`, exactly as Layer 4's were.

So a Layer 3 run whose npm aggregate resolved to zero commands would still
report success. That is a smaller hole than the one closed here (their
provisioning failures already surface, and their suites do print output that a
reviewer can see), but it is the same shape and should be closed by a
follow-up task rather than left implicit. Recorded here so it is not mistaken
for something this PR already covers.

## 9. Does PR #423 become merge-safe?

**Not on this PR's merge alone.** Merging this PR makes Layer 4 *capable* of
failing honestly; it does not retroactively give PR #423 storage coverage.

PR #423 becomes merge-safe when **both** hold:

1. this PR is merged to `main`; and
2. PR #423 is rebased/updated onto that `main` and its **Layer 4 job passes
   with the gate active** — i.e. `storage-run-summary.json` shows
   `executionProof.satisfied: true` with a non-zero `executedCount` and all
   eight required members present.

Until (2) is observed, PR #423's green remains uninformative about storage.

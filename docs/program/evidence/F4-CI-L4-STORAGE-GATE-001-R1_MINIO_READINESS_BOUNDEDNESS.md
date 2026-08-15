# F4-CI-L4-STORAGE-GATE-001-R1 — MinIO readiness: bounded, deterministic, drain-proof

**Phase:** F4 — CI integrity blocker for F4-FCR-002A
**Baseline:** `87271be26c8772132ac639f7809655a4c31c28f0` (`origin/main`, "Merge pull request #424 from MustafaBasol/fix/f4-ci-l4-storage-gate-001")
**Branch:** `fix/f4-ci-l4-storage-gate-001-r1` (fresh isolated git worktree)
**PR #423 (`feature/f4-fcr-002a-pitr-verification`, head `7fd7e38f892d70a06e5ff86c29d870912d3b86cc`):** untouched — not a single file of it is modified, and no deploy or restore was executed by this task.

R0 (PR #424, merged) made Layer 4 *fail closed*: a run that produces no test
execution and no summary can no longer report success. It worked — the very
next Layer 4 attempt on PR #423 correctly went red with exit 91 instead of
silently green. R1 is the other half: making the readiness path that tripped
it **deterministic and bounded**, so it produces a real result instead of a
forced failure.

---

## 1. The finding

PR #423, run `31893589449`, job `95040001240`, step "Provision disposable
PostgreSQL + MinIO, run `server:test:storage-integration`, tear down":

```
16:43:51.7099015Z [test-runtime] stage: storage:minio-readiness
16:43:51.7513315Z [test-runtime] FAIL-CLOSED: the Node event loop drained while the
                  orchestrator run was still in progress (last stage:
                  storage:minio-readiness). No test result was ever produced.
16:43:51.7515586Z [test-runtime] FAIL-CLOSED: ... Forcing exit 91
16:43:51.7695955Z ##[error]Process completed with exit code 91.
```

**42 milliseconds.** Not a slow timeout — an instant drain. The consequences
were total: no migrations, no storage tests, no summary artifact, no
`executionProof`; the downstream gate then failed with `ENOENT` on
`storage-run-summary.json`.

This is a **flake, not a systematic break**. The same job passed twice on
PR #424 (`31891866307` job `95029378747`, `31892439866` job `95030749657`),
where readiness took ~1.04 s across a couple of poll rounds and the run went
on to execute 25 test cases against a `container-network` destination. The
readiness path was a coin flip on a startup race.

---

## 2. Exact root cause

`scripts/test-runtime/lib/minio.ts` @ `87271be`:

```ts
export const defaultMinioReadinessProbe: MinioReadinessProbe = async (endpoint) => {
  try {
    const response = await fetch(`${endpoint}/minio/health/ready`);   // <-- no timeout, no abort
    ...
};

export async function selectReadyMinioEndpoint(opts) {
  ...
  for (const candidate of candidates) {
    const result = await probe(candidate.endpoint);                   // <-- unbounded await
```

The readiness loop's forward progress depended entirely on the probe promise
settling. It is not guaranteed to.

**The trigger.** Docker publishes a container's port the moment `docker run`
returns. During MinIO's startup window a TCP connection to that port is
**accepted and then closed by the peer (FIN or RST) before a single response
byte is written**. In the failing run MinIO was provisioned 1.76 s before the
readiness stage — squarely inside that window.

**The defect.** On **Node 20** — the version Layer 4 pins (`NODE_VERSION: 20`;
the job log confirms `current: { node: 'v20.20.2' }`) — the bundled undici
**drops** such a request. The promise returned by `fetch()` never settles *and*
undici retains no ref'd libuv handle. So `await probe(...)` parks forever with
an empty event loop, and Node fires `beforeExit`/`exit` with `main()`'s promise
still pending. Node's default exit code is 0; R0's trap is what turned that
into 91.

Node 24 does **not** have this bug (it rejects with `ECONNRESET` /
`UND_ERR_SOCKET`), which is exactly why this never reproduced on a developer
machine.

Reproduced verbatim on both versions, against a real TCP peer that accepts and
resets, running the repository's own `defaultMinioReadinessProbe`:

```
node v20.20.2  raw unbounded probe after 1500ms -> STILL PENDING — undici dropped the promise
node v20.20.2  runBoundedProbe -> {"ready":false,"status":"not-ready","detail":"fetch failed (ECONNRESET)"} in 6ms

node v24.18.0  raw unbounded probe after 1500ms -> {"ready":false,"status":"not-ready","detail":"fetch failed (ECONNRESET)"}
node v24.18.0  runBoundedProbe -> {"ready":false,"status":"not-ready","detail":"fetch failed (ECONNRESET)"} in 3ms
```

A second, same-class failure mode was found while characterising this: a peer
that writes **partial headers** and then stalls leaves `fetch()` pending under
undici's 300 s `headersTimeout` — a ref'd hang rather than a drain, but one
that would blow the entire 60 s readiness budget. Both are the same defect:
*the probe is unbounded*.

### 2.1 Why `AbortSignal.timeout()` is the wrong fix

It is the obvious tool and it would have left the bug exactly as it was.
`AbortSignal.timeout()`'s timer is **unref'd by design** — it "will not keep
the Node.js event loop active". In an otherwise-empty event loop the process
drains *before* the abort ever fires. Measured on both versions:

```
AbortSignal.timeout(5000):        BEFOREEXIT@1ms     fired=false
AbortController + setTimeout(5s): BEFOREEXIT@5002ms  fired=true
```

An abort also cannot settle a promise undici has already dropped. So the fix
must be (a) enforced by the **caller**, not the callee, and (b) built on an
explicit `AbortController` plus a normal **ref'd** `setTimeout`, where the
**race** — not the abort — guarantees settlement, and the ref'd timer is what
keeps the loop alive long enough for the deadline to win.

---

## 3. The fix

### `scripts/test-runtime/lib/minio.ts`

- **`runBoundedProbe(probe, endpoint, attemptTimeoutMs)`** — new. Races the
  probe against a ref'd deadline timer, resolving to
  `{ status: 'timeout' }` if the probe does not answer. `clearTimeout` in a
  `finally` on every exit path. Both race handlers are attached in a single
  `.then(onFulfilled, onRejected)`, so the attempt promise never rejects — a
  late rejection after the deadline would otherwise hit the orchestrator's
  `unhandledRejection` trap and kill the process with exit 92.
- **Probe result classification** — `MinioProbeStatus` =
  `ready | not-ready | timeout | fatal`. `not-ready` and `timeout` are
  retryable (refused/reset/503 is the *normal* state of a starting MinIO);
  `fatal` (unparseable endpoint, unsupported protocol) aborts selection
  immediately rather than burning the budget to relearn it. The field is
  **optional**, so every pre-existing injected probe stays assignable.
- **`defaultMinioReadinessProbe`** — validates URL/protocol up front and
  returns `fatal` for those; forwards the `AbortSignal`; surfaces undici's
  nested `cause.code` (`ECONNREFUSED`/`ECONNRESET`/…) instead of the useless
  bare `"fetch failed"`.
- **`selectReadyMinioEndpoint`** — every attempt now goes through
  `runBoundedProbe`, so loop progress no longer depends on the probe being
  well-behaved *even when a caller injects its own probe*. `attemptTimeoutMs`
  is additionally clamped to the budget still remaining, so overall wall clock
  stays bounded by `timeoutMs` rather than
  `timeoutMs + candidates.length × attemptTimeoutMs`. Distinct
  `MinioReadinessTimeoutError` / `MinioReadinessConfigurationError`.
- `DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS = 10_000` — far below the 60 s overall
  budget, so a stalled attempt costs one retry, not the run.

### `scripts/test-runtime/orchestrator.ts`

Call site passes `attemptTimeoutMs` explicitly (clamped to the readiness
budget), with the failure it prevents recorded at the point it matters.

**Behaviour preserved:** candidate ordering (container-network first, loopback
fallback), the overall 60 s budget and 1 s poll interval, "throws rather than
returning a maybe", the `--inject-failure=readiness` path, and every
fail-closed exit code (90/91/92/94).

---

## 4. Regression coverage

New: `scripts/test-runtime/__tests__/minioReadiness.test.ts` (29 tests, Docker-free)
plus `__tests__/fixtures/readinessDrainHarness.ts` (mutation child process).
Wired into Layer 1 as `npm run test:runtime:minio-readiness` — Docker-free and
already a `needs:` of Layer 4, so a regression is caught before a disposable
runtime is ever provisioned.

| Requirement | Covered by |
|---|---|
| A never-settling fetch cannot drain to exit 0 | mutation harness (`legacy-unbounded` → exit 91) + `combineOutcome` assertion |
| Individual probe timeout is deterministic | "a never-settling probe resolves as a deterministic timeout" |
| Retry loop continues for transient not-ready | "the retry loop keeps going…, then succeeds" (refused → 503 → 200) |
| Ready MinIO succeeds | "a real HTTP 200 on /minio/health/ready is READY"; "end-to-end: a destination that becomes ready mid-poll is selected" |
| Fatal probe error fails clearly | "a FATAL probe result fails clearly and immediately, without burning the budget" |
| No timer/listener leak | `process.getActiveResourcesInfo()` before/after, on success **and** failure paths |
| Fail-closed exit behaviour intact | `EXIT_ABNORMAL_TERMINATION === 91`; readiness failure → non-zero with reason |
| **Real** trigger, real sockets | accept-then-RST, accept-then-FIN, stalled-mid-headers, nothing-listening, 503, 200 — all against the real `defaultMinioReadinessProbe` |

### 4.1 Mutation proof

Two independent mutations, both confirmed to turn the suite red.

**(a) Live mutation of the shipped code.** Replacing
`await runBoundedProbe(probe, candidate.endpoint, attemptBudget)` with the
pre-R1 `await probe(candidate.endpoint)` makes the test process itself
reproduce the production defect — it never reaches a single assertion:

```
selectReadyMinioEndpoint — bounded overall, retrying, fail-closed
Warning: Detected unsettled top-level await at .../minioReadiness.test.ts:169
await testAsync('a never-settling probe fails with a clear timeout instead of draining', ...
   exit=13
```

The bound was then restored and the suite re-verified green.

**(b) Permanent negative test.** `readinessDrainHarness.ts` keeps the
unbounded shape alive in one place only, behind a `legacy-unbounded` mode,
wrapped in the orchestrator's exact fail-closed trap. The test asserts that
shape still drains and is still forced to **exit 91**, and that the shipped
`selectReadyMinioEndpoint` on the identical never-settling probe instead exits
0 having thrown a `MinioReadinessTimeoutError`. If someone reverts the bound,
the two modes converge and the test goes red.

The harness models the dropped promise as `new Promise(() => {})` rather than a
real socket, deliberately: that is precisely what Node 20's undici does, and it
makes the proof deterministic on **every** Node version — including ones where
the underlying undici bug is already fixed.

---

## 5. Local verification

Run in a fresh isolated worktree at baseline `87271be`.

| Command | Node 24.18.0 | Node 20.20.2 (the CI version) |
|---|---|---|
| `npm run typecheck:runtime` | clean | — |
| `npm run test:runtime:unit` | 74 passed, 0 failed | 74 passed, 0 failed |
| `npm run test:runtime:storage-gate` | 61 passed, 0 failed | 61 passed, 0 failed |
| `npm run test:runtime:minio-readiness` | 29 passed, 0 failed | 29 passed, 0 failed |
| `git diff --check` | clean | — |

Node 20.20.2 was installed locally on purpose: the defect only exists there, so
the real-socket accept-then-RST test passing on **that** interpreter is the
load-bearing result.

No `server/**` file is touched, so the server typecheck is unaffected by this
change.

---

## 6. Impact

- **Migrations:** none. No Prisma schema or migration file is touched. The
  effect on migrations is the opposite of a risk: Layer 4 now *reaches*
  `prisma migrate deploy` instead of dying before it.
- **Runtime/production code:** none. Every changed file is test/CI tooling
  under `scripts/test-runtime/**` plus the workflow and `package.json` script
  entry. Nothing under `src/**` or `server/**` is imported by this code, and
  this code is never imported by application runtime.
- **Security / tenant isolation / KVKK:** no change. `assertSafeMinioEndpoint`
  and `assertNoInheritedOverride` are untouched and still run **before** any
  endpoint is contacted; the probe still only ever reaches an address the
  guard already approved. The probe reads `/minio/health/ready` and never sends
  or logs credentials. No personal data, no tenant data, and no production
  endpoint is involved — the disposable MinIO is created and destroyed inside
  the job. The summary artifact's contents and the secret-scan step are
  unchanged.
- **Rollback:** revert the PR merge commit. The change is self-contained tooling
  with no state, no migration, and no deployed artifact; reverting restores the
  pre-R1 readiness path exactly (and with it the flake).

---

## 7. Deferred — recorded, deliberately NOT fixed here

**`ci-main-and-nightly` cascading skip (`fastMode=false`).** Every job in the
`ci-main-and-nightly` workflow is being **skipped**, so push-to-main, the
nightly schedule, and manual dispatch currently have **no CI coverage at all**:

| Run | Event | SHA | Jobs | Skipped |
|---|---|---|---|---|
| `31896416000` | workflow_dispatch | `87271be2` | 12 | **12** |
| `31893127352` | push (main) | `87271be2` | 12 | **12** |
| `31881810674` | push (main) | `def01bf6` | 12 | **12** |

Mechanism: `ci-layers.yml`'s `classify` job is gated
`if: inputs.fastMode == true && github.event_name == 'pull_request'`, so on
these triggers it is skipped. Every Layer 1–5 job lists `classify` in `needs:`,
and their `if:` expressions
(`inputs.fastMode == false || needs.classify.result != 'success' || …`) contain
no status-check function, so GitHub still applies the implicit
"all needs succeeded" requirement and the skip cascades to the whole workflow.
This is the exact pitfall ci-layers.yml's own comment warns about; the
`fastMode == false` fallback it relies on never gets the chance to evaluate.

Out of scope for this blocker by instruction. **It must become its own CI
integrity task** — it is arguably more severe than the defect fixed here,
because it silently removes the entire post-merge safety net.

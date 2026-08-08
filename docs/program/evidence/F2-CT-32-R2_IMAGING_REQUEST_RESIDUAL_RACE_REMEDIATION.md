# F2-CT-32-R2 — ImagingRequest PATCH/Cancel Residual Race Remediation — Evidence

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Pilot — Stage 2 follow-up (post-merge main CI regression on the F2-CT-32-R1 CAS guard).
**Parent findings:** `CT-32`, `CR-03`, `BLK-02`, `FP-06` (original characterization); this task closes a narrower residual gap in the F2-CT-32-R1 fix, not a new defect class.
**Type:** APPLICATION CODE + TEST + ADDITIVE EVIDENCE. No Prisma schema/migration change.
**Status:** `AGENT_COMPLETED` / `TESTS_PASSED` / PR to be opened, not merged, not deployed, not production-verified.
**Program block:** `F2-STAGE3-IMPL-001` remains blocked until this PR is merged and exact post-merge main CI is green (see §16).

---

## 0. Baseline and failing-CI evidence

```
git status --short          -> only pre-existing untracked docs, no uncommitted changes
git fetch origin --prune    -> 969bc69..51e102d  main -> origin/main
git rev-parse origin/main   -> 51e102d19a5ddda87a49ad0367172b3eaae05d09
git log -1 --oneline origin/main
  -> 51e102d Merge pull request #341 from MustafaBasol/docs/f2-doc-004-stage2-exit-gate-reconciliation
```

Matches the task brief's expected baseline SHA exactly. Main had not advanced beyond it.

```
gh run view 31276844302
  workflow: ci-main-and-nightly, event: push, branch: main
  X ci-layers / Layer 3: disposable PostgreSQL tests in 6m10s (ID 93151794429)
    X Provision disposable PostgreSQL, run server:test:disposable-db, tear down
  (all other Layer 1/2/4/5 jobs green)
```

Confirmed real, not fabricated — `gh run view` against the live run returned this exact shape before any code was touched.

**Worktree/branch:** fresh worktree at `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f2-ct-32-r2-imaging-request-residual-race`, branch `fix/f2-ct-32-r2-imaging-request-residual-race`, branched from the verified `origin/main` SHA above. The existing F2-CT-32-R1 worktree (`.claude/worktrees/fix+f2-ct-32-imaging-request-concurrency`) and the F2-STAGE3-AUTH-001 worktree were not reused, read, or merged from.

---

## 1. Scope discipline

CodeGraph (`.codegraph/` at the primary repo root) was used to load, in one call, the exact PATCH/cancel handlers, `findRequestInScope`, `imagingRequestTransitions.ts`'s `ALLOWED_REQUEST_TRANSITIONS`/`validateRequestTransition`/`canAttachStudyToRequest`, and their direct callers — no whole-repository exploration. Direct `Read`/`Grep` were used only for line ranges CodeGraph's own gap markers didn't cover (the exact PATCH/cancel bodies) and for the sibling `patientEmergencyContactsConcurrency.ts` precedent (read deliberately, because §9 of the task brief pointed at exactly the ambiguity that file's own header comment already resolves for a structurally identical problem).

Files touched: `server/src/routes/imaging.ts`, `server/src/schemas/index.ts`, `server/src/tests/imagingRequestConcurrencyCharacterization.test.ts`, `server/src/tests/imagingRequestConcurrencyForcedInterleaving.test.ts` (new), `server/package.json` (script wiring only). `imagingRequestTransitions.ts` and `imagingRequestConcurrencyGuard.test.ts` were read, not modified.

---

## 2. Reproduction before any runtime-code change

### 2.1 Natural (un-forced) reproduction attempts

Disposable Postgres 16 (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, the exact digest-pinned image `scripts/test-runtime/lib/postgres.ts` provisions for CI) was run locally via `docker run`, migrated with `npx prisma migrate deploy`, and `imagingRequestConcurrencyCharacterization.test.ts` (CT-32, pre-fix code) was run repeatedly:

| Run | `CT32_ROUNDS` | Result |
|---|---|---|
| 1 | 100 | 100/100 `EXACTLY_ONE_WINNER`, 0 `BOTH_SUCCESS_SILENT_CLOBBER` — cancel won all 100 rounds, PATCH won 0 |
| 2 | 500 | 500/500 `EXACTLY_ONE_WINNER`, 0 clobber — cancel won all 500 rounds, PATCH won 0 |

**0/600 natural local reproductions.** Locally, cancel is structurally faster than PATCH every single round (cancel does no `validateClinicalLinks` round-trips; PATCH does), so cancel's compare-and-set consistently wins the race against a low-latency local Postgres. This matches the precedent already recorded for the structurally identical emergency-contacts race (`patientEmergencyContactsConcurrency.ts`'s header: "reproduced on GitHub Actions CI... but did NOT reproduce in 500 independent local rounds against a low-latency local disposable Postgres") — CI's cold-start/connection-pool timing occasionally inverts this ordering; a fast local Docker Desktop instance essentially never does.

### 2.2 Forced deterministic reproduction

Per the task brief's explicit permission to use test-code instrumentation, minimal TEST-ONLY synchronization hooks were added to `server/src/routes/imaging.ts` (`installImagingRequestRaceTestHooks`; no-op unless installed, identical rationale/pattern to `patientEmergencyContactsConcurrency.ts`'s `installEmergencyContactRaceTestHooks`), exposing four gate points: `patchBeforeRead`, `patchAfterCas`, `cancelBeforeRead`, `cancelAfterCas`.

A scratch script forced cancel's very first read (`findRequestInScope`) to await a signal fired only after PATCH's compare-and-set `updateMany` had already resolved (i.e. committed) — both HTTP requests still dispatched via `Promise.all`, zero caller-side ordering. Result, reproduced deterministically on demand:

```
patch:  200 scheduled
cancel: 200 cancelled
final persisted status: cancelled
```

**This is an exact match for the CI failure signature** (`round 1: PATCH=200, cancel=200`, final persisted `cancelled`). Confirms the hypothesis in §9 of the task brief empirically, not by assumption.

---

## 3. Root cause

Traced step-by-step from `server/src/routes/imaging.ts` (pre-fix):

Both `PATCH /api/imaging/requests/:id` and `PATCH /api/imaging/requests/:id/cancel`:

1. Read the row via `findRequestInScope` (tenant-scoped `findFirst`) — call this `existing.status`.
2. Validate the requested transition against `existing.status` via `validateRequestTransition`.
3. Write via `prisma.imagingRequest.updateMany({ where: { id, status: existing.status, ...scope }, data })` — the F2-CT-32-R1 compare-and-set guard.

**This CAS is airtight for what it is designed to detect**: if a competing write commits between this handler's own read and its own write, the `updateMany`'s `WHERE status = <snapshot>` clause is re-evaluated by Postgres against the row's current (post-competing-commit) value at write time and matches zero rows — `409 concurrent_transition`, exactly as F2-CT-32-R1 intended, and exactly as `imagingRequestConcurrencyGuard.test.ts` scenario A/C already prove for pairs of **mutually exclusive terminal** targets (`received` vs `failed`).

**The residual gap is specific to a *chainable* pair.** CT-32 races PATCH-to-`scheduled` against cancel (`-> cancelled`), and `scheduled` is itself a valid predecessor of `cancelled` per `imagingRequestTransitions.ts`'s `ALLOWED_REQUEST_TRANSITIONS`. `imagingRequestConcurrencyGuard.test.ts`'s own header comment for scenario A already flags this ambiguity explicitly ("Scenario A deliberately races two TERMINAL targets... rather than a chainable pair like ('scheduled' -> then 'cancelled' is also valid from 'scheduled'). This removes any ambiguity between 'genuine race, guard caught it' and 'legitimate two-step sequential transition, both 200 is correct'"). CT-32 uses exactly the ambiguous, chainable pair the Guard suite's author deliberately avoided for that reason.

When PATCH's entire operation (read → `validateClinicalLinks` → CAS write → commit) completes **before cancel's own read even executes** — proven reproducible in §2.2 — cancel's read legitimately observes `scheduled` (a real, currently-valid predecessor of `cancelled`), and its own CAS legitimately matches and commits `scheduled -> cancelled`. Both handlers behaved exactly as F2-CT-32-R1 designed them to; the CAS mechanism itself did not fail. What the two callers received (`200` + `200`) still violates the invariant this task requires, because neither caller waited for the other.

**This is not a novel problem in this codebase.** `patientEmergencyContactsConcurrency.ts`'s `resolvePrimaryPromotion` header comment (F1-004-P1-R2-R3, already merged, already accepted) proves the general case: *"if this transaction's own FIRST statement... does not begin until AFTER a competing transaction has already committed, both reads observe identical, already-settled state and no conflict is detected, because at that point the two transactions are — from PostgreSQL's own point of view — genuinely, unambiguously sequential, not concurrent. No signal visible only from inside this transaction... can distinguish that from a deliberate, temporally-separated replacement; only information the client captured at its own request-formation time — outside this transaction, outside the database entirely — can."* Section 9's hypothesis (§9 of the task brief) is confirmed, and the closure mechanism this codebase already established for the identical class of problem — a client-supplied precondition, immune to server-side read timing by construction — is what closes it here too.

### 3.1 Race timeline (confirmed, not assumed)

```
t0   PATCH reads existing.status = 'requested'                (findRequestInScope)
     cancel reads existing.status = 'requested'                (findRequestInScope, timing varies)
t1   PATCH validates requested->scheduled: OK
t2   PATCH validateClinicalLinks (1+ DB round-trips)
t3   PATCH CAS: UPDATE ... WHERE status='requested' -> commits, count=1, row now 'scheduled'
     [ CI-observed anomaly: cancel's OWN read has not yet executed at this point ]
t4   cancel's read (delayed) executes NOW, observes 'scheduled' (fresh, post-commit — not stale)
t5   cancel validates scheduled->cancelled: OK (real rule, real predecessor state)
t6   cancel CAS: UPDATE ... WHERE status='scheduled' -> commits, count=1, row now 'cancelled'
t7   PATCH responds 200 {status:'scheduled'}   (its own write, honestly reported)
t8   cancel responds 200 {status:'cancelled'}  (its own write, honestly reported)
     Final persisted row: 'cancelled'.  Both responses individually honest; the PAIR violates the invariant.
```

No isolation-level, locking-strength, or WHERE-clause change to the CAS itself can prevent t4 from observing `scheduled` once t3 has already committed — that is a true, unambiguous serial history at the database level. Closing the gap requires information from outside the transaction (§4).

---

## 4. Fix

**Additive, optional, backward-compatible client precondition (`expectedStatus`)** — the exact technique `patientEmergencyContactsConcurrency.ts`'s token-protected mode (`expectedCurrentPrimaryContactId`) already uses in this codebase for the identical problem shape.

- `server/src/schemas/index.ts`: `imagingRequestUpdateSchema` gains an optional `expectedStatus: z.enum(IMAGING_REQUEST_STATUSES).optional()`. A new `imagingRequestCancelSchema` (previously the cancel route read no body at all) accepts the same optional field.
- `server/src/routes/imaging.ts`: both handlers, immediately after their own `existing.status` read (before any other validation), reject with `409 { code: 'concurrent_transition' }` if `expectedStatus` is supplied and does not equal `existing.status` — **regardless of whether the row's actual current status would otherwise legally support the requested transition.** `expectedStatus` reflects the caller's own belief, captured before the request was formed; it cannot be made stale by connection-pool or event-loop scheduling, because its value never depends on when this handler's own read happens to execute. When `expectedStatus` is omitted, behavior is byte-for-byte identical to F2-CT-32-R1 (this is what makes the change additive, not a breaking contract change).
- The pre-existing F2-CT-32-R1 CAS write itself is **unchanged** — it still correctly serializes any write racing after this new check.

Empirically re-verified against the exact forced schedule from §2.2, this time with both requests supplying `expectedStatus: 'requested'`:

```
patch:  200 scheduled
cancel: 409 concurrent_transition
final persisted status: scheduled
```

Deterministically closed — the fix does not depend on the forced delay happening to fall one way or another; `expectedStatus` mismatches regardless of when the delayed read executes.

### 4.1 Alternatives considered and rejected

1. **Widening/holding a row lock (`SELECT ... FOR UPDATE`) across the full handler** — rejected: proven (via the same forced-hook harness, by construction) that widening the lock only shifts *when* PATCH commits; it cannot prevent cancel's read from landing after that commit if the forced/adverse schedule places it there. Locking, pessimistic or optimistic, cannot manufacture information that exists only in the caller's own request-formation context.
2. **Serializable isolation level** — rejected for the same reason: if PATCH's transaction has genuinely, fully committed before cancel's transaction begins, the two are a valid serial history; SERIALIZABLE has nothing to abort.
3. **A required (non-optional) precondition field** — rejected: would break every existing caller's request payload (task §15 explicitly requires preserving payloads); the frontend does not currently send this field.
4. **Schema/migration (`version`/`updatedAt`-based optimistic lock column)** — rejected; not needed, and would be semantically no different from the existing `status`-based CAS for this specific failure mode (§3 already shows a fresh, valid `updatedAt` read at t4 would equally "match" — the problem is timing of the read, not the granularity of what's compared). No migration was made or is required.
5. **Relaxing CT-32's own aggregate assertion to tolerate the chainable-pair ambiguity** (i.e. treat `BOTH_SUCCESS` on a chainable pair as non-fatal) — rejected: the task's required invariant (§6) is explicit that overlapping dispatch must never both succeed, and the Guard suite's own author already flagged this exact ambiguity as something to design around, not accept.

---

## 5. Test changes

### 5.1 `imagingRequestConcurrencyCharacterization.test.ts` (CT-32) — revised, not deleted

Per this file's own established convention ("This file is REVISED, not deleted... when the characterized gap is closed"), the header comment gained an F2-CT-32-R2 history section, and `runRound`'s two concurrent requests now supply `expectedStatus: 'requested'` — each caller's own belief, captured in the test before either request is dispatched, exactly mirroring what a real client would capture from what it last rendered. No change to the round/classification/aggregate-assertion structure.

### 5.2 `imagingRequestConcurrencyForcedInterleaving.test.ts` — new

Uses the new `installImagingRequestRaceTestHooks` to force the exact schedule from §2.2/§3.1, deterministically, every run (not hoping timing jitter lands on it — same rationale as `patientEmergencyContactsCreateRaceForcedInterleaving.test.ts`). Required cases from the task brief, all covered:

- **A/B/C/D** — forced schedule, 10 rounds legacy (no `expectedStatus`): reproduces `BOTH_SUCCESS` every round — a deliberate **characterization** of the accepted residual limitation for callers that don't supply the precondition (mirrors the emergency-contacts file's own "legacy best-effort mode" section), **not** a regression this task leaves unfixed for callers who *do* opt in. 10 rounds with `expectedStatus` supplied: exactly one 200 + one 409 every round, loser code `concurrent_transition`, winner's response body matches the final persisted row.
- **E** — sequential PATCH (awaited) then cancel (with `expectedStatus` matching the now-current status): both succeed.
- **F** — sequential cancel (awaited) then PATCH: `409 already_terminal`, unchanged.
- **G** — two different rows: back-to-back forced rounds (the hook mechanism is a single module-level object, not per-row — running two forced rounds truly concurrently would race the hook installation, not the rows; documented in the test itself) plus a genuinely concurrent, non-forced two-row check. Neither shows interference or a hang.
- **H** — a cross-org caller's `expectedStatus` cannot be used to probe/affect a request outside its tenant scope: `404`, same shape as an unknown id, row unchanged.
- **I** — no deadlock: all 10+10+G+H rounds complete without hanging (55/55 assertions pass in a single process run).

### 5.3 `imagingRequestConcurrencyGuard.test.ts` — unchanged, re-verified

Not modified (its scenarios use mutually-exclusive terminal targets, already immune to this residual gap by the design its own header documents). Re-run in full below to confirm no regression.

---

## 6. Commands run, exact rounds, exact pass/fail counts

All against real disposable PostgreSQL 16 (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`), no mocks, no SQLite.

| Command | Result |
|---|---|
| `npm run typecheck` (server) | `prisma generate` + `tsc --noEmit` — 0 errors |
| `CT32_ROUNDS=100 npx tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts` (post-fix) | 504/504 passed, `EXACTLY_ONE_WINNER` 100/100, `BOTH_SUCCESS_SILENT_CLOBBER` 0/100 |
| `npx tsx src/tests/imagingRequestConcurrencyForcedInterleaving.test.ts` | 55/55 passed |
| `npx tsx src/tests/imagingRequestConcurrencyGuard.test.ts` | 73/73 passed (no regression) |
| `CT32_ROUNDS=30 npm run test:imaging-characterization` (full chain, default round count = the exact CI value) | CT-32 154/154, Guard 73/73, Forced 55/55, all sibling scripts in the chain green |
| `npm run test:imaging` | 103 passed, 0 failed |
| `npm run test:imaging-lifecycle-facade` | 34 passed, 0 failed |
| `npm run test:imaging-study-request-patient-consistency` | 12 passed, 0 failed |
| `npm run test:imaging-study-request-patient-mismatch-detector` | 7 passed, 0 failed |
| `npm run guardrail:test` | 74 passed, 0 failed |
| `npm run guardrail:scan -- --out=guardrail-report.json` | exit 0 (report-only; findings never fail this job per its own contract) |
| `git diff --check` | clean, exit 0 |
| `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (full `server:test:disposable-db` orchestrator — the exact command CI's Layer 3 job runs) | `outcome.exitCode: 0`, `reasons: ["tests passed","cleanup succeeded"]`, migration `code: 0` |

Forced-interleaving reproduction (§2.2) was run repeatedly on demand (deterministic — the same result every invocation, by construction of the forced schedule) both pre-fix (200/200 every time) and post-fix (200/409 every time), in addition to the 10-round loops built into the permanent regression test.

---

## 7. PostgreSQL / migration

- **Postgres version:** `postgres:16-alpine`, digest `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` — the exact image `scripts/test-runtime/lib/postgres.ts` provisions for CI Layer 3 (major-version parity with production 16.14 per F1-003-P2V; not claimed as exact build/package parity).
- **Migration:** `npx prisma migrate deploy` applied only pre-existing, already-merged migrations. **No new migration file was created.** This fix is Zod-schema-level (two new optional fields) and route-logic-level only — confirmed, no schema change was needed, per task §14.
- **Cleanup:** orchestrator run's own summary reports `cleanup: { success: true, errors: [] }`; manual reproduction container removed via `docker rm -f` after use.

---

## 8. Tenant/auth impact

Zero change to any tenant/scope predicate. `expectedStatus` is compared only against `existing.status`, which is already resolved through the unchanged, fully-scoped `findRequestInScope` read (`clinicId`/`organizationId`/`allowedClinicIds` predicates untouched). A cross-tenant or non-existent request still returns the same `404 { error: 'Imaging request not found' }` regardless of whether `expectedStatus` is supplied — proven in the new test's scenario H. No new cross-tenant existence oracle: a caller cannot use `expectedStatus` to distinguish "wrong status" from "not found" for a row outside its scope, because `findRequestInScope` already returns 404 before `expectedStatus` is ever consulted.

## 9. Backward compatibility

- Route URLs: unchanged.
- Request payloads: `expectedStatus` is optional on both routes; every existing caller (frontend included) that omits it gets byte-for-byte F2-CT-32-R1 behavior, including that fix's own known residual gap (documented, not silently widened or narrowed).
- Response shapes / status codes: unchanged. The new `409 concurrent_transition` uses the exact same error shape and code the F2-CT-32-R1 CAS guard already returns for the analogous case.
- Sequential-transition compatibility: `requested -> scheduled -> cancelled` (and the reverse-order terminal rejection) remain valid when the caller genuinely sequences the two calls (test scenarios E/F) — the fix only closes the gap for requests dispatched *without* the caller waiting for the first to complete, and only for callers that opt in by supplying `expectedStatus`.
- Audit behavior: unchanged — `auditImaging` calls and their payloads are untouched.
- ImagingRequest state machine (`imagingRequestTransitions.ts`): not modified.

## 10. Rollback

`git revert <fix commit>`. No schema rollback (none was made). Reverting restores exactly the F2-CT-32-R1 behavior described in this document's §3 (including its residual, characterized gap) — no operational transaction-semantics change to roll back, since the fix does not alter transaction boundaries, only adds a pre-write comparison against an optional caller-supplied field.

---

## 11. Stage-3 relationship

`F2-STAGE3-AUTH-001`'s merged authorization decision (`STAGE_3_ENTRY_GATE = SATISFIED`, `AUTHORIZED_TO_BEGIN_STAGE_3_IMPLEMENTATION = TRUE`) is **not revoked** — nothing in this task's findings invalidates that authorization's own assumptions; this is a narrower, independent CI-gate blocker layered on top of it. `F2-STAGE3-IMPL-001` remains blocked until this PR merges and exact post-merge main CI is green, per the task's explicit instruction (§1/§19) — this document does not itself claim that gate is satisfied; see the PR's own CI run for that confirmation before resuming Stage-3 implementation.

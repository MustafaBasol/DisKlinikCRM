# F2-STAGE3-IMPL-001-POSTMERGE-CI-001 — Post-Merge Main CI Failure Investigation/Remediation (`securityIncident.test.ts`)

**Phase:** F2 — Modular Boundaries and Public Contracts.
**Trigger:** post-merge `main` CI failure on `ci-main-and-nightly` run `31313169502`, `ci-layers / Layer 5: full-suite/compatibility fail-safe (backend, legacy server:test DB-required members)`, `server/src/tests/securityIncident.test.ts`, test **"22. Repeated cross-tenant denial: one resource stays medium, multiple resources escalate to high"** — observed `54 passed, 1 failed`, assertion `null == true` (`assert.ok(singleResourceIncident)` with `singleResourceIncident === null`).
**Baseline:** `origin/main` @ `6a248ea1c359b2e86f39f9fff0b1d8577357fc10` (PR #344 merge commit) — independently re-fetched and confirmed via `git fetch origin main` / `git rev-parse origin/main`, no drift.
**Worktree:** dedicated physical worktree `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/fix-f2-stage3-postmerge-securityincident-ci`, branch `fix/f2-stage3-postmerge-securityincident-ci`, created from `origin/main` — `git status --short` clean at creation, `HEAD` = `6a248ea1c359b2e86f39f9fff0b1d8577357fc10`.

**Classification: Category C — pre-existing concurrency/timing flake, root cause proven, not caused by PR #344.**

---

## 1. Causality check against PR #344

PR #344 (`refactor(privacy): migrate initial imaging lifecycle callers to public contract`, merge commit `6a248ea1c3...`, parents `27c54f3`/`7f3157e`) changed exactly: `server/src/services/imaging/public.ts`, `server/src/services/privacy/orphanFileInspection.ts`, `server/src/services/privacy/patientAnonymization.ts`, `server/package.json` (script additions only), two new test files (`privacyImagingLifecyclePortMigration.test.ts`, `imagingLifecycleFacade.test.ts` additions), and docs.

- **Did #344 touch security-incident runtime code?** No. `grep` for `securityIncident|SecurityIncident|security_incident` across `server/src/services/imaging/public.ts` and `server/src/services/privacy/*` — zero matches.
- **Did #344 touch security-incident tests?** No. `git log --oneline -- server/src/tests/securityIncident.test.ts` shows no commit newer than `a952c43` (F0-009-S1, pre-existing) / `368bcc8` (original KVKK-CRIT-003 foundation) — none of PR #344's five commits (`92f77f4`, `560acdd`, `ea2d0c0`, `39364f1`, `7f3157e`) appear.
- **Did #344 alter shared DB/runtime helpers used by the failing test?** No. `server/package.json`'s only diff is (a) one new script (`test:privacy-imaging-lifecycle-migration`) added to the unrelated `server:test:disposable-db` aggregate, and (b) that same script appended to the same aggregate's chain — the `server:test:legacy-db-required` aggregate (which contains `test:security-incidents`) is byte-for-byte unchanged by this PR.
- **Did #344 alter transaction timing or cleanup infrastructure relevant to it?** No. `securityDetectionRules.ts`, `securityIncidentService.ts`, `securitySignalService.ts`, and the disposable-Postgres orchestrator (`scripts/test-runtime/**`) are untouched by PR #344.

**Conclusion: PR #344 has zero dependency-graph overlap with the failing test or its runtime path. The failure is not a regression introduced by PR #344.**

## 2. CodeGraph / dependency-edge scope

Inspected narrowly (`codegraph_explore`, scoped to the failing suite and its direct runtime dependencies only — no full-repo scan):

- `server/src/tests/securityIncident.test.ts` (failing suite, test 22 at the time of investigation — line numbers shifted slightly after the fix, see §6)
- `server/src/services/security/securityDetectionRules.ts` — `evaluateCrossTenantDenialSignal` (Rule 2, cross-tenant probing detector) and the shared `safely()` fire-and-forget wrapper used by all seven `evaluate*Signal` exports
- `server/src/services/security/securityIncidentService.ts` — `upsertIncidentFromSignal` (the multi-statement transaction: `findUnique` → `pg_advisory_xact_lock` → `findUnique` → `upsert` → conditional activity `create`)
- `server/src/services/security/securitySignalService.ts` — `recordSecuritySignal` (raw-evidence INSERT) and `countSignalsInWindow` (windowed COUNT)

## 3. Reproduction

Disposable PostgreSQL provisioned locally (`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`, the same digest-pinned `postgres:16-alpine` image the CI orchestrator uses), 72/72 migrations applied via `npx prisma migrate deploy`.

Command: `cd server && npm run test:security-incidents` (as instructed — a focused per-test selector is not supported by this repo's test runner, so the full suite is run each time, matching CI's own invocation).

| Run | Condition | Result | Duration | Failure signature |
|---|---|---|---|---|
| 1–7 | Baseline (idle DB), then DB container throttled to `--cpus=0.15 --memory=256m` | 0/7 failures — 55 passed, 0 failed every run | 5–26s | none |
| 8 | Artificial 250ms delay injected into `safely()` before each fire-and-forget rule body (test-only env var `NMTEST_ARTIFICIAL_SIGNAL_DELAY_MS`, removed before the real fix) | **4 failures**: tests 20, 22, 24, 25 (every test whose fixed `sleep()` window was ≤ 200ms) | — | test 22: `assert.ok(singleResourceIncident)` on `null` — **exact match to the CI-reported `null == true` signature** |
| 9–11 (post-fix) | Same 250ms artificial delay, `flushPendingSecurityDetectionWork()` in place of `sleep()` | 0/3 failures — 55 passed, 0 failed every run | 5–7s | none |
| 12–14 (post-fix, no artificial delay) | Normal conditions | 0/3 failures — 55 passed, 0 failed every run | 5–6s | none |

Local reproduction under normal/lightly-throttled conditions never reproduced the CI failure naturally (0/7) — consistent with a load-dependent race rather than a deterministic logic bug. Injecting an artificial per-rule delay reproduced the **exact** reported assertion on demand, every time, isolating the mechanism precisely.

## 4. Root cause

`evaluateCrossTenantDenialSignal` (and its six sibling `evaluate*Signal` rule functions) are deliberately **fire-and-forget**: `evaluateCrossTenantDenialSignal(): void { void safely(async () => { ... }); }` — required so the caller (the shared clinic/organization scope-rejection path in `clinicAccess.ts`/`clinicScope.ts`) never blocks on detection-rule work. This non-blocking contract is itself regression-tested (test 21: `evaluateAuthLoginFailureSignal returns synchronously ... elapsed < 50ms`) and is preserved unmodified by this fix.

The background work behind that `void` return is genuinely multi-round-trip: `recordSecuritySignal` (1 INSERT) → `countSignalsInWindow` (1 COUNT) → optionally a `distinct` resource `findMany` → `upsertIncidentFromSignal`'s own transaction (`findUnique` → `pg_advisory_xact_lock` → `findUnique` → `upsert` → optional activity `create`, ~4–5 round trips). Nine places in `securityIncident.test.ts` observed this background work by calling the fire-and-forget function(s) and then `await sleep(150)` or `await sleep(200)` before querying Postgres for the resulting row — a **fixed guess**, not a durable-completion barrier. Whenever total round-trip latency (Docker/Postgres/Node scheduling under a busy CI runner) exceeded that guessed window, the test's read-back ran before the incident row existed, and `assert.ok(...)` failed on `null` — exactly the reported `null == true`.

Eight of the nine `sleep()` call sites in the file shared this identical pattern (tests 20, 22, 23, 24, 25); the ninth (`sleep(5)` in the dedup/concurrency section) is unrelated — it separates two directly-`await`ed, already-synchronous `upsertIncidentFromSignal` calls by wall-clock time to prove `lastDetectedAt` advances, not a fire-and-forget race.

No defect was found in the threshold/escalation/dedup logic itself: severity computation (`isMultiResourceProbing ? 'high' : 'medium'`), the advisory-lock-guarded upsert, and tenant scoping all behaved correctly in every reproduction run once given enough time to complete — the bug is exclusively in how the test observes an intentionally-asynchronous side effect, not in the side effect itself.

## 5. Fix

**File:** `server/src/services/security/securityDetectionRules.ts` (+22/-4 lines). The shared `safely()` wrapper now tracks its own in-flight promise in a module-level `Set`, and a new export awaits durable completion of everything currently tracked:

```ts
const pendingDetectionWork = new Set<Promise<void>>();

async function safely(fn: () => Promise<void>): Promise<void> {
  const work = fn().catch((err) => { /* unchanged error log */ });
  pendingDetectionWork.add(work);
  try {
    await work;
  } finally {
    pendingDetectionWork.delete(work);
  }
}

export async function flushPendingSecurityDetectionWork(): Promise<void> {
  while (pendingDetectionWork.size > 0) {
    await Promise.allSettled(Array.from(pendingDetectionWork));
  }
}
```

No `evaluate*Signal` export's body, signature, or call site changed — `safely()`'s internal tracking is invisible to every production caller, which still gets an immediate, synchronous `void` return (verified: test 21 still passes, including under the adversarial 250ms delay). This is bookkeeping only (`Set.add`/`Set.delete` around an already-existing `await`), not a behavior change on the production path.

**File:** `server/src/tests/securityIncident.test.ts` (+9/-8 lines). The eight racy `await sleep(150|200)` call sites (tests 20, 22, 23, 24, 25) now call `await flushPendingSecurityDetectionWork()` instead — a real completion barrier instead of a guessed delay. The unrelated `sleep(5)` call (dedup/concurrency section) is untouched. No assertion was weakened, relaxed, or removed.

This directly follows the "fix determinism at the real boundary — await durable completion" guidance for test flakes: the boundary is "has the fire-and-forget detection-rule work actually finished," and it is now awaited exactly, not approximated.

## 6. Validation

```
cd server && npm run typecheck
  -> clean, 0 errors (npx prisma generate && tsc --noEmit)

cd server && npm run test:security-incidents   (against disposable PostgreSQL 16, 72/72 migrations applied)
  -> 55 passed, 0 failed — repeated 6 times post-fix (3 under normal conditions, 3 under an
     adversarial 250ms artificial per-rule delay that deterministically broke the pre-fix code
     4/4 times) — 0 failures in all 6 runs

git diff --check
  -> clean, exit 0
```

`npm run test:runtime:postgres-compat -- --summary-file=postgres-compat-run-summary.json` (the exact command CI Layer 5 backend runs, `server:test:legacy-db-required`): provisioned disposable PostgreSQL successfully, 72/72 migrations applied, ran the 23-script `&&`-chained aggregate. The chain reached **116 passed** before aborting with **1 failed** in `test:clinic-bulk-export` — `"status DTO never serializes sensitive fields"` (`server/src/tests/clinicBulkExport.test.ts:382-389`), an exact-byte source-text match (`source.indexOf('res.json({\n      jobId: row.id,')`) against `server/src/routes/clinicBulkExport.ts`. This file is checked out with CRLF line endings on this Windows worktree (`git config core.autocrlf` = `true`, confirmed via `file server/src/routes/clinicBulkExport.ts` reporting `CRLF line terminators`), so the literal `\n`-embedded search string in the test never matches the on-disk `\r\n` bytes — a Windows-local-checkout line-ending artifact, unrelated to any code change, not present in `git diff` (this task's diff touches only the two files listed in §5), not reachable from PR #344's diff, and not expected to reproduce on the Linux (`ubuntu-latest`) CI runners this repository's workflows actually run on. This aborted the `&&` chain **before** it reached `test:security-incidents` later in the same aggregate, so the full-chain run could not itself exercise the fixed test. This finding is out of scope for this task (a different domain — clinic bulk export — with no dependency-graph edge to security-incident detection) and was not modified.

`npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (`server:test:disposable-db` — does not include `test:security-incidents` or `test:clinic-bulk-export`, which both live only in `server:test:legacy-db-required`): **full pass** — 19-script chain, `test.code: 0`, `cleanup.success: true`, `outcome.exitCode: 0` (`postgres-run-summary.json` at repo root, `runId 20260809T131649Z-b9b6cece-22888`). General regression safety net for this task's runtime-code change — `securityDetectionRules.ts` has no callers or test coverage inside this specific aggregate (its only caller-facing consumers, `clinicAccess.ts`/`clinicScope.ts`/`auth.ts`/`routes/platformAdmin.ts`/`clinicBulkExportPackage.ts`/`routes/clinicBulkExport.ts`, run under other aggregates), included per the task's mandated validation command list.

**Primary evidence for the fixed test itself is the direct, repeated `npm run test:security-incidents` runs above** (§3, §6) — run in isolation exactly as CI's `server:test:legacy-db-required` chain would run this specific script, both under normal conditions and under an adversarial delay that reliably reproduced the original CI failure signature pre-fix and did not reproduce it post-fix.

## 7. Tenant/security impact

None. This is a test-determinism fix plus additive, test-only-consumed bookkeeping in the shared `safely()` wrapper. Preserved, unmodified:

- **Tenant isolation** — no predicate in `evaluateCrossTenantDenialSignal`, `upsertIncidentFromSignal`, or `countSignalsInWindow` was touched.
- **Incident deduplication** — `incidentKey` uniqueness, the advisory-lock-guarded upsert, and `occurrenceCount` increment logic are untouched.
- **Incident severity escalation** — `isMultiResourceProbing ? 'high' : 'medium'` and `escalateSeverityAtomic` are untouched.
- **Non-blocking caller behavior** — every `evaluate*Signal` export still returns synchronously; regression-proven by test 21, which still passes, including under an adversarial delay applied while diagnosing this issue.
- **Audit/activity semantics** — `securityIncidentActivity` creation logic is untouched.
- **No raw tenant identifiers/PII leakage** — no new logging, metadata, or storage was added; `pendingDetectionWork` holds only `Promise<void>` references, never signal/incident data.

## 8. Files changed

- `server/src/services/security/securityDetectionRules.ts` — `safely()` now tracks its own promise; new export `flushPendingSecurityDetectionWork()`.
- `server/src/tests/securityIncident.test.ts` — 8 of 9 `sleep()` call sites (tests 20, 22, 23, 24, 25) replaced with `await flushPendingSecurityDetectionWork()`; import added.
- `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md` — new entry for this task.
- This document (new).

No schema/migration file. No route file. No production caller of any `evaluate*Signal` function touched.

## 9. Rollback

Single, self-contained commit on `fix/f2-stage3-postmerge-securityincident-ci`. `git revert <commit-sha>` restores the prior fixed-`sleep()`-based test and the un-tracked `safely()` implementation exactly — no schema/migration/route file is touched by the revert.

## 10. Lifecycle status

- `AGENT_COMPLETED`: TRUE
- `TESTS_PASSED`: TRUE — `test:security-incidents` 55/55, repeated 6× post-fix including 3× under an adversarial delay that deterministically broke the pre-fix code; `typecheck` clean; `git diff --check` clean
- `PR_OPENED`: see PR link recorded in `CURRENT_PHASE.md` / `NORAMEDI_MASTER_TRACKER.md` for this task
- `MERGED`: FALSE
- `DEPLOYED`: FALSE
- `PRODUCTION_VERIFIED`: FALSE

**Exact next task:** program-owner review/merge decision for this PR; separately, the unrelated pre-existing `test:clinic-bulk-export` "status DTO never serializes sensitive fields" CRLF-checkout artifact observed in §6 is not a CI-blocking finding (Linux CI runners preserve LF) but is worth a follow-up `.gitattributes` hardening pass (`* text=auto eol=lf` for `server/src/**`) if Windows-local reproduction of `server:test:legacy-db-required` is expected to remain a supported workflow.

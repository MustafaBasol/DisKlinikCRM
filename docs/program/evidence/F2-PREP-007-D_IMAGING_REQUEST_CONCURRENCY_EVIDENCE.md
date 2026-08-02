# F2-PREP-007-D — ImagingRequest PATCH Concurrency Characterization (CT-32) — Evidence

**Phase:** F2 — Imaging Stage 0 characterization coverage.
**Parent contract:** [F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md) §10, §14 — `CT-32`, one of the 18 Stage-1-gating characterization tests, and the one added specifically to make `CR-03`/`BLK-02`/`FP-06` test-tracked rather than only narratively documented.
**Type:** TEST-ONLY. No application code, Prisma schema/migration, dependency, package.json, lockfile, workflow, or shared program-control-doc change is made by this task.
**Status:** `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

---

## 0. Baseline

```
git fetch origin main --quiet
git rev-parse origin/main -> 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
```

**Exact baseline SHA: `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`** — verified to match the task brief's required SHA exactly before any worktree/branch was created (per the task's "stop if it differs" instruction — it did not differ).

```
git worktree add "E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f2-prep-007-d-imaging-request-concurrency" -b test/f2-prep-007-d-imaging-request-concurrency 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
```

Fresh, isolated worktree; no sibling F2-PREP-007-* worktree was reused, read, merged, or rebased onto. No rebase, no force-push.

---

## 1. Inputs read

- `AGENTS.md` — MVP scope/security-rules context.
- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (full) and its companion `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` (`characterizationTestGate.newTestsAddedByThisConsolidation` → `CT-32` object, full) — the accepted CT-32 definition and the §10 blocker decision (`imagingRequestPatchConcurrency`: "Yes, pre-contract-exposure blocker... Not blocking for Stage 0 (characterization should capture the current clobber behavior)").
- `server/src/routes/imaging.ts` — `PATCH /api/imaging/requests/:id` (lines 487–527) and `PATCH /api/imaging/requests/:id/cancel` (lines 530–554) handlers, `findRequestInScope` (197–206), `requestInclude` (404–410), `auditImaging` (103–121), `validateClinicalLinks` (212+), `IMAGING_CLINICAL_ROLES` (68).
- `server/src/services/imaging/imagingRequestTransitions.ts` (full, 47 lines) — `ALLOWED_REQUEST_TRANSITIONS`, `TERMINAL_STATUSES`, `validateRequestTransition`. **Not modified.**
- `server/src/middleware/auth.ts` — `authenticate`, `generateToken`, JWT/Bearer-fallback behavior.
- `server/src/utils/authFallback.ts` — `CLINIC_BEARER_FALLBACK_ENABLED` env-var gate.
- `server/src/schemas/index.ts` — `IMAGING_REQUEST_STATUSES`, `imagingRequestUpdateSchema`.
- `server/prisma/schema.prisma` — `ImagingRequest` model (confirms no `version`/`lockVersion`/optimistic-lock column exists today).
- Existing disposable-Postgres pattern: `server/src/tests/dbVerification/dbVerificationHarness.ts` (fixture builders reused as-is: `createClinicFixtureSet`, `createStaffUser`, `createTestPatient`, `cleanupAllFixtures`), `server/src/tests/retentionManualRunAudit.test.ts` (Bearer-fallback-env technique, `Promise.all` real-Postgres race precedent), `server/src/tests/dbVerification/inventoryUnitConversionConcurrency.test.ts` (real-Postgres concurrency precedent, and precedent for a real-DB concurrency test not being wired into any CI aggregate).
- Existing real-HTTP pattern (no real DB): `server/src/tests/httpRequestLogPrivacy.test.ts` (`app.listen(0)` + `node:http` — confirmed no `supertest` anywhere in this repo).
- `scripts/test-runtime/orchestrator.ts` and `scripts/test-runtime/lib/postgres.ts` — the F1-003-P2A disposable-Postgres provisioning contract (digest-pinned `postgres:16-alpine` image, `-p 127.0.0.1::5432` ephemeral host-port mapping, `pg_isready` bounded readiness wait) — **mirrored manually** for this task's own validation run (see §3), not invoked as a script, since wiring this test into the orchestrator's `server:test:disposable-db` aggregate would require a `server/package.json` edit, out of scope per this task's explicit constraints.

**Source-scope discipline:** targeted reads only, no broad re-scan of `server/src/routes/imaging.ts` or the transition service beyond the PATCH/cancel handlers and their direct dependencies (`findRequestInScope`, `validateClinicalLinks`, `auditImaging`, `requestInclude`). No new source root touched.

---

## 2. What CT-32 requires (verbatim from the merged contract JSON)

```json
{
  "id": "CT-32",
  "area": "retry-failure / concurrency",
  "contractTarget": "UpdateImagingRequest / CancelImagingRequest (IMG-CMD-05/06)",
  "testLevel": "db-integration",
  "infrastructure": "disposable Postgres, two concurrent requests against the same running server instance",
  "tenantFixtures": "single clinic, single ImagingRequest row seeded in 'requested' status",
  "expectedAssertions": [
    "two concurrent PATCH requests ... transitioning to different terminal-adjacent statuses, do not both succeed silently - the losing request's write is either rejected or the final state is deterministic, not a last-write-wins clobber of an intervening status change",
    "characterizes CURRENT behavior (today: both can succeed, clobbering each other, per FP-06) - this test is written to first PROVE the current gap exists, then re-run and must be updated (not deleted) once CR-03's guard is implemented"
  ],
  "cleanupMethod": "disposable Postgres schema/container teardown per the existing F1-003-P2A pattern",
  "status": "blocking",
  "blockedStageGate": "Stage 1 (must exist and characterize current behavior before the facade is built)"
}
```

---

## 3. Current-behavior root cause (confirmed by source read, not assumed)

Both PATCH handlers read the row via a plain `findFirst` (`findRequestInScope`, `imaging.ts:197-206`), validate the requested transition against that **in-memory snapshot** (`validateRequestTransition`, sync, no DB re-check), then call `prisma.imagingRequest.update({ where: { id }, data })` — the `where` clause is `{ id }` only. No `SELECT ... FOR UPDATE`, no `$transaction`, no `WHERE status = <snapshot>` guard, no version/`updatedAt`-based optimistic-lock column on the `ImagingRequest` model (confirmed against `schema.prisma`). Two requests that both read `status: 'requested'` before either commits its write both pass `validateRequestTransition('requested', X)` (both `'scheduled'` and `'cancelled'` are allowed from `'requested'` per `ALLOWED_REQUEST_TRANSITIONS`), and both writes land — last write wins, silently, no re-validation, no 409.

For contrast, this codebase already applies `SELECT ... FOR UPDATE` inside a `$transaction` for the *device*-delete race in this same file (`imaging.ts`, confirmed present by the existing `imaging.test.ts` source-regression suite) — i.e. this pattern is known and used elsewhere in Imaging, just not yet applied to `ImagingRequest` PATCH/cancel. This test does not add it; that is Stage 2 work per the contract.

---

## 4. Test design

**File:** `server/src/tests/imagingRequestConcurrencyCharacterization.test.ts`.

**Synchronization design:** No sleep, no artificial delay, no barrier/hook injected into production code (all forbidden by this task's constraints, and no injectable seam exists in the route handlers without touching them). A real, minimally-mounted Express app (`express.json()` → `authenticate` → the real, unmodified `imagingRoutes` router — mirrors `index.ts`'s own mounting order for this router) is bound to a real TCP port via `app.listen(0)`, exactly as `httpRequestLogPrivacy.test.ts` and `externalCalendarWebhookRouteE2E.test.ts` already do (no `supertest` dependency exists in this repo). Two real HTTP requests are issued via raw `node:http` against that port and raced with `Promise.all` — the **only** synchronization primitive used; genuine overlap comes from real network + real disposable-Postgres round-trip timing, not from forcing it.

Each round:
1. Seed one fresh `ImagingRequest` row, `status: 'requested'`, via the real `prisma` client (real disposable Postgres, not mocked).
2. Fire concurrently:
   - `PATCH /api/imaging/requests/:id` with body `{ status: 'scheduled' }`
   - `PATCH /api/imaging/requests/:id/cancel` (no body)
3. Re-read the row after both HTTP responses land, to get the actual final persisted `status`.
4. Classify the round: `BOTH_SUCCESS_SILENT_CLOBBER` (200/200), `SEQUENTIAL_SAFE_REJECTION` (200/409, either order — a non-overlapping ordering, not a guard), or `UNEXPECTED` (anything else — asserted to never occur).

Both target statuses (`scheduled`, `cancelled`) are independently reachable from `requested`, so a transition-*validity* rejection can never be the reason either individual request fails — only the race window decides the classification. This makes the per-round assertions and the aggregate assertion (§5) a genuine characterization of the concurrency gap, not a tautology.

**Fixtures:** one clinic/patient/staff-user set (via the existing `dbVerificationHarness.ts` builders, reused unmodified), created once; one fresh `ImagingRequest` row per round.

**Cleanup (deterministic `finally`):** `prisma.imagingRequest.deleteMany` (by `clinicId` — not covered by `cleanupAllFixtures`, whose header predates the `ImagingRequest` model) → `prisma.auditLog.deleteMany` (by `organizationId` — no FK, but avoids silent growth across repeated local runs) → `cleanupAllFixtures()` (existing harness function: deletes clinics/patients/users/organizations by tracked org id, FK-safe order). Runs even if an assertion inside the round loop throws, since it's in the `try/finally` wrapping `withServer(...)`.

**Round count:** `DEFAULT_ROUND_COUNT = 30` when `CT32_ROUNDS` is unset or empty/whitespace-only; otherwise `CT32_ROUNDS` must parse as a positive integer (`^[1-9]\d*$`) or `resolveRoundCount()` throws before any fixture/DB work starts — a deterministic configuration error, not a silent fallback (see §11 for the fix history and re-validation). An env-var read inside the test file itself, not a `package.json`/config change.

---

## 5. Validation performed — exact commands, counts, and results

### 5.1 Disposable PostgreSQL provisioning (manual, F1-003-P2A-equivalent — see §1 for why not orchestrator-invoked)

```
docker run -d --name pg-f2prep007d -p 127.0.0.1::5432 \
  -e POSTGRES_DB=f2prep007d -e POSTGRES_USER=f2prep007d -e POSTGRES_PASSWORD=f2prep007dpass \
  postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
  -> container pg-f2prep007d, host port 61494 (unique, ephemeral, dynamically assigned by Docker)

docker exec pg-f2prep007d pg_isready -U f2prep007d -d f2prep007d
  -> "accepting connections" (bounded poll loop, no fixed sleep)

DATABASE_URL="postgresql://f2prep007d:f2prep007dpass@127.0.0.1:61494/f2prep007d?schema=public" \
  npx prisma migrate deploy
  -> "All migrations have been successfully applied." (all repo migrations, unmodified)

npx prisma generate
  -> Prisma Client generated successfully, v7.8.0
```

Image: `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` — the same digest-pinned `postgres:16-alpine` this repo's own `scripts/test-runtime/lib/postgres.ts` uses for every other disposable-Postgres run (`POSTGRES_IMAGE_DIGEST`). Database/user/password names and host port are unique to this validation run.

### 5.2 CT-32 — two independent full runs (fresh Node process each), 30 rounds each

Original Stage-0 validation, performed against the version of this file predating the `CT32_ROUNDS`-parsing review fix (152 assertions/run — the review fix in §11 adds one more aggregate assertion, so a from-scratch run today reports 153). The underlying concurrency observations below (100% `BOTH_SUCCESS_SILENT_CLOBBER`, `scheduled` wins every round) are unaffected by that fix and were independently re-confirmed post-fix in §11.

**Run 1:**
```
DATABASE_URL=postgresql://f2prep007d:...@127.0.0.1:61494/f2prep007d?schema=public \
  npx tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts
```
```
Rounds run: 30
BOTH_SUCCESS_SILENT_CLOBBER (the CR-03/BLK-02/FP-06 gap): 30/30
  -> PATCH (scheduled) won: 30, cancel (cancelled) won: 0
SEQUENTIAL_SAFE_REJECTION (no overlap this round): 0/30
UNEXPECTED: 0/30
CT-32 total: 152  ✓ 152  ✗ 0
```

**Run 2 (independent process, same disposable database, fresh fixtures):**
```
Rounds run: 30
BOTH_SUCCESS_SILENT_CLOBBER (the CR-03/BLK-02/FP-06 gap): 30/30
  -> PATCH (scheduled) won: 30, cancel (cancelled) won: 0
SEQUENTIAL_SAFE_REJECTION (no overlap this round): 0/30
UNEXPECTED: 0/30
CT-32 total: 152  ✓ 152  ✗ 0
```

**Combined: 60/60 rounds across two independent runs → 100% `BOTH_SUCCESS_SILENT_CLOBBER`, 0% `SEQUENTIAL_SAFE_REJECTION`, 0% `UNEXPECTED`.**

**Per-round outcome shape (identical in both runs, every round):**
- `PATCH /api/imaging/requests/:id` → HTTP `200`, body `status: "scheduled"`.
- `PATCH /api/imaging/requests/:id/cancel` → HTTP `200`, body `status: "cancelled"`.
- Final persisted DB row: `status: "scheduled"` — i.e. the PATCH endpoint's write committed after the cancel endpoint's write in **every single round observed** (60/60). This is a real, timing-driven outcome (the PATCH handler does one additional DB round-trip — `validateClinicalLinks` → `findPatientInClinic` — that the cancel handler skips entirely, so its own `UPDATE` reliably reaches Postgres after the cancel handler's already-committed `UPDATE`), not a hardcoded expectation in the test. The test does not assert *which* request wins (that is genuinely a function of relative handler cost, not something this test should pin as a contract); it asserts the *shape* of the outcome (both 200, exactly one final state, the loser's response silently stale).
- **Final state distribution across all 60 rounds: `scheduled` 60/60, `cancelled` 0/60.**

**Determinism classification:** the *winner* (which request's write survives) is a deterministic function of the two handlers' relative I/O cost in this codebase today, not a coin flip — it reproduced identically across two independent process runs. The *existence of the clobber itself* (both silently 200, only one persists) is unconditionally deterministic: given that both target statuses are reachable from `requested` and there is no locking of any kind, any genuine overlap of the two reads always produces this shape, and the fixture/harness design (fresh row, no artificial delay favoring one race outcome) makes that overlap the observed outcome on 100% of the 60 rounds run. No round produced `SEQUENTIAL_SAFE_REJECTION` (i.e. this harness never happened to serialize the two requests far enough apart to hit the safe non-overlapping ordering) or `UNEXPECTED`.

One benign observation, not a defect: a single Node `pg` deprecation warning ("Calling client.query() when the client is already executing a query is deprecated") appeared once near the very first round of each run and never affected any assertion, status code, or the final persisted value in any round — noted here for transparency, not investigated further as it is outside this task's scope (test-only, no production code change).

### 5.3 Cleanup proof (deterministic, verified by direct query after both runs)

```
imagingRequest: 0
organization:   1  <- pre-existing "Default Organization" migration seed row (id 00000000-org0-...), unrelated to this test's fixtures
clinic:         0
patient:        0
user:           0
auditLog:       0
```

Zero rows created by either CT-32 run remain. The single surviving `organization` row is a baseline seed row inserted by `prisma migrate deploy` itself (confirmed by its fixed `00000000-org0-...` id and `"Default Organization"`/`"default"` name/slug, unrelated to this test's randomly-suffixed fixture names) — not a cleanup leak.

```
docker rm -f pg-f2prep007d
  -> container removed
```

Validation container fully torn down; no disposable resource left running.

### 5.4 Existing ImagingRequest/Imaging suites — unaffected

```
npm run test:imaging                    -> 103 passed, 0 failed
npm run test:imaging-bridge-pairing     -> 50 passed, 0 failed
npm run test:imaging-bridge-onboarding  -> 14 passed, 0 failed
npm run test:imaging-bridge-update      -> 44 passed, 0 failed
```
211/211 existing Imaging tests still pass unmodified — this task changed zero application/service/schema code.

### 5.5 Backend typecheck

```
npm run typecheck   (npx prisma generate && tsc --noEmit)
-> Prisma Client generated successfully; tsc --noEmit produced no errors/output.
```

### 5.6 `git diff --check`

```
git diff --check
-> (clean — no whitespace errors)
```

### 5.7 Changed-file scope verification

```
git status --porcelain
?? server/src/tests/imagingRequestConcurrencyCharacterization.test.ts
?? docs/program/evidence/F2-PREP-007-D_IMAGING_REQUEST_CONCURRENCY_EVIDENCE.md
```

Exactly the two files this task was authorized to create. No `server/src/routes/`, `server/src/services/`, `server/prisma/`, `package.json`, `package-lock.json`, `.github/workflows/`, or other program-control doc (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, etc.) is touched — final consolidation owns those, per this task's brief.

---

## 6. Constraint compliance

- **No locks, versions, `updatedAt` guards, transactions, or retries added to production code.** Confirmed — `imaging.ts` and `imagingRequestTransitions.ts` are byte-identical to baseline (not in the changed-file list above).
- **No Prisma schema/migration.** Confirmed — `server/prisma/schema.prisma` and `server/prisma/migrations/` untouched.
- **No dependency/package.json/lockfile/workflow/shared-program-doc change.** Confirmed — `server/package.json` was read-only (to find the existing `test:imaging*` script names) and never edited; this new test is intentionally **not** wired into `server:test:disposable-db` or any CI layer, matching the existing precedent of `inventoryUnitConversionConcurrency.test.ts`, which is also unwired.
- **Unique disposable DB/container identifiers.** `pg-f2prep007d` / db+user `f2prep007d` / dynamically-assigned host port 61494 — all unique to this validation run, never reused from another worktree's leftover container (a stale, unrelated `f1003b2r1-repro-pg` container was observed running on the host at task start and was left untouched, not reused).
- **Deterministic `finally` cleanup.** Test-internal cleanup verified in §5.3; validation-infra container removal verified in §5.3.
- **Test-only.** Only the two files listed in §5.7 are created; nothing else is modified.

---

## 7. CR-03 classification (recorded, not resolved)

Per the merged contract (§10): `CR-03`/`BLK-02`/`FP-06` — **"Yes, pre-contract-exposure blocker."** Blocking before `UpdateImagingRequest`/`CancelImagingRequest` are exposed as commands to any caller beyond `imaging.ts` itself (Stage 1's facade). **Not** a Stage 0 blocker — Stage 0's job (this task) is exactly to characterize the current clobber behavior, which it now does with a reproducible, passing, 60/60-consistent test. Must resolve no later than Stage 2 (duplicate-ingest convergence + `ImagingRequest` PATCH concurrency hardening, per the contract's expand-migrate-contract sequence §15).

This task **confirms** (does not merely repeat) the contract's own prediction: "today: both can succeed, clobbering each other, per FP-06" is exactly what was observed, 60/60 rounds, two independent runs, zero deviation.

**Forward instruction embedded in the test itself:** when CR-03's guard is implemented (Stage 2), the aggregate assertion `clobberRounds.length === outcomes.length` will start failing (some/all rounds will shift to `SEQUENTIAL_SAFE_REJECTION` or a new guarded-deterministic shape) — the test's own failure message explicitly instructs updating (not deleting) this file and updating `blockerDecisions.imagingRequestPatchConcurrency` in the F2-PREP-006-E contract JSON at that time.

---

## 8. Migration / rollback

- **Migration:** none. No schema, no data migration, no seed change.
- **Rollback:** revert the single test-only commit (and this evidence doc); zero production risk, zero behavior change to any running system — the test file is never imported by application code, never runs in any currently-wired CI aggregate, and asserts nothing about production data.

---

## 9. Status separation

- **Agent completed:** yes.
- **Validations passed:** yes — CT-32 original validation (2 independent runs, 152/152 assertions each) plus the §11 review-fix re-validation (default rounds 153/153, `CT32_ROUNDS=3` 18/18, invalid-value fail-fast confirmed), 211/211 existing Imaging suite tests, `tsc --noEmit` clean, `git diff --check` clean, changed-file scope confirmed to exactly the authorized files.
- **PR opened:** yes, against `main`, test-only. See §10 for exact head SHA and PR URL.
- **Merged:** no.
- **Deployed:** no.
- **Production verified:** no (not applicable — test-only, no production code path touched).
- **CT-32 status:** implemented and passing against **current** (unfixed) behavior — this is the correct, contract-required state for Stage 0. It is expected to require revision (not deletion) once Stage 2 lands CR-03's guard.
- **CR-03/BLK-02/FP-06:** unchanged, still `OPEN`, now with a passing, reproducible, checked-in characterization test as evidence (previously only narratively documented).
- **F2-PREP-006-E contract:** unchanged by this task; not re-opened, not re-approved. This task operates entirely within its existing, already-accepted CT-32 definition.
- **Stage 1 (additive facade) gating:** CT-32 is one of the 18 Stage-1-gating tests (`characterizationTestGate.mandatoryBeforeRefactor`); this task closes CT-32's own gate item. The other 17 gating tests are outside this task's scope.

---

## 10. PR / head SHA

Branch: `test/f2-prep-007-d-imaging-request-concurrency`, based on `origin/main` at `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`.

- **PR:** https://github.com/MustafaBasol/DisKlinikCRM/pull/296 (open, not merged).
- **Head commit introducing CT-32 (test + this evidence doc):** `b4d386d535567259ea763de0d4d6221307a62842`.
- **Head commit for the §11 CT32_ROUNDS-parsing review fix:** see §11.

---

## 11. Follow-up — `CT32_ROUNDS` parsing correction (review response)

**Trigger:** Copilot inline review comment on PR #296 (`server/src/tests/imagingRequestConcurrencyCharacterization.test.ts:264`, comment id `3699990558`): `ROUND_COUNT = Number(process.env.CT32_ROUNDS ?? 30)` turns an unparsable value (e.g. `"abc"`) into `NaN`. Since `round <= NaN` is always `false`, the round loop would execute **zero** times, `outcomes` would stay empty, and every aggregate assertion (`0 === 0`, `[].length === 0`) would pass **vacuously** — a misconfigured `CT32_ROUNDS` would report a green run while characterizing nothing.

**Fix (test-only, `server/src/tests/imagingRequestConcurrencyCharacterization.test.ts`):**
- Replaced the bare `Number(...)` coercion with `resolveRoundCount()`: unset or empty/whitespace-only `CT32_ROUNDS` → `DEFAULT_ROUND_COUNT` (30, unchanged default); any other value must match `^[1-9]\d*$` (positive integer, no zero, no negative sign, no decimal) or the function throws a descriptive `Error` — a deterministic configuration error, not a silent fallback to 30, per this task's explicit "prefer fail-fast" instruction.
- `resolveRoundCount()` is called first thing inside `main()`, before any clinic/patient/user fixture is created, so an invalid value fails before any DB write — nothing to clean up.
- The resolved count is logged once (`Effective round count: N`) — a bare integer, never a token, URL, or DB credential.
- Added a new aggregate assertion, `aggregate: at least one round actually executed`, asserting `outcomes.length >= 1` — a second, independent guard against the same vacuous-pass failure mode surviving any future change to the loop/config logic.
- No production code, concurrency semantics, schema, migration, package file, workflow, shared helper, or program-control document was touched — only this one test file and this evidence doc.

**Re-validation (fresh disposable Postgres, digest-pinned `postgres:16-alpine`, same image as §5.1):**

```
CT32_ROUNDS unset (default):
  Effective round count: 30
  Rounds run: 30
  BOTH_SUCCESS_SILENT_CLOBBER: 30/30 (PATCH/scheduled won 30, cancel/cancelled won 0)
  SEQUENTIAL_SAFE_REJECTION: 0/30
  UNEXPECTED: 0/30
  CT-32 total: 153  ✓ 153  ✗ 0   (152 original + 1 new "at least one round executed" assertion)

CT32_ROUNDS=3:
  Effective round count: 3
  Rounds run: 3
  BOTH_SUCCESS_SILENT_CLOBBER: 3/3 (PATCH/scheduled won 3, cancel/cancelled won 0)
  SEQUENTIAL_SAFE_REJECTION: 0/3
  UNEXPECTED: 0/3
  CT-32 total: 18  ✓ 18  ✗ 0

CT32_ROUNDS=abc:
  [CT-32] fatal error: Error: Invalid CT32_ROUNDS="abc": must be a positive integer (e.g. "30"),
  or unset to use the default (30). Refusing to silently fall back, so a CI misconfiguration is
  never masked as a vacuously-passing 0-round run.
      at resolveRoundCount (.../imagingRequestConcurrencyCharacterization.test.ts:280:11)
      at main (.../imagingRequestConcurrencyCharacterization.test.ts:294:22)
  process exit code: 1

Additional sweep (not in the task's minimum required set, run for extra confidence):
  CT32_ROUNDS=0     -> same fail-fast shape, exit 1
  CT32_ROUNDS=-5    -> same fail-fast shape, exit 1
  CT32_ROUNDS=3.5   -> same fail-fast shape, exit 1
  CT32_ROUNDS=NaN   -> same fail-fast shape, exit 1 (the literal string "NaN" is also rejected, not specially accepted)
  CT32_ROUNDS=" "   -> whitespace-only, treated as unset -> Effective round count: 30 (default)
```

**Cleanup proof (post-fix):** direct row-count query against the disposable database after all of the above runs (default, 3-round, and every invalid-value attempt, which never reach fixture creation):
```
imagingRequest: 0
organization:   1   <- pre-existing "Default Organization" migration seed row, unrelated to any test run
clinic:         0
patient:        0
user:           0
auditLog:       0
```
Identical to the original §5.3 result — zero residual rows from any run, valid or invalid-and-rejected. Validation container removed (`docker rm -f`) after the sweep.

**Regression suites (unaffected, re-run against the fixed file):**
```
npm run test:imaging                    -> 103 passed, 0 failed
npm run test:imaging-bridge-pairing     -> 50 passed, 0 failed
npm run test:imaging-bridge-onboarding  -> 14 passed, 0 failed
npm run test:imaging-bridge-update      -> 44 passed, 0 failed
```

**Typecheck / lint-adjacent:**
```
npm run typecheck   -> tsc --noEmit produced no errors/output.
git diff --check    -> clean.
git diff --name-only origin/main...HEAD -> exactly the two originally-authorized files (no new files, no scope creep).
```

**Review-thread resolution:** replied to Copilot review comment `3699990558` with a summary of this fix and marked the review thread resolved via the GitHub GraphQL `resolveReviewThread` mutation.

**New commit:** *(recorded after commit — see the delivery report for this turn for the exact SHA)*.

---

## 12. Next action

**Exact next task:** the next unclaimed item in the 18-test Stage-1-gating set (`CT-02,03,06,07,08,10,11,12,13,14,16,17,19,21,26,27,28` — `CT-32` now closed by this task), or F2-PREP-007's own consolidation once all 32 characterization tests exist, per the contract's Stage 0 gate. Not started, not authorized to start by this document. Runtime modularization (Stage 1+) remains explicitly not approved by this task or by the F2-PREP-006-E contract it operates within.

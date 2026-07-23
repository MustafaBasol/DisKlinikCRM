# TEST-DEBT-001-F1 — Public Booking Slot Consistency: Time-Deterministic Fix

**Phase:** F0 — Test Reliability
**Status:** Implemented, tested, reconciled against current `origin/main`, and committed for PR.
**Worktree:** `D:/Mustafa/Siteler/DisKlinikCRM-worktrees/public-booking-slot-consistency-time-fixture`
**Branch:** `fix/public-booking-slot-consistency-time-fixture`
**Base SHA (branch point):** `9e80571cf78a0e83e0f5219e09223011fddf1955` (`origin/main`, merge commit for PR #214 — "docs(program): DATA-INTEGRITY-001 R2 evidence")
**Reconciliation SHA (`origin/main` at PR-open time, 2026-07-23):** `c522d61a7ac14923048b0708e261ee2ef99b943d` (merge commit for PR #218 — "audit: pilot backup/restore coverage")
**Prior investigation:** `docs/program/evidence/TEST-DEBT-001_PUBLIC_BOOKING_SLOT_CONSISTENCY_REVIEW.md` (uncommitted, worktree `audit/public-booking-slot-consistency`)

### Reconciliation against current `origin/main`

Between the branch point (`9e80571`) and PR-open time (`c522d61`), `origin/main` advanced by 6 commits, all docs-only:

- `docs/architecture/AFFECTED_MODULE_CI_SHADOW_MODE_DESIGN.md`
- `docs/operations/pilot/PILOT_BACKUP_RESTORE_AND_FILE_COVERAGE_AUDIT.md`
- `docs/program/evidence/DATA-INTEGRITY-001_PRODUCTION_DEPLOYMENT_GATE.md`

`git diff --name-only HEAD origin/main` confirms neither `server/src/services/whatsappAvailability.ts` nor `server/src/tests/publicBookingSlotConsistency.test.ts` was touched by any of these commits. **No technical impact; no rebase required.** All test/typecheck results below were re-run fresh on this worktree (branch HEAD `9e80571`, which is an ancestor of current `origin/main`), not carried over from a stale prior run.

---

## 1. Original defect

`server/src/tests/publicBookingSlotConsistency.test.ts` hardcoded:

```ts
const DATE = '2026-07-20';
```

`buildAvailableSlots` (`server/src/services/whatsappAvailability.ts`) filters every candidate slot with `if (startTime > now)`, where `now` was always `new Date()` — the real, non-injectable wall clock. The test file was authored 2026-07-15, when `2026-07-20` was still 5 days in the future. By the time this task ran (real clock: 2026-07-23), `2026-07-20` had lapsed into the past, so every slot the mock fixtures generated for that date failed `startTime > now` unconditionally — `results` was `[]` for every scenario, regardless of AppointmentRequest/Appointment state. This made every "hidden" assertion pass vacuously and every "visible" assertion fail: 7 of 17 tests failed, with zero runtime defect involved (root cause and exoneration of `main` fully documented in the prior review; not repeated here).

## 2. Implementation

### 2a. Production source — narrow, additive, optional parameter

`server/src/services/whatsappAvailability.ts`:

```ts
export const buildAvailableSlots = async (
  prisma: PrismaClient,
  clinicId: string,
  appointmentTypeId: string | null | undefined,
  date: string,
  practitionerId?: string | null,
  referenceTime?: Date        // NEW — optional, 6th positional parameter
) => {
  ...
  const now = referenceTime ?? new Date();   // was: const now = new Date();
  ...
```

Nothing else in the function changed. The `startTime > now` comparison, the query/conflict logic, and every other line are byte-identical to `origin/main`.

### 2b. Why this shape

- **No global `Date` monkey-patch, no fake timers** — the repository's existing test files (`appointmentAvailabilityService.test.ts`, `appointmentRequestOverlapSafety.test.ts`, etc.) all use hand-rolled mock Prisma clients and plain `node:assert`, with no fake-timer library in use anywhere in `server/`. Introducing one here would be inconsistent with the codebase and out of scope.
- **No framework-wide clock abstraction** — a single optional parameter on the one function that needs it is narrower than any shared `Clock`/`TimeProvider` interface, and nothing else in the call graph needs mockable time.
- **No public API / response change** — `buildAvailableSlots` is an internal service function, not a route handler; its return shape is unchanged. `GET /api/public/booking/:clinicId/slots` (`publicBooking.ts:150`) calls it with 5 arguments today and continues to do so unchanged — TypeScript accepts the call as-is because the new parameter is optional and appended at the end.
- **Every existing call site needs no change.** Confirmed by grep across `server/src`: `publicBooking.ts:150`, `whatsappBookingFlow.ts:586`, `whatsapp.ts:3870`, `metaWhatsAppAiProcessor.ts:1697`, `instagramAiConversationProcessor.ts` (via the injected `buildAvailableSlots` dependency) all call with 5 positional arguments and are untouched by this change. `tsc --noEmit` over the full `server/` project (which type-checks all of these call sites) confirms this — see §5.

### 2c. Test file — inject a fixed reference instant instead of chasing the calendar

`server/src/tests/publicBookingSlotConsistency.test.ts`:

```ts
const DATE = '2026-07-20';                              // unchanged
const NOW = new Date(`${DATE}T00:00:00.000Z`);           // NEW — fixed reference instant, midnight UTC on DATE
```

All 11 existing `buildAvailableSlots(...)` calls that use the fixed `DATE` fixture now pass `NOW` as the 6th argument. `DATE` itself is **not** replaced with a different hardcoded value — the fixture is anchored to an explicit, injected instant instead, so it cannot go stale again regardless of how far the real calendar advances. This directly satisfies the task's constraint against "repeatedly replacing one hardcoded calendar date with another."

## 3. Production behavior — unchanged

- Every production caller (`publicBooking.ts`, `whatsappBookingFlow.ts`, `routes/whatsapp.ts`, `metaWhatsAppAiProcessor.ts`, `instagramAiConversationProcessor.ts`) omits the 6th argument and gets `new Date()` exactly as before — bit-for-bit the same runtime behavior as on `origin/main`.
- The `startTime > now` filter, the `checkAppointmentOverlap` / `checkAppointmentRequestConflict` calls, and every other line of `buildAvailableSlots` are unmodified.
- No schema change, no migration, no API response shape change, no new dependency.

## 4. Test results

### Before (baseline, `origin/main` @ `9e80571`, unmodified test file)

```
npx tsx src/tests/publicBookingSlotConsistency.test.ts
✗ 7 of 17 tests FAILED.
```

Exact 7 failures (identical to the prior review, confirmed by re-running on this fresh worktree before any change):

1. `rejected AppointmentRequest does NOT hide the slot`
2. `cancelled AppointmentRequest-blocking status list does not include cancelled (sanity)`
3. `cancelled Appointment does NOT hide the slot`
4. `adjacent non-overlapping slots remain visible (boundary...)`
5. `multi-practitioner: only the conflicting practitioner loses the slot, the other keeps it`
6. `no serviceId supplied → uses default duration, still generates slots`
7. `a slot that buildAvailableSlots showed as free can still be raced and rejected by assertSlotAvailable`

All seven failures were "expected slot visible" assertions, matching the prior review's classification exactly. No stop condition was triggered (current `main` was not already fixed; no genuine runtime defect found; failures matched the reviewed seven exactly).

### After (this fix)

```
npx tsx src/tests/publicBookingSlotConsistency.test.ts
✓ All 22 tests passed.
```

17 original assertions pass (all seven previously-failing tests now pass, for the correct reason — see §4a) plus 5 new tests:

- `slots after the injected reference time are listed`
- `slots before (or at) the injected reference time are excluded`
- `boundary: a slot starting exactly at the injected reference time is excluded, one millisecond earlier it is included`
- `with no referenceTime argument, a slot on a real future date is listed (default clock is live, not frozen)`
- `with no referenceTime argument, a slot on a real past date is excluded (default clock is live, not frozen)`

### 4a. Why the seven failures are eliminated for the correct reason

The seven tests fail (pre-fix) or pass (post-fix) purely because of the `NOW` reference-time injection — not because any assertion, mock, or production logic changed:

- The mocked DB fixtures (appointment/request timestamps, `svc-1` duration, availability windows) are byte-identical before and after.
- The `startTime > now` comparison in `whatsappAvailability.ts` is byte-identical before and after.
- Only the *source* of `now` changed for these specific calls: real wall clock (pre-fix, broken because `DATE` had lapsed) → injected `NOW` fixed to midnight UTC on `DATE` (post-fix, always valid because it's defined relative to `DATE`, not to the real calendar).

This is confirmed directly by the last two new tests (`with no referenceTime argument...`), which independently prove the production (no-injection) code path still filters by the real, live wall clock — i.e., the fix is additive test-clock control, not a change to the underlying comparison the seven failing tests exercise.

### 4b. Other required suites

| Suite | File | Result |
|---|---|---|
| `publicBookingSlotConsistency` | `src/tests/publicBookingSlotConsistency.test.ts` | ✓ All 22 tests passed |
| `publicBookingAvailability` | `src/tests/publicBookingAvailability.test.ts` | ✓ All 19 tests passed |
| `publicBookingSlotRequired` | `src/tests/publicBookingSlotRequired.test.ts` | ✓ All 17 tests passed |
| `appointmentAvailabilityService` | `src/tests/appointmentAvailabilityService.test.ts` | ✓ All 31 tests passed |
| `appointmentRequestOverlapSafety` | `src/tests/appointmentRequestOverlapSafety.test.ts` | ✓ 38 tests: 38 passed, 0 failed |

None of these suites required any changes — they were run unmodified as a regression check against the `whatsappAvailability.ts` signature change.

## 5. Backend typecheck

```
npm run typecheck   # npx prisma generate && tsc --noEmit
```

**Result: exit 0, zero errors.** This type-checks the entire `server/` TypeScript project, including every direct importer of `buildAvailableSlots` (`publicBooking.ts`, `whatsappBookingFlow.ts`, `routes/whatsapp.ts`, `metaWhatsAppAiProcessor.ts`, `instagramAiConversationProcessor.ts`), confirming the new optional 6th parameter does not break any existing 5-argument call site.

Per the task's scope rule, since no runtime logic in `whatsappAvailability.ts` changed beyond the optional reference-time plumbing (the `startTime > now` comparison and all query/conflict logic are unmodified), a targeted re-run of every direct importer's own test suite was not additionally required; the whole-project typecheck plus the five suites in §4b (which exercise `buildAvailableSlots` and its immediate call graph directly) provide the regression coverage for this narrow change.

## 6. Migration status

**None required, none performed.** No schema change, no Prisma migration file added or modified, no data migration. `server/package-lock.json` was incidentally touched by a routine `npm install` in this fresh worktree (a `^` range pin normalization on `@aws-sdk/lib-storage` unrelated to this fix) and was reverted via `git checkout -- server/package-lock.json` before finalizing — confirmed not part of the diff (see §8).

## 7. Rollback

Two files changed, both easily revertible independently or together:

```
git checkout origin/main -- server/src/services/whatsappAvailability.ts server/src/tests/publicBookingSlotConsistency.test.ts
```

Reverting `whatsappAvailability.ts` alone restores the pre-fix `const now = new Date();` (no consumers depend on the new parameter, so this is safe on its own). Reverting the test file alone would restore the stale-date failure mode (7 failures) — not recommended in isolation. No deployed/running system state, feature flag, or migration needs to be rolled back; this change has not been committed, merged, or deployed.

## 8. Tenant / security impact

**None.** Identical scope and conclusion as the prior investigation:

- `buildAvailableSlots`'s query logic, tenant scoping (`clinicId` filters), and conflict rules are byte-for-byte unchanged.
- The only change to production code is that `now` can optionally be supplied by a caller instead of always being computed internally — no caller in the current codebase does so, and the default (real wall clock) is preserved exactly.
- The test file changes touch only `src/tests/publicBookingSlotConsistency.test.ts`, a mocked, in-process unit test with no real database or HTTP layer involved.
- No KVKK/tenant-scope implications. No production access was performed at any point (worktree-isolated `npm install` / `npx prisma generate` / `npx tsx` only, against `origin/main`).

## 9. Commit / merge / deploy status

- **Committed** on `fix/public-booking-slot-consistency-time-fixture` with exactly three files: `server/src/services/whatsappAvailability.ts`, `server/src/tests/publicBookingSlotConsistency.test.ts`, and this evidence document.
- Commit message: `test(public-booking): make slot consistency time-deterministic`.
- **Pushed to origin; a PR against `main` was opened. The PR was not merged.**
- **No production access, no deployment, at any point.** All verification (`npm install`/`npx prisma generate`/`npx tsx`/`tsc --noEmit`) ran against `origin/main` in this isolated worktree only.
- TEST-DEBT-001-F2 (see §10) remains a separate, unstarted follow-up task — this PR does not include any DB-route coverage work.

## 10. Exact next task

**TEST-DEBT-001-F2 — Add a real-Postgres `dbVerification` coverage test for `GET /api/public/booking/:clinicId/slots`.**

Identified as a coverage gap (not a defect) in the prior review §6: `server/src/tests/dbVerification/` has no test exercising `buildAvailableSlots` or the public slots route against a real database — every existing test in this area (including the one modified here) is a pure in-memory mock simulation. This is a separate, lower-priority follow-up and does not block this fix.

# DATA-INTEGRITY-001-F1 — Appointment Request Conversion Atomicity Implementation

## 0. Revision history

- **F1-R0** (this revision): closed the remaining request-level concurrency gap documented as a residual risk in the original F1 pass (§16 below, pre-revision) — two concurrent conversions of the *same* `AppointmentRequest` using *different* slot overrides could previously both proceed. Added a request-level advisory lock (`acquireAppointmentRequestConversionLock`), acquired **before** the existing slot lock, inside the same conversion transaction. See §6-7 and §12 for the closed-gap implementation and its proof tests. Different-slot duplicate conversion is **no longer** a residual accepted risk (§16).
- **F1** (original): implemented the transaction + slot-lock wrapping of the convert handler, per the parent review's `CONFIRMED_DEFECT` finding. Left the different-slot-override race as a documented residual risk.

## 1. Task ID and phase

**Task ID:** DATA-INTEGRITY-001-F1 (this revision: F1-R0 — "Close Remaining Request-Level Concurrency Gap and Rebaseline")
**Title:** Make Appointment Request Conversion Atomic and Concurrency-Safe
**Phase:** F0 — production hardening
**Parent:** DATA-INTEGRITY-001 (review) — classified `CONFIRMED_DEFECT` in `docs/program/evidence/DATA-INTEGRITY-001_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_REVIEW.md`. This task implements the fix that review proposed, and this revision (F1-R0) closes the remaining gap the original F1 pass flagged but did not fix.

## 2. Baseline SHA and worktree

**F1 (original) baseline:** `git fetch origin --prune && git rev-parse origin/main` → `7c2aea5a084c38de5732fda65ca0874aa8d46024` (identical to the review's baseline — no drift at that time).

**F1-R0 (this revision) drift check**, run at the start of this task:
- `git fetch origin main` → current `origin/main` = `7b7a80b097c6b07aac6f5a5b525360a1328ed579` (includes PR #209, PR #210 — matches the task's expected `ebb0246` merge commit for PR #210 — plus one further merge, PR #211, docs-only).
- `git diff --stat 7c2aea5..origin/main` (full repo) → 10 files changed, all under `docs/`, `1328 insertions(+), 1 deletion(-)`. **Zero files changed under `server/`.**
- Explicitly confirmed zero drift in the files this task is scoped to: `server/src/routes/appointmentRequests.ts`, `server/src/services/appointments/appointmentAvailabilityService.ts`, `server/src/services/appointmentRequestSafety.ts`, the `dbVerification` test harness, `server/package.json`, and every related test file — `git diff --stat 7c2aea5..origin/main -- server/` returns empty.
- **Conclusion: drift from `7c2aea5` to current `origin/main` is documentation-only. No technical impact on this task's scope.** No stop/report condition was triggered.
- Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\data-integrity-001-f1-conversion-fix`
- Branch: `fix/appointment-request-conversion-atomicity`, checked out at `7c2aea5` (the F1 base) with the F1 implementation already present as uncommitted changes; F1-R0 built directly on top of that uncommitted work rather than re-implementing from `origin/main`, since the drift check above confirmed no technical divergence exists for the affected files.
- No `.codegraph/` directory exists in this worktree — not used.
- Shared program docs (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`) were **not** modified. No production system was accessed. Nothing committed, pushed, merged, or deployed.

## 3. Current-defect confirmation

Re-confirmed against this fresh checkout before making any change:

```
grep -n '\$transaction' server/src/routes/appointmentRequests.ts   → no matches
```

`main` still had no transaction wrapping the convert handler's writes — the `CONFIRMED_DEFECT` finding from the DATA-INTEGRITY-001 review (orphan `Patient` on the common new-patient + slot-conflict path; no DB-level or atomic duplicate-conversion guard) applied unchanged. None of the stop conditions were triggered (no existing transaction, no schema migration needed, no external call found coupled inside the write sequence, no helper-semantics surprise, no product-decision blocker on response-contract preservation).

## 4. Files changed

| File | Nature of change |
|---|---|
| `server/src/services/appointmentRequestSafety.ts` | **F1-R0.** New: `computeAppointmentRequestConversionLockKey(requestId)` and `acquireAppointmentRequestConversionLock(tx, requestId)` — a second, domain-separated `pg_advisory_xact_lock`, keyed on the `AppointmentRequest`'s own id. Module header comment updated to document the two-lock conversion transaction order. |
| `server/src/services/appointments/appointmentAvailabilityService.ts` | **F1.** `checkAppointmentOverlap`/`checkAppointmentRequestConflict` parameter type widened from `PrismaClient` to `Prisma.TransactionClient` (structural supertype — every existing call site keeps type-checking with the plain `prisma` singleton; new callers can pass `tx`). **F1-R0.** Re-exports `acquireAppointmentRequestConversionLock` for single-import convenience, matching the existing `acquireAppointmentSlotLock` re-export. |
| `server/src/routes/appointmentRequests.ts` | **F1.** `POST /:id/convert` handler: writes moved inside `prisma.$transaction`, advisory slot lock + re-checks added, three new local error classes for status-code mapping. **F1-R0.** `acquireAppointmentRequestConversionLock(tx, id)` added as the **first** operation inside the transaction, before `acquireAppointmentSlotLock` — closes the different-slot-override race (§7). No new error class or response-contract change needed: the existing `AlreadyConvertedError` → `400` mapping now also covers the loser of this race. |
| `server/src/tests/dbVerification/dbVerificationHarness.ts` | **F1.** Added `appointmentRequest`/`appointment`/`doctorAvailability`/`doctorOffDay` to `cleanupAllFixtures()`'s FK-ordered teardown — a **pre-existing gap** (no prior DB-verification test created these row types), needed for the new test file below, harmless/backward-compatible for every existing KVKK-HIGH-006 DB-verification test |
| `server/src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts` | **F1.** New. Real disposable-Postgres, real-route-handler test file, 14 scenarios (§12). **F1-R0.** +2 scenarios (7b, 7c): same-request/different-slot-overrides concurrent conversion (the exact gap this revision closes — proven to fail pre-fix, §12), and two-different-requests/different-slots no-interference. |
| `server/src/tests/appointmentRequestOverlapSafety.test.ts` | **F1-R0.** New. +5 unit tests: `computeAppointmentRequestConversionLockKey` determinism/domain-separation, `acquireAppointmentRequestConversionLock` `$executeRaw` call verification, and a call-order test proving the request lock's `$executeRaw` call always precedes the slot lock's. |
| `server/package.json` | **F1.** One new script: `test:appointment-request-conversion-atomicity` (not chained into the `test` aggregate, matching the existing convention for every other DB-verification script — they require a live Postgres `DATABASE_URL`). **F1-R0:** no further script changes needed. |

No `server/prisma/**` file touched, in either revision. No shared program doc touched. No HIGH-008 file touched.

## 5. Transaction boundary

`POST /appointment-requests/:id/convert` (`server/src/routes/appointmentRequests.ts:209-460`):

**Before the transaction** (unchanged from `main`, or read-only/fast-fail as before): auth + role check (`authorize` middleware), `validateAndGetClinicIdScope`, request lookup within scope, input validation (zod), status/requestType guards, service/practitioner existence checks, patient-id validation (read-only if an existing `patientId` was supplied — no write), working-hours/off-day availability check, fast overlap/conflict pre-checks. **No `Patient` or `Appointment` row is created before the transaction.**

**Inside `prisma.$transaction(async (tx) => { ... })`**, in order:
1. **`acquireAppointmentRequestConversionLock(tx, id)` (F1-R0) — first operation, unconditionally, before the slot lock.** Serializes ALL concurrent conversion attempts of *this* request regardless of which slot each one targets (see §7).
2. `tx.appointmentRequest.findFirst({ where: { ...scope, id } })` — authoritative re-read under the same accepted clinic-scope contract, now protected by the request lock above.
3. Not-found → throw; already-`converted` → throw (duplicate-conversion guard, see §7).
4. `acquireAppointmentSlotLock(tx, { clinicId, practitionerId, startTime })` — second operation. Serializes concurrent writes for this exact slot.
5. `checkAppointmentOverlap(tx, ...)` + `checkAppointmentRequestConflict(tx, ...)` — authoritative, lock-protected re-check of the same two conditions pre-checked outside the transaction.
6. `tx.patient.findFirst(...)` (existing patient — re-resolved) **or** `tx.patient.create(...)` (new patient).
7. `tx.appointment.create(...)`.
8. `tx.appointmentRequest.update(...)` → `status: 'converted'`, `patientId`, `convertedAppointmentId`.

**Lock order is fixed and consistent: request lock always first, slot lock always second.** This is the only conversion write-path in the codebase (confirmed by grepping for every `convertedAppointmentId:`/`status: 'converted'` write site — the only other hits are a read-only `GET` list projection and an unrelated Instagram inbox status field), so "consistent across all conversion paths" is satisfied trivially by construction plus the explicit call-order unit test in §12.

Any thrown error rolls back every write in this list — real Postgres `ROLLBACK`, not application-level cleanup.

**Deliberately left outside the transaction** (with rationale, matching `publicBooking.ts`'s established convention exactly):
- The working-hours/off-day/`clinicWorkingHours` check (`checkPractitionerAvailability`) — stable schedule configuration, not subject to the same booking race as overlap/conflict.
- `logActivity(...)` — uses its own, separately-instantiated `PrismaClient` (`server/src/utils/activity.ts:1-12`) and **cannot** structurally participate in the `prisma.$transaction` above; called only after the transaction commits, preserving its existing best-effort/fire-and-forget semantics (its own try/catch swallows and logs errors, unchanged from before this task). No other "locally coupled" activity/audit table write was found in this handler that both uses the main `prisma` client and needs atomicity with the conversion.
- `sendAppointmentRequestConfirmationNotification(...)` — the WhatsApp/notification external call, unchanged: after `res.json`, wrapped in `.catch()`.

No AI call, no email call, no other external HTTP request exists anywhere in this handler.

## 6. Advisory-lock behavior

**Two `pg_advisory_xact_lock`s, acquired in a fixed order, both inside the same transaction:**

1. **Request-level lock (F1-R0, new):** `acquireAppointmentRequestConversionLock(tx, id)`, keyed on the `AppointmentRequest`'s own id via `computeAppointmentRequestConversionLockKey` — SHA-256 of `"appointment-request-conversion:{requestId}"`, first 8 bytes split into two signed int32 values, domain-separated from every other advisory-lock namespace in the codebase by that string prefix (same key-derivation shape and domain-separation convention `securityIncidentService.ts` already established for its own advisory lock — see that file's `computeIncidentUpsertLockKey`). Serializes **every** concurrent conversion attempt of the same request, independent of which slot each attempt targets.
2. **Slot-level lock (F1, reused unchanged):** `acquireAppointmentSlotLock`/`SlotConflictError` from `server/src/services/appointments/appointmentAvailabilityService.ts` (re-exported from `appointmentRequestSafety.ts`) — the same `pg_advisory_xact_lock` keyed on `(clinicId, practitionerId, startTime)` that `publicBooking.ts`, `whatsapp.ts`, and the Instagram/Meta AI flows already use for booking creation.

Lock order is always **request lock first, slot lock second** (§5) — a fixed, global order, so no deadlock is possible between two concurrent conversions regardless of which requests/slots they target: each transaction's own request-id lock is never contended by another transaction's slot lock or vice versa.

**Helper-contract inspection (per the "do not blindly add `excludeRequestId`" instruction, unchanged from F1):** `checkAppointmentRequestConflict` **already had** an `excludeRequestId` parameter, already correctly used by the pre-existing code — confirmed before writing any code. **No exclusion parameter was added anywhere.** The one helper change made was a **type-only** widening of `checkAppointmentOverlap`/`checkAppointmentRequestConflict`'s first parameter from `PrismaClient` to `Prisma.TransactionClient`, so both functions can be called with either the module-level `prisma` singleton (all ~10 existing call sites, unchanged) or the `tx` passed into a `$transaction` callback. `Prisma.TransactionClient` is a structural subset of `PrismaClient`, so this is backward-compatible by construction — confirmed by a full clean `tsc --noEmit` across the whole `server/` project (§13).

**Do not introduce a schema migration unless proven necessary — not triggered.** The request lock is a runtime `pg_advisory_xact_lock` call, not DDL; no new column, index, or constraint was added or needed. **Do not add a new cross-domain dependency — not triggered.** The new lock function lives in the same module (`appointmentRequestSafety.ts`) as the slot lock it's paired with, uses the same `node:crypto` import already in that file, and introduces no new package or external service dependency.

## 7. Duplicate-conversion behavior

Three mechanisms, composed in order inside the same transaction:

1. **Same request, converted twice — any slot combination (F1-R0, closed gap):** the request-level lock (§6.1) serializes ALL concurrent conversion attempts of the same request before either one can even re-read the row, regardless of whether the two attempts target the same slot or different slots. The second attempt to acquire the lock always observes `status: 'converted'` from the first's already-committed write and throws `AlreadyConvertedError`, mapped to the pre-existing `400 { error: 'Appointment request is already converted' }` — byte-identical to the established response for this condition, and identical regardless of which slot combination triggered it.
2. **Two different requests converging on the same slot** (including via a staff-entered override, not just each request's own stored preferred time): the lock-protected re-check of `checkAppointmentOverlap`/`checkAppointmentRequestConflict` inside the transaction catches this — the loser sees the winner's just-committed `Appointment` and gets `409 APPOINTMENT_OVERLAP`, the pre-existing conflict response.
3. **Two different requests targeting different slots:** no shared lock key on either the request-id or slot axis, so neither transaction blocks the other at all — both proceed and both succeed independently. Verified directly (test scenario 7c, §12).

In every case: exactly one `Appointment` is ever created for a contested request or slot; the loser (where one exists) is rejected with an established, non-500 response; no silent duplicate; unrelated conversions never block each other.

**The gap this revision closes, and how it was proven closed:** the original F1 pass's same-request duplicate guard relied on both concurrent calls resolving to the *same* slot-lock key. Two concurrent conversions of the *same* request submitted with *different* explicit `practitionerId`/`startTime` overrides in their bodies would compute two *different* slot-lock keys, would not serialize against each other at all, and — timed right — could both pass their own (non-conflicting, because different-slot) overlap check and both create an `Appointment` for the same request. This was reproduced directly before applying the fix in this revision: with the request-lock call temporarily removed, running test scenario 7b (§12) against the live route produced **two `201` responses** for the same request (confirmed via the test's own failure output: `AssertionError: exactly one concurrent convert call (different slot overrides) must succeed — got A=201 B=201`, `2 !== 1`). Re-adding the request-lock call and re-running the identical test produced the required single winner, with the loser always getting exactly `400 { error: 'Appointment request is already converted' }` (never a `409` slot conflict, since the loser never reaches the slot lock at all). This is no longer a residual accepted risk (§16).

## 8. Slot-conflict rollback behavior

Verified directly (test scenario 3, §12): when a new-patient conversion targets an already-occupied slot, the response is the pre-existing `409 { error: '...', code: 'APPOINTMENT_OVERLAP' }`, **and** no `Patient` row is created — the exact defect DATA-INTEGRITY-001 confirmed on unmodified `main` (an orphan `Patient` was created on *every* such occurrence, not just failures) is closed. The `AppointmentRequest` row is left completely unchanged (`status: 'pending'`, `patientId: null`).

## 9. Tenant/clinic-scope impact

**No change to the merged clinic-scope contract.** The transaction's in-flight re-read (`tx.appointmentRequest.findFirst({ where: { ...scope, id } })`) reuses the exact same `scope` object `validateAndGetClinicIdScope` already produced before the transaction — the same 404-for-not-in-scope / 403-for-zero-assigned-clinics semantics PR #194 established are preserved verbatim, not reimplemented. No PR #207 alternate 403/404 behavior was reintroduced anywhere. Verified directly (test scenarios 9-11, §12): same-org-but-unauthorized-clinic staff get `404` (not `403`, no existence leak); cross-organization staff get the identical `404`; a multi-clinic `OWNER` whose own default/session clinic differs from the request's clinic still succeeds, and every created row (`Appointment.clinicId`, new `Patient.clinicId`) is attributed to the **request's own** clinic, not the acting user's default clinic — unchanged record-owned-scope behavior.

## 10. API compatibility

**No request or response contract change, in either revision.** Every response status/body for every existing condition (400 missing fields / invalid type / invalid practitioner / invalid patient / already converted / cancel-type; 404 not found; 409 outside-availability / overlap / request-conflict; 201 success; 500 unexpected) is byte-identical to the established pre-existing responses — confirmed by construction (each error class maps 1:1 back onto an existing `res.status(...).json(...)` call, see the `catch` block at `appointmentRequests.ts:401` onward) and by the regression suite (§12) still passing unchanged. **F1-R0 introduces no new status code or error shape**: the loser of the different-slot race (§7) now deterministically gets the already-established `400 { error: 'Appointment request is already converted' }` — the same response condition #6 (duplicate sequential conversion) already produced, just reached via a different, previously-racy path that's now safely serialized instead of silently corrupting data.

## 11. Schema/migration status

**None.** No `server/prisma/**` file was touched or is required. `pg_advisory_xact_lock` is a runtime call, not DDL. Per `appointmentRequestSafety.ts`'s own pre-existing, documented rationale (nullable `practitionerId`/`preferredStartTime` make a partial unique index ineffective against null-collisions), a DB-level uniqueness constraint was not proposed and is not needed for this fix — consistent with the task's "stop and report before creating a migration" instruction, which was not triggered.

## 12. Exact tests and counts

All commands run from `server/`. DB-backed tests require a disposable PostgreSQL; one was launched locally for this task only (Docker, `postgres:16-alpine`, ephemeral container `di001f1-pg`, non-default host port `55432`, `postgres`/`postgres` credentials scoped to this ephemeral container only — never used for anything beyond this task, no volume mount, disposable/throwaway profile matching the KVKK-HIGH-006 disposable-Postgres precedent; stopped and removed via `docker stop && docker rm` after this task's verification completed). `npx prisma migrate deploy` → 66 migrations applied cleanly, exit 0.

### New test file (real DB, real route handler — not source-regex, not in-memory simulation)

```
npm run test:appointment-request-conversion-atomicity
  (= npx tsx src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts)
  → 16 passed, 0 failed — exit 0 — ~13s
```

Scenario-by-scenario (16 named `test()` calls across 13 sections; every one PASSED):

| # | Scenario | Result |
|---|---|---|
| 1 | Existing patient + successful conversion | ✓ 201, correct linkage, **zero** new `Patient` rows, exactly one `ActivityLog` "converted" row |
| 2 | New patient + successful conversion | ✓ 201, exactly **one** new `Patient` row, correctly attributed |
| 3 | Slot conflict after new-patient path leaves no Patient | ✓ 409 `APPOINTMENT_OVERLAP`, **zero** new `Patient` rows, request untouched, zero `ActivityLog` rows |
| 4 | `appointment.create` failure rolls back new Patient | ✓ real Postgres FK-violation-forced failure inside `prisma.$transaction`; patient count unchanged after rollback |
| 5 | `appointmentRequest.update` failure rolls back Patient **and** Appointment | ✓ real Postgres not-found-forced failure; both patient and appointment counts unchanged after rollback |
| 6 | Duplicate sequential conversion, same request | ✓ first 201, second 400 "already converted", exactly one `Appointment` persisted |
| 7 | Duplicate **concurrent** conversion, same request, **same slot** | ✓ exactly one `201`, loser gets an established conflict response (400 or 409), exactly one `Appointment` persisted |
| **7b** | **(F1-R0) Duplicate concurrent conversion, same request, DIFFERENT slot overrides — the exact gap this revision closes** | ✓ exactly one `201`; loser gets **exactly** `400 "already converted"` (never a slot conflict — proves the request lock, not the slot lock, is what serializes it); exactly one `Appointment` total across both candidate slots; request points at only the winning slot; no orphan `Patient` from the loser. **Reproduced failing pre-fix**: with the request-lock call temporarily removed, this exact test produced two `201`s (`2 !== 1`) — see §7. |
| **7c** | **(F1-R0) Two DIFFERENT requests, DIFFERENT slots, concurrent — no interference** | ✓ both succeed independently with `201`, distinct appointments, no cross-blocking |
| 8 | Two different requests, same slot (staff-overridden), concurrent | ✓ exactly one winner, loser gets `409 APPOINTMENT_OVERLAP`, no double-booking, no orphan `Patient` from the loser |
| 9 | Unauthorized clinic access unchanged | ✓ `404`, unchanged |
| 10 | Cross-organization behavior unchanged | ✓ `404`, identical to #9, no existence leak |
| — | Request status/patient unchanged after both #9/#10 denials | ✓ |
| 11 | Record-owned clinic attribution unchanged | ✓ multi-clinic `OWNER` succeeds across clinics; every row attributed to the request's own clinic |

**On scenarios 4 and 5:** constructed-failure transaction-mechanics tests (a real FK violation / a real `P2025` not-found), directly against the real disposable Postgres — not a mock, not a stub. Scenarios 6, 7, 7b, 7c, and 8 **are** driven through the live route handler under genuine concurrent HTTP-shaped calls (`Promise.all` against the same live Postgres connection pool, real `pg_advisory_xact_lock` contention) — no mocking, no simulated timing.

**Request-lock unit-test coverage (F1-R0, `appointmentRequestOverlapSafety.test.ts`, no DB required):** `computeAppointmentRequestConversionLockKey` determinism (same requestId → same key; different requestId → different key), domain separation from `computeSlotLockKey` (a colliding raw string as input to both functions still produces two different key pairs), `acquireAppointmentRequestConversionLock`'s `$executeRaw` call shape (correct key pair, `::int4` casts), and an explicit call-order test proving the request-lock `$executeRaw` call always precedes the slot-lock `$executeRaw` call when both are invoked in the handler's own sequence — the "lock order is consistent" requirement, verified at the unit level in addition to being proven behaviorally by scenario 7b.

**Incidental fix (F1, unchanged this revision):** `dbVerificationHarness.ts`'s shared `cleanupAllFixtures()` was extended to also delete `Appointment`/`AppointmentRequest`/`DoctorAvailability`/`DoctorOffDay` rows — needed for this test file, harmless for every existing KVKK-HIGH-006 DB-verification script (they never had rows of these types to begin with).

### Regression suite

```
npx tsx src/tests/appointmentRequestRecordScope.test.ts     → 13 passed, 0 failed — exit 0
npx tsx src/tests/appointmentRequestOverlapSafety.test.ts   → 38 passed, 0 failed — exit 0   (+5 vs pre-F1-R0, see above)
npx tsx src/tests/appointmentAvailabilityService.test.ts    → 31 passed, 0 failed — exit 0
npx tsx src/tests/appointmentUpdateValidation.test.ts       → 11 passed, 0 failed — exit 0
npx tsx src/tests/multiBranchAccess.test.ts                 → 142 passed, 0 failed — exit 0
npx tsx src/tests/treatmentCaseClinicScope.test.ts          → 11 passed, 0 failed — exit 0
npx tsx src/tests/billingPatientAccess.test.ts               → 18 passed, 0 failed — exit 0
npx tsx src/tests/dashboard.test.ts                           → 38 passed, 0 failed — exit 0
```

**Every remaining test file that imports `appointmentRequestSafety.js` or `appointmentAvailabilityService.js`** (both received a runtime logic change this revision — the new lock function — so every direct and indirect exerciser was re-run, per the task's explicit instruction):

```
npx tsx src/tests/publicBookingAvailability.test.ts          → 19 passed, 0 failed — exit 0
npx tsx src/tests/publicBookingSlotConsistency.test.ts       → 10 passed, 7 FAILED — exit 1  (pre-existing, see below — NOT caused by this task)
npx tsx src/tests/publicBookingSlotRequired.test.ts          → 17 passed, 0 failed — exit 0
npx tsx src/tests/instagramProvider.test.ts                  → 63 passed, 0 failed — exit 0
npx tsx src/tests/instagramConversion.test.ts                → 41 passed, 0 failed — exit 0
npx tsx src/tests/instagramAssistantParity.test.ts           → 28 passed, 0 failed — exit 0
npx tsx src/tests/metaWhatsAppWebhook.test.ts                → 17 passed, 0 failed — exit 0
npx tsx src/tests/whatsappAwaitingServiceStep.test.ts        → 9 passed, 0 failed — exit 0
npx tsx src/tests/whatsappStepAwareNlu.test.ts                → 12 passed, 0 failed — exit 0
npx tsx src/tests/whatsappIdentityAndPostBooking.test.ts     → 16 passed, 0 failed — exit 0
npx tsx src/tests/whatsappProvider.test.ts                    → 53 passed + 90 passed (two internal suites), 0 failed — exit 0
npx tsx src/tests/contactRequests.test.ts                     → 33 passed, 0 failed — exit 0
npx tsx src/tests/noShow.test.ts                               → 110 passed, 0 failed — exit 0
```

**`publicBookingSlotConsistency.test.ts`'s 7 failures are pre-existing and unrelated to this task**, confirmed directly: `git stash` (reverting every change made in this session, both F1 and F1-R0) and re-running the identical command against the unmodified `7c2aea5` baseline reproduces the **identical** `✗ 7 of 17 tests FAILED` result, with the same failing assertions (`buildAvailableSlots` visibility for rejected-request/cancelled-appointment/no-serviceId cases). This file exercises a fully in-memory-mocked `Prisma`-shaped fixture (no `prisma` import, no `DATABASE_URL` dependency) unrelated to either the slot lock or the new request lock — the failures pre-date and are orthogonal to this task's changes. `git stash pop` restored all F1/F1-R0 work afterward (confirmed identical via `diff` against the pre-stash working copy).

**Total: 21 test files run this revision (8 core-regression + 13 helper-exercise) + the new 16-scenario DB suite = 22 files, 836 passing assertions, 7 failing assertions confined to the single pre-existing/unrelated file, 0 new failures introduced by this task.** No warnings beyond the expected, pre-existing `[appointment-confirmation] whatsapp send failed { code: 'WA_NO_CONNECTION', ... }` lines (fire-and-forget notification path, unconfigured WhatsApp connection for synthetic test clinics, unchanged, does not affect any assertion).

## 13. Typecheck

```
npm run typecheck   (= npx prisma generate && tsc --noEmit)
  → exit 0, zero errors — ~68s
```

## 14. Full-suite status

**Full repository suite (`npm test`, ~90 chained scripts) was NOT run.** Rationale, updated for F1-R0: this revision's runtime change is scoped to `appointmentRequestSafety.ts` (new function, existing functions untouched) and the one route handler that calls it (`appointmentRequests.ts`). Per the task's explicit instruction ("if appointmentRequestSafety or another shared helper receives runtime logic changes, run every existing test that imports or exercises that helper"), §12 above enumerates and runs **every** test file that imports either changed module — 21 files, 0 new failures. This exceeds the originally-scoped 8-file regression set from the F1 pass and satisfies the stated bar without requiring a full ~90-script run whose remaining ~70 files (billing, imaging, lab orders, SMS, TOTP, etc.) have no import-path relationship to either changed file.

## 15. Rollback

Revert the implementation commit (once created) and redeploy the previous backend artifact. No schema/data migration to roll back (none was applied, in either F1 or F1-R0). No client-visible response contract changed, so reverting introduces no breaking change for any client.

## 16. Remaining risks

- `logActivity`'s separate-`PrismaClient`/best-effort design (pre-existing, unchanged) means a successful conversion could theoretically commit without its activity-log row if that second, independent write fails — this is the same accepted tradeoff already present everywhere else in the codebase that calls `logActivity`, not something this task introduced or was asked to change.
- No dedicated automated test exists for `appointments.ts`'s own call site of the type-widened `checkAppointmentOverlap`/`checkAppointmentRequestConflict` helpers (a pure type-level change, zero runtime behavior difference for that call site, which still passes the plain `prisma` singleton) — de-risked by the clean typecheck and the helper module's own full test coverage, but not independently exercised end-to-end in this task.
- `publicBookingSlotConsistency.test.ts`'s pre-existing 7-failure state (§12) was not investigated or fixed — out of scope for this task, confirmed unrelated and present on the unmodified baseline.

**Closed this revision (no longer a residual risk):** two concurrent conversions of the same `AppointmentRequest` using different slot overrides can no longer both proceed — see §7 for the mechanism and §12 scenario 7b for the before/after proof.

## 17-20. Safety and next step

| Question | Answer |
|---|---|
| Commit safe? | Yes — implementation complete, typecheck clean, new + regression tests all passing (one pre-existing, confirmed-unrelated failure noted, not introduced by this task), no schema change, no response-contract change |
| Merge safe? | Not yet — no PR opened, no independent review performed (this task's instructions explicitly prohibit opening a PR or merging) |
| Deployment safe? | Not yet — not committed, not pushed, not reviewed, not merged |
| Exact next task | **DATA-INTEGRITY-001-R1 — Independent PR Diff and Test Verification** — commit, push, open a PR against `main`, and have it independently re-verified before any merge/deploy. Optionally, investigate and fix the pre-existing, unrelated `publicBookingSlotConsistency.test.ts` failures (§12, §16) as a separate, independently-scoped task. |

## 21. Status

| Status | Value |
|---|---|
| Implementation complete | Yes (F1-R0: request-level lock added, closing the residual gap) |
| Tests added | Yes (F1-R0: +2 DB-backed scenarios in the atomicity suite, +5 unit tests in `appointmentRequestOverlapSafety.test.ts`) |
| Different-slot duplicate conversion still a residual accepted risk? | **No — closed this revision (§7, §12, §16)** |
| Tests passed | Yes — new suite 16/16; 8-file core regression 302/302; 12-of-13-file helper-exercise set 508/508 (the 13th file, `publicBookingSlotConsistency.test.ts`, has 10 passed/7 failed — confirmed pre-existing and unrelated, §12/§16); typecheck clean |
| Typecheck passed | Yes (exit 0) |
| Full suite run | No — see §14 (every helper-importing test file was run instead, per task instruction) |
| Committed | **No** |
| Pushed | **No** |
| PR opened | **No** |
| Merged | **No** |
| Deployed | **No** |
| Production accessed | **No** |
| Shared program docs modified | **No** |

Stopping here per task instruction.

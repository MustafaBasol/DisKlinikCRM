# DATA-INTEGRITY-001-R2 — Independent PR #212 Diff and DB-Backed Verification

Status: **independent verification of PR #212, performed prior to merge**. PR #212 has
since been **merged** into `main` as commit
`8906e66af5169220a4aed48fe4cfea8524976fb8`. This document is being committed to the
repository as evidence accompanying the merged implementation; the findings below are
recorded exactly as independently verified at the time — nothing has been altered
post-merge beyond the status reconciliation in this paragraph and in §18-20.
Production deployment of this merge and any post-deployment production-behavior
verification remain pending and are outside the scope of this document — see §19-20.

## 1. Current main SHA

`1b89e31cedd96243cc548a9dcc9bad73dab91f3f` (Merge PR #213, `feature/r061-residual-safe-closure`).

Note: main advanced mid-session from `7b7a80b097c6b07aac6f5a5b525360a1328ed579` (the SHA
recorded at R1) to `1b89e31...` via a live push (`b860017` "fix(privacy): add audited
legacy consent setting reset" + merge `1b89e31`). This is genuine drift discovered
during this task, not a stale baseline. Impact assessed in §2.

(This is the `main` SHA at the time this independent verification was performed. PR
#212 has since merged as `8906e66af5169220a4aed48fe4cfea8524976fb8`, which is current
`origin/main` as of this reconciliation — see §18.)

## 2. PR head SHA

`bda38808dbb357a847f09b178e313af8e1d81bda` (`fix/appointment-request-conversion-atomicity`,
branched from `7c2aea5a084c38de5732fda65ca0874aa8d46024`).

## 3. Exact changed files (verified against current main, not the old branch baseline)

`git diff --name-only <merge-base> bda3880` (the PR's single commit) and
`gh pr view 212 --json changedFiles` both independently confirm **exactly 8 files**,
no unrelated changes, unaffected by the main-drift in §1 (the two new main commits
touch only `server/src/routes/platformAdmin.ts`, `server/src/services/platformSettings.ts`,
`server/src/tests/platformAdmin.test.ts` — zero overlap):

1. `server/package.json`
2. `server/src/routes/appointmentRequests.ts`
3. `server/src/services/appointmentRequestSafety.ts`
4. `server/src/services/appointments/appointmentAvailabilityService.ts`
5. `server/src/tests/appointmentRequestOverlapSafety.test.ts`
6. `server/src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts` (new)
7. `server/src/tests/dbVerification/dbVerificationHarness.ts`
8. `docs/program/evidence/DATA-INTEGRITY-001-F1_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_IMPLEMENTATION.md` (new)

`gh pr view 212` (re-queried after the main-drift, with a 15s wait for GitHub to
recompute): `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, `changedFiles: 8`.

## 4. Diff findings

### 4.1 Request advisory-lock key generation — ACCEPTED

`computeAppointmentRequestConversionLockKey(requestId)` (`appointmentRequestSafety.ts:165-168`):
SHA-256 of `` `appointment-request-conversion:${requestId}` ``, split into two
`readInt32BE` values.

- **Deterministic**: same `requestId` → same key pair (unit-verified, `appointmentRequestOverlapSafety.test.ts`).
- **Domain-separated from the slot lock**: distinct string-prefix input shape from
  `computeSlotLockKey`'s `` `${clinicId}:${practitionerId}:${startEpochMs}` `` — confirmed by
  a dedicated unit test ("request-conversion lock key is domain-separated from the slot
  lock key, even for a colliding raw id"). Not a cryptographic domain-separation scheme
  against adversarial input, but `requestId`/`clinicId`/`practitionerId` are all
  server-generated identifiers never user-chosen, so this is not a real attack surface —
  worst case of an accidental cross-namespace collision is a harmless extra
  serialization, not a correctness bug (advisory locks are a concurrency primitive here,
  not an access-control boundary).
- **Valid PostgreSQL argument types**: `readInt32BE` yields signed values in
  `[-2147483648, 2147483647]`, passed with explicit `::int4` casts in the raw SQL
  (`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`). Verified by a
  regression-guard unit test asserting the casts are present (not raw bigint).
- **Collision risk**: SHA-256 truncated to 64 bits — negligible for this codebase's
  operational namespace size.
- **No secret/PHI in logs**: neither `computeAppointmentRequestConversionLockKey` nor
  `acquireAppointmentRequestConversionLock` logs anything; only opaque int4 key pairs
  reach `$executeRaw`. The one `console.error` in the modified route
  (`[appointment-confirmation] notification failed`) is pre-existing WhatsApp-send
  logging, unrelated to the lock, unmodified by this PR, and contains no PHI beyond a
  generic Turkish "no active WhatsApp connection" string.

### 4.2 Lock order — ACCEPTED

- Request lock (`acquireAppointmentRequestConversionLock`) is called first at
  `appointmentRequests.ts:313`, immediately followed by the fresh re-read, then
  `acquireAppointmentSlotLock` at line 329 — matches the documented order.
- Codebase-wide grep for `acquireAppointmentRequestConversionLock(` (excluding its own
  definition/re-export and tests) found **exactly one call site**: the convert handler.
  There is no alternate conversion write path in the codebase, so no alternate ordering
  can exist.
- `acquireAppointmentSlotLock(` has 5 call sites total (`appointmentRequests.ts`,
  `publicBooking.ts`, `whatsapp.ts`, `instagramAiConversationProcessor.ts`,
  `metaWhatsAppAiProcessor.ts`); none of the other four ever acquire the conversion
  lock, so there is no cross-flow path that could acquire the two locks in reverse
  order relative to the convert handler.

### 4.3 Transaction boundary — ACCEPTED

Full transaction body (`appointmentRequests.ts:301-397`) read line-by-line:
request lock → `tx.appointmentRequest.findFirst` (authoritative re-read) →
slot lock → `Promise.all([checkAppointmentOverlap(tx,…), checkAppointmentRequestConflict(tx,…)])` →
patient resolve/create (`tx.patient.findFirst`/`tx.patient.create`) →
`tx.appointment.create` → `tx.appointmentRequest.update` → return.

- All writes (`Patient`, `Appointment`, `AppointmentRequest`) go through `tx`, never the
  module-level `prisma` singleton — no escape path found.
- No external/network/AI/WhatsApp/email call inside the transaction. The one
  notification call, `sendAppointmentRequestConfirmationNotification(...)`, executes
  at line 439 — **after** `res.status(201).json(...)` at line 437, itself after the
  `$transaction(...)` block has already resolved (committed). It is fire-and-forget
  with its own `.catch()`.
- `logActivity(...)` (line 430) also runs only after the transaction commits, using its
  own separate PrismaClient instance, consistent with its pre-existing best-effort
  semantics.

### 4.4 Clinic/tenant scope — ACCEPTED

- `scope` is resolved once via `validateAndGetClinicIdScope` and reused unchanged for
  both the pre-check read (line 218-221) and the authoritative in-transaction re-read
  (line 321) — current main's accepted `findFirst` scope shape is untouched by this PR.
- `clinicId` is taken from `request.clinicId` (the record's own clinic), never
  re-derived from `req.user.clinicId` — confirmed by an explicit code comment and by
  scenario 11 in the new suite (multi-clinic OWNER whose session clinic differs from
  the request's clinic still gets every created row attributed to the request's own
  clinic).
- No PR #207 403-reintroduction: unauthorized/cross-org access returns 404 in both
  cases (never 403), matching the merged no-existence-leak contract — independently
  reproduced by scenario 9-10 in the new suite (see §11).
- Cross-org access denied: same scenario.

### 4.5 Error behavior — ACCEPTED

- "Already converted" → `400 { error: 'Appointment request is already converted' }`,
  identical string on both the pre-transaction fast-path (line 224) and the
  in-transaction `AlreadyConvertedError` mapping (line 405-407).
- Slot conflict → `409` with `APPOINTMENT_OVERLAP` / `APPOINTMENT_REQUEST_CONFLICT`,
  identical codes/messages on both the pre-check (lines 280-297) and the
  `SlotConflictError` mapping inside the `catch` (lines 414-422).
- No leaked implementation detail: every thrown-inside-tx error class
  (`AlreadyConvertedError`, `AppointmentRequestNotFoundError`, `InvalidPatientError`,
  `SlotConflictError`) is caught and mapped 1:1 to a fixed status/body before
  `throw txErr` (any unmapped error re-throws to the outer generic `catch { res.status(500)... }`).
- No double-response bug found: the transaction's `catch` block (line 401-424) always
  either `return`s a response or re-throws — no path falls through to also execute the
  success path below it. The one item worth flagging (pre-existing, not introduced by
  this PR — see §16) is the fire-and-forget notification call after `res.status(201)`;
  it already has its own `.catch()`, but if `sendAppointmentRequestConfirmationNotification`
  ever threw *synchronously* (before returning a promise) it would propagate to the
  outer `try/catch` and attempt a second `res.status(500)` after `res.status(201)` was
  already sent. This exact call-site pattern (fire-and-forget notification after the
  response, wrapped only in `.catch()`, inside the same outer `try`) already existed on
  unmodified main before this PR; the PR's only change to this line is
  `patientId` → `updatedRequest.patientId!` to match the new transaction-scoped
  variable. Not a regression introduced by DATA-INTEGRITY-001-F1.

### 4.6 Transaction behavior — ACCEPTED

- No explicit `$transaction` timeout override; uses Prisma's interactive-transaction
  default (5000ms timeout / 2000ms maxWait), same as every other transaction in this
  codebase. Adequate: the transaction body is a handful of indexed point-queries plus
  at most one row insert/update chain; not adequate would be a body containing network
  I/O, which §4.3 confirmed is absent.
- Advisory locks are transaction-scoped (`pg_advisory_xact_lock`) — released
  automatically at transaction end (commit or rollback), per PostgreSQL semantics.
- Rollback releases both locks: **independently verified empirically** with a
  supplementary throwaway script (written to the r2-verify worktree only, run once,
  then deleted — never part of the repo or the PR): first call hits a real slot
  conflict (rollback after both locks were held), second call on the **same request**,
  different free slot, immediately afterward, succeeds with `201`. See §17 raw output.
  This closes the one mandatory assertion (#10) the PR's own test suite does not
  explicitly exercise (its rollback scenarios 4-5 test bare Prisma/Postgres rollback
  mechanics directly, not lock release through the route).
- No nested transaction conflict: only one `$transaction` call exists in the modified
  route; nothing calls it recursively.
- Different requests/different slots do not serialize globally: empirically confirmed
  by scenario 7c (two different requests, two different slots, concurrent — both
  succeed with no cross-blocking).

### 4.7 dbVerificationHarness.ts — ACCEPTED

Full file read (288 lines). Cleanup order:
`activityLog → appointmentRequest → appointment → sentMessage → messageTemplate →
postTreatmentMessageQueue → postTreatmentMessageTemplate → paymentPlanInstallment →
payment → paymentPlan → insuranceProvision → inventoryTransaction → inventoryItem →
appointmentTypeMaterial → appointmentType → userClinic → patientClinic →
doctorAvailability → doctorOffDay → patient → user → clinic → organization`.

- FK-safe: `appointmentRequest` (holds `convertedAppointmentId → Appointment.id`) is
  deleted before `appointment`; every table that references `patient`/`user` (messages,
  payments, insurance, doctor schedules) is deleted before `patient`/`user`; `clinic`
  and `organization` are deleted last. No ordering violation found.
- Cannot delete non-test data: `cleanupAllFixtures()` scopes every delete to
  `clinicIds`/`orgIds` derived exclusively from a module-level `createdOrgIds` Set that
  is populated **only** by `createClinicFixtureSet()` calls made within the same
  process — there is no code path that adds an externally-supplied or pre-existing
  org/clinic id to that set.
- Fixture isolation intact: each `createClinicFixtureSet()` call mints fresh
  UUID-suffixed org/clinic slugs; no shared/global fixture reuse across scenarios.
  found.
- Cleanup executes on both success and failure: the new suite's `main()` calls
  `cleanupAllFixtures()` after `summary()` on the normal path, and again (wrapped in
  its own `.catch(() => {})`) inside the top-level `main().catch(...)` fatal-error
  handler.
- Test failures cannot be masked by cleanup errors: individual assertion failures are
  caught and counted inside `createSuite`'s `test()` helper (not swallowed by cleanup);
  a fatal (unexpected) error is `console.error`'d **before** the best-effort cleanup
  attempt, so a cleanup exception cannot hide or overwrite the original failure
  signal or exit code.

## 5. Lock-key assessment

PASS — see §4.1. Deterministic, domain-separated (practically, not cryptographically —
acceptable given non-adversarial inputs), valid `int4` range with explicit casts,
negligible collision risk, no PHI/secret logging.

## 6. Lock-order assessment

PASS — see §4.2. Single call site for the request-conversion lock; request-then-slot
order held at that single site; no other flow can acquire both locks in a different
order.

## 7. Transaction-boundary assessment

PASS — see §4.3. All three writes (`Patient`, `Appointment`, `AppointmentRequest`) are
tx-scoped; authoritative re-read happens after the request lock; overlap re-check
happens after the slot lock; zero external/network calls inside the transaction.

## 8. Tenant/API compatibility

PASS — see §4.4-4.5. Scope resolution, clinic attribution, 404-not-403 semantics, and
every response status/body/error-code are unchanged from the pre-PR contract.

## 9. Harness safety assessment

PASS — see §4.7. FK-safe, cannot touch non-fixture data, cleans up on both success and
failure paths, no failure-masking.

## 10. Exact commands (independent execution — fresh worktree, fresh disposable
Postgres, no reuse of the F1/R1 implementation worktree or its container)

```
git fetch origin
git fetch origin fix/appointment-request-conversion-atomicity
git worktree add ../DisKlinikCRM-worktrees/data-integrity-001-r2-verify bda38808dbb357a847f09b178e313af8e1d81bda
git worktree add ../DisKlinikCRM-worktrees/data-integrity-001-r2-main-baseline origin/main

# r2-verify/server (PR head)
npm ci --prefer-offline
npm approve-scripts @prisma/engines esbuild prisma
npx prisma generate
docker run -d --name di001r2-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=di001r2 -p 55511:5432 postgres:16-alpine
# .env DATABASE_URL -> postgresql://postgres:postgres@localhost:55511/di001r2?schema=public
npx prisma migrate deploy
npx tsx src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts
npx tsx src/tests/appointmentRequestOverlapSafety.test.ts
npx tsx src/tests/appointmentRequestRecordScope.test.ts
npx tsx src/tests/appointmentAvailabilityService.test.ts
npx tsx src/tests/appointmentUpdateValidation.test.ts
npx tsx src/tests/multiBranchAccess.test.ts
npx tsx src/tests/treatmentCaseClinicScope.test.ts
npx tsx src/tests/billingPatientAccess.test.ts
npx tsx src/tests/dashboard.test.ts
npx tsx src/tests/publicBookingAvailability.test.ts
npx tsx src/tests/publicBookingSlotRequired.test.ts
npx tsx src/tests/instagramProvider.test.ts
npx tsx src/tests/instagramConversion.test.ts
npx tsx src/tests/instagramAssistantParity.test.ts
npx tsx src/tests/metaWhatsAppWebhook.test.ts
npx tsx src/tests/whatsappAwaitingServiceStep.test.ts
npx tsx src/tests/whatsappStepAwareNlu.test.ts
npx tsx src/tests/whatsappIdentityAndPostBooking.test.ts
npx tsx src/tests/whatsappProvider.test.ts
npx tsx src/tests/contactRequests.test.ts
npx tsx src/tests/noShow.test.ts
npx prisma generate && npx tsc --noEmit
npx tsx src/tests/publicBookingSlotConsistency.test.ts        # PR head reproduction

# supplementary, throwaway, never committed:
npx tsx src/tests/dbVerification/_r2_lockReleaseAfterRollback.check.ts   # then deleted

# r2-main-baseline/server (clean current origin/main)
npm ci --prefer-offline
npm approve-scripts @prisma/engines esbuild prisma
npx prisma generate
docker run -d --name di001r2-main-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=di001r2main -p 55512:5432 postgres:16-alpine
# .env DATABASE_URL -> postgresql://postgres:postgres@localhost:55512/di001r2main?schema=public
npx prisma migrate deploy
npx tsx src/tests/publicBookingSlotConsistency.test.ts        # main baseline reproduction

docker stop di001r2-pg di001r2-main-pg
docker rm di001r2-pg di001r2-main-pg
```

## 11. Pass/fail/skip counts (all independent reruns, PR head, fresh DB)

| Suite | Result | Exit |
|---|---|---|
| appointmentRequestConversionAtomicity (new) | 16 passed, 0 failed | 0 |
| appointmentRequestOverlapSafety | 38 passed, 0 failed | 0 |
| appointmentRequestRecordScope | 13 passed, 0 failed | 0 |
| appointmentAvailabilityService | 31 passed, 0 failed | 0 |
| appointmentUpdateValidation | 11 passed, 0 failed | 0 |
| multiBranchAccess | 142 passed, 0 failed | 0 |
| treatmentCaseClinicScope | 11 passed, 0 failed | 0 |
| billingPatientAccess | 18 passed, 0 failed | 0 |
| dashboard | 38 passed, 0 failed | 0 |
| publicBookingAvailability | 19 passed, 0 failed | 0 |
| publicBookingSlotRequired | 17 passed, 0 failed | 0 |
| instagramProvider | 63 passed, 0 failed | 0 |
| instagramConversion | 41 passed, 0 failed | 0 |
| instagramAssistantParity | 28 passed, 0 failed | 0 |
| metaWhatsAppWebhook | 17 passed, 0 failed | 0 |
| whatsappAwaitingServiceStep | 9 passed, 0 failed | 0 |
| whatsappStepAwareNlu | 12 passed, 0 failed | 0 |
| whatsappIdentityAndPostBooking | 16 passed, 0 failed | 0 |
| whatsappProvider | 53 + 90 = 143 passed, 0 failed | 0 |
| contactRequests | 33 passed, 0 failed | 0 |
| noShow | 110 passed, 0 failed | 0 |
| _r2_lockReleaseAfterRollback (supplementary, throwaway) | 2 passed, 0 failed | 0 |
| **publicBookingSlotConsistency (PR head)** | **10 passed, 7 failed** | 1 |
| **publicBookingSlotConsistency (clean current main)** | **10 passed, 7 failed** | 1 |

Zero skips anywhere. No test file in this list was silently excluded or reweighted.

## 12. DB container lifecycle

Two ephemeral, disposable `postgres:16-alpine` containers, no volumes, credentials
scoped to the container only:

- `di001r2-pg`, host port `55511`, DB `di001r2` — backed the PR-head worktree.
- `di001r2-main-pg`, host port `55512`, DB `di001r2main` — backed the main-baseline
  worktree.

Both started fresh for this task, migrated via `prisma migrate deploy` (66 migrations,
clean, both containers), used only for this verification, then `docker stop && docker rm`
for both after all runs completed. Verified via `docker ps -a` showing zero containers
remaining. No reuse of the R1/F1 container (`di001r1-pg`/`di001f1-pg`), no interference
with any other running container (none were running at task start).

## 13. publicBookingSlotConsistency comparison

Ran independently in **two fully separate worktrees, two separate `npm ci` installs,
two separate disposable Postgres containers** — not the R1 stash-based method, no
reliance on the implementation agent's prior report.

- PR head (`bda3880`): 10 passed, 7 failed, exit 1.
- Clean current `origin/main` (`1b89e31`, re-fetched mid-session, genuinely current):
  10 passed, 7 failed, exit 1.

Failing test names, identical on both sides:

1. `rejected AppointmentRequest does NOT hide the slot`
2. `cancelled AppointmentRequest-blocking status list does not include cancelled (sanity)`
3. `cancelled Appointment does NOT hide the slot`
4. `adjacent non-overlapping slots remain visible (boundary: appointment ending 10:00 does not block a slot starting 10:00)`
5. `multi-practitioner: only the conflicting practitioner loses the slot, the other keeps it`
6. `no serviceId supplied → uses default duration, still generates slots`
7. `a slot that buildAvailableSlots showed as free can still be raced and rejected by assertSlotAvailable`

`diff` of the two full failure-detail blocks is identical except for the worktree path
prefix embedded in Node stack traces.

**Classification: IDENTICAL_PRE_EXISTING_FAILURE.** Unrelated to PR #212 — present on
unmodified, current main with zero relation to the appointment-request-conversion code
path (these failures are in `buildAvailableSlots`/slot-listing logic, not the convert
handler).

## 14. Typecheck

`npx prisma generate && npx tsc --noEmit` on PR head: clean, zero errors, exit 0,
~57s wall time.

## 15. Full-suite status

Not run in full (`npm test`, ~70 scripts). Every test file that imports or exercises
`appointmentRequestSafety.ts` / `appointmentAvailabilityService.ts` (12 files found via
`grep -rn "from '.*appointmentRequestSafety(\.js)?'|from '.*appointmentAvailabilityService(\.js)?'"`)
was run, plus every suite the task listed by name. `publicBookingSlotConsistency.test.ts`
was run and its result disclosed, not excluded.

## 16. Accepted findings

- Lock-key derivation, lock order, transaction boundary, tenant/API compatibility, and
  harness safety all reviewed against the diff and independently confirmed by
  execution — see §4-9.
- Mandatory concurrency assertions 1-10 all independently reproduced:
  1-2 (same-request/same-slot, same-request/different-slots → exactly one appointment):
  scenarios 6, 7, 7b. 3-5 (loser leaves no Patient/Appointment, request points only at
  the winner): scenario 7b, explicit row-level assertions. 6-7 (different
  requests/same slot → one winner; different requests/different slots → both succeed):
  scenarios 8, 7c. 8-9 (forced appointment/request-update failure rolls back Patient
  and/or Appointment): scenarios 4, 5 (real Postgres FK/not-found errors, not mocks).
  10 (locks release after rollback so a later valid conversion proceeds): **not**
  covered by the PR's own suite; independently closed by the supplementary throwaway
  script in this task (§10, §17).
- `publicBookingSlotConsistency`'s 7 failures are pre-existing on unmodified current
  main, unrelated to this PR — independently reproduced from a clean checkout, not
  from a stash-restored working tree.
- The fire-and-forget-notification-after-response pattern (§4.5) is a pre-existing
  shape on main, not introduced by this PR; flagged for awareness, not counted against
  this PR.

## 17. Rejected/unverified claims

None rejected. One gap identified and then closed during this task: the PR's own test
suite does not explicitly prove "locks release after rollback so a later valid
conversion can proceed" (mandatory assertion #10) through the live route — its
rollback scenarios (4, 5) exercise bare `prisma.$transaction` rollback mechanics
directly, not the route's advisory-lock acquisition. Closed via a supplementary,
throwaway, non-committed script run against the PR-head worktree:

```
lockReleaseAfterRollback — rollback then retry with a valid slot must succeed (proves lock release on rollback)
  ✓ first attempt (blocked slot) is rejected with 409, request stays pending
  ✓ second attempt on the SAME request, different (free) slot, succeeds immediately after the rollback — proves both advisory locks released

lockReleaseAfterRollback: 2 passed, 0 failed
```

The script and its output are not part of the PR, the repo, or any commit — recorded
here only as evidence.

## 18. Merge safety

**PR #212 has been merged.** `gh pr view 212` (re-queried during this reconciliation,
2026-07-23) reports `state: MERGED`, `mergeCommit.oid:
8906e66af5169220a4aed48fe4cfea8524976fb8`, `headRefOid:
bda38808dbb357a847f09b178e313af8e1d81bda`, `baseRefName: main`. `git fetch origin`
followed by `git rev-parse origin/main` confirms current `origin/main` is exactly
`8906e66af5169220a4aed48fe4cfea8524976fb8`; `git merge-base --is-ancestor` confirms
both the merge commit `8906e66a...` and the PR head `bda3880...` are ancestors of
current `origin/main`.

At the time the independent verification above (§1-17) was performed, PR #212 was
`OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN` against main (`1b89e31...`), reconfirmed
via `gh pr view` after the mid-session main drift, with no file-scope overlap between
the PR and the new main commits. None of the findings in §1-17 change as a result of
the merge — they describe the same diff that is now on `main`.

## 19. Deployment safety

No deployment was performed or attempted at any point during the independent
verification (§1-17), and no deployment has been performed as part of this
reconciliation either. **Implementation status: merged into `main`. Deployment
status: pending. Production-behavior verification status: pending.** This document
does not claim, and should not be read as claiming, that the merged change has been
deployed to or verified in production.

## 20. Exact next task

The human/maintainer merge decision referenced by the original R2 task has been made:
PR #212 is merged as `8906e66af5169220a4aed48fe4cfea8524976fb8`. The next task is
**DATA-INTEGRITY-001-R3 (or equivalent) — production deployment of this merge,
followed by standard post-merge production-behavior verification once deployed**. Not
performed as part of this task or this reconciliation.

---

## Verdict

**PASS**

All four objectives independently confirmed: (1) the confirmed partial-write defect is
closed — scenario 3 and the F1 evidence doc's documented pre-fix reproduction both
show the orphan-Patient defect is gone; (2) duplicate conversion is prevented for both
same-slot and different-slot concurrent overrides — scenarios 6/7/7b/8, all
independently rerun against a fresh disposable Postgres; (3) tenant/clinic scope and
API response contracts are byte-identical to pre-PR behavior — §4.4-4.5; (4) no
deadlock, lock-key, transaction, or cleanup regression found — §4.1-4.3, §4.6-4.7, plus
the one gap in the PR's own coverage (lock release on rollback through the live route)
was independently closed rather than left as an assumption. The one pre-existing,
unrelated `publicBookingSlotConsistency` failure set was independently reproduced from
a clean checkout of current main and is correctly out of scope for this PR.

This verdict evaluates the merged code change on its technical/correctness merits
only. It does not constitute, and should not be read as, a deployment or
production-verification sign-off — see §19-20.

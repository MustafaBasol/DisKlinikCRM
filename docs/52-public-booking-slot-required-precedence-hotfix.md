# 52 — Public Booking: SLOT_REQUIRED / Notice-Evidence Validation Precedence Hotfix

## 1. Problem found during production verification of PR #158

While verifying the hotfix in `docs/51-public-booking-required-slot-hotfix.md`
against production, the following order of checks was confirmed in
`POST /api/public/booking/:clinicId`:

1. clinic lookup
2. `validateNoticeEvidenceToken`
3. service/practitioner validation
4. `preferredStartTime`/`preferredEndTime` calculation
5. `hasFullSlotInfo` → `SLOT_REQUIRED`

Because notice-evidence validation ran *before* the slot-completeness check, a
request missing both the slot fields **and** the `noticeEvidenceToken`
returned `400 INVALID_NOTICE_EVIDENCE` instead of the documented
`400 SLOT_REQUIRED`. This contradicts the API contract in docs/51 §4, which
states that any incomplete slot payload must return `SLOT_REQUIRED`
regardless of the notice-evidence token's state.

This is **not** a database-write vulnerability — no `AppointmentRequest` was
ever created in either order, since both checks `return` before any write.
It is an API-contract / regression-test-coverage defect: a client integrating
against the documented contract (e.g. showing a specific error message for
`SLOT_REQUIRED`) would see the wrong `code` for this one payload shape.

## 2. Previous validation order (production, pre-fix)

```
1. clinic lookup
2. validateNoticeEvidenceToken        ← ran first
3. serviceId / practitionerId validation
4. preferredStartTime / preferredEndTime calculation
5. hasFullSlotInfo → SLOT_REQUIRED    ← ran last
6. patient lookup → availability → lock → create → link evidence
```

## 3. New validation order (this hotfix)

```
1. basic patientName / phone validation (unchanged, already first)
2. clinic lookup
3. serviceId validation (if supplied)
4. practitionerId validation (if supplied)
5. preferredStartTime calculation (clinic-timezone-aware)
6. preferredEndTime calculation (service duration or DEFAULT_SLOT_DURATION_MINUTES)
7. hasFullSlotInfo → SLOT_REQUIRED    ← now runs BEFORE evidence validation
8. validateNoticeEvidenceToken        ← now runs AFTER slot completeness is proven
9. patient lookup → availability → lock → create → link evidence
```

Guarantees preserved (all verified by the new tests in §4):

| Slot complete? | Token state | Response |
|---|---|---|
| No | missing | `400 SLOT_REQUIRED` |
| No | invalid | `400 SLOT_REQUIRED` |
| No | valid | `400 SLOT_REQUIRED` (evidence stays unlinked, reusable for retry) |
| Yes | missing | `400 INVALID_NOTICE_EVIDENCE` |
| Yes | invalid | `400 INVALID_NOTICE_EVIDENCE` |
| Yes | valid | normal booking path (lock → assertSlotAvailable → create → link) |

No weakening of clinic binding, expiry, single-use, or hash validation in
`validateNoticeEvidenceToken` — that function itself is unchanged. No patient
lookup or patient-data storage occurs for an incomplete slot, in either the
old or new order (this was already true; the new order simply makes the
returned `code` match the actual reason for rejection).

## 4. Files changed

- `server/src/routes/publicBooking.ts` — moved the `validateNoticeEvidenceToken`
  call (and its `INVALID_NOTICE_EVIDENCE` early return) from immediately after
  the clinic lookup to immediately after the `hasFullSlotInfo`/`SLOT_REQUIRED`
  check. No other logic changed — same token validation call, same error
  message/code, same `evidenceId` variable used later.
- `server/src/tests/publicBookingSlotRequired.test.ts` — added a new
  "Precedence" test section (8 new tests, `17` total in the file, up from `9`).

No frontend files changed. No WhatsApp/Instagram route files changed. No
Prisma schema/migration changed.

## 5. Exact test cases added

All added to `server/src/tests/publicBookingSlotRequired.test.ts`:

1. `the SLOT_REQUIRED source block appears before validateNoticeEvidenceToken is called` —
   source-order assertion: `source.indexOf("code: 'SLOT_REQUIRED'") < source.indexOf('await validateNoticeEvidenceToken(')`.
2. `incomplete slot + missing token → SLOT_REQUIRED (not INVALID_NOTICE_EVIDENCE)`
3. `incomplete slot + invalid token → SLOT_REQUIRED (not INVALID_NOTICE_EVIDENCE)`
4. `incomplete slot + valid token → still SLOT_REQUIRED, and evidence stays unlinked`
5. `complete slot + missing token → INVALID_NOTICE_EVIDENCE`
6. `complete slot + invalid token → INVALID_NOTICE_EVIDENCE`
7. `complete slot + valid evidence → normal booking path proceeds`
8. `no appointmentRequest.create call occurs in any incomplete-slot case (mock transaction, all three token outcomes)` —
   proves zero DB writes for all three token states when the slot is incomplete.

Tests 2–7 exercise a `routeOutcome(hasSlot, token)` helper that reproduces the
route's exact branching (not just that both checks exist somewhere in the
file) — this is what actually proves *precedence*, as distinct from the
pre-existing tests that only proved each check's existence independently.

Note on infrastructure: this repo has no `supertest`/live-Express-instance
harness anywhere in its test suite (confirmed by grep across
`server/src/tests/`) — every existing public-booking test uses either mocked
Prisma transaction clients or source-scan assertions against the route file.
The new precedence tests follow the same established pattern rather than
introducing a new test-infrastructure dependency for this hotfix.

## 6. Test results

```
$ npm run typecheck
✔ Generated Prisma Client (v7.8.0)
tsc --noEmit — 0 errors

$ npm run test:public-booking-slot-required
✓ All 17 tests passed.

$ npm run test:notice-evidence
18 passed, 0 failed

$ npm run test:public-booking
✓ All 19 tests passed.

$ npm run test:public-booking-slots
✓ All 17 tests passed.
```

## 7. Deployment

```bash
git fetch origin
git checkout main
git pull origin main
git merge --no-ff hotfix/public-booking-slot-required-precedence   # after PR review/approval
cd server
npm ci
npx prisma generate
pm2 restart nmc-api   # or the equivalent process manager command for this deployment
```

No database migration — this is a pure route-logic reorder.

## 8. Production verification (curl)

Replace `<CLINIC_ID>` and `<API_HOST>` with the real values.

**Incomplete payload without a token → expect `SLOT_REQUIRED`:**

```bash
curl -s -X POST "https://<API_HOST>/api/public/booking/<CLINIC_ID>" \
  -H 'Content-Type: application/json' \
  -d '{"patientName":"Verify Test","phone":"+905550000000"}'
# Expect: HTTP 400
# {"error":"Please select an available appointment time.","code":"SLOT_REQUIRED"}
```

**Complete slot payload without a token → expect `INVALID_NOTICE_EVIDENCE`:**

```bash
curl -s -X POST "https://<API_HOST>/api/public/booking/<CLINIC_ID>" \
  -H 'Content-Type: application/json' \
  -d '{
        "patientName":"Verify Test",
        "phone":"+905550000000",
        "practitionerId":"<REAL_DOCTOR_ID>",
        "preferredDate":"<A_FUTURE_YYYY-MM-DD>",
        "preferredTime":"09:00"
      }'
# Expect: HTTP 400
# {"error":"Your booking session has expired. Please reload the page and try again.","code":"INVALID_NOTICE_EVIDENCE"}
```

`practitionerId` and `preferredDate` must correspond to a real doctor and a
date/time inside their working hours for this to reach the token check
(otherwise the route may return `400 Invalid practitionerId` first, which is
correct — the FK-validity checks are unrelated to this hotfix and unchanged).

## 9. SQL proving zero AppointmentRequest writes from either curl check

Run before and after the two curl checks above; row counts must be identical
(these checks never reach `tx.appointmentRequest.create`, so no new rows are
created by them, only whatever legitimate traffic happens concurrently):

```sql
-- Run immediately before the curl checks in §8.
SELECT count(*) AS before_count
FROM "AppointmentRequest"
WHERE "patientName" = 'Verify Test' AND phone = '+905550000000';

-- Run immediately after. Expect: after_count = before_count (0 if this is a
-- fresh verification phone/name pair, since neither curl request in §8 can
-- reach appointmentRequest.create).
SELECT count(*) AS after_count
FROM "AppointmentRequest"
WHERE "patientName" = 'Verify Test' AND phone = '+905550000000';
```

## 10. Remaining risks

- `SLOT_REQUIRED` and `INVALID_NOTICE_EVIDENCE` still share HTTP status `400`
  (unchanged from docs/51) — clients must branch on `code`, not status alone.
  This hotfix does not change that; it only fixes which `code` is returned
  for the incomplete-slot case.
- No live-server (`supertest`)-based regression test exists for this route in
  this repo; the precedence proof relies on a `routeOutcome` helper that
  mirrors the route's branching plus source-order assertions, consistent with
  every other public-booking test in this codebase. A structural refactor of
  the route that changes control flow (e.g. converting to guard clauses in a
  different function) would need the mirrored helper and source markers kept
  in sync — flagged here for future maintainers.

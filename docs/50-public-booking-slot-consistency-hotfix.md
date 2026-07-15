# 50 — Public Booking Stale-Slot & SLOT_UNAVAILABLE Recovery Hotfix

Branch: `hotfix/public-booking-slot-consistency-and-recovery` (based on `main` @ `9fc2999`)
Date: 2026-07-15

## 1. Production symptom

- The public booking widget displayed a selectable time slot.
- Submitting that slot returned `HTTP 409 { code: 'SLOT_UNAVAILABLE' }`.
- Selecting a different slot succeeded.
- The widget only showed a generic "submission failed" message and did not return the customer to time selection.

## 2. Root cause (proven from code + tests, not assumed)

Two independent gaps, both in the same area:

**2a. No availability rule mismatch was even reachable — there was no slot-listing endpoint for the public widget at all.**
`src/pages/BookingWidget.tsx` rendered a **hardcoded static array** of times (`08:00`–`17:00` in 30-minute steps) for every clinic, every doctor, every date, with zero server round-trip. `GET /api/public/booking/:clinicId` (`server/src/routes/publicBooking.ts`) only ever returned raw `doctorAvailability`/`doctorOffDay` rows for the widget's own weekday/off-day filtering — never actual computed free slots. So the "available" list a customer saw was never checked against real bookings at all.

**2b. The one real slot-generation function that existed (used by the WhatsApp/Instagram AI booking flows) had its own, narrower, conflict rule than the submit-time gate.**
`buildAvailableSlots()` (`server/src/services/whatsappAvailability.ts`) only queried `Appointment` overlap. It never queried `AppointmentRequest` at all. Submit-time validation (`assertSlotAvailable()` in `server/src/services/appointmentRequestSafety.ts`, wrapped by the canonical `server/src/services/appointments/appointmentAvailabilityService.ts`) checks **both** `Appointment` overlap **and** pending/approved `AppointmentRequest` conflicts. Any slot already held by a pending or approved `AppointmentRequest` (e.g. from a prior widget submission awaiting staff review, or a concurrent WhatsApp booking) would still show as free to the next visitor and then be rejected at submit time with `SLOT_UNAVAILABLE`. This is the literal defect described by the production report, reproduced deterministically in `server/src/tests/publicBookingSlotConsistency.test.ts` ("pending AppointmentRequest hides the conflicting slot" — this test fails against the pre-fix `buildAvailableSlots`).

Verified NOT to be the cause: clinic timezone conversion, working-hours/`isClosed` handling, and off-day handling in `buildAvailableSlots` were already correct and unchanged; boundary behavior (appointment ending at 10:00 vs. a slot starting at 10:00) was already correct in the existing overlap query (`startTime < end && endTime > start`, a standard half-open interval — no re-conflict at the shared boundary).

## 3. Fix

### 3a. Unify slot generation with the canonical availability service
`buildAvailableSlots()` now calls `checkAppointmentOverlap()` and `checkAppointmentRequestConflict()` from `server/src/services/appointments/appointmentAvailabilityService.ts` — the exact same functions `assertSlotAvailable()` is built from — instead of its own ad hoc `Appointment`-only query. Slot generation and submit-time validation are now provably built from the same conflict rules; there is no third, divergent implementation.

`buildAvailableSlots()` also now accepts an optional `appointmentTypeId` (`string | null | undefined`) so the public widget can request slots before a service is chosen (falls back to a 30-minute `DEFAULT_SLOT_DURATION_MINUTES`); existing WhatsApp/Instagram callers, which always pass a real service id, are unaffected.

### 3b. Add the missing public availability endpoint
`GET /api/public/booking/:clinicId/slots?date=YYYY-MM-DD&serviceId=&practitionerId=` (`server/src/routes/publicBooking.ts`) — rate-limited (60/min/IP), validates the date format, 404s for an unknown clinic, 400s for an unresolvable `serviceId`, and returns real, conflict-checked slots via `buildAvailableSlots`.

The submit-time advisory lock (`acquireAppointmentSlotLock` + `assertSlotAvailable`, inside a single `prisma.$transaction`) remains the sole authoritative concurrency guard and was not weakened or bypassed by this change — see section 5.

### 3c. Wire the widget to real availability + graceful 409 recovery
`src/pages/BookingWidget.tsx` now fetches real slots from the new endpoint (refetched whenever date/service changes) instead of the static array. New pure helpers in `src/pages/bookingWidgetHelpers.ts`:
- `normalizePublicSlots` — parses the endpoint response defensively.
- `selectableTimesForDoctor` — dedupes/sorts times for the "any doctor" vs. specific-doctor filter without re-fetching.
- `removeStaleSlot` — removes exactly the rejected `(practitionerId, localStartTime)` pair, nothing else.
- `isSlotUnavailableError` — detects the exact `409 { code: 'SLOT_UNAVAILABLE' }` shape (never matches `INVALID_NOTICE_EVIDENCE` or other errors).

On a `SLOT_UNAVAILABLE` 409, `handleSubmit`'s catch block:
- leaves `patientName`, `phone`, `email`, `notes`, `selectedService`, `selectedDoctor` untouched,
- clears only the rejected time (`selectedTime` / `selectedSlotPractitionerId`) and removes it from local state,
- returns to step 1 (date/time selection),
- immediately refetches availability,
- shows a specific localized banner (`booking:errors.slotUnavailable`) instead of the generic `submitFailed` message,
- requires no page reload.

Translations added to all four locales (`src/locales/{tr,en,fr,de}/booking.json`): `errors.slotUnavailable`, `schedule.slotsLoading`, `schedule.slotsEmpty`, `schedule.slotsError`.

## 4. KVKK notice-evidence retry behavior (unchanged, verified correct)

`server/src/services/publicBookingNoticeEvidence.ts` and the submit transaction in `publicBooking.ts` already had the correct shape for this case and needed no code change:

- `assertSlotAvailable` is awaited **before** `appointmentRequest.create` and **before** `linkNoticeEvidenceToRequest`, all inside one `prisma.$transaction`. A `SlotConflictError` thrown there rolls back the entire transaction — no `AppointmentRequest` row and no evidence link are ever persisted for a failed submission.
- The evidence row issued by `POST /notice-evidence` therefore remains valid and unlinked (`appointmentRequestId: null`) after a `SLOT_UNAVAILABLE` failure, and the widget reuses the same token on retry without asking for consent or showing any additional checkbox.
- A successful retry creates exactly one `AppointmentRequest` and links exactly one evidence row to it (`linkNoticeEvidenceToRequest`'s guarded `updateMany({ where: { id, appointmentRequestId: null } })` ensures at most one link ever succeeds per evidence row).

Verified by two new tests in `publicBookingSlotConsistency.test.ts` ("a rolled-back SLOT_UNAVAILABLE transaction never calls linkNoticeEvidenceToRequest" and "successful retry ... links exactly one evidence row").

## 5. Concurrency

The advisory lock (`pg_advisory_xact_lock`) + in-transaction re-check remains the final guard and is untouched by this fix. `publicBookingSlotConsistency.test.ts` includes a deterministic two-submitter race simulation (mirroring the existing pattern in `appointmentRequestOverlapSafety.test.ts`): exactly one submission succeeds, the other receives `SlotConflictError` (→ 409 `SLOT_UNAVAILABLE`), no double `AppointmentRequest` is created, the loser's evidence stays unlinked, and the winner's evidence links to the created request.

## 6. Files changed

- `server/src/services/whatsappAvailability.ts` — `buildAvailableSlots` now uses canonical overlap/conflict checks; optional `appointmentTypeId`.
- `server/src/routes/publicBooking.ts` — new `GET /booking/:clinicId/slots` endpoint.
- `server/src/tests/publicBookingSlotConsistency.test.ts` — new (14 tests).
- `server/package.json` — new `test:public-booking-slots` script, wired into `test`.
- `src/pages/bookingWidgetHelpers.ts` — new pure helpers.
- `src/pages/__tests__/bookingWidgetHelpers.test.ts` — new (16 tests).
- `src/pages/BookingWidget.tsx` — real slot fetching + 409 recovery flow.
- `src/services/api.ts` — `publicBookingService.getSlots`.
- `src/locales/{tr,en,fr,de}/booking.json` — new translation keys.
- `package.json` — new `test:booking-widget-helpers` script.
- `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` — cross-reference only, no change to KVKK-CRIT-001a's legal interpretation or status.

## 7. Tests and results

- Backend: `npm run typecheck` (server) — 0 errors.
- Frontend: `npm run build` (`tsc -b && vite build`) — succeeded (pre-existing chunk-size warnings only, unrelated).
- `npm run test:public-booking-slots` (new) — 14/14 passed.
- `npm run test:booking-widget-helpers` (new, frontend) — 16/16 passed.
- `npm run test:overlap-safety` — 31/31 passed (no regression).
- `npm run test:availability-service` — 31/31 passed (no regression).
- `npm run test:public-booking` — 19/19 passed (no regression).
- `npm run test:notice-evidence` — 18/18 passed (no regression).
- `npm run test:fixtures`, `npm run test:whatsapp`, `npm run test:schedule` (WhatsApp AI booking flows that also call `buildAvailableSlots`) — all passed, no regression from the unified conflict check.
- Full backend suite (`npm test`, server, 49 scripts) — all passed, 0 failures.

## 8. Browser acceptance — NOT performed this session

This defect record does **not** include real-browser (Playwright/Chromium) acceptance evidence or screenshots. This session had no staging/production environment or seeded disposable database available to bring up the full stack (Postgres + backend + frontend dev servers) for a live three-scenario run. Fabricating screenshots was avoided per policy.

**Required before merge/deploy sign-off:**
1. Spin up a disposable Postgres + seed a clinic with a published `ClinicLegalProfile`, a doctor with working hours, and a pending `AppointmentRequest` for a known slot.
2. **Scenario A:** load the booking widget for that date — confirm the pending-request slot is absent from the rendered times.
3. **Scenario B:** load availability in Browser 1, reserve the same slot in Browser 2 (or via direct API call), submit the stale slot in Browser 1 — confirm: return to step 1, form fields intact, stale slot gone from the list, the specific "Bu saat az önce doldu..." banner shown (not the generic failure message), and selecting another slot succeeds.
4. **Scenario C:** confirm the successful retry created exactly one `AppointmentRequest` with exactly one linked `PublicBookingNoticeEvidence` row (`SELECT appointmentRequestId FROM "PublicBookingNoticeEvidence" WHERE ...`).
5. Capture screenshots + network/console logs for all three scenarios and attach them to the PR before merging.

## 9. Deployment requirement

No database migration is required — this is application-logic only (no schema change). Both changed services (`whatsappAvailability.ts`, `publicBooking.ts`) are used by the existing running Node process; a standard deploy (build + restart) is sufficient. No feature flag was introduced — the new endpoint is additive and the old static-slot-list code path in `BookingWidget.tsx` has been removed, so this must ship as a single atomic frontend+backend deploy (an old frontend bundle calling the old submit flow without the new endpoint would still work correctly via the existing submit-time guard, but would not get the improved recovery UX or corrected availability — there is no scenario where a partial deploy causes incorrect bookings, only degraded UX until both sides are live).

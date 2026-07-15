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
- `npm run test:public-booking-slots` (new) — 17/17 passed (14 original + 3 added for the §8b timezone fix).
- `npm run test:booking-widget-helpers` (new, frontend) — 16/16 passed.
- `npm run test:overlap-safety` — 31/31 passed (no regression).
- `npm run test:availability-service` — 31/31 passed (no regression).
- `npm run test:public-booking` — 19/19 passed (no regression).
- `npm run test:notice-evidence` — 18/18 passed (no regression).
- `npm run test:fixtures`, `npm run test:whatsapp`, `npm run test:schedule` (WhatsApp AI booking flows that also call `buildAvailableSlots`) — all passed, no regression from the unified conflict check.
- Full backend suite (`npm test`, server, 49 scripts) — all passed, 0 failures.

## 8. Browser acceptance — PASSED (real Playwright/Chromium run, disposable Postgres)

Performed against a disposable, throw-away Postgres container (not the shared `noramedi_smoke` DB) with the real backend (`tsx src/index.ts`) and real Vite dev server, driven by Playwright/Chromium (v1.61.1) via an ad-hoc script (not part of the permanent test suite).

**Environment:**
- Postgres 16-alpine in Docker (`docker run --name nmc-e2e-pg -p 55501:5432 ...`), migrated with `prisma migrate deploy`.
- Backend: `tsx watch src/index.ts` on `127.0.0.1:5501`, `DATABASE_URL` pointed at the disposable container.
- Frontend: `vite --port 5183 --strictPort`, `VITE_API_URL=http://127.0.0.1:5501/api`.
- Seed: `server/prisma/seed.e2e-booking.ts` — creates an Organization/Clinic with a **published** `ClinicLegalProfile`, two active doctors ("Doktor Alfa", "Doktor Beta") both available 09:00–17:00 on the target weekday (shared-time fixture for Scenario D), one active service, and one **pending** `AppointmentRequest` occupying Doktor Alfa's 10:00 slot on the target date (Scenario A fixture).
- Exact seed/reset commands:
  ```bash
  docker run -d --name nmc-e2e-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2epass -e POSTGRES_DB=nmc_e2e -p 55501:5432 postgres:16-alpine
  DATABASE_URL=postgresql://e2e:e2epass@127.0.0.1:55501/nmc_e2e?schema=public npx prisma migrate deploy
  DATABASE_URL=postgresql://e2e:e2epass@127.0.0.1:55501/nmc_e2e?schema=public npx tsx prisma/seed.e2e-booking.ts
  ```
- Exact test command: `node e2e-artifacts/run-acceptance.cjs` (requires Playwright's `chromium` package resolvable on `NODE_PATH`).

**Results:**

| Scenario | Result |
|---|---|
| A — pending request hides its slot | **PASS.** Doktor Alfa's 10:00 (held by the seeded pending `AppointmentRequest`) is absent from the rendered time list; 09:00 and other free times remain offered. Doktor Beta's independent 10:00 slot correctly remains visible (only Alfa's specific slot was ever supposed to be blocked). |
| B — stale-slot recovery | **PASS.** Browser 2 books Doktor Alfa's 11:00 first and succeeds (`201`). Browser 1's stale submission of the same slot returns `409 { code: 'SLOT_UNAVAILABLE' }`; it returns to step 1, form fields (name/phone/email/notes) are preserved (verified once step 2 is re-reached — they're not present in the DOM at step 1, by design), the stale 11:00 button disappears after the automatic refetch, the exact localized banner "Bu saat az önce doldu. Bilgileriniz korundu; lütfen başka bir saat seçin." is shown, no reload occurs, and reselecting 11:30 + submitting succeeds (`201`). |
| C — KVKK notice-evidence linkage | **PASS** (see §8a DB evidence below). |
| D — practitioner correctness (shared time) | **PASS.** In "any doctor" mode, 09:00 (shared by both doctors) renders as exactly one button (deterministic lowest-`practitionerId` tie-break — see `bookingWidgetHelpers.ts`). Filtering explicitly to Doktor Beta and selecting 09:00 selects Beta's own tuple, confirmed selectable and distinct. |
| E — mobile viewport | **PASS.** 375×812 viewport: widget renders, date/time selection and recovery flow remain usable; screenshot captured. |

**Console/network:** No unexpected console errors. Two categories of console entries, both expected and pre-existing (not from this hotfix): a benign `401` on `/api/auth/me` fired by the app shell's global auth probe on the (unauthenticated, public) booking route, and the intentional `409` from the Scenario B stale-slot submission. No failed network requests (`requestfailed`) were recorded in any scenario.

### 8a. DB verification (Scenario C)

```
AppointmentRequest: 3 rows total
  - seed fixture "Mevcut Bekleyen Talep" (pending, Alfa 10:00)
  - "Musteri B2" (pending, Alfa 11:00) — the WINNING submission
  - "Musteri B1" (pending, Alfa 11:30) — B1's SUCCESSFUL RETRY after recovery
  (B1's original stale 11:00 submission created NO row — confirmed absent)

PublicBookingNoticeEvidence: 5 rows total (one per browser session)
  - exactly 2 rows have a non-null appointmentRequestId, each pointing to a
    DIFFERENT AppointmentRequest id (B2's and B1's retry) — no duplicate links
  - B1's evidence row is the SAME row across both the failed submission and
    the successful retry (same tokenHash/session): confirms the evidence
    token is NOT consumed by a SLOT_UNAVAILABLE failure and remains validly
    reusable, exactly as designed
  - all rows store only tokenHash (SHA-256 hex), never the raw token
  - clinicId, noticeVersion ("v1-e2e"), channel ("web_booking") consistent
    across all rows
```

### 8b. Bug found during this acceptance run, fixed

**Real defect, caught only by exercising the actual submit path across a server host timezone different from the clinic's:** `server/src/routes/publicBooking.ts`'s submit handler built `preferredStartTime`/`preferredEndTime` with a bare `new Date(\`${preferredDate}T${preferredTime}:00\`)`. A date string with no UTC/offset suffix is parsed by the JS engine in the **process's own OS-local timezone** — not the clinic's configured timezone (`Clinic.timezone`, e.g. `Europe/Istanbul`). `buildAvailableSlots` (the availability/display side) already converted correctly using the clinic's IANA timezone. Whenever the server host's local timezone differs from the clinic's — proven on this dev host (`Europe/Paris`, UTC+2 in July) vs. the seeded clinic (`Europe/Istanbul`, fixed UTC+3) — the two computations silently disagreed by a full hour: the customer clicks "11:00" (correctly computed as Istanbul time), but the backend would check/store availability for an entirely different real-world instant. This is exactly the class of correctness bug this hotfix set out to close, just one layer deeper (submission, not display) and only reachable in real cross-timezone deployment — which is why prior sessions' code review and unit tests, which don't exercise the real OS timezone/Date machinery end-to-end, never surfaced it.

**Fix:** exported the existing clinic-timezone-aware converter (`localDateTimeToClinicDate`, already used internally by `buildAvailableSlots`) from `whatsappAvailability.ts`, and made the submit handler call it with the clinic's own `timezone` column instead of the naive `new Date(...)` parse. Added format validation (`ISO_DATE_RE` / `HH:MM` regex) before conversion. Regression coverage added in `publicBookingSlotConsistency.test.ts`: asserts the exact UTC instant `localDateTimeToClinicDate` produces for a known clinic-local time (independent of the host's own timezone), and a source-scan assertion that the naive parse is not reintroduced. Re-verified via a fresh acceptance run after the fix: Scenario B's winning/retry `AppointmentRequest` rows now land at the exact clinic-local instants the customer selected (11:00 → `08:00Z`, 11:30 → `08:30Z` — correct for `Europe/Istanbul`).

**Files changed by this fix:** `server/src/services/whatsappAvailability.ts` (export `localDateTimeToClinicDate`), `server/src/routes/publicBooking.ts` (use it; select `clinic.timezone`), `server/src/tests/publicBookingSlotConsistency.test.ts` (+3 tests, 17/17 passing).

**Artifacts** (local, not committed to the repo — generated by `e2e-artifacts/run-acceptance.cjs`): screenshots (`scenario-A-slots.png`, `scenario-B-*.png`, `scenario-D-*.png`, `scenario-E-mobile-slots.png`), `console.log`, `network.log`, `results.json`, `seed-output.json`.

## 9. Deployment requirement

No database migration is required — this is application-logic only (no schema change). Both changed services (`whatsappAvailability.ts`, `publicBooking.ts`) are used by the existing running Node process; a standard deploy (build + restart) is sufficient. No feature flag was introduced — the new endpoint is additive and the old static-slot-list code path in `BookingWidget.tsx` has been removed, so this must ship as a single atomic frontend+backend deploy (an old frontend bundle calling the old submit flow without the new endpoint would still work correctly via the existing submit-time guard, but would not get the improved recovery UX or corrected availability — there is no scenario where a partial deploy causes incorrect bookings, only degraded UX until both sides are live).

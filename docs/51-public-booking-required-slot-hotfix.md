# 51 — Public Booking: Require a Real Selected Slot (Hotfix)

Branch: `hotfix/public-booking-require-real-slot` (based on `hotfix/public-booking-slot-consistency-and-recovery` @ `d5cb1bc`)
Date: 2026-07-15

## 1. Production evidence

- The public booking widget displayed: "Bu tarihte uygun saat bulunamadı. Lütfen başka bir tarih seçin." (no available time on this date).
- The "Devam Et" (Continue) button remained enabled.
- The customer continued anyway and successfully created an `AppointmentRequest`.
- The CRM showed "Talep Edilen Saat: -" (Requested Time: -) for that request.
- The edit modal also showed no available time for the selected date.

## 2. Root cause (proven, not assumed)

Two independent gaps, both now closed:

**2a. Backend: `server/src/routes/publicBooking.ts`'s `POST /booking/:clinicId` handler had a "partial request" fallback branch (previously lines ~394–434) that created an `AppointmentRequest` whenever `practitionerId` / `preferredStartTime` / `preferredEndTime` were not *all* present** — with the missing fields simply stored as `null`. Nothing in the handler required the public widget to have selected an exact slot; the branch existed to let WhatsApp/Instagram's AI-assisted booking flows create an under-specified request for staff to fill in later (those channels have a human reviewing every request). The public widget shares this same POST endpoint but has no such review step, so any submission that reached this code path with a missing slot silently produced exactly the malformed row seen in production (`practitionerId: null`, `preferredStartTime: null`, `preferredEndTime: null` → CRM renders "Talep Edilen Saat: -").

**2b. Frontend: `src/pages/BookingWidget.tsx`'s Step-1 "Devam Et" button had no `disabled` condition at all** (`BookingWidget.tsx:609-614`, pre-fix). The schedule step's own labels called every field "opsiyonel" (optional) — service, doctor, date, and time were all literally optional in the UI, and clicking Continue never checked `selectedTime`/`selectedSlotPractitionerId`. `handleSubmit` also never validated slot selection before calling `publicBookingService.submit(...)`; it fell back `practitionerId: selectedTime ? selectedSlotPractitionerId : selectedDoctor || undefined` — so with no date/time chosen at all, the submit payload had `practitionerId: undefined`, `preferredDate: undefined`, `preferredTime: undefined`, which is exactly the payload that hit the backend's now-removed partial-request branch.

The two gaps compounded: even if only one had been fixed, the other still allowed the defect (a disabled-but-bypassable frontend button would have been moot if the backend still silently accepted incomplete payloads; a backend-only fix would have left the frontend showing "no available time" while the button stayed clickable and misled the customer into thinking their tap did nothing, when it actually silently degraded to a malformed request).

**Not the cause (verified unchanged):** `GET /booking/:clinicId/slots` (`buildAvailableSlots`) already computed real, conflict-checked slots correctly (see docs/50); the notice-evidence flow, advisory lock, and `assertSlotAvailable` were already correct and are unmodified by this fix except for one adjacent bug found during acceptance testing — see §2c.

**2c. Adjacent bug found during browser acceptance, fixed in the same change:** the submit handler only computed `preferredEndTime` `if (svc)` — i.e. only when a `serviceId` was supplied. The widget's Step-0 "Hizmet seçmeden devam et" (continue without selecting a service) is an explicitly supported path, and `GET /slots` already falls back to `DEFAULT_SLOT_DURATION_MINUTES` (30 min) when no service is chosen, so the widget legitimately displays and lets a customer select real slots with no `serviceId`. Without this fix, a customer who used "no service" and picked one of those displayed slots would still be rejected with the new `SLOT_REQUIRED` error, because `preferredEndTime` could never be computed — a real, customer-visible regression this hotfix would otherwise have introduced. Caught only by driving the real "no service" path in the browser acceptance run (§8, Scenario C); not fixable by disabling the "continue without service" affordance, since that would be removing supported functionality unrelated to the reported defect.

## 3. Fix

### 3a. Backend: full slot info is now mandatory, unconditionally

`server/src/routes/publicBooking.ts`:
- The `hasFullSlotInfo` gate is now a hard precondition, checked immediately after `preferredStartTime`/`preferredEndTime` are computed and *before* any further DB work (patient lookup, lock, or `AppointmentRequest` creation):
  ```ts
  if (!hasFullSlotInfo) {
    return res.status(400).json({
      error: 'Please select an available appointment time.',
      code: 'SLOT_REQUIRED',
    });
  }
  ```
- The entire "partial request" fallback branch (the second `prisma.$transaction(...)` block that used to create an `AppointmentRequest` without full slot info) has been **deleted**, not merely made unreachable — there is now exactly one `appointmentRequest.create` call in the file, on the lock-protected full-slot path.
- `preferredEndTime` is now always computed once `preferredStartTime` resolves, using `svc?.durationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES` (the same default `buildAvailableSlots` uses) instead of only when a service was selected — see §2c.
- `checkPractitionerAvailabilityForSlot` → `acquireAppointmentSlotLock` → `assertSlotAvailable` → `appointmentRequest.create` → `linkNoticeEvidenceToRequest`, all inside one `prisma.$transaction`, are otherwise **unchanged** — the advisory lock, overlap check, and `SLOT_UNAVAILABLE` race-recovery contract from docs/50 are untouched.
- `DEFAULT_SLOT_DURATION_MINUTES` is now exported from `server/src/services/whatsappAvailability.ts` (previously module-private) so `publicBooking.ts` can share the exact same constant `buildAvailableSlots` uses — no risk of the two values drifting apart.

**WhatsApp/Instagram unaffected:** those AI-assisted booking flows create `AppointmentRequest` rows through entirely separate code (`server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`, `server/src/services/instagram/instagramAiConversationProcessor.ts`, `server/src/routes/whatsapp.ts`, `server/src/routes/whatsappInbox.ts`, `server/src/routes/messages.ts`, `server/src/routes/organizationWhatsApp.ts`, `server/src/routes/instagramInbox.ts`, `server/src/routes/appointmentRequests.ts`) — none of them call `publicBooking.ts`'s POST handler, and none of those files were touched. `npm run test:fixtures`, `npm run test:whatsapp`, and `npm run test:schedule` (which exercise the WhatsApp AI booking flows and `buildAvailableSlots`) all pass unchanged.

### 3b. Frontend: an exact slot is required before "Devam Et" is clickable

`src/pages/bookingWidgetHelpers.ts` gained a new pure helper, `hasValidSlotSelection(selectedTime, selectedSlotPractitionerId)`, used both by the Step-1 Continue button and as the defense-in-depth guard in `handleSubmit`:

`src/pages/BookingWidget.tsx`:
- Step-1 "Devam Et" button: `disabled={!hasValidSlotSelection}` — a date or practitioner chosen alone no longer enables it; only an exact `(practitionerId, localStartTime)` tuple does.
- `handleSubmit` now checks `hasValidSlotSelection` **first**, before the name/phone/notice checks, and before ever calling `publicBookingService.submit(...)`. This is the actual bypass guard: it does not rely on the Step-1 button being disabled, so stale React state, a forced `setStep(2)`, or a keyboard-triggered submit on a re-enabled control still cannot reach the network without a real slot.
- `practitionerId` sent to the backend is now always `selectedSlotPractitionerId` (previously a `selectedTime ? ... : selectedDoctor || undefined` fallback that could send an unresolved/ambiguous practitioner) — safe because `handleSubmit`'s new guard guarantees `selectedTime`/`selectedSlotPractitionerId` are both set by the time this line runs.
- Selecting a service, a practitioner, or a date now explicitly clears `selectedTime`/`selectedSlotPractitionerId` at the point of selection (not only via the date-change `useEffect`, which previously had a gap: switching directly from one specific doctor to "any doctor" without an intervening date change never cleared a stale time selection). The `useEffect`'s early-return branch (`!selectedDate`) now also clears the time/practitioner state, so clearing the date directly (or indirectly, via a doctor change that resets it) can no longer leave a stale, hidden slot selection behind.
- When zero slots are available for the selected date, the existing `booking:schedule.slotsEmpty` message ("Bu tarihte uygun saat bulunamadı...") continues to render, and Continue is now also disabled (previously it was not).
- When slots exist but none is yet selected, a new message renders: `booking:schedule.slotRequired` — "Devam etmek için uygun bir saat seçmelisiniz." (tr). Added to all four locales:
  - tr: "Devam etmek için uygun bir saat seçmelisiniz."
  - en: "You must select an available time to continue."
  - fr: "Vous devez sélectionner un horaire disponible pour continuer."
  - de: "Sie müssen eine verfügbare Uhrzeit auswählen, um fortzufahren."
- Customer contact fields (name/phone/email/notes) are unaffected by any of the above clearing logic — only `selectedTime`/`selectedSlotPractitionerId` are cleared, exactly as the existing `SLOT_UNAVAILABLE` recovery flow from docs/50 already did.

## 4. Public API error contract

`POST /api/public/booking/:clinicId` now returns, when the request lacks a complete slot:

```
HTTP 400
{
  "error": "Please select an available appointment time.",
  "code": "SLOT_REQUIRED"
}
```

Guarantees for this response:
- no `AppointmentRequest` row is created (the check runs before `prisma.patient.findFirst`, before any `prisma.$transaction`, and before `linkNoticeEvidenceToRequest`),
- no notice-evidence link is created — the evidence token issued by `POST /notice-evidence` remains valid and unlinked, reusable for the customer's next (complete) submission,
- no generic 500 — this is a normal, expected validation outcome, not an error path,
- no silent fallback to staff assignment — there is no code path left that creates a request without a slot.

`SLOT_UNAVAILABLE` (409, race-losing submission) and the advisory-lock/`assertSlotAvailable` flow are unchanged from docs/50.

## 5. KVKK notice-evidence behavior

- `SLOT_REQUIRED`: no `AppointmentRequest`, no evidence link, evidence token unchanged (still valid/unlinked) — verified in `server/src/tests/publicBookingSlotRequired.test.ts` via a mock transaction client that asserts `appointmentRequest.create` and the evidence `updateMany` are never invoked.
- A later valid, complete submission (same or a fresh notice-evidence token) creates exactly one `AppointmentRequest` and links exactly one evidence row — unchanged from docs/50, re-verified live in §8 Scenario D (winner's evidence links; loser's stays unlinked after `SLOT_UNAVAILABLE`, matching the pre-existing recovery contract) and Scenario C (DB-verified below).
- No consent/acknowledgment control was added or implied by this change — the notice-evidence mechanism remains automatic-delivery evidence only, per `server/src/services/publicBookingNoticeEvidence.ts`.

## 6. Existing malformed production requests

**Identification (read-only SQL, safe to run against production):**

```sql
-- Public-widget appointment requests with an incomplete slot
-- (the exact shape the pre-fix "partial request" branch produced).
SELECT
  id,
  "clinicId",
  "patientName",
  phone,
  "practitionerId",
  "preferredStartTime",
  "preferredEndTime",
  status,
  "createdAt"
FROM "AppointmentRequest"
WHERE source = 'widget'
  AND ("preferredStartTime" IS NULL OR "preferredEndTime" IS NULL)
ORDER BY "createdAt" DESC;
```

Count only, for a quick production check:

```sql
SELECT COUNT(*) AS malformed_widget_requests
FROM "AppointmentRequest"
WHERE source = 'widget'
  AND ("preferredStartTime" IS NULL OR "preferredEndTime" IS NULL);
```

Per clinic, to scope outreach/cleanup by tenant:

```sql
SELECT "clinicId", COUNT(*) AS malformed_count
FROM "AppointmentRequest"
WHERE source = 'widget'
  AND ("preferredStartTime" IS NULL OR "preferredEndTime" IS NULL)
GROUP BY "clinicId"
ORDER BY malformed_count DESC;
```

**No destructive SQL was run.** These rows are not deleted automatically. Proposed (not executed) cleanup options, for the team to choose and run manually after review:

1. **Mark for staff follow-up (least destructive, recommended):** leave the rows as-is — they are exactly the "no confirmed slot yet" requests staff were always meant to review and call the patient about (`status = 'pending'`), which is still a valid workflow outcome for these specific rows, just no longer reachable going forward from the public widget.
2. **If confirmed unreachable/stale (optional, requires manual review first):**
   ```sql
   -- NOT executed. Review the SELECT above first; only run per-clinic after
   -- confirming with clinic staff that these specific requests are already
   -- resolved/duplicated/abandoned.
   UPDATE "AppointmentRequest"
   SET status = 'closed'
   WHERE source = 'widget'
     AND ("preferredStartTime" IS NULL OR "preferredEndTime" IS NULL)
     AND status = 'pending'
     AND "createdAt" < NOW() - INTERVAL '30 days';
   ```

## 7. Tests and results

New/updated files:
- `server/src/tests/publicBookingSlotRequired.test.ts` — **new**, 9/9 passing: `hasFullSlotInfo` gating for each missing piece (practitionerId, date, time, end time), no-DB-write/no-evidence-link proof, and three source-scan assertions locking in that the partial-create branch cannot silently return.
- `server/src/tests/publicBookingAvailability.test.ts` — doc comments updated to describe the new `SLOT_REQUIRED` contract (no behavior change); 19/19 passing.
- `src/pages/bookingWidgetHelpers.ts` — new `hasValidSlotSelection` helper.
- `src/pages/__tests__/bookingWidgetHelpers.test.ts` — 4 new tests (zero slots, time-only, practitioner-only, valid tuple); 26/26 passing.
- `server/package.json` — new `test:public-booking-slot-required` script, wired into `test`.

Results:
- Backend typecheck (`npx tsc --noEmit`, `server/`) — 0 errors.
- Frontend typecheck + build (`npx tsc --noEmit`; `npm run build`) — 0 errors, build succeeded (pre-existing chunk-size warnings only, unrelated).
- `npm run test:public-booking-slot-required` (new) — 9/9 passed.
- `npm run test:public-booking` — 19/19 passed (no regression).
- `npm run test:public-booking-slots` — 17/17 passed (no regression).
- `npm run test:notice-evidence` — 18/18 passed (no regression).
- `npm run test:overlap-safety` — 31/31 passed (no regression).
- `npm run test:availability-service` — 31/31 passed (no regression).
- `npm run test:fixtures`, `npm run test:whatsapp`, `npm run test:schedule` (WhatsApp/Instagram AI booking flows + `buildAvailableSlots`) — all passed, no regression from exporting `DEFAULT_SLOT_DURATION_MINUTES`.
- Frontend `bookingWidgetHelpers.test.ts` — 26/26 passed (22 pre-existing + 4 new).

## 8. Browser acceptance — PASSED (real Playwright/Chromium run, disposable Postgres)

Performed against a disposable, throw-away Postgres container (`nmc-hotfix51-pg`, port 55502, removed after the run) with the real backend (`tsx src/index.ts`, port 5502) and real Vite dev server (port 5184), driven by Playwright/Chromium via an ad-hoc script (not part of the permanent test suite): `e2e-artifacts/hotfix-51/run-acceptance.cjs`.

**Environment:**
```bash
docker run -d --name nmc-hotfix51-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2epass -e POSTGRES_DB=nmc_e2e_51 -p 55502:5432 postgres:16-alpine
DATABASE_URL=postgresql://e2e:e2epass@127.0.0.1:55502/nmc_e2e_51?schema=public npx prisma migrate deploy
DATABASE_URL=postgresql://e2e:e2epass@127.0.0.1:55502/nmc_e2e_51?schema=public npx tsx prisma/seed.e2e-booking.ts
# backend: PORT=5502, DATABASE_URL pointed at the disposable container, tsx src/index.ts
# frontend: VITE_API_URL=http://127.0.0.1:5502/api, vite --port 5184 --strictPort
node e2e-artifacts/hotfix-51/run-acceptance.cjs
```
Reused `server/prisma/seed.e2e-booking.ts` from docs/50 (Organization/Clinic with a published `ClinicLegalProfile`, two doctors both available 09:00–17:00 on the target weekday, one active service, one pending `AppointmentRequest` blocking one doctor's 10:00 slot).

**Results:**

| Scenario | Result |
|---|---|
| A — zero-slot date | **PASS.** A date whose weekday has no `doctorAvailability` rows for either doctor renders `slotsEmpty` ("Bu tarihte uygun saat bulunamadı...") and Continue stays disabled. No POST fired. |
| B — date with slots, no time chosen | **PASS.** `slotRequired` message ("Devam etmek için uygun bir saat seçmelisiniz.") renders once slots finish loading; Continue stays disabled. |
| C — valid exact slot | **PASS.** Continue enables immediately on slot selection; submission returns `201 { success: true, requestId }`; DB row has the exact selected `practitionerId`/`preferredStartTime`/`preferredEndTime` (see §8a). This run also exercised the "continue without service" path and caught the §2c bug live, which was then fixed and re-verified in this same run. |
| D — two browsers race the same slot | **PASS.** Winner: `201`, success screen. Loser: `409 { code: 'SLOT_UNAVAILABLE' }`, recovery banner shown ("Bu saat az önce doldu..."), returned to step 1, Continue disabled again until a new real slot is selected. |
| E — direct POST, no slot fields | **PASS.** `400 { error: 'Please select an available appointment time.', code: 'SLOT_REQUIRED' }`. Zero DB writes (verified in §8a — no row for this attempt exists). |

**Console/network:** no unexpected errors. Only the pre-existing, documented benign `401` on `/api/auth/me` (the app shell's global unauthenticated-probe on the public booking route, unrelated to this fix — see docs/50 §8) and the intentional `409` from Scenario D's loser. No `requestfailed` events in any scenario.

### 8a. DB verification

```
AppointmentRequest: 3 rows total
  - seed fixture "Mevcut Bekleyen Talep" (pending, docA 10:00 Europe/Istanbul → 07:00 UTC)
  - "Musteri C" (pending, docB 09:00 → 06:00 UTC) — Scenario C, "continue without service" path,
    preferredEndTime correctly defaulted to 30 min (§2c fix)
  - "Musteri D-Winner" (pending, docB 12:00 → 09:00 UTC) — Scenario D winner
  (Scenario A, B, E, and D's loser produced NO rows — confirmed: exactly 3 rows exist,
   matching exactly the 3 successful submissions across all 5 scenarios)

PublicBookingNoticeEvidence: 21 rows total (one per issued session across all scenario runs)
  - exactly 2 rows have a non-null appointmentRequestId (Musteri C's, Musteri D-Winner's)
  - all other rows (including Scenario D's loser and every SLOT_REQUIRED attempt) remain
    unlinked — confirmed no evidence was consumed for a rejected/incomplete submission
```

### 8b. Bug found during this acceptance run, fixed

See §2c above (`preferredEndTime` not computed when no service was selected). Fixed in the same commit as the rest of this hotfix; re-verified live by re-running the full 5-scenario suite after the fix — all 5 passed on the second run (first run: A/B failed on timing-flake in the test script itself, not the app — see script fix; C/D failed on the real §2c bug; E was rate-limited by a prior run's cumulative submissions, not a defect).

**Artifacts** (local, not committed — generated by `e2e-artifacts/hotfix-51/run-acceptance.cjs`): `scenario-A-zero-slots.png`, `scenario-B-no-time-selected.png`, `scenario-C-success.png`, `scenario-D-winner.png`, `scenario-D-loser-recovery.png`, `console.log`, `network.log`, `results.json`.

## 9. Files changed

- `server/src/routes/publicBooking.ts` — removed the partial-request fallback branch; added the `SLOT_REQUIRED` 400 precondition; `preferredEndTime` now defaults to `DEFAULT_SLOT_DURATION_MINUTES` when no service is selected.
- `server/src/services/whatsappAvailability.ts` — `DEFAULT_SLOT_DURATION_MINUTES` exported (was module-private).
- `server/src/tests/publicBookingSlotRequired.test.ts` — new (9 tests).
- `server/src/tests/publicBookingAvailability.test.ts` — doc-comment updates only (reflects the removed partial path).
- `server/package.json` — new `test:public-booking-slot-required` script, wired into `test`.
- `src/pages/bookingWidgetHelpers.ts` — new `hasValidSlotSelection` helper.
- `src/pages/__tests__/bookingWidgetHelpers.test.ts` — 4 new tests.
- `src/pages/BookingWidget.tsx` — Continue button gated on an exact slot; `handleSubmit` defense-in-depth guard; explicit slot-clearing on service/doctor/date change.
- `src/locales/{tr,en,fr,de}/booking.json` — new `schedule.slotRequired` key.
- `docs/51-public-booking-required-slot-hotfix.md` — this document.

## 10. Deployment requirement

No database migration is required — this is application-logic only (no schema change). This must ship as a single atomic frontend+backend deploy: an old frontend bundle (pre-fix, Continue always enabled) talking to the new backend would get clean `400 SLOT_REQUIRED` rejections instead of silently-created malformed rows (a strict improvement, not a regression, so a backend-first partial deploy is safe); a new frontend talking to an old backend would have its Continue-button guard be pure UX (the old backend would still silently accept an incomplete payload if one ever reached it, which the new frontend by construction never sends) — so backend-first is the safer deploy order if the two cannot ship in the same window, but same-window deploy is still recommended to close the window during which the old backend's partial-request branch remains reachable by any other unpatched client.

### Deployment commands

```bash
git fetch origin
git checkout hotfix/public-booking-require-real-slot
git pull origin hotfix/public-booking-require-real-slot

# Backend
cd server
npm ci
npx tsc --noEmit          # sanity check before restart
npm run build              # if the deploy pipeline builds a dist/ bundle
pm2 restart noramedi-api   # or the equivalent process manager restart for this environment

# Frontend
cd ..
npm ci
npm run build
# deploy dist/ via the existing static-asset pipeline
```

### Production verification steps (post-deploy)

```bash
# 1. Confirm the new error contract is live (expect 400 SLOT_REQUIRED, no row created):
curl -i -X POST https://api.<prod-host>/api/public/booking/<a-real-clinicId> \
  -H 'Content-Type: application/json' \
  -d '{"patientName":"Prod Verify","phone":"+905551234567","noticeEvidenceToken":"<a-freshly-issued-token>"}'
# expect: HTTP/1.1 400, body {"error":"Please select an available appointment time.","code":"SLOT_REQUIRED"}

# 2. Confirm a real widget booking still succeeds end-to-end (manual, in a browser,
#    against a real clinic's public booking URL): select service/doctor/date/time,
#    submit, confirm 201 and the CRM shows the exact requested time (not "-").

# 3. Confirm no new malformed rows appear going forward (run periodically for the
#    first 24-48h after deploy — should return 0 new rows created after the deploy
#    timestamp):
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM \"AppointmentRequest\"
  WHERE source = 'widget'
    AND (\"preferredStartTime\" IS NULL OR \"preferredEndTime\" IS NULL)
    AND \"createdAt\" > '<deploy-timestamp>';
"
```

### Log-check commands

```bash
# Watch for any unexpected 500s on the public booking endpoints post-deploy:
pm2 logs noramedi-api --lines 500 | grep -E "public/booking|SLOT_REQUIRED|SLOT_UNAVAILABLE"

# Confirm SLOT_REQUIRED is being returned (expected, healthy) and not swallowed
# into a generic 500 (would indicate a deploy issue):
pm2 logs noramedi-api --lines 1000 | grep "Failed to submit booking request"
# ^ this string only appears in the outer catch-all 500 handler — it should NOT
#   appear for a simple missing-slot submission after this deploy.
```

## 11. Remaining risks

- Existing malformed production rows (§6) are not automatically remediated — requires manual/staff-driven review per clinic before any status change.
- The `SLOT_REQUIRED` rejection is currently not distinguished from `INVALID_NOTICE_EVIDENCE` by HTTP status alone (both 400) — clients must branch on the `code` field, exactly as the frontend does (`isSlotUnavailableError` already does this correctly for the 409 case; the frontend's `handleSubmit` guard prevents `SLOT_REQUIRED` from ever being sent in the first place, so no client-side branching on this specific code was needed, but any future direct API integration must not assume 400 always means the same thing).
- No rate-limit or abuse-specific handling was added for repeated `SLOT_REQUIRED` submissions from the same IP beyond the existing `bookingSubmitLimiter` (10/15min/IP), which already covers this.

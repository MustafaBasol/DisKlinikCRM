# Aile Dis CRM Adaptation Plan

This document tracks the work to adapt Health CRM MVP into a single-branch Aile Dis clinic operations CRM.

Source site reviewed:

- https://ailedis.com/
- https://ailedis.com/hizmetlerimiz/
- https://ailedis.com/ekibimiz/
- https://ailedis.com/subelerimiz/
- https://ailedis.com/iletisim/

## Scope Decisions

- Single branch only for this phase.
- Use the main Sancaktepe address as the clinic address.
- Do not add branch data model or branch filters now.
- Do not add diagnosis, prescription, imaging, lab, patient portal, or insurance integration features.
- Keep messaging templates free of sensitive treatment details.

## Phase Checklist

- [x] Phase 1 - Clinic data adaptation
- [x] Phase 2 - Users and dentists
- [x] Phase 3 - Service catalog
- [x] Phase 4 - Turkish CRM experience
- [x] Phase 5 - Demo patients, appointments, treatment cases, and payments
- [x] Phase 6 - Message templates
- [x] Phase 7 - Dashboard fit check
- [x] Phase 8 - MVP scope cleanup
- [x] Phase 9 - Technical verification
- [x] Phase 10 - Turkish UI polish and Aile Dis source alignment
- [x] Phase 11 - Detail-screen payment and text polish
- [x] Phase 12 - Login 401 cleanup
- [x] Phase 13 - Core form localization and runtime cleanup
- [x] Phase 14 - Visible list and summary polish
- [x] Phase 15 - User and dentist management
- [x] Phase 16 - Appointment monthly calendar
- [x] Phase 17 - Doctor availability scheduling
- [x] Phase 18 - WhatsApp appointment request intake
- [x] Phase 19 - WhatsApp appointment request CRM workspace
- [x] Phase 20 - n8n clinic assistant integration guide

## Phase 1 - Clinic Data Adaptation

Planned:

- Replace generic demo clinic data with Aile Dis.
- Configure clinic identity:
  - Name: Ozel Aile Dis Agiz ve Dis Sagligi Poliklinigi
  - Short display name: Aile Dis
  - Address: Osmangazi, Ahmet Yesevi Cd 8/C, 34887 Sancaktepe/Istanbul
  - Phone: +90 (216) 311 0 888
  - Email: info@ailedis.com
  - Website: https://ailedis.com
  - Timezone: Europe/Istanbul
  - Currency: TRY
  - Default language: tr
- Keep the existing single-clinic model.

Status:

- Completed.
- Implemented in `server/prisma/seed.ts`.
- Verified by running `npx tsx prisma/seed.ts`.

## Phase 2 - Users and Dentists

Planned:

- Add admin, receptionist, and billing users.
- Add site dentists as doctor users:
  - Dt. Kerem Ozguler
  - Uzm. Dt. Hatice Erkin
  - Dt. Aysegul Akmese
  - Dt. Yasin Turgut
  - Dt. Salim Fatih Girgin
  - Dt. Batikan Sirin
  - Dt. Ugur Mester
- Keep role-based access unchanged.
- Defer a dedicated user title/specialty field unless needed later.

Status:

- Completed.
- Added 10 users total: admin, receptionist, billing, and 7 dentists.
- Demo login examples:
  - admin@ailedis.com / password123
  - resepsiyon@ailedis.com / password123
  - muhasebe@ailedis.com / password123
  - kerem.ozguler@ailedis.com / password123

## Phase 3 - Service Catalog

Planned:

- Replace generic service data with Aile Dis dental services:
  - Estetik Dis Hekimligi
  - Implant Tedavisi
  - Agiz, Dis ve Cene Cerrahisi
  - Ortodonti (Dis Teli)
  - Endodonti (Kanal Tedavisi)
  - Pedodonti (Cocuk Dis Hekimligi)
  - Periodontoloji (Dis Eti Tedavisi)
  - Protetik Dis Tedavisi
  - Kompozit Dolgu
  - Gulus Tasarimi
  - Zirkonyum Kaplama
  - Dis Beyazlatma Bleaching
- Add descriptions from the public site in CRM-appropriate wording.
- Use TRY and demo/placeholder prices only where useful.

Status:

- Completed.
- Added 12 Aile Dis service records as active appointment/service types.

## Phase 4 - Turkish CRM Experience

Planned:

- Set the default language experience to Turkish.
- Rename visible product identity from Health CRM to Aile Dis CRM.
- Fix obvious mojibake in Turkish locale strings touched by this adaptation.
- Update login/demo credentials text.
- Keep labels easy to externalize.

Status:

- Completed.
- Updated Turkish common, auth, settings, and dashboard locale files.
- Set i18n fallback language to Turkish and localStorage-only language detection.
- Updated login screen branding and demo credentials.

## Phase 5 - Demo Patients, Appointments, Treatment Cases, and Payments

Planned:

- Add realistic fictional Turkish patient records.
- Add appointments across dentists and services.
- Add treatment cases for CRM pipeline demonstration.
- Add simple payment records with cash, card, bank transfer, paid, partial, and pending examples.
- Avoid sensitive medical record details.

Status:

- Completed.
- Added 8 fictional patients, 7 appointments, 3 treatment cases, 3 payments, and 3 tasks.
- Kept patient notes and reminders free of diagnosis or detailed health record content.

## Phase 6 - Message Templates

Planned:

- Add Turkish templates:
  - Randevu onayi
  - 24 saat randevu hatirlatma
  - Randevu sonrasi tesekkur
  - Gelmeyen hasta yeniden randevu
  - Tedavi plani takip
  - Odeme hatirlatma
- Do not include diagnosis or detailed treatment names in outbound reminders.

Status:

- Completed.
- Added 6 Turkish templates for appointment, follow-up, treatment plan, and payment workflows.
- Templates avoid sensitive treatment details.

## Phase 7 - Dashboard Fit Check

Planned:

- Confirm dashboard metrics make sense with Aile Dis seed data.
- Ensure today's appointments, no-show, new patients, pending tasks, payments, and treatment cases have meaningful data.

Status:

- Completed.
- Verified seeded data volume for dashboard use:
  - 1 clinic
  - 10 users
  - 7 dentists
  - 12 services
  - 8 patients
  - 7 appointments
  - 3 treatment cases
  - 3 payments
  - 6 message templates
  - 3 tasks

## Phase 8 - MVP Scope Cleanup

Planned:

- Confirm no new non-MVP medical functionality was added.
- Keep insurance/provision features manual only if present.
- Do not import marketing blog content into CRM.

Status:

- Completed.
- No branch model, diagnosis, prescription, imaging, lab, patient portal, or external insurance integration was added.
- Existing manual insurance/provision module was not expanded.

## Phase 9 - Technical Verification

Planned:

- Run seed.
- Run TypeScript/build checks.
- Start backend and frontend.
- Verify login and core screens in browser.

Status:

- Completed.
- Completed:
  - Seed ran successfully with `npx tsx prisma/seed.ts`.
  - Frontend build passed with `npm run build`.
  - Backend TypeScript check passed with `npx tsc --noEmit` after normalizing route parameter typing in `server/src/index.ts`.
  - Aile Dis seed counts were verified through Prisma.
  - Backend login smoke test passed for `admin@ailedis.com / password123`.
  - Frontend returned HTTP 200 at `http://127.0.0.1:5173`.
  - Browser was opened to `http://127.0.0.1:5173`.
  - HTML title now resolves to Aile Dis CRM.

## Phase 10 - Turkish UI Polish and Aile Dis Source Alignment

Planned:

- Clean remaining mojibake in Turkish locale files used by the main CRM screens.
- Replace visible English patient form labels with translation-backed labels.
- Align patient source values with Aile Dis demo acquisition channels.
- Re-run build and backend TypeScript checks.

Status:

- Completed.
- Rewrote Turkish locale files for appointments, patients, services, tasks, treatment cases, payments, messages, message templates, and insurance.
- Updated `PatientForm` to use i18n labels for patient fields, consents, and submit/cancel actions.
- Added `instagram` and `phone` as valid patient source values in backend validation.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`

## Phase 11 - Detail-Screen Payment and Text Polish

Planned:

- Remove remaining visible English payment/detail labels from patient and treatment detail screens.
- Replace hardcoded `USD` totals with the actual payment or treatment currency.
- Localize payment cancellation confirmation.
- Verify locale JSON validity and rebuild.

Status:

- Completed.
- Patient detail payment summaries now use the relevant payment/treatment currency, falling back to TRY.
- Patient detail treatment amount labels now use translated accepted/estimated labels.
- Treatment case detail payment statuses and empty payment text now use translations.
- Payment cancellation confirmation now uses `payments:confirmCancel`.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`
  - Turkish locale JSON parse check

## Phase 12 - Login 401 Cleanup

Planned:

- Fix login failures caused by stale localStorage auth data from the previous demo dataset.
- Ensure the login request uses the configured API base URL.
- Make the demo login screen easier to use with the correct Aile Dis credentials.

Status:

- Completed.
- Added an `hcrm_auth_version` guard. Old localStorage tokens/users are cleared before `/auth/me` verification.
- Updated `authService.login` to use `VITE_API_URL` instead of a hardcoded API URL.
- Prefilled the login form with `admin@ailedis.com / password123`.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`
  - Login API smoke test for `admin@ailedis.com / password123`
  - Frontend HTTP 200 at `http://127.0.0.1:5173/login`

## Phase 13 - Core Form Localization and Runtime Cleanup

Planned:

- Continue from the login cleanup by polishing the core create/edit forms.
- Remove visible English fallback strings from appointment, treatment case, payment, and task forms.
- Ensure form defaults match the Aile Dis single-branch setup.
- Fix any runtime issues found during form review.

Status:

- Completed.
- Fixed `AppointmentForm` so selected service lookup happens after `formData` is initialized.
- Replaced generic English errors with translation-backed generic errors.
- Changed treatment case and payment form default currency from USD to TRY.
- Reordered form currency options to prefer TRY.
- Localized select placeholders and task assignee role labels.
- Added missing translation keys for date, select placeholder, generic error, appointment base price, lost reason validation, and no-specific-service text.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`
  - Locale JSON parse check
  - Login API smoke test for `admin@ailedis.com / password123`
  - Frontend HTTP 200 at `http://127.0.0.1:5173/login`

## Phase 14 - Visible List and Summary Polish

Planned:

- Continue after core form cleanup by removing remaining visible old demo/UI wording.
- Replace hardcoded USD summary values with real seeded currency.
- Use Aile Dis-friendly dentist labels in lists and detail screens.
- Localize empty states and summary cards on core list screens.

Status:

- Completed.
- Payment summary cards now use the first payment currency, falling back to TRY.
- Treatment case summary cards now use the first case currency, falling back to TRY.
- Treatment case summary labels are translation-backed.
- Appointment, dashboard, treatment case, and form dentist labels now use `Dt.` instead of `Dr.`.
- Patient and appointment empty states now use translation-backed text.
- Service modal default currency now uses TRY.
- Appointment detail service label and treatment case detail unassigned dentist label are translation-backed.
- Verified with:
  - Search for old visible strings in `src`
  - `npm run build`
  - `npx tsc --noEmit`
  - Login API smoke test for `admin@ailedis.com / password123`
  - Frontend HTTP 200 at `http://127.0.0.1:5173/login`

## Phase 15 - User and Dentist Management

Planned:

- Add a place where clinic admins can add and manage dentists and staff users.
- Keep the feature MVP-friendly and role-based.
- Allow admins to create and update users, including dentists.
- Keep receptionist/billing/doctor roles in the existing RBAC model.

Status:

- Completed.
- Added admin-only backend endpoints:
  - `POST /api/users`
  - `PUT /api/users/:id`
- Extended `GET /api/users` response with phone, active status, last login, and created date.
- Added validation for user creation and updates.
- Added password hashing for created users and optional password updates.
- Prevented inactive users from logging in.
- Added `UserList` component for listing, creating, editing, and activating/deactivating users.
- Added an admin-only `Kullanıcılar ve Hekimler` tab under Settings.
- Added Turkish and English settings translations for user management.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`
  - Locale JSON parse check
  - Token-authenticated API smoke test for creating and updating a dentist user
  - Cleanup of temporary smoke-test user

## Phase 16 - Appointment Monthly Calendar

Planned:

- Add a monthly calendar to the appointment module.
- Show how many appointments exist on each day of the visible month.
- Let users click a day to open that day's daily schedule.
- Reuse the existing appointment API and RBAC scoping.

Status:

- Completed.
- Added a monthly calendar panel above the daily appointment list.
- Added previous/next month controls.
- Each calendar day now shows appointment count or an empty-day label.
- Clicking a day updates the daily schedule filter and keeps the calendar month in sync.
- Calendar counts respect current status and practitioner filters.
- Doctor users inherit existing API scoping and only see their appointment counts.
- Added Turkish and English calendar translations.
- Verified with:
  - `npm run build`
  - `npx tsc --noEmit`
  - Locale JSON parse check
  - Token-authenticated monthly and daily appointment API smoke tests
  - Frontend HTTP 200 at `http://127.0.0.1:5173/appointments`

## Phase 17 - Doctor Availability Scheduling

Planned:

- Add a weekly availability calendar for each dentist.
- Allow dentist users to manage their own availability.
- Allow admin users to manage every dentist's availability.
- Prevent appointment creation or update outside the selected dentist's active availability windows.
- Show a clear modal warning when a user tries to save an appointment outside availability.
- Keep the feature MVP-friendly with simple weekly time windows, not complex recurring exceptions.

Status:

- Completed.
- Added `DoctorAvailability` to the Prisma schema with clinic, practitioner, weekday, start time, end time, active status, and timestamps.
- Added the database migration for doctor availability records.
- Seeded default weekly availability for Aile Dis dentists.
- Added backend availability APIs:
  - `GET /api/doctor-availabilities`
  - `PUT /api/doctor-availabilities/:practitionerId`
- Enforced role rules:
  - Admin can view and edit all dentists.
  - Doctor can view and edit only their own availability.
  - Receptionist can view availability data for scheduling context.
- Appointment create and update now reject slots outside the selected dentist's availability with `APPOINTMENT_OUTSIDE_AVAILABILITY`.
- Added `DoctorAvailabilityManager` under Settings.
- Added a `Hekim Müsaitliği` settings tab for admin and doctor users.
- Appointment form now opens a modal warning when the selected date/time is outside the dentist's availability.
- Verified with:
  - `npx prisma migrate deploy`
  - `npx prisma generate`
  - `npx tsx prisma/seed.ts`
  - `npm run build`
  - `npx tsc --noEmit`
  - Locale JSON parse check
  - Token-authenticated API smoke test for valid and invalid appointment slots
  - Frontend HTTP 200 at `http://127.0.0.1:5173/settings`

## Phase 18 - WhatsApp Appointment Request Intake

Planned:

- Add an MVP-safe appointment request layer for WhatsApp instead of directly creating confirmed appointments.
- Add an `AppointmentRequest` data model with patient contact details, requested service, optional dentist, preferred time, source, status, raw message, and conversion reference.
- Add a shared secret for n8n-to-CRM WhatsApp API calls.
- Add public-but-secret-protected WhatsApp endpoints:
  - List active services.
  - List active dentists.
  - Return available appointment slots using dentist availability and existing appointments.
  - Create a pending appointment request.
  - Create a cancel/change request.
- Avoid collecting diagnosis, prescription, imaging, or other medical record details.

Status:

- Completed.
- Added `AppointmentRequest` to the Prisma schema.
- Added migration `20260512233000_add_appointment_requests`.
- Added `WHATSAPP_WEBHOOK_SECRET` for secret-protected n8n API access.
- Added secret-protected WhatsApp endpoints:
  - `GET /api/public/whatsapp/services`
  - `GET /api/public/whatsapp/doctors`
  - `GET /api/public/whatsapp/availability`
  - `POST /api/public/whatsapp/appointment-requests`
  - `POST /api/public/whatsapp/cancel-request`
- Availability endpoint uses active services, active dentists, dentist availability, and existing appointments.
- Appointment request creation links to an existing patient by phone when possible.
- Verified with:
  - `npx prisma migrate deploy`
  - `npx prisma generate`
  - Secret-protected API smoke test for services, doctors, availability, and request creation.

## Phase 19 - WhatsApp Appointment Request CRM Workspace

Planned:

- Add a CRM page for admin and receptionist users to review WhatsApp appointment requests.
- Show patient name, phone, service, dentist, requested time, request type, status, and raw message summary.
- Allow clinic staff to approve, reject, close, or convert pending requests.
- Conversion should reuse existing appointment validation and dentist availability rules.
- Log staff actions in activity logs where applicable.

Status:

- Completed.
- Added `WhatsApp Talepleri` page.
- Added the page to the main navigation for admin and receptionist users.
- Added authenticated APIs:
  - `GET /api/appointment-requests`
  - `PUT /api/appointment-requests/:id/status`
  - `POST /api/appointment-requests/:id/convert`
- Staff can approve, reject, close, or convert WhatsApp requests.
- Conversion creates or links a patient, creates a scheduled appointment, and preserves availability/overlap validation.
- Added activity logs for request status changes and conversion.
- Verified with:
  - Token-authenticated CRM API smoke test for listing and converting a WhatsApp request.
  - Frontend HTTP 200 at `http://127.0.0.1:5173/appointment-requests`.

## Phase 20 - n8n Clinic Assistant Integration Guide

Planned:

- Document how to adapt the existing n8n workflow from agency lead intake to Aile Dis appointment intake.
- Provide a clinic-safe system prompt.
- Define required HTTP Request nodes and CRM endpoint payloads.
- Keep deduplication and chat memory.
- Ensure the assistant never invents appointment availability or gives medical advice.

Status:

- Completed.
- Added `docs/21-whatsapp-n8n-clinic-integration.md`.
- Documented CRM endpoint usage, required HTTP Request nodes, and the shared-secret header.
- Added a clinic-safe system prompt for Aile Dis WhatsApp appointment intake.
- Documented that the assistant must not invent appointment slots or provide medical advice.
- Verified with:
  - Documentation review against the current CRM endpoint names and payload shape.

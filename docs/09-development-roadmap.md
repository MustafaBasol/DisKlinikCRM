# Development Roadmap

## Phase 0: Project Setup

Goals:

- Initialize project
- Configure database
- Configure authentication
- Create base layout
- Create reusable UI components

Tasks:

- Set up frontend
- Set up backend
- Set up database
- Set up environment variables
- Add authentication
- Add protected routes
- Add clinic workspace logic

## Phase 1: Core Data Model

Goals:

Create database schema and basic CRUD APIs.

Entities:

- clinics
- users
- patients
- appointment_types
- appointments
- tasks
- treatment_cases
- payments
- message_templates
- sent_messages
- activity_logs

Tasks:

- Create database migrations
- Create models/entities
- Create API endpoints
- Add validation
- Add seed data

## Phase 2: Patient Management

Goals:

Allow clinic users to manage patients.

Pages:

- Patient list
- Patient detail
- Create patient
- Edit patient

Features:

- Search patients
- Filter by status
- View related appointments
- View related tasks
- View related payments
- View activity timeline

## Phase 3: Appointment Management

Goals:

Allow clinics to manage appointments.

Pages:

- Appointment list
- Calendar view
- Create appointment
- Edit appointment

Features:

- Appointment status
- Practitioner filter
- Daily view
- Weekly view
- Mark completed
- Mark no-show
- Cancel appointment
- Reschedule appointment

## Phase 4: Tasks and Follow-Ups

Goals:

Allow clinic staff to manage patient follow-up tasks.

Pages:

- Task list
- Create task
- Edit task

Features:

- Assign task
- Link task to patient
- Link task to appointment
- Link task to treatment/service case
- Due date
- Priority
- Status
- Overdue task view

## Phase 5: Treatment / Service Pipeline

Goals:

Allow clinics to track treatment or service opportunities.

Pages:

- Case list
- Case detail
- Create case
- Edit case

Features:

- Stage tracking
- Estimated amount
- Related appointments
- Related tasks
- Related payments
- Notes
- Activity timeline

## Phase 6: Payment Tracking

Goals:

Allow simple payment visibility.

Pages:

- Payment list
- Create payment
- Edit payment

Features:

- Link payment to patient
- Link payment to treatment/service case
- Track amount
- Track method
- Track status
- Track payment date

## Phase 7: Messages and Reminders

Goals:

Prepare or send patient communication.

Pages:

- Message templates
- Sent messages

Features:

- Template variables
- Appointment reminder template
- No-show follow-up template
- Treatment quote follow-up template
- Message status

Optional:

- n8n webhook integration
- SMS provider integration
- WhatsApp provider integration

## Phase 8: Dashboard

Goals:

Create useful clinic overview.

Widgets:

- Today's appointments
- Weekly appointments
- New patients this month
- No-show count
- Pending tasks
- Overdue tasks
- Pending payments
- Open treatment/service cases
- Estimated open revenue

## Phase 9: Security and Permissions

Goals:

Add role-based access control and audit logs.

Tasks:

- Enforce backend permissions
- Add activity logs
- Restrict clinic data access
- Add user management
- Add settings page

## Phase 10: Polish and Demo

Goals:

Make the product demo-ready.

Tasks:

- Improve UI
- Add empty states
- Add loading states
- Add error handling
- Add demo data
- Add responsive design
- Prepare demo scenario

---

## Completed Sprints (Post-MVP)

### Sprint 6 — Şube Yönetimi + Kullanıcı-Klinik Atama ✅ (2026-05-20)

Goals:

- Multi-branch (multi-clinic) architecture
- Organization → Clinic hierarchy
- Per-clinic user assignment
- CLINIC_MANAGER scope isolation

Delivered:

- `server/src/routes/organizationBranches.ts` — 7 endpoint (CRUD + status + user-clinic assignment)
- `UserClinic` Prisma model with `isActive`, `role`, `defaultClinicId`
- `canManageBranches`, `canAssignUserClinics` permission helpers (backend + frontend)
- `src/pages/Branches.tsx` — branch card grid UI, create/edit/status modals
- `src/components/UserClinicAssignmentModal.tsx` — per-branch role assignment UI
- 30 new unit tests → 129/129 total ✅

---

### Sprint 7 — Klinik Çalışma Takvimi + Şube Bazlı Randevu Kuralları ✅ (2026-05-20)

Goals:

- Define working hours per clinic branch (7-day grid)
- Validate appointments against clinic open hours
- Filter available doctors by branch assignment
- Compute available time slots (doctor window ∩ clinic hours)

Delivered:

- `ClinicWorkingHours` Prisma model + manual migration SQL
- `server/src/routes/schedules.ts` — 4 endpoints:
  - `GET/PUT /api/clinics/:clinicId/working-hours` (bulk upsert, 7-day defaults)
  - `GET /api/clinics/:clinicId/doctors` (UserClinic + legacy dedup)
  - `GET /api/availability` (slot computation with clinic hours ∩ doctor slots)
- `checkPractitionerAvailability()` updated — rejects `clinic_closed` and `outside_clinic_hours` before doctor check
- `POST /api/appointments` multi-branch doctor check — `User.clinicId` OR `UserClinic` active assignment
- `canManageClinicSchedule`, `canManageDoctorSchedule`, `canViewAvailability` helpers (backend + frontend)
- `src/pages/ClinicSchedule.tsx` — 2-tab page: working hours grid + branch doctor list
- `src/pages/Branches.tsx` — "Program Yönet" dropdown action (OWNER/ORG_ADMIN/CLINIC_MANAGER)
- `src/components/AppointmentForm.tsx` — clinic-aware doctor fetching via `scheduleService.getClinicDoctors`
- 41 new unit tests (scheduleAccess.test.ts) → 170/170 total ✅

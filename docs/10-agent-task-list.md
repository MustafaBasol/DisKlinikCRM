# Agent Task List

## General Instruction

Work phase by phase.

Do not skip to advanced features before the MVP foundation is complete.

For each task:

1. Implement the smallest working version.
2. Test manually.
3. Add validation.
4. Add activity logs where relevant.
5. Keep UI simple and clean.

## Task 1: Initialize Project

- Create project structure
- Configure frontend
- Configure backend
- Configure database
- Add environment variable handling
- Add README setup instructions

Acceptance criteria:

- App runs locally
- Database connects successfully
- Environment variables are documented

## Task 2: Authentication

- Add user registration or seed admin user
- Add login
- Add logout
- Add protected routes
- Add password hashing
- Add session or token handling

Acceptance criteria:

- User can log in
- Protected pages are not visible without login
- Logged-in user belongs to a clinic

## Task 3: Clinic Workspace

- Create clinics table
- Link users to clinics
- Ensure all clinic data is scoped by clinic_id

Acceptance criteria:

- User can only access data from own clinic
- Backend rejects cross-clinic access

## Task 4: User Roles

- Add roles: admin, doctor, receptionist, billing
- Add permission checks
- Add basic user management for admin

Acceptance criteria:

- Admin can manage users
- Non-admin users cannot manage users
- Backend enforces permissions

## Task 5: Patient CRUD

- Create patients table
- Create patient API endpoints
- Create patient list page
- Create patient detail page
- Create create/edit patient forms

Acceptance criteria:

- User can create patient
- User can edit patient
- User can search patient
- User can view patient detail
- Activity log is created when patient is created or updated

## Task 6: Appointment Types

- Create appointment_types table
- Create CRUD endpoints
- Create settings page for appointment types

Acceptance criteria:

- Admin can create appointment types
- Appointment types can have duration and color
- Inactive appointment types are not used in new appointments

## Task 7: Appointment CRUD

- Create appointments table
- Create appointment endpoints
- Create appointment list page
- Create create/edit appointment form

Acceptance criteria:

- User can create appointment
- User can update appointment
- User can cancel appointment
- User can mark appointment as completed
- User can mark appointment as no-show
- Activity logs are created

## Task 8: Calendar View

- Create daily calendar view
- Create weekly calendar view
- Add filters by practitioner and status

Acceptance criteria:

- User can see appointments in calendar
- User can filter by practitioner
- User can filter by status

## Task 9: Follow-Up Tasks

- Create tasks table
- Create task endpoints
- Create task list page
- Create task form
- Link tasks to patients and appointments

Acceptance criteria:

- User can create task
- User can assign task
- User can mark task as completed
- Overdue tasks are visible

## Task 10: Treatment / Service Cases

- Create treatment_cases table
- Create endpoints
- Create case list page
- Create case detail page
- Create case form

Acceptance criteria:

- User can create treatment/service case
- User can update stage
- User can link case to patient
- Estimated amount is visible
- Cases are shown on patient detail page

## Task 11: Payments

- Create payments table
- Create endpoints
- Create payment list page
- Create payment form
- Link payments to patients and treatment cases

Acceptance criteria:

- User can add payment
- User can see payment status
- Patient detail shows payment summary
- Treatment case detail shows related payments

## Task 12: Message Templates

- Create message_templates table
- Create sent_messages table
- Create template management page
- Add template variables

Acceptance criteria:

- User can create template
- User can preview rendered message
- User can prepare message for a patient appointment

## Task 13: Activity Logs

- Create activity_logs table
- Add logging to main actions
- Show activity timeline on patient detail page

Acceptance criteria:

- Important actions are logged
- Patient detail shows relevant activity timeline
- Admin can view activity logs

## Task 14: Dashboard

- Create dashboard API
- Create dashboard page
- Add main widgets

Acceptance criteria:

Dashboard shows:

- Today's appointments
- Weekly appointment count
- New patients this month
- No-show count
- Pending tasks
- Overdue tasks
- Pending payments
- Open treatment/service cases
- Estimated open revenue

## Task 15: Demo Data

- Add seed clinic
- Add seed users
- Add seed patients
- Add seed appointments
- Add seed treatment cases
- Add seed payments
- Add seed tasks

Acceptance criteria:

- New developer can run seed command
- Demo dashboard looks populated
- Demo can be shown to a clinic owner

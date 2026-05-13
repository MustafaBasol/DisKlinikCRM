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

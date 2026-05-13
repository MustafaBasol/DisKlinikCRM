# AGENTS.md

## Project Name

Health CRM MVP

## Project Goal

Build a lightweight CRM for health centers, dental clinics, and similar appointment-based clinics.

The MVP should focus on:

- Patient/customer management
- Appointment scheduling
- Calendar view
- Follow-up tasks
- Treatment/service pipeline
- Payment tracking
- Reminder messages
- Activity logs
- Role-based access control

This is not a full electronic medical record system in the MVP phase.

## Product Positioning

This product is a clinic operations CRM, not a diagnosis, prescription, or medical record platform.

Main value proposition:

- Reduce missed appointments
- Improve patient follow-up
- Track treatment/service opportunities
- Help clinic teams manage daily operations
- Give clinic owners a simple dashboard for business visibility

## Important MVP Rule

Do not overbuild.

For the MVP, avoid the following unless explicitly requested:

- Prescription management
- AI medical diagnosis
- Medical imaging storage
- Full electronic health record
- Insurance integration
- Laboratory integration
- Patient portal
- Complex accounting system

## Main User Types

- Clinic Owner / Admin
- Doctor / Practitioner
- Receptionist / Secretary
- Billing Staff

## Default Language

The app should be designed to support multilingual usage later.

Initial language can be English or French, but labels should be easy to externalize into translation files.

## Technical Expectations

Use clean, maintainable, modular code.

Recommended structure:

- Separate modules by domain
- Keep business logic out of UI components
- Use reusable components
- Add clear validation
- Use database migrations
- Do not hardcode clinic-specific data

## Security Rules

This project may process sensitive personal data.

The agent must always consider:

- Role-based access control
- Audit logs
- Data minimization
- Secure authentication
- No sensitive health data inside SMS/WhatsApp reminders
- GDPR-friendly data export and deletion capability
- Secure backups
- Environment variables for secrets

## Development Style

When implementing:

1. Start with database schema.
2. Build backend APIs.
3. Build simple UI pages.
4. Add validations.
5. Add role-based permissions.
6. Add logs.
7. Add dashboard metrics.
8. Refactor only after working functionality exists.

## Coding Principles

- Prefer simple, working MVP features.
- Do not introduce unnecessary dependencies.
- Keep UI clean and professional.
- Every main entity should have create, read, update, and list functionality.
- Delete should usually be soft delete where appropriate.
- Add timestamps to all major tables.

## Critical Entities

The MVP should include these entities:

- clinics
- users
- patients
- appointments
- appointment_types
- treatment_cases
- tasks
- payments
- message_templates
- sent_messages
- activity_logs
- settings

## Agent Behavior

Before adding a feature, check whether it belongs to the MVP.

If the request is unclear, make a reasonable MVP-friendly assumption and continue.

Do not add medical diagnosis features unless explicitly requested.

Always preserve security and privacy requirements.

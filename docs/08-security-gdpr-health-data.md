# Security, GDPR, and Health Data

## Important Notice

This system may process personal data and potentially sensitive health-related data.

Security and privacy must be considered from the beginning.

This document is not legal advice. For production use in healthcare, compliance should be reviewed according to the target country.

## Core Principles

The system should follow these principles:

- Data minimization
- Purpose limitation
- Role-based access
- Secure authentication
- Audit logging
- Encryption where appropriate
- Secure backups
- Data export
- Data deletion/anonymization
- Consent tracking

## MVP Data Minimization

The MVP should avoid storing unnecessary medical details.

The MVP should focus on:

- Contact information
- Appointment information
- Follow-up tasks
- Service/treatment opportunity tracking
- Payment tracking

Avoid in MVP:

- Diagnosis
- Prescription
- Detailed medical history
- Medical images
- Lab results
- Insurance records

## Authentication

Required:

- Secure password hashing
- Session or token-based authentication
- Password reset flow
- User activation/deactivation

Recommended:

- Multi-factor authentication
- Login history
- Suspicious login detection

## Authorization

All access must be checked server-side.

Rules:

- Users can access only their clinic data.
- Doctors should access only assigned or permitted patients.
- Receptionists can manage appointment operations.
- Billing users should access payment-related information.
- Admin users can manage the whole clinic workspace.

## Audit Logs

The system must log important actions:

- Login
- Patient created
- Patient updated
- Appointment created
- Appointment updated
- Appointment cancelled
- Appointment marked no-show
- Treatment/service case updated
- Payment added
- Message sent
- User created
- User role changed

Each log should include:

- user_id
- clinic_id
- entity_type
- entity_id
- action
- timestamp
- IP address if available

## Data Export

Patients should be exportable by authorized users.

Admin users should be able to export:

- Patient data
- Appointment history
- Payment records
- Activity logs where appropriate

## Data Deletion

The system should support:

- Soft delete for operational records
- Anonymization where legal retention is required
- Deactivation instead of hard deletion for users

## Consent Tracking

Patient records should include:

- communication_consent
- marketing_consent

Marketing messages must not be sent without marketing consent.

## Messaging Privacy

Do not include sensitive health information in SMS, WhatsApp, or email subjects.

Bad example:

```txt
Your implant surgery is tomorrow.
```

Better example:

```txt
Your clinic appointment is tomorrow.
```

## Hosting

For production use in healthcare, hosting requirements must be checked for the target country.

For France, health data hosting may require HDS-compliant hosting.

## Backups

Recommended:

- Daily encrypted database backups
- Backup retention policy
- Restore testing
- Access restriction to backups

## Environment Variables

Secrets must never be hardcoded.

Use environment variables for:

- Database URL
- JWT secret
- SMTP credentials
- SMS provider keys
- WhatsApp provider keys
- Payment provider keys
- Encryption keys

# User Roles and Permissions

## Overview

The system must support role-based access control.

Each user belongs to a clinic.

Each user has one role.

The MVP roles are:

- Admin
- Doctor / Practitioner
- Receptionist
- Billing Staff

## Role: Admin

Admin users can access and manage everything inside the clinic workspace.

Permissions:

- Manage clinic settings
- Manage users
- Manage patients
- Manage appointments
- Manage treatment/service cases
- Manage tasks
- Manage payments
- Manage message templates
- View dashboard
- View reports
- View activity logs

## Role: Doctor / Practitioner

Doctors can manage their own clinical schedule and patient-related follow-ups.

Permissions:

- View assigned appointments
- View assigned patients
- View patient details
- Add internal notes
- Create treatment/service cases
- Update assigned treatment/service cases
- Create follow-up tasks
- Complete assigned tasks
- View limited payment status if allowed by clinic settings

Restrictions:

- Cannot manage users
- Cannot change clinic settings
- Cannot delete records
- Cannot view all financial reports by default

## Role: Receptionist

Receptionists manage daily clinic operations.

Permissions:

- Create patients
- Edit patient contact information
- Create appointments
- Reschedule appointments
- Cancel appointments
- Mark appointment as confirmed
- Mark appointment as no-show
- Create follow-up tasks
- Use message templates
- View daily and weekly calendar

Restrictions:

- Cannot manage users
- Cannot change clinic settings
- Cannot delete payment records
- Cannot view full financial reports unless allowed

## Role: Billing Staff

Billing staff manage payment records.

Permissions:

- View patients
- View treatment/service cases
- Create payments
- Update payments
- View payment dashboard
- View outstanding balances

Restrictions:

- Cannot manage users
- Cannot change clinical appointment details unless allowed
- Cannot delete patient records
- Cannot access sensitive notes unless allowed

## Permission Matrix

| Feature | Admin | Doctor | Receptionist | Billing |
|---|---:|---:|---:|---:|
| Manage clinic settings | Yes | No | No | No |
| Manage users | Yes | No | No | No |
| Create patients | Yes | Yes | Yes | No |
| Edit patients | Yes | Limited | Yes | Limited |
| View patients | Yes | Assigned/Allowed | Yes | Yes |
| Create appointments | Yes | Yes | Yes | No |
| Update appointments | Yes | Own/Assigned | Yes | No |
| Cancel appointments | Yes | Own/Assigned | Yes | No |
| Manage treatment cases | Yes | Own/Assigned | Limited | View |
| Manage tasks | Yes | Own/Assigned | Yes | No |
| Manage payments | Yes | No/Limited | No/Limited | Yes |
| View dashboard | Yes | Limited | Limited | Limited |
| View activity logs | Yes | No | No | No |

## Security Rule

Never rely only on frontend hiding.

All permissions must be enforced in the backend.

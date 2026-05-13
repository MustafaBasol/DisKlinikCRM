# Modules and Pages

## Main Navigation

The MVP should have the following main navigation:

- Dashboard
- Patients
- Appointments
- Calendar
- Treatment / Services
- Tasks
- Payments
- Messages
- Reports
- Settings

A simplified MVP navigation can be:

- Dashboard
- Patients
- Calendar
- Follow-Ups
- Payments
- Settings

## Module: Dashboard

### Page: Dashboard Home

Purpose:

Show the clinic owner and staff a quick overview of daily operations.

Required widgets:

- Today's appointments
- This week's appointments
- New patients this month
- No-show count
- Pending tasks
- Overdue tasks
- Pending payments
- Open treatment/service cases
- Estimated open revenue

## Module: Patients

### Page: Patient List

Required features:

- Search by name, phone, email
- Filter by status
- Filter by source
- Add new patient button
- View patient details button

Columns:

- Name
- Phone
- Email
- Status
- Source
- Last appointment
- Next appointment
- Created date

### Page: Patient Detail

Required sections:

- Basic information
- Contact details
- Consent status
- Appointment history
- Open tasks
- Treatment/service cases
- Payment summary
- Activity timeline

### Page: Create/Edit Patient

Required fields:

- First name
- Last name
- Phone
- Email
- Date of birth
- Address
- Status
- Source
- Notes
- Communication consent
- Marketing consent

## Module: Appointments

### Page: Appointment List

Required features:

- Filter by date
- Filter by status
- Filter by practitioner
- Search by patient name
- Add appointment button

Columns:

- Date/time
- Patient
- Practitioner
- Type
- Status
- Actions

### Page: Calendar

Required views:

- Daily view
- Weekly view

Required filters:

- Practitioner
- Appointment status
- Appointment type

### Page: Create/Edit Appointment

Required fields:

- Patient
- Practitioner
- Appointment type
- Date
- Start time
- End time
- Status
- Notes

Required actions:

- Save
- Cancel appointment
- Mark as completed
- Mark as no-show
- Reschedule

## Module: Treatment / Services

### Page: Treatment Case List

Required features:

- Filter by stage
- Filter by practitioner
- Filter by patient
- Sort by estimated amount
- Sort by last update

Columns:

- Title
- Patient
- Practitioner
- Stage
- Estimated amount
- Last update

### Page: Treatment Case Detail

Required sections:

- Case summary
- Stage
- Estimated amount
- Related appointments
- Related tasks
- Related payments
- Notes
- Activity timeline

## Module: Tasks

### Page: Task List

Required features:

- Filter by status
- Filter by assigned user
- Filter by due date
- Filter overdue tasks
- Create task

Columns:

- Title
- Patient
- Assigned to
- Due date
- Priority
- Status

### Page: Create/Edit Task

Required fields:

- Title
- Description
- Patient
- Related appointment
- Related treatment/service case
- Assigned user
- Due date
- Priority
- Status

## Module: Payments

### Page: Payment List

Required features:

- Filter by patient
- Filter by status
- Filter by date
- Add payment

Columns:

- Patient
- Treatment/service case
- Amount
- Method
- Status
- Date

### Page: Create/Edit Payment

Required fields:

- Patient
- Treatment/service case
- Amount
- Currency
- Payment method
- Payment status
- Payment date
- Notes

## Module: Messages

### Page: Message Templates

Required features:

- Create template
- Edit template
- Activate/deactivate template

Template fields:

- Name
- Channel
- Subject
- Body
- Language
- Active status

### Page: Sent Messages

Required columns:

- Patient
- Channel
- Recipient
- Status
- Sent date

## Module: Settings

### Page: Clinic Settings

Fields:

- Clinic name
- Address
- Phone
- Email
- Website
- Timezone
- Currency
- Default language

### Page: Users

Required features:

- Invite/create user
- Change role
- Activate/deactivate user

### Page: Appointment Types

Required features:

- Create appointment type
- Set default duration
- Set color
- Activate/deactivate type

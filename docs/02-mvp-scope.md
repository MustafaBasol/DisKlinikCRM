# MVP Scope

## MVP Objective

Build a usable first version of a clinic CRM that can be demoed to dental clinics and small health centers.

The MVP should include only the features needed to manage daily clinic operations.

## Must-Have Features

### 1. Clinic Account

Each clinic should have its own workspace.

Required fields:

- Clinic name
- Address
- Phone
- Email
- Website
- Default language
- Timezone
- Currency

### 2. User Management

The clinic should be able to have multiple users.

Required roles:

- Admin
- Doctor / Practitioner
- Receptionist
- Billing Staff

### 3. Patient Management

Users should be able to:

- Create patients
- Edit patient information
- Search patients
- View patient details
- View appointment history
- View related tasks
- View related payments
- View related treatment/service cases

### 4. Appointment Management

Users should be able to:

- Create appointments
- Edit appointments
- Cancel appointments
- Reschedule appointments
- Mark appointment as completed
- Mark appointment as no-show
- Filter by doctor/practitioner
- View daily and weekly schedule

### 5. Appointment Statuses

Required statuses:

- Scheduled
- Confirmed
- Completed
- Cancelled
- Rescheduled
- No-show

### 6. Follow-Up Tasks

Users should be able to:

- Create tasks
- Assign tasks to a user
- Link tasks to a patient
- Set due dates
- Mark tasks as completed
- See overdue tasks

### 7. Treatment / Service Pipeline

Users should be able to:

- Create a treatment/service case
- Link it to a patient
- Assign a responsible practitioner
- Set estimated value
- Track stage
- Add notes
- Mark as accepted, lost, completed, or pending

### 8. Payment Tracking

Users should be able to:

- Add payment records
- Link payments to patients
- Link payments to treatment/service cases if applicable
- Track total amount
- Track paid amount
- Track remaining amount
- Track payment status

### 9. Reminder Templates

Users should be able to:

- Create message templates
- Use variables such as patient name, clinic name, appointment date, and appointment time
- Prepare appointment reminder messages

### 10. Dashboard

Dashboard should show:

- Today's appointments
- This week's appointments
- New patients this month
- No-show count
- Pending tasks
- Overdue tasks
- Pending payments
- Open treatment/service cases
- Estimated open revenue

### 11. Activity Logs

The system should log important actions:

- Patient created
- Patient updated
- Appointment created
- Appointment updated
- Appointment cancelled
- Appointment completed
- Appointment marked as no-show
- Task created
- Task completed
- Payment added
- Treatment/service case updated
- Message sent or prepared

## Should-Have Features

These are useful but not mandatory for the first working version:

- Google Calendar sync
- WhatsApp integration
- SMS provider integration
- Email sending
- CSV import/export
- Advanced reporting
- Appointment color coding
- Basic analytics charts

## Not in MVP

Do not implement these in the first MVP:

- Prescription system
- Medical diagnosis
- AI diagnosis
- Medical imaging storage
- Insurance processing
- Laboratory results
- Patient portal
- Online payment
- Complex invoicing
- Complex multi-branch management

## MVP Principle

If a feature does not help with appointment management, patient follow-up, treatment/service tracking, or basic payment visibility, it should not be included in the MVP.

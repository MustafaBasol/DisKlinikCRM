# Appointment Workflow

## Appointment Lifecycle

An appointment can move through these statuses:

1. Scheduled
2. Confirmed
3. Completed

Alternative paths:

- Scheduled -> Cancelled
- Scheduled -> Rescheduled
- Scheduled -> No-show
- Confirmed -> Completed
- Confirmed -> No-show
- Confirmed -> Cancelled

## Status Definitions

### Scheduled

The appointment has been created but not confirmed.

### Confirmed

The patient has confirmed the appointment.

### Completed

The patient attended and the appointment is finished.

### Cancelled

The appointment was cancelled.

### Rescheduled

The appointment was moved to another date or time.

### No-show

The patient did not attend and did not cancel in advance.

## Appointment Creation Flow

1. User selects or creates a patient.
2. User selects practitioner.
3. User selects appointment type.
4. User selects date and time.
5. System calculates end time based on appointment type duration.
6. User adds optional notes.
7. System creates appointment with `scheduled` status.
8. System creates activity log.
9. System optionally prepares reminder message.

## Appointment Completion Flow

1. User opens appointment.
2. User clicks "Mark as completed".
3. System updates status to `completed`.
4. System creates activity log.
5. System may suggest creating a follow-up task.
6. System may suggest creating a treatment/service case if relevant.

## No-Show Flow

1. User opens appointment.
2. User clicks "Mark as no-show".
3. System updates status to `no_show`.
4. System creates activity log.
5. System may create a follow-up task:
   - "Call patient to reschedule missed appointment"

## Cancellation Flow

1. User opens appointment.
2. User clicks "Cancel appointment".
3. User optionally adds cancellation reason.
4. System updates status to `cancelled`.
5. System creates activity log.

## Reschedule Flow

1. User opens appointment.
2. User clicks "Reschedule".
3. User selects new date and time.
4. System updates appointment date/time.
5. System sets status to `rescheduled` or keeps `scheduled` depending on implementation.
6. System creates activity log.
7. System optionally prepares a new reminder message.

## Business Rules

- End time must be after start time.
- Appointment must belong to a clinic.
- Patient must belong to the same clinic.
- Practitioner must belong to the same clinic.
- Receptionists can create and update appointments.
- Doctors can manage their own appointments.
- Admins can manage all appointments.
- No sensitive medical information should be included in reminder messages.

## Calendar Requirements

Calendar should support:

- Day view
- Week view
- Practitioner filter
- Status filter
- Appointment type filter

## Recommended Appointment Colors

Colors can be based on appointment type or status.

Status-based examples:

- Scheduled: neutral
- Confirmed: positive
- Completed: completed/gray
- Cancelled: warning
- No-show: alert

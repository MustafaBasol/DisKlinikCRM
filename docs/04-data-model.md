# Data Model

## Overview

This document defines the MVP database model.

All major tables should include:

- id
- created_at
- updated_at
- deleted_at if soft delete is used

All clinic-specific tables should include:

- clinic_id

## Table: clinics

Stores clinic workspace information.

Fields:

- id
- name
- legal_name
- address
- phone
- email
- website
- timezone
- currency
- default_language
- created_at
- updated_at

## Table: users

Stores clinic users.

Fields:

- id
- clinic_id
- first_name
- last_name
- email
- phone
- role
- password_hash
- is_active
- last_login_at
- created_at
- updated_at

Allowed roles:

- admin
- doctor
- receptionist
- billing

## Table: patients

Stores patient/customer CRM records.

Fields:

- id
- clinic_id
- first_name
- last_name
- email
- phone
- date_of_birth
- address
- city
- postal_code
- country
- patient_status
- source
- notes
- communication_consent
- marketing_consent
- created_at
- updated_at
- deleted_at

Allowed patient_status values:

- new
- active
- inactive
- archived

Allowed source values:

- google
- referral
- social_media
- website
- walk_in
- doctolib
- other

## Table: appointment_types

Stores appointment/service categories.

Fields:

- id
- clinic_id
- name
- duration_minutes
- color
- is_active
- created_at
- updated_at

Examples:

- First consultation
- Dental cleaning
- Control visit
- Implant consultation
- Physiotherapy session

## Table: appointments

Stores patient appointments.

Fields:

- id
- clinic_id
- patient_id
- practitioner_id
- appointment_type_id
- title
- start_time
- end_time
- status
- notes
- cancellation_reason
- no_show_reason
- created_by
- updated_by
- created_at
- updated_at
- deleted_at

Allowed status values:

- scheduled
- confirmed
- completed
- cancelled
- rescheduled
- no_show

## Table: treatment_cases

Stores treatment or service opportunities.

This is not a full medical record.

Fields:

- id
- clinic_id
- patient_id
- practitioner_id
- title
- description
- stage
- estimated_amount
- accepted_amount
- currency
- expected_start_date
- closed_at
- lost_reason
- created_at
- updated_at
- deleted_at

Allowed stage values:

- new
- consultation_scheduled
- consultation_done
- quote_sent
- waiting_patient_decision
- accepted
- in_progress
- completed
- lost

## Table: tasks

Stores follow-up tasks.

Fields:

- id
- clinic_id
- patient_id
- treatment_case_id
- appointment_id
- assigned_to
- created_by
- title
- description
- due_date
- status
- priority
- completed_at
- created_at
- updated_at

Allowed status values:

- open
- in_progress
- completed
- cancelled

Allowed priority values:

- low
- normal
- high
- urgent

## Table: payments

Stores simple payment tracking records.

Fields:

- id
- clinic_id
- patient_id
- treatment_case_id
- amount
- currency
- payment_method
- payment_status
- paid_at
- notes
- created_by
- created_at
- updated_at

Allowed payment_method values:

- cash
- card
- bank_transfer
- cheque
- other

Allowed payment_status values:

- pending
- partial
- paid
- refunded
- cancelled

## Table: message_templates

Stores reusable message templates.

Fields:

- id
- clinic_id
- name
- channel
- subject
- body
- language
- is_active
- created_at
- updated_at

Allowed channel values:

- sms
- whatsapp
- email

Template variables:

- {{patient_name}}
- {{clinic_name}}
- {{appointment_date}}
- {{appointment_time}}
- {{practitioner_name}}

## Table: sent_messages

Stores sent or prepared messages.

Fields:

- id
- clinic_id
- patient_id
- appointment_id
- template_id
- channel
- recipient
- body
- status
- provider_message_id
- sent_at
- created_by
- created_at

Allowed status values:

- prepared
- sent
- failed
- delivered
- read

## Table: activity_logs

Stores important system actions.

Fields:

- id
- clinic_id
- user_id
- entity_type
- entity_id
- action
- description
- metadata_json
- ip_address
- user_agent
- created_at

Examples of entity_type:

- patient
- appointment
- treatment_case
- task
- payment
- message
- user

Examples of action:

- created
- updated
- deleted
- cancelled
- completed
- no_show
- sent
- login

## Table: settings

Stores clinic-level settings.

Fields:

- id
- clinic_id
- key
- value
- created_at
- updated_at

Example keys:

- reminder_24h_enabled
- reminder_2h_enabled
- default_appointment_duration
- allow_doctor_payment_visibility
- clinic_business_hours

# Messaging and Reminders

## Purpose

The reminder system helps clinics reduce missed appointments and improve patient communication.

## MVP Approach

The MVP does not need full automated sending at first.

Acceptable MVP levels:

### Level 1

Prepare reminder messages manually.

### Level 2

Send reminders through an external SMS, WhatsApp, or email provider.

### Level 3

Automate reminders based on appointment time.

The first working MVP can start with Level 1 or Level 2.

## Reminder Types

Recommended reminder types:

- Appointment created confirmation
- 24-hour appointment reminder
- 2-hour appointment reminder
- Missed appointment follow-up
- Treatment quote follow-up
- Post-treatment satisfaction message

## Message Channels

Supported channels:

- SMS
- WhatsApp
- Email

## Template Variables

Allowed variables:

- {{patient_name}}
- {{clinic_name}}
- {{appointment_date}}
- {{appointment_time}}
- {{practitioner_name}}

## Example Templates

### Appointment Confirmation

```txt
Hello {{patient_name}}, your appointment at {{clinic_name}} has been scheduled for {{appointment_date}} at {{appointment_time}}.
```

### 24-Hour Reminder

```txt
Hello {{patient_name}}, this is a reminder that you have an appointment at {{clinic_name}} tomorrow at {{appointment_time}}.
```

### 2-Hour Reminder

```txt
Hello {{patient_name}}, your appointment at {{clinic_name}} is today at {{appointment_time}}.
```

### No-Show Follow-Up

```txt
Hello {{patient_name}}, we noticed that you missed your appointment today. Please contact us if you would like to reschedule.
```

### Treatment Quote Follow-Up

```txt
Hello {{patient_name}}, we are following up regarding your recent visit at {{clinic_name}}. Please contact us if you have any questions.
```

## Privacy Rule

Do not include sensitive medical information in SMS or WhatsApp messages.

Avoid:

```txt
Your implant surgery appointment is tomorrow.
```

Prefer:

```txt
Your appointment at our clinic is tomorrow.
```

## Message Statuses

Messages can have these statuses:

- prepared
- sent
- failed
- delivered
- read

## Reminder Automation Logic

For automated reminders:

1. Find upcoming appointments.
2. Check reminder settings.
3. Check patient communication consent.
4. Generate message from template.
5. Send through provider.
6. Save message record.
7. Save activity log.

## Consent Rules

Before sending non-essential messages, check consent.

Required consent fields:

- communication_consent
- marketing_consent

Appointment reminders may be treated differently from marketing messages, depending on legal interpretation and jurisdiction.

Marketing messages must require marketing consent.

## Future Integrations

Potential providers:

- Twilio
- Brevo
- WhatsApp Business API provider
- Email SMTP provider
- n8n workflow integration

## n8n Integration Option

The CRM can trigger n8n webhooks for sending messages.

Example webhook payload:

```json
{
  "clinic_id": "clinic_123",
  "patient_id": "patient_123",
  "appointment_id": "appointment_123",
  "channel": "whatsapp",
  "recipient": "+33600000000",
  "message": "Hello John, your appointment is tomorrow at 10:00."
}
```

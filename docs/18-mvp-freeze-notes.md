# Health CRM - MVP Freeze Notes

## 1. Final Completed Modules
The MVP has been successfully locked with the following core modules fully functional and integrated:
- **Authentication & RBAC:** Secure JWT-based login with role scoping (Admin, Doctor, Receptionist, Billing).
- **Dashboard Analytics:** Role-aware metrics, agenda overview, overdue task alerts, and recent activity feed.
- **Patient Management:** CRUD operations, activity history, and unified detail views.
- **Appointments & Calendar:** Scheduling with conflict detection, status tracking (Scheduled, Confirmed, Completed, No-Show).
- **Clinic Services:** Lightweight service catalog built on appointment types, with service category, duration, color, base price, currency, and active/inactive status.
- **Treatment Pipeline:** Multi-stage tracking from quote generation to completion.
- **Payments:** Basic payment recording against treatment cases (Paid, Pending, Partial).
- **Task Management:** Internal follow-ups and assignable to-dos.
- **Messaging (Staging):** Multi-channel message templates (WhatsApp, SMS, Email) with dynamic variable injection (`{{patient_name}}`, `{{remaining_balance}}`, etc.).
- **Activity Logging:** Automated audit trails for critical operations.

## 2. Demo Credentials
The `Azure Dental Care` (Clinic A) dataset has been seeded for the main presentation.

*   **Admin:** `admin@clinic.com` / `password123` (Full Access)
*   **Doctor:** `doctor@clinic.com` / `password123` (Restricted to assigned patients/appointments)
*   **Reception:** `receptionist@clinic.com` / `password123` (Patient & Schedule Management)
*   **Billing:** `billing@clinic.com` / `password123` (Payment Processing & Invoice Read)

## 3. Known Limitations (MVP Scope)
These features were explicitly excluded from the MVP phase to prevent overbuilding and ensure a fast go-to-market for the pilot:
- **No real messaging integration:** WhatsApp API, Twilio SMS, and SMTP are not connected. Messages remain in 'prepared' status.
- **No electronic health records (EHR):** The system tracks operational treatment cases (e.g., "Implant", "Root Canal") but does not store detailed medical charts, diagnoses, or prescriptions.
- **No external integrations:** Accounting software, laboratory systems, or insurance claims are not supported.
- **No patient portal:** Patients cannot log in to book their own appointments.
- **No advanced pricing rules:** Clinic services support only an optional base price and currency. There is no VAT, invoicing, insurance, or accounting logic.

## 4. Freeze Rules: What NOT to change before the demo
Do NOT modify the following core architectures without explicit business approval before the pilot demo:
1.  **Database Schema Relations:** The multi-tenant structure (`clinicId` everywhere) is locked.
2.  **RBAC Logic:** The `authorize` middleware rules in the backend are final.
3.  **UI Framework:** Stick to the current Tailwind/Lucide setup. Do not introduce new major component libraries.
4.  **Seed Data:** The Azure Dental Care seed is optimized for storytelling. Modifying it right before the demo risks breaking the presentation flow.

## 5. Recommended Post-Demo Features (Phase 2)
If the pilot is successful, consider the following high-impact additions:
1.  **WhatsApp Business API Integration:** Automate the sending of the currently 'prepared' message templates.
2.  **Calendar View:** Replace the tabular Appointments list with a full Drag-and-Drop Weekly/Daily calendar component.
3.  **File Attachments:** Allow uploading basic documents (e.g., PDF quotes, consent forms) to the Patient or Treatment Case.
4.  **Data Export (GDPR):** Provide a user-facing button to export patient history to CSV.

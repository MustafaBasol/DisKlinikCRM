# Health CRM MVP - Demo Guide

This guide outlines the recommended path to demonstrate the "Azure Dental Care" CRM demo.

## Login Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@clinic.com` | `password123` |
| **Doctor** | `doctor@clinic.com` | `password123` |
| **Receptionist** | `receptionist@clinic.com` | `password123` |
| **Billing** | `billing@clinic.com` | `password123` |

---

## Demo Scenario: Dental Clinic Workflow

### 1. The Morning Briefing (Dashboard)
- **Login as Admin** or **Receptionist**.
- **Show**: The high-impact KPI cards.
- **Explain**: Today's revenue, active treatments, and new patient growth.
- **Action**: Check **Today's Agenda**. Mention Dr. Michael Chen has 5 appointments today.
- **Action**: Look at **Alerts**. Point out the "Overdue Follow-ups" and "No-Shows to Contact".

### 1a. Clinic Services Catalog
- **Navigate**: Go to **Settings -> Clinic Services** as Admin or Receptionist.
- **Show**: The service catalog includes dental services such as Initial Consultation, Dental Cleaning, Emergency Visit, Teeth Whitening, Implant Consultation, Orthodontic Control, Root Canal Treatment, Filling, and Crown Preparation.
- **Action**: Click **New Service** to add a service with name, category, duration, optional base price, currency, color, and description.
- **Explain**: Services are stored on the existing appointment type model, so appointment scheduling still works while the UI presents them as clinic services.
- **Appointments**: In the appointment form, choose a **Clinic Service**. The form automatically recalculates the end time from the service duration and shows the base price when configured.
- **Treatment Cases**: In the treatment case form, choose a **Clinic Service**. If the case title is empty, it is prefilled from the service name; estimated amount and currency are prefilled from the service base price and currency.

### 2. Handling a No-Show
- **Navigate**: Click on the "No-Show Follow-Up" alert (or go to Appointments > Filter by No-Show).
- **Show**: Sophie Muller missed her appointment yesterday.
- **Action**: Click on Sophie Muller to go to her **Patient Detail**.
- **Action**: Click **Prepare Message** > Select **"No-Show Follow-Up"** template.
- **Show**: The live preview rendering variables like `{{patient_name}}` and `{{clinic_name}}`.
- **Explain**: This allows the receptionist to quickly contact the patient via WhatsApp/SMS without manual typing.

### 3. Treatment Pipeline (Sales)
- **Navigate**: Go to **Treatment Pipeline** (Briefcase icon).
- **Show**: The Kanban-style stages (New -> Consultation -> Quote Sent -> Accepted).
- **Find**: "Full Mouth Implant" for John Miller.
- **Action**: Move a card between stages.
- **Explain**: This helps the clinic track high-value opportunities. A $15,000 implant isn't just a calendar entry; it's a sales process.

### 4. Financial Clarity (Payments)
- **Navigate**: Go to **Payments & Collections**.
- **Show**: The list of recent payments.
- **Find**: John Miller's pending balance.
- **Explain**: We can see he paid $5,000 but still owes $10,000 for his implant.
- **Action**: Click **Add Payment** to record a partial collection.

### 5. Practitioner View (Role-Specific)
- **Logout** and **Login as Doctor** (`doctor@clinic.com`).
- **Show**: The dashboard is filtered. Dr. Michael Chen sees only his own appointments and tasks.
- **Explain**: Medical data privacy is preserved. Doctors focus on clinical work, not billing or clinic-wide stats.

### 6. Turkish Clinic Insurance / Provision Tracking
- **Login as Istanbul Dental Admin**: `admin@istanbuldental.com` / `password123`.
- **Navigate**: Go to **Insurance / Provisions**.
- **Show**: Four manual provision examples: TSS approved, OSS waiting response, SGK pending documents, and private insurance rejected with a reason.
- **Action**: Open the TSS approved record and review requested amount, approved amount, patient responsibility amount, policy/provision numbers, and activity timeline.
- **Treatment case flow**: Open the linked treatment case and show the Insurance / Provisions section. Create a new provision request from the treatment case to demonstrate patient/treatment/amount prefill.
- **Explain**: This is manual workflow tracking only. There is no SGK Medula connection, no private insurance API, no invoice, VAT, prescription, diagnosis, or medical record logic.

---

## Refreshing Demo Data
To reset the demo to its original state, run:
```bash
cd server
npx prisma db seed
```

## MVP Limitations (For Internal Use)
- **Messaging**: Currently "Preparation only". No actual SMS/WhatsApp gateway is connected.
- **Medical**: No imaging or prescription modules (per MVP rules).
- **Accounting**: Simple payment tracking, not a full accounting/VAT system.

---

## 🔒 Final MVP Freeze Status
The MVP is officially **locked for demo**. 
*   **Security:** Multi-tenant clinic isolation and RBAC are hard-enforced.
*   **Session Management:** `401 Unauthorized` token expiration correctly routes users back to login without flashing protected data.
*   **Next Steps:** See `18-mvp-freeze-notes.md` for post-demo expansion plans.

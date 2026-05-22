# Sprint 20 — Manual Smoke Test Checklist

Use this checklist before each production release or after a major deploy.
Mark each item ✅ / ❌ / N/A as you test.

---

## Admin / Owner Role

| # | Test | Result |
|---|------|--------|
| 1 | Login with Owner/Admin credentials | |
| 2 | Dashboard loads with correct clinic context | |
| 3 | Organization Dashboard shows multi-branch KPIs | |
| 4 | Create a new branch (Şubeler → Yeni Şube) | |
| 5 | Edit an existing branch (name, timezone, working hours) | |
| 6 | Assign a user to a clinic (Kullanıcılar → Düzenle → Klinik Ata) | |
| 7 | Create a new patient | |
| 8 | Create an appointment for that patient | |
| 9 | Mark appointment as no-show | |
| 10 | No-show appears on No-show Takibi page | |
| 11 | Send WhatsApp recovery message from no-show page | |
| 12 | Create follow-up task for no-show patient | |
| 13 | Create a payment | |
| 14 | Finance Dashboard shows the payment | |
| 15 | Finance Dashboard clinic filter works (all / specific) | |
| 16 | Operations page (Operasyon İzleme) loads | |
| 17 | WhatsApp Bağlantıları page loads | |
| 18 | Create a WhatsApp connection (Evolution API) | |
| 19 | Test/QR for Evolution connection works | |
| 20 | Disconnect a WhatsApp connection | |
| 21 | Switching branches (ClinicSwitcher) updates data scope | |
| 22 | Logout works | |

---

## Receptionist Role

| # | Test | Result |
|---|------|--------|
| 1 | Login with Receptionist credentials | |
| 2 | Lands on Dashboard (not Finance/Admin page) | |
| 3 | Can create a patient | |
| 4 | Can create an appointment | |
| 5 | Can view WhatsApp Gelen Kutusu | |
| 6 | Can manage WhatsApp Talepleri (appointment requests) | |
| 7 | Can mark appointment as no-show | |
| 8 | Can reschedule a no-show | |
| 9 | Navigating to /finance redirects to / (no access) | |
| 10 | Navigating to /organization/dashboard redirects to / | |
| 11 | Navigating to /branches redirects to / | |
| 12 | Navigating to /users redirects to / | |
| 13 | Logout works | |

---

## Billing Role

| # | Test | Result |
|---|------|--------|
| 1 | Login with Billing credentials | |
| 2 | Redirected to /finance automatically | |
| 3 | Finance Dashboard visible and populated | |
| 4 | Ödemeler (Payments) page accessible | |
| 5 | Taksit Planları (Payment Plans) page accessible | |
| 6 | Navigating to /patients returns 403 or redirect | |
| 7 | Navigating to /appointments returns 403 or redirect | |
| 8 | Navigating to /whatsapp-inbox redirects to / | |
| 9 | Navigating to /organization/dashboard redirects to / | |
| 10 | Logout works | |

---

## Dentist Role

| # | Test | Result |
|---|------|--------|
| 1 | Login with Dentist credentials | |
| 2 | Lands on Dashboard | |
| 3 | Appointments page shows only own/permitted appointments | |
| 4 | Kazançlarım (My Earnings) page accessible | |
| 5 | Navigating to /practitioner-earnings (all doctors) is NOT accessible | |
| 6 | Navigating to /finance redirects to / | |
| 7 | Navigating to /organization/dashboard redirects to / | |
| 8 | Navigating to /users redirects to / | |
| 9 | Patient files — can upload/view but NOT delete | |
| 10 | Dental chart — can edit for own patients | |
| 11 | Logout works | |

---

## WhatsApp Functionality

| # | Test | Result |
|---|------|--------|
| 1 | WhatsApp Gelen Kutusu loads conversations | |
| 2 | Replying to a conversation sends message | |
| 3 | Marking conversation resolved works | |
| 4 | Clinic auto-resolution works for incoming messages | |
| 5 | selectedClinicId=all blocks sending without explicit clinic selection | |
| 6 | WhatsApp connection with token expiry badge shows correct status | |
| 7 | Legacy env fallback card hidden when ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false | |

---

## Finance / No-show

| # | Test | Result |
|---|------|--------|
| 1 | No-show dashboard estimated revenue is 0 when no basePrice | |
| 2 | Service pricing prefills estimatedCost in treatment procedures | |
| 3 | Finance dashboard does not mix data from different organizations | |
| 4 | Currency symbol is consistent across Finance and Payments pages | |

---

## API / Security

| # | Test | Result |
|---|------|--------|
| 1 | Expired token returns 401 (not 500) | |
| 2 | Invalid clinic ID returns 404 (not 500) | |
| 3 | Wrong organization access returns 403 | |
| 4 | GET /api/organization/whatsapp/connections does NOT return token fields | |
| 5 | No stack traces in any API error response | |

---

## Post-Deploy Verification

```bash
docker ps --filter "name=disklinikcrm" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs --tail=50 disklinikcrm_api
docker exec -it disklinikcrm_api sh -c "cd /app && npx prisma migrate status"
```

All migrations should show as `Applied`. No pending migrations.

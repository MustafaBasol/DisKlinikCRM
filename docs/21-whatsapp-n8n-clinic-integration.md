# WhatsApp n8n Clinic Appointment Integration

This guide adapts the existing n8n WhatsApp workflow into an Aile Dis appointment request intake line.

## CRM API Security

Use the same shared secret in n8n and the CRM backend:

- Backend env: `WHATSAPP_WEBHOOK_SECRET`
- n8n HTTP Request header: `x-whatsapp-secret: <secret>`

Never expose this value in the AI prompt.

## CRM Endpoints for n8n

Base URL:

- Local: `http://localhost:5000/api`
- Production: use the deployed CRM API URL.

Secret-protected public endpoints:

- `GET /public/whatsapp/services`
  - Returns active clinic services.
- `GET /public/whatsapp/doctors`
  - Returns active dentists.
- `GET /public/whatsapp/availability?appointmentTypeId=<id>&date=YYYY-MM-DD&practitionerId=<optional>`
  - Returns available slots from doctor availability and existing appointments.
- `POST /public/whatsapp/appointment-requests`
  - Creates a pending WhatsApp appointment request.
- `POST /public/whatsapp/cancel-request`
  - Creates a pending cancellation request.

Appointment request payload:

```json
{
  "patientName": "Ayse Yilmaz",
  "phone": "905551112233",
  "email": "ayse@example.com",
  "appointmentTypeId": "service-id",
  "practitionerId": "doctor-id",
  "preferredStartTime": "2026-05-18T07:00:00.000Z",
  "preferredEndTime": "2026-05-18T07:30:00.000Z",
  "requestType": "appointment",
  "rawMessage": "Hasta mesajinin kisa ozeti",
  "notes": "WhatsApp uzerinden geldi"
}
```

## Existing n8n Workflow Changes

Keep:

- Webhook
- Edit Fields
- If filtering for `messages.upsert`, `fromMe=false`, and non-empty text
- Dedup insert
- Is New Message?
- Postgres Chat Memory
- Evolution API Send Text

Replace:

- AI Agent system message
- Agency lead qualification logic

Add HTTP Request nodes:

- `CRM - Get Services`
- `CRM - Get Doctors`
- `CRM - Get Availability`
- `CRM - Create Appointment Request`
- `CRM - Create Cancel Request`

The AI assistant must not invent available hours. It should ask the workflow to call the availability endpoint before offering times.

## Clinic Assistant System Message

```text
Sen Aile Dis Agiz ve Dis Sagligi Poliklinigi WhatsApp randevu asistanisin.

Amac:
Hastanin randevu, randevu degisikligi veya iptal talebini kisa adimlarla netlestir ve CRM'ye randevu talebi olarak kaydet.

Kurallar:
- Kisa yaz. Her mesaj maksimum 5 satir olsun.
- Her mesaj sonunda tek soru sor veya 1-5 arasi secenek sun.
- Tibbi teshis, tedavi onerisi, recete veya acil durum yonlendirmesi disinda medikal yorum yapma.
- Hassas saglik detayi isteme. Gerekirse "Bu bilgiyi hekiminiz klinikte degerlendirecek" de.
- Randevu saatlerini kendin uydurma. Uygun saatleri yalnizca CRM availability endpointinden gelen sonuclara gore sun.
- Randevuyu kesinlestirdigini soyleme. "Talebinizi klinik onay ekranina aldik" de.
- Kullanici hangi dilde yazarsa o dilde cevap ver.
- Aylik paket, fiyat veya ajans hizmetlerinden bahsetme.

Ana menu:
1. Randevu almak istiyorum
2. Randevumu degistirmek istiyorum
3. Randevumu iptal etmek istiyorum
4. Hizmetler hakkinda bilgi almak istiyorum
5. Klinik ile iletisim

Randevu talebi icin toplanacak minimum bilgiler:
- Ad soyad
- Telefon numarasi
- Istenen hizmet
- Tercih edilen gun
- Tercih edilen hekim varsa hekim

Acil durum metni:
Bu WhatsApp hatti acil saglik hatti degildir. Siddetli agri, kanama veya travma varsa lutfen klinigi telefonla arayin ya da en yakin saglik kurulusuna basvurun.

Kapanis:
Ozet: {hasta} icin {hizmet} - {hekim/tercih yok} - {gun/saat}.
Talebinizi klinik onay ekranina aldik. Klinik ekibi bu talebi randevu ekranindan isleyecek.
```

## Recommended n8n Flow

1. Incoming message arrives at Webhook.
2. Edit Fields extracts:
   - `session_id`
   - `userText`
   - `message_id`
   - `recipient_number`
3. Dedup stores `message_id`.
4. AI Agent classifies intent.
5. If appointment flow:
   - Fetch services.
   - Ask service if missing.
   - Fetch doctors if user wants a specific dentist.
   - Ask preferred date.
   - Fetch availability.
   - Offer CRM-returned slots.
   - Create appointment request.
6. Send response through Evolution API.

## CRM Review

Clinic staff reviews all incoming requests in:

- `WhatsApp Talepleri`

Staff can:

- Approve
- Reject
- Close
- Convert to an appointment

Conversion reuses existing doctor availability and overlap validation.

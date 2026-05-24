# Sprint 23 — Instagram DM Integration

## Overview

This sprint adds Instagram Direct Messages as a second messaging channel alongside WhatsApp. Clinic staff can now receive, view, reply to, and convert Instagram DM appointment requests directly from the CRM panel.

---

## Architecture Decision: Option B (Dedicated Models)

Instagram uses **separate, dedicated database models** rather than extending the existing WhatsApp models. This was chosen to:

- Avoid any risk of disrupting the existing WhatsApp channel (which is production-ready).
- Allow each channel's schema to evolve independently.
- Keep provider-specific configuration fields cleanly separated.

---

## Meta / Instagram Prerequisites

Before using this feature, the clinic must:

1. Have a **Professional (Business or Creator) Instagram account**.
2. **Connect the Instagram account to a Facebook Page** (required for Messaging API access).
3. Create a **Meta App** at [developers.facebook.com](https://developers.facebook.com/) with:
   - `instagram_manage_messages` permission
   - `pages_messaging` permission
4. Generate a **Page Access Token** with the above permissions.
5. Configure the webhook in the Meta App:
   - **Callback URL**: `https://your-domain.com/api/public/instagram/webhook`
   - **Verify Token**: The token shown in the CRM connection card
   - **Subscribed Fields**: `messages`

> **Note**: External Meta App approval (`instagram_manage_messages`) requires Meta's business verification for production use. In sandbox/development mode, only testers added to the Meta App can send messages.

---

## Database Models Added

### `InstagramConnection`
Stores organization-level Instagram channel credentials.

| Field | Type | Description |
|---|---|---|
| `instagramAccountId` | String | Numeric Instagram account ID (IGSID) |
| `instagramUsername` | String? | Handle (without @) for display |
| `facebookPageId` | String? | Connected Facebook Page ID |
| `accessTokenEncrypted` | String? | AES-256-GCM encrypted Page Access Token |
| `webhookVerifyToken` | String? | Random token for Meta webhook verification |
| `webhookSecret` | String? | Encrypted App Secret for X-Hub-Signature-256 validation |
| `tokenStatus` | String? | `valid`, `expired`, `unknown` |
| `status` | String | `connected` / `disconnected` / `connecting` / `error` |
| `isActive` | Boolean | Master on/off switch |

### `ClinicInstagramConnection`
Many-to-many junction: links an `InstagramConnection` to one or more `Clinic` branches.

### `InstagramInboxEntry`
One record per unique sender (conversation thread).

| Field | Type | Description |
|---|---|---|
| `externalSenderId` | String | Instagram sender's IGSID |
| `senderUsername` | String? | Instagram handle if resolvable |
| `lastMessageText` | String? | Preview of last message |
| `messageCount` | Int | Total messages received |
| `needsClinicResolution` | Boolean | True when multiple clinics = manual assignment needed |
| `status` | String | `open` / `resolved` / `ignored` |
| `clinicId` | String? | Assigned clinic |
| `patientId` | String? | Linked patient record |

---

## Backend Endpoints Added

### Organization Instagram Connections (`/api/organization/instagram-connections`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/organization/instagram-connections` | OWNER, ORG_ADMIN | List all connections (tokens stripped) |
| POST | `/api/organization/instagram-connections` | OWNER, ORG_ADMIN | Create new connection |
| GET | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Get single connection |
| PUT | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Update (empty token = preserve existing) |
| POST | `/api/organization/instagram-connections/:id/test` | OWNER, ORG_ADMIN | Test Meta API connection |
| POST | `/api/organization/instagram-connections/:id/disconnect` | OWNER, ORG_ADMIN | Mark disconnected |
| PATCH | `/api/organization/instagram-connections/:id/status` | OWNER, ORG_ADMIN | Toggle isActive |
| DELETE | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Delete connection |

### Clinic Instagram Assignment (`/api/clinics/:clinicId/instagram`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/clinics/:clinicId/instagram` | List connections for clinic |
| PUT | `/api/clinics/:clinicId/instagram` | Set assigned connections |
| DELETE | `/api/clinics/:clinicId/instagram/:connectionId` | Unassign connection |

### Instagram Inbox (`/api/instagram/inbox`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/instagram/inbox/unassigned` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Entries needing manual clinic assignment |
| GET | `/api/instagram/inbox/conversations` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | All conversations (filterable by status/clinic) |
| POST | `/api/instagram/inbox/:id/resolve` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Assign clinic + link patient |
| POST | `/api/instagram/inbox/:id/link-patient` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Link patient to existing entry |
| POST | `/api/instagram/inbox/:id/assign-clinic` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Assign/change clinic |
| POST | `/api/instagram/conversations/:id/reply` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Send reply via Meta API |

### Public Webhook (`/api/public/instagram/...`)

No authentication — called by Meta's servers.

| Method | Path | Description |
|---|---|---|
| GET | `/api/public/instagram/webhook` | Global webhook verification challenge |
| POST | `/api/public/instagram/webhook` | Global incoming DM receiver |
| GET | `/api/public/instagram/:connectionId/webhook` | Per-connection webhook verification |
| POST | `/api/public/instagram/:connectionId/webhook` | Per-connection incoming DM receiver |

Webhooks always respond `200 OK` immediately (Meta retries on non-2xx).

---

## Permission Matrix

| Permission | OWNER | ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST | BILLING | DOCTOR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Manage connections | ✓ | ✓ | — | — | — | — |
| Assign to clinic | ✓ | ✓ | ✓ | — | — | — |
| View connection status | ✓ | ✓ | ✓ | — | — | — |
| View inbox | ✓ | ✓ | ✓ | ✓ | — | — |
| Reply messages | ✓ | ✓ | ✓ | ✓ | — | — |
| Resolve conversations | ✓ | ✓ | ✓ | — | — | — |

---

## Frontend Pages Added

### `src/pages/InstagramConnections.tsx`
- Route: `/organization/instagram`
- Lists all Instagram connections with status badges
- Add / Edit modal with: name, account ID, username, Facebook Page ID, access token (write-only), verify token, webhook secret, Meta App ID, clinic assignment checkboxes
- Actions: Test connection, Toggle active, Disconnect, Delete
- Expandable detail panel: webhook URL + verify token (copy buttons), last connection time, assigned clinics
- Setup guide banner with Meta docs link

### `src/pages/InstagramInbox.tsx`
- Route: `/instagram-inbox`
- Two tabs: **Atanmamış** (unassigned, requires manual clinic assignment) / **Tüm Konuşmalar** (all, filterable)
- Conversation cards: sender @handle, last message preview, message count, status badge, assigned clinic/patient
- Actions: **Yanıtla** (reply modal with 1000-char limit), **Şube Ata** (assign clinic), **Hasta Bağla** (link patient)
- Resolve modal: clinic selector + patient search (name/phone)

---

## Sidebar Navigation

Added to **İletişim** nav group (after WhatsApp items):
- **Instagram Gelen Kutusu** — visible to OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST
- **Instagram Bağlantıları** — visible to OWNER, ORG_ADMIN, CLINIC_MANAGER

---

## Tests

File: `server/src/tests/instagramProvider.test.ts`  
Run: `npm run test:instagram` (from `server/` directory)

**30 tests, all passing:**
- Encryption round-trip
- `parseWebhook`: text message, echo, non-instagram object, null input, empty messaging
- `testConnection`: missing token, inactive connection
- `sendMessage`: empty text, missing account ID, truncation behavior
- Permission helpers: all 6 functions across OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/BILLING
- HMAC signature validation

---

## Clinic Auto-Assignment Logic

When a webhook arrives:
1. Look up which `InstagramConnection` it belongs to (by `connectionId` in URL, or by matching `recipientId` in payload).
2. Find all clinics linked to that connection (`ClinicInstagramConnection`).
3. If **exactly one clinic** → auto-assign `clinicId`, `needsClinicResolution = false`.
4. If **zero or multiple clinics** → create entry with `needsClinicResolution = true` → appears in unassigned inbox tab.
5. Create/update `InstagramInboxEntry` (upsert on `externalSenderId + instagramConnectionId`).

---

## Security Notes

- Access tokens and webhook secrets are **AES-256-GCM encrypted at rest** (same `encryptSecret` / `decryptSecret` as WhatsApp).
- Tokens are **never returned to the client** — all GET endpoints sanitize the response.
- Cross-organization access is blocked on every route (all DB queries include `organizationId` filter).
- Webhook signature is validated via HMAC SHA-256 (`X-Hub-Signature-256` header) when `webhookSecret` is set.
- No sensitive health data is sent via Instagram DM replies.

---

## Known Limitations (MVP)

- **Text messages only** — media (images, audio, stickers, video) are ingested as `unsupported` event type (not displayed to staff, not blocked).
- **No AI parsing** of appointment intent — staff must manually identify appointment requests.
- **No read receipts** — the CRM does not send `seen` events back to Meta.
- **External Meta approval required** — `instagram_manage_messages` requires Meta business verification for non-sandbox use.
- **Token refresh** — long-lived tokens should be refreshed before expiry; no automated refresh in this sprint.

---

---

# Sprint 23B — Instagram DM → Randevu Dönüşüm Akışı

## Overview

Bu sprint, Sprint 23'ün iş akışı tamamlayıcısıdır. Instagram DM görüşmeleri artık doğrudan **randevu talebine** veya **randevuya** dönüştürülebilir. Tüm dönüşüm işlemleri ilgili inbox entry'yi `converted` statüsüne geçirir ve çift dönüşümü engeller.

---

## Yeni Backend Endpoint'leri (`server/src/routes/instagramInbox.ts`)

### İnbox Dönüşüm Endpoint'leri

| Method | Path | Yetki | Açıklama |
|---|---|---|---|
| POST | `/api/instagram/inbox/:id/create-appointment-request` | canViewInstagramInbox | DM'i AppointmentRequest'e dönüştürür (`source='instagram'`) |
| POST | `/api/instagram/inbox/:id/create-appointment` | canViewInstagramInbox | DM'den doğrudan Appointment oluşturur |
| PATCH | `/api/instagram/inbox/:id/status` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST, DOCTOR | Entry statüsünü günceller (`open`/`resolved`/`ignored`/`converted`) |

### `POST /instagram/inbox/:id/create-appointment-request`

**Validasyon kuralları:**
- Entry kendi organizasyonuna ait olmalı (404 değilse)
- `clinicId` atanmış olmalı (400 — "clinicId is required — assign clinic first")
- Entry `status !== 'converted'` olmalı (400 — "Entry already converted")

**Davranış:**
- `AppointmentRequest` oluşturur: `source='instagram'`, `status='pending'`
- Hasta bağlıysa: `patientName/phone` hasta kaydından alınır
- Hasta bağlı değilse: `patientName = '@username'` veya `externalSenderId`, `phone = externalSenderId`
- Entry `status = 'converted'` yapılır
- Audit log yazılır: `instagram_inbox_converted_to_request`

**Request body:** Yok (tüm veriler entry'den türetilir)

**Response (201):**
```json
{ "appointmentRequest": { "id": "...", "status": "pending", "source": "instagram", ... } }
```

---

### `POST /instagram/inbox/:id/create-appointment`

**Validasyon kuralları:**
- Entry org doğrulaması (404)
- Body alanları zorunlu: `patientId`, `clinicId`, `practitionerId`, `appointmentTypeId`, `date`, `time`
- `date` + `time` → geçerli ISO DateTime olmalı
- Hasta organizasyona ait olmalı
- Pratisyen kliniğe atanmış olmalı
- Çakışma kontrolü (başlangıç/bitiş zamanı)
- Entry `status !== 'converted'` olmalı

**Davranış:**
- `Appointment` oluşturur (mevcut appointment endpoint'i ile aynı mantık)
- Entry `status = 'converted'` yapılır
- Audit log yazılır: `instagram_inbox_converted_to_appointment`

**Request body:**
```json
{
  "patientId": "string",
  "clinicId": "string",
  "practitionerId": "string",
  "appointmentTypeId": "string",
  "date": "2025-06-20",
  "time": "14:30",
  "endTime": "15:00",  // opsiyonel
  "notes": "string"   // opsiyonel
}
```

---

### `PATCH /instagram/inbox/:id/status`

Genel statü güncelleme endpoint'i. AppointmentForm'daki markConverted çağrısı tarafından kullanılır.

**Geçerli statüler:** `open`, `resolved`, `ignored`, `converted`

---

## Frontend Değişiklikleri

### `src/pages/InstagramInbox.tsx`

Her konuşma kartına iki yeni aksiyon butonu eklendi (yalnızca `status !== 'converted'` olduğunda görünür):

#### "Talep Oluştur" Butonu
- **Yetki:** `canViewInstagramInbox` (RECEPTIONIST dahil)
- **Klinik yoksa:** `disabled` + tooltip "Önce şube atayın"
- **Akış:** `window.confirm` → `instagramInboxService.createAppointmentRequest(id)` → toast + reload
- **Renk:** Mor (purple)

#### "Randevu" Butonu
- **Yetki:** `canViewInstagramInbox`
- **Hasta + klinik atanmışsa:** Inline randevu modalı açılır (hekim/hizmet/tarih/saat formu)
- **Atanmamışsa:** `/appointments?source=instagram&instagramInboxEntryId=...&patientId=...&clinicId=...` URL'ye yönlendirir
- **Renk:** Yeşil (green)

#### Dönüştürüldü Rozeti
`status === 'converted'` olduğunda aksiyonlar yerine mor "Dönüştürüldü" rozeti gösterilir; Yanıtla/Talep/Randevu butonları gizlenir.

#### Inline Randevu Modalı (`AppointmentModal`)
- Hekim listesi: `userService.getDoctors()`
- Hizmet listesi: `serviceService.getAll({ onlyActive: true })`
- Tarih + saat inputları
- Not alanı (Instagram DM kaynağından otomatik doldurulur)
- Kaydet → `instagramInboxService.createAppointment(id, data)` → entry `converted` + toast

#### Toast Bildirimleri
- Sağ alt köşede slide-in toast (başarı: yeşil, hata: kırmızı), 3 saniye sonra kaybolur

---

### `src/components/AppointmentForm.tsx`

#### `AppointmentFormPrefill` Arayüzü Güncellemesi

```typescript
export interface AppointmentFormPrefill {
  patientId?: string;
  practitionerId?: string;
  appointmentTypeId?: string;
  clinicId?: string;                 // YENİ — Instagram DM'den şube prefill
  source?: string;
  previousAppointmentId?: string;
  instagramInboxEntryId?: string;    // YENİ — markConverted için
}
```

#### Instagram Kaynak Banner'ı
`source === 'instagram' && instagramInboxEntryId` koşulu sağlandığında mor bilgi banner'ı gösterilir:

> "Bu randevu Instagram DM görüşmesinden oluşturuluyor. Randevu kaydedildiğinde ilgili DM 'Dönüştürüldü' olarak işaretlenecek."

#### Otomatik Not
Instagram kaynağı için `notes` alanı otomatik olarak `"Instagram DM'den oluşturuldu."` ile doldurulur.

#### Randevu Sonrası markConverted
Başarılı randevu oluşturma sonrası `instagramInboxEntryId` varsa:
```typescript
await instagramInboxService.markConverted(prefill.instagramInboxEntryId);
// fire-and-forget — hata randevu oluşturmayı etkilemez
```

---

### `src/services/api.ts`

`instagramInboxService`'e eklenen metodlar:

```typescript
createAppointmentRequest: (id: string) =>
  api.post(`/instagram/inbox/${id}/create-appointment-request`),

createAppointment: (id: string, data: {
  patientId: string; clinicId: string; practitionerId: string;
  appointmentTypeId: string; date: string; time: string;
  endTime?: string; notes?: string;
}) => api.post(`/instagram/inbox/${id}/create-appointment`, data),

markConverted: (id: string) =>
  api.patch(`/instagram/inbox/${id}/status`, { status: 'converted' }),
```

---

## Yetki Matrisi Güncellemesi

| İşlem | OWNER | ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST | BILLING | DOCTOR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Randevu talebine dönüştür | ✓ | ✓ | ✓ | ✓ | — | — |
| Doğrudan randevu oluştur | ✓ | ✓ | ✓ | ✓ | — | — |
| Entry statüsü güncelle | ✓ | ✓ | ✓ | ✓ | — | ✓ |

> RECEPTIONIST artık `canViewInstagramInbox` kapsamında randevu talebi oluşturabilir. Ancak `canResolveInstagramConversation` (şube/hasta atama) hâlâ CLINIC_MANAGER ve üstüne aittir.

---

## Dönüşüm Çift-Engel Mantığı

```
entry.status === 'converted' → 400 "Entry already converted"
```

Hem `create-appointment-request` hem `create-appointment` endpoint'leri bu kontrolü yapar. Böylece bir DM iki kez dönüştürülemez.

---

## Tests — Sprint 23B

Dosya: `server/src/tests/instagramConversion.test.ts`  
Çalıştır: `npx tsx src/tests/instagramConversion.test.ts` (server/ dizininden)

**41 test, tamamı geçiyor:**

| Bölüm | Test Sayısı | Konu |
|---|---|---|
| §1 Yetki kontrolleri | 9 | canViewInstagramInbox / canResolveInstagramConversation rollere göre |
| §2 create-appointment-request validasyonu | 5 | Eksik clinicId, çapraz-org, çift dönüşüm, geçerli payload |
| §3 create-appointment validasyonu | 8 | Her zorunlu alan eksikliği + geçersiz tarih + başarılı payload |
| §4 PATCH status validasyonu | 7 | Geçerli/geçersiz statü değerleri |
| §5 Instagram kaynak alan mantığı | 5 | source='instagram', anonim kullanıcı fallback |
| §6 Frontend UI durum mantığı | 7 | Buton disable/enable, converted rozeti, aksiyon gizleme |

---

---

# Sprint 23B Hotfix — Instagram Webhook URL Hatası

## Sorun

`InstagramConnections.tsx` dosyasında `VITE_API_URL = https://api-klinik.autoviseo.com/api` değeri ile webhook URL'si yanlış üretiliyordu:

```typescript
// YANLIŞ — JavaScript .replace() ilk eşleşmeyi bulur
const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || '';
```

`'https://api-klinik.autoviseo.com/api'` dizesinde `/api` ilk olarak **pos 7**'de bulunur: `://[/api]-klinik...`. Bu yüzden:

```
'https://api-klinik.autoviseo.com/api'
         ↑ burası eşleşiyor (pos 7)
→ 'https:/-klinik.autoviseo.com/api'   ← YANLIŞ hostname
```

Sonuç olarak `WEBHOOK_BASE + '/webhook'` şöyle bir URL üretiyordu:
```
https:/-klinik.autoviseo.com/api/api/public/instagram/webhook  ← /api/api duplikasyonu
```

## Düzeltme

Yalnızca sondaki `/api` suffix'ini kaldıran regex:

```typescript
// DOĞRU — sadece string sonundaki /api'yi kaldırır
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
const WEBHOOK_BASE = `${API_BASE_URL}/api/public/instagram`;
const GLOBAL_WEBHOOK_URL = `${WEBHOOK_BASE}/webhook`;
```

**Sonuç:**
```
https://api-klinik.autoviseo.com/api → https://api-klinik.autoviseo.com
GLOBAL_WEBHOOK_URL = https://api-klinik.autoviseo.com/api/public/instagram/webhook ✓
```

Regex `/\/api\/?$/` uç örnekleri:
| Giriş | Çıkış |
|---|---|
| `https://api-klinik.autoviseo.com/api` | `https://api-klinik.autoviseo.com` ✓ |
| `http://localhost:5000/api` | `http://localhost:5000` ✓ |
| `/api` (varsayılan) | `''` (relative, local dev) ✓ |
| `https://example.com/api/` | `https://example.com` ✓ |

## UI İyileştirmeleri

### Bilgi Banner'ı (Kurulum Rehberi)

- **Callback URL** yanına kopyalama butonu eklendi
- Açıklama metni eklendi:
  > "Bu global webhook URL tüm klinikler için aynıdır. Sistem gelen mesajdaki Instagram Account ID üzerinden doğru bağlantı ve şubeyi bulur."

### Kart Detay Paneli — Webhook Yapılandırması

Önceki yapı (tek URL, connection-specific):
```
Callback URL: https://.../{connectionId}/webhook  [kopyala]
Verify Token: abc123  [kopyala]
```

Yeni yapı:
```
Global Callback URL (önerilen):
  https://api-klinik.autoviseo.com/api/public/instagram/webhook  [kopyala]

Verify Token: abc123  [kopyala]

▶ Bağlantıya özel URL (gelişmiş, opsiyonel)
  https://.../{connectionId}/webhook  [kopyala]
  "Yalnızca bu bağlantıya özel yönlendirme gerekiyorsa kullanın."
```

Connection-specific URL `<details>` collapse içine taşındı — Meta panelinde kullanılmaması gereken gelişmiş bir seçenek olarak işaretlendi.

---

## Dosya Değişiklikleri Özeti

| Dosya | Sprint | Değişiklik |
|---|---|---|
| `server/src/routes/instagramInbox.ts` | 23B | `create-appointment-request`, `create-appointment`, `PATCH status` endpoint'leri eklendi |
| `server/src/tests/instagramConversion.test.ts` | 23B | YENİ — 41 test dosyası |
| `src/services/api.ts` | 23B | `instagramInboxService`'e 3 yeni metod eklendi |
| `src/pages/InstagramInbox.tsx` | 23B | Talep/Randevu butonları, inline modal, converted rozeti, toast |
| `src/components/AppointmentForm.tsx` | 23B | `clinicId`/`instagramInboxEntryId` prefill, Instagram banner, markConverted |
| `src/pages/InstagramConnections.tsx` | 23B Hotfix | URL regex düzeltmesi, `GLOBAL_WEBHOOK_URL`, geliştirilmiş webhook UI |

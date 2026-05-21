# Sprint 11 — Paylaşımlı WhatsApp Gelen Kutusu, Klinik Çözümleme ve Konuşma Yönlendirme

## Özet

Sprint 11, çok şubeli klinik yapısında paylaşımlı bir WhatsApp hattından gelen mesajların doğru kliniğe yönlendirilmesini sağlayan altyapıyı tamamlar. Klinik bağlamı belirlenemediğinde mesajlar "WhatsApp Gelen Kutusu"na düşer; yetkili personel bu mesajları manuel olarak bir kliniğe atar.

---

## 1. Veritabanı Değişiklikleri

### Yeni Model: `WhatsAppInboxEntry`

`server/prisma/schema.prisma` dosyasına eklendi.

| Alan | Tür | Açıklama |
|------|-----|----------|
| `id` | String | UUID |
| `organizationId` | String | Organizasyon ID (zorunlu) |
| `whatsappConnectionId` | String? | Hangi WA bağlantısından geldi |
| `clinicId` | String? | Atanan klinik (null = henüz atanmamış) |
| `patientId` | String? | Bağlanan hasta (opsiyonel) |
| `resolvedByUserId` | String? | Çözen personelin ID'si |
| `phone` | String | Gönderenin telefonu |
| `displayName` | String? | Gönderenin görünen adı |
| `lastMessageText` | String? | Son mesaj metni |
| `messageCount` | Int | Mesaj sayısı (varsayılan: 1) |
| `externalMessageId` | String? | Provider'dan gelen mesaj ID'si |
| `rawPayload` | Json? | Ham webhook verisi |
| `needsClinicResolution` | Boolean | True = personelin ataması gerekiyor |
| `status` | String | `open` veya `resolved` |
| `resolvedAt` | DateTime? | Çözülme zamanı |
| `createdAt` / `updatedAt` | DateTime | Zaman damgaları |

**Migrasyon:** `server/prisma/migrations/20260521_whatsapp_inbox_entry/migration.sql` — oluşturuldu ve uygulandı.

**Back-reference'lar:** `Organization`, `Clinic`, `Patient`, `User`, `WhatsAppConnection` modelleri güncellendi.

---

## 2. Klinik Çözümleme Servisi (`clinicResolver.ts`)

**Dosya:** `server/src/services/whatsapp/clinicResolver.ts`

Gelen WhatsApp mesajı için doğru kliniği belirler. Öncelik sırası:

| Öncelik | Kaynak | Açıklama |
|---------|--------|----------|
| **A** | Reply context | Son 48 saatte bu numaraya giden `SentMessage` varsa, o kliniği kullan |
| **B** | Recent conversation | `WhatsAppConversationState` tablosunda bu numaranın aktif konuşması hangi klinikte? |
| **C** | Single clinic | WA bağlantısı tek bir kliniğe atanmışsa, o kliniği kullan |
| **D** | Unresolved | Paylaşımlı hat, bağlam yok → `needsClinicResolution=true`, gelen kutusuna yaz |

**Ana fonksiyonlar:**
- `resolveClinicForIncomingMessage(connectionId, organizationId, rawPhone)` → `ClinicResolutionResult`
- `upsertInboxEntry(params)` → Açık giriş varsa `messageCount` arttırır, yoksa yeni oluşturur
- `getPhoneVariants(digits)` → Türk telefon normalleştirme (90xxx, 0xxx, 10-hane)

**Önemli kural:** Çözümsüz mesajlar asla rastgele ilk kliniğe atanmaz.

---

## 3. Webhook Entegrasyonu (`whatsapp.ts`)

`/evolution-webhook` POST endpoint'i geliştirildi:

1. `evolutionInstanceName` ile DB'de `WhatsAppConnection` aranır
2. Bulunursa `resolveClinicForIncomingMessage()` çağrılır
3. `needsClinicResolution=true` → `upsertInboxEntry()` + `{ ok: true, routed: 'inbox_unassigned' }` döner
4. Çözüldüyse → mevcut klinik akışı clinicId ile çalışır
5. `no_clinic_links` → eski env-var tabanlı `getClinicForWhatsAppInstance()` çalışır (geriye dönük uyumluluk)

---

## 4. API Endpoint'leri (`whatsappInbox.ts`)

**Dosya:** `server/src/routes/whatsappInbox.ts`

| Method | Endpoint | Yetkiler | Açıklama |
|--------|----------|----------|----------|
| GET | `/api/whatsapp/inbox/unassigned` | OWNER, ORG_ADMIN | `needsClinicResolution=true, status='open'` girişleri; `possiblePatients` dahil |
| GET | `/api/whatsapp/inbox/conversations` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST, DENTIST | `status` ve `clinicId` filtrelenebilir |
| POST | `/api/whatsapp/inbox/:id/resolve` | OWNER, ORG_ADMIN, CLINIC_MANAGER | `clinicId` zorunlu, `patientId` opsiyonel; CLINIC_MANAGER kendi kliniklerine sınırlı |
| POST | `/api/whatsapp/inbox/:id/link-patient` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | `patientId` zorunlu; org kapsamı doğrulanır |

Tüm sorgular `organizationId` ile kapsama alınmıştır → çapraz-org veri sızıntısı yok.

---

## 5. Yetki Yardımcıları

### Backend (`server/src/utils/roles.ts`)

```typescript
canViewWhatsAppInbox(user)          // OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST
canResolveWhatsAppConversation(user) // OWNER, ORG_ADMIN, CLINIC_MANAGER
canLinkWhatsAppPatient(user)         // OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST
```

### Frontend (`src/utils/permissions.ts`)

Aynı üç fonksiyon, `getRole(user)` kullanarak frontend'de de tanımlandı.

---

## 6. Frontend

### API Servisi (`src/services/api.ts`)

```typescript
export const whatsappInboxService = {
  getUnassigned: () => ...,
  getConversations: (params?) => ...,
  resolve: (id, { clinicId, patientId? }) => ...,
  linkPatient: (id, patientId) => ...,
};
```

### Sayfa (`src/pages/WhatsAppInbox.tsx`)

İki sekme:
1. **Atanmamış** — `needsClinicResolution=true` girişler, olası hastalar, "Kliniğe Ata" butonu
2. **Tüm Konuşmalar** — durum ve klinik filtreleri, çözüm durumu göstergesi

Çözüm modalı: klinik seçimi + hasta arama/seçimi.

Yetki kontrolü: `canViewWhatsAppInbox(user)` false ise anasayfaya yönlendirilir.

### Navigasyon (`src/layouts/MainLayout.tsx`)

`canViewWhatsAppInbox(user)` true ise "WA Gelen Kutusu" nav öğesi eklenir (Inbox ikonu).

### Route (`src/App.tsx`)

```tsx
<Route path="whatsapp-inbox" element={<WhatsAppInbox />} />
```

---

## 7. Testler

**Dosya:** `server/src/tests/whatsappInbox.test.ts`

**25/25 test geçti.** Kapsam:

- Türk telefon normalleştirme (5 test)
  - E.164 (90xxx), 0xxx, 10-hane, boş string, Türk olmayan format
- `canViewWhatsAppInbox` (7 test)
- `canResolveWhatsAppConversation` (5 test)
- `canLinkWhatsAppPatient` (6 test)
- `ClinicResolutionResult` tip güvenliği (2 test)

**Script:** `server/package.json`
```json
"test:inbox": "tsx src/tests/whatsappInbox.test.ts"
```
`npm test` artık fixtures + whatsapp + inbox testlerini çalıştırır.

---

## 8. TypeScript Durumu

| Hedef | Durum |
|-------|-------|
| Backend (`server`) | ✅ Hata yok |
| Frontend (`src`) | ✅ Hata yok |

---

## 9. Kalan Çalışmalar (Sprint 12+)

| Konu | Açıklama |
|------|----------|
| Gerçek zamanlı güncelleme | WebSocket/SSE ile gelen kutusu canlı güncellemesi |
| Klinik seçici UI | Resolve modalında klinik ID girişi yerine dropdown |
| Konuşma geçmişi | Gelen kutusundan tam konuşma görüntüleme |
| Bildirimler | Yeni atanmamış mesaj için personele bildirim |
| DB tabanlı çözümleme testi | Integration test (Priority A/B/C/D DB sorguları) |
| Tam kapsamlı E2E testi | Webhook → çözümleme → gelen kutusu akışı |

---

## Etkilenen Dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `server/prisma/schema.prisma` | `WhatsAppInboxEntry` modeli eklendi |
| `server/prisma/migrations/20260521_whatsapp_inbox_entry/` | Yeni migrasyon (uygulandı) |
| `server/src/services/whatsapp/clinicResolver.ts` | **YENİ** — Klinik çözümleme |
| `server/src/routes/whatsappInbox.ts` | **YENİ** — Gelen kutusu endpoint'leri |
| `server/src/routes/whatsapp.ts` | Webhook geliştirildi (DB çözümleme eklendi) |
| `server/src/utils/roles.ts` | 3 yetki fonksiyonu eklendi |
| `server/src/index.ts` | `whatsappInboxRoutes` kayıt edildi |
| `server/src/tests/whatsappInbox.test.ts` | **YENİ** — 25 test |
| `server/package.json` | `test:inbox` scripti eklendi |
| `src/services/api.ts` | `whatsappInboxService` eklendi |
| `src/pages/WhatsAppInbox.tsx` | **YENİ** — Gelen kutusu sayfası |
| `src/App.tsx` | `/whatsapp-inbox` route eklendi |
| `src/layouts/MainLayout.tsx` | Nav öğesi eklendi |
| `src/utils/permissions.ts` | 3 yetki fonksiyonu eklendi |

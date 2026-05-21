# Sprint 13 — Operasyonel İzleme, Denetim Günlükleri ve Sistem Sağlığı

**Tarih:** 2026-05-21  
**Dal:** main  
**Durum:** Tamamlandı (backend testleri hariç)

---

## Amaç

Klinik operatörlerine sistem içi kritik eylemlerin denetlenebileceği, entegrasyon hatalarının takip edilebileceği ve sistem sağlığının anlık izlenebileceği merkezi bir panel sağlamak.

---

## Yapılan Değişiklikler

### 1. Veritabanı — Yeni Modeller

**Dosya:** `server/prisma/schema.prisma`

#### `AuditLog`
Organizasyon genelinde kritik eylemlerin değiştirilemez kaydı. Var olan `ActivityLog` (klinik bazlı, FK ağır) modelinden farklı olarak organizasyon kapsamlıdır ve uyumluluk odaklıdır.

| Alan | Tip | Açıklama |
|---|---|---|
| id | String (cuid) | PK |
| organizationId | String | Zorunlu (organizasyon kapsamı) |
| clinicId | String? | İsteğe bağlı klinik kapsamı |
| actorUserId | String? | Eylemi yapan kullanıcı |
| actorRole | String? | Eylem anındaki rol |
| action | String | snake_case eylem kodu (örn. `payment_created`) |
| entityType | String | Etkilenen varlık türü (örn. `payment`) |
| entityId | String? | Etkilenen varlık ID'si |
| description | String? | İnsan okunabilir açıklama |
| metadata | Json? | Ek bağlam (şifre/token içermez) |
| ipAddress | String? | İstek kaynak IP |
| userAgent | String? | Tarayıcı/istemci bilgisi |
| createdAt | DateTime | Kayıt zamanı |

#### `OperationalEvent`
Sistem entegrasyon hataları, webhook sorunları, WhatsApp gönderi başarısızlıkları gibi çözülebilir operasyonel olaylar.

| Alan | Tip | Açıklama |
|---|---|---|
| id | String (cuid) | PK |
| organizationId | String | Zorunlu |
| clinicId | String? | İsteğe bağlı |
| severity | String | `info` / `warning` / `error` / `critical` |
| source | String | `whatsapp` / `appointment` / `finance` / `auth` / `system` |
| message | String | Olay mesajı |
| metadata | Json? | Ek bağlam |
| resolvedAt | DateTime? | Çözüm zamanı (null = açık) |
| resolvedById | String? | Çözen kullanıcı |
| createdAt | DateTime | Kayıt zamanı |

**Migration:** `server/prisma/migrations/20260521_sprint13_operational_monitoring/migration.sql`

---

### 2. Backend Servisler

#### `server/src/utils/auditLog.ts`
- `writeAuditLog(input: AuditLogInput)` — fire-and-forget, hataları yutarak çalışır
- `extractRequestMeta(req)` — `ipAddress` ve `userAgent` ayıklar

#### `server/src/services/operationalEventService.ts`
- `recordOperationalEvent(input: OperationalEventInput)` — fire-and-forget
- `EventSeverity`, `EventSource` tipleri dışa açık

Her iki servis de: hata olsa bile ana işlemi asla durdurmaz. `console.error` ile sessizce loglar.

---

### 3. API Rotaları

**Dosya:** `server/src/routes/operationalMonitoring.ts`  
**Kayıt:** `server/src/index.ts` → `app.use('/api', operationalMonitoringRoutes)`

#### `GET /api/ops/audit-logs`
- Yetkili roller: OWNER, ORG_ADMIN, CLINIC_MANAGER (kendi kliniklerine kısıtlı)
- Filtreler: `clinicId`, `action`, `entityType`, `actorUserId`, `from`, `to`
- Sayfalama: `page` + `limit` (max 50)

#### `GET /api/ops/events`
- Yetkili roller: OWNER, ORG_ADMIN, CLINIC_MANAGER
- Filtreler: `clinicId`, `severity`, `source`, `status` (`unresolved`/`resolved`), `from`, `to`
- Sayfalama: `page` + `limit` (max 50)

#### `PATCH /api/ops/events/:id/resolve`
- Yetkili roller: OWNER, ORG_ADMIN, CLINIC_MANAGER
- `resolvedAt` ve `resolvedById` alanlarını günceller
- CLINIC_MANAGER yalnızca kendi klinik olaylarını çözebilir

#### `GET /api/ops/health`
- Herkese açık değil; authenticate + authorize(canViewOperations) gerektirir
- Yanıt yapısı (sır/token içermez):
```json
{
  "status": "ok|warning|error",
  "database": "ok|error",
  "whatsapp": { "connections": 3, "connected": 2, "error": 1 },
  "recentErrors": 0,
  "unresolvedEvents": 2,
  "failedSends24h": 0,
  "lastWebhookAt": "2026-05-21T10:00:00Z",
  "lastMessageSentAt": "2026-05-21T09:55:00Z"
}
```

---

### 4. Yetki Yardımcıları

#### `server/src/utils/roles.ts` (backend)
```ts
canViewOperations(user)          // OWNER | ORG_ADMIN | CLINIC_MANAGER
canResolveOperationalEvents(user) // OWNER | ORG_ADMIN | CLINIC_MANAGER
```

#### `src/utils/permissions.ts` (frontend — yalnızca UX kapısı)
```ts
canViewOperations(user)          // OWNER | ORG_ADMIN | CLINIC_MANAGER
canResolveOperationalEvents(user) // OWNER | ORG_ADMIN | CLINIC_MANAGER
```

---

### 5. Denetim Kaydı Entegrasyonu (Mevcut Rotalar)

Aşağıdaki rotalara `writeAuditLog` çağrısı eklendi:

| Dosya | Eylemler |
|---|---|
| `organizationBranches.ts` | `branch_created`, `branch_updated`, `branch_status_changed`, `user_clinic_assignment_changed` |
| `organizationWhatsApp.ts` | `whatsapp_connection_created`, `whatsapp_connection_updated`, `whatsapp_connection_tested`, `whatsapp_connection_disconnected` |
| `whatsappInbox.ts` | `whatsapp_inbox_resolved` |
| `payments.ts` | `payment_created`, `payment_updated`, `payment_cancelled` |
| `appointments.ts` | `appointment_created`, `appointment_updated`, `appointment_cancelled` |
| `gdprExport.ts` | `gdpr_export` |

`recordOperationalEvent` çağrısı eklenen rotalar:

| Dosya | Tetikleyici | Olay |
|---|---|---|
| `organizationWhatsApp.ts` | Test bağlantısı başarısız | `severity: 'warning'`, `source: 'whatsapp'` |
| `messages.ts` | WhatsApp mesajı gönderme başarısız | `severity: 'error'`, `source: 'whatsapp'` |

---

### 6. Frontend — `/operations` Sayfası

**Dosya:** `src/pages/Operations.tsx`

**Bölümler:**

1. **Sistem Sağlığı Kartları** — 8 kart: genel durum, veritabanı, WhatsApp bağlantıları, 24s hata sayısı, açık olaylar, başarısız gönderiler, son webhook, son mesaj
2. **Operasyonel Olaylar Tablosu** — severity/source/durum filtresi, sayfalama, yetkili kullanıcı için "Resolve" butonu
3. **Denetim Günlükleri Tablosu** — action/entityType/tarih aralığı filtresi, sayfalama

Erişim kontrolü: `canViewOperations(user)` false ise `/dashboard`'a yönlendirir.

**Rota kaydı:** `src/App.tsx` → `<Route path="operations" element={<Operations />} />`

**Navigasyon:** `src/layouts/MainLayout.tsx` → "Operasyon İzleme" linki (`Activity` ikonu), yalnızca `canViewOperations(user)` true iken görünür

---

### 7. API Servisi

**Dosya:** `src/services/api.ts`

```ts
export const operationalMonitoringService = {
  getHealth():                    GET /api/ops/health
  getAuditLogs(params?):          GET /api/ops/audit-logs
  getEvents(params?):             GET /api/ops/events
  resolveEvent(id):               PATCH /api/ops/events/:id/resolve
}
```

---

## Güvenlik Notları

- `/api/ops/health` yanıtı hiçbir token, şifre, API anahtarı içermez — yalnızca sayısal özetler
- CLINIC_MANAGER diğer organizasyonların ya da atanmadığı kliniklerin verilerini göremez
- Fire-and-forget pattern: denetim yazımı başarısız olsa bile hasta işlemi devam eder
- Metadata alanlarına token/şifre yazmak yasaktır (kod içi yorum + bu belge ile belirtildi)

---

## Bekleyen İş

- [ ] **Backend testleri** (`server/src/tests/operationalMonitoring.test.ts`) — rol bazlı erişim, çapraz-org izolasyon, WhatsApp hata olayı oluşturma, health endpoint güvenlik doğrulama

---

## TypeScript Doğrulama

```bash
# Frontend
cd /workspaces/DisKlinikCRM && npx tsc --noEmit   # ✅ 0 hata

# Backend
cd /workspaces/DisKlinikCRM/server && npx tsc --noEmit  # ✅ 0 hata
```

> Not: `Prisma.InputJsonValue` cast'i `metadata` alanlarında gereklidir — `Record<string, unknown>` Prisma JSON tipine doğrudan atanamaz.

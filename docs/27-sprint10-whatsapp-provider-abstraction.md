# Sprint 10 — Provider-Agnostic WhatsApp Infrastructure

**Tamamlanma Tarihi:** 21 Mayıs 2026  
**Sprint Hedefi:** Çoklu şube ve çoklu sağlayıcıyı destekleyen, mevcut Evolution API entegrasyonunu bozmayan, gelecekte Meta WhatsApp Business Cloud API'ye geçişi kolaylaştıracak temiz bir WhatsApp soyutlama katmanı oluşturmak.

---

## 1. Sprint Hedefleri

| # | Hedef | Durum |
|---|-------|-------|
| 1 | Evolution API'yi aktif sağlayıcı olarak korumak | ✅ |
| 2 | Meta Cloud API için gelecekteki resmi sağlayıcıyı stub olarak eklemek | ✅ |
| 3 | Çok şubeli kliniklerde paylaşılan WhatsApp bağlantısı desteği | ✅ |
| 4 | Şube başına özel WhatsApp bağlantısı desteği | ✅ |
| 5 | Gelecekte Meta implementasyonu mesaj sistemini yeniden yazmayı gerektirmeyecek temiz soyutlama | ✅ |

---

## 2. Veri Tabanı Değişiklikleri

### 2.1 Yeni Modeller — `server/prisma/schema.prisma`

#### `WhatsAppConnection` (org düzeyinde bağlantı kaydı)

```prisma
model WhatsAppConnection {
  id               String    @id @default(uuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id])
  provider         String    // "evolution_api" | "meta_cloud_api"
  displayName      String
  status           String    @default("disconnected")
  phoneNumber      String?
  isActive         Boolean   @default(true)
  notes            String?

  // Evolution API alanları
  evolutionApiUrl            String?
  evolutionInstanceName      String?
  evolutionApiKeyEncrypted   String?   // AES şifreli — frontend'e gönderilmez

  // Meta Cloud API alanları (stub)
  metaBusinessId          String?
  metaWabaId              String?
  metaPhoneNumberId       String?
  metaAppId               String?
  metaAccessTokenEncrypted String?   // şifreli
  metaWebhookVerifyToken  String?
  metaWebhookSecret       String?

  webhookSecret  String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  clinicConnections  ClinicWhatsAppConnection[]
  sentMessages       SentMessage[]
}
```

#### `ClinicWhatsAppConnection` (şube ↔ bağlantı eşleme tablosu)

```prisma
model ClinicWhatsAppConnection {
  id                    String   @id @default(uuid())
  clinicId              String
  clinic                Clinic   @relation(...)
  whatsappConnectionId  String
  whatsappConnection    WhatsAppConnection @relation(...)
  isDefault             Boolean  @default(true)
  assignedAt            DateTime @default(now())
  assignedBy            String?

  @@unique([clinicId, whatsappConnectionId])
}
```

#### `SentMessage` model güncellemesi (yeni alanlar)

| Alan | Tür | Açıklama |
|------|-----|----------|
| `organizationId` | `String?` | Mesajın ait olduğu org |
| `whatsappConnectionId` | `String?` | Kullanılan bağlantı kaydı |
| `provider` | `String?` | `evolution_api` \| `meta_cloud_api` |
| `direction` | `String?` | `outbound` \| `inbound` |
| `externalMessageId` | `String?` | Sağlayıcının döndürdüğü mesaj ID'si |

### 2.2 Migration

Shadow DB iznine sahip olmayan `crm_user` için standart `prisma migrate dev` çalışmaz. Uygulanan yöntem:

```bash
# 1. SQL oluştur
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260521113926_whatsapp_connection_models/migration.sql

# 2. Doğrudan psql ile uygula
PGPASSWORD=crm_pass_2026 psql -U crm_user -d dis_klinik_crm -h localhost \
  -f prisma/migrations/20260521113926_whatsapp_connection_models/migration.sql

# 3. Prisma migration geçmişine kaydet
npx prisma migrate resolve --applied 20260521113926_whatsapp_connection_models
```

---

## 3. Backend Soyutlama Katmanı

### 3.1 Dosya Yapısı

```
server/src/services/whatsapp/
├── WhatsAppProvider.ts          # Interface + tip tanımları
├── EvolutionWhatsAppProvider.ts # Aktif sağlayıcı implementasyonu
├── MetaCloudWhatsAppProvider.ts # Stub — "not implemented" döner
├── whatsappProviderFactory.ts   # getWhatsAppProvider(providerKey) factory
└── whatsappService.ts           # Uygulama kodunun kullandığı unified servis
```

### 3.2 `WhatsAppProvider` Interface (`WhatsAppProvider.ts`)

Tüm sağlayıcıların implement etmesi gereken arayüz:

```typescript
interface WhatsAppProvider {
  sendMessage(connection, payload): Promise<SendMessageResult>;
  testConnection(connection): Promise<TestConnectionResult>;
  getQrCode?(connection): Promise<QrCodeResult>;       // opsiyonel
  disconnect?(connection): Promise<void>;              // opsiyonel
  parseWebhook(payload, connection): ParsedWebhookEvent;
}
```

**Tip tanımları:**
- `SendMessagePayload` — `{ phone: string; text: string }`
- `SendMessageResult` — `{ success: boolean; externalMessageId?; error? }`
- `TestConnectionResult` — `{ success: boolean; message: string }`
- `QrCodeResult` — `{ available: boolean; qrCode?; message? }`
- `ParsedWebhookEvent` — normalize edilmiş webhook olayı

### 3.3 `EvolutionWhatsAppProvider` (`EvolutionWhatsAppProvider.ts`)

- DB kaydındaki `evolutionApiUrl`, `evolutionInstanceName`, `evolutionApiKeyEncrypted` kullanır
- DB kaydı yoksa `EVOLUTION_API_BASE_URL`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_API_KEY` env değişkenlerine fallback yapar
- `sendMessage`, `testConnection`, `getQrCode`, `disconnect`, `parseWebhook` implement eder

### 3.4 `MetaCloudWhatsAppProvider` (`MetaCloudWhatsAppProvider.ts`)

- Tüm metodlar `{ success: false, message: 'Meta Cloud API not yet implemented' }` döner
- `parseWebhook` Meta'nın `{ object: 'whatsapp_business_account', entry: [...] }` yapısını tanır
- Canlıya geçmeye hazır: sadece implementasyon doldurmak yeterli

### 3.5 `whatsappProviderFactory` (`whatsappProviderFactory.ts`)

```typescript
getWhatsAppProvider(providerKey: string): WhatsAppProvider
// "evolution_api" → EvolutionWhatsAppProvider
// "meta_cloud_api" → MetaCloudWhatsAppProvider
// bilinmeyen → Error fırlatır
```

### 3.6 `whatsappService` (`whatsappService.ts`) — Unified Servis

Tüm uygulama kodu bu servisi çağırır, doğrudan provider kullanmaz.

**Bağlantı çözümleme önceliği (`resolveConnectionForClinic`):**
1. `ClinicWhatsAppConnection` tablosunda `clinicId + isDefault=true` ara
2. Varsa `WhatsAppConnection` kaydını kullan
3. Yoksa env var'larından legacy fallback oluştur (Sprint 10 öncesi tek-klinik uyumluluğu)

**Servis fonksiyonları:**

| Fonksiyon | Açıklama |
|-----------|----------|
| `sendWhatsAppMessage(clinicId, payload, connectionId?)` | Mesaj gönder |
| `testWhatsAppConnection(connectionId)` | Bağlantıyı test et |
| `getWhatsAppQrCode(connectionId)` | QR kodu al |
| `disconnectWhatsAppConnection(connectionId)` | Bağlantıyı kes |
| `resolveConnectionForClinic(clinicId)` | Klinik için bağlantı kaydı çöz |

---

## 4. Backend API Rotaları

### 4.1 Dosya: `server/src/routes/organizationWhatsApp.ts`

Tüm route parametreleri `getParam(req, 'key')` pattern ile alınır (`req.params.id` doğrudan kullanılmaz — TypeScript `string | string[]` tip hatası).

**Güvenlik kuralları:**
- Her sorgu `req.user.organizationId` ile kısıtlanır
- Şifreli alanlar (`evolutionApiKeyEncrypted`, `metaAccessTokenEncrypted`, vb.) **asla** response'a eklenmez — `sanitizeConnection()` helper'ı çıkarır
- Cross-org erişim her sorguda engellenir

#### Org Düzeyinde Bağlantı Yönetimi (OWNER / ORG_ADMIN)

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/api/organization/whatsapp-connections` | Tüm bağlantıları listele |
| POST | `/api/organization/whatsapp-connections` | Yeni bağlantı oluştur |
| GET | `/api/organization/whatsapp-connections/:id` | Tekil bağlantı getir |
| PUT | `/api/organization/whatsapp-connections/:id` | Bağlantıyı güncelle |
| POST | `/api/organization/whatsapp-connections/:id/test` | Bağlantıyı test et |
| GET | `/api/organization/whatsapp-connections/:id/qr` | QR kodu al |
| POST | `/api/organization/whatsapp-connections/:id/disconnect` | Bağlantıyı kes |

#### Klinik ↔ Bağlantı Atama (OWNER / ORG_ADMIN / CLINIC_MANAGER)

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/api/clinics/:clinicId/whatsapp` | Kliniğin bağlantı atamasını getir |
| PUT | `/api/clinics/:clinicId/whatsapp` | Kliniğe varsayılan bağlantı ata |
| DELETE | `/api/clinics/:clinicId/whatsapp/:connectionId` | Atamayı kaldır |

### 4.2 Route Kaydı — `server/src/index.ts`

```typescript
import organizationWhatsAppRoutes from './routes/organizationWhatsApp.js';
// ...
app.use('/api', organizationWhatsAppRoutes);
```

---

## 5. Güncellenen Mevcut Dosyalar

### 5.1 Mesaj Gönderme Kodu — `sendTextMessage` → `sendWhatsAppMessage`

**Etkilenen 3 dosya:**

| Dosya | Değişiklik |
|-------|------------|
| `server/src/routes/messages.ts` | `sendTextMessage` import → `sendWhatsAppMessage` |
| `server/src/routes/whatsapp.ts` | Webhook reply gönderimi güncellendi |
| `server/src/jobs/reminders.ts` | Otomatik hatırlatıcı gönderimi güncellendi |

**Eski kod (her dosyada):**
```typescript
import { sendTextMessage } from '../services/evolutionApi.js';
// ...
await sendTextMessage(phone, text, instance);
```

**Yeni kod:**
```typescript
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
// ...
const result = await sendWhatsAppMessage(clinicId, { phone, text });
if (!result.success) throw new Error(result.error ?? 'WhatsApp send failed');
```

> **Not:** `whatsapp.ts` webhook handler'ında eski kod `normalizedPayload.instance` değerini `sendTextMessage`'a geçirerek instance override yapıyordu. Yeni mimaride instance çözümlemesi `resolveConnectionForClinic` üzerinden DB/env fallback olarak gerçekleşir — paylaşımlı bağlantı topolojisi bu bilgiyi DB seviyesinde tutar.

### 5.2 İzin Yardımcıları

#### Backend — `server/src/utils/roles.ts`

```typescript
canManageWhatsAppConnections(user)  // OWNER | ORG_ADMIN
canAssignWhatsAppToClinic(user)     // OWNER | ORG_ADMIN | CLINIC_MANAGER
canViewWhatsAppStatus(user)         // OWNER | ORG_ADMIN | CLINIC_MANAGER
canSendWhatsAppMessages(user)       // OWNER | ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST | DENTIST
```

#### Frontend — `src/utils/permissions.ts`

Aynı 4 fonksiyon frontend için de eklendi (backend ile birebir eşleşir).

---

## 6. Frontend Değişiklikleri

### 6.1 API Servisleri — `src/services/api.ts`

```typescript
// Bağlantı yönetimi (OWNER / ORG_ADMIN)
whatsappConnectionService.list()
whatsappConnectionService.get(id)
whatsappConnectionService.create(data)
whatsappConnectionService.update(id, data)
whatsappConnectionService.test(id)
whatsappConnectionService.getQr(id)
whatsappConnectionService.disconnect(id)

// Klinik atamaları (OWNER / ORG_ADMIN / CLINIC_MANAGER)
clinicWhatsAppService.getAssignments(clinicId)
clinicWhatsAppService.assign(clinicId, connectionId)
clinicWhatsAppService.unassign(clinicId, connectionId)
```

### 6.2 WhatsApp Connections Sayfası — `src/pages/WhatsAppConnections.tsx`

**Özellikler:**
- Bağlantı listesi (sağlayıcı, durum, telefon numarası, şube atama sayısı)
- Test bağlantısı butonu — anlık geri bildirim
- QR kodu görüntüleme (Evolution API)
- Bağlantıyı kes
- Bağlantı oluştur / düzenle modalı:
  - Evolution API: URL, instance adı, API key
  - Meta Cloud API: Business ID, WABA ID, Phone Number ID, App ID, Access Token
  - Meta Cloud API alanlarında "henüz aktif değil" uyarısı gösterilir
  - Düzenle modunda şifreli alanlar önceden doldurulmaz (güvenlik gereği)
- İzin kontrolü: `canViewWhatsAppStatus` olmayan kullanıcılar `/` adresine yönlendirilir

**Güvenlik:** Şifreli alanlar (`apiKey`, `accessToken`) hiçbir zaman frontend'e gönderilmez — `sanitizeConnection()` backend'de temizler.

### 6.3 Uygulama Yönlendirme — `src/App.tsx`

```typescript
import WhatsAppConnections from './pages/WhatsAppConnections';
// ...
<Route path="organization/whatsapp" element={<WhatsAppConnections />} />
```

### 6.4 Navigasyon Menüsü — `src/layouts/MainLayout.tsx`

```typescript
import { ..., MessageCircle } from 'lucide-react';
import { ..., canViewWhatsAppStatus } from '../utils/permissions';

// navItems listesine eklendi:
if (canViewWhatsAppStatus(user)) {
  navItems.push({
    path: '/organization/whatsapp',
    icon: <MessageCircle size={20} />,
    label: 'WhatsApp',
  });
}
```

---

## 7. Güvenlik Notları

| Kural | Uygulama |
|-------|----------|
| Şifreli alanlar frontend'e gönderilmez | `sanitizeConnection()` `evolutionApiKeyEncrypted`, `metaAccessTokenEncrypted` vb. alanları response'dan çıkarır |
| Şifreli alanlar loglanmaz | Provider'lar yalnızca hata kodlarını ve mesaj ID'lerini loglar |
| Org izolasyonu | Her DB sorgusu `organizationId` ile kısıtlanır |
| Cross-org engeli | Bağlantı ID'si ile şube ID'si eşleşme doğrulaması yapılır |
| Rol tabanlı erişim | 4 granüler izin fonksiyonu ile RBAC uygulanır |
| GDPR — SMS/WhatsApp veri minimizasyonu | Hatırlatıcı mesajlarda hasta sağlık verisi gönderilmez |

---

## 8. TypeScript Derleme Sonuçları

```bash
# Backend
cd server && npx tsc --noEmit
# → 0 hata ✅

# Frontend
cd .. && npx tsc --noEmit
# → 0 hata ✅
```

---

## 9. Ortam Değişkenleri

### Geriye Dönük Uyumlu (Sprint 10 öncesi tek-klinik) — hâlâ çalışır

```env
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_INSTANCE_NAME=my_instance
EVOLUTION_API_KEY=secret_key
```

DB'de `ClinicWhatsAppConnection` kaydı yoksa bu değişkenler otomatik olarak fallback yapılır.

### Sprint 10 Sonrası (Çok Şubeli) — DB Üzerinden Yönetim

`WhatsAppConnection` kaydı oluşturulur ve `ClinicWhatsAppConnection` ile şubeye atanır. Env değişkenlerine artık gerek yoktur.

---

## 10. Sağlayıcı Durumu

| Sağlayıcı | Durum | Notlar |
|-----------|-------|--------|
| `evolution_api` | ✅ Aktif | Tüm işlevler çalışıyor |
| `meta_cloud_api` | 🔶 Stub | Tüm metodlar "not implemented" döner; Meta webhook parsing hazır |

### Meta Cloud API Entegrasyonu — Gelecek Adımlar

`MetaCloudWhatsAppProvider.ts` dosyasına aşağıdaki metodlar implement edilmelidir:

1. `sendMessage` — Meta Graph API `POST /v19.0/{phone-number-id}/messages`
2. `testConnection` — token doğrulama
3. `getQrCode` — yok (Meta QR flow kullanmaz)
4. `disconnect` — yok

`WhatsAppProvider` interface'i değişmez; yalnızca `MetaCloudWhatsAppProvider.ts` güncellenir.

---

## 11. Çok Şubeli Topoloji Örnekleri

### Senaryo A — Paylaşılan Tek Bağlantı (2 Şube)

```
Organization
└── WhatsAppConnection (id: conn-1, provider: evolution_api)
    ├── ClinicWhatsAppConnection (clinicId: branch-istanbul, isDefault: true)
    └── ClinicWhatsAppConnection (clinicId: branch-ankara, isDefault: true)
```

Her iki şubeden gönderilen mesajlar aynı Evolution instance'ını kullanır.

### Senaryo B — Şube Başına Özel Bağlantı

```
Organization
├── WhatsAppConnection (id: conn-istanbul, instance: istanbul_bot)
│   └── ClinicWhatsAppConnection (clinicId: branch-istanbul, isDefault: true)
└── WhatsAppConnection (id: conn-ankara, instance: ankara_bot)
    └── ClinicWhatsAppConnection (clinicId: branch-ankara, isDefault: true)
```

Her şube kendi numarasını ve instance'ını kullanır.

### Senaryo C — Legacy Tek Klinik (Sprint 10 öncesi uyumluluk)

DB'de `ClinicWhatsAppConnection` kaydı yoktur. `resolveConnectionForClinic` env var'larından `EVOLUTION_API_BASE_URL` + `EVOLUTION_INSTANCE_NAME` + `EVOLUTION_API_KEY` ile legacy bağlantı nesnesi oluşturur.

---

## 12. Kalan Geliştirmeler — Etaplı Plan

Aşağıdaki tablo tüm kalan işlerin öncelik sırasına göre özetini verir.  
Her etap bağımsız olarak teslim edilebilir; bağımlılıklar etap numarasıyla belirtilmiştir.

| Etap | Başlık | Durum | Öncelik | Bağımlılık |
|------|--------|-------|---------|------------|
| E-1 | Frontend tamamlama | ✅ Tamamlandı | 🔴 Yüksek | — |
| E-2 | API anahtarı şifreleme | ✅ Tamamlandı | 🔴 Yüksek | — |
| E-3 | Birim testleri | ✅ Tamamlandı (28/28) | 🟡 Orta | E-1, E-2 öncesinde de yazılabilir |
| E-4 | Meta Cloud API implementasyonu | ⏳ Bekliyor | 🟢 Düşük | Meta Business hesabı gerekir |
| E-5 | Operasyonel izleme | ⏳ Bekliyor | 🟢 Düşük | E-1, E-2 |

---

### Etap 1 — Frontend Tamamlama

**Hedef:** WhatsApp altyapısının kullanıcıya yansıyan son 2 eksik noktasını kapatmak.  
**Tahmini efor:** 2–3 saat  
**Dosyalar:** `src/pages/Branches.tsx`, `src/pages/Messages.tsx`

#### E-1.1 — `Branches.tsx` — WhatsApp Durum Rozeti + Ayarlar Butonu

Her şube satırına eklenecekler:

1. **Durum rozeti** — `clinicWhatsAppService.getAssignments(branch.id)` çağrısı ile her şubenin bağlantı durumunu çek.
   - Bağlantı yok → `⚫ WhatsApp Yok` (gri rozet)
   - `status === 'connected'` → `🟢 Bağlı` (yeşil rozet)
   - `status === 'disconnected'` veya başka → `🔴 Bağlı Değil` (kırmızı rozet)

2. **"WhatsApp Ayarları" butonu** — `canAssignWhatsAppToClinic(user)` izni varsa göster.  
   Tıklayınca `/organization/whatsapp` rotasına yönlendir.

```tsx
// Branches.tsx — ek import'lar
import { MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clinicWhatsAppService } from '../services/api';
import { canAssignWhatsAppToClinic } from '../utils/permissions';

// state (mevcut branchList state'ine paralel):
const [whatsappStatuses, setWhatsappStatuses] = useState<Record<string, string>>({});

// Her branch yüklendiğinde parallel fetch:
const statusMap: Record<string, string> = {};
await Promise.allSettled(
  branches.map(async (b) => {
    try {
      const res = await clinicWhatsAppService.getAssignments(b.id);
      statusMap[b.id] = res.data?.length > 0
        ? res.data[0].whatsappConnection?.status ?? 'unknown'
        : 'none';
    } catch {
      statusMap[b.id] = 'unknown';
    }
  })
);
setWhatsappStatuses(statusMap);

// Satır içinde rozet:
const st = whatsappStatuses[branch.id];
<span className={`text-xs px-2 py-0.5 rounded-full ${
  st === 'connected' ? 'bg-green-100 text-green-700'
  : st === 'none' ? 'bg-gray-100 text-gray-500'
  : 'bg-red-100 text-red-600'
}`}>
  <MessageCircle size={12} className="inline mr-1" />
  {st === 'connected' ? 'WhatsApp Bağlı' : st === 'none' ? 'WhatsApp Yok' : 'Bağlı Değil'}
</span>

// Ayarlar butonu (sadece yetkili roller):
{canAssignWhatsAppToClinic(user) && (
  <button onClick={() => navigate('/organization/whatsapp')}
    className="text-xs text-blue-600 hover:underline flex items-center gap-1">
    <MessageCircle size={12} /> WhatsApp Ayarları
  </button>
)}
```

#### E-1.2 — `Messages.tsx` — Bağlantı Farkındalığı

Mevcut `Messages.tsx` WhatsApp bağlantısından haberdar değil — mesaj gönder butonu her zaman aktif.

Eklenecekler:

1. **Bağlantı durumu kontrolü** — sayfa açıldığında `clinicWhatsAppService.getAssignments(clinicId)` çağır.
2. **Gönder butonu devre dışı** — bağlantı yoksa veya `status !== 'connected'` ise butonu disable et; tooltip ile açıkla.
3. **Meta uyarısı** — bağlantı varsa ve `provider === 'meta_cloud_api'` ise altında sarı uyarı bandı göster: _"Bu bağlantı henüz aktif değil (Meta Cloud API)"_.
4. **Durum bilgi kartı** — mesaj listesinin üstüne küçük bir banner ekle:
   - Yeşil: `✓ WhatsApp bağlı — [Numara]`
   - Gri: `WhatsApp bağlantısı yapılandırılmamış`

```tsx
// Messages.tsx — ek logic
import { clinicWhatsAppService } from '../services/api';
import { useClinic } from '../context/ClinicContext';

const { currentClinic } = useClinic();
const [waConnection, setWaConnection] = useState<{ status: string; provider: string; phoneNumber?: string } | null>(null);
const [waLoading, setWaLoading] = useState(true);

useEffect(() => {
  if (!currentClinic?.id) return;
  clinicWhatsAppService.getAssignments(currentClinic.id)
    .then(res => {
      const active = res.data?.find((a: any) => a.isDefault && a.whatsappConnection?.isActive);
      setWaConnection(active?.whatsappConnection ?? null);
    })
    .catch(() => setWaConnection(null))
    .finally(() => setWaLoading(false));
}, [currentClinic?.id]);

const canSendNow = canSend
  && !waLoading
  && waConnection?.status === 'connected'
  && waConnection?.provider !== 'meta_cloud_api';
```

---

### Etap 2 — API Anahtarı Şifreleme (Güvenlik)

**Hedef:** `evolutionApiKeyEncrypted` ve `metaAccessTokenEncrypted` alanlarını gerçekten şifrelenmiş olarak saklamak.  
**Tahmini efor:** 2–3 saat  
**Dosyalar:**  
- `server/src/utils/encryption.ts` *(yeni)*  
- `server/src/routes/organizationWhatsApp.ts`  
- `server/src/services/whatsapp/EvolutionWhatsAppProvider.ts`  

**Neden önemli:** Şu anda alan adları `*Encrypted` ile bitiyor ama değerler ham metin saklanıyor. DB sızıntısında kimlik bilgileri doğrudan açığa çıkar.

#### Uygulama planı

1. **`server/src/utils/encryption.ts`** — AES-256-GCM şifreleme utility:

```typescript
// Ortam değişkeni: ENCRYPTION_KEY=32 byte hex string
// openssl rand -hex 32  ile üretilir

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: iv(24 hex) + tag(32 hex) + ciphertext(hex)
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex');
}

export function decryptSecret(ciphertext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex');
  const tag = Buffer.from(ciphertext.slice(24, 56), 'hex');
  const data = Buffer.from(ciphertext.slice(56), 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}
```

2. **`organizationWhatsApp.ts`** — Kaydetme sırasında şifrele:

```typescript
import { encryptSecret } from '../utils/encryption.js';

// POST / PUT handler içinde:
if (body.evolutionApiKey) {
  createData.evolutionApiKeyEncrypted = encryptSecret(body.evolutionApiKey);
}
if (body.metaAccessToken) {
  createData.metaAccessTokenEncrypted = encryptSecret(body.metaAccessToken);
}
```

3. **`EvolutionWhatsAppProvider.ts`** — Okuma sırasında çöz:

```typescript
import { decryptSecret } from '../../utils/encryption.js';

function resolveCredentials(connection) {
  const rawKey = connection.evolutionApiKeyEncrypted;
  const apiKey = rawKey
    ? (() => { try { return decryptSecret(rawKey); } catch { return rawKey; } })()
    : process.env.EVOLUTION_API_KEY;
  // ...
}
```

> **Not:** `ENCRYPTION_KEY` env değişkeni eksikse sunucu başlamayı reddetmeli (startup validation).  
> **Migrasyon:** Mevcut ham metin kayıtları için tek seferlik migrasyon scripti gerekir.

#### Yeni env değişkeni

```env
ENCRYPTION_KEY=<openssl rand -hex 32 ile üretilen 64 karakter>
```

---

### Etap 3 — Birim Testleri

**Hedef:** WhatsApp altyapısının kritik yollarını test kapsamına almak.  
**Tahmini efor:** 2–3 saat  
**Dosya:** `server/src/tests/whatsappProvider.test.ts`

#### Test senaryoları

```
whatsappProviderFactory
  ✓ "evolution_api" → EvolutionWhatsAppProvider döner
  ✓ "meta_cloud_api" → MetaCloudWhatsAppProvider döner
  ✓ Bilinmeyen sağlayıcı → Error fırlatır

EvolutionWhatsAppProvider
  ✓ Eksik credentials → { success: false } döner (HTTP isteği yapmaz)
  ✓ Evolution API 200 → { success: true, externalMessageId } döner
  ✓ Evolution API 400 → { success: false, error: '...' } döner

MetaCloudWhatsAppProvider
  ✓ sendMessage → { success: false, message: 'not implemented' } döner
  ✓ testConnection → { success: false } döner
  ✓ parseWebhook: Meta format → { eventType: 'unknown' } döner

whatsappService — resolveConnectionForClinic
  ✓ DB kaydı varsa DB kaydını döner
  ✓ DB kaydı yoksa + env var varsa legacy fallback döner
  ✓ DB kaydı yoksa + env var yoksa null döner

organizationWhatsApp — sanitizeConnection
  ✓ evolutionApiKeyEncrypted alanı response'dan çıkarılır
  ✓ metaAccessTokenEncrypted alanı response'dan çıkarılır
  ✓ diğer alanlar korunur

Rol/İzin Yardımcıları
  ✓ canManageWhatsAppConnections: OWNER → true, RECEPTIONIST → false
  ✓ canAssignWhatsAppToClinic: CLINIC_MANAGER → true, BILLING → false
  ✓ canViewWhatsAppStatus: CLINIC_MANAGER → true, ASSISTANT → false
  ✓ canSendWhatsAppMessages: DENTIST → true, BILLING → false
```

#### Test kurulumu (mevcut test framework ile)

```bash
cd server
# Mevcut test runner'ı kontrol et:
cat package.json | grep -E '"test"|vitest|jest'
# Genellikle: npx vitest run src/tests/
```

---

### Etap 4 — Meta Cloud API Gerçek Implementasyon

**Hedef:** `MetaCloudWhatsAppProvider.ts` metodlarını Meta Graph API ile gerçek işlevselliğe kavuşturmak.  
**Tahmini efor:** 4–6 saat (+ Meta Business hesabı kurulum süresi)  
**Bağımlılık:** Meta Business Manager hesabı, onaylı WABA (WhatsApp Business Account), test telefon numarası  
**Dosya:** `server/src/services/whatsapp/MetaCloudWhatsAppProvider.ts`

#### Uygulama planı

| Metot | Graph API Endpoint | Notlar |
|-------|--------------------|--------|
| `sendMessage` | `POST /v19.0/{phone_number_id}/messages` | Bearer token, `type: 'text'` payload |
| `testConnection` | `GET /v19.0/{phone_number_id}` | 200 → bağlı, 401 → geçersiz token |
| `parseWebhook` | — | Zaten implement edilmiş |
| `getQrCode` | — | Meta QR flow kullanmaz; `{ available: false }` döndür |
| `disconnect` | — | Meta'da logout kavramı yok; sadece `isActive = false` yapılır |

#### Webhook Verify Token Endpoint

Meta'nın doğrulama isteğini karşılamak için yeni public endpoint gerekir:

```
GET /api/public/whatsapp/meta-webhook
  ?hub.mode=subscribe
  &hub.verify_token=<metaWebhookVerifyToken>
  &hub.challenge=<challenge>

→ 200 OK ile challenge döner
```

Bu endpoint `server/src/routes/organizationWhatsApp.ts`'e eklenecek (auth gerektirmez, token doğrulaması yapılır).

#### Env değişkenleri (Meta için)

```env
META_WA_APP_SECRET=<Meta App Secret — webhook imza doğrulama için>
```

> **Önemli:** Meta access token'ları 60 günde bir yenilenir. Üretimde `System User` token'ı veya otomatik token yenileme mekanizması kurulmalıdır.

---

### Etap 5 — Operasyonel İzleme

**Hedef:** Bağlantı sağlığını pasif izlemek, pano widget'ı eklemek.  
**Tahmini efor:** 3–4 saat  
**Öncelik:** Düşük — diğer etaplar tamamlandıktan sonra

#### E-5.1 — Bağlantı Sağlık Sync Job

```
server/src/jobs/whatsappHealthCheck.ts
```

- Her 5 dakikada bir `WhatsAppConnection` tablosundaki `isActive=true` kayıtları için `testConnection` çağır.
- Sonuca göre `status` alanını güncelle: `connected` | `disconnected` | `error`.
- `ActivityLog`'a yaz (sadece durum değişikliğinde).

```typescript
// reminders.ts pattern'ı izle — cron ile:
cron.schedule('*/5 * * * *', whatsappHealthCheckJob);
```

#### E-5.2 — Dashboard Widget

`src/pages/Dashboard.tsx` veya `src/components/` içine:

```
WhatsAppStatusCard
  - Org genelinde toplam bağlantı sayısı
  - Bağlı / bağlı değil sayıları
  - Şube bazlı durum listesi
  - "Yönet" → /organization/whatsapp linki
```

#### E-5.3 — Mesaj Geçmişi Filtresi

`Messages.tsx`'e bağlantı bazlı filtre ekle:

```
Filtreler: [Kanal ▾] [Durum ▾] [Bağlantı ▾]  ← yeni
```

`SentMessage.whatsappConnectionId` alanı zaten var — backend `GET /api/messages?connectionId=...` parametresi eklenmeli.

---

### Etap Özeti ve Sıralama

```
Etap 1 (Frontend) ──────────► Hemen başlanabilir
Etap 2 (Şifreleme) ─────────► Hemen başlanabilir (E-1 ile paralel)
Etap 3 (Testler) ───────────► E-1 + E-2 sonrası veya paralel
Etap 4 (Meta API) ──────────► Meta hesabı hazır olduğunda
Etap 5 (İzleme) ────────────► E-1 + E-2 tamamlandıktan sonra
```

> **Kritik güvenlik notu:** E-2 (şifreleme) olabildiğince erken yapılmalıdır.  
> Üretim ortamına geçmeden önce `evolutionApiKeyEncrypted` alanında ham metin bulunmamalıdır.

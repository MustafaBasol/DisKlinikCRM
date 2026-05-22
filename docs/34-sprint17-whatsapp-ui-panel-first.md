# 34 — Sprint 17: WhatsApp Bağlantı Yönetimi UI + Panel-First Prodüksiyon Modu

**Tarih:** 22 Mayıs 2026  
**Durum:** Tamamlandı  
**Kapsam:** Sprint 17A (UI/UX) + Sprint 17B (Panel-first prodüksiyon hazırlığı)

---

## Sprint 17A — Bağlantı Yönetim Sayfası UX Temizliği

### Hedef

`/organization/whatsapp` sayfasını klinik sahiplerinin anlayabileceği ve tam yönetebileceği hale getirmek.

### Değişiklikler

#### `src/pages/WhatsAppConnections.tsx`

**Legacy bağlantı kartı:**
- "Veritabanına Aktar" butonu → **"Panel Yönetimine Aktar"** olarak yeniden adlandırıldı
- Açıklama notu eklendi: *"sunucu ortam değişkenlerinden çalışıyor"*
- Uyarı notu eklendi: *"Ortam değişkenlerinden gelen bağlantı panelden doğrudan silinemez"*

**Normal bağlantı kartı — eylem butonları yeniden düzenlendi:**

| Sıra | Buton | İkon | Açıklama |
|------|-------|------|----------|
| 1 | Test Et | `Wifi` | Bağlantıyı test eder |
| 2 | QR Kod | `QrCode` | Sadece Evolution API için görünür |
| 3 | Düzenle | `Pencil` | Bağlantı bilgilerini düzenler |
| 4 | Bağlantıyı Kes | `Unplug` | Disconnect işlemi (önceden `Trash2` kullanılıyordu — düzeltildi) |
| 5 | Devre Dışı Bırak / Aktifleştir | `PowerOff` / `Power` | `isActive` toggle |
| 6 | Sil | `Trash2` | Fiziksel silme (onay modalı ile) |

**Durum rozeti güncellendi:**
- `isActive=false` artık gri "inactive" yerine amber **"Devre Dışı"** rozeti + `PowerOff` ikonu gösteriyor
- `isActive=false` kartında bilgi notu: *"Bağlantı devre dışı — bu hattan mesaj gönderilemez"*
- Meta Cloud API kartında not: *"Meta Cloud API QR kullanmaz"*

**Silme onay modalı eklendi:**
- `Trash2` butonuna tıklayınca önce onay modalı açılır
- Modal içeriği: bağlantı adı, kalıcı silme uyarısı
- `HAS_MESSAGE_HISTORY` (409) hatası alınırsa: *"Devre Dışı Bırak kullanın"* önerisi gösterilir

**Yeni state:**
```typescript
togglingId: string | null
deletingId: string | null
confirmDeleteConn: WhatsAppConnectionItem | null
```

**Yeni handler'lar:**
```typescript
handleToggleActive(conn)   // PATCH /:id/status
handleConfirmDelete()      // DELETE /:id (onay sonrası)
```

---

#### `src/services/api.ts`

`whatsappConnectionService`'e iki metod eklendi:

```typescript
setStatus: (id: string, data: { isActive: boolean; status?: string }) =>
  api.patch(`/organization/whatsapp-connections/${id}/status`, data),

deleteConnection: (id: string) =>
  api.delete(`/organization/whatsapp-connections/${id}`),
```

---

#### `server/src/routes/organizationWhatsApp.ts`

**Yeni uç nokta: `PATCH /api/organization/whatsapp-connections/:id/status`**

Yetki: `OWNER`, `ORG_ADMIN`

- `isActive=false` → `status: 'disconnected'` olarak günceller
- `isActive=true` → `status` payload'dan geliyorsa günceller, yoksa mevcut statüyü korur
- Sanitize: yanıtta şifrelenmiş alanlar (key, token) yer almaz

**Yeni uç nokta: `DELETE /api/organization/whatsapp-connections/:id`**

Yetki: `OWNER`, `ORG_ADMIN`

- `sentMessages` sayısı > 0 ise **409** döner:
  ```json
  { "error": "...", "code": "HAS_MESSAGE_HISTORY", "messageCount": 3 }
  ```
  (Yanıtta şifrelenmiş alan bulunmaz — güvenlik kontrolü)
- 0 mesaj varsa: önce `ClinicWhatsAppConnection` atamaları silinir, sonra bağlantı silinir
- `isLegacy: true` olan sanal girdi ID'leri reddedilir (`__legacy__`)
- Activity log + audit log yazılır

---

## Sprint 17B — Panel-First Prodüksiyon Modu (`ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK`)

### Hedef

Prodüksiyonda env var tabanlı WhatsApp konfigürasyonunu devre dışı bırakabilmek. Panel üzerinden içe aktarılan DB-backed bağlantıyı tek kaynak yapmak.

### Sorun

Sprint 17A öncesinde iki katmanlı fallback mevcuttu:

1. `resolveConnectionForClinic()` — DB'de bağlantı yoksa env var'lardan geçici bir kayıt üretiyordu
2. `EvolutionWhatsAppProvider.resolveCredentials()` — DB kaydındaki alanlar boşsa env var'lardan tamamlıyordu

Bu durum prodüksiyonda env var'ların kaldırılmasını güçleştiriyordu ve sistemi hangi kaynaktan mesaj gönderdiği konusunda belirsiz bırakıyordu.

### Çözüm: `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` Bayrağı

#### Yeni dosya: `server/src/utils/legacyWhatsApp.ts`

```typescript
// Bayrak semantiği:
// ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=true   → env fallback aktif (default)
// ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false  → panel-first; DB kaydı zorunlu
// ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=       → true ile aynı (güvenli default)

export function isLegacyFallbackEnabled(): boolean
export function getLegacyEvolutionConfig(): LegacyEvolutionConfig | null
export function hasLegacyEnvVars(): boolean
```

- `isLegacyFallbackEnabled()` — bayrağı okur; `false` veya `0` dışında her değer `true` döndürür
- `getLegacyEvolutionConfig()` — bayrak `false` ise `null` döndürür; değilse `{ url, key, instanceName }` döndürür (**key hiçbir zaman loglanmaz**)
- `hasLegacyEnvVars()` — bayraktan bağımsız olarak üç env var'ın varlığını kontrol eder (UI virtual card için)

---

#### `server/src/services/whatsapp/whatsappService.ts`

`resolveConnectionForClinic()` güncellendi:

```typescript
// Eski kod:
const hasLegacyConfig = process.env.EVOLUTION_API_BASE_URL && process.env.EVOLUTION_API_KEY;
return hasLegacyConfig ? buildLegacyConnectionRecord() : null;

// Yeni kod:
const legacyCfg = getLegacyEvolutionConfig(); // null when flag=false
if (!legacyCfg) return null;
return buildLegacyConnectionRecord();
```

`buildLegacyConnectionRecord()` de artık `getLegacyEvolutionConfig()` üzerinden değer alıyor; env var'lara doğrudan erişmiyor.

---

#### `server/src/services/whatsapp/EvolutionWhatsAppProvider.ts`

`resolveCredentials()` güncellendi. Her alan için ayrı ayrı yapılan `process.env.*` fallback'leri kaldırıldı, yerine `getLegacyEvolutionConfig()` kullanılıyor:

```typescript
const legacy = getLegacyEvolutionConfig(); // null when fallback disabled

const baseUrl = dbBaseUrl || legacy?.url;
const instanceName = dbInstanceName || legacy?.instanceName;
// ...
apiKey = legacy?.key; // sadece DB key yoksa ve fallback aktifse
```

Bayrak `false` olduğunda `legacy === null` olur; DB alanları boşsa `resolveCredentials()` `null` döndürür ve mesaj gönderimi başarısız olur.

---

#### `server/src/routes/organizationWhatsApp.ts`

GET /list sanal legacy kartı koşuluna bayrak kontrolü eklendi:

```typescript
// Eski:
if (sanitized.length === 0) { ... }

// Yeni:
if (sanitized.length === 0 && isLegacyFallbackEnabled() && hasLegacyEnvVars()) { ... }
```

Bayrak `false` olduğunda liste boş görünür (veya yalnızca DB kayıtları gösterilir).

---

#### `server/.env.example`

```bash
# Panel-first WhatsApp mode.
# Set to "false" in production once all connections have been imported via the panel
# (Organization → WhatsApp → Panel Yönetimine Aktar) and verified.
# Default: "true" — safe for existing deployments that use env-var Evolution API config.
ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=true
```

---

## Prodüksiyon Geçiş Adımları

1. **Panel → Organization → WhatsApp → "Panel Yönetimine Aktar"** butonuna tıkla
   - Env var konfigürasyonu DB'ye AES-256-GCM şifreli olarak aktarılır
   - Organizasyondaki tüm klinikler otomatik atanır

2. Bağlantıyı doğrula:
   - Bağlantı kartındaki **"Test Et"** butonuna tıkla
   - Randevu veya Mesajlaşma modülünden test mesajı gönder

3. Bayrağı kapat:
   ```bash
   # server/.env
   ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false
   ```
   Backend'i yeniden başlat.

4. Mesajların DB bağlantısı üzerinden gittiğini doğrula (log'da fallback uyarısı olmamalı).

5. (Opsiyonel) Env var'ları temizle:
   ```bash
   # Kaldırılabilir:
   EVOLUTION_API_BASE_URL=
   EVOLUTION_API_KEY=
   EVOLUTION_INSTANCE_NAME=
   ```
   Backend'i yeniden başlat. Sanal legacy kart artık görünmez.

---

## Etkilenen Dosyalar

| Dosya | Sprint | Değişiklik |
|---|---|---|
| `server/src/utils/legacyWhatsApp.ts` | 17B | Yeni dosya — bayrak yöneticisi |
| `server/src/services/whatsapp/whatsappService.ts` | 17B | `getLegacyEvolutionConfig()` kullanımı |
| `server/src/services/whatsapp/EvolutionWhatsAppProvider.ts` | 17B | Per-field env fallback → `getLegacyEvolutionConfig()` |
| `server/src/routes/organizationWhatsApp.ts` | 17A + 17B | PATCH /status, DELETE, GET legacy bayrak kontrolü |
| `src/pages/WhatsAppConnections.tsx` | 17A | Buton düzeni, silme modalı, Devre Dışı rozeti |
| `src/services/api.ts` | 17A | `setStatus()`, `deleteConnection()` eklendi |
| `server/.env.example` | 17B | `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` eklendi |

---

## Test Kapsamı

`server/src/tests/whatsappProvider.test.ts` — toplam **122 test, 0 başarısız**

**Sprint 17A yeni testler (18 adet):**
- `setStatus` mantığı (isActive toggle, durum koruması)
- Devre dışı bağlantı gönderim guard'ı
- Silme guard (messageCount > 0 → 409)
- Klinik atamaları önce silme, sonra bağlantı silme sırası
- 409 yanıtında şifrelenmiş alan bulunmadığı
- Yetkisiz roller (CLINIC_MANAGER, DENTIST, BILLING) toggle/delete yapamaz
- OWNER/ORG_ADMIN toggle ve delete yapabilir
- Legacy kartın silinemeyeceği kontrolü

**Sprint 17B yeni testler (17 adet):**
- `isLegacyFallbackEnabled()` varsayılan değer (true)
- Bayrak `true`, `false`, `0`, `FALSE` değerleri
- `getLegacyEvolutionConfig()` — flag=true + env var'lar tam → config döner
- `getLegacyEvolutionConfig()` — flag=false + env var'lar tam → null döner
- `getLegacyEvolutionConfig()` — flag=true + env var'lar eksik → null döner
- `resolveConnectionForClinic` simülasyonu: flag=false → fallback yok
- `resolveConnectionForClinic` simülasyonu: DB kaydı varsa bayrak önemsiz
- `resolveCredentials` simülasyonu: flag=false + DB alanları boş → null
- `resolveCredentials` simülasyonu: flag=false + DB alanları dolu → DB değerleri kullanılır
- `resolveCredentials` simülasyonu: flag=true + DB alanları boş → env fallback kullanılır
- Fallback devre dışıyken hata yanıtında şifrelenmiş alan bulunmadığı

---

## Güvenlik Notları

- `EVOLUTION_API_KEY` hiçbir zaman loglara yazılmaz; `getLegacyEvolutionConfig()` key'i döndürür ama çağıranlar onu loglamaz
- Silme uç noktası 409 dönerken `evolutionApiKeyEncrypted`, `metaAccessTokenEncrypted`, `webhookSecret` alanlarını içermez
- `ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false` ile env fallback tamamen kapatılır — DB kaydı olmayan klinikler için mesaj gönderilemez (güvenli hata)
- Import sonrası key AES-256-GCM şifreli olarak DB'de saklanır; env var kaldırılabilir

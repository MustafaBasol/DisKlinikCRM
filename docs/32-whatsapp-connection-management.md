# 32 — WhatsApp Bağlantı Yönetimi

**Tarih:** 22 Mayıs 2026  
**Durum:** Tamamlandı  
**Sprint:** Sprint 14

---

## Sorun

`/organization/whatsapp` sayfası **"Henüz WhatsApp bağlantısı eklenmemiş"** boş durumunu gösteriyordu. Oysa sistem zaten `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` ortam değişkenlerinden gelen aktif bir Evolution API bağlantısıyla çalışmaktaydı. Bağlantı yalnızca env var'larda tanımlıydı; veritabanında `WhatsAppConnection` kaydı bulunmuyordu. Dolayısıyla yönetim sayfası bu bağlantıyı gösteremiyor, düzenleyemiyor veya şubelere atayamıyordu.

---

## Yapılan Değişiklikler

### 1. Backend — `server/src/routes/organizationWhatsApp.ts`

#### 1a. Legacy Sanal Girdi (GET)

`GET /organization/whatsapp-connections` uç noktası güncellendi. DB'de hiç kayıt yokken env var'lardaki Evolution API config'ini sanal (veritabanına yazılmamış) bir girdi olarak döndürüyor:

```json
{
  "id": "__legacy__",
  "isLegacy": true,
  "name": "Mevcut Evolution API Bağlantısı (Ortam Değişkenlerinden)",
  "provider": "evolution_api",
  "status": "connected",
  "evolutionApiUrl": "...",
  "evolutionInstanceName": "...",
  "clinics": []
}
```

**Güvenlik notu:** API key hiçbir zaman bu yanıta dahil edilmez.

#### 1b. Import-Legacy Uç Noktası (POST)

```
POST /api/organization/whatsapp-connections/import-legacy
```

Yetki: `OWNER`, `ORG_ADMIN`

- Env var'lardaki `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` değerlerini okur
- AES-256-GCM ile API key şifreler
- Organizasyona ait `WhatsAppConnection` kaydı oluşturur
- Organizasyondaki **tüm kliniklere** `ClinicWhatsAppConnection` kaydı ekler (`isDefault: true`)
- **Idempotent:** Aynı `evolutionInstanceName` için kayıt varsa 200 + `alreadyImported: true` döner, tekrar oluşturmaz
- Activity log + audit log yazar

Örnek yanıt (başarılı import):
```json
{
  "alreadyImported": false,
  "connection": {
    "id": "uuid...",
    "name": "Klinik Adı WhatsApp Hattı",
    "provider": "evolution_api",
    "status": "connected",
    "isActive": true,
    "clinics": [
      { "clinicId": "...", "clinic": { "id": "...", "name": "Ana Şube" }, "isDefault": true }
    ]
  }
}
```

#### 1c. Şube Atama — Create & Update

`connectionCreateSchema` ve `connectionUpdateSchema`'ya `linkedClinicIds: z.array(z.string().uuid()).optional()` alanı eklendi.

- **POST create:** `linkedClinicIds` verilirse, belirtilen şubelere `ClinicWhatsAppConnection` kaydı oluşturur. Cross-org güvenlik: yalnızca aynı organizasyona ait klinik ID'leri kabul edilir.
- **PUT update:** `linkedClinicIds` verilirse mevcut atamalarla senkronize eder (eksikleri siler, yenileri ekler). Boş dizi = tüm atamaları kaldır.

Her iki uç nokta da yanıtta `clinics` ilişkisini dahil ederek döner.

---

### 2. Frontend — `src/pages/WhatsAppConnections.tsx`

Sayfa tamamen yeniden yazıldı. Temel eklemeler:

#### 2a. Legacy Girdi Kartı

`isLegacy: true` olan bağlantılar için amber/turuncu uyarı kartı gösterilir:

- URL ve instance adını görünür yapar (API key gizli kalır)
- **"Veritabanına Aktar"** butonu ile `import-legacy` uç noktası çağrılır
- Düzenle / Test / QR / Bağlantıyı Kes butonları gizlenir (bu girdi DB'de yok)

#### 2b. Şube Atama (Modal)

Create / Edit modalına şube seçimi eklendi:

- `organizationBranchService.getAll()` ile organizasyondaki klinikleri çeker
- Checkbox listesi ile çoklu seçim
- Seçilen klinik ID'leri `linkedClinicIds` alanıyla backend'e gönderilir

#### 2c. Şube Uyarısı

Kayıtlı bağlantı kartında hiç şube atanmamışsa küçük sarı uyarı mesajı gösterilir.

---

### 3. API Servisi — `src/services/api.ts`

`whatsappConnectionService`'e `importLegacy` metodu eklendi:

```typescript
importLegacy: () => api.post('/organization/whatsapp-connections/import-legacy'),
```

---

### 4. Backfill Script — `server/src/scripts/backfill-whatsapp-connections.ts`

UI import flow'una alternatif olarak CLI'dan çalıştırılabilen tek seferlik script. Aynı idempotency mantığını kullanır.

```bash
cd server && ORGANIZATION_ID=<uuid> npx ts-node --esm src/scripts/backfill-whatsapp-connections.ts
```

---

## Etkilenen Dosyalar

| Dosya | Değişiklik |
|---|---|
| `server/src/routes/organizationWhatsApp.ts` | GET legacy entry, POST import-legacy, linkedClinicIds sync |
| `src/pages/WhatsAppConnections.tsx` | Tam yeniden yazım |
| `src/services/api.ts` | `importLegacy()` eklendi |
| `server/src/scripts/backfill-whatsapp-connections.ts` | Yeni dosya |

---

## Deployment Notu

Mevcut sistemlerde bağlantıyı aktifleştirmek için iki seçenek:

**Seçenek A — UI üzerinden:**
1. `/organization/whatsapp` sayfasını aç
2. Amber uyarı kartındaki **"Veritabanına Aktar"** butonuna tıkla
3. Klinik atamasını düzenlemek için bağlantıyı düzenle

**Seçenek B — CLI üzerinden:**
```bash
cd server
ORGANIZATION_ID=<org_uuid> npx ts-node --esm src/scripts/backfill-whatsapp-connections.ts
```

Her iki yöntem de idempotent'tir. İkisi birden çalıştırılsa bile duplikasyon oluşmaz.

---

## Güvenlik

- Legacy env-var API key hiçbir zaman API yanıtında yer almaz
- `import-legacy` yalnızca `OWNER` / `ORG_ADMIN` rolüne açık
- Şube atamasında cross-org guard: `organizationId` filtresiyle başka organizasyonun klinikleri atanamaz
- Import işlemi hem `activity_logs` hem `audit_logs` tablosuna yazılır
- API key AES-256-GCM ile şifrelenerek `evolutionApiKeyEncrypted` alanına kaydedilir

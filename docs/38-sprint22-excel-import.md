# 38 — Sprint 22: Excel ile Hasta ve Kullanıcı İçe Aktarma

**Tarih:** 24 Mayıs 2026  
**Durum:** Tamamlandı  
**Kapsam:** Excel şablonu indirme, yükleme/doğrulama önizlemesi ve toplu içe aktarma — hastalar ve kullanıcılar için

---

## Hedef

Klinik yöneticilerinin mevcut verilerini standart Excel dosyaları aracılığıyla sisteme aktarmasını sağlamak. Doğrulama hatalarını satır bazında görünür kılmak, geçici şifre yönetimini güvenli tutmak ve rol bazlı erişim kısıtlarına uymak.

---

## Mimari Kararlar

### 3 Adımlı Akış

Her içe aktarma işlemi aynı akışı izler:

1. **Şablon İndir** — Excel dosyası alınır, Şubeler sayfasında mevcut klinikler listelenir
2. **Yükle → Önizle** — Dosya sunucuya gönderilir, satır bazında doğrulama yapılır, hiçbir kayıt yazılmaz
3. **Onayla → İçe Aktar** — Geçerli satırlar DB'ye kaydedilir, hatalı satırlar atlanır

### Bellek İçi Yükleme

`multer.memoryStorage()` kullanıldı — yüklenen dosyalar diske yazılmaz, işlem tamamlanınca bellek temizlenir.

### Bağımsız Önizleme/Onay

Preview ve confirm endpoint'leri ayrı çalışır. Frontend dosyayı iki kez gönderir. Bu sayede Redis/session bağımlılığı oluşmaz; MVP için yeterli bir yaklaşım.

---

## Kullanılan Kütüphane

**`exceljs`** — `server/` dizinine yüklendi.

- Şablon oluşturma: `WorkbookWriter` ile 3 sayfalı `.xlsx` dosyası üretilir
- Dosya ayrıştırma: `wb.xlsx.load(buffer)` ile buffer doğrudan okunur
- Formül enjeksiyonu güvenliği: `cellToString()` yalnızca `.result` değerini alır, formülü yürütmez

---

## Eklenen Dosyalar

### `server/src/utils/excelImport.ts`

Tüm Excel mantığının merkezi.

**Dışa aktarılan sabitler:**

| Sabit | Değer |
|-------|-------|
| `MAX_IMPORT_ROWS` | 500 |
| `MAX_FILE_SIZE_BYTES` | 5 × 1024 × 1024 (5 MB) |

**Dışa aktarılan fonksiyonlar:**

| Fonksiyon | Açıklama |
|-----------|----------|
| `cellToString(cell)` | Hücre değerini güvenli biçimde string'e çevirir (null, number, richText, formül desteği) |
| `buildPatientTemplate(clinics)` | 3 sayfalı hasta şablonu: Hastalar / Talimatlar / Şubeler |
| `buildUserTemplate(clinics)` | 3 sayfalı kullanıcı şablonu: Kullanıcılar / Talimatlar / Şubeler |
| `parseExcelFile(buffer, expectedHeaders)` | İlk sayfayı okur, başlıkları kontrol eder, `Record<string,string>[]` döner |

**Hasta şablonu sütunları:**  
`firstName`, `lastName`, `phone`, `email`, `birthDate`, `gender`, `notes`, `clinicId`

**Kullanıcı şablonu sütunları:**  
`firstName`, `lastName`, `email`, `role`, `phone`, `clinicIds`, `canAccessAllClinics`, `password`

---

### `server/src/routes/patientsImport.ts`

| Endpoint | Method | Roller | Açıklama |
|----------|--------|--------|----------|
| `/api/patients/import-template` | GET | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Kliniklere göre hazırlanmış Excel şablonu indirir |
| `/api/patients/import-preview` | POST | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Dosyayı ayrıştırır, doğrular, DB'ye yazmadan sonuç döner |
| `/api/patients/import-confirm` | POST | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Geçerli satırları DB'ye kaydeder |

**Doğrulama kuralları (preview):**

- `firstName`, `lastName`, `phone` zorunlu
- `email` geçerli format (varsa)
- `birthDate` parse edilebilir tarih (varsa)
- `gender` → `male | female | other` (varsa)
- `clinicId` kendi organizasyonuna ait olmalı
- `clinicId` yoksa ve `selectedClinicId=all` ise hata
- Aynı telefon veya e-posta zaten DB'de varsa satır atlanır (overwrite yok)

**Confirm response:**
```json
{
  "imported": 12,
  "skipped": 3,
  "createdPatients": [...],
  "skippedRows": [{ "row": 5, "errors": ["Telefon zaten kayıtlı"] }]
}
```

---

### `server/src/routes/usersImport.ts`

| Endpoint | Method | Roller | Açıklama |
|----------|--------|--------|----------|
| `/api/users/import-template` | GET | OWNER, ORG_ADMIN, CLINIC_MANAGER | Kullanıcı şablonu indirir |
| `/api/users/import-preview` | POST | OWNER, ORG_ADMIN, CLINIC_MANAGER | Doğrulama önizlemesi |
| `/api/users/import-confirm` | POST | OWNER, ORG_ADMIN, CLINIC_MANAGER | Kullanıcıları oluşturur, `UserClinic` kayıtları ekler |

**Rol kısıtları:**

- `CLINIC_MANAGER` → `owner` veya `org_admin` rolü atayamaz
- `CLINIC_MANAGER` → `canAccessAllClinics=true` ayarlayamaz
- Diğer roller import yapamaz (403)

**Şifre yönetimi:**

- Satırda şifre varsa: en az 8 karakter kontrolü yapılır, hashlenerek kaydedilir
- Şifre yoksa: `generateTempPassword()` ile `tmp-{5 byte hex}-!X` formatında geçici şifre üretilir
- Geçici şifreler yalnızca confirm response'unda bir kez görünür; DB'de hash'li saklanır

**Confirm response:**
```json
{
  "imported": 8,
  "skipped": 1,
  "hasTemporaryPasswords": true,
  "warning": "...",
  "createdUsers": [
    { "email": "ali@...", "role": "DENTIST", "temporaryPassword": "tmp-a3f9b2c1-!X" }
  ],
  "skippedRows": [...]
}
```

---

## Değiştirilen Dosyalar

### `server/src/index.ts`

```typescript
import patientsImportRoutes from './routes/patientsImport.js';
import usersImportRoutes from './routes/usersImport.js';

app.use('/api', patientsImportRoutes);
app.use('/api', usersImportRoutes);
```

### `server/package.json`

```json
"scripts": {
  "test:imports": "tsx src/tests/excelImport.test.ts",
  "test": "... && npm run test:imports"
}
```

### `src/services/api.ts`

`patientService`'e eklendi:
```typescript
downloadImportTemplate(): Promise<Blob>
importPreview(file: File, clinicId?: string): Promise<ImportPreviewResult>
importConfirm(file: File, clinicId?: string): Promise<ImportConfirmResult>
```

`userService`'e eklendi:
```typescript
downloadImportTemplate(): Promise<Blob>
importPreview(file: File): Promise<ImportPreviewResult>
importConfirm(file: File): Promise<ImportConfirmResult>
```

### `src/utils/permissions.ts`

```typescript
export function canImportPatients(user): boolean
// OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST → true
// DENTIST, BILLING, ASSISTANT → false

export function canImportUsers(user): boolean
// OWNER, ORG_ADMIN, CLINIC_MANAGER → true
// Diğerleri → false
```

### `src/pages/Patients.tsx`

Header'a koşullu "Excel ile İçe Aktar" butonu eklendi (`canImportPatients` true ise görünür).  
`<PatientImportModal>` state yönetimiyle render edilir.

### `src/components/UserList.tsx`

Header'a koşullu "Excel ile Personel Ekle" butonu eklendi (`canImportUsers` true ise görünür).  
`<UserImportModal>` state yönetimiyle render edilir.

---

## Yeni Frontend Bileşenleri

### `src/components/PatientImportModal.tsx`

4 adımlı modal:

| Adım | İçerik |
|------|--------|
| 1 — Yükle | Şablon indirme linki + dosya seçici |
| 2 — Önizle | Toplam / Geçerli / Hatalı özet kartları, satır bazında hata tablosu |
| 3 — Onayla | "İçe Aktar" butonu ile confirm tetiklenir |
| 4 — Sonuç | Kaç kayıt aktarıldı, kaç satır atlandı özeti |

Başarılı içe aktarma sonrası `onSuccess()` çağrılır → liste yenilenir.

### `src/components/UserImportModal.tsx`

`PatientImportModal` ile aynı akış. Ek özellik:

- Sonuç ekranında `hasTemporaryPasswords=true` ise amber uyarı kutusu gösterilir
- Her kullanıcı için geçici şifre satırda gösterilir + kopyala butonu
- Uyarı: "Geçici şifreler yalnızca bir kez gösterilir. Şimdi kopyalayın."

---

## Testler

**`server/src/tests/excelImport.test.ts`** — 57 test, 0 başarısız

| Grup | Test Sayısı |
|------|-------------|
| Sabitler | 2 |
| `cellToString` | 7 |
| Hasta şablonu oluşturma | 4 |
| Kullanıcı şablonu oluşturma | 2 |
| `parseExcelFile` | 3 |
| Hasta satır doğrulama | 9 |
| Kullanıcı satır doğrulama | 11 |
| `canImportPatients` izin kontrolü | 7 |
| `canImportUsers` izin kontrolü | 7 |
| `normalizeRole` legacy dönüşüm | 5 |

---

## Güvenlik Notları

| Risk | Önlem |
|------|-------|
| Formül enjeksiyonu (CSV injection) | `cellToString()` yalnızca `.result` okur, formülü yürütmez |
| Farklı org'un kliniğine atama | Her satır `accessibleClinicIds` içinde kontrol edilir |
| Rol yükseltme | CLINIC_MANAGER, OWNER/ORG_ADMIN rolü atayamaz |
| Dosya disk kalıcılığı | `multer.memoryStorage()` — diske yazılmaz |
| Dosya tipi | Sadece `.xlsx` kabul edilir (MIME + uzantı kontrolü) |
| Şifre ifşası | Geçici şifreler yalnızca tek seferlik response'da döner |
| Büyük dosya saldırısı | 5 MB limit + 500 satır limiti |

---

## Kalan İyileştirmeler (MVP Sonrası)

- Preview sonucu sunucuda `importSessionId` ile önbellekleme → confirm'de dosya tekrar yüklenmesin
- Import sonuç dosyasını hatalı satırlarla birlikte `.xlsx` olarak indirme
- Organizasyon genelinde plan limiti toplu kontrolü (şu an klinik başına yapılıyor)

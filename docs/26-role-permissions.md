# Rol ve Yetki Matrisi

**Hazırlanma Tarihi:** 2026-05-20  
**Son Güncelleme:** 2026-05-20  
**Durum:** Mevcut kod tabanından çıkarılmış — `authorize([...])` middleware çağrıları esas alınmıştır. Tespit edilen teknik hatalar düzeltilmiştir.

---

## Sistemdeki Roller

### Klinik / Organizasyon Rolleri (JWT ile kimlik doğrulama)

> **Önemli:** `User.role` alanı veritabanında ve JWT'de her zaman **küçük harf** saklanır (`admin`, `doctor`, `receptionist`, `billing`). `authorize()` middleware artık case-insensitive karşılaştırma yapar — `authorize(['admin', 'owner'])` hem `'admin'` hem `'ADMIN'` değerlerini kabul eder.

| Rol Kodu | Görünen Ad | Kapsam | Açıklama |
|----------|-----------|--------|----------|
| `admin` | Klinik Yöneticisi | Klinik | Tek klinik iş akışındaki ana yönetici rolü. Multi-branch'te `OWNER` ile eşdeğer davranır. |
| `OWNER` | Organizasyon Sahibi | Organizasyon | Organizasyona ait tüm kliniklere erişir. `canAccessAllClinics = true`. |
| `ORG_ADMIN` | Organizasyon Admini | Organizasyon | Organizasyon genelinde yönetim yetkisi. `canAccessAllClinics = true`. |
| `doctor` | Doktor / Hekim | Klinik (atanmış) | Kendi randevuları ve hastaları üzerinde geniş okuma yetkisi, sınırlı yazma yetkisi. |
| `receptionist` | Resepsiyon | Klinik (atanmış) | Randevu, hasta, görev yönetimi. Finansal içerikleri görüntüler ama düzenleyemez. |
| `billing` | Ön Muhasebe | Klinik (atanmış) | Ödeme, rapor, komisyon işlemleri. Klinik yapılandırmasına erişemez. |

### Platform Yöneticisi (Ayrı Kimlik Doğrulama)

| Rol Kodu | Açıklama |
|----------|----------|
| `PlatformAdmin` | `authenticatePlatformAdmin` middleware — ayrı `PlatformAdmin` DB tablosu, ayrı JWT secret. Tüm klinik ve organizasyonları yönetir. Normal klinik JWT'si ile erişilemez. |

---

## Yetki Matrisi — Endpoint Bazında

> **Semboller:**  
> ✅ = Tam erişim &nbsp; 👁 = Yalnızca okuma &nbsp; ❌ = Erişim yok &nbsp; ✏️ = Yazma (oluşturma/güncelleme)

---

### 👤 Kullanıcı Yönetimi (`/api/users`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /users` | ✅ | ✅ | ❌ | 👁 | ❌ |
| `POST /users` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PUT /users/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /doctor-availabilities` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `PUT /doctor-availabilities/:id` | ✅ | ✅ | ✏️ | ❌ | ❌ |
| `GET /doctor-off-days` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /doctor-off-days` | ✅ | ✅ | ✏️ | ❌ | ❌ |
| `DELETE /doctor-off-days/:id` | ✅ | ✅ | ✅ | ❌ | ❌ |

---

### 🏥 Hasta Yönetimi (`/api/patients`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /patients` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `GET /patients/:id` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /patients` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `PUT /patients/:id` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `DELETE /patients/:id` | ✅ | ✅ | ❌ | ✅ | ❌ |

> **Not:** Hasta silme işlemi soft delete'tir (`deletedAt` timestamp).  
> Hasta eklemede `checkPatientLimit` middleware plan limitini kontrol eder.

---

### 📅 Randevu Yönetimi (`/api/appointments`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /appointments` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `GET /appointments/:id` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /appointments` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `PUT /appointments/:id` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `PATCH /:id/treatment-case` | ✅ | ✅ | ✏️ | ✏️ | ❌ |

---

### 📋 Randevu Talepleri (`/api/appointment-requests`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /appointment-requests` | ✅ | ✅ | ❌ | 👁 | ❌ |
| `PUT /:id/status` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `POST /:id/convert` | ✅ | ✅ | ❌ | ✏️ | ❌ |

> **Not:** Halka açık randevu talebi (`POST /api/booking/request`) — kimlik doğrulama gerekmez.

---

### 💊 Tedavi Planı / Vakası (`/api/treatment-cases`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /treatment-cases` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /treatment-cases/:id` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /treatment-cases` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `PUT /treatment-cases/:id` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `GET /:id/materials` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /:id/materials` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `DELETE /:id/materials/:txId` | ✅ | ✅ | ✅ | ✅ | ❌ |

---

### 🦷 Tedavi Prosedürleri — Treatment Plan (`/api/treatment-plan-procedures`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /` (liste) | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /:id` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /` (oluştur) | ✅ | ✅ | ✏️ | ❌ | ❌ |
| `PUT /:id` (güncelle) | ✅ | ✅ | ✏️ | ❌ | ❌ |
| `DELETE /:id` | ✅ | ✅ | ✅ | ❌ | ❌ |

---

### 💰 Ödeme Yönetimi (`/api/payments`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /payments` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /payments` | ✅ | ✅ | ❌ | ✏️ | ✏️ |
| `PUT /payments/:id` | ✅ | ✅ | ❌ | ❌ | ✏️ |
| `PATCH /:id/cancel` | ✅ | ✅ | ❌ | ❌ | ✅ |
| `GET /:id/receipt` | ✅ | ✅ | ❌ | 👁 | 👁 |

---

### 📆 Ödeme Planları (`/api/payment-plans`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /payment-plans` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /payment-plans/:id` | ✅ | ✅ | ❌ | 👁 | 👁 |
| `POST /payment-plans` | ✅ | ✅ | ❌ | ✏️ | ✏️ |
| `POST /:id/installments` | ✅ | ✅ | ❌ | ✏️ | ✏️ |
| `PATCH /:id/cancel` | ✅ | ✅ | ❌ | ❌ | ✅ |

---

### ✅ Görev Yönetimi (`/api/tasks`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /tasks` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `GET /tasks/:id` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /tasks` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `PUT /tasks/:id` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `PATCH /:id/complete` | ✅ | ✅ | ✅ | ✅ | ❌ |

---

### 🛠️ Hizmetler / Randevu Türleri (`/api/services`, `/api/appointment-types`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /services` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /services` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `PUT /services/:id` | ✅ | ✅ | ❌ | ✏️ | ❌ |

---

### 📦 Stok / Envanter (`/api/inventory`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /inventory` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /inventory/alerts` | ✅ | ✅ | ❌ | 👁 | 👁 |
| `GET /inventory/:id` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /inventory` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PUT /inventory/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /:id/transactions` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `GET /:id/transactions` | ✅ | ✅ | ❌ | 👁 | 👁 |

---

### 💬 Mesajlar / Şablonlar (`/api/messages`, `/api/message-templates`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /message-templates` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /message-templates` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `PUT /message-templates/:id` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `POST /message-templates/seed` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /messages/prepare` | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `GET /messages` | ✅ | ✅ | 👁 | 👁 | ❌ |
| `POST /messages/:id/send` | ✅ | ✅ | ❌ | ✏️ | ❌ |

---

### 🏥 Sigorta Provizyon (`/api/insurance-provisions`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /insurance-provisions` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /insurance-provisions/:id` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /insurance-provisions` | ✅ | ✅ | ❌ | ✏️ | ❌ |
| `PUT /insurance-provisions/:id` | ✅ | ✅ | ❌ | ✏️ | ✏️ |
| `PATCH /:id/status` | ✅ | ✅ | ❌ | ✏️ | ✏️ |
| `PATCH /:id/cancel` | ✅ | ✅ | ❌ | ✏️ | ✏️ |

---

### 📊 Raporlar (`/api/reports`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /reports/revenue` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `GET /reports/revenue/export.csv` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `GET /reports/doctor-performance` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `GET /reports/patient-sources` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `GET /reports/no-show-analysis` | ✅ | ✅ | ❌ | ❌ | 👁 |

---

### 💵 Hekim Komisyon Kuralları (`/api/compensation-rules`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /compensation-rules` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `POST /compensation-rules` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PUT /compensation-rules/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `DELETE /compensation-rules/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /service-compensation-rules` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `POST /service-compensation-rules` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `DELETE /service-compensation-rules/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### 💳 Hekim Kazançları (`/api/practitioner-earnings`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /practitioner-earnings` | ✅ | ✅ | 👁 (kendi) | ❌ | 👁 |
| `GET /practitioner-earnings/summary` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `GET /practitioner-earnings/:id` | ✅ | ✅ | 👁 (kendi) | ❌ | 👁 |
| `PATCH /:id/approve` | ✅ | ✅ | ❌ | ❌ | ✏️ |
| `PATCH /:id/adjust` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PATCH /:id/cancel` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PATCH /:id/mark-paid` | ✅ | ✅ | ❌ | ❌ | ✏️ |

---

### 💸 Hekim Ödemeleri (`/api/practitioner-payouts`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /practitioner-payouts` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `POST /practitioner-payouts` | ✅ | ✅ | ❌ | ❌ | ✏️ |
| `GET /practitioner-payouts/:id` | ✅ | ✅ | ❌ | ❌ | 👁 |
| `DELETE /practitioner-payouts/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### 🦷 Diş Haritası (`/api/dental-chart`, `/api/tooth-records`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /` (görüntüle) | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /` (kayıt ekle) | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `PUT /:id` (güncelle) | ✅ | ✅ | ✏️ | ✏️ | ❌ |

---

### 📎 Ekler / Dosyalar (`/api/attachments`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `POST /` (yükle) | ✅ | ✅ | ✏️ | ✏️ | ❌ |
| `GET /` (liste) | ✅ | ✅ | 👁 | 👁 | 👁 |
| `GET /:id` (indir) | ✅ | ✅ | 👁 | 👁 | 👁 |
| `DELETE /:id` | ✅ | ✅ | ❌ | ✅ | ❌ |

---

### 🔔 Bildirimler (`/api/notifications`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /notifications` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `PUT /notifications/:id/read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `DELETE /notifications/:id` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

### 🏢 Organizasyon Paneli (`/api/organization/dashboard`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /organization/dashboard` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### 🔐 GDPR / Veri Dışa Aktarma (`/api/gdpr`)

| Endpoint | admin | OWNER / ORG_ADMIN | doctor | receptionist | billing |
|----------|-------|-------------------|--------|--------------|---------|
| `GET /gdpr/export/:patientId` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### 🛡️ Platform Yönetimi (`/api/platform-admin/*`)

Tüm endpoint'ler yalnızca `PlatformAdmin` JWT ile erişilebilir. Klinik kullanıcı token'ları geçersizdir.

| Endpoint | PlatformAdmin |
|----------|--------------|
| `POST /platform-admin/login` | ✅ (public) |
| `GET /platform-admin/clinics` | ✅ |
| `POST /platform-admin/clinics` | ✅ |
| `PUT /platform-admin/clinics/:id` | ✅ |
| `GET /platform-admin/clinics/:id/users` | ✅ |
| Diğer tüm platform yönetim işlemleri | ✅ |

---

## Rol Özet Kartları

### `admin` (Klinik Yöneticisi / OWNER eşdeğeri)
- Tüm klinik verilerine tam erişim
- Kullanıcı yönetimi (oluşturma, düzenleme)
- Envanter yapılandırması
- Komisyon kuralı tanımlama
- GDPR veri dışa aktarma
- Raporlar ve finansal veriler
- Multi-branch: `canAccessAllClinics = true`

### `OWNER` / `ORG_ADMIN`
- `admin` rolüyle aynı klinik izinleri + Organization Dashboard
- Tüm şubelere aynı anda erişim
- Multi-branch plan yönetimi

### `doctor` (Doktor / Hekim)
- Hasta listesini okur (yazamaz, yeni hasta ekleyemez)
- Randevularını görür ve günceller
- Tedavi planı oluşturur ve günceller
- Kendi müsaitlik saatlerini ve izinlerini yönetir
- Kendi komisyon verilerini okur
- Mesaj hazırlar (göndermez)
- Ödeme, stok, rapor oluşturamaz / düzenleyemez

### `receptionist` (Resepsiyon)
- Hasta kaydı açar, günceller
- Randevu oluşturur ve günceller
- Tedavi planı açar
- Ödeme kaydeder (düzenleyemez, iptal edemez)
- Mesaj şablonu düzenler, mesaj gönderir
- Stok hareketi girebilir (yeni ürün ekleyemez)
- Rapor erişimi yoktur

### `billing` (Ön Muhasebe)
- Ödeme düzenler ve iptal eder
- Ödeme planı oluşturur ve yönetir
- Sigorta provizyon günceller
- Raporları okur (gelir, doktor performansı)
- Komisyon ve kazanç raporları okur
- Hekim ödemesi kaydeder
- Hasta kaydı açamaz, randevu oluşturamaz

---

## Düzeltme Geçmişi

| Tarih | Dosya | Düzeltme |
|-------|-------|----------|
| 2026-05-20 | `server/src/middleware/auth.ts` | `authorize()` artık case-insensitive: `roles.map(r => r.toLowerCase()).includes(req.user.role.toLowerCase())` |
| 2026-05-20 | `server/src/routes/organizationDashboard.ts` | `authorize(['admin', 'OWNER', 'ORG_ADMIN'])` → `authorize(['admin', 'owner', 'org_admin'])` (tutarlı küçük harf) |
| 2026-05-20 | `appointments`, `treatmentCases`, `tasks`, `payments`, `reports` route'ları | `validateAndGetScope` (organizationId zorunlu) → `validateAndGetClinicIdScope` (clinicId tabanlı). Bu modellerin Prisma şemasında `organizationId` alanı bulunmadığından önceki hâl tüm listeleme endpoint'lerinde 500 hatası üretiyordu. |

---

## Bilinen Tutarsızlıklar ve Teknik Borç

| Sorun | Açıklama | Durum |
|-------|----------|-------|
| ~~Karma rol formatı~~ | ~~`authorize()` case-sensitive'di; `OWNER`/`ORG_ADMIN` JWT'deki küçük harf değerlerle eşleşmiyordu~~ | ✅ **Düzeltildi** — `authorize()` artık case-insensitive |
| ~~`validateAndGetScope` yanlış model kullanımı~~ | ~~`Appointment`, `TreatmentCase`, `Task`, `Payment` modellerinde `organizationId` yokken `validateAndGetScope` bu alanı Prisma WHERE'e ekliyordu → runtime 500~~ | ✅ **Düzeltildi** — `validateAndGetClinicIdScope` kullanılıyor |
| **`doctor` vs `DENTIST`** | DB schema `UserClinic.role`'de `DENTIST` kullanırken `authorize()` çağrıları `User.role = doctor` bekliyor | ⚪ **Belgeleme farklılığı** — işlevsel hata yok; seed `User.role = 'doctor'` atar |
| **`admin` legacy** | `admin` rolü hem klinik admin hem de organization owner için kullanılıyor | ⚪ **MVP kabul** — multi-branch'te `canAccessAllClinics = true` ile yönetiliyor |
| **`billing` dashboard erişimi** | Billing kullanıcısı `/api/dashboard` endpoint'ine erişemiyor ancak raporlara erişebiliyor | 🔜 **İyileştirme adayı** — ileriki sprintlerde değerlendirilebilir |
| **`doctor` kendi verilerine kısıtlı değil** | Doktorlar tüm hastaları ve randevuları görebiliyor, yalnızca kendi hastalarını değil | 🔜 **MVP kabul** — ince taneli filtreleme ileriki sprintlere bırakıldı |

---

## Frontend Rol Kontrolü

`src/context/AuthContext.tsx` üzerinden kullanılabilir:

```typescript
const { user } = useAuth();

// Basit kontrol
if (user?.role === 'admin') { ... }

// Çoklu rol kontrolü için yardımcı
const canEdit = ['admin', 'receptionist'].includes(user?.role ?? '');
const isFinance = ['admin', 'billing'].includes(user?.role ?? '');
const isClinical = ['admin', 'doctor'].includes(user?.role ?? '');

// Multi-branch: tüm şubelere erişim kontrolü
const { canAccessAllClinics } = useClinic();
```

### Sayfa / Menü Görünürlüğü (Mevcut Durum)

| Sayfa / Menü | admin | doctor | receptionist | billing |
|--------------|-------|--------|--------------|---------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Hastalar | ✅ | ✅ | ✅ | ❌ |
| Randevular | ✅ | ✅ | ✅ | ❌ |
| Tedavi Planları | ✅ | ✅ | ✅ | 👁 |
| Ödemeler | ✅ | 👁 | 👁 | ✅ |
| Ödeme Planları | ✅ | 👁 | 👁 | ✅ |
| Görevler | ✅ | ✅ | ✅ | ❌ |
| Mesajlar | ✅ | 👁 | ✅ | ❌ |
| Raporlar | ✅ | ❌ | ❌ | ✅ |
| Stok | ✅ | 👁 | 👁 | 👁 |
| Kullanıcılar | ✅ | ❌ | ❌ | ❌ |
| Org. Paneli | ✅ (OWNER/ORG_ADMIN) | ❌ | ❌ | ❌ |

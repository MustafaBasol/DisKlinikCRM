# Rol ve Yetki Matrisi

**Hazırlanma Tarihi:** 2026-05-20  
**Son Güncelleme:** 2026-05-20 (Refactor: Kanonik Rol Sistemi)  
**Durum:** Üretim kodu ile senkronize — `server/src/utils/roles.ts` kanonik rol kaynağıdır.

---

## Sistemdeki Roller

### Kanonik Rol Seti (`server/src/utils/roles.ts`)

> **Önemli:** Kanonik roller kod içinde büyük harf kullanır (`OWNER`, `DENTIST` vb.).
> `User.role` veritabanında ve JWT'de **legacy küçük harf** olarak saklanır (`admin`, `doctor`, `receptionist`, `billing`).
> `normalizeRole(userRole, canAccessAllClinics)` her iki biçimi de kanonik forma dönüştürür.
> `authorize()` middleware artık **hem kanonik rolü hem de ham rolü** kontrol eder — geriye dönük uyumluluk bozulmaz.

| Kanonik Rol | Legacy Karşılığı | Görünen Ad | Kapsam | Açıklama |
|-------------|-----------------|-----------|--------|----------|
| `OWNER` | `admin` (canAccessAllClinics=**true**) veya `owner` | Organizasyon Sahibi | Organizasyon | Tüm şubelere tam erişim. `canAccessAllClinics = true`. |
| `ORG_ADMIN` | `org_admin` | Organizasyon Admini | Organizasyon | Organizasyon genelinde yönetim. `canAccessAllClinics = true`. |
| `CLINIC_MANAGER` | `admin` (canAccessAllClinics=**false**) veya `clinic_manager` | Şube Yöneticisi | Atanmış klinikler | Yalnızca atandığı şubeleri yönetir. |
| `DENTIST` | `doctor` veya `dentist` | Doktor / Hekim | Atanmış klinikler | Klinik veri okuma/yazma, finansal ve organizasyon ayarlarına erişemez. |
| `RECEPTIONIST` | `receptionist` | Resepsiyon | Atanmış klinikler | Randevu, hasta, görev, mesaj yönetimi. Hasta silme ve finans düzenleme yapamaz. |
| `BILLING` | `billing` | Ön Muhasebe | Atanmış klinikler | Ödeme, rapor, komisyon. Hasta/randevu oluşturamaz. |
| `ASSISTANT` | `assistant` veya bilinmeyen | Asistan | Atanmış klinikler | Sınırlı görüntüleme. Gelecek sprint için ayrılmış. |

### normalizeRole() Kuralları

```
admin + canAccessAllClinics=true   → OWNER
admin + canAccessAllClinics=false  → CLINIC_MANAGER
owner / OWNER                      → OWNER
org_admin / ORG_ADMIN              → ORG_ADMIN
clinic_manager / CLINIC_MANAGER    → CLINIC_MANAGER
doctor / DENTIST                   → DENTIST
receptionist / RECEPTIONIST        → RECEPTIONIST
billing / BILLING                  → BILLING
assistant / ASSISTANT              → ASSISTANT
bilinmeyen                         → ASSISTANT (en kısıtlayıcı)
```

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
| `DELETE /patients/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |

> **Not:** Hasta silme işlemi soft delete'tir (`deletedAt` timestamp).  
> `DELETE /patients/:id` artık `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])` ile korunur — **receptionist artık hasta silemez**.  
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

| Endpoint | OWNER | ORG_ADMIN | admin (canAll=true) | admin (canAll=false) | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|---------------------|----------------------|---------|--------------|--------|
| `GET /organization/dashboard` | ✅ | ✅ | ✅ → OWNER | ❌ → CLINIC_MANAGER | ❌ | ❌ | ❌ |

> **Güvenlik Notu:** `authorize(['OWNER','ORG_ADMIN'])` + `canAccessOrganizationDashboard()` çift katmanlı kontrol uygulanır.
> Legacy `admin` + `canAccessAllClinics=false` → `CLINIC_MANAGER`'a normalize olur → **erişim reddedilir**.
> Bu endpoint artık yalnızca organizasyon düzeyinde yetkisi olan kullanıcılara açıktır.

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
| 2026-05-20 | **`server/src/utils/roles.ts`** (YENİ) | Kanonik rol sistemi eklendi: `normalizeRole()`, `getEffectiveRoleForClinic()`, `canAccessOrganizationDashboard()`, `canDeletePatient()`, `canManageUsers()`, `canAccessReports()` ve diğer yardımcılar. |
| 2026-05-20 | `server/src/middleware/auth.ts` | `authorize()` kanonik + ham rol çift kontrolüne güncellendi. `normalizeRole()` import edildi. `authorize(['OWNER','ORG_ADMIN'])` çağrıları legacy `admin+canAccessAllClinics=true` kullanıcılarını otomatik geçirir; `admin+canAccessAllClinics=false` kullanıcılarını bloklar. |
| 2026-05-20 | `server/src/routes/organizationDashboard.ts` | `authorize(['admin','owner','org_admin'])` → `authorize(['OWNER','ORG_ADMIN'])` + `canAccessOrganizationDashboard()` çift kontrol. Legacy admin + canAccessAllClinics=false artık 403 alır. |
| 2026-05-20 | `server/src/routes/patients.ts` | `DELETE /patients/:id`: `authorize(['admin','receptionist'])` → `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])`. Receptionist artık hasta silemez. |
| 2026-05-20 | **`src/utils/permissions.ts`** (YENİ) | Frontend UX izin yardımcıları: `canViewOrganizationDashboard()`, `canDeletePatient()`, `canCreatePatient()`, `canViewReports()`, `canManageInventory()`, `canManageUsers()` vb. |
| 2026-05-20 | `src/layouts/MainLayout.tsx` | Sidebar menüsü ham `user?.role === 'admin'` kontrollerinden `permissions.ts` yardımcılarına geçirildi. Org. Paneli menüsü yalnızca `canViewOrganizationDashboard()=true` olan kullanıcılara gösterilir. |
| 2026-05-20 | `server/src/tests/multiBranchAccess.test.ts` | 55 yeni test eklendi (toplam 75): `normalizeRole`, Org Dashboard erişimi, hasta silme, hasta oluşturma, randevu oluşturma, ödeme yazma, rapor erişimi, kullanıcı yönetimi, `authorize()` simülasyonu. |

---

## Bilinen Tutarsızlıklar ve Teknik Borç

| Sorun | Açıklama | Durum |
|-------|----------|-------|
| ~~Karma rol formatı~~ | ~~`authorize()` case-sensitive'di; `OWNER`/`ORG_ADMIN` JWT'deki küçük harf değerlerle eşleşmiyordu~~ | ✅ **Düzeltildi** — `authorize()` artık case-insensitive |
| ~~`validateAndGetScope` yanlış model kullanımı~~ | ~~`Appointment`, `TreatmentCase`, `Task`, `Payment` modellerinde `organizationId` yokken `validateAndGetScope` bu alanı Prisma WHERE'e ekliyordu → runtime 500~~ | ✅ **Düzeltildi** — `validateAndGetClinicIdScope` kullanılıyor |
| ~~`admin+canAll=false` Org Dashboard'a erişiyordu~~ | ~~`authorize(['admin','owner','org_admin'])` legacy admin'i canAccessAllClinics değerinden bağımsız geçiriyordu~~ | ✅ **Düzeltildi** — kanonik rol kontrolüyle bloklandı |
| ~~Receptionist hasta silebiliyordu~~ | ~~`DELETE /patients/:id` `authorize(['admin','receptionist'])` ile korunuyordu~~ | ✅ **Düzeltildi** — `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER'])` |
| ~~Ham rol string karşılaştırmaları frontend'de dağınıktı~~ | ~~`user?.role === 'admin'` gibi kontroller `MainLayout.tsx`'e yayılmıştı~~ | ✅ **Düzeltildi** — `src/utils/permissions.ts` yardımcıları kullanılıyor |
| **`doctor` vs `DENTIST`** | DB schema `UserClinic.role`'de `DENTIST` kullanırken `authorize()` çağrıları `User.role = doctor` bekliyor | ⚪ **normalizeRole() her ikisini de DENTIST'e eşliyor** — işlevsel hata yok |
| **`CLINIC_MANAGER` DB'de yok** | `User.role = 'clinic_manager'` DB'de kullanılmıyor; legacy `admin+canAccessAllClinics=false` → normalize ediliyor | ⚪ **MVP kabul** — `normalizeRole()` geçişi şeffaf yönetiyor |
| **`billing` dashboard erişimi** | Billing kullanıcısı `/api/dashboard` endpoint'ine erişemiyor; frontend `/payments` veya `/reports`'a yönlendirilmeli | 🔜 **İyileştirme adayı** — finance-only widget sprint'i planlanacak |
| **`doctor` kendi verilerine kısıtlı değil** | Doktorlar tüm hastaları ve randevuları görebiliyor, yalnızca kendi hastalarını değil | 🔜 **MVP kabul** — ince taneli filtreleme ileriki sprintlere bırakıldı |

---

## Frontend Rol Kontrolü

### `src/utils/permissions.ts` — Merkezi Yardımcılar (YENİ)

Ham `user?.role === 'admin'` karşılaştırmaları yerine bu fonksiyonları kullanın:

```typescript
import {
  canViewOrganizationDashboard,
  canViewPatients,
  canCreatePatient,
  canDeletePatient,
  canViewAppointments,
  canCreateAppointment,
  canViewPayments,
  canManagePayments,
  canViewReports,
  canViewUsers,
  canManageUsers,
  canViewInventory,
  canManageInventory,
} from '../utils/permissions';

const { user } = useAuth();

// Organizasyon paneli erişimi
if (canViewOrganizationDashboard(user)) { ... }

// Hasta silme butonu göster/gizle
{canDeletePatient(user) && <DeleteButton />}

// Ödeme yönetimi
{canManagePayments(user) && <EditPaymentButton />}
```

> **Not:** `permissions.ts` içindeki `normalizeRole()` ile `server/src/utils/roles.ts` içindekiyle aynı mantığı taşır.
> Backend değiştiğinde her iki dosya senkronize tutulmalıdır.

### Sayfa / Menü Görünürlüğü — Güncel Durum (`MainLayout.tsx`)

| Sayfa / Menü | OWNER | ORG_ADMIN | CLINIC_MANAGER (legacy admin canAll=false) | DENTIST | RECEPTIONIST | BILLING |
|--------------|-------|-----------|---------------------------------------------|---------|--------------|---------|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Org. Paneli** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hastalar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Randevular | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Randevu Talepleri | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Tedavi Planları | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Görevler | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Ödemeler | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Ödeme Planları | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Sigorta Provizyon | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Mesajlar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Şablonlar | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Raporlar | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Hekim Kazançları | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Kazançlarım | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Stok Takibi | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Kullanıcılar | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

> **Not:** Frontend menüsü UX kapısıdır — backend her zaman gerçek otorite olmaya devam eder.

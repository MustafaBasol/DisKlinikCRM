# Rol ve Yetki Matrisi

**Hazırlanma Tarihi:** 2026-05-20  
**Son Güncelleme:** 2026-05-20 (Sprint 7: Klinik Çalışma Takvimi + Şube Bazlı Randevu Kuralları)  
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
| `POST /treatment-cases` | ✅ | ✅ | ✏️ | ✏️ ¹ | ❌ |
| `PUT /treatment-cases/:id` | ✅ | ✅ | ✏️ | ✏️ ¹ | ❌ |
| `GET /:id/materials` | ✅ | ✅ | 👁 | 👁 | 👁 |
| `POST /:id/materials` | ✅ | ✅ | ✏️ | ✏️ ¹ | ❌ |
| `DELETE /:id/materials/:txId` | ✅ | ✅ | ✅ | ❌ | ❌ |

> ¹ **MVP intentional**: Resepsiyon tedavi vakası açabilir/güncelleyebilir. Harici klinik onboardingi öncesinde gözden geçirilmeli; `DENTIST` ile kısıtlanması düşünülmeli (`TODO` işaretli).

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
| `POST /message-templates` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `PUT /message-templates/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
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

### 🌿 Şube Yönetimi (`/api/organization/clinics`)

| Endpoint | OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|----------------|---------|--------------|--------|
| `GET /organization/clinics` | ✅ | ✅ | 👁 (atandıkları) | ❌ | ❌ | ❌ |
| `POST /organization/clinics` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /organization/clinics/:id` | ✅ | ✅ | 👁 (atandıkları) | ❌ | ❌ | ❌ |
| `PUT /organization/clinics/:id` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `PATCH /organization/clinics/:id/status` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> **Güvenlik Notları:**
> - Tüm sorgular `req.user.organizationId` ile kapsama alınır; çapraz-organizasyon koruması aktiftir.
> - `CLINIC_MANAGER` yalnızca kendine atanmış şubeleri görebilir (`allowedClinicIds` kapsamı).
> - Yeni şube slug'ı organizasyon içinde benzersiz olmalıdır (`@@unique([organizationId, slug])`).
> - Slug formatı: `^[a-z0-9][a-z0-9-]*[a-z0-9]$` — en az 2 karakter, yalnızca küçük harf/sayı/tire.

---

### 👥 Kullanıcı-Klinik Atama (`/api/organization/users/:userId/clinics`)

| Endpoint | OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|----------------|---------|--------------|--------|
| `GET /organization/users/:userId/clinics` | ✅ | ✅ | 👁 (kendi şubeleri) | ❌ | ❌ | ❌ |
| `PUT /organization/users/:userId/clinics` | ✅ | ✅ | ✏️ (kısıtlı) | ❌ | ❌ | ❌ |

> **CLINIC_MANAGER Kısıtlamaları:**
> - Yalnızca kendi yönettiği şubelere kullanıcı atayabilir.
> - `OWNER` veya `ORG_ADMIN` rolü atayamaz (yalnızca `CLINIC_MANAGER`, `DENTIST`, `RECEPTIONIST`, `BILLING`, `ASSISTANT`).
> - `defaultClinicId` yalnızca atanmış şubelerden biri olabilir.
> - Hedef kullanıcı aynı organizasyona ait olmalıdır.

---

### �️ Klinik Çalışma Saatleri (`/api/clinics/:clinicId/working-hours`)

| Endpoint | OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|----------------|---------|--------------|--------|
| `GET /clinics/:clinicId/working-hours` | ✅ | ✅ | ✅ | 👁 | 👁 | ❌ |
| `PUT /clinics/:clinicId/working-hours` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

> **Notlar:**
> - `PUT` bulk upsert — 7 günlük tüm program tek istekte gönderilir.
> - Her gün için `dayOfWeek` (0=Paz…6=Cmt), `openTime`, `closeTime`, `isClosed` alanları gereklidir.
> - Kayıt yoksa varsayılanlar: Pzt-Cum 09:00-18:00, Cmt 09:00-13:00, Paz kapalı.
> - Şube kapsamı `getAccessibleClinicIds` ile zorunlu kılınır — çapraz şube erişimi engellenir.

---

### 👨‍⚕️ Şube Doktorları (`/api/clinics/:clinicId/doctors`)

| Endpoint | OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|----------------|---------|--------------|--------|
| `GET /clinics/:clinicId/doctors` | ✅ | ✅ | ✅ | ❌ | 👁 | ❌ |

> - `UserClinic` tablosundan aktif atamalar + legacy `User.clinicId` eşleşmesi — tekrarsız birleştirme.

---

### 📆 Müsaitlik Slotları (`/api/availability`)

| Endpoint | OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|----------|-------|-----------|----------------|---------|--------------|--------|
| `GET /availability?clinicId&doctorId&date&duration` | ✅ | ✅ | ✅ | 👁 | 👁 | ❌ |

> - Klinik kapalı günlerde boş dizi döner.
> - Slot hesaplama: Doktor programı ∩ Klinik çalışma saatleri → `duration`-dakikalık aralıklar.
> - Her slot `{ time, available, reason? }` içerir.

---



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

### `admin` (Legacy Rol — Kanonik Karşılığı `canAccessAllClinics` Değerine Göre Değişir)
- **Legacy rol** — Veritabanında `admin` olarak saklanır, kanonik sisteme şu şekilde eşlenir:
  - `admin + canAccessAllClinics=true` → `OWNER`: Tüm şubelere tam erişim
  - `admin + canAccessAllClinics=false` → `CLINIC_MANAGER`: Yalnızca atandığı şubeler
- Yeni kullanıcılar için `owner`, `clinic_manager` veya `org_admin` gibi açık kanonik roller kullanılmalıdır
- `admin` rolü geriye dönük uyumluluk için desteklenmeye devam eder

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
- Tedavi planı açar ve günceller (**MVP: klinik onboarding öncesi gözden geçirilmeli**)
- Ödeme kaydeder (düzenleyemez, iptal edemez)
- Mesaj şablonu **okur** ve mesaj gönderir; şablon **oluşturamaz/düzenleyemez**
- Stok hareketi girebilir (yeni ürün ekleyemez); malzeme **silemez** (stok geri yükleme yasak)
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
| 2026-05-20 | 21× `server/src/routes/*.ts` | `authorize(['admin', ...])` kalıplarının tamamı kanonik rol listeleriyle değiştirildi. `admin` artık organizasyon-düzeyi route'larda geçmez; `['OWNER','ORG_ADMIN']` veya `['OWNER','ORG_ADMIN','CLINIC_MANAGER']` kullanılır. |
| 2026-05-20 | `server/src/routes/auth.ts` | `GET /api/me` yanıtına `normalizedRole` ve `permissions` objesi eklendi. `roles.ts` yardımcıları import edildi. |
| 2026-05-20 | `src/context/AuthContext.tsx` | `User` tipine `normalizedRole?` ve `permissions?` alanları eklendi. `initAuth` server'dan dönen bayrakları doğrudan depolar. |
| 2026-05-20 | `src/utils/permissions.ts` | `normalizeRole` export edildi. 6 izin fonksiyonu (`canViewOrganizationDashboard`, `canDeletePatient`, `canManagePayments`, `canViewReports`, `canManageUsers`, `canManageInventory`) önce `user.permissions.*` server bayraklarını kontrol eder; eksikse yerel hesaplamaya düşer. |
| 2026-05-20 | `src/pages/Dashboard.tsx` | BILLING rolü `<Navigate to="/reports" replace />` ile yönlendirilir. DENTIST kontrolü kanonik rol kullanacak şekilde güncellendi. |
| 2026-05-20 | `server/src/tests/multiBranchAccess.test.ts` | 15 yeni test eklendi (toplam **90**): billing redirect simülasyonu, legacy admin OWNER/CLINIC_MANAGER davranış kapsamı, `authorize(['admin'])` org-düzeyi tehlike senaryosu, `/api/me` permission flags simülasyonu. |
| 2026-05-21 | `server/src/routes/treatmentCases.ts` | `DELETE /:id/materials/:txId`: `RECEPTIONIST` kaldırıldı — stok geri yükleme hassas işlemi yalnızca DENTIST/yönetim rolleri. POST/PUT/POST-materials route'larına `TODO(MVP)` yorumları eklendi. |
| 2026-05-21 | `server/src/routes/messages.ts` | `POST /message-templates`, `PUT /message-templates/:id`: `RECEPTIONIST` kaldırıldı — şablon yazma yönetim sorumluluğu. RECEPTIONIST okuma ve gönderme haklarını korur. |
| 2026-05-21 | `src/layouts/MainLayout.tsx` | `canSeeTemplates` hesabı `user.role === 'admin'` tekrarlı koşulundan `canManageUsers(user) \| normalizeRole(...)` yardımcısına geçirildi. `canManageUsers`, `normalizeRole` import eklendi. |
| 2026-05-21 | `src/components/DoctorAvailabilityManager.tsx` | `user?.role === 'admin'` → `canManageUsers(user)`. `canManageUsers` import eklendi. |
| 2026-05-21 | `src/pages/Settings.tsx` | 3 ham rol kontrolü `canManageUsers(user)` yardımcısına geçirildi. |
| 2026-05-21 | `src/pages/PaymentPlans.tsx` | `isAdmin = user.role === 'admin' \|\| user.role === 'billing'` → `canManagePayments(user)`. |
| 2026-05-21 | `src/pages/Inventory.tsx` | `isAdmin = user.role === 'admin'` → `canManageInventory(user)`. |
| 2026-05-21 | `src/pages/Appointments.tsx` | `canEdit = user.role === 'admin' \|\| user.role === 'receptionist'` → `canCreateAppointment(user)`. |
| 2026-05-21 | `src/pages/Messages.tsx` | `canSend = user.role === 'admin' \|\| user.role === 'receptionist'` → `canCreateAppointment(user)`. |
| 2026-05-21 | `server/src/tests/multiBranchAccess.test.ts` | 9 yeni test eklendi (toplam **99**): bilinmeyen rol → ASSISTANT + tüm izinler false; resepsiyon klinik izin sınırları (malzeme silme yasak, şablon yazma yasak). |
| 2026-05-20 | **`server/src/routes/organizationBranches.ts`** (YENİ) | **Sprint 6** — Şube Yönetimi + Kullanıcı-Klinik Atama API'si. 7 endpoint: `GET/POST /organization/clinics`, `GET/PUT/PATCH /organization/clinics/:id`, `GET/PUT /organization/users/:userId/clinics`. Zod doğrulama, çapraz-org koruması, CLINIC_MANAGER kısıtlamaları, slug benzersizliği, Prisma transaction. |
| 2026-05-20 | **`server/src/utils/roles.ts`** (GÜNCELLENDİ) | `canManageBranches(user)` ve `canAssignUserClinics(user)` yardımcıları eklendi. |
| 2026-05-20 | `server/src/routes/auth.ts` | `GET /api/me` yanıtına `defaultClinicId`, `permissions.canManageBranches`, `permissions.canAssignUserClinics` eklendi. |
| 2026-05-20 | `server/src/index.ts` | `organizationBranchesRoutes` `/api` prefix'iyle kaydedildi. |
| 2026-05-20 | `server/src/tests/multiBranchAccess.test.ts` | 30 yeni test eklendi (toplam **129**): `canManageBranches`, `canAssignUserClinics`, CLINIC_MANAGER rol atama kısıtlamaları, slug doğrulaması, şube görüntüleme kısıtlamaları. |
| 2026-05-20 | **`src/utils/permissions.ts`** (GÜNCELLENDİ) | `canManageBranches()`, `canViewBranches()`, `canAssignUserClinics()` eklendi. `ServerPermissions` tipine `canManageBranches?` ve `canAssignUserClinics?` alanları eklendi. |
| 2026-05-20 | `src/context/AuthContext.tsx` | `User` tipine `defaultClinicId?: string \| null` ve `permissions.canManageBranches`, `permissions.canAssignUserClinics` eklendi. |
| 2026-05-20 | `src/services/api.ts` | `organizationBranchService` (`getAll`, `getById`, `create`, `update`, `updateStatus`) ve `userClinicAssignmentService` (`getUserClinics`, `updateUserClinics`) eklendi. |
| 2026-05-20 | **`src/pages/Branches.tsx`** (YENİ) | Şube yönetim sayfası — kart grid görünümü, şube oluşturma/düzenleme modalı, durum değiştirme modalı, `canManageBranches`/`canViewBranches` erişim koruması, Türkçe addan slug otomatik üretimi. |
| 2026-05-20 | **`src/components/UserClinicAssignmentModal.tsx`** (YENİ) | Kullanıcı-klinik atama modalı — klinik checkbox listesi, şubeye özel rol seçici (OWNER/ORG_ADMIN hariç), varsayılan klinik seçimi, satır içi hata bildirimi. |
| 2026-05-20 | `src/components/UserList.tsx` | Kullanıcı satırına `Building2` ikonlu "Klinik Atamaları" butonu eklendi; `canAssignUserClinics(currentUser)` ile korumalı; `UserClinicAssignmentModal` açar. |
| 2026-05-20 | `src/layouts/MainLayout.tsx` | `canViewBranches` import edildi; `canViewBranches(user)` kontrolüyle "Şubeler" → `/branches` menü öğesi eklendi. |
| 2026-05-20 | `src/App.tsx` | `Branches` sayfası import edildi; `<Route path="branches" element={<Branches />} />` eklendi. |
| 2026-05-20 | **Sprint 7 — Klinik Çalışma Takvimi + Şube Bazlı Randevu Kuralları** | |
| 2026-05-20 | **`server/prisma/schema.prisma`** | `ClinicWorkingHours` modeli eklendi: `organizationId`, `clinicId`, `dayOfWeek Int`, `openTime String`, `closeTime String`, `isClosed Boolean`. `@@unique([clinicId, dayOfWeek])` kısıtı. `Clinic` ve `Organization` modellerine `clinicWorkingHours` ilişkisi eklendi. |
| 2026-05-20 | **`server/prisma/migrations/20260525100000_add_clinic_working_hours/migration.sql`** (YENİ) | Manuel migration SQL — PostgreSQL kapalıyken oluşturuldu; DB açıldığında `npx prisma migrate deploy` ile uygulanır. |
| 2026-05-20 | **`server/src/routes/schedules.ts`** (YENİ) | 4 endpoint: `GET/PUT /api/clinics/:clinicId/working-hours`, `GET /api/clinics/:clinicId/doctors`, `GET /api/availability`. Tüm route'larda `assertClinicAccess()` ile şube izolasyonu. Müsaitlik slot hesaplaması: klinik çalışma saati ∩ doktor programı → `duration`-dakikalık slotlar. |
| 2026-05-20 | **`server/src/utils/helpers.ts`** | `checkPractitionerAvailability()`: `clinicWorkingHours.findUnique` ile üçüncü paralel sorgu eklendi. Doktor kontrolünden önce iki yeni guard: `clinic_closed` ve `outside_clinic_hours`. |
| 2026-05-20 | **`server/src/routes/appointments.ts`** | `POST /api/appointments`: `User.clinicId === clinicId` tek kontrolü → `User.clinicId` **veya** `UserClinic.findFirst({ userId, clinicId, isActive:true })` çift kontrol. Multi-branch doktor atamasıyla geriye dönük uyumlu. |
| 2026-05-20 | **`server/src/utils/roles.ts`** | 3 yeni yardımcı eklendi: `canManageClinicSchedule(user)` (OWNER/ORG_ADMIN/CLINIC_MANAGER), `canManageDoctorSchedule(user, userId?, doctorId?)` (yönetim tam; DENTIST yalnızca kendi), `canViewAvailability(_user)` (her zaman true). |
| 2026-05-20 | **`server/src/index.ts`** | `schedulesRoutes` import edildi; `app.use('/api', schedulesRoutes)` eklendi. |
| 2026-05-20 | **`server/src/tests/scheduleAccess.test.ts`** (YENİ) | 41 birim testi — `canManageClinicSchedule`, `canManageDoctorSchedule`, `canViewAvailability`, slot hesaplama, `ClinicWorkingHours` sınır koşulları. **41/41 ✅** |
| 2026-05-20 | **`src/utils/permissions.ts`** | `canManageClinicSchedule(user)` ve `canManageDoctorSchedule(user, userId?, doctorId?)` frontend yardımcıları eklendi. |
| 2026-05-20 | **`src/services/api.ts`** | `scheduleService` eklendi: `getWorkingHours(clinicId)`, `updateWorkingHours(clinicId, hours[])`, `getClinicDoctors(clinicId)`, `getAvailability(params)`. `doctorAvailabilityService.getAll` imzası `{ practitionerId?, clinicId? }` destekleyecek şekilde genişletildi. |
| 2026-05-20 | **`src/pages/ClinicSchedule.tsx`** (YENİ) | Şube çalışma takvimi yönetim sayfası. Rota: `/branches/:clinicId/schedule`. 2 sekme: Çalışma Saatleri (7 günlük grid, açık/kapalı toggle, saat girişleri, bulk kaydet) ve Doktorlar (şube doktorları listesi, her doktor için program görüntüleme). `canManageClinicSchedule` erişim koruması. |
| 2026-05-20 | **`src/App.tsx`** | `ClinicSchedule` import edildi; `<Route path="branches/:clinicId/schedule" element={<ClinicSchedule />} />` eklendi. |
| 2026-05-20 | **`src/pages/Branches.tsx`** | `useNavigate` + `canManageClinicSchedule` eklendi. Şube dropdown menüsüne "Program Yönet" (Clock ikonu) butonu eklendi — yalnızca OWNER/ORG_ADMIN/CLINIC_MANAGER görebilir. |
| 2026-05-20 | **`src/components/AppointmentForm.tsx`** | Doktor listesi: `localStorage.getItem('hcrm_clinic_id')` !== `'all'` ise `scheduleService.getClinicDoctors(clinicId)` kullanılır; aksi hâlde `userService.getDoctors()`. |

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
| ~~`billing` dashboard erişimi~~ | ~~Billing kullanıcısı `/dashboard`'a girince anlamsız veri görüyordu~~ | ✅ **Düzeltildi** — `Dashboard.tsx` BILLING rolünü `<Navigate to="/reports" replace />` ile yönlendirir |
| **`doctor` kendi verilerine kısıtlı değil** | Doktorlar tüm hastaları ve randevuları görebiliyor, yalnızca kendi hastalarını değil | 🔜 **MVP kabul** — ince taneli filtreleme ileriki sprintlere bırakıldı |
| **Resepsiyon tedavi vakası yazma** | Resepsiyon POST/PUT treatment cases + POST materials yapabilir; harici klinik onboarding öncesinde gözden geçirilmeli | ⚠️ **MVP intentional** — ilgili route'larda `TODO(MVP)` yorumu mevcut |
| **Frontend test altyapısı yok** | Backend için `tsx` tabanlı birim testleri var; frontend bileşenlerini test eden Jest/Vitest kurulumu bulunmuyor | 🔜 **İleriki sprint** — frontend izin mantığı şimdilik manuel QA |

---

## Frontend Rol Kontrolü

### `src/utils/permissions.ts` — Merkezi Yardımcılar

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

> **Yetki Kaynağı Hiyerarşisi:**
> `GET /api/me` artık `normalizedRole` ve `permissions` objesi döner (`AuthContext.tsx`'deki `User` tipine eklendi).
> `permissions.ts` fonksiyonları önce `user.permissions.*` server bayraklarını kontrol eder; eksikse yerel `normalizeRole()` hesaplamasına düşer.
> **Backend her zaman gerçek otoritedir** — frontend yalnızca UX kapısıdır.

#### `GET /api/me` — Döndürülen İzin Alanları

```json
{
  "id": "...",
  "role": "admin",
  "normalizedRole": "CLINIC_MANAGER",
  "canAccessAllClinics": false,
  "defaultClinicId": "clinic-uuid-or-null",
  "permissions": {
    "canViewOrganizationDashboard": false,
    "canDeletePatient": true,
    "canManageUsers": true,
    "canViewReports": true,
    "canManagePayments": false,
    "canManageInventory": true,
    "canManageBranches": false,
    "canAssignUserClinics": true
  }
}
```

### Sayfa / Menü Görünürlüğü — Güncel Durum (`MainLayout.tsx`)

| Sayfa / Menü | OWNER | ORG_ADMIN | CLINIC_MANAGER (legacy admin canAll=false) | DENTIST | RECEPTIONIST | BILLING |
|--------------|-------|-----------|---------------------------------------------|---------|--------------|---------|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ↪ `/reports` |
| **Org. Paneli** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ || **Şubeler** | ✅ | ✅ | 👁 | ❌ | ❌ | ❌ |
| **Şube Program Yönet** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ || Hastalar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
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
> `↪ /reports` = BILLING kullanıcısı `/dashboard` rotasına geldiğinde `Dashboard.tsx` otomatik yönlendirir.

# 31 — Role-Based Access QA Sweep & Security Fixes

**Tarih:** 22 Mayıs 2026  
**Sprint:** Sprint 14 Sonrası Güvenlik Denetimi  
**Durum:** Tamamlandı ✅

---

## Amaç

Bu denetimin amacı, her rolün yalnızca izin verilen verilere ve sayfalara erişebildiğini doğrulamaktı. Yeni özellik eklenmedi; yalnızca rol görünürlüğü, backend yetkilendirme, klinik kapsam (clinic scoping) ve çapraz organizasyon izolasyonu incelendi.

---

## Bulunan ve Düzeltilen Kritik Güvenlik Açığı

### Ham Rol String Karşılaştırması (Raw Role Check Bypass)

**Etkilenen dosyalar:** `dashboard.ts`, `appointments.ts`, `payments.ts`, `practitionerEarnings.ts`, `insuranceProvisions.ts`, `tasks.ts`, `treatmentCases.ts`, `notifications.ts`, `users.ts`, `patients.ts`

**Sorun:**

Tüm bu route'larda DENTIST rolü için veri kapsam kısıtlaması şu şekilde yapılıyordu:

```typescript
const { role } = req.user!;
if (role === 'doctor') {
  where.practitionerId = userId; // Yalnızca kendi verilerini gör
}
```

Bu kontrol, veritabanında `role: 'DENTIST'` veya `role: 'dentist'` olarak kayıtlı kullanıcılar için **çalışmıyordu**. `normalizeRole()` fonksiyonu hem `'doctor'` hem de `'dentist'` ve `'DENTIST'` değerlerini kanonik `'DENTIST'` rolüne dönüştürüyor, ancak JWT'de ham rol değeri saklandığı için koşul hiçbir zaman eşleşmiyordu.

**Etki:**  
- Kanonik rol (`'DENTIST'`) veya alternatif yazım (`'dentist'`) kullanan bir kullanıcı, yalnızca kendi randevu/tedavi/kazanç kayıtlarını değil, kliniğin **tüm** kayıtlarını görebilirdi.

**Çözüm:**

`authenticate` middleware'e (`server/src/middleware/auth.ts`) `normalizedRole` alanı eklendi:

```typescript
export interface AuthRequest extends Request {
  user?: {
    id: string;
    clinicId: string;
    role: string;              // Ham rol — yalnızca logging için
    normalizedRole: string;    // Kanonik rol — güvenlik kontrolleri için kullanın
    organizationId: string;
    allowedClinicIds: string[];
    canAccessAllClinics: boolean;
  };
}

// authenticate middleware içinde:
const canAccessAllClinics = decoded.canAccessAllClinics ?? false;
req.user = {
  ...
  normalizedRole: normalizeRole(decoded.role, canAccessAllClinics),
  canAccessAllClinics,
};
```

Tüm etkilenen route'larda `role === 'doctor'` → `normalizedRole === 'DENTIST'` olarak güncellendi.  
`role === 'billing'` → `normalizedRole === 'BILLING'` olarak güncellendi.

---

## Backend Yetkilendirme Denetimi — Tüm Route'lar

Tüm backend route'ları `authorize()`, `requireClinicAccess` ve `organizationId` kapsam uygulaması açısından denetlendi.

| Route Dosyası | Yetkilendirme | Klinik Kapsam | Notlar |
|---|---|---|---|
| `auth.ts` | — (public login) | — | JWT üretimi, `normalizedRole` token'a eklenmedi (ham rol saklanır) |
| `patients.ts` | ✅ `authorize()` | ✅ `organizationId` | BILLING erişimi yok |
| `appointments.ts` | ✅ `authorize()` | ✅ `clinicId` | DENTIST yalnızca kendi randevuları |
| `appointmentRequests.ts` | ✅ `authorize()` | ✅ | RECEPTIONIST dahil |
| `tasks.ts` | ✅ `authorize()` | ✅ | DENTIST yalnızca atanan görevler |
| `treatmentCases.ts` | ✅ `authorize()` | ✅ | DENTIST yalnızca kendi vakaları |
| `payments.ts` | ✅ `authorize()` | ✅ | DENTIST okuma (sınırlı kapsam) |
| `paymentPlans.ts` | ✅ `authorize()` | ✅ | |
| `insuranceProvisions.ts` | ✅ `authorize()` | ✅ | DENTIST okuma, BILLING yazma |
| `practitionerEarnings.ts` | ✅ `authorize()` | ✅ (clinicId) | DENTIST yalnızca kendi kazançları — `normalizedRole` ile düzeltildi |
| `compensationRules.ts` | ✅ `authorize()` | ✅ | BILLING sadece okuma |
| `reports.ts` | ✅ `authorize()` | ✅ | DENTIST/RECEPTIONIST erişimi yok |
| `financeDashboard.ts` | ✅ `authorize()` | ✅ `resolveClinicScope` | DENTIST erişimi yok |
| `organizationDashboard.ts` | ✅ `authorize()` | ✅ | Yalnızca OWNER/ORG_ADMIN |
| `operationalMonitoring.ts` | ✅ `authorize()` | ✅ | CLINIC_MANAGER+ |
| `organizationBranches.ts` | ✅ `authorize()` | ✅ | Yazma: yalnızca OWNER/ORG_ADMIN |
| `organizationWhatsApp.ts` | ✅ `authorize()` | ✅ | Yönetim: yalnızca OWNER/ORG_ADMIN |
| `whatsappInbox.ts` | ✅ `authorize()` | ✅ | Yönetim: CLINIC_MANAGER+ |
| `messages.ts` | ✅ `authorize()` | ✅ | Şablon yazma: CLINIC_MANAGER+ |
| `dentalChart.ts` | ✅ `authorize()` | ✅ | |
| `notifications.ts` | ✅ `authorize()` | ✅ | DENTIST kendi bildirimlerini görür |
| `inventory.ts` | ✅ `authorize()` | ✅ | DENTIST/RECEPTIONIST okuma |
| `attachments.ts` | ✅ `authorize()` | ✅ | Okuma/yazma/silme ayrı izinler |
| `gdprExport.ts` | ✅ `authorize()` | ✅ | CLINIC_MANAGER+ |
| `users.ts` | ✅ `authorize()` | ✅ | GET: RECEPTIONIST (doktor listesi için gerekli) |
| `platformAdmin.ts` | ✅ `authenticatePlatformAdmin` | — | Tamamen ayrı JWT (`PLATFORM_JWT_SECRET`) |
| `publicBooking.ts` | — (public) | `clinicId` URL parametresi | Kimlik doğrulama gerekmiyor |

---

## Rol QA Matrisi

| Modül | OWNER / ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING |
|---|---|---|---|---|---|
| Dashboard | Tam erişim | Tam erişim | Yalnızca kendi verileri | Randevu/görev özeti | Ödeme metrikleri |
| Hastalar | ✅ | ✅ | ✅ | ✅ | ❌ 403 |
| Randevular | ✅ tümü | ✅ tümü | ✅ yalnızca kendi | ✅ tümü | ❌ 403 |
| Randevu İstekleri | ✅ | ✅ | ❌ 403 | ✅ | ❌ 403 |
| Tedavi Vakaları | ✅ | ✅ | ✅ yalnızca kendi | ❌ 403 | ❌ 403 |
| Ödemeler | ✅ | ✅ | ✅ okuma (sınırlı) | ✅ | ✅ |
| Ödeme Planları | ✅ | ✅ | ✅ okuma | ✅ | ✅ |
| Sigorta Provizyon | ✅ | ✅ | ✅ okuma | ✅ | ✅ yazma |
| Pratisyen Kazançları | ✅ | ✅ | ✅ yalnızca kendi | ❌ 403 | ✅ |
| Raporlar | ✅ | ✅ | ❌ 403 | ❌ 403 | ✅ |
| Finans Panosu | ✅ | ✅ | ❌ 403 | ❌ 403 | ✅ |
| Operasyon İzleme | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 |
| Organizasyon Panosu | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| Şube Yönetimi | ✅ tümü | ✅ listeleme | ❌ 403 | ❌ 403 | ❌ 403 |
| Kullanıcı Yönetimi | ✅ | ✅ | ❌ 403 | ✅ sadece listeleme | ❌ 403 |
| WhatsApp Gelen Kutusu | ✅ | ✅ | ✅ okuma | ✅ | ❌ 403 |
| WhatsApp Yönetimi | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| Mesaj Şablonları | ✅ | ✅ yazma | ✅ okuma | ✅ okuma | ❌ 403 |
| Diş Diyagramı | ✅ | ✅ | ✅ | ✅ okuma | ✅ okuma |
| Envanter | ✅ | ✅ | ✅ okuma | ✅ okuma | ❌ 403 |
| GDPR Dışa Aktarma | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 |
| PlatformAdmin API | ❌ (ayrı JWT) | ❌ | ❌ | ❌ | ❌ |

---

## Önemli Tasarım Kararları (Kasıtlı)

- **`GET /users` RECEPTIONIST'e açık:** Randevu formlarında doktor listesi için gerekli. Kapsam `allowedClinicIds` ile kısıtlı.
- **`GET /payments` DENTIST'e açık:** Hasta ödeme bağlamı için okuma erişimi. Yazma işlemleri engellendi.
- **`GET /practitioner-earnings` DENTIST'e açık:** Kendi kazançlarını görebilmeli. `where.practitionerId = userId` ile kapsam kısıtlı.
- **`insuranceProvisions` DENTIST okuma:** Tedavi sürecinde sigorta durumunu görmesi gerekiyor.

---

## Çapraz Organizasyon İzolasyonu

`buildClinicScopeWhere()` fonksiyonu (`server/src/utils/clinicScope.ts`) tüm Prisma sorgularına `organizationId` filtresi ekliyor. Bu sayede:

- Farklı organizasyondaki bir klinik ID'si geçilse bile veri döndürülmüyor
- `selectedClinicId` parametresi hem organizasyon aidiyeti hem de `allowedClinicIds` üzerinden doğrulanıyor
- `canAccessAllClinics=true` olan kullanıcılar yalnızca kendi organizasyonlarının kliniklerine erişebiliyor

---

## TypeScript Doğrulama

```
cd server && npx tsc --noEmit  → 0 hata
cd .. && npx tsc --noEmit      → 0 hata
```

---

## Değiştirilen Dosyalar

- `server/src/middleware/auth.ts` — `normalizedRole` alanı eklendi
- `server/src/routes/dashboard.ts`
- `server/src/routes/appointments.ts`
- `server/src/routes/payments.ts`
- `server/src/routes/practitionerEarnings.ts`
- `server/src/routes/insuranceProvisions.ts`
- `server/src/routes/tasks.ts`
- `server/src/routes/treatmentCases.ts`
- `server/src/routes/notifications.ts`
- `server/src/routes/users.ts`
- `server/src/routes/patients.ts`

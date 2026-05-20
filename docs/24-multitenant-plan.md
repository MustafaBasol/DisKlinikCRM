# Multi-Tenant Yapıya Geçiş Planı

**Hazırlanma Tarihi:** 2026-05-20  
**Hedef:** Tek klinik (single-tenant) sistemini tam anlamıyla multi-tenant SaaS platformuna dönüştürmek.

---

## Uygulama Takip Tablosu

### Sprint 1 — Kritik Altyapı
- [x] `Clinic.status`, `Clinic.slug`, `Clinic.trialEndsAt`, `Clinic.maxUsers`, `Clinic.maxPatients` alanları ekle
- [x] `User.email @unique` → `@@unique([clinicId, email])` migration
- [x] `PlatformAdmin` modeli ekle
- [x] `Plan` modeli ekle
- [x] `ClinicInvitation` modeli ekle
- [x] Prisma db push çalıştır (`prisma migrate dev` shadow DB yetkisi gerektirdiğinden `db push` kullanıldı)
- [x] Auth middleware: klinik status kontrolü (in-memory cache ile)

### Sprint 2 — Platform Admin API
- [x] `server/src/middleware/platformAuth.ts` oluştur
- [x] `server/src/routes/platformAdmin.ts` oluştur (klinik CRUD + istatistikler)
- [x] `server/src/index.ts` platform route'larını kaydet

### Sprint 3 — Onboarding & Plan Yönetimi
- [x] Plan seed verisi ekle (starter, professional, enterprise)
- [x] PlatformAdmin seed verisi ekle
- [x] `server/src/routes/clinicRegistration.ts` oluştur
- [x] `server/src/middleware/planLimits.ts` oluştur
- [x] `users` ve `patients` POST route'larına limit middleware ekle

### Sprint 4 — İzolasyon & Güvenlik
- [x] `server/src/utils/tenantGuard.ts` yardımcı fonksiyon oluştur
- [x] Dosya upload'ları klinik bazında dizine taşı (`uploads/:clinicId/`)
- [x] `server/src/routes/gdprExport.ts` — `GET /api/clinic/export-data` GDPR endpoint'i
- [x] Auth middleware'deki `findUnique(email)` → `findFirst` düzeltmesi (email artık per-clinic)

### Sprint 5 — Frontend
- [x] Klinik kayıt sayfası (`/register`) — `src/pages/Register.tsx`
- [x] Platform admin paneli (`/platform`) — `src/pages/PlatformAdmin.tsx`
- [x] `src/App.tsx` route'larına eklendi

---

---

## Mevcut Durumun Analizi

### ✅ Zaten Var (Sağlam Temel)
| Unsur | Durum |
|-------|-------|
| `Clinic` modeli tüm entity'lere bağlı | ✅ |
| Her entity'de `clinicId` alanı mevcut | ✅ |
| JWT token içinde `clinicId` taşınıyor | ✅ |
| Tüm route'lar `clinicId` ile filtreliyor | ✅ |
| Public booking `:clinicId` param kullanıyor | ✅ |
| `Setting` tablosunda `@@unique([clinicId, key])` | ✅ |

### ❌ Eksik / Düzeltilmesi Gereken

| Sorun | Etki | Öncelik |
|-------|------|---------|
| `User.email` globally `@unique` — aynı e-posta farklı kliniklerde kullanılamıyor | Yeni klinik kaydında çakışma | 🔴 Kritik |
| Platform düzeyinde SuperAdmin rolü yok | Klinikleri yönetecek operatör yok | 🔴 Kritik |
| `Clinic.status` alanı yok (aktif/askıya alınmış/deneme) | Klinik erişim kontrolü yapılamıyor | 🔴 Kritik |
| `Clinic.slug` yok (subdomain/URL routing için) | Her klinik için özel URL oluşturulamıyor | 🟠 Yüksek |
| Abonelik/plan modeli yok | Faturalandırma yapılamıyor | 🟠 Yüksek |
| Klinik kayıt (self-service onboarding) akışı yok | Yeni klinik ekleme yolu yok | 🟠 Yüksek |
| Platform admin API (`/api/superadmin/...`) yok | Klinikler yönetilemiyor | 🟠 Yüksek |
| Dosya yüklemeleri klinik bazında ayrılmıyor | `/uploads/` herkese açık | 🟡 Orta |
| WhatsApp webhook tek instance, klinik izolasyonu kısmi | Karışık mesaj akışı riski | 🟡 Orta |
| GDPR: klinik bazında veri export/silme yok | Yasal uyumsuzluk riski | 🟡 Orta |
| Rate limiting klinik bazında değil | Bir klinik diğerini etkileyebilir | 🟡 Orta |

---

## Mimari Karar: Tenant İzolasyon Stratejisi

**Seçilen Yaklaşım: Shared Database + Row-Level Isolation (mevcut yaklaşım devam)**

Her entity'de `clinicId` foreign key ile izolasyon sağlanmakta. Bu yapı MVP için yeterlidir.  
Gelecekte çok büyük ölçek gerekirse "schema-per-tenant" veya "database-per-tenant" geçiş yapılabilir.

**Tenant Tanımlama Yöntemi:**
- Mobil/web app: JWT token içindeki `clinicId`
- API istekleri: Authorization header → JWT decode
- Public endpoints: URL parametresi `/:clinicId/...`
- WhatsApp webhook: Evolution API instance başına klinik eşleştirmesi

---

## Faz 1 — Veritabanı & Auth Temeli (Backend)

### 1.1 Schema Değişiklikleri

**a) `Clinic` modeline yeni alanlar ekle:**
```prisma
model Clinic {
  // Mevcut alanlar...
  slug        String   @unique              // URL routing: "dis-klinik-a"
  status      String   @default("trial")    // trial | active | suspended | cancelled
  planId      String?                       // Abonelik planı referansı
  plan        Plan?    @relation(fields: [planId], references: [id])
  trialEndsAt DateTime?                     // Deneme süresi bitiş tarihi
  maxUsers    Int      @default(5)          // Plan limiti
  maxPatients Int      @default(500)        // Plan limiti
}
```

**b) `User.email` unique constraint'ini değiştir:**
```prisma
// ÖNCE:
email String @unique

// SONRA:
email String
@@unique([clinicId, email])   // Aynı e-posta farklı kliniklerde olabilir
```
> ⚠️ Bu migration dikkatli yapılmalı: mevcut veriler kontrol edilmeli.

**c) Platform `SuperAdmin` tablosu ekle (klinik dışı):**
```prisma
model PlatformAdmin {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**d) `Plan` (Abonelik Planı) modeli ekle:**
```prisma
model Plan {
  id          String   @id @default(uuid())
  name        String   @unique  // "starter" | "professional" | "enterprise"
  displayName String
  maxUsers    Int
  maxPatients Int
  features    Json     // { whatsapp: true, reports: true, ... }
  monthlyPrice Decimal @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  clinics     Clinic[]
}
```

**e) `ClinicInvitation` modeli ekle (kullanıcı davet sistemi):**
```prisma
model ClinicInvitation {
  id        String   @id @default(uuid())
  clinicId  String
  clinic    Clinic   @relation(fields: [clinicId], references: [id])
  email     String
  role      String
  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
}
```

---

### 1.2 Auth Middleware Güncellemesi

**a) Platform admin için ayrı JWT issuer:**
```typescript
// server/src/middleware/platformAuth.ts (YENİ DOSYA)
export const authenticatePlatformAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, PLATFORM_JWT_SECRET);
  if (decoded.type !== 'platform_admin') return res.status(403).json({ error: 'Forbidden' });
  req.platformAdmin = { id: decoded.id };
  next();
};
```

**b) `authenticate` middleware'ine klinik status kontrolü ekle:**
```typescript
// auth.ts middleware içinde, token doğrulandıktan sonra:
const clinic = await prisma.clinic.findUnique({ where: { id: decoded.clinicId } });
if (!clinic || clinic.status === 'suspended') {
  return res.status(403).json({ error: 'Clinic access suspended' });
}
req.user = { id: decoded.id, clinicId: decoded.clinicId, role: decoded.role };
```
> Not: Her istekte DB sorgusu yük getirir. Cache (Redis veya in-memory TTL) kullanımı önerilir.

---

### 1.3 Yeni Platform Admin API Endpoint'leri

**Dosya:** `server/src/routes/platformAdmin.ts` (YENİ)

```
POST   /api/platform/auth/login          → Platform admin giriş
GET    /api/platform/clinics             → Tüm klinikleri listele
POST   /api/platform/clinics             → Yeni klinik oluştur (manuel)
GET    /api/platform/clinics/:id         → Klinik detayı
PATCH  /api/platform/clinics/:id/status  → Aktif/askıya al
GET    /api/platform/clinics/:id/stats   → Klinik istatistikleri
GET    /api/platform/plans               → Plan listesi
POST   /api/platform/plans               → Yeni plan oluştur
GET    /api/platform/stats               → Genel platform istatistikleri
```

**Middleware:**
```typescript
app.use('/api/platform', authenticatePlatformAdmin);
app.use('/api/platform', platformAdminRoutes);
```

---

### 1.4 Klinik Self-Service Onboarding Endpoint'leri

**Dosya:** `server/src/routes/clinicRegistration.ts` (YENİ)

```
POST /api/register/clinic   → Klinik + ilk admin kullanıcı oluştur (public)
POST /api/register/verify   → E-posta doğrulama
GET  /api/register/check-slug/:slug → Slug müsait mi?
```

**İş akışı:**
1. POST ile klinik adı, slug, admin e-posta + şifre gönderilir
2. Klinik `status: "trial"`, `trialEndsAt: now + 14 gün` olarak oluşturulur
3. Doğrulama e-postası gönderilir
4. E-posta onaylanınca klinik `status: "active"` olur

---

## Faz 2 — Veri İzolasyonu Güçlendirmesi

### 2.1 Tüm Route'ların Güvenlik Denetimi

Her route için kontrol listesi:

```
✅ clinicId her zaman req.user!.clinicId'den alınıyor mu?
✅ findUnique/findFirst sorgularında { id, clinicId } birlikte mi?
✅ Başka klinik verisi query string ile enjekte edilemiyor mu?
✅ İlişkili entity'lerin clinicId'si eşleşiyor mu? (örn. appointment.patientId ait klinik)
```

**Önerilen yardımcı fonksiyon:**
```typescript
// server/src/utils/tenantGuard.ts (YENİ)
export async function findOwnedOrFail<T>(
  model: any,
  id: string,
  clinicId: string,
  include?: object
): Promise<T> {
  const record = await model.findFirst({ where: { id, clinicId }, include });
  if (!record) throw new NotFoundError(`Resource not found or access denied`);
  return record;
}
```

### 2.2 Dosya Yüklemelerinin İzolasyonu

**Mevcut:** `/uploads/` (tüm klinikler aynı dizin)  
**Hedef:** `/uploads/:clinicId/` (klinik bazında ayrılmış dizin)

```typescript
// server/src/routes/attachments.ts içinde:
const uploadDir = path.join('uploads', req.user!.clinicId);
fs.mkdirSync(uploadDir, { recursive: true });

// Static file serving klinik kontrolü ile:
app.get('/uploads/:clinicId/:filename', authenticate, (req, res) => {
  if (req.user!.clinicId !== req.params.clinicId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // dosyayı sun
});
```

### 2.3 WhatsApp Multi-Tenant İzolasyonu

**Mevcut durum:** Webhook tek endpoint, klinik eşleşmesi `clinicId` parametresiyle yapılıyor.

**Önerilen:** Her klinik kendi Evolution API instance'ını veya aynı instance üzerinde farklı instance adını kullanır.

```typescript
// Webhook URL yapısı:
// POST /api/public/whatsapp/:clinicId/webhook

// WhatsApp config klinik bazında Setting tablosunda:
// Setting { key: 'whatsapp_instance', value: 'clinic-a-instance', clinicId }
// Setting { key: 'whatsapp_api_key',  value: '***', clinicId }
```

---

## Faz 3 — Plan & Limit Yönetimi

### 3.1 Klinik Limit Kontrolü Middleware'i

```typescript
// server/src/middleware/planLimits.ts (YENİ)

export const checkUserLimit = async (req: AuthRequest, res, next) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: req.user!.clinicId },
    include: { plan: true, _count: { select: { users: true } } }
  });
  const maxUsers = clinic?.plan?.maxUsers ?? clinic?.maxUsers ?? 5;
  if (clinic!._count.users >= maxUsers) {
    return res.status(402).json({ error: 'User limit reached for your plan' });
  }
  next();
};

export const checkPatientLimit = async (req: AuthRequest, res, next) => {
  // benzer şekilde hasta limiti kontrolü
};
```

**Kullanım:**
```typescript
router.post('/users', authorize(['admin']), checkUserLimit, async (req, res) => { ... });
```

### 3.2 Plan Özellikleri (Feature Flags)

```typescript
// Plan.features JSON alanı kullanımı:
// { "whatsapp": true, "reports": true, "compensation": false }

export const requireFeature = (feature: string) => async (req: AuthRequest, res, next) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: req.user!.clinicId },
    include: { plan: true }
  });
  const features = clinic?.plan?.features as Record<string, boolean> ?? {};
  if (!features[feature]) {
    return res.status(402).json({ error: `Feature '${feature}' not available in your plan` });
  }
  next();
};
```

---

## Faz 4 — Frontend Değişiklikleri

### 4.1 Tenant URL Routing

**Seçenek A — Subdomain (Önerilen Production):**
```
https://dis-klinik-a.platform.com  →  clinicSlug = "dis-klinik-a"
https://dis-klinik-b.platform.com  →  clinicSlug = "dis-klinik-b"
```

**Seçenek B — Path prefix (Development/MVP için daha kolay):**
```
https://platform.com/c/dis-klinik-a/dashboard
https://platform.com/c/dis-klinik-b/dashboard
```

**Seçenek C — Mevcut yapı korunur, sadece JWT klinik bağlantısı (En az değişim):**  
Giriş yapan kullanıcı sadece kendi kliniğini görür. Ek routing değişikliği gerekmez.  
→ **MVP için Seçenek C önerilir.**

### 4.2 Platform Admin Paneli (Yeni React Sayfaları)

```
/platform/login              → Platform admin giriş
/platform/dashboard          → Genel istatistikler (toplam klinik, kullanıcı, randevu)
/platform/clinics            → Klinik listesi
/platform/clinics/new        → Yeni klinik oluştur
/platform/clinics/:id        → Klinik detayı + stats
/platform/clinics/:id/users  → Klinik kullanıcıları
/platform/plans              → Plan yönetimi
```

### 4.3 Klinik Kaydı Sayfası

```
/register                    → Klinik adı, slug, admin e-posta, şifre formu
/register/verify             → E-posta doğrulama
```

### 4.4 Çoklu Klinik Desteği (Gelecek)

Bir kullanıcının birden fazla klinikte hesabı olduğunda:
- Login sonrası klinik seçim ekranı
- JWT'de birden fazla `clinicId` veya klinik değiştirme mekanizması

---

## Faz 5 — Operasyonel & Güvenlik

### 5.1 Rate Limiting (Klinik Bazında)

```typescript
import rateLimit from 'express-rate-limit';

// Mevcut: IP bazlı
// Hedef: clinicId bazlı
const clinicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req: AuthRequest) => req.user?.clinicId ?? req.ip,
  message: 'Too many requests from this clinic',
});

app.use('/api', authenticate, clinicRateLimit);
```

### 5.2 GDPR — Klinik Bazında Veri Export & Silme

**Yeni endpoint'ler:**
```
GET  /api/clinic/export-data   → Tüm klinik verisini JSON/CSV olarak indir
POST /api/platform/clinics/:id/delete-data → Platform admin: klinik verisini kalıcı sil
```

**Silme sırası (cascade):**
1. `SentMessage`, `ActivityLog`, `Notification`
2. `Payment`, `PaymentPlan`, `PractitionerEarning`
3. `Appointment`, `Task`, `TreatmentCase`
4. `Patient`, `User`
5. `Clinic` kaydı

### 5.3 Audit Log Güçlendirmesi

`ActivityLog` tablosu zaten mevcut. Multi-tenant için ek öneriler:
- Platform admin işlemlerini ayrı bir `PlatformAuditLog` tablosunda tut
- Klinik status değişikliklerini (`active` → `suspended`) kaydet
- IP adresi ve user-agent de log'a ekle

### 5.4 Veritabanı Yedekleme (Per-Clinic)

Klinik bazında yedekleme betiği:
```bash
# Belirli bir kliniğin verilerini export et:
pg_dump --schema-only health_crm > schema.sql
psql -c "COPY (SELECT * FROM patients WHERE clinic_id='XXX') TO '/backup/clinic-XXX/patients.csv' CSV HEADER;"
```

---

## Uygulama Öncelik Sırası

### Sprint 1 — Kritik Altyapı (1-2 hafta)
- [ ] `Clinic.status` ve `Clinic.slug` alanları ekle (migration)
- [ ] `User.email` unique constraint'ini `@@unique([clinicId, email])` yap
- [ ] `PlatformAdmin` modeli ekle
- [ ] Platform admin JWT middleware
- [ ] Klinik status kontrolü auth middleware'e ekle

### Sprint 2 — Platform Admin API (1 hafta)
- [ ] `platformAdmin.ts` route dosyası
- [ ] Klinik CRUD endpoint'leri
- [ ] Klinik istatistik endpoint'i
- [ ] Platform admin login endpoint'i

### Sprint 3 — Onboarding & Plan Yönetimi (1-2 hafta)
- [ ] `Plan` modeli ve seed verisi
- [ ] `clinicRegistration.ts` route dosyası
- [ ] Slug kontrolü endpoint'i
- [ ] Plan limit middleware'leri
- [ ] Feature flag middleware'i

### Sprint 4 — Frontend (2 hafta)
- [ ] Klinik kayıt sayfası (`/register`)
- [ ] Platform admin paneli (`/platform/...`)
- [ ] Klinik seçim ekranı (çoklu klinik kullanıcıları için)

### Sprint 5 — İzolasyon & Güvenlik (1 hafta)
- [ ] Dosya upload klinik bazında dizin
- [ ] Route güvenlik denetimi (tüm 24 route dosyası)
- [ ] Rate limiting klinik bazında
- [ ] GDPR export/silme endpoint'leri
- [ ] WhatsApp per-clinic konfigürasyonu

---

## Migration Notları

### `User.email` Unique Constraint Değişimi

Bu kritik bir migration'dır. Adımlar:

```sql
-- 1. Mevcut duplicate kontrol:
SELECT email, COUNT(*) FROM "User" GROUP BY email HAVING COUNT(*) > 1;

-- 2. Eski constraint kaldır:
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";

-- 3. Yeni composite unique ekle:
CREATE UNIQUE INDEX "User_clinicId_email_key" ON "User"("clinicId", "email");
```

Prisma migration dosyasına manuel SQL eklenebilir:
```prisma
// schema.prisma
model User {
  email    String
  // @unique kaldırıldı
  @@unique([clinicId, email])
}
```

### `Clinic.slug` Populate Mevcut Veri

```sql
-- Mevcut kliniklere slug ekle (name'den türetilmiş):
UPDATE "Clinic" SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]', '-', 'g'))
WHERE slug IS NULL;
```

---

## Test Senaryoları

### Multi-Tenant İzolasyon Testleri

```typescript
describe('Tenant Isolation', () => {
  it('Klinik A kullanıcısı Klinik B hastasını göremez', async () => {
    const tokenA = loginAs(clinicA.adminUser);
    const patientB = await createPatient(clinicB.id);
    const res = await GET(`/api/patients/${patientB.id}`, tokenA);
    expect(res.status).toBe(404); // NOT 200
  });

  it('Klinik A kullanıcısı Klinik B randevusunu güncelleyemez', async () => {
    const tokenA = loginAs(clinicA.adminUser);
    const apptB = await createAppointment(clinicB.id);
    const res = await PATCH(`/api/appointments/${apptB.id}`, { status: 'cancelled' }, tokenA);
    expect(res.status).toBe(404);
  });

  it('Askıya alınmış klinik kullanıcısı giriş yapamaz', async () => {
    await suspendClinic(clinicA.id);
    const res = await POST('/api/auth/login', clinicA.adminUser.credentials);
    expect(res.status).toBe(403);
  });
});
```

---

## Sonraki Adım Önceliği

Hemen başlanabilecek en kritik 3 değişiklik:

1. **`server/prisma/schema.prisma`** — `Clinic.status`, `Clinic.slug`, `User.email @unique` → `@@unique([clinicId, email])`, `PlatformAdmin` modeli ekle
2. **`server/src/middleware/auth.ts`** — Klinik status kontrolü ekle
3. **`server/src/routes/platformAdmin.ts`** — Platform admin CRUD endpoint'leri

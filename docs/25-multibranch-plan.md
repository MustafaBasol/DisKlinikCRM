# Multi-Branch / Multi-Location Destek Planı

**Hazırlanma Tarihi:** 2026-05-20  
**Bağlı Döküman:** `docs/24-multitenant-plan.md` (Sprint 1-5 tamamlandı)  
**Hedef:** Tek klinik (şube) sistemini, bir dental grubun birden fazla fiziksel şubesini yönetebileceği **Organization → Clinic Branch** hiyerarşisine geçirmek.

---

## Uygulama Takip Tablosu

### Sprint 1 — Schema Değişiklikleri (Phase 1a: Nullable Alanlar)
- [x] `Organization` modeli ekle
- [x] `Clinic` modeline `organizationId String?` ekle (nullable; backfill sonrası NOT NULL yapılacak)
- [x] `Clinic.slug` field-level `@unique` kaldır — **staged:** önce backfill, sonra `@@unique([organizationId, slug])`
- [x] `User` modeline `organizationId String?`, `defaultClinicId String?`, `canAccessAllClinics Boolean` ekle
- [x] `User.clinicId` yetkilendirmede KULLANILMAZ — sadece `defaultClinicId` amacıyla korunur
- [x] `User.@@unique([clinicId, email])` **korunur** Phase 1a'da; Phase 1b'de `@@unique([organizationId, email])` yapılır
- [x] `UserClinic` membership modeli ekle (roller: OWNER \| ORG_ADMIN \| CLINIC_MANAGER \| DENTIST \| RECEPTIONIST \| BILLING \| ASSISTANT)
- [x] `Patient` modeline `organizationId String?`, `primaryClinicId String?` ekle
- [x] `PatientClinic` ilişki tablosu ekle (çok-şubeli ziyaret geçmişi için)
- [x] `ClinicInvitation` modeline `organizationId String?` ekle
- [x] `InventoryItem` modeline `organizationId String?` ekle
- [x] `Plan` modeline `organizations Organization[]` back-relation ekle
- [x] `Organization.planId` ekle; **aşamalı plan migrasyonu:** Clinic.planId → Organization.planId backfill → validasyon → sonra Clinic.planId deprecated
- [x] `prisma db push` çalıştır — Phase 1a (nullable alanlar + yeni tablolar)

### Sprint 2 — Data Migration (Phase 1b: Backfill + NOT NULL)
- [x] Migration script çalıştır: `server/src/scripts/migrate-to-multibranch.ts`
  - [x] Mevcut her Clinic için Organization oluştur
  - [x] Clinic.slug null ise otomatik üret, sonra backfill
  - [x] Organization.planId ← Clinic.planId kopyala
  - [x] Clinic.organizationId backfill
  - [x] User.organizationId, defaultClinicId, canAccessAllClinics backfill
  - [x] UserClinic kayıtları oluştur
  - [x] Patient.organizationId, primaryClinicId backfill
  - [x] PatientClinic kayıtları oluştur
  - [x] ClinicInvitation.organizationId backfill
  - [x] InventoryItem.organizationId backfill
- [x] Doğrulama SQL'leri çalıştır (`SELECT COUNT(*) WHERE organizationId IS NULL` → 0)
- [x] Schema Phase 1b: `organizationId String?` → `organizationId String` (NOT NULL)
- [x] Schema Phase 1b: `User.@@unique([clinicId, email])` → `@@unique([organizationId, email])`
- [x] Schema Phase 1b: `Clinic.slug` non-null + `@@unique([organizationId, slug])` ekle
- [x] `prisma db push` çalıştır — Phase 1b (NOT NULL + constraint değişimleri)
- [x] Üretim için SQL adımları dokümante edildi (bkz. aşağıdaki Migration Notları)

### Sprint 3 — Auth / JWT Genişletme
- [x] `generateToken` fonksiyonunu güncelle: payload'a `organizationId`, `allowedClinicIds`, `canAccessAllClinics` ekle
- [x] `AuthRequest` tipini güncelle: `organizationId`, `allowedClinicIds`, `canAccessAllClinics` alanları
- [x] `authenticate` middleware'ini güncelle: `organizationId` doğrulaması + klinik erişim kontrolü
- [x] `GET /api/me` endpoint'i oluştur: kullanıcının organizasyon, klinikler ve izinlerini döndür
- [x] `auth.ts` login route'unu güncelle: token oluşturmadan önce `UserClinic` listesini çek

### Sprint 4 — Backend Klinik Kapsam Yardımcısı
- [x] `server/src/utils/clinicScope.ts` oluştur: `buildClinicScopeWhere(user, selectedClinicId)` helper
- [x] `server/src/middleware/clinicAccess.ts` oluştur: `requireClinicAccess` ve `requireSpecificClinicAccess` middleware
- [x] `patients.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] `appointments.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] `payments.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] `treatmentCases.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] `tasks.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] `dashboard.ts` route'unu güncelle: `selectedClinicId` desteği ekle
- [x] `reports.ts` route'unu güncelle: `clinicScope` helper kullan
- [x] Diğer route'lar (messages, inventory, paymentPlans, vb.): `clinicScope` ekle

### Sprint 5 — Organization Dashboard Backend
- [x] `server/src/routes/organizationDashboard.ts` oluştur
- [x] `GET /api/organization/dashboard?range=this_month` endpoint'i
- [x] Endpoint güvenliği: yalnızca `OWNER` / `ORG_ADMIN` erişimi
- [x] Her şube için performans metrikleri sorgula (randevu, gelir, hasta, no-show)
- [x] Agregasyon özet kartları (tüm şubeler toplamı)
- [x] İçgörü (insights) hesaplama: en iyi/en düşük şube
- [x] `server/src/index.ts`'e yeni route'u kaydet

### Sprint 6 — Frontend Bağlam ve ClinicSwitcher ✅
- [x] `src/context/ClinicContext.tsx` oluştur: `selectedClinicId`, `setSelectedClinicId`, `availableClinics`
- [x] `src/components/ClinicSwitcher.tsx` oluştur: üst bar clinic dropdown
- [x] `src/layouts/MainLayout.tsx` güncelle: `ClinicProvider` sarmala + `ClinicSwitcher` ekle
- [x] `src/App.tsx` güncelle: `ClinicProvider` ekle + `/organization/dashboard` route'u
- [x] `src/services/api.ts` güncelle: her isteğe `selectedClinicId` query param otomatik ekle
- [x] `localStorage` senkronizasyonu: `selectedClinicId` persist et (`hcrm_clinic_id`)

### Sprint 7 — Organization Dashboard Frontend ✅
- [x] `src/pages/OrganizationDashboard.tsx` oluştur
- [x] Özet kartlar (toplam şube, randevu, gelir, bakiye, hasta, aktif plan)
- [x] Şube karşılaştırma tablosu (klinik bazında metrikler yan yana)
- [x] İçgörü kartları (en iyi / en düşük şube)
- [x] Tarih aralığı filtresi (bugün, bu hafta, bu ay, son 30 gün)
- [x] Her satırda hızlı eylem linkleri (o klinik görünümünü aç)
- [x] Boş durum ve hata durumu yönetimi

### Sprint 8 — Frontend Modül Güncellemeleri ✅
- [x] `src/pages/Patients.tsx`: `useClinic` ekle; `selectedClinicId` değişince yeniden çek; çok şube görünümünde şube rozeti
- [x] `src/pages/Appointments.tsx`: `useClinic` ekle; `selectedClinicId` bağımlılığı eklendi
- [x] `src/pages/Payments.tsx`: `useClinic` ekle; `selectedClinicId` bağımlılığı eklendi
- [x] `src/pages/Tasks.tsx`: `useClinic` ekle; `selectedClinicId` bağımlılığı eklendi
- [x] `src/pages/TreatmentCases.tsx`: `useClinic` ekle; `selectedClinicId` bağımlılığı eklendi
- [x] `src/pages/Dashboard.tsx`: `useClinic` ekle; `selectedClinicId` değişince yeniden çek
- [x] `src/pages/Reports.tsx`: `useClinic` ekle; `selectedClinicId` değişince yeniden çek
- [x] `src/pages/Inventory.tsx`: `useClinic` ekle; `selectedClinicId` bağımlılığı eklendi

### Sprint 9 — Doğrulama & Temizlik
- [x] Backend TypeScript derleme: `cd server && npx tsc --noEmit` → 0 hata
- [x] Frontend TypeScript derleme: `cd .. && npx tsc --noEmit` → 0 hata
- [x] Tenant izolasyon testi: Klinik A kullanıcısı Klinik B verisini göremez
- [x] Çapraz organizasyon sızıntı testi: farklı organizasyonlar birbirini göremez
- [x] `selectedClinicId=all` tüm modüllerde doğru çalışıyor
- [x] Yetkisiz klinik erişimi `403` döndürüyor
- [x] Mevcut tek klinik iş akışı hâlâ çalışıyor (geriye dönük uyumluluk)

---

---

## Mevcut Durum Analizi

### Mevcut Hiyerarşi
```
PostgreSQL DB
  → Clinic (tek tenant birimi)
       → User (clinicId FK)
       → Patient (clinicId FK)
       → Appointment, Payment, Task... (clinicId FK)
```

### Hedef Hiyerarşi
```
Platform (PlatformAdmin yönetir)
  → Organization (Dental Grup / Şirket)
       → Clinic Branch A  (organizationId FK)
       → Clinic Branch B  (organizationId FK)
       → User (organizationId FK + UserClinic üyelik tablosu)
       → Patient (organizationId FK, primaryClinicId FK)
       → Appointment, Payment, Task... (clinicId FK — değişmez)
```

### Ne Değişmez
- Randevu, ödeme, görev, tedavi gibi operasyonel entity'ler **klinik bazında** kalır.
- Her operasyonel kayıtta `clinicId` FK'si korunur.
- Plan (abonelik) **organizasyon** düzeyine taşınır, klinik düzeyinden kaldırılır.

### Kritik Zorunluluklar
| Madde | Açıklama |
|-------|----------|
| Mevcut veri korunmalı | Hiçbir kayıt silinmemeli, sadece yeni alanlar eklenmeli |
| Geriye dönük uyumluluk | Tek klinikli kullanıcı için uygulama aynen çalışmalı |
| Organizasyon sızıntısı önlenmeli | Farklı organizasyonların verileri asla karışmamalı |
| `prisma db push` kullanılacak | `crm_user`'ın shadow DB yetkisi yok, `migrate dev` çalışmaz |

---

## Sprint 1 — Prisma Schema Değişiklikleri (Detaylı)

### 1.1 Yeni `Organization` Modeli

```prisma
model Organization {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique         // platform genelinde benzersiz
  status      String   @default("trial") // trial | active | suspended | cancelled
  planId      String?
  plan        Plan?    @relation(fields: [planId], references: [id])
  trialEndsAt DateTime?
  ownerId     String?                  // ilk kurucu kullanıcının id'si (ref: User)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  clinics      Clinic[]
  users        User[]
  patients     Patient[]
  invitations  ClinicInvitation[]
}
```

> **Not:** `Plan` modeli artık `Clinic` → `Plan` yerine `Organization` → `Plan` ilişkisi kurar.  
> `Clinic.planId` ve `Clinic.plan` alanları kaldırılır, `Organization.planId` kullanılır.

### 1.2 `Clinic` Modeli Güncellemesi

Eklenecek alanlar:
```prisma
organizationId String
organization   Organization @relation(fields: [organizationId], references: [id])
```

Değiştirilecek alanlar:
```prisma
// ÖNCE:
slug String? @unique

// SONRA:
slug String?
@@unique([organizationId, slug])   // organizasyon içinde benzersiz
```

Kaldırılacak alanlar:
```prisma
// Kaldır — plan organizasyon düzeyine taşınıyor:
planId String?
plan   Plan?   @relation(...)
// maxUsers ve maxPatients de kaldırılabilir (Organization'dan okunacak)
// Ancak MVP'de korunabilir, geriye dönük uyumluluk için nullable bırakılır.
```

### 1.3 `User` Modeli Güncellemesi

Eklenecek alanlar:
```prisma
organizationId   String
organization     Organization @relation(fields: [organizationId], references: [id])
defaultClinicId  String?      // kullanıcının varsayılan/favori klinik şubesi
defaultClinic    Clinic?      @relation("UserDefaultClinic", fields: [defaultClinicId], references: [id])
canAccessAllClinics Boolean   @default(false) // OWNER/ORG_ADMIN için true
```

Değiştirilecek unique constraint:
```prisma
// ÖNCE:
@@unique([clinicId, email])

// SONRA:
@@unique([organizationId, email])
```

> **Not:** `clinicId` alanı `User`'da nullable olabilir — kullanıcı artık birden fazla klinikle `UserClinic` üzerinden ilişkilendirilir. Ancak geriye dönük uyumluluk için nullable tutulabilir:  
> `clinicId String?  @map("legacy_clinic_id")`  
> MVP için `clinicId` alanı korunur ama `organizationId` zorunlu olur.

### 1.4 Yeni `UserClinic` Modeli

```prisma
model UserClinic {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  clinicId  String
  clinic    Clinic   @relation(fields: [clinicId], references: [id])
  role      String   // OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING | ASSISTANT
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, clinicId])
  @@index([clinicId, isActive])
  @@index([userId, isActive])
}
```

### 1.5 `Patient` Modeli Güncellemesi

Eklenecek alanlar:
```prisma
organizationId  String
organization    Organization @relation(fields: [organizationId], references: [id])
primaryClinicId String?
primaryClinic   Clinic?      @relation("PatientPrimaryClinic", fields: [primaryClinicId], references: [id])
```

> Hasta, organizasyona aittir. Randevu klinik bazında olsa bile hasta kaydı tüm şubelerde görünür.  
> `primaryClinicId`: hastanın genellikle tedavi gördüğü şube (isteğe bağlı).

### 1.6 `ClinicInvitation` Modeli Güncellemesi

Eklenecek alan:
```prisma
organizationId String
organization   Organization @relation(fields: [organizationId], references: [id])
```

### 1.7 `InventoryItem` Modeli Güncellemesi

Eklenecek alan:
```prisma
organizationId String?
organization   Organization? @relation(fields: [organizationId], references: [id])
```

> Ürün tanımı (`InventoryItem`) organizasyon genelinde paylaşılır.  
> Stok miktarı klinik bazında `InventoryTransaction` üzerinden yönetilir.  
> `clinicId` FK korunur (klinik bazında işlemler için).

### 1.8 `Plan` Modeli Güncellemesi

```prisma
model Plan {
  // Mevcut alanlar korunur
  organizations Organization[]   // Clinic[] yerine
}
```

---

## Sprint 2 — Data Migration SQL (Detaylı)

Tüm migration adımları destructive DEĞİLDİR. Sadece yeni alanlar doldurulur.

### 2.1 Varsayılan Organization Oluştur

`server/prisma/seed.ts` içine eklenecek (veya ayrı bir migration betiği):

```typescript
// Mevcut tek klinik için varsayılan organizasyon
const existingClinic = await prisma.clinic.findFirst();
if (existingClinic) {
  const org = await prisma.organization.upsert({
    where: { slug: existingClinic.slug ?? 'default-org' },
    update: {},
    create: {
      name: existingClinic.name,
      slug: existingClinic.slug ?? 'default-org',
      status: existingClinic.status,
      planId: existingClinic.planId,
      trialEndsAt: existingClinic.trialEndsAt,
    },
  });

  // Klinik organizasyona bağla
  await prisma.clinic.update({
    where: { id: existingClinic.id },
    data: { organizationId: org.id },
  });

  // Kullanıcıları organizasyona bağla ve UserClinic kayıtları oluştur
  const users = await prisma.user.findMany({ where: { clinicId: existingClinic.id } });
  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: org.id },
    });
    await prisma.userClinic.upsert({
      where: { userId_clinicId: { userId: user.id, clinicId: existingClinic.id } },
      update: {},
      create: { userId: user.id, clinicId: existingClinic.id, role: user.role },
    });
  }

  // Hastaları organizasyona bağla
  await prisma.patient.updateMany({
    where: { clinicId: existingClinic.id },
    data: { organizationId: org.id, primaryClinicId: existingClinic.id },
  });
}
```

### 2.2 Kritik Migration Notları

| Adım | SQL (Gerekirse Manuel Çalıştır) |
|------|--------------------------------|
| `Clinic.organizationId` NOT NULL kısıtı | Önce alanı nullable ekle, backfill yap, sonra NOT NULL'a çevir |
| `User.organizationId` NOT NULL kısıtı | Aynı yaklaşım |
| `User.@@unique([organizationId, email])` | Önce `@@unique([clinicId, email])` constraint'ini kaldır, yenisini ekle |
| `Patient.organizationId` | Tüm hastaları güncelle |

```sql
-- organizationId backfill kontrol sorgusu (migration sonrası doğrulama):
SELECT COUNT(*) FROM "Clinic" WHERE "organizationId" IS NULL;
SELECT COUNT(*) FROM "User" WHERE "organizationId" IS NULL;
SELECT COUNT(*) FROM "Patient" WHERE "organizationId" IS NULL;
-- Tüm sonuçlar 0 olmalı
```

---

## Sprint 3 — Auth / JWT Genişletme (Detaylı)

### 3.1 Güncellenmiş `AuthRequest` Tipi

```typescript
// server/src/middleware/auth.ts
export interface AuthRequest extends Request {
  user?: {
    id: string;
    organizationId: string;      // YENİ
    clinicId: string;            // Geriye dönük uyumluluk için korunur (defaultClinicId)
    allowedClinicIds: string[];  // YENİ: erişebildiği tüm klinik id'leri
    canAccessAllClinics: boolean; // YENİ: OWNER/ORG_ADMIN
    role: string;
  };
}
```

### 3.2 Güncellenmiş `generateToken`

```typescript
export const generateToken = (user: {
  id: string;
  organizationId: string;
  clinicId: string;             // defaultClinicId — sadece UI varsayılanı, YETKİLENDİRME DEĞİL
  allowedClinicIds: string[];   // Boş dizi ASLA "hepsine erişim" anlamına GELMEZ
  canAccessAllClinics: boolean; // true ise allowedClinicIds göz ardı edilir
  role: string;
}) => {
  return jwt.sign(
    {
      id: user.id,
      organizationId: user.organizationId,
      clinicId: user.clinicId,
      allowedClinicIds: user.allowedClinicIds,
      canAccessAllClinics: user.canAccessAllClinics,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};
```

> **Kritik kural:** `allowedClinicIds = []` **asla "tüm kliniklere erişim"** anlamına gelmez.  
> `canAccessAllClinics = true` ise organizasyon altındaki tüm klinikler DB'den resolve edilir.  
> Eğer `canAccessAllClinics = false` ve `allowedClinicIds = []` ise → sıfır klinik erişimi.  
> JWT boyutu: çoğu personel için 1-5 id. 10+ klinik için `/api/me`'ye taşı.

### 3.3 Login Akışı Değişimi (`auth.ts` login route)

```typescript
// Login sırasında UserClinic tablosundan gerçek izin listesini çek:
const userClinics = await prisma.userClinic.findMany({
  where: { userId: user.id, isActive: true },
  select: { clinicId: true },
});
const allowedClinicIds = userClinics.map(uc => uc.clinicId);
// OWNER / ORG_ADMIN: canAccessAllClinics = true
// Diğerleri: sadece UserClinic kayıtlarındaki klinikler
const canAccessAllClinics = user.canAccessAllClinics;

const token = generateToken({
  id: user.id,
  organizationId: user.organizationId,
  clinicId: user.defaultClinicId ?? allowedClinicIds[0] ?? user.clinicId, // UI default only
  allowedClinicIds: canAccessAllClinics ? allowedClinicIds : allowedClinicIds, // her zaman gerçek liste
  canAccessAllClinics,
  role: user.role,
});
```

### 3.4 `GET /api/me` Endpoint'i

```typescript
// GET /api/me — Kullanıcı profili + erişim listesi
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      organization: { select: { id: true, name: true, slug: true, status: true } },
      userClinics: {
        where: { isActive: true },
        include: { clinic: { select: { id: true, name: true, slug: true, status: true } } },
      },
    },
  });
  return res.json(user);
});
```

### 3.5 `authenticate` Middleware Güncellemesi

```typescript
// Token decode edilince:
req.user = {
  id: decoded.id,
  organizationId: decoded.organizationId,
  clinicId: decoded.clinicId,
  allowedClinicIds: decoded.allowedClinicIds ?? [],
  canAccessAllClinics: decoded.canAccessAllClinics ?? false,
  role: decoded.role,
};

// Cache kontrolünde clinic yerine organization status kontrol edilebilir:
const orgStatus = await getOrganizationStatus(decoded.organizationId);
```

---

## Sprint 4 — Backend Klinik Kapsam Yardımcısı (Detaylı)

### 4.1 `clinicScope.ts` — Merkezi Güvenlik Filtresi

**Dosya:** `server/src/utils/clinicScope.ts`

> **Kural 1:** `buildClinicScopeWhere` her zaman `organizationId` içerir — asla sadece `clinicId` döndürmez.  
> **Kural 2:** Frontend'den gelen `selectedClinicId` asla güvenilmez; organizasyon + erişim kontrolü her zaman yapılır.  
> **Kural 3:** `canAccessAllClinics = true` ise DB'den organizasyon altındaki klinik id'leri alınır.

```typescript
import { AuthRequest } from '../middleware/auth.js';
import { Response } from 'express';
import prisma from '../db.js';

// Her zaman organizationId + (isteğe bağlı clinicId filtresi)
export type ClinicScopeWhere =
  | { organizationId: string }                          // OWNER/ORG_ADMIN, selectedClinicId=all
  | { organizationId: string; clinicId: string }        // Belirli klinik
  | { organizationId: string; clinicId: { in: string[] } }; // Birden fazla atanmış klinik

export async function buildClinicScopeWhere(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined
): Promise<ClinicScopeWhere | null> {
  const orgId = user.organizationId;

  if (!selectedClinicId || selectedClinicId === 'all') {
    if (user.canAccessAllClinics) {
      return { organizationId: orgId };
    }
    if (user.allowedClinicIds.length === 0) return null; // Erişim yok
    return { organizationId: orgId, clinicId: { in: user.allowedClinicIds } };
  }

  // Belirli klinik seçilmiş — iki kontrol:
  // 1. Klinik bu organizasyona ait mi? (DB doğrulaması)
  const clinic = await prisma.clinic.findFirst({
    where: { id: selectedClinicId, organizationId: orgId },
    select: { id: true },
  });
  if (!clinic) return null; // Başka organizasyon kliniği → 403

  // 2. Kullanıcının bu klinige erişimi var mı?
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) {
    return null; // 403
  }

  return { organizationId: orgId, clinicId: selectedClinicId };
}

export async function validateAndGetScope(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined,
  res: Response
): Promise<ClinicScopeWhere | false> {
  const scope = await buildClinicScopeWhere(user, selectedClinicId);
  if (scope === null) {
    res.status(403).json({ error: 'Access denied to requested clinic' });
    return false;
  }
  return scope;
}
```

### 4.2 `clinicAccess.ts` — Middleware Versiyonu

**Dosya:** `server/src/middleware/clinicAccess.ts`

```typescript
// Belirli bir klinike POST/PATCH/DELETE erişim kontrolü
export const requireClinicAccess = async (req: AuthRequest, res, next) => {
  const clinicId = req.body.clinicId ?? req.params.clinicId;
  if (!clinicId) return next(); // klinik gerekmiyorsa geç

  const user = req.user!;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(clinicId)) {
    return res.status(403).json({ error: 'Access denied to this clinic' });
  }
  
  // Klinik gerçekten kullanıcının organizasyonuna ait mi?
  // (DB sorgusu — gerekli durumlarda açılabilir, MVP için token kontrolü yeterli)
  next();
};
```

### 4.3 Route Güncellemeleri — Kapsam Uygulaması

Her route'da değiştirilecek pattern:

```typescript
// ÖNCE (mevcut):
const patients = await prisma.patient.findMany({
  where: { clinicId: req.user!.clinicId },
});

// SONRA:
const selectedClinicId = req.query.clinicId as string | undefined;
const scope = validateAndGetScope(req.user!, selectedClinicId, res);
if (scope === false) return;

const patients = await prisma.patient.findMany({
  where: { ...scope, deletedAt: null },
});
```

**Güncellenecek Route'lar (Öncelik Sırası):**

| Route | Öncelik | Not |
|-------|---------|-----|
| `patients.ts` | Kritik | Patient.organizationId eklendikten sonra |
| `appointments.ts` | Kritik | Tüm şubeler birlikte görünmeli |
| `payments.ts` | Kritik | Gelir raporları için |
| `treatmentCases.ts` | Yüksek | |
| `tasks.ts` | Yüksek | |
| `dashboard.ts` | Yüksek | Aggregate destegi |
| `reports.ts` | Yüksek | |
| `inventory.ts` | Orta | InventoryItem org-level |
| `messages.ts` | Orta | |
| `paymentPlans.ts` | Orta | |
| `activityLogs` (içinde) | Orta | |
| `attachments.ts` | Düşük | |
| `compensationRules.ts` | Düşük | |
| `practitionerEarnings.ts` | Düşük | |
| `notifications.ts` | Düşük | |

---

## Sprint 5 — Organization Dashboard Backend (Detaylı)

**Dosya:** `server/src/routes/organizationDashboard.ts`

**Endpoint:** `GET /api/organization/dashboard?range=this_month`

### Sorgu Parametreleri

| Param | Değerler | Varsayılan |
|-------|---------|-----------|
| `range` | `today`, `this_week`, `this_month`, `last_30_days`, `custom` | `this_month` |
| `from` | ISO date string | — |
| `to` | ISO date string | — |

### Response Yapısı

```json
{
  "summary": {
    "totalClinics": 3,
    "todayAppointments": 24,
    "monthlyAppointments": 387,
    "monthlyRevenue": 125000.00,
    "outstandingBalance": 38000.00,
    "newPatients": 47,
    "activeTreatmentPlans": 92,
    "averageNoShowRate": 0.08,
    "activeUsers": 18
  },
  "clinics": [
    {
      "clinicId": "uuid",
      "clinicName": "Aile Diş Merkezi",
      "city": "İstanbul",
      "status": "active",
      "todayAppointments": 8,
      "weeklyAppointments": 52,
      "monthlyAppointments": 132,
      "monthlyRevenue": 45000.00,
      "outstandingBalance": 12000.00,
      "newPatients": 18,
      "activeTreatmentPlans": 34,
      "completedTreatments": 22,
      "noShowRate": 0.06,
      "staffCount": 6
    }
  ],
  "insights": {
    "topRevenueClinic": { "clinicId": "uuid", "clinicName": "...", "value": 45000 },
    "highestAppointmentClinic": { "clinicId": "uuid", "clinicName": "...", "value": 132 },
    "highestOutstandingBalanceClinic": { "clinicId": "uuid", "clinicName": "...", "value": 15000 },
    "highestNoShowClinic": { "clinicId": "uuid", "clinicName": "...", "value": 0.12 },
    "topNewPatientClinic": { "clinicId": "uuid", "clinicName": "...", "value": 22 }
  }
}
```

### Güvenlik Kuralları

```typescript
// 1. Rol kontrolü — sadece üst düzey roller:
if (!['OWNER', 'ORG_ADMIN', 'admin'].includes(req.user!.role)) {
  return res.status(403).json({ error: 'Organization dashboard requires OWNER or ORG_ADMIN role' });
}

// 2. Tüm sorgular her zaman organizationId ile scope edilir:
// Frontend'den gelen klinik id'leri doğrulanmadan ASLA kullanılmaz.
const allowedClinicIds = await prisma.userClinic.findMany({
  where: { userId: req.user!.id, isActive: true },
  select: { clinicId: true },
});
// canAccessAllClinics true ise tüm org klinikleri alınır:
const orgClinics = await prisma.clinic.findMany({
  where: { organizationId: req.user!.organizationId },
  select: { id: true },
});
const scopeClinicIds = req.user!.canAccessAllClinics
  ? orgClinics.map(c => c.id)
  : allowedClinicIds.map(uc => uc.clinicId);

// Tüm metrik sorguları:
where: { clinicId: { in: scopeClinicIds } }  // veya organizationId ile
```

> **Kritik:** `selectedClinicId` query param'ı asla doğrudan scope olarak kullanılmaz.  
> Verilen klinik id'nin `organizationId` ile eşleşip eşleşmediği her zaman DB'den doğrulanır.

---

## Sprint 6 — Frontend Bağlam ve ClinicSwitcher (Detaylı)

### 6.1 `ClinicContext.tsx`

**Dosya:** `src/context/ClinicContext.tsx`

```typescript
interface Clinic {
  id: string;
  name: string;
  slug?: string;
  status: string;
}

interface ClinicContextType {
  availableClinics: Clinic[];
  selectedClinicId: string; // "all" | clinicId
  setSelectedClinicId: (id: string) => void;
  canAccessAllClinics: boolean;
  isLoading: boolean;
}

export const ClinicProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedClinicId, setSelectedClinicIdState] = useState<string>(
    localStorage.getItem('selectedClinicId') ?? 'all'
  );
  
  const setSelectedClinicId = (id: string) => {
    localStorage.setItem('selectedClinicId', id);
    setSelectedClinicIdState(id);
  };
  
  // /api/me'den klinik listesini çek
  // ...
};
```

### 6.2 `ClinicSwitcher.tsx` Bileşeni

**Dosya:** `src/components/ClinicSwitcher.tsx`

```tsx
// Üst bar dropdown bileşeni
// Tek klinik varsa: "AileDiş" badge'i (tıklanamaz)
// Çok klinik varsa: dropdown
//   - Tüm Klinikler
//   - Klinik A
//   - Klinik B
// OWNER/ORG_ADMIN için "Tüm Klinikler" seçeneği görünür
```

### 6.3 `MainLayout.tsx` Güncellemesi

```tsx
// Header içine ClinicSwitcher ekle:
<header>
  <Logo />
  <ClinicSwitcher />   {/* YENİ */}
  <UserMenu />
</header>
```

### 6.4 API Çağrılarına `clinicId` Eklenmesi

```typescript
// src/services/api.ts (veya her sayfada):
// ClinicContext'ten selectedClinicId al
// API çağrısına ekle:
api.get('/patients', { params: { clinicId: selectedClinicId } })
```

---

## Sprint 7 — Organization Dashboard Frontend (Detaylı)

**Dosya:** `src/pages/OrganizationDashboard.tsx`  
**Route:** `/organization/dashboard`

### Sayfa Yapısı

```
OrganizationDashboard
├── Header: "Şube Yönetimi" + DateRangePicker
├── SummaryCards (Grid 3x3)
│   ├── Toplam Şube
│   ├── Bugünkü Randevular
│   ├── Aylık Randevular
│   ├── Aylık Gelir
│   ├── Bekleyen Bakiye
│   ├── Yeni Hastalar
│   ├── Aktif Tedavi Planları
│   ├── Ortalama No-show
│   └── Aktif Personel
├── InsightCards (5 kart)
│   ├── En yüksek gelirli şube
│   ├── En fazla randevulu şube
│   ├── En yüksek bekleyen bakiyeli şube
│   ├── En yüksek no-show oranlı şube
│   └── En fazla yeni hastası olan şube
├── BranchComparisonTable (sortable)
│   └── Sütunlar: Klinik | Bugün | Bu Ay Randevu | Gelir | Bakiye | Yeni Hasta | No-show | Hızlı Eylemler
└── Charts (mevcut chart kütüphanesi varsa)
    ├── Gelir karşılaştırma (bar)
    ├── Randevu karşılaştırma (bar)
    └── Yeni hasta trendi (line)
```

### Erişim Kontrolü (Frontend)

```typescript
// OrganizationDashboard içinde:
const { user } = useAuth();
if (!['admin', 'owner', 'org_admin'].includes(user.role)) {
  return <Navigate to="/" replace />;
}
```

---

## Rol Hiyerarşisi ve İzin Matrisi

| Rol | Tüm Şubeler | Kendi Şubeleri | Org Dashboard | Platform |
|-----|------------|----------------|---------------|---------|
| `PlatformAdmin` | ✅ (tüm org) | — | ✅ (support) | ✅ |
| `OWNER` | ✅ | ✅ | ✅ | ❌ |
| `ORG_ADMIN` | ✅ | ✅ | ✅ | ❌ |
| `CLINIC_MANAGER` | ❌ | ✅ (atanmış) | ❌ | ❌ |
| `DENTIST` | ❌ | ✅ (atanmış) | ❌ | ❌ |
| `RECEPTIONIST` | ❌ | ✅ (atanmış) | ❌ | ❌ |
| `BILLING` | ❌ | ✅ (atanmış) | ❌ | ❌ |
| `ASSISTANT` | ❌ | ✅ (atanmış) | ❌ | ❌ |

---

## Test Senaryoları

### İzolasyon Testleri

```typescript
describe('Multi-Branch Tenant Isolation', () => {
  // Düzeltme #10 — Genişletilmiş test kapsamı

  it('OWNER kendi organizasyonundaki tüm klinikleri görebilir', async () => {
    const token = loginAs(org.owner);
    const res = await GET('/api/patients?clinicId=all', token);
    expect(res.status).toBe(200);
    // Dönen hastalar sadece owner'ın organizasyonuna ait
    res.body.patients.forEach(p => expect(p.organizationId).toBe(org.id));
  });

  it('Personel sadece atanmış olduğu kliniklerin verilerini görebilir', async () => {
    // RECEPTIONIST sadece clinicA'ya atanmış, clinicB'ye değil
    const token = loginAs(clinicA.receptionist);
    const res = await GET('/api/patients?clinicId=all', token);
    expect(res.status).toBe(200);
    res.body.patients.forEach(p => expect(p.primaryClinicId).toBe(clinicA.id));
  });

  it('Kullanıcı bilinen clinicId ile başka organizasyonun kliniğine erişemez', async () => {
    const tokenOrgA = loginAs(orgA.owner);
    // OrgB klinik id'si biliniyor ama farklı organizasyon
    const res = await GET(`/api/patients?clinicId=${orgB.clinicId}`, tokenOrgA);
    expect(res.status).toBe(403);
  });

  it('selectedClinicId=all yetkisiz klinik verisi sızdırmaz', async () => {
    const token = loginAs(clinicA.dentist); // Sadece clinicA'ya atanmış
    const res = await GET('/api/appointments?clinicId=all', token);
    expect(res.status).toBe(200);
    // clinicB randevusu DÖNMEMELİ
    res.body.appointments.forEach(a => expect(a.clinicId).toBe(clinicA.id));
  });

  it('Hasta listesi org-level filtreleme doğru çalışır', async () => {
    const ownerToken = loginAs(org.owner);
    const receptionistToken = loginAs(clinicA.receptionist);
    // OWNER tüm hastaları görür
    const ownerRes = await GET('/api/patients?clinicId=all', ownerToken);
    // RECEPTIONIST sadece atanmış klinik hastalarını görür
    const recRes = await GET('/api/patients?clinicId=all', receptionistToken);
    expect(ownerRes.body.patients.length).toBeGreaterThanOrEqual(recRes.body.patients.length);
  });

  it('Organization dashboard DENTIST ve RECEPTIONIST tarafından erişilemiyor', async () => {
    const dentistToken = loginAs(clinicA.dentist);
    const recToken = loginAs(clinicA.receptionist);
    expect((await GET('/api/organization/dashboard', dentistToken)).status).toBe(403);
    expect((await GET('/api/organization/dashboard', recToken)).status).toBe(403);
  });

  it('Klinik A çalışanı Klinik B hastasına query param ile erişemez', async () => {
    const token = loginAs(clinicA.receptionist);
    const res = await GET(`/api/patients?clinicId=${clinicB.id}`, token);
    expect(res.status).toBe(403);
  });
});
```

### Geriye Dönük Uyumluluk Testi

```typescript
it('Mevcut tek klinik iş akışı bozulmadan çalışır', async () => {
  const token = loginAs(singleClinic.admin);
  const patients = await GET('/api/patients', token); // clinicId param yok
  expect(patients.status).toBe(200);
  // Varsayılan: kendi klinik verileri döner
});
```

---

## Etkilenen Dosyalar — Tam Liste

### Backend (`server/`)

| Dosya | Değişim Türü |
|-------|-------------|
| `prisma/schema.prisma` | Schema değişiklikleri (Sprint 1) |
| `prisma/seed.ts` | Organization + UserClinic seed (Sprint 2) |
| `src/middleware/auth.ts` | JWT/AuthRequest genişletme (Sprint 3) |
| `src/routes/auth.ts` | Login → UserClinic sorgula (Sprint 3) |
| `src/utils/clinicScope.ts` | **YENİ** — Kapsam helper (Sprint 4) |
| `src/middleware/clinicAccess.ts` | **YENİ** — Middleware (Sprint 4) |
| `src/routes/patients.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/appointments.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/payments.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/treatmentCases.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/tasks.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/dashboard.ts` | selectedClinicId desteği (Sprint 4) |
| `src/routes/reports.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/inventory.ts` | org-level ürün tanımı (Sprint 4) |
| `src/routes/messages.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/paymentPlans.ts` | clinicScope ekle (Sprint 4) |
| `src/routes/organizationDashboard.ts` | **YENİ** — Org dashboard (Sprint 5) |
| `src/index.ts` | Yeni route'u kaydet (Sprint 5) |
| `src/routes/users.ts` | UserClinic CRUD ekle (Sprint 4) |
| `src/routes/clinicRegistration.ts` | Organization oluşturma (Sprint 3) |

### Frontend (`src/`)

| Dosya | Değişim Türü |
|-------|-------------|
| `context/AuthContext.tsx` | organizationId, allowedClinicIds ekle |
| `context/ClinicContext.tsx` | **YENİ** — ClinicSwitcher bağlamı |
| `components/ClinicSwitcher.tsx` | **YENİ** — Dropdown bileşeni |
| `layouts/MainLayout.tsx` | ClinicProvider + ClinicSwitcher |
| `App.tsx` | ClinicProvider + /organization/dashboard route |
| `pages/OrganizationDashboard.tsx` | **YENİ** — Şube yönetim paneli |
| `pages/Dashboard.tsx` | selectedClinicId desteği |
| `pages/Patients.tsx` | clinicId param |
| `pages/Appointments.tsx` | clinicId param + şube etiketi |
| `pages/Payments.tsx` | clinicId param |
| `pages/Tasks.tsx` | clinicId param |
| `pages/TreatmentCases.tsx` | clinicId param |
| `pages/Reports.tsx` | clinicId param |
| `pages/Inventory.tsx` | clinicId param |

---

## Kabul Kriterleri

Uygulama aşağıdaki şartların tamamını sağladığında tamamlanmış sayılır:

- [ ] `Organization` modeli veritabanında mevcut
- [ ] `Clinic` organizasyona ait (`organizationId` FK)
- [ ] `User` organizasyona ait (`organizationId` FK)
- [ ] `UserClinic` üyelik tablosu mevcut
- [ ] Mevcut tek klinik verisi varsayılan organizasyona migrate edilmiş
- [ ] OWNER/ORG_ADMIN tüm şubelere erişebilir
- [ ] Şubeye atanmış personel sadece kendi şube verilerini görebilir
- [ ] ClinicSwitcher üst barda görünüyor
- [ ] `selectedClinicId=all` çalışıyor (hasta, randevu, ödeme, görev, dashboard, rapor)
- [ ] Yetkisiz klinik erişimi `403` döndürüyor
- [ ] Farklı organizasyon verisi sıfır şekilde görünür (cross-org izolasyon)
- [ ] Mevcut tek klinik iş akışı çalışıyor (geriye dönük uyumluluk)
- [ ] Organization Dashboard: tüm şubeler bir arada görünüyor
- [ ] Organization Dashboard: şube karşılaştırma tablosu çalışıyor
- [ ] Organization Dashboard: en az bir tarih aralığı filtresi çalışıyor
- [ ] Organization Dashboard: klinik satırına tıklayınca o klinik görünümü açılıyor
- [ ] Backend TypeScript derleme: 0 hata
- [ ] Frontend TypeScript derleme: 0 hata
- [ ] Prisma schema `prisma validate` geçiyor

---

## Rol Standardizasyonu (Düzeltme #5)

Sistem genelinde tek format kullanılır: **BÜYÜK HARF**

| Eski / Karışık Format | Standart Format |
|----------------------|-----------------|
| `admin` | `OWNER` (veya `admin` sadece legacy uyumluluk) |
| `owner` | `OWNER` |
| `org_admin` | `ORG_ADMIN` |
| `clinic_manager` | `CLINIC_MANAGER` |
| `doctor` / `dentist` | `DENTIST` |
| `receptionist` | `RECEPTIONIST` |
| `billing` | `BILLING` |
| `assistant` | `ASSISTANT` |

> **Not:** Mevcut verideki küçük harfli roller UserClinic oluşturulurken `.toUpperCase()` ile normalize edilir.  
> `User.role` alanı geriye dönük uyumluluk için korunabilir; yetki kontrollerinde `UserClinic.role` esas alınır.

## Üretim İçin SQL Migration Adımları (Düzeltme #8)

Geliştirme ortamında `prisma db push` kullanılır. Üretim ortamı için:

```sql
-- 1. Yeni tablolar (Organization, UserClinic, PatientClinic)
CREATE TABLE "Organization" (...);
CREATE TABLE "UserClinic" (...);
CREATE TABLE "PatientClinic" (...);

-- 2. Nullable kolonlar ekle (data kayıpsız)
ALTER TABLE "Clinic" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN "defaultClinicId" TEXT;
ALTER TABLE "User" ADD COLUMN "canAccessAllClinics" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Patient" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Patient" ADD COLUMN "primaryClinicId" TEXT;
ALTER TABLE "ClinicInvitation" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "organizationId" TEXT;

-- 3. Backfill betiği çalıştır (TypeScript migration script)

-- 4. Doğrulama:
SELECT COUNT(*) FROM "Clinic" WHERE "organizationId" IS NULL;   -- 0 olmalı
SELECT COUNT(*) FROM "User" WHERE "organizationId" IS NULL;     -- 0 olmalı
SELECT COUNT(*) FROM "Patient" WHERE "organizationId" IS NULL;  -- 0 olmalı

-- 5. NOT NULL kısıtları ekle:
ALTER TABLE "Clinic" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Patient" ALTER COLUMN "organizationId" SET NOT NULL;

-- 6. Unique constraint değişimi (User):
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_clinicId_email_key";
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- 7. Clinic.slug NOT NULL ve compound unique:
UPDATE "Clinic" SET slug = ... WHERE slug IS NULL; -- generate if needed
ALTER TABLE "Clinic" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Clinic" DROP CONSTRAINT IF EXISTS "Clinic_slug_key";
CREATE UNIQUE INDEX "Clinic_organizationId_slug_key" ON "Clinic"("organizationId", "slug");
```

---

## Bağımlılık Sırası

```
Sprint 1 (Schema)
    ↓
Sprint 2 (Data Migration)
    ↓
Sprint 3 (Auth/JWT)
    ↓
Sprint 4 (Backend Routes)        Sprint 6 (Frontend Context)
    ↓                                    ↓
Sprint 5 (Org Dashboard Backend) Sprint 7 (Org Dashboard Frontend)
    ↓                                    ↓
Sprint 8 (Frontend Modüller)
    ↓
Sprint 9 (Doğrulama)
```

> Sprint 4 ve Sprint 6 paralel yürütülebilir.  
> Sprint 5 ve Sprint 7 kendi bağımlılıkları tamamlandıktan sonra paralel yürütülebilir.

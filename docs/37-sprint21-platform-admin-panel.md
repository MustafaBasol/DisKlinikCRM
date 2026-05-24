# 37 — Sprint 21: Platform Admin / Super Admin Paneli

**Tarih:** 24 Mayıs 2026  
**Durum:** Tamamlandı  
**Kapsam:** SaaS sahibine özel ayrı bir Platform Admin paneli — organizasyonlar, klinikler, kullanıcılar, planlar ve sistem sağlığı yönetimi

---

## Hedef

Klinik `OWNER`/`ORG_ADMIN` rollerinden **tamamen bağımsız** bir Platform Admin arayüzü inşa etmek. Bu panel yalnızca SaaS platform sahibinin erişebileceği bir super-admin alanıdır.

---

## Mimari Kararlar

### Ayrı JWT Sistemi

| Alan | JWT Secret | Token Tipi | Depolama |
|------|-----------|-----------|---------|
| Klinik kullanıcıları | `JWT_SECRET` | `clinic_user` | `localStorage.token` |
| Platform admin | `PLATFORM_JWT_SECRET` | `platform_admin` | `localStorage.platform_token` |

`authenticatePlatformAdmin` middleware, klinik token'larını `type` kontrolüyle reddeder (403). Platform token'ları da klinik route'larına erişemez — çapraz erişim tamamen engellendi.

### Frontend Ayrışması

Platform sayfaları `AuthContext` kullanmaz. Kendi `PlatformAuthContext` ile çalışır. Layout, sidebar ve routing tamamen ayrıdır.

---

## Backend Değişiklikleri

### `server/src/routes/platformAdmin.ts` — Yeniden Yazıldı

Tüm `/api/platform/*` endpoint'leri bu dosyada tanımlıdır.

#### Yardımcı Fonksiyon

```typescript
parsePagination(query)
```
- `page` ve `limit` query parametrelerini güvenli biçimde ayrıştırır
- `isNaN` guard ile NaN → varsayılan (page=1, limit=25) düşme koruması
- `limit` max 100 ile sınırlı
- `{ skip, take, page, limit }` döner

> **Bug Fix:** `Math.max(1, NaN) === NaN` JavaScript davranışı — `isNaN` guard eklenerek düzeltildi.

#### Endpoint Listesi

| Method | Path | Açıklama |
|--------|------|----------|
| `POST` | `/api/platform/auth/login` | Platform admin girişi (public) |
| `GET` | `/api/platform/me` | Oturum açık admin profili (passwordHash hariç) |
| `GET` | `/api/platform/dashboard` | Ana panel istatistikleri |
| `GET` | `/api/platform/stats` | Geriye dönük uyumluluk alias'ı |
| `GET` | `/api/platform/organizations` | Paginated + search + status filtreli liste |
| `GET` | `/api/platform/organizations/:id` | Detay (klinikler + owner dahil) |
| `PATCH` | `/api/platform/organizations/:id/status` | trial / active / suspended / cancelled |
| `PATCH` | `/api/platform/organizations/:id/plan` | Plan değiştir |
| `PATCH` | `/api/platform/organizations/:id/trial` | Deneme bitiş tarihi güncelle |
| `GET` | `/api/platform/clinics` | Paginated + search + status + organizationId filtreli |
| `GET` | `/api/platform/clinics/:id` | Klinik detayı |
| `POST` | `/api/platform/clinics` | Organizasyon + klinik transaction ile oluştur |
| `PATCH` | `/api/platform/clinics/:id/status` | Klinik durum değiştir |
| `PATCH` | `/api/platform/clinics/:id/plan` | Klinik plan değiştir |
| `GET` | `/api/platform/clinics/:id/users` | Kliniğe ait kullanıcılar |
| `GET` | `/api/platform/users` | Paginated + search + status + role + organizationId filtreli |
| `PATCH` | `/api/platform/users/:id/status` | isActive boolean toggle |
| `GET` | `/api/platform/plans` | Tüm planlar |
| `POST` | `/api/platform/plans` | Yeni plan oluştur |
| `PUT` | `/api/platform/plans/:id` | Plan güncelle |
| `GET` | `/api/platform/system` | DB sağlık durumu + WhatsApp bağlantı sayıları + başarısız mesaj sayısı |

`GET /dashboard` dönüş alanları:
- `totalOrgs`, `activeOrgs`, `suspendedOrgs`
- `clinics`, `users`, `patients`
- `trialEndingSoon` (7 gün içinde bitenler)
- `whatsappConnections` (connected sayısı)
- `recentOrganizations` (son 5)

`GET /users` endpoint'i hiçbir zaman `passwordHash` döndürmez.

---

### `server/src/middleware/platformAuth.ts` — Değişmedi

Mevcut haliyle eksiksizdi:
- `authenticatePlatformAdmin` middleware
- `generatePlatformToken(admin)` — 8 saatlik token, `type: 'platform_admin'`
- `PlatformAdminRequest` interface

---

## Frontend Değişiklikleri

### Yeni Dosyalar

#### `src/context/PlatformAuthContext.tsx`
- `PlatformAuthProvider` — platform route'larını sarar
- `usePlatformAuth()` hook — `{ isAuthenticated, admin, login, logout }`
- `usePlatformApi()` hook — `Authorization: Bearer {platform_token}` header'lı axios instance
- `localStorage.platform_token` ve `localStorage.platform_admin` ile çalışır

#### `src/layouts/PlatformAdminLayout.tsx`
- Klinik layout'undan bağımsız sidebar
- Navigasyon öğeleri: Dashboard, Organizasyonlar, Klinikler, Kullanıcılar, Planlar, Sistem
- `handleLogout` → platform token ve admin bilgisini temizler
- Başlık: **"Platform Yönetimi"**

#### `src/pages/platform/PlatformLogin.tsx`
- Bağımsız giriş sayfası (`/platform/login`)
- `usePlatformAuth().login()` çağırır
- Başarılı girişte `/platform`'a yönlendirir
- Klinik giriş sayfasından tamamen ayrı

#### `src/pages/platform/PlatformDashboard.tsx`
- `GET /api/platform/dashboard` verisi ile 8 istatistik kartı
- Son organizasyonlar tablosu
- Toplam org, aktif, askıya alınmış, klinik sayısı, kullanıcı sayısı, hasta sayısı, deneme biten, WA bağlantıları

#### `src/pages/platform/PlatformOrganizations.tsx`
- Sayfalı liste, arama + durum filtresi
- Modal ile işlemler: **Aktifleştir / Askıya Al / Plan Değiştir / Deneme Uzat**

#### `src/pages/platform/PlatformClinics.tsx`
- Sayfalı liste, arama + durum + organizasyon filtresi
- Klinik durum toggle aksiyonu

#### `src/pages/platform/PlatformUsers.tsx`
- Sayfalı liste, arama + durum + rol + organizasyon filtresi
- `isActive` toggle aksiyonu

#### `src/pages/platform/PlatformPlans.tsx`
- Plan kartları grid görünümü
- Yeni plan oluşturma ve düzenleme modal'ı

#### `src/pages/platform/PlatformSystem.tsx`
- Veritabanı sağlık durumu
- WhatsApp bağlantı sayıları (Evolution API vs Meta Cloud API)
- Başarısız mesaj özeti

---

### Güncellenen Dosyalar

#### `src/App.tsx`

Eklenen import'lar:
```tsx
import { PlatformAuthProvider, usePlatformAuth } from './context/PlatformAuthContext';
import PlatformAdminLayout from './layouts/PlatformAdminLayout';
import PlatformLogin from './pages/platform/PlatformLogin';
// + diğer platform sayfa import'ları
```

Yeni route guard:
```tsx
const PlatformRoute = () => {
  const { isAuthenticated } = usePlatformAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/platform/login" replace />;
};
```

Route yapısı:
```tsx
<AuthProvider>
  <PlatformAuthProvider>
    ...
    <Route path="/platform/login" element={<PlatformLogin />} />
    <Route element={<PlatformRoute />}>
      <Route path="/platform" element={<PlatformAdminLayout />}>
        <Route index element={<PlatformDashboard />} />
        <Route path="organizations" element={<PlatformOrganizations />} />
        <Route path="clinics" element={<PlatformClinics />} />
        <Route path="users" element={<PlatformUsers />} />
        <Route path="plans" element={<PlatformPlans />} />
        <Route path="system" element={<PlatformSystem />} />
      </Route>
    </Route>
  </PlatformAuthProvider>
</AuthProvider>
```

Eski `<Route path="/platform" element={<PlatformAdmin />} />` kaldırıldı.

---

## Test Değişiklikleri

### `server/src/tests/platformAdmin.test.ts` — Yeni Dosya

17 birim testi, `npx tsx` ile çalışır, harici test framework gerektirmez.

**Test grupları:**

| Grup | Test Sayısı |
|------|------------|
| `parsePagination` — Sayfalama yardımcısı | 7 |
| `generatePlatformToken` — Token üretimi | 2 |
| `authenticatePlatformAdmin` — Middleware doğrulama | 5 |
| Token izolasyonu — Çapraz erişim engeli | 2 |
| **Toplam** | **17** |

**Kritik test senaryoları:**
- `page=0` verildiğinde page=1'e düşme
- `page='abc'` (NaN) verildiğinde page=1'e düşme ← bug fix doğrulaması
- Klinik user token'ı platform route'una gönderildiğinde 403
- Platform token'ı klinik JWT secret ile doğrulanamaz
- Klinik token'ı platform JWT secret ile doğrulanamaz

**Son çalışma sonucu:** `Toplam: 17  ✓ 17  ✗ 0`

---

## Güvenlik Notları

- Platform token ile klinik route'larına erişim engellenmiştir
- Klinik token ile platform route'larına erişim engellenmiştir
- `/api/platform/users` endpoint'i hiçbir koşulda `passwordHash` döndürmez
- Platform admin giriş endpoint'i dışındaki tüm `/api/platform/*` route'ları `authenticatePlatformAdmin` middleware'inden geçer
- `PLATFORM_JWT_SECRET` ortam değişkeni üretimde mutlaka değiştirilmelidir

---

## Doğrulama Komutları

```bash
# Backend tip kontrolü
cd server && npx tsc --noEmit
# BACKEND OK

# Frontend tip kontrolü
cd /workspaces/DisKlinikCRM && npx tsc --noEmit
# FRONTEND OK

# Unit testler
cd server && npx tsx src/tests/platformAdmin.test.ts
# Toplam: 17  ✓ 17  ✗ 0
```

---

## Değiştirilen / Oluşturulan Dosyalar

| Dosya | İşlem |
|-------|-------|
| `server/src/routes/platformAdmin.ts` | Yeniden yazıldı |
| `server/src/tests/platformAdmin.test.ts` | Oluşturuldu |
| `server/src/middleware/platformAuth.ts` | Değişmedi (mevcut haliyle eksiksizdi) |
| `src/context/PlatformAuthContext.tsx` | Oluşturuldu |
| `src/layouts/PlatformAdminLayout.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformLogin.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformDashboard.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformOrganizations.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformClinics.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformUsers.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformPlans.tsx` | Oluşturuldu |
| `src/pages/platform/PlatformSystem.tsx` | Oluşturuldu |
| `src/App.tsx` | Güncellendi |

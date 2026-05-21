# Sprint 12 — Finans / Fatura Panosu

## Özet

Sprint 12, kliniklere finans ve fatura yönetimi için özel bir dashboard ekler. BILLING kullanıcıları artık `/dashboard` yerine `/finance` sayfasına yönlendirilir. Sayfa; tahsilat metrikleri, gecikmiş taksitler, şube bazlı performans ve hekim hak edişlerini tek ekranda gösterir.

---

## 1. Backend Endpoint

### `GET /api/finance/dashboard`

**Dosya:** `server/src/routes/financeDashboard.ts`

#### Query Parametreleri

| Parametre | Değerler | Açıklama |
|-----------|----------|----------|
| `clinicId` | `all` veya `<clinicId>` | Klinik filtresi |
| `range` | `today`, `this_week`, `this_month`, `last_30_days`, `custom` | Tarih aralığı |
| `from` | ISO tarih | `custom` aralık başlangıcı |
| `to` | ISO tarih | `custom` aralık bitişi |

#### Erişim Kontrolü

| Rol | Erişim |
|-----|--------|
| OWNER | ✅ Tüm klinikler |
| ORG_ADMIN | ✅ Tüm klinikler |
| CLINIC_MANAGER | ✅ Yalnızca `allowedClinicIds` |
| BILLING | ✅ Yalnızca `allowedClinicIds` |
| DENTIST | ❌ 403 |
| RECEPTIONIST | ❌ 403 |
| ASSISTANT | ❌ 403 |

#### Güvenlik Kuralları

- Tüm sorgular `clinic.organizationId` ile org-scoped → çapraz-org sızıntısı yok
- `clinicId` query param sunucu tarafında `allowedClinicIds` ile doğrulanır
- BILLING / CLINIC_MANAGER kendi kliniklerinin dışına erişemez
- Frontend'e hiç güvenilmez

#### Yanıt Yapısı

```json
{
  "summary": {
    "collectedToday": 0,
    "collectedInRange": 0,
    "outstandingBalance": 0,
    "overdueAmount": 0,
    "pendingInstallments": 0,
    "overdueInstallments": 0,
    "cancelledPayments": 0,
    "practitionerPayoutsDue": 0,
    "practitionerPayoutsPaid": 0
  },
  "collectionsByMethod": [
    { "method": "cash", "amount": 0, "count": 0 }
  ],
  "branchBreakdown": [
    {
      "clinicId": "...",
      "clinicName": "...",
      "collected": 0,
      "outstanding": 0,
      "overdue": 0,
      "pendingInstallments": 0
    }
  ],
  "recentPayments": [
    {
      "id": "...",
      "patientName": "...",
      "clinicName": "...",
      "amount": 0,
      "method": "...",
      "paidAt": "...",
      "status": "..."
    }
  ],
  "upcomingInstallments": [
    {
      "id": "...",
      "planId": "...",
      "patientName": "...",
      "clinicName": "...",
      "amount": 0,
      "dueDate": "...",
      "status": "pending|overdue"
    }
  ]
}
```

---

## 2. Metrikler

### Ödeme Metrikleri (`Payment` modeli)

| Metrik | Hesaplama |
|--------|-----------|
| `collectedToday` | `paymentStatus=paid` AND `paidAt` bugün |
| `collectedInRange` | `paymentStatus=paid` AND `paidAt` seçilen dönemde |
| `outstandingBalance` | `paymentStatus IN (pending, partial)` — tüm zamanlar |
| `cancelledPayments` | `paymentStatus=cancelled` AND `updatedAt` dönemde |
| `collectionsByMethod` | `groupBy(paymentMethod)` dönem içi ödemeler |

### Taksit Metrikleri (`PaymentPlanInstallment` modeli)

| Metrik | Hesaplama |
|--------|-----------|
| `overdueAmount` | `status=overdue` → `SUM(amount)` |
| `overdueInstallments` | `status=overdue` → `COUNT` |
| `pendingInstallments` | `status=pending` → `COUNT` |
| `upcomingInstallments` | `status IN (pending, overdue)` AND `dueDate <= now+30gün` |

### Hekim Hak Edişleri (`PractitionerEarning` / `PractitionerPayout` modelleri)

| Metrik | Hesaplama |
|--------|-----------|
| `practitionerPayoutsDue` | `PractitionerEarning.status IN (pending, approved)` → `SUM(earningAmount)` |
| `practitionerPayoutsPaid` | `PractitionerEarning.status=paid` AND `paidAt` dönemde → `SUM(earningAmount)` |

### Şube Bazlı Dağılım

Her klinik için paralel sorgu: collected, outstanding, overdue (taksit), pendingInstallments.

---

## 3. Yardımcı Fonksiyon: `resolveClinicScope`

`server/src/routes/financeDashboard.ts` içinde tanımlı (yerel helper).

- OWNER / ORG_ADMIN → tüm org kliniklerini döner
- CLINIC_MANAGER / BILLING → `allowedClinicIds` ∩ org kliniklerini döner
- `clinicId` parametresi verilmişse, izin kontrolü yapıp tek klinik döner
- `{ error: string }` döndürerek HTTP 403 tetikler

`getDateRange` → `server/src/routes/organizationDashboard.ts`'den re-export edilir (paylaşımlı utility).

---

## 4. Frontend

### Sayfa: `src/pages/FinanceDashboard.tsx`

**Route:** `/finance`

#### Bölümler

1. **Header** — Finans Paneli başlığı + dönem seçici (Bugün / Bu Hafta / Bu Ay / Son 30 Gün) + yenile butonu
2. **Özet Kartları** (2×4 grid) — 8 metrik kartı, renk kodlu ikonlarla
3. **Ödeme Yöntemleri** — Nakit, Kart, Havale/EFT, Sigorta, Diğer; dönem toplamıyla
4. **Yaklaşan / Gecikmiş Taksitler** — Sonraki 30 gün, vade durumu rozeti
5. **Şube Bazlı Performans** — Birden fazla şube varsa gösterilir; taksit planlarına ve ödemelere direkt link
6. **Son Ödemeler** — Dönemin son 10 ödemesi; Ödemeler sayfasına link

#### Yetki Kontrolü

Sayfa yüklendiğinde `canViewFinanceDashboard(user)` kontrolü yapılır. False ise `/` yönlendirmesi.

### API Servisi: `src/services/api.ts`

```typescript
export const financeDashboardService = {
  get: (params?: { clinicId?: string; range?: string; from?: string; to?: string }) =>
    api.get('/finance/dashboard', { params }),
};
```

---

## 5. Yetki Güncellemeleri

### Backend: `server/src/utils/roles.ts`

```typescript
export function canViewFinanceDashboard(user): boolean
// OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING → true
// DENTIST, RECEPTIONIST, ASSISTANT, null → false
```

### Frontend: `src/utils/permissions.ts`

Aynı fonksiyon `getRole(user)` ile frontend'e de eklendi.

---

## 6. Navigasyon ve Yönlendirme

### `src/layouts/MainLayout.tsx`

- `BarChart3` (lucide-react) ikonu eklendi
- `canViewFinanceDashboard` import edildi
- "Finans Paneli" nav öğesi, Taksit Planları'nın hemen altına eklendi
- DENTIST ve RECEPTIONIST nav'da bu öğeyi görmez

### `src/pages/Dashboard.tsx`

```tsx
// Öncesi
if (role === 'BILLING') return <Navigate to="/reports" replace />;

// Sonrası
if (role === 'BILLING') return <Navigate to="/finance" replace />;
```

---

## 7. Testler

**Dosya:** `server/src/tests/financeDashboard.test.ts`

**24/24 test geçti.** Kapsam:

### Erişim Kontrolü (9 test)
- OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING → erişim var
- DENTIST, RECEPTIONIST, ASSISTANT, null, undefined → erişim yok

### `getDateRange` (6 test)
- `today` → aynı gün sınırları
- `this_month` → ay başından bugüne
- `last_30_days` → ~30 gün aralık
- `this_week` → Pazar başlangıcı
- `custom` → from/to parse edilir
- `custom` from/to eksikse hata fırlatır
- Bilinmeyen range → `this_month` fallback

### Metrik Yapısı (4 test)
- Boş cevap tüm alanları sıfır döner
- `cancelledPayments` toplam tahsilata dahil değil
- `branchBreakdown` satırı tüm alanları içerir
- `upcomingInstallments` satırı tüm alanları içerir

### Klinik Kapsam Güvenliği (4 test)
- BILLING → `allowedClinicIds` dışına erişemez
- BILLING → atanmış kliniğe erişebilir
- OWNER `canAccessAllClinics=true` → tüm klinikler
- Farklı `organizationId` → çapraz-org erişimi imkânsız

### Test Scripti

```json
"test:finance": "tsx src/tests/financeDashboard.test.ts"
```

`npm test` artık: fixtures + whatsapp + inbox + finance testlerini çalıştırır.

---

## 8. Doğrulama Komutları

| Komut | Sonuç |
|-------|-------|
| `npx prisma validate` | ✅ |
| `cd server && npx tsc --noEmit` | ✅ Hata yok |
| `cd .. && npx tsc --noEmit` | ✅ Hata yok |
| `npm run test:finance` | ✅ 24/24 |

---

## 9. Manuel QA Listesi

- [ ] BILLING kullanıcısı `/dashboard`'a gidince `/finance`'a yönlenir
- [ ] BILLING sol navigasyonda "Finans Paneli" görür, hastalar/randevular görünmez
- [ ] OWNER tüm şubelerin verilerini şube tablosunda görür
- [ ] CLINIC_MANAGER yalnızca atanmış şubeleri görür
- [ ] Dönem seçici değişince veriler yenilenir
- [ ] "Ödemeler" / "Taksitler" linkleri doğru `clinicId` ile sayfaya gider
- [ ] DENTIST `/finance`'a gitmeye çalışırsa ana sayfaya yönlenir
- [ ] Boş veri durumunda (yeni klinik) sayfa "Veri yok" mesajı gösterir, çökmez

---

## 10. Etkilenen Dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `server/src/routes/financeDashboard.ts` | **YENİ** — Finance dashboard endpoint |
| `server/src/index.ts` | `financeDashboardRoutes` kaydı |
| `server/src/utils/roles.ts` | `canViewFinanceDashboard` eklendi |
| `server/src/tests/financeDashboard.test.ts` | **YENİ** — 24 test |
| `server/package.json` | `test:finance` scripti; `npm test` güncellendi |
| `src/pages/FinanceDashboard.tsx` | **YENİ** — Finance paneli sayfası |
| `src/pages/Dashboard.tsx` | BILLING redirect: `/reports` → `/finance` |
| `src/layouts/MainLayout.tsx` | "Finans Paneli" nav öğesi + BarChart3 + canViewFinanceDashboard |
| `src/App.tsx` | `/finance` route + FinanceDashboard import |
| `src/services/api.ts` | `financeDashboardService` eklendi |
| `src/utils/permissions.ts` | `canViewFinanceDashboard` eklendi |

---

## 11. Kalan Çalışmalar (Sprint 13+)

| Konu | Açıklama |
|------|----------|
| Klinik dropdown seçici | Şube tablosundaki klinik seçimi için sunucu tarafı `selectedClinicId` entegrasyonu |
| CSV / Excel export | Seçilen dönem için ödeme raporu indirme |
| Grafik görünümü | Dönemsel tahsilat trend grafiği (line chart) |
| PDF makbuz | Ödeme satırından PDF makbuz oluşturma |
| Hak ediş onay akışı | Finans panelinden hekim hak edişi onaylama / reddetme |
| Gerçek zamanlı | Yeni ödeme gelince özet kartlarını otomatik güncelleme (WebSocket/SSE) |

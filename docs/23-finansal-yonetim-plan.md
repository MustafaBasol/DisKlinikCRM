# Kategori 4: Finansal Yönetim — Teknik Uygulama Planı

> **Tarih:** Mayıs 2026  
> **Durum:** Planlama aşaması  
> **Önkoşul:** MVP tamamlanmış, Payment CRUD ve Dashboard gelir metrikleri aktif.

---

## Mevcut Altyapı

```
Payment {
  id, clinicId, patientId, treatmentCaseId,
  amount, currency, paymentMethod,
  paymentStatus (pending|partial|paid|refunded|cancelled),
  paidAt, notes, createdById
}
```

Mevcut API:
- `GET /api/payments` — filtrelenmiş liste (hasta, durum, yöntem, tarih)
- `POST /api/payments` — kayıt oluştur
- `PUT /api/payments/:id` — güncelle
- `PATCH /api/payments/:id/cancel` — iptal

---

## 📊 Uygulama Sırası

| # | Özellik | Schema Değişikliği | Tahmini Efor | Öncelik |
|---|---------|-------------------|--------------|---------|
| 1 | **4.3 Gelir/Hekim Raporu** | Yok | 1 gün | ⭐⭐⭐⭐⭐ |
| 2 | **4.1 Makbuz / Fatura** | Yok | 0.5 gün | ⭐⭐⭐⭐ |
| 3 | **4.4 Komisyon Takibi** | `User.commissionRate` | 0.5 gün | ⭐⭐⭐⭐ |
| 4 | **4.2 Taksit Planı** | 2 yeni model | 2 gün | ⭐⭐⭐⭐ |

---

## 4.3 — Gelir-Gider Raporu (ÖNCE YAPILACAK)

### Neden Önce?
- Sıfır schema değişikliği, mevcut Payment verisini kullanır
- Klinik sahibinin en sık baktığı veri
- Demo etkisi çok yüksek

### Backend

**Yeni route:** `server/src/routes/reports.ts`

```
GET /api/reports/revenue
  Query: dateFrom, dateTo, groupBy (day|week|month), practitionerId, paymentMethod
  Rol: admin, billing

GET /api/reports/doctor-performance  
  Query: dateFrom, dateTo
  Rol: admin, billing

GET /api/reports/revenue/export.csv
  Query: dateFrom, dateTo (tüm filtreler)
  Rol: admin, billing
```

**`GET /api/reports/revenue` döndürür:**
```ts
{
  summary: {
    totalRevenue: number,       // paidAt aralığında paid+partial ödemeler
    totalCount: number,
    avgPerPayment: number,
    pendingAmount: number,      // tüm pending ödemeler toplamı
    currency: string
  },
  byPeriod: [                   // groupBy'a göre günlük/haftalık/aylık
    { period: "2026-05", revenue: 45000, count: 23 }
  ],
  byMethod: [                   // ödeme yöntemi dağılımı
    { method: "cash", revenue: 20000, count: 10 },
    { method: "card", revenue: 25000, count: 13 }
  ],
  byPractitioner: [             // hekim bazlı (admin görür)
    { practitionerId, firstName, lastName, revenue, count }
  ]
}
```

**Prisma aggregation örneği:**
```ts
// Dönemsel gruplama — raw query ile
const byPeriod = await prisma.$queryRaw`
  SELECT 
    DATE_TRUNC(${groupBy}, "paidAt") as period,
    SUM(amount) as revenue,
    COUNT(*) as count
  FROM "Payment"
  WHERE "clinicId" = ${clinicId}
    AND "paymentStatus" IN ('paid', 'partial')
    AND "paidAt" >= ${dateFrom}
    AND "paidAt" <= ${dateTo}
  GROUP BY 1
  ORDER BY 1
`;

// Hekim bazlı — join gerektirir
const byPractitioner = await prisma.$queryRaw`
  SELECT 
    u."id" as practitionerId,
    u."firstName", u."lastName",
    SUM(p.amount) as revenue,
    COUNT(p.id) as count
  FROM "Payment" p
  JOIN "Appointment" a ON a."patientId" = p."patientId"
    AND DATE(a."startTime") = DATE(p."paidAt")
  JOIN "User" u ON u."id" = a."practitionerId"
  WHERE p."clinicId" = ${clinicId}
    AND p."paymentStatus" IN ('paid','partial')
    AND p."paidAt" BETWEEN ${dateFrom} AND ${dateTo}
  GROUP BY u."id", u."firstName", u."lastName"
`;
```

**CSV Export:**
```ts
// Basit string builder — bağımlılık yok
const rows = payments.map(p =>
  [p.paidAt, p.patient.firstName + ' ' + p.patient.lastName,
   p.amount, p.currency, p.paymentMethod, p.paymentStatus].join(',')
);
const csv = ['Tarih,Hasta,Tutar,Para Birimi,Yöntem,Durum', ...rows].join('\n');
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="gelir-raporu.csv"');
res.send('\uFEFF' + csv); // BOM — Excel Türkçe karakter desteği için
```

### Frontend

**Yeni sayfa:** `src/pages/Reports.tsx`

**Bileşenler:**
```
Reports.tsx
├── DateRangePicker (from/to input[type=date])
├── Filters: practitionerId select, paymentMethod select
├── Özet Kartları (4 kart — toplam gelir, tahsilat bekleyen, ortalama, ödeme sayısı)
├── BarChart — dönemsel gelir trendi (recharts, zaten kurulu)
├── PieChart — ödeme yöntemi dağılımı
├── Hekim Performans Tablosu (sadece admin/billing görür)
└── "CSV İndir" butonu → window.location = /api/reports/revenue/export.csv?...
```

**Sidebar'a ekleme:** `src/layouts/MainLayout.tsx`
```tsx
{ icon: BarChart2, label: t('nav:reports'), path: '/reports', roles: ['admin', 'billing'] }
```

---

## 4.1 — Makbuz / Fatura

### Yaklaşım: Browser Print (Sıfır Bağımlılık)

PDF kütüphanesi eklemek yerine print-optimized HTML + `window.print()` kullanılır.  
Tarayıcı kendi PDF'ini oluşturur → "PDF olarak kaydet" işlevi her tarayıcıda mevcuttur.

### Backend

**Yeni endpoint:**
```
GET /api/payments/:id/receipt
  Döner: { payment, patient, treatmentCase, clinic }
  Rol: admin, billing, receptionist
```

```ts
router.get('/payments/:id/receipt', authorize(['admin','billing','receptionist']),
  async (req, res) => {
    const payment = await prisma.payment.findFirst({
      where: { id, clinicId },
      include: {
        patient: { select: { firstName, lastName, phone, email } },
        treatmentCase: { select: { title, estimatedAmount } },
        clinic: { select: { name, address, phone, email } },
      }
    });
    if (!payment) return res.status(404).json({ error: 'Not found' });
    res.json(payment);
  }
);
```

### Frontend

**Yeni bileşen:** `src/components/ReceiptModal.tsx`

```tsx
// Makbuz içeriği
<div className="receipt-area p-8 bg-white text-gray-900 font-sans">
  <header>
    <h1>{clinic.name}</h1>
    <p>{clinic.address} · {clinic.phone}</p>
    <hr />
    <h2>MAKBUz / FATURA</h2>
    <p>Tarih: {format(payment.paidAt)}</p>
    <p>Makbuz No: {payment.id.slice(0,8).toUpperCase()}</p>
  </header>
  
  <section>
    <h3>Hasta Bilgisi</h3>
    <p>{patient.firstName} {patient.lastName}</p>
    <p>{patient.phone}</p>
  </section>
  
  <table>
    <tr><td>Hizmet / Tedavi</td><td>{treatmentCase?.title || 'Ödeme'}</td></tr>
    <tr><td>Tutar</td><td>{amount} {currency}</td></tr>
    <tr><td>Ödeme Yöntemi</td><td>{paymentMethod}</td></tr>
    <tr><td>Durum</td><td>{paymentStatus}</td></tr>
  </table>
</div>

<button onClick={() => window.print()}>🖨️ Yazdır / PDF Kaydet</button>
```

**CSS print stili (`index.css`'e eklenecek):**
```css
@media print {
  .no-print { display: none !important; }  /* sidebar, header, butonlar */
  .receipt-area { 
    position: fixed; top: 0; left: 0;
    width: 100%; height: 100%;
    font-size: 14pt;
  }
  body { background: white !important; }
}
```

**`Payments.tsx`'e ekleme:**
```tsx
// Her satıra "Makbuz" butonu
<button onClick={() => setReceiptPayment(payment)}>
  <Receipt size={16} />
</button>
```

---

## 4.4 — Hekim Performans & Komisyon Takibi

### Schema Değişikliği (minimal)

`User` modeline tek alan eklenir:

```prisma
model User {
  // ... mevcut alanlar
  commissionRate   Float   @default(0)  // Yüzde: 30 = %30
}
```

**Migration:**
```sql
ALTER TABLE "User" ADD COLUMN "commissionRate" FLOAT DEFAULT 0;
```

### Backend

`GET /api/reports/doctor-performance` response:
```ts
{
  dateFrom: string,
  dateTo: string,
  doctors: [{
    id, firstName, lastName, commissionRate,
    metrics: {
      appointmentCount: number,      // toplam randevu
      completedAppointments: number, // status='completed'
      noShowCount: number,
      revenue: number,               // bu hekime bağlı ödeme toplamı
      commissionAmount: number,      // revenue * commissionRate / 100
      treatmentCasesOpened: number,
      treatmentCasesCompleted: number,
      avgRevenuePerAppointment: number,
    }
  }]
}
```

**Hekim-ödeme ilişkisi kurma stratejisi:**

Payment modeli direkt `practitionerId` içermiyor. İki seçenek:

**Seçenek A (Önerilen — hızlı):** Ödemeyi yapan randevu üzerinden dolaylı bağla:
```sql
JOIN Appointment a ON a.patientId = p.patientId 
  AND DATE(a.startTime) = DATE(p.paidAt)
```

**Seçenek B (Doğru — gelecek):** Payment modeline `practitionerId` ekle:
```prisma
practitionerId  String?
practitioner    User?   @relation(...)
```
Bu, PaymentForm'da hekim seçimi gerektirir. Daha iyi veri kalitesi.  
**Öneri: Seçenek B'yi 4.2 taksit planıyla birlikte uygula.**

### Frontend

`Reports.tsx` içinde "Hekim Performans" sekmesi:
```
┌─────────────────────────────────────────────────────────┐
│ Dr. Ahmet Yılmaz              Komisyon Oranı: %30       │
│ ──────────────────────────────────────────────────────── │
│ Randevu: 48  │  Tamamlanan: 41  │  No-Show: 3           │
│ Gelir: 85.000 ₺  │  Komisyon: 25.500 ₺                 │
│ Tedavi Açılan: 12  │  Tamamlanan: 8                     │
└─────────────────────────────────────────────────────────┘
```

**Komisyon oranı düzenleme:** `Settings.tsx` altında "Hekim Komisyonları" bölümü  
veya doğrudan `UserList.tsx`'e "Komisyon %" sütunu.

---

## 4.2 — Taksit Planı (En Karmaşık)

### Yeni Prisma Modelleri

```prisma
model PaymentPlan {
  id              String    @id @default(uuid())
  clinicId        String
  clinic          Clinic    @relation(fields: [clinicId], references: [id])
  patientId       String
  patient         Patient   @relation(fields: [patientId], references: [id])
  treatmentCaseId String?
  treatmentCase   TreatmentCase? @relation(fields: [treatmentCaseId], references: [id])
  
  totalAmount      Float
  currency         String
  installmentCount Int
  description      String?
  status           String    @default("active") // active, completed, cancelled
  createdById      String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  installments     PaymentPlanInstallment[]
}

model PaymentPlanInstallment {
  id        String   @id @default(uuid())
  planId    String
  plan      PaymentPlan @relation(fields: [planId], references: [id])
  
  installmentNo  Int        // 1, 2, 3...
  dueDate        DateTime
  amount         Float
  status         String    @default("pending") // pending, paid, overdue
  paymentId      String?   // gerçek Payment kaydına referans
  payment        Payment?  @relation(fields: [paymentId], references: [id])
  paidAt         DateTime?
  notes          String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}
```

**Clinic ve Patient modellerine eklenecek ilişkiler:**
```prisma
paymentPlans  PaymentPlan[]
```

**Payment modeline eklenecek:**
```prisma
installment   PaymentPlanInstallment?
```

### Backend Routes

```
POST /api/payment-plans
  Body: { patientId, treatmentCaseId?, totalAmount, currency, installmentCount, firstDueDate, description }
  Mantık: Plan oluştur + installmentCount kadar taksit otomatik hesapla
  
GET /api/payment-plans
  Query: patientId, status
  Rol: admin, billing, receptionist

GET /api/payment-plans/:id
  İçerik: plan + installments + patient + treatmentCase
  
POST /api/payment-plans/:id/installments/:installmentId/pay
  Mantık: 
    1. Payment kaydı oluştur (amount, currency, paymentMethod: body'den)
    2. Installment'ı paid yap + paymentId = yeni payment.id
    3. Tüm taksitler paid ise plan.status = 'completed'
    
DELETE /api/payment-plans/:id
  Soft: status = 'cancelled'
```

**Taksit hesaplama mantığı:**
```ts
function generateInstallments(plan: CreatePlanInput): InstallmentData[] {
  const baseAmount = Math.floor(plan.totalAmount / plan.installmentCount * 100) / 100;
  const remainder = +(plan.totalAmount - baseAmount * plan.installmentCount).toFixed(2);
  
  return Array.from({ length: plan.installmentCount }, (_, i) => ({
    installmentNo: i + 1,
    dueDate: addMonths(new Date(plan.firstDueDate), i),
    amount: i === plan.installmentCount - 1 
      ? baseAmount + remainder  // Son taksit kuruş farkını alır
      : baseAmount,
    status: 'pending',
  }));
}
```

### Frontend

**Yeni bileşenler:**
- `src/components/PaymentPlanForm.tsx` — hasta + toplam + taksit sayısı + ilk tarih
- `src/pages/PaymentPlans.tsx` veya Payments sayfasında ikinci sekme

**Taksit takvimi görünümü:**
```
┌──────────────────────────────────────────────────────────┐
│ 📅 Taksit Planı — Mehmet Demir                          │
│ Toplam: 12.000 ₺ · 6 Taksit · İlk Ödeme: 01 Haz 2026  │
├──────┬────────────────┬───────────┬──────────────────────┤
│  #   │ Vade Tarihi    │ Tutar     │ Durum                │
├──────┼────────────────┼───────────┼──────────────────────┤
│   1  │ 01 Haz 2026   │ 2.000 ₺  │ ✅ Ödendi            │
│   2  │ 01 Tem 2026   │ 2.000 ₺  │ ⚠️  Gecikmiş         │
│   3  │ 01 Ağu 2026   │ 2.000 ₺  │ 🕐 Bekliyor   [Öde] │
│   4  │ 01 Eyl 2026   │ 2.000 ₺  │ 🕐 Bekliyor          │
│   5  │ 01 Eki 2026   │ 2.000 ₺  │ 🕐 Bekliyor          │
│   6  │ 01 Kas 2026   │ 2.000 ₺  │ 🕐 Bekliyor          │
└──────┴────────────────┴───────────┴──────────────────────┘
```

**Gecikmiş taksit uyarısı — Dashboard'a entegrasyon:**
```ts
// dashboard.ts'e eklenecek
overdueInstallments: prisma.paymentPlanInstallment.count({
  where: {
    plan: { clinicId },
    status: 'pending',
    dueDate: { lt: new Date() }
  }
})
```

---

## Migration Planı

### Adım 1 (Sıfır migration — 4.3 + 4.1)
```
Sadece backend route + frontend sayfa — schema değişikliği yok
```

### Adım 2 (Minimal migration — 4.4)
```sql
-- Prisma migration üretir
ALTER TABLE "User" ADD COLUMN "commissionRate" FLOAT NOT NULL DEFAULT 0;
```

### Adım 3 (Büyük migration — 4.2)
```sql
-- Prisma migration üretir
CREATE TABLE "PaymentPlan" (...);
CREATE TABLE "PaymentPlanInstallment" (...);
ALTER TABLE "Payment" ADD COLUMN "installmentId" TEXT REFERENCES "PaymentPlanInstallment"("id");
-- Clinic, Patient, TreatmentCase'e ilişki FK'ları
```

---

## Bağımlılık Analizi

```
4.3 Gelir Raporu ──────────────────────────────── (bağımsız ✅)
4.1 Makbuz ────────────────────────────────────── (bağımsız ✅)
4.4 Komisyon ──── [User.commissionRate migrasyonu] (minimal bağımlılık)
4.2 Taksit ────── [4.3 tamamlanmış olmalı] ────── (4.3 bittikten sonra)
                  [4.4 Payment.practitionerId]
```

---

## Dosya Yapısı (tamamlandığında)

```
server/src/routes/
  payments.ts           ← mevcut (makbuz endpoint eklenecek)
  reports.ts            ← YENİ (4.3 + 4.4)
  paymentPlans.ts       ← YENİ (4.2)

src/pages/
  Payments.tsx          ← mevcut (Receipt butonu eklenecek)
  Reports.tsx           ← YENİ (4.3 + 4.4)
  PaymentPlans.tsx      ← YENİ (4.2)

src/components/
  ReceiptModal.tsx      ← YENİ (4.1)
  PaymentPlanForm.tsx   ← YENİ (4.2)
```

---

## i18n Anahtarları (eklenecek)

```json
// locales/tr/reports.json
{
  "title": "Raporlar",
  "revenue": "Gelir Raporu",
  "doctorPerformance": "Hekim Performansı",
  "dateFrom": "Başlangıç Tarihi",
  "dateTo": "Bitiş Tarihi",
  "totalRevenue": "Toplam Gelir",
  "pendingAmount": "Bekleyen Tahsilat",
  "exportCSV": "CSV İndir",
  "groupBy": { "day": "Günlük", "week": "Haftalık", "month": "Aylık" }
}

// locales/tr/paymentPlans.json
{
  "title": "Taksit Planları",
  "newPlan": "Yeni Taksit Planı",
  "totalAmount": "Toplam Tutar",
  "installmentCount": "Taksit Sayısı",
  "firstDueDate": "İlk Ödeme Tarihi",
  "overdue": "Gecikmiş",
  "markAsPaid": "Ödendi"
}
```

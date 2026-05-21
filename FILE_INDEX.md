# File Index

```txt
health-crm-agent-docs/
├─ AGENTS.md
├─ README.md
├─ docs/
│  ├─ 01-product-brief.md
│  ├─ 02-mvp-scope.md
│  ├─ 03-user-roles-permissions.md
│  ├─ 04-data-model.md
│  ├─ 05-modules-and-pages.md
│  ├─ 06-appointment-workflow.md
│  ├─ 07-messaging-reminders.md
│  ├─ 08-security-gdpr-health-data.md
│  ├─ 09-development-roadmap.md
│  ├─ 10-agent-task-list.md
│  ├─ 11-ui-design-guidelines.md
│  ├─ 12-agent-start-prompt.md
│  ├─ 13-comptario-inspired-health-crm-design-strategy.md
│  ├─ 15-i18n-strategy.md
│  ├─ 16-demo-guide.md
│  ├─ 17-security-and-demo-qa-report.md
│  ├─ 18-mvp-freeze-notes.md
│  ├─ 19-insurance-provision-tracking.md
│  ├─ 20-aile-dis-adaptation-plan.md
│  ├─ 21-whatsapp-n8n-clinic-integration.md
│  ├─ 22-hostinger-vps-postgres-deploy-plan.md
│  ├─ 23-finansal-yonetim-plan.md
│  ├─ 24-multitenant-plan.md
│  ├─ 25-multibranch-plan.md
│  ├─ 26-role-permissions.md
│  ├─ 27-sprint10-whatsapp-provider-abstraction.md  — Sprint 10: provider-agnostic WhatsApp mimarisi
│  ├─ 28-sprint11-whatsapp-inbox.md  — Sprint 11: paylaşımlı WA gelen kutusu, klinik çözümleme
│  ├─ 29-sprint12-finance-billing-dashboard.md  — Sprint 12: finans/fatura panosu, BILLING redirect
│  ├─ crm_improvement_plan.md
│  ├─ top_5_critical_plan.md
│  └─ whatsapp-evolution-backend-agent.md
└─ server/
   ├─ prisma/
   │  ├─ schema.prisma          — Ana Prisma veri modeli
   │  ├─ seed.ts                — Demo verisi
   │  └─ migrations/            — Veritabanı geçmiş migration'ları
   └─ src/
      ├─ index.ts               — Giriş noktası: Express başlatılır, middleware ve route'lar bağlanır (~50 satır)
      ├─ db.ts                  — Prisma singleton (paylaşılan istemci)
      ├─ middleware/
      │  └─ auth.ts               — authenticate / authorize middleware, AuthRequest tipi, generateToken
      ├─ routes/                — Domain'e göre ayrılmış route modülleri
      │  ├─ auth.ts              — POST /api/auth/login, GET /api/auth/me
      │  ├─ users.ts             — Kullanıcı CRUD, hekim müsaitliği yönetimi
      │  ├─ dashboard.ts         — GET /api/dashboard/stats
      │  ├─ patients.ts          — Hasta CRUD (soft-delete)
      │  ├─ services.ts          — Randevu tipleri ve hizmetler CRUD
      │  ├─ appointmentRequests.ts — Randevu talepleri (WhatsApp ve manuel)
      │  ├─ appointments.ts      — Randevu CRUD, durum geçişleri, örtüşme kontrolü
      │  ├─ tasks.ts             — Görev CRUD
      │  ├─ treatmentCases.ts    — Tedavi süreci CRUD
      │  ├─ insuranceProvisions.ts — Sigorta provizyon CRUD
      │  ├─ payments.ts          — Ödeme CRUD
      │  ├─ messages.ts          — Mesaj şablonları ve mesaj hazırlama
      │  ├─ whatsapp.ts          — WhatsApp public endpoint'leri ve konversasyon state machine
      │  ├─ organizationDashboard.ts — Org seviyesi metrikler (Sprint 9); getDateRange export
      │  ├─ organizationWhatsApp.ts  — WhatsApp bağlantı yönetimi (Sprint 10)
      │  ├─ whatsappInbox.ts     — Atanmamış WA gelen kutusu endpoint'leri (Sprint 11)
      │  └─ financeDashboard.ts  — GET /api/finance/dashboard (Sprint 12)
      ├─ schemas/
      │  └─ index.ts             — Tüm Zod doğrulama şemaları
      ├─ services/              — Dış servis entegrasyonları
      │  ├─ evolutionApi.ts      — WhatsApp mesaj gönderimi
      │  ├─ googleAiStudio.ts    — Yapay zeka metin çıkarma
      │  ├─ whatsappAvailability.ts — Müsaitlik slotları
      │  ├─ whatsappBookingFlow.ts  — Rezervasyon akış adımları
      │  ├─ whatsappInterpreter.ts  — Zaman/niyet yorumlama
      │  ├─ whatsappPublicApi.ts    — Public API şema ve doğrulama
      │  ├─ whatsappResolvedIntentRouter.ts — Çözümlenen niyet yönlendirmesi
      │  └─ whatsappWebhookPayload.ts    — Webhook payload normalizaşyonu
      ├─ utils/
      │  ├─ activity.ts          — logActivity yardımcısı
      │  ├─ helpers.ts           — Paylaşılan yardımcılar: zaman, şifre, müsaitlik
      │  ├─ roles.ts             — Backend rol/izin yardımcıları (canViewFinanceDashboard dahil)
      │  └─ whatsappDate.ts      — Türkçe tarih biçimlendirme
      └─ tests/                 — Birim ve entegrasyon testleri
         ├─ whatsappProvider.test.ts  — Sprint 10: provider soyutlama testleri (28 test)
         ├─ whatsappInbox.test.ts     — Sprint 11: gelen kutusu izin + çözümleme testleri (25 test)
         └─ financeDashboard.test.ts  — Sprint 12: finans panosu erişim + metrik testleri (24 test)
```
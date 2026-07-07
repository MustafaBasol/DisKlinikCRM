# NoraMedi Dental CRM — Ürün Analizi, Eksikler ve Yol Haritası

Tarih: 2026-07-05 (son güncelleme: 2026-07-05 — §5 iyileştirmelerinin büyük bölümü uygulandı, ✅ işaretli)
Kapsam: Kod tabanının tamamı (backend ~60 Prisma modeli, 40+ route; frontend tüm sayfalar + landing) incelendi; Türkiye ve global pazar araştırmasıyla karşılaştırıldı.

---

## 1. Mevcut Durum Özeti — Güçlü Yönler

Proje README'deki MVP tanımının çok ötesinde, olgun bir multi-tenant diş kliniği CRM'i:

- **Çekirdek CRM tam:** Hasta, randevu (FullCalendar, çakışma-güvenli müsaitlik), tedavi vakaları/pipeline, tedavi planı (FDI diş bazlı), **odontogram/dental chart mevcut**, görevler, no-show takibi.
- **Finans tam:** Ödemeler, taksitli ödeme planları, **hekim hakediş/prim/ödeme** (PractitionerEarning/Payout), sigorta provizyon takibi, finans dashboard'u.
- **Stok/envanter mevcut:** Malzeme–hizmet bağlantısı, düşük stok uyarısı, tedavi bazlı stok düşümü.
- **Mesajlaşma çok güçlü (ana farklılaştırıcı):** WhatsApp (Evolution + Meta Cloud, gerçek Graph API), Instagram DM, **AI konuşma ajanı + WhatsApp üzerinden randevu alma akışı**, Meta şablon onay workflow'u, recall/hatırlatma cron'ları, tedavi sonrası mesajlar.
- **KVKK/Privacy çok olgun (TR pazarı için farklılaştırıcı):** PatientPrivacyRequest, anonimleştirme, veri saklama temizlik job'ı, ClinicLegalProfile, public `/c/:slug/kvkk` sayfası, 6 adet legal sayfa, GDPR export.
- **Platform katmanı:** Platform admin (TOTP'li), plan CRUD, audit log, yedekleme, operasyonel izleme; güçlü tenant izolasyonu (`server/src/utils/clinicScope.ts`).
- **Güvenlik:** `SECURITY_TODO.md`'deki 22 maddenin neredeyse tamamı kapatılmış (tek açık: in-memory rate-limit state, yatay ölçekleme öncesi ertelenmiş).
- **Yeni:** Diş laboratuvarı iş emri takibi (Laboratory, LabWorkOrder, durum akışı + revizyon döngüsü).
- **i18n:** 4 dil (tr/en/de/fr), ~35 namespace — sağlık turizmi için hazır altyapı.

## 2. Başarı İçin Kritik Eksikler (Önceliklendirilmiş)

### P0 — Türkiye'de satış için yasal/ticari blokerlar

| # | Eksik | Neden kritik |
|---|-------|--------------|
| 1 | **e-Nabız / MBYS (DHBS) entegrasyonu** | Özel ağız-diş sağlığı kuruluşları için Bakanlık merkezi sistemlerine veri gönderimi **yasal zorunluluk**. Asistdent, Macrodental, DentalBulut, Medibulut hepsinde var. Bu olmadan klinikler ikinci bir yazılım kullanmak zorunda kalır. |
| 2 | **e-SMM / e-Fatura / e-Arşiv** | Muayenehane hekimleri için e-SMM 2020'den beri zorunlu. Rakiplerde "5 saniyede e-SMM kes" standart özellik. Bizde hiç yok (lab maliyeti bile sadece referans alanı). GİB entegratörü (Paraşüt/BirFatura/Foriba vb. API) ile çözülür. |
| 3 | **Gerçek SMS sağlayıcıları** | Altyapı (routing, kota, consent, şifreli config) production-ready ama `server/src/services/sms/smsProviders.ts` sadece mock kayıtlı. NetGSM/İleti Merkezi (TR) + Twilio (EU) adaptörleri yazılmalı. |
| 4 | **Müşteri tarafı abonelik/ödeme** | PlatformPlans (admin CRUD) var ama kiracı kliniğin plan görme/yükseltme/fatura ekranı ve ödeme sağlayıcısı (iyzico/Stripe) **yok**. SaaS olarak gelir toplanamaz. Settings'e "billing" sekmesi + public pricing sayfası gerekli. |
| 5 | **Landing demo formu ölü** | `src/components/landing/DemoCtaSection.tsx` hiçbir yere POST etmiyor — gelen her lead sessizce kayboluyor. In-app ContactRequests altyapısı hazır; bağlamak küçük iş, etkisi büyük. |

### P1 — Operasyonel olgunluk

1. **CI/CD yok** — `.github/workflows` yok; ~55 test dosyası var ama manuel `tsx` script'leri, assertion framework'ü ve coverage yok. GitHub Actions ile test+build pipeline şart.
2. **Frontend testi sıfır.**
3. **Global ErrorBoundary yok** — lazy sayfada render hatası tüm uygulamayı beyaz ekrana düşürüyor.
4. **e-Reçete** — README'de bilinçli kapsam dışı, ancak hekim reçete yazıyorsa yasal gereklilik; en azından yol haritasına alınmalı.
5. **Rate-limit state in-memory** (SECURITY_TODO #6) — yatay ölçekleme öncesi Redis'e taşınmalı.
6. **Docker yok** — runbook dokümanı var (docs/35), Dockerfile yok; dağıtım PM2 + bash script.

## 3. Rakiplerde Olup Bizde Olmayan Özellikler

Kaynaklar: Dentrix/CareStack/Curve/Open Dental karşılaştırmaları; TR: DentalBulut, Asistdent, Macrodental, BulutKlinik, Dental Asistanım, TDENT.

| Özellik | Kimde var | Not |
|---------|-----------|-----|
| e-Nabız/MBYS veri gönderimi | Tüm ciddi TR rakipleri | P0 (yukarıda) |
| e-SMM / e-Fatura | Asistdent, DentalBulut, Macrodental | P0 |
| e-Reçete | Asistdent, Macrodental | P1 |
| **Görüntüleme/röntgen (DICOM/PACS, panoramik)** | Dentrix, Open Dental, CareStack | Bizde sadece jenerik dosya eki. En azından görüntü galerisi + DICOM viewer entegrasyonu düşünülmeli. |
| **Hasta onam formları + e-imza / tablet imza** | mConsent, CareStack, çoğu TR rakibi | Bizde consent sadece boolean; imzalı PDF üretimi + tablet/parmak imza büyük eksik (KVKK açısından da kanıt değeri). |
| **Harici takvim senkronu (Google/Outlook/iCal)** | Curve, CareStack, çoğu bulut PMS | FullCalendar sadece dahili. Hekimler kişisel takvimlerinde görmek istiyor. |
| **Hasta portalı / mobil uygulama** | CareStack (kiosk+portal), Curve | Bizde sadece public booking. README'de non-goal ama orta vadede rekabet gereksinimi. |
| **Gelişmiş raporlama/BI** | Dental Intelligence, CareStack | Bizde temel dashboard + reports; kohort analizi, hekim performans kıyası, pazarlama ROI, özelleştirilebilir rapor yok. |
| Online ödeme / pay-by-text | CareStack (card-on-file, text-to-pay) | Taksit planı var ama hastaya online tahsilat linki yok (iyzico link ile kolay eklenir). |
| Sigorta claim otomasyonu | US PMS'lerde standart | Bizde provizyon takibi manuel-destekli. |
| Teledentistry / video görüşme | 2026 trendi | Nice-to-have. |

## 4. Kimsede Olmayan / Değer Katacak Farklılaştırıcılar

Mevcut AI + WhatsApp altyapısı TR pazarında zaten benzersiz; bunun üstüne inşa edilecekler:

1. **AI WhatsApp randevu ajanını pazarlamanın merkezine koymak** — TR rakiplerinin hiçbirinde iki yönlü AI WhatsApp asistanı yok; landing'de "7/24 WhatsApp'tan randevu alan AI asistan" olarak öne çıkarılmalı.
2. **AI no-show tahmini** — mevcut no-show verisiyle risk skoru + riskli hastaya otomatik ekstra hatırlatma. Global trend, TR'de yok.
3. **AI tedavi planı sunumu** — tedavi planından hastaya WhatsApp'la gönderilebilen görsel/PDF fiyat teklifi; kabul oranı takibi (mevcut TreatmentCase pipeline verisiyle uyumlu).
4. **Boş koltuk doldurma** — iptal olduğunda bekleme listesindeki uygun hastaya otomatik WhatsApp teklifi (recall + iptal listesi otomasyonu).
5. **Google Reviews / itibar yönetimi** — tedavi sonrası mesaj altyapısı hazır; memnun hastaya otomatik Google yorum linki, düşük puanı içeride yakalama.
6. **Üyelik/bakım planları (membership)** — sigortasız hastalar için klinik içi yıllık bakım aboneliği modülü (US'de büyüyen model, TR'de kimsede yok).
7. **Sağlık turizmi konumlandırması** — 4 dil desteği hazır; yabancı hasta pasaport/uçuş/konaklama alanları eklenerek "sağlık turizmi modülü" olarak paketlenebilir.
8. **Laboratuvar portalı** — LabWorkOrder altyapısının üstüne laboratuvarın kendisinin durum güncellediği basit bir public link; kimsede yok.

## 5. Landing Page ve Sayfa İyileştirmeleri

### Landing (kritik)

1. ✅ **Fiyatlandırma bölümü** — YAPILDI (2026-07-05): yeni `src/components/landing/PricingSection.tsx` (`#pricing`), 3 plan kartı (Başlangıç ₺1.490/ay, Profesyonel ₺2.990/ay "En Popüler", Kurumsal özel teklif), 4 dilde i18n. Fiyatlar/özellikler `src/locales/*/landing.json` içinde placeholder — gerçek fiyat politikası netleşince güncellenmeli. PlatformPlans verisine dinamik bağlama ileriye dönük iş olarak duruyor.
2. **Demo formu backend'e bağlanmalı** (P0 #5) — hâlâ açık.
3. ✅ **Sosyal kanıt** — YAPILDI (2026-07-05): yeni `src/components/landing/SocialProofSection.tsx`; 4 ürün istatistiği + 3 temsili kullanıcı görüşü ("erken erişim senaryolarını yansıtır" notuyla). Gerçek müşteri yorumları geldiğinde sadece locale JSON güncellenecek.
4. ✅ **Mobil hamburger menü** — YAPILDI (2026-07-05): `LandingHeader.tsx`'e aria etiketli hamburger menü eklendi; tüm nav linkleri + Giriş + Demo CTA, tıklamada kapanıyor. Nav ve footer'a Fiyatlandırma linki de eklendi.
5. Landing'deki dashboard/şube rakamları hardcoded demo verisi (`src/data/landing.ts`) — hâlâ açık.
6. İletişim bilgisi (adres/telefon/e-posta) hiçbir yerde yok — hâlâ açık.

### SEO

- ✅ `robots.txt` + `sitemap.xml` — YAPILDI (2026-07-05): `public/robots.txt` (uygulama içi rotalar Disallow, sitemap referanslı) ve `public/sitemap.xml` (landing + 6 legal sayfa).
- ✅ Canonical + JSON-LD — YAPILDI (2026-07-05): `index.html`'e canonical ve `og:url`; `LandingPage.tsx`'e `SoftwareApplication` + SSS içeriğinden üretilen `FAQPage` şeması (dil değişiminde yenileniyor).
- ✅ `<html lang>` — YAPILDI (2026-07-05): `src/i18n/config.ts` `languageChanged` olayıyla `lang` attribute'unu senkronluyor.
- SPA client-render — crawler boş `#root` görüyor; landing + legal sayfalar için prerender/SSR düşünülmeli — hâlâ açık.
- Mevcut iyi durum: title, description, OG/Twitter tag'leri, manifest, favicon'lar tamam.

### Uygulama içi

- ✅ **Ölü link** — YAPILDI (2026-07-05): `Dashboard.tsx`'teki `/activity-logs` linki `/operations`'a yönlendirildi ve `canViewOperations` ile yetki bazlı gizleniyor.
- ✅ **Dark mode tutarsızlığı** — YAPILDI (2026-07-05): admin `Dashboard.tsx`'in tamamına (başlık, KPI/operasyonel kartlar, ajanda tablosu, aktivite akışı, grafik başlıkları, özet kartlar) DoctorDashboard ile tutarlı `dark:` sınıfları eklendi.
- `alert()` ile hata gösterimi (örn. `src/pages/platform/PlatformPlans.tsx:82`) → toast sistemine geçirilmeli — hâlâ açık.
- ✅ **Onboarding kurulum checklist'i** — YAPILDI (2026-07-05): yeni `src/components/SetupChecklist.tsx`; yönetici rollerine Dashboard'da 5 adımlık kurulum kartı (klinik bilgileri, ekip, hizmetler, ilk hasta, ilk randevu), ilerleme çubuğu, kapatılabilir; durum klinik bazında localStorage'da (backend değişikliği yok). Tam kayıt-sonrası sihirbaz ileriye dönük iş.
- Settings'te **billing sekmesi yok** (P0 #4 ile bağlantılı) — hâlâ açık.

## 6. Önerilen Öncelik Sırası (Yol Haritası)

1. **Hafta 1-2 (hızlı kazanımlar):** ~~landing pricing bölümü; sosyal kanıt; robots.txt + sitemap + JSON-LD; mobil menü; ölü link + dark mode düzeltmeleri; onboarding checklist~~ ✅ tamamlandı (2026-07-05). Kalan: Demo formu → ContactRequests bağlantısı; global ErrorBoundary.
2. **Ay 1:** Gerçek SMS adaptörleri (NetGSM + Twilio); CI pipeline (GitHub Actions); iyzico entegrasyonu + tenant billing sekmesi + public pricing sayfası.
3. **Ay 2-3:** e-SMM/e-Fatura entegratör entegrasyonu; e-imzalı onam formları; Google Calendar senkronu; Google Reviews otomasyonu.
4. **Ay 3-6:** e-Nabız/MBYS entegrasyonu (en büyük iş, ama TR'de ölçek için şart); gelişmiş raporlama; AI no-show tahmini; sağlık turizmi konumlandırması.

## 7. Uygulama Günlüğü

### 2026-07-05 — §5 hızlı kazanımlar (branch: feature/dental-lab-tracking, henüz commit'lenmedi)

Kısıtlar: yapısal değişiklik yok, marka renkleri/tutarlılığı korundu (mevcut `landing.css` değişkenleri ve uygulama içi `card`/`primary` sistemi kullanıldı). Doğrulama: `tsc --noEmit` temiz, `npm run build` başarılı.

**Yeni dosyalar:**
- `src/components/landing/PricingSection.tsx` — fiyatlandırma bölümü
- `src/components/landing/SocialProofSection.tsx` — sosyal kanıt bölümü
- `src/components/SetupChecklist.tsx` — onboarding kurulum checklist'i
- `public/robots.txt`, `public/sitemap.xml`

**Güncellenen dosyalar:**
- `src/components/landing/LandingHeader.tsx` (mobil menü + pricing linki), `LandingFooter.tsx` (pricing linki)
- `src/pages/LandingPage.tsx` (yeni bölümler + JSON-LD enjeksiyonu)
- `index.html` (canonical, og:url), `src/i18n/config.ts` (lang senkronu)
- `src/pages/Dashboard.tsx` (ölü link → /operations, dark mode, SetupChecklist)
- `src/locales/{tr,en,de,fr}/landing.json` ve `dashboard.json` (yeni metinler, 4 dil)

**Sonradan gözden geçirilecek:** pricing tutarları ve testimonial metinleri locale dosyalarında placeholder.

## Kaynaklar

- [Dentrix Alternatives 2026 (Dentra)](https://www.getdentra.com/resources/guides/dentrix-alternatives)
- [Top Dental PMS 2026 (Titan)](https://blog.titanwebagency.com/dental-management-software-reviews)
- [Open Dental vs CareStack (Capterra)](https://www.capterra.com/compare/122350-176206/Open-Dental-vs-CareStack)
- [2026 Dental Tech Trends (Patientdesk)](https://www.patientdesk.ai/blog/top-dental-technology-trends-transforming-practices-in-2026)
- [Cloud & AI in dentistry 2026 (Oral Health Group)](https://www.oralhealthgroup.com/features/tech-stack-revolution-cloud-and-ai-in-dentistry-for-2026/)
- [Diş hekimleri e-SMM/e-Fatura (İşbaşı)](https://isbasi.com/blog/dis-hekimleri-icin-e-smm-ve-e-fatura-kullanimi)
- [MBYS veri gönderimi zorunluluğu (Uludağ Bilişim)](https://www.uludagbilisim.com/haber/mbys-veri-gonderimi-zorunlulugu-434)
- [e-Nabız/MBYS (Medibulut)](https://kys.medibulut.com/ozellikler/enabiz-mbys-uss)
- TR rakipler: [Asistdent](https://asistdent.com/), [DentalBulut](https://www.dentalbulut.com/en), [Macrodental](https://macrodental.com.tr/), [BulutKlinik](https://bulutklinik.com/for-doctors), [TDENT](https://tdent.com.tr/), [Dr.DENTES](https://drdentes.com.tr/tr/)

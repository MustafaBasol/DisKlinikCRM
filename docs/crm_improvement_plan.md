# Diş Klinik CRM — Geliştirme Planı

> **Mevcut Durum:** MVP tamamlanmış, Aile Diş kliniğine uyarlanmış, 20 fazlık geliştirme süreci başarıyla bitirilmiş. WhatsApp n8n entegrasyonu, doktor müsaitlik yönetimi, sigorta/provizyon takibi, çok dilli destek (TR/EN/FR/DE) ve rol bazlı erişim kontrolü mevcut.

> **Son Güncellemeler (Mayıs 2026):** FullCalendar drag&drop takvim ✅, çoklu hekim yan yana görünüm ✅, CRM'den WhatsApp gönderimi ✅, otomatik hatırlatma cron job ✅, backend route modülerleştirme ✅, mobil responsive iyileştirmeler ✅, **Finansal Yönetim tamamlandı** (makbuz yazdırma ✅, taksit planı ✅, gelir raporu + CSV export ✅, hekim performans & komisyon takibi ✅), **Hekim Kazanç Yönetimi tamamlandı** (komisyon kural motoru ✅, kazanç oto-hesaplama ✅, onaylama/düzenleme/ödeme akışı ✅, doktor kişisel kazanç görünümü ✅)

---

## 📊 Mevcut MVP'de Tamamlanan Modüller

| Modül | Durum |
|-------|-------|
| Kimlik doğrulama & RBAC | ✅ |
| Dashboard & Metrikler | ✅ |
| Hasta Yönetimi (CRUD + timeline) | ✅ |
| Randevu & Aylık Takvim | ✅ |
| Hekim Müsaitlik Yönetimi | ✅ |
| Hizmet Kataloğu | ✅ |
| Tedavi Pipeline (aşama takibi) | ✅ |
| Ödeme Takibi | ✅ |
| Görev Yönetimi | ✅ |
| Mesaj Şablonları (SMS/WhatsApp/E-posta) | ✅ |
| Sigorta/Provizyon Takibi | ✅ |
| WhatsApp Randevu Talep Hattı (n8n) | ✅ |
| Aktivite Logları | ✅ |
| Kullanıcı & Hekim Yönetimi | ✅ |
| Deploy Planı (Hostinger VPS) | ✅ |

---

## 🚀 Kategori 1: UX / UI İyileştirmeleri ✅ TAMAMLANDI

### 1.1 — Drag & Drop Haftalık/Günlük Takvim ✅ TAMAMLANDI
- **Durum:** `@fullcalendar/react` + `@fullcalendar/interaction` kurulu. `editable`, `eventDrop`, `eventResize` aktif. CalendarTimelineView ve Appointments sayfalarında haftalık/günlük görünüm çalışıyor.
- **Hedef:** FullCalendar veya benzeri bir bileşenle haftalık/günlük görünüm. Randevuyu sürükleyerek saatini değiştirme.
- **Etki:** ⭐⭐⭐⭐⭐ — Kliniklerin en çok istediği özellik
- **Zorluk:** Orta
- **Tavsiye:** `@fullcalendar/react` kütüphanesi ile hızlı implementasyon

### 1.2 — Karanlık Mod (Dark Mode) ✅ TAMAMLANDI
- **Durum:** `tailwind.config.js`'e `darkMode: 'class'` eklendi. `index.html`'e tema tespiti scripti eklendi (localStorage + sistem tercihi, flash olmadan). `src/utils/darkMode.ts` hook'u oluşturuldu (`useDarkMode`: localStorage + sistem tercihi yönetimi). `index.css`'de `.card`, `.btn-secondary`, `.input-field`, `.label`, `body` için dark varyantlar eklendi. `MainLayout.tsx`'te sidebar, header, nav, dil seçici dark uyumlu hale getirildi. Header'a Moon/Sun toggle butonu eklendi.
- **Hedef:** Tailwind dark mode desteği, sistem tercihine göre otomatik geçiş
- **Etki:** ⭐⭐⭐ — Modern görünüm, gece çalışan personel için konfor
- **Zorluk:** Orta

### 1.3 — Mobil Uyumluluk (Responsive İyileştirmeler) ✅ TAMAMLANDI
- **Durum:** Mobil drawer sidebar (overlay), Patients/Payments tablo sütun gizleme (`hidden sm/md:table-cell`), form padding ve grid gap responsive, MainLayout sayfa içeriği `p-4 sm:p-6 lg:p-8` uygulandı.
- **Hedef:** Doktor cebinden randevu listesi, hasta bilgisi görüntüleme. Mobil-first kart görünümleri.
- **Etki:** ⭐⭐⭐⭐⭐ — Doktorlar genelde cep telefonundan bakar
- **Zorluk:** Orta-Yüksek

### 1.4 — Küresel Arama (Global Search) ✅ TAMAMLANDI
- **Durum:** `GlobalSearch.tsx` bileşeni oluşturuldu. `Ctrl+K` / `Cmd+K` ile açılıyor. Hastalar, randevular, tedavi vakalarında paralel arama (300ms debounce, min 2 karakter). Klavye navigasyonu (↑↓ Enter Esc). Sonuçlar tip bazlı gruplandırılıyor. `MainLayout.tsx` header'ına arama tetikleyici butonu eklendi.
- **Hedef:** `Cmd+K` / `Ctrl+K` ile hastalar, randevular, tedaviler arasında anlık arama
- **Etki:** ⭐⭐⭐⭐ — Resepsiyon hızını dramatik artırır
- **Zorluk:** Orta

### 1.5 — Bildirim Merkezi (Notification Center) ✅ TAMAMLANDI
- **Durum:** Backend `GET /api/notifications` endpoint'i oluşturuldu: sonraki 2 saatteki randevular (admin/receptionist tümü, doctor kendi randevularını), gecikmiş görevler, bekleyen randevu talepleri. `NotificationBell.tsx` bileşeni: 60 sn polling, klık dışı kapanma, tip bazlı renkli ikonlar (Calendar/CheckSquare/CalendarPlus), okunmamış badge. `MainLayout.tsx`'teki statik Bell butonu NotificationBell ile değiştirildi. Dark mode uyumlu.
- **Hedef:** Yakışan randevular, gecikmmiş görevler, yeni WhatsApp talepleri için in-app bildirim çanı
- **Etki:** ⭐⭐⭐⭐ — Proaktif operasyon yönetimi
- **Zorluk:** Orta

---

## 📅 Kategori 2: Takvim & Randevu Geliştirmeleri

### 2.1 — Çoklu Hekim Yan Yana Takvim ✅ TAMAMLANDI
- **Durum:** `MultiDoctorDayView.tsx` bileşeni mevcut. Günlük görünümde her hekim ayrı kolonda, saat satırları sabit sol sütunda. `overflow-x-auto` ile mobil kaydırma destekli.
- **Hedef:** Günlük görünümde tüm hekimlerin kolonlarını yan yana göster
- **Etki:** ⭐⭐⭐⭐⭐ — Resepsiyonun en kritik ihtiyacı
- **Zorluk:** Orta-Yüksek

### 2.2 — Tekrarlayan Randevu Desteği
- **Mevcut:** Her randevu tek seferlik
- **Hedef:** "Her hafta Salı 14:00" gibi tekrarlayan seri randevular (özellikle ortodonti tedavileri için)
- **Etki:** ⭐⭐⭐⭐ — Uzun tedavi süreçlerinde zaman kazandırır
- **Zorluk:** Orta

### 2.3 — Bekleme Listesi (Waitlist)
- **Mevcut:** Yok
- **Hedef:** Doluluk nedeniyle randevu verilemeyen hastalar için bekleme listesi. İptal olduğunda otomatik bildirim.
- **Etki:** ⭐⭐⭐ — Doluluk oranını artırır
- **Zorluk:** Düşük-Orta

### 2.4 — Randevu Onay Akışı (SMS/WhatsApp) ✅ TAMAMLANDI
- **Durum:** Tam iki yönlü onay akışı tamamlandı.
  - Otomatik hatırlatma cron job (5.2) aktif — yarınki randevular her gün saat 10:00'da WhatsApp ile gönderiliyor.
  - Fallback hatırlatma mesajına "EVET / HAYIR yazarak onaylayın/iptal edin" talimatı eklendi.
  - WhatsApp webhook'a erken EVET/HAYIR algılama eklendi: hasta aktif booking flow dışında "EVET" yazarsa → son 48 saatteki hatırlatma için `scheduled` randevu bulunup `confirmed` yapılıyor. "HAYIR" yazarsa → `cancelled` yapılıp activity log oluşturuluyor.
  - UI'da (Appointments.tsx) `scheduled` randevular için ✓ (Onayla) ve ✗ (İptal) butonları zaten mevcut.
- **Hedef:** n8n üzerinden otomatik randevu hatırlatma gönderimi (24 saat önce) ve hasta onay/iptal yanıtı
- **Etki:** ⭐⭐⭐⭐⭐ — No-show oranını %30-40 azaltır
- **Zorluk:** Orta (n8n zaten kurulu)

### 2.5 — Randevu Renk Kodlaması ✅ TAMAMLANDI
- **Durum:** `STATUS_BORDER_COLORS` haritası oluşturuldu: scheduled=sarı, confirmed=yeşil, in_progress=mavi, completed=gri, cancelled=kırmızı, no_show=turuncu. `CalendarTimelineView.tsx`'te takvim olaylarına `borderColor` uygulandı, durum dot göstergesi + hasta/hizmet/hekim adı içerik render'ı eklendi. `Appointments.tsx` liste kartlarına sol kenarlık rengi eklendi.
- **Hedef:** Durum bazlı renk + hizmet bazlı renk kombinasyonu, takvimde görsel zenginlik
- **Etki:** ⭐⭐⭐ — Hızlı görsel tarama
- **Zorluk:** Düşük

---

## 👤 Kategori 3: Hasta Deneyimi & Yönetimi

### 3.1 — Hasta Portalı (Self-Service Randevu)
- **Mevcut:** MVP'de açıkça kapsam dışı bırakılmış
- **Hedef:** Basit bir web sayfası: Hasta adı + telefon ile giriş → mevcut randevularını görme, yeni randevu talebi oluşturma
- **Etki:** ⭐⭐⭐⭐ — Resepsiyon yükünü azaltır
- **Zorluk:** Yüksek
- **Not:** MVP sonrası Phase 2 özelliği olarak değerlendirilebilir

### 3.2 — Hasta Dosya Ekleri ✅ TAMAMLANDI
- **Durum:** Prisma `PatientAttachment` modeli eklendi (clinicId, patientId, fileName, originalName, fileSize, mimeType, filePath, uploadedById). `multer` ile disk storage (10 MB limit, izin verilen MIME: JPEG/PNG/GIF/WebP/PDF/Word). Backend route `server/src/routes/attachments.ts`: `POST /patients/:id/attachments` (yükle), `GET` (liste), `GET .../download` (indirme stream), `DELETE` (sil + disk'ten kaldır). IDOR koruması (clinicId kontrolü). `PatientDetail.tsx`'e "Dosyalar" sekmesi eklendi: dosya listesi (PDF/resim ikon), yükleme butonu, indirme linki, silme butonu (admin/receptionist).
- **Hedef:** PDF teklif, onam formu, panoramik röntgen gibi dosyaları hasta veya tedavi kaydına ekleme
- **Etki:** ⭐⭐⭐⭐ — Klinik operasyonlarında kritik
- **Zorluk:** Orta

### 3.3 — Hasta Birleştirme (Merge Duplicates)
- **Mevcut:** WhatsApp'tan gelen hastalar telefon ile eşleşiyor, ama manuel yinelenen kayıtlar olabilir
- **Hedef:** İki hasta kaydını birleştirerek randevu/ödeme/tedavi geçmişini tek kayıtta toplama
- **Etki:** ⭐⭐⭐ — Veri temizliği
- **Zorluk:** Orta

### 3.4 — Hasta Etiketleri (Tags)
- **Mevcut:** Sadece `source` ve `patientStatus` alanları var
- **Hedef:** Özel etiketler: "VIP", "Fobik Hasta", "Sigortalı", "Ortodonti Adayı" gibi. Filtreleme ve segmentasyon.
- **Etki:** ⭐⭐⭐⭐ — Hedefli iletişim ve pazarlama
- **Zorluk:** Düşük

### 3.5 — Diş Haritası (Dental Chart) — Basit Versiyon ✅ TAMAMLANDI
- **Mevcut:** 32 dişlik interaktif FDI haritası. Her dişe durum (planned/treated/issue/missing/crown/implant) ve not eklenebilir.
- **Hedef:** ~~32 dişlik interaktif görsel harita. Her dişe kısa not/durum ekleyebilme.~~ **Tamamlandı.**
- **Uygulama:** ToothRecord Prisma modeli (FDI notasyonu, upsert), backend `/api/patients/:id/dental-chart` (GET/PUT/DELETE), `DentalChart.tsx` bileşeni (renk kodlamalı, popover editör, özet tablo), PatientDetail "Diş Haritası" sekmesi
- **Etki:** ⭐⭐⭐⭐⭐ — Diş klinikleri için çok güçlü satış argümanı
- **Zorluk:** Yüksek

---

## 💰 Kategori 4: Finansal Yönetim ✅ TAMAMLANDI

### 4.1 — Fatura / Makbuz Oluşturma ✅ TAMAMLANDI
- **Durum:** Backend `GET /api/payments/:id/receipt` endpoint'i oluşturuldu (klinik, hasta, tedavi bilgilerini döner). `ReceiptModal.tsx` bileşeni: `window.print()` ile yazdırma desteği, `@media print` CSS ile modal dışı her şeyi gizleme. Makbuz içeriği: klinik header, makbuz no, hasta bilgisi, ödeme detayı tablosu, tutar kutusu. `Payments.tsx` listesine her ödeme satırı için makbuz butonu eklendi.
- **Hedef:** ~~Basit bir PDF makbuz/fatura şablonu. Hasta adı, hizmetler, tutar, ödeme yöntemi.~~
- **Etki:** ⭐⭐⭐⭐ — Yasal zorunluluk (muhasebe entegrasyonuna alternatif)
- **Zorluk:** Orta

### 4.2 — Taksit Planı ✅ TAMAMLANDI
- **Durum:** Prisma `PaymentPlan` + `PaymentPlanInstallment` modelleri eklendi (migration: `financial_management_phase1`). Backend `paymentPlans.ts` route'u: liste, detay, oluşturma (otomatik taksit hesaplama), taksit ödeme (Payment kaydı oluşturur), plan iptal. `PaymentPlanForm.tsx`: hasta seçimi, tutar, taksit sayısı, ilk vade tarihi, önizleme tablosu. `PaymentPlans.tsx` sayfası: ilerleme çubukları, genişletilebilir taksit tablosu, "Ödendi" akışı (ödeme yöntemi seçimi), gecikmiş taksit renklendirme, plan iptal. Sidebar'a "Taksit Planları" eklendi.
- **Hedef:** ~~Tedavi toplamını taksitlere bölme, ödeme takvimi oluşturma, gecikme uyarısı.~~
- **Etki:** ⭐⭐⭐⭐ — Yüksek tutarlı tedaviler (implant, ortodonti) için kritik
- **Zorluk:** Orta

### 4.3 — Gelir-Gider Raporu ✅ TAMAMLANDI
- **Durum:** Backend `reports.ts` route'u: `GET /api/reports/revenue` (tarih aralığı, gruplama: gün/hafta/ay, hekim ve yöntem filtresi), `GET /api/reports/revenue/export.csv` (BOM'lu CSV, Excel Türkçe uyumlu), özet metrikler (toplam gelir, ortalama ödeme, bekleyen tahsilat). `Reports.tsx` sayfası: BarChart (dönemsel), PieChart (yöntem dağılımı), hekim bazlı gelir listesi, detay tablosu, "CSV İndir" butonu. Sidebar'a "Raporlar" eklendi (admin/billing rolü).
- **Hedef:** ~~Tarih aralığı seçerek hekim bazlı, hizmet bazlı gelir raporu. CSV/PDF export.~~
- **Etki:** ⭐⭐⭐⭐ — Klinik sahibinin en çok baktığı veri
- **Zorluk:** Orta

### 4.4 — Hekim Performans ve Komisyon Takibi ✅ TAMAMLANDI
- **Durum:** `User` modeline `commissionRate Float @default(0)` alanı eklendi. `GET /api/reports/doctor-performance` endpoint'i: hekim başına randevu sayısı, tamamlanma oranı, no-show sayısı, açılan/tamamlanan tedavi vakaları, üretilen gelir, komisyon tutarı (gelir × commissionRate). `Reports.tsx`'te "Hekim Performansı" sekmesi: her hekim için metrik kartları, tamamlanma çubuğu.
- **Hedef:** ~~Hekim başına randevu sayısı, tamamlanan tedavi sayısı, üretilen gelir, komisyon hesaplama.~~
- **Etki:** ⭐⭐⭐⭐ — Çok hekimli klinikler için önemli
- **Zorluk:** Orta

### 4.5 — Hekim Kazanç Yönetimi ✅ TAMAMLANDI
- **Durum:** Tam komisyon kural motoru ve kazanç takip modülü eklendi.
  - **Veritabanı:** 4 yeni Prisma modeli — `PractitionerCompensationRule` (sabit/yüzde/sabit+yüzde/hizmet bazlı, tahsilat/fatura bazı), `ServiceCompensationRule` (hizmet başına özel oran), `PractitionerEarning` (kazanç kaydı, onay/düzeltme/ödeme durumu), `PractitionerPayout` (toplu ödeme kaydı). Migration: `20260518141910_practitioner_earnings`.
  - **Backend:** `compensationRules.ts` (7 endpoint CRUD), `practitionerEarnings.ts` (7 endpoint — liste/özet/onay/düzenleme/iptal/ödendi), `practitionerPayouts.ts` (4 endpoint). `earningService.ts`: ödeme `paid` durumuna geçince veya tedavi vakası `completed` olunca kazanç otomatik oluşturulur (idempotent).
  - **Frontend:** `PractitionerEarnings.tsx` — admin/billing için 4 sekmeli yönetim sayfası (Dönem Özeti, Kazanç Listesi, Ödemeler, Komisyon Ayarları). `MyEarnings.tsx` — doktor rolü için salt okunur kişisel kazanç görünümü.
  - **RBAC:** admin/billing tam erişim; doctor yalnızca kendi kazançlarını görür; receptionist erişemez.
- **Etki:** ⭐⭐⭐⭐⭐ — Çok hekimli kliniklerde şeffaf ve otomatik hak ediş yönetimi
- **Zorluk:** Yüksek

---

## 📨 Kategori 5: İletişim & Mesajlaşma

### 5.1 — Gerçek WhatsApp Business API Entegrasyonu ✅ TAMAMLANDI
- **Durum:** `POST /api/messages/:id/send` endpoint aktif. `evolutionApi.sendTextMessage()` ile CRM'den doğrudan WhatsApp gönderimi yapılıyor. Şablon mesajları "sent" durumuna geçiyor. `PrepareMessageModal` üzerinden tek tıkla gönderim mevcut.
- **Hedef:** CRM'den tek tıkla WhatsApp mesajı gönderme. Şablon mesajları "sent" durumuna geçirme.
- **Etki:** ⭐⭐⭐⭐⭐ — Mesajlaşma modülünün asıl amacı
- **Zorluk:** Orta (n8n altyapısı hazır)

### 5.2 — Otomatik Hatırlatma Kuyruk Sistemi (Cron Jobs) ✅ TAMAMLANDI
- **Durum:** `server/src/jobs/reminders.ts` — `node-cron` ile her gün 10:00'da çalışıyor. Tüm klinikler taranıyor, yarınki `scheduled`/`confirmed` randevular için mesaj şablonu render edilerek `evolutionApi` üzerinden gönderiliyor. İdempotans kontrolü, `SentMessage` kaydı ve `ActivityLog` mevcut.
- **Hedef:** Her gece çalışan bir job: yarınki randevulara otomatik hatırlatma, gecikmiş ödemelere uyarı
- **Etki:** ⭐⭐⭐⭐⭐ — No-show ve tahsilat performansını otomatik iyileştirir
- **Zorluk:** Orta

### 5.3 — E-posta Entegrasyonu (SMTP)
- **Mevcut:** Şablon mevcut, gönderim bağlı değil
- **Hedef:** Nodemailer ile SMTP gönderim. Randevu özeti, teklif, makbuz gönderimi.
- **Etki:** ⭐⭐⭐ — WhatsApp'a ek kanal
- **Zorluk:** Düşük

### 5.4 — WhatsApp Konuşma Geçmişi Görünümü ✅ TAMAMLANDI
- **Durum:** `PatientDetail.tsx`'te ayrı bir "WhatsApp" sekmesi mevcut. `whatsappConversationMessages` verisi patient API'den yükleniyor. Yön filtresi (tümü/gelen/giden), metin arama, chat baloncukları (gelen=yeşil, giden=mavi), mesaj sayısı özeti — tümü aktif.
- **Hedef:** Hasta detayında WhatsApp konuşma geçmişini chat baloncukları olarak göster
- **Etki:** ⭐⭐⭐⭐ — Hasta ile iletişim bağlamı
- **Zorluk:** Düşük-Orta

---

## 📈 Kategori 6: Raporlama & Analitik

### 6.1 — Gelişmiş Dashboard Grafikleri ✅ TAMAMLANDI
- **Durum:** `recharts` kuruldu. `Dashboard.tsx`'e 3 grafik eklendi: **Haftalık Randevu Trendi** (BarChart, son 7 gün), **Hizmet Dağılımı** (PieChart/donut, bu ay, dinamik renkler), **Aylık Gelir Trendi** (LineChart, son 6 ay, emerald rengi). Backend `dashboard.ts`'e `buildChartData()` fonksiyonu eklendi: dailyTrend, appointmentsByType (max 6), monthlyRevenueTrend sorguları.
- **Hedef:** Recharts/Chart.js ile: haftalık randevu trendi, hizmet bazlı dağılım pastası, aylık gelir çizgi grafiği
- **Etki:** ⭐⭐⭐⭐ — Görsel zenginlik, demo etkisi
- **Zorluk:** Düşük-Orta

### 6.2 — Hekim Dashboard'u ✅ TAMAMLANDI
- **Durum:** Hekim rolüyle giriş yapıldığında, admin dashboard'u yerine doktor odaklı özel dashboard açılıyor.
  - **Backend (`dashboard.ts`):** `role === 'doctor'` için `doctorExtras` bloğu eklendi: önümüzdeki 7 gün randevuları, aktif tedavi pipeline (aşama bazlı gruplu), son 5 hasta (deduplike), bekleyen + onaylı kazanç toplamı. `buildChartData` doktor rolünde atlanıyor (gereksiz klinik geneli grafik yükü yok).
  - **Frontend (`Dashboard.tsx`):** `DoctorDashboard` bileşeni eklendi. İçeriği: kişisel selamlama + tarih, 4 kişisel metrik kart (bugün/hafta/açık tedavi/bekleyen görev), tahakkuk eden kazanç vurgu kartı (→ `/my-earnings` linki), bugünkü program tablosu, önümüzdeki 7 gün listesi, tedavi pipeline rozet görünümü (aşama bazlı), son hastalar listesi, aktivite akışı. Admin/billing/receptionist dashboard'u tamamen değişmedi.
- **Eklenen değer önerileri (plana işlendi):** Bkz. §6.5, §6.6, §6.7

### 6.3 — Hasta Kazanım Kaynağı Analizi ✅ TAMAMLANDI
- **Durum:** `GET /api/reports/patient-sources` endpoint'i eklendi. Dönem bazlı hasta kaynak dağılımı (referral, instagram, google, walk_in, website, phone, social_media, whatsapp, other) + her kaynaktan üretilen gelir. `Reports.tsx`'e "Hasta Kaynakları" sekmesi eklendi: PieChart (hasta sayısı dağılımı), yatay BarChart (kaynak bazlı gelir), detay tablosu (kaynak, hasta sayısı, pay %, gelir).

### 6.4 — GDPR Veri Dışa Aktarım
- **Mevcut:** MVP freeze notlarında önerilmiş, implementasyon yok
- **Hedef:** Hasta detayında "Verilerimi İndir" butonu → JSON/CSV formatında tüm hasta verisini export
- **Etki:** ⭐⭐⭐ — Yasal uyumluluk
- **Zorluk:** Düşük

### 6.5 — No-Show & İptal Analiz Raporu ✅ TAMAMLANDI
- **Durum:** `GET /api/reports/no-show-analysis` endpoint'i eklendi. 4 boyutlu analiz: aylık trend (no-show + iptal sayısı + oran), hekim bazlı no-show oranı, gün bazlı dağılım (Pzt-Paz), saat dilimi dağılımı. `Reports.tsx`'e "No-Show Analizi" sekmesi eklendi: özet metrik kartları (toplam no-show, genel oran, iptal sayısı), ComposedChart (bar + line ile aylık trend), gün bazlı BarChart, saat bazlı BarChart (toplam vs no-show karşılaştırmalı), hekim tablosu (orana göre sıralı, renk kodlamalı badge).

### 6.6 — Hasta Geri Dönüş Hatırlatıcısı Analizi
- **Mevcut:** Hatırlatma mesajları gönderiliyor ama geri dönüş takibi yok
- **Hedef:** Son randevusundan N gün geçmiş (6 ay, 1 yıl) hastalara otomatik hatırlatma + "Neden gelmedin?" opsiyonel kısa mesaj. Kaç hastanın geri döndüğü raporlanır.
- **Etki:** ⭐⭐⭐⭐ — Sessiz hasta aktivasyonu, gelir artırımı
- **Zorluk:** Orta (yeni cron job + mesaj şablonu)

### 6.7 — Hekim Performans Karşılaştırma Paneli
- **Mevcut:** Hekim başına kazanç raporu var (§4.4)
- **Hedef:** Birden fazla hekimli klinikte: hekim bazlı no-show oranı, ortalama seans süresi, tedavi kabul oranı, aylık gelir trendi. Sadece admin görür.
- **Etki:** ⭐⭐⭐⭐ — Klinik sahibi için karar desteği
- **Zorluk:** Düşük-Orta (mevcut veriler yeterli)

---

## 🔧 Kategori 7: Teknik Altyapı

### 7.1 — Monolitik Backend'i Modülerleştirme ✅ TAMAMLANDI
- **Durum:** `server/src/index.ts` artık 51 satır — sadece middleware ve route bağlantıları. 12 ayrı route dosyası: `auth`, `whatsapp`, `users`, `dashboard`, `patients`, `services`, `appointmentRequests`, `appointments`, `tasks`, `treatmentCases`, `insuranceProvisions`, `payments`, `messages`. `server/src/routes/` altında organize.
- **Hedef:** Route dosyalarını ayırma: `routes/patients.ts`, `routes/appointments.ts`, vb. Controller/Service katmanı.
- **Etki:** ⭐⭐⭐⭐⭐ — Bakım kolaylığı, ekip çalışması
- **Zorluk:** Orta

### 7.2 — API Rate Limiting & Güvenlik Katmanları
- **Mevcut:** JWT + RBAC var, rate limiting yok
- **Hedef:** Express rate-limit, helmet, CORS sıkılaştırma, brute-force koruması
- **Etki:** ⭐⭐⭐⭐ — Prodüksiyon güvenliği
- **Zorluk:** Düşük

### 7.3 — Otomatik Testler
- **Mevcut:** Sadece WhatsApp conversation fixtures testi var
- **Hedef:** API endpoint integration testleri (Jest/Vitest), kritik iş mantığı unit testleri
- **Etki:** ⭐⭐⭐⭐ — Güvenli refactoring ve deploy
- **Zorluk:** Orta-Yüksek

### 7.4 — CI/CD Pipeline
- **Mevcut:** Manuel deploy planı (Hostinger VPS)
- **Hedef:** GitHub Actions: lint → test → build → deploy. Otomatik migration.
- **Etki:** ⭐⭐⭐⭐ — Deploy güvenliği ve hızı
- **Zorluk:** Orta

### 7.5 — Multi-Tenant / Çoklu Şube Desteği
- **Mevcut:** `clinicId` ile multi-tenant hazır ama tek klinik kullanılıyor
- **Hedef:** Aile Diş'in birden fazla şubesini desteklemek: şube seçimi, şube bazlı raporlama
- **Etki:** ⭐⭐⭐⭐⭐ — Büyüme yolu (Aile Diş'in Sancaktepe dışında şubeleri var)
- **Zorluk:** Orta

### 7.6 — WebSocket ile Gerçek Zamanlı Güncellemeler
- **Mevcut:** Sayfa yenilemesi ile veri güncelleme
- **Hedef:** Yeni randevu/WhatsApp talebi geldiğinde anlık bildirim, takvimde canlı güncelleme
- **Etki:** ⭐⭐⭐⭐ — Çok kullanıcılı ortamda kritik
- **Zorluk:** Orta-Yüksek

---

## 🏆 Önerilen Öncelik Sırası

### Hemen Yapılması Gerekenler (Hafta 1-2)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 1 | ~~Gerçek WhatsApp gönderimi (5.1)~~ ✅ | Mesajlaşma modülünü aktif hale getirir |
| 2 | ~~Otomatik hatırlatma cron job (5.2)~~ ✅ | No-show'u azaltır, geliri artırır |
| 3 | ~~Backend modülerleştirme (7.1)~~ ✅ | 172KB tek dosya sürdürülemez |
| 4 | ~~Randevu onay/renk kodlama (2.4, 2.5)~~ ✅ | Küçük ama yüksek etki |

### Kısa Vadeli (Hafta 3-6)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 5 | ~~Drag & Drop takvim (1.1)~~ ✅ | Demo ve satış etkisi çok yüksek |
| 6 | ~~Çoklu hekim takvim (2.1)~~ ✅ | Resepsiyonun birinci ihtiyacı |
| 7 | ~~Dashboard grafikleri (6.1)~~ ✅ | Görsel zenginlik, ikna gücü |
| 8 | ~~Hasta dosya ekleri (3.2)~~ ✅ | Pratik operasyonel ihtiyaç |
| 9 | ~~Küresel arama (1.4)~~ ✅ | UX kalitesini yükselten küçük yatırım |

### Orta Vadeli (Ay 2-3)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 10 | ~~Taksit planı (4.2)~~ ✅ | İmplant/ortodonti kliniği satışı |
| 11 | ~~Gelir raporu + hekim performans (4.3, 4.4)~~ ✅ | Klinik sahibi karar desteği |
| 12 | ~~WhatsApp konuşma geçmişi (5.4)~~ ✅ | Veri zaten var, sadece UI gerekli |
| 13 | ~~Hekim Dashboard'u (6.2)~~ ✅ | Doktor bağımsızlığı, rol bazlı UX |
| 14 | ~~Hasta kaynak analizi (6.3)~~ ✅ | Pazarlama bütçesi kararları |
| 15 | ~~No-show analiz raporu (6.5)~~ ✅ | Operasyonel iyileştirme |
| 16 | Hasta etiketleri (3.4) | Segmentasyon ve pazarlama |
| 15 | ~~Mobil uyumluluk (1.3)~~ ✅ | Hekim kullanımı |
| 16 | Rate limiting & güvenlik (7.2) | Prodüksiyon öncesi zorunlu |

### Uzun Vadeli (Ay 3+)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 16 | ~~Diş haritası (3.5)~~ ✅ | Güçlü rekabet avantajı |
| 17 | Çoklu şube (7.5) | Ölçeklenme |
| 18 | Hasta portalı (3.1) | Self-service randevu |
| 19 | CI/CD + testler (7.3, 7.4) | Ekip büyüdüğünde zorunlu |
| 20 | ~~Fatura/makbuz (4.1)~~ ✅ | Muhasebe entegrasyonuna alternatif |

---

## 💡 Rakip Analizi — Eksik Olan "Wow" Faktörleri

Modern diş klinik yazılımlarında (Dentrix, Planmeca Romexis, DentalSoft) olan ama bu CRM'de olmayan en çarpıcı özellikler:

1. **Tedavi Planı Görselleştirme** — Diş haritası üzerinde planlanan tedaviler ✅ TAMAMLANDI
2. **Hasta Fotoğraf Galerisi** — Tedavi öncesi/sonrası fotoğraf karşılaştırma
3. **Online Randevu Widget** — Kliniğin web sitesine gömülebilir randevu formu ✅ TAMAMLANDI
4. **SMS ile İki Yönlü İletişim** — Hasta yanıtlarını CRM'de takip
5. **Stok/Malzeme Takibi** — Basit düzeyde implant, protez malzeme stoku ✅ TAMAMLANDI

> [!TIP]
> Bu "wow" faktörlerinden **online randevu widget** ve **tedavi planı görselleştirme** en düşük eforla en yüksek satış etkisi yaratacak olanlardır.

---

## ⚠️ Dikkat Edilmesi Gerekenler

> [!WARNING]
> - `server/src/index.ts` dosyası **172KB** ve tek parça. Yeni özellik eklemeden önce modülerleştirme yapılmalı.
> - Gerçek hasta verisi ile çalışmadan önce **KVKK/GDPR uyumluluk** denetimi şart.
> - WhatsApp Business API için **Meta Business Verification** süreci 2-4 hafta sürebilir.
> - Diş haritası gibi özellikler EHR (Elektronik Sağlık Kaydı) sınırına yaklaşır — yasal danışmanlık önerilir.

# Diş Klinik CRM — Geliştirme Planı

> **Mevcut Durum:** MVP tamamlanmış, Aile Diş kliniğine uyarlanmış, 20 fazlık geliştirme süreci başarıyla bitirilmiş. WhatsApp n8n entegrasyonu, doktor müsaitlik yönetimi, sigorta/provizyon takibi, çok dilli destek (TR/EN/FR/DE) ve rol bazlı erişim kontrolü mevcut.

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

## 🚀 Kategori 1: UX / UI İyileştirmeleri

### 1.1 — Drag & Drop Haftalık/Günlük Takvim
- **Mevcut:** Aylık takvim + tablo listesi var. Gerçek sürükle-bırak yok.
- **Hedef:** FullCalendar veya benzeri bir bileşenle haftalık/günlük görünüm. Randevuyu sürükleyerek saatini değiştirme.
- **Etki:** ⭐⭐⭐⭐⭐ — Kliniklerin en çok istediği özellik
- **Zorluk:** Orta
- **Tavsiye:** `@fullcalendar/react` kütüphanesi ile hızlı implementasyon

### 1.2 — Karanlık Mod (Dark Mode)
- **Mevcut:** Sadece açık tema var
- **Hedef:** Tailwind dark mode desteği, sistem tercihine göre otomatik geçiş
- **Etki:** ⭐⭐⭐ — Modern görünüm, gece çalışan personel için konfor
- **Zorluk:** Orta

### 1.3 — Mobil Uyumluluk (Responsive İyileştirmeler)
- **Mevcut:** Temel responsive yapı var ama tablo ve form ağırlıklı
- **Hedef:** Doktor cebinden randevu listesi, hasta bilgisi görüntüleme. Mobil-first kart görünümleri.
- **Etki:** ⭐⭐⭐⭐⭐ — Doktorlar genelde cep telefonundan bakar
- **Zorluk:** Orta-Yüksek

### 1.4 — Küresel Arama (Global Search)
- **Mevcut:** Sayfa bazlı filtreler var, merkezi arama yok
- **Hedef:** `Cmd+K` / `Ctrl+K` ile hastalar, randevular, tedaviler arasında anlık arama
- **Etki:** ⭐⭐⭐⭐ — Resepsiyon hızını dramatik artırır
- **Zorluk:** Orta

### 1.5 — Bildirim Merkezi (Notification Center)
- **Mevcut:** Auth expiry toast var, başka bildirim yok
- **Hedef:** Yaklaşan randevular, gecikmiş görevler, yeni WhatsApp talepleri için in-app bildirim çanı
- **Etki:** ⭐⭐⭐⭐ — Proaktif operasyon yönetimi
- **Zorluk:** Orta

---

## 📅 Kategori 2: Takvim & Randevu Geliştirmeleri

### 2.1 — Çoklu Hekim Yan Yana Takvim
- **Mevcut:** Tek hekim filtresi ile liste görünümü
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

### 2.4 — Randevu Onay Akışı (SMS/WhatsApp)
- **Mevcut:** Mesaj şablonları "prepared" durumda kalıyor, gerçek gönderim yok
- **Hedef:** n8n üzerinden otomatik randevu hatırlatma gönderimi (24 saat önce) ve hasta onay/iptal yanıtı
- **Etki:** ⭐⭐⭐⭐⭐ — No-show oranını %30-40 azaltır
- **Zorluk:** Orta (n8n zaten kurulu)

### 2.5 — Randevu Renk Kodlaması
- **Mevcut:** Hizmet bazlı renk var ama takvimde görsel olarak yetersiz
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

### 3.2 — Hasta Dosya Ekleri
- **Mevcut:** Yok — MVP freeze notlarında "Phase 2" olarak önerilmiş
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

### 3.5 — Diş Haritası (Dental Chart) — Basit Versiyon
- **Mevcut:** Yok (EHR değil, CRM odaklı)
- **Hedef:** 32 dişlik interaktif görsel harita. Her dişe kısa not/durum ekleyebilme. (Tıbbi kayıt değil, operasyonel not amaçlı)
- **Etki:** ⭐⭐⭐⭐⭐ — Diş klinikleri için çok güçlü satış argümanı
- **Zorluk:** Yüksek
- **Not:** EHR sınırını aşmadan, "hangi dişe hangi hizmet planlandı" düzeyinde tutulmalı

---

## 💰 Kategori 4: Finansal Yönetim

### 4.1 — Fatura / Makbuz Oluşturma
- **Mevcut:** Sadece ödeme kaydı var, belge çıktısı yok
- **Hedef:** Basit bir PDF makbuz/fatura şablonu. Hasta adı, hizmetler, tutar, ödeme yöntemi.
- **Etki:** ⭐⭐⭐⭐ — Yasal zorunluluk (muhasebe entegrasyonuna alternatif)
- **Zorluk:** Orta

### 4.2 — Taksit Planı
- **Mevcut:** Tek seferlik ödeme kaydı
- **Hedef:** Tedavi toplamını taksitlere bölme, ödeme takvimi oluşturma, gecikme uyarısı
- **Etki:** ⭐⭐⭐⭐ — Yüksek tutarlı tedaviler (implant, ortodonti) için kritik
- **Zorluk:** Orta

### 4.3 — Gelir-Gider Raporu
- **Mevcut:** Dashboard'da aylık gelir ve bekleyen tahsilat var
- **Hedef:** Tarih aralığı seçerek hekim bazlı, hizmet bazlı gelir raporu. CSV/PDF export.
- **Etki:** ⭐⭐⭐⭐ — Klinik sahibinin en çok baktığı veri
- **Zorluk:** Orta

### 4.4 — Hekim Performans ve Komisyon Takibi
- **Mevcut:** Yok
- **Hedef:** Hekim başına randevu sayısı, tamamlanan tedavi sayısı, üretilen gelir, komisyon hesaplama
- **Etki:** ⭐⭐⭐⭐ — Çok hekimli klinikler için önemli
- **Zorluk:** Orta

---

## 📨 Kategori 5: İletişim & Mesajlaşma

### 5.1 — Gerçek WhatsApp Business API Entegrasyonu
- **Mevcut:** n8n + Evolution API ile gelen mesaj alımı var, CRM'den otomatik gönderim yok
- **Hedef:** CRM'den tek tıkla WhatsApp mesajı gönderme. Şablon mesajları "sent" durumuna geçirme.
- **Etki:** ⭐⭐⭐⭐⭐ — Mesajlaşma modülünün asıl amacı
- **Zorluk:** Orta (n8n altyapısı hazır)

### 5.2 — Otomatik Hatırlatma Kuyruk Sistemi (Cron Jobs)
- **Mevcut:** Manuel mesaj hazırlama
- **Hedef:** Her gece çalışan bir job: yarınki randevulara otomatik hatırlatma, gecikmiş ödemelere uyarı
- **Etki:** ⭐⭐⭐⭐⭐ — No-show ve tahsilat performansını otomatik iyileştirir
- **Zorluk:** Orta

### 5.3 — E-posta Entegrasyonu (SMTP)
- **Mevcut:** Şablon mevcut, gönderim bağlı değil
- **Hedef:** Nodemailer ile SMTP gönderim. Randevu özeti, teklif, makbuz gönderimi.
- **Etki:** ⭐⭐⭐ — WhatsApp'a ek kanal
- **Zorluk:** Düşük

### 5.4 — WhatsApp Konuşma Geçmişi Görünümü
- **Mevcut:** `WhatsAppConversationMessage` modeli var ama UI'da konuşma geçmişi yok
- **Hedef:** Hasta detayında WhatsApp konuşma geçmişini chat baloncukları olarak göster
- **Etki:** ⭐⭐⭐⭐ — Hasta ile iletişim bağlamı
- **Zorluk:** Düşük-Orta

---

## 📈 Kategori 6: Raporlama & Analitik

### 6.1 — Gelişmiş Dashboard Grafikleri
- **Mevcut:** Sayısal kartlar ve tablo bazlı agenda
- **Hedef:** Recharts/Chart.js ile: haftalık randevu trendi, hizmet bazlı dağılım pastası, aylık gelir çizgi grafiği
- **Etki:** ⭐⭐⭐⭐ — Görsel zenginlik, demo etkisi
- **Zorluk:** Düşük-Orta

### 6.2 — Hekim Dashboard'u
- **Mevcut:** Rol bazlı metrik var ama her hekim aynı dashboard'u görüyor
- **Hedef:** Hekim girişinde: bugünkü randevuları, haftanın özeti, kendi hastalari, tedavi aşamaları
- **Etki:** ⭐⭐⭐⭐ — Hekim bağımsızlığı
- **Zorluk:** Orta

### 6.3 — Hasta Kazanım Kaynağı Analizi
- **Mevcut:** Hasta `source` alanı var (google, referral, instagram, phone)
- **Hedef:** Hangi kanaldan kaç hasta geldi, hangi kanal daha fazla gelir üretiyor grafiği
- **Etki:** ⭐⭐⭐⭐ — Pazarlama bütçesi kararları
- **Zorluk:** Düşük

### 6.4 — GDPR Veri Dışa Aktarım
- **Mevcut:** MVP freeze notlarında önerilmiş, implementasyon yok
- **Hedef:** Hasta detayında "Verilerimi İndir" butonu → JSON/CSV formatında tüm hasta verisini export
- **Etki:** ⭐⭐⭐ — Yasal uyumluluk
- **Zorluk:** Düşük

---

## 🔧 Kategori 7: Teknik Altyapı

### 7.1 — Monolitik Backend'i Modülerleştirme
- **Mevcut:** `server/src/index.ts` tek dosyada 172KB — tüm route'lar, controller'lar, validasyonlar tek yerde
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
| 1 | Gerçek WhatsApp gönderimi (5.1) | Mesajlaşma modülünü aktif hale getirir |
| 2 | Otomatik hatırlatma cron job (5.2) | No-show'u azaltır, geliri artırır |
| 3 | Backend modülerleştirme (7.1) | 172KB tek dosya sürdürülemez |
| 4 | Randevu onay/renk kodlama (2.4, 2.5) | Küçük ama yüksek etki |

### Kısa Vadeli (Hafta 3-6)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 5 | Drag & Drop takvim (1.1) | Demo ve satış etkisi çok yüksek |
| 6 | Çoklu hekim takvim (2.1) | Resepsiyonun birinci ihtiyacı |
| 7 | Dashboard grafikleri (6.1) | Görsel zenginlik, ikna gücü |
| 8 | Hasta dosya ekleri (3.2) | Pratik operasyonel ihtiyaç |
| 9 | Küresel arama (1.4) | UX kalitesini yükselten küçük yatırım |

### Orta Vadeli (Ay 2-3)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 10 | Taksit planı (4.2) | İmplant/ortodonti kliniği satışı |
| 11 | Gelir raporu + hekim performans (4.3, 4.4) | Klinik sahibi karar desteği |
| 12 | WhatsApp konuşma geçmişi (5.4) | Veri zaten var, sadece UI gerekli |
| 13 | Hasta etiketleri (3.4) | Segmentasyon ve pazarlama |
| 14 | Mobil uyumluluk (1.3) | Hekim kullanımı |
| 15 | Rate limiting & güvenlik (7.2) | Prodüksiyon öncesi zorunlu |

### Uzun Vadeli (Ay 3+)
| # | Geliştirme | Neden |
|---|-----------|-------|
| 16 | Diş haritası (3.5) | Güçlü rekabet avantajı |
| 17 | Çoklu şube (7.5) | Ölçeklenme |
| 18 | Hasta portalı (3.1) | Self-service randevu |
| 19 | CI/CD + testler (7.3, 7.4) | Ekip büyüdüğünde zorunlu |
| 20 | Fatura/makbuz (4.1) | Muhasebe entegrasyonuna alternatif |

---

## 💡 Rakip Analizi — Eksik Olan "Wow" Faktörleri

Modern diş klinik yazılımlarında (Dentrix, Planmeca Romexis, DentalSoft) olan ama bu CRM'de olmayan en çarpıcı özellikler:

1. **Tedavi Planı Görselleştirme** — Diş haritası üzerinde planlanan tedaviler
2. **Hasta Fotoğraf Galerisi** — Tedavi öncesi/sonrası fotoğraf karşılaştırma
3. **Online Randevu Widget** — Kliniğin web sitesine gömülebilir randevu formu
4. **SMS ile İki Yönlü İletişim** — Hasta yanıtlarını CRM'de takip
5. **Stok/Malzeme Takibi** — Basit düzeyde implant, protez malzeme stoku

> [!TIP]
> Bu "wow" faktörlerinden **online randevu widget** ve **tedavi planı görselleştirme** en düşük eforla en yüksek satış etkisi yaratacak olanlardır.

---

## ⚠️ Dikkat Edilmesi Gerekenler

> [!WARNING]
> - `server/src/index.ts` dosyası **172KB** ve tek parça. Yeni özellik eklemeden önce modülerleştirme yapılmalı.
> - Gerçek hasta verisi ile çalışmadan önce **KVKK/GDPR uyumluluk** denetimi şart.
> - WhatsApp Business API için **Meta Business Verification** süreci 2-4 hafta sürebilir.
> - Diş haritası gibi özellikler EHR (Elektronik Sağlık Kaydı) sınırına yaklaşır — yasal danışmanlık önerilir.

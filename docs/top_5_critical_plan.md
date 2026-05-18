# En Kritik 5 Geliştirme — Uygulama Planı

Bu belge, CRM sistemini bir sonraki seviyeye taşıyacak en acil ve kritik 5 özelliğin teknik uygulama planını içerir. Adımlar, riskleri en aza indirecek ve mevcut MVP yapısını bozmayacak şekilde tasarlanmıştır.

---

## 1. Backend Modülerleştirme (Kod Mimarisi İyileştirmesi) ✅ TAMAMLANDI

**Sorun:** `server/src/index.ts` dosyası şu an 172KB büyüklüğünde ve tüm endpoint'leri, Zod şemalarını, yetkilendirme mantığını tek bir dosyada barındırıyor. Bu durum, yeni özellik eklemeyi ve hata ayıklamayı zorlaştırıyor.

**Uygulama Adımları:**
1. **Klasör Yapısının Kurulması:**
   - `server/src/routes/` klasörü oluşturulacak.
   - `server/src/controllers/` ve `server/src/schemas/` klasörleri (opsiyonel ama tavsiye edilir) oluşturulacak.
2. **Route'ların Ayrıştırılması:**
   - İlgili endpoint'ler mantıksal gruplara ayrılacak: `auth.ts`, `users.ts`, `patients.ts`, `appointments.ts`, `whatsapp.ts`, `services.ts`, `messages.ts` vb.
   - Her dosya `express.Router()` kullanılarak dışa aktarılacak.
3. **Index.ts'in Temizlenmesi:**
   - Mevcut `index.ts` dosyası sadece Express uygulamasının başlatılması, middleware'lerin (CORS, JSON vb.) eklenmesi ve ana route'ların bağlanması (`app.use('/api/patients', patientRoutes)`) işlevlerini üstlenecek.
4. **Test ve Doğrulama:**
   - TypeScript derleme kontrolü (`npx tsc --noEmit`) yapılacak.
   - Frontend üzerinden tüm CRUD operasyonları test edilerek kopukluk olup olmadığı doğrulanacak.

**Uygulama Sonucu (18 Mayıs 2026):**

Monolitik `index.ts` (4844 satır) aşağıdaki modüler yapıya dönüştürüldü:

| Dosya | İçerik |
|---|---|
| `server/src/index.ts` | 4844 → **49 satır**: Express başlatma, middleware, route bağlama |
| `server/src/db.ts` | Prisma singleton |
| `server/src/schemas/index.ts` | Tüm Zod şemaları |
| `server/src/utils/helpers.ts` | Paylaşılan yardımcı fonksiyonlar (zaman, şifre, müsaitlik) |
| `server/src/routes/auth.ts` | `POST /api/auth/login`, `GET /api/auth/me` |
| `server/src/routes/users.ts` | Kullanıcı CRUD, hekim müsaitliği |
| `server/src/routes/dashboard.ts` | Dashboard istatistikleri |
| `server/src/routes/patients.ts` | Hasta CRUD (soft-delete) |
| `server/src/routes/services.ts` | Randevu tipleri ve hizmetler |
| `server/src/routes/appointmentRequests.ts` | Randevu talepleri |
| `server/src/routes/appointments.ts` | Randevu CRUD, durum geçişleri |
| `server/src/routes/tasks.ts` | Görev CRUD |
| `server/src/routes/treatmentCases.ts` | Tedavi süreci CRUD |
| `server/src/routes/insuranceProvisions.ts` | Sigorta provizyon CRUD |
| `server/src/routes/payments.ts` | Ödeme CRUD |
| `server/src/routes/messages.ts` | Mesaj şablonları ve hazırlama |
| `server/src/routes/whatsapp.ts` | WhatsApp public endpoint'leri ve konversasyon state machine |

`codex/whatsapp-approval-flow` branch merge'ünden gelen değişiklikler de `routes/whatsapp.ts`'e uygulandı:
- **Webhook güvenliği:** `optionalWhatsappWebhookSecret` → `authorizeWhatsappWebhook` (zorunlu kimlik doğrulama)
- **Randevu akışı:** Direkt randevu oluşturma → Personel onayına giden `pending` talep akışı
- **Telefon eşleştirme:** Fuzzy eşleştirme (`getPhoneVariants`/`phonesMatch`) — Türkçe hat formatları (90xxx/0xxx/10 hane) destekleniyor
- **Duplicate koruması:** `hasProcessedWhatsAppProviderMessage` + `markWhatsAppProviderMessageProcessed`
- **Çoklu klinik:** `getClinicForWhatsAppInstance` ile instance adına göre klinik çözümleme
- **Activity log:** İptal ve onay isteği olayları loglanıyor

`npx tsc --noEmit` → **0 hata**

---

## 2. Gerçek WhatsApp Gönderimi (Operasyonel Verimlilik)

**Sorun:** Mevcut sistem mesajları sadece "prepared" (hazırlandı) statüsünde veritabanına kaydediyor ancak müşteriye iletmiyor.

**Uygulama Adımları:**
1. **Çevresel Değişkenlerin (ENV) Ayarlanması:**
   - N8n webhook veya Evolution API bağlantısı için gerekli URL ve API anahtarları `.env` dosyasına eklenecek (örn. `WHATSAPP_API_URL`, `WHATSAPP_API_KEY`).
2. **Mesaj Gönderim Servisi:**
   - `server/src/services/whatsappService.ts` dosyası oluşturulacak.
   - Bu servis, dış API'ye (n8n veya Evolution API) HTTP POST isteği yapacak fonksiyonları içerecek.
3. **Endpoint Güncellemesi:**
   - Yeni bir endpoint eklenecek: `POST /api/messages/:id/send`
   - Bu endpoint, veritabanındaki "prepared" mesajı alıp WhatsApp servisi üzerinden gönderecek ve durumunu "sent" olarak güncelleyecek.
4. **UI Entegrasyonu:**
   - Frontend `Messages.tsx` sayfasına ve hasta detayındaki mesajlar sekmesine "Şimdi Gönder" (Send Now) butonu eklenecek.

---

## 3. Otomatik Hatırlatma Sistemi (Cron Jobs)

**Sorun:** Randevu hatırlatmalarının manuel yapılması zaman kaybına ve "No-show" (gelmeyen hasta) oranlarının yüksek kalmasına neden oluyor.

**Uygulama Adımları:**
1. **Cron Kütüphanesinin Kurulumu:**
   - Backend projesine `node-cron` kütüphanesi eklenecek (`npm install node-cron`).
2. **Job'ların Yazılması:**
   - `server/src/jobs/reminders.ts` oluşturulacak.
   - Her gün belirli bir saatte (örn. 10:00) çalışacak bir cron job tanımlanacak.
   - Job, ertesi gün randevusu olan hastaları bulacak.
   - Bu hastalar için "24 saat randevu hatırlatma" şablonunu kullanarak mesaj oluşturacak ve WhatsApp gönderim servisini tetikleyecek.
3. **Sisteme Entegrasyon:**
   - Yazılan cron job'lar `index.ts` içerisinde başlatılacak (`require('./jobs/reminders').start()`).
4. **Aktivite Logu:**
   - Otomatik gönderilen mesajlar `ActivityLog` tablosuna "Sistem tarafından otomatik hatırlatma gönderildi" şeklinde işlenecek.

---

## 4. Drag & Drop Takvim (Gelişmiş UX) ✅ TAMAMLANDI

**Sorun:** Mevcut takvim basit bir liste ve görsel olarak zayıf bir aylık takvimden oluşuyor. Klinikteler saat değişimlerini sürükle-bırak ile yapmak istiyor.

**Uygulama Adımları:**
1. **Kütüphane Seçimi ve Kurulum:**
   - React için standart haline gelmiş `@fullcalendar/react`, `@fullcalendar/timegrid`, ve `@fullcalendar/interaction` paketleri kurulacak.
2. **Bileşen Entegrasyonu:**
   - `Appointments.tsx` sayfası güncellenecek veya yeni bir `CalendarView.tsx` bileşeni oluşturulacak.
   - Veritabanından gelen randevu verileri, FullCalendar'ın beklediği `{ id, title, start, end, backgroundColor }` formatına dönüştürülecek (Hizmet türü renkleri kullanılacak).
3. **Sürükle-Bırak Olayları (Event Handlers):**
   - Takvim üzerindeki `eventDrop` ve `eventResize` (süre uzatma/kısaltma) olayları yakalanacak.
   - Bu olaylar tetiklendiğinde arka planda `PUT /api/appointments/:id` endpoint'ine yeni saat bilgileriyle istek atılacak.
4. **Validasyon (Müsaitlik Kontrolü):**
   - Sürüklenen yeni saatin hekimin müsaitlik sınırları içinde olup olmadığı frontend ve backend'de kontrol edilecek. Hata varsa sürükleme işlemi iptal edilecek (revert).

**Uygulama Sonucu (18 Mayıs 2026):**

| Dosya | Açıklama |
|---|---|
| `src/components/CalendarTimelineView.tsx` | FullCalendar tabanlı gün/hafta/ay takvim bileşeni |
| `src/pages/Appointments.tsx` | Görünüm toggle entegrasyonu (Liste / Takvim / Çoklu Hekim) |
| `src/index.css` | FullCalendar için tasarım uyumu CSS override'ları |

- **Kurulu paketler:** `@fullcalendar/react`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, `@fullcalendar/daygrid`
- **`eventDrop`:** Sürükleme sonrası `PUT /api/appointments/:id` çağrısı, hata durumunda `info.revert()` ile geri alma
- **`eventResize`:** Süre uzatma/kısaltma → aynı endpoint
- **Görünüm seçenekleri:** `timeGridDay`, `timeGridWeek`, `dayGridMonth`
- **Renk kodlaması:** Randevular `appointmentType.color` ile renklendirildi; iptal/tamamlandı randevular opaklık ile ayrıştırıldı
- **`npx tsc --noEmit` → 0 hata**

---

## 5. Çoklu Hekim Yan Yana Takvim Görünümü (Resepsiyon İhtiyacı) ✅ TAMAMLANDI

**Sorun:** Resepsiyon görevlileri, kliniğin o günkü genel durumunu tek bakışta görmek için tüm hekimleri yan yana kolonlar halinde görmek istiyor. Mevcut sistemde hekimler arası filtreleme yapılarak tek tek bakılıyor.

**Uygulama Adımları:**
1. **Takvim Kütüphanesi Özelliğinin Kullanımı:**
   - *Seçenek A:* Eğer FullCalendar Premium lisansı varsa `@fullcalendar/resource-timegrid` eklentisi kullanılacak.
   - *Seçenek B (Lisanssız):* Günlük (Day) görünüm için özel bir CSS Grid yapısı tasarlanacak veya `react-big-calendar` kütüphanesi tercih edilecek. (Öneri: Özel CSS Grid ile Tailwind kullanarak günlük görünümde hekimleri kolonlara bölmek daha esnek olabilir).
2. **Veri Getirme (Fetching):**
   - Seçilen gün için kliniğe ait tüm hekimler (`GET /api/users?role=doctor`) ve tüm randevular getirilecek.
3. **Arayüz Tasarımı (UI):**
   - Üst kısımda hekimlerin isimleri yer alacak.
   - Alt kısımda saat dilimleri (örn. 09:00 - 18:00 arası 15 veya 30 dakikalık slotlar) satırlar halinde gösterilecek.
   - Randevular, ait oldukları hekimin kolonuna yerleştirilecek.
   - Boş slotlara tıklanarak doğrudan o hekime ve o saate ön tanımlı randevu oluşturma modal'ı açılacak.

**Uygulama Sonucu (18 Mayıs 2026):**

| Dosya | Açıklama |
|---|---|
| `src/components/MultiDoctorDayView.tsx` | Seçenek B uygulandı: Tailwind CSS Grid tabanlı özel günlük hekim görünümü |
| `src/pages/Appointments.tsx` | "Çoklu Hekim" toggle butonu ile entegrasyon |

- **Yaklaşım:** FullCalendar Premium gerektirmeyen özel CSS Grid — premium lisans yok
- **Sütun yapısı:** Her hekim bir sütun; sol tarafta 08:00–20:00 arası 30 dakikalık zaman etiketleri
- **Randevu yerleştirme:** `startTime` ve `endTime` farkına göre hücre yüksekliği (span) hesaplanır; çakışan alanlar `occupied` olarak işaretlenerek atlanır
- **Boş slot tıklama:** `canEdit` (admin/resepsiyon) rolü varsa tıklanan hücrenin hekimi ve saatiyle ön doldurulmuş `AppointmentForm` açılır
- **Durum renk kodlaması:** Planlandı → sarı, Onaylı → mavi, Tamamlandı → yeşil, İptal → kırmızı/soluk, Gelmedi → gri/soluk
- **`npx tsc --noEmit` → 0 hata**

---

## Önerilen Çalışma Sırası
Bu özellikleri uygulamak için en güvenli yol şudur:

1. **Faz 1:** Backend Modülerleştirme (Diğer tüm özelliklerin temiz bir koda eklenmesi için ön şart).
2. **Faz 2:** Drag & Drop Takvim ve Çoklu Hekim Görünümü ✅ TAMAMLANDI (18 Mayıs 2026).
3. **Faz 3:** Gerçek WhatsApp Gönderimi.
4. **Faz 4:** Otomatik Hatırlatma Sistemi (Faz 3 tamamlanmadan yapılamaz).

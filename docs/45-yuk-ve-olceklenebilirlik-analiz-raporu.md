# Yük ve Ölçeklenebilirlik Analiz Raporu

> Tarih: 2026-07-06
> Kapsam: Onlarca–yüzlerce kliniğin aynı anda online olduğu, veritabanında yüzlerce
> kliniğin verisinin bulunduğu senaryoda sistemin beklenen davranışı ve riskler.
> Bu rapor yalnızca analizdir; herhangi bir kod değişikliği yapılmamıştır.

**Mimari özet:** Tek Node.js süreci (Express 5 + Prisma/PostgreSQL), cron job'lar API
süreciyle aynı process'te, tüm cache/rate-limit state'i bellekte, dosyalar yerel diskte.

---

## Kritik bulgular (yük altında ilk kırılacak noktalar)

### 1. Sıcak tablolarda indeks yok — en büyük risk

`server/prisma/schema.prisma` içinde 127 `@@index` var ama tam da en çok yazılan/okunan
tablolarda hiç yok: **Appointment, SentMessage, Payment, Task, ActivityLog**.
PostgreSQL'de Prisma, foreign key kolonlarına otomatik indeks koymaz (MySQL'in aksine).

Sonuçları:

- Takvim sorgusu (`appointment.findMany({ clinicId, startTime: {gte, lte} })`) tüm
  kliniklerin randevularını içeren tabloda **sequential scan** yapar. 200 klinik ×
  yılda ~5.000 randevu = milyonlarca satırda her takvim açılışında tam tarama.
- Reminder job her randevu için `sentMessage.findFirst({ clinicId, appointmentId, ... })`
  çalıştırıyor (`server/src/jobs/reminders.ts:254`) — indeks olmadan her seferinde tam
  tarama; job N randevu için N tarama yapar.
- Uygunluk (available-slots) kontrolü de aynı tabloyu indekssiz sorguluyor
  (`server/src/routes/appointments.ts:170`).

**Beklenen davranış:** Az veriyle her şey hızlı görünür; veri büyüdükçe takvim ve
dashboard yanıt süreleri doğrusal-üstü bozulur, DB CPU'su %100'e dayanır ve *bütün*
klinikleri birden yavaşlatır. "Yüzlerce klinik verisi" senaryosundaki bir numaralı darboğaz.

### 2. Auth middleware her istekte 2+ DB sorgusu

`server/src/middleware/auth.ts:72` her API isteğinde `user.findUnique`
(+ `userClinics` join) çalıştırıyor; klinik durumu 60 sn cache'li ama kullanıcı sorgusu
cache'siz. 200 klinik × 5 aktif kullanıcı × normal tıklama trafiği = saniyede yüzlerce
ekstra sorgu, daha endpoint'in kendi işi başlamadan. Plan-limit middleware'i de
(`server/src/middleware/planLimits.ts`) yazma uçlarında 3 sorgu daha ekliyor
(30 sn cache'li, bu iyi).

### 3. Prisma bağlantı havuzu ayarsız

`server/src/db.ts` `PrismaPg`'yi yalnızca connection string ile kuruyor; havuz boyutu
varsayılan (~10 bağlantı civarı). Eşzamanlı yük altında istekler havuz kuyruğunda bekler;
auth'un her istekte DB'ye gitmesiyle birleşince havuz tükenmesi ilk görülecek
belirtilerden olur (istekler "askıda kalır", timeout'lar başlar).
`connection_limit` / `pool_timeout` ayarı ve ileride PgBouncer gerekir.

### 4. Reminder job: tüm klinikler, tek döngü, kilit yok

`server/src/jobs/reminders.ts:515` her 5 dakikada `clinic.findMany()` (tümü) → klinik
başına sıralı olarak tercih sorguları + randevu sorguları + randevu başına 2-3 yazma +
**sıralı WhatsApp API çağrısı**. Yüzlerce klinikte tek koşu 5 dakikayı aşar;
`cron.schedule` overlap kilidi olmadığı için **koşular üst üste biner**. Dedup kontrolü
var ama "kontrol et → gönder" arasında yarış penceresi olduğundan üst üste binen
koşularda **mükerrer hasta mesajı** riski gerçek. Ayrıca job, API ile aynı event loop'ta
koştuğu için koşu sırasında tüm API yanıtları gecikir.

### 5. Sayfalamasız / sınırsız liste uçları

- `GET /appointments` tarih filtresi verilmezse kliniğin **tüm** randevularını döner
  (`take` yok).
- `payments`, `treatmentCases`, `tasks`, `appointments` route'larında `take:` hiç
  kullanılmıyor (patients, notifications vb. kullanıyor).
- Büyük klinikte tek istek megabaytlarca JSON üretir; `express.json`'ın her istekte
  `rawBody` kopyası tutması (`server/src/index.ts:146`) ile birlikte bellek baskısı
  katlanır. Yanıt sıkıştırma (compression) yok — nginx'te yapılmıyorsa bant genişliği
  maliyeti de yüksek.

---

## Orta öncelikli bulgular

### 6. Tüm state bellekte — yatay ölçekleme bugün mümkün değil

Rate limiter'lar (`server/src/utils/helpers.ts:131`, koddaki yorum da kabul ediyor),
login/forgot-password sayaçları, `inboundRateLimiter`, plan-limit cache'i, klinik durum
cache'i hep process-içi `Map`. İkinci bir replika açıldığı anda rate limit'ler
etkisizleşir ve cron job'lar **iki kez** koşar (mükerrer hasta mesajı riski).
Tek sürecin CPU sınırı, sistemin tavanıdır.

### 7. Webhook işleme aynı süreçte, kuyruk yok

Meta webhook'u 200'ü hemen dönüyor (doğru), ama mesaj işleme (inbox upsert + NLU +
yanıt gönderimi) API süreciyle aynı event loop'ta. Yüzlerce klinik aynı anda
WhatsApp/Instagram mesajı alırken API gecikmeleri artar. `InboundEvent` tablosu
processed/failed işaretliyor ama başarısız olayları yeniden işleyen bir mekanizma yok —
crash anındaki mesajlar kaybolur.

### 8. Dosyalar yerel diskte

`uploads/` + multer diskStorage (`server/src/routes/attachments.ts`,
`server/src/routes/labOrders.ts`). Tek sunucuya bağımlılık, disk dolması izlenmiyor,
çoklu sunucuda paylaşımsız.

### 9. In-memory Map'lerde tahliye (eviction) yok

Rate limiter Map'leri yalnızca isabet anında temizleniyor; yüzbinlerce farklı IP/anahtar
birikirse bellek sızıntısı gibi davranır. Küçük ama bedava düzeltme.

### 10. Gözlemlenebilirlik eksik

Health-check endpoint'i, metrik (istek süresi, havuz doluluğu, job süresi), yavaş sorgu
logu yok. Yük problemi başladığında nereden başladığını gösterecek enstrümantasyon
bulunmuyor. Graceful shutdown da yok (kapatmada uçan istekler / yarım job'lar).

---

## Önerilen yol haritası (uygulama sırasıyla)

### Faz 1 — Ucuz ve etkisi en büyük (1-2 gün)

1. **İndeks migration'ı:**
   - `Appointment(clinicId, startTime)`, `Appointment(practitionerId, startTime)`, `Appointment(patientId)`
   - `SentMessage(clinicId, appointmentId, createdAt)`, `SentMessage(clinicId, subject)`
   - `Payment(clinicId, createdAt)`, `Payment(patientId)`
   - `Task(clinicId, status)`
   - `ActivityLog(clinicId, createdAt)`, `ActivityLog(patientId)`
2. `DATABASE_URL`'e `connection_limit` + `pool_timeout`; değeri ortam değişkenine bağla.
3. Reminder job'a overlap kilidi (koşu bitmeden yenisi başlamasın; ileride DB-tabanlı
   advisory lock).
4. `GET /appointments`'a tarih aralığı zorunluluğu veya varsayılan `take` limiti;
   diğer listelerde sayfalama.

### Faz 2 — Dayanıklılık (1 hafta)

5. Auth'ta kullanıcı sorgusuna kısa TTL'li (10-30 sn) cache; `passwordChangedAt`
   kontrolü korunarak.
6. Webhook işlemeyi `InboundEvent` üzerinden kuyruk mantığına çevir (en azından
   failed-event retry job'u).
7. `compression` middleware'i veya nginx gzip; rate limiter Map'lerine periyodik temizlik.
8. `/health` endpoint'i, pino'ya istek süresi metriği, Postgres
   `log_min_duration_statement` ile yavaş sorgu izleme, graceful shutdown.

### Faz 3 — Yatay ölçek hazırlığı

9. Redis: rate limit + cache + job kilidi paylaşımlı store'a taşınır (kodda TODO olarak
   zaten yazılmış).
10. Cron job'ları ayrı worker sürecine ayır; WhatsApp gönderimlerini kuyruğa al
    (klinik başına eşzamanlılıkla).
11. Dosyaları S3-uyumlu depoya taşı.

---

## Doğrulama — yük testi planı

Gerçekçi test için k6 veya artillery ile:

- **(a) Seed:** Yüzlerce klinik + milyon satırlık randevu/ödeme tohum verisi üreten bir
  seed script'i.
- **(b) Senaryo karışımı:** takvim görüntüleme %40, hasta arama %20, dashboard %15,
  yazma işlemleri %15, webhook trafiği %10.
- **(c) Ölçüm:** p95 gecikme, DB havuz bekleme, reminder job koşu süresi.

Bu testi staging'de, Faz 1 öncesi/sonrası karşılaştırmalı çalıştırmak indekslerin
etkisini net gösterir.

---

## Genel değerlendirme

Kod tabanı güvenlik ve çok-kiracılılık (tenant isolation) açısından özenli, ama mevcut
haliyle "tek sunucu, az veri" varsayımıyla yazılmış. Onlarca klinikte ilk belirtiler
auth kaynaklı DB yükü ve havuz beklemeleri; yüzlerce klinik verisinde ise indekssiz
Appointment/SentMessage taramaları ve 5 dakikayı aşıp üst üste binen reminder job'ları
sistemi pratikte kullanılmaz hale getirir. Faz 1 maddeleri tek başına bu tablonun büyük
kısmını çözer.

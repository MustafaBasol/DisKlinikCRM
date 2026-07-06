# Performans ve Mobil Uyumluluk Analiz Raporu

> Tarih: 2026-07-06
> Kapsam: Sayfa yüklenme süreleri (frontend bundle/asset), hız (sayfa yüklemesini
> etkileyen backend yanıt süreleri) ve mobil uyumluluk (responsive tasarım).
> Backend yük/ölçeklenebilirlik konuları `docs/45` kapsamındadır ve burada tekrarlanmaz.
> Güncelleme (2026-07-06): P0 maddeleri uygulanmaya başlandı; her maddenin altındaki
> **Durum** satırı hangi branch'te çözüldüğünü gösterir.

**Mimari özet:** React 18 + Vite 5 SPA (repo kökünde), Tailwind CSS 3.4, tüm sayfalar
`React.lazy` ile bölünmüş. Backend Express + Prisma (`server/`), frontend ayrı nginx
container'ından servis ediliyor. İstemci tarafında veri cache katmanı yok (raw axios).

---

## A. Sayfa Yüklenme Süreleri (Frontend)

### A1. 1.2 MB favicon.svg her sayfa yüklemesinde iniyor — en yüksek etkili sorun

`public/favicon.svg` **1.200.822 byte** ve `index.html:5` bunu sayfa ikonu olarak
kullanıyor (`<link rel="icon" href="/favicon.svg">`). Dosya `icon-navy.svg`'nin kopyası
ve içinde muhtemelen gömülü raster veri var. Her ziyaretçi, her ilk yüklemede 1.2 MB'lık
bir "favicon" indiriyor — mobil/yavaş bağlantıda tek başına saniyeler.

**Çözüm:** Favicon'u SVGO ile optimize edilmiş küçük bir SVG (birkaç KB) veya mevcut
32×32 PNG ile değiştir. Yarım saatlik iş, en büyük tekil kazanç.

**Durum:** ✅ Çözüldü (`perf/page-load-assets`). 1.2 MB `favicon.svg` silindi;
`index.html` artık kök `/favicon.ico` (1.2 KB) + 16/32px PNG'leri kullanıyor.

### A2. Marka SVG'leri 1.0–1.3 MB

`public/assets/brand/noramedi/` altında: `logo-horizontal-dark.svg` **1.31 MB**,
`icon-navy.svg` **1.20 MB**, `icon-light.svg` **1.04 MB**, `logo-horizontal-light.svg`
**1.02 MB**. SVG'ler PNG eşdeğerlerinden büyük (`logo-horizontal-dark.png` 285 KB) —
içlerine raster görüntü gömülü olduğunun işareti; vektör avantajı sıfırlanmış.

**Çözüm:** Logoları gerçek vektör olarak yeniden üret (SVGO ile optimize) ya da raster
kaynaklıysa WebP/optimize PNG kullan. Hangi bileşenlerin bu dosyaları import ettiğini
denetle.

**Durum:** ✅ Çözüldü (`perf/page-load-assets`). Dosyaların gerçek vektör olmadığı
doğrulandı (base64 PNG sarmalayıcısı). 4 ağır SVG silindi; tüm logo referansları
optimize 600×150 PNG'lere geçirildi: `logo-horizontal-light@2x.png` 24 KB (eski
1.02 MB SVG), yeni üretilen `logo-horizontal-dark@2x.png` 23 KB (eski 1.31 MB SVG).
Logo gösteren sayfa başına ~1 MB+ kazanç.

### A3. Ana `index` chunk 662 KB'a şişmiş (%48 büyüme)

`docs/40-frontend-bundle-splitting.md` çalışması sonrası başlangıç JS'i 448 KB'a
inmişti; committed `dist/assets/index-*.js` şu an **662 KB** (+ `vendor` 427 KB +
`i18n` 60 KB + CSS 111 KB). Ağır bir bağımlılık ya da sayfa kodu başlangıç bundle'ına
geri sızmış.

**Çözüm:** `rollup-plugin-visualizer` ile bundle analizi yap; başlangıç chunk'ına
giren ağır modülü tespit edip lazy chunk'a taşı. Hedef: doc-40 tabanına dönüş.

### A4. Google Fonts render-blocking

`index.html:23` Inter fontunu `<link rel="stylesheet">` ile yüklüyor — ilk boyamayı
bloklar. `preconnect` var (satır 21-22) ama eleme değil hafifletme.

**Çözüm:** Fontu self-host et (woff2 + `preload` + `font-display: swap`) veya
`media="print" onload="this.media='all'"` tekniğiyle bloklamayı kaldır.

### A5. İstemci tarafı veri cache yok — her route mount yeniden fetch

`src/services/api.ts` tek axios instance; tüm sayfalar `useEffect` içinde raw fetch
yapıyor. react-query/SWR yok. Kullanıcı sayfalar arasında gezindikçe aynı referans
veriler (servis listesi, randevu tipleri, klinik ayarları, kullanıcı listesi) her
seferinde yeniden istenip bekleniyor.

**Çözüm:** TanStack Query (react-query) katmanı ekle; en azından yavaş değişen
referans veriler için `staleTime` ile cache. Anında algılanan gezinme hızı artışı sağlar.

### A6. Landing/public sayfalar CSR — SEO ve LCP kaybı

Landing, legal ve `/c/:slug/kvkk` sayfaları SPA içinde client-side render ediliyor
(`App.tsx:227-235`); SSR/prerender yok. Crawler'lar JS çalışana kadar boş
`<div id="root">` görüyor; ilk boyama da index+vendor chunk'larının inmesini bekliyor.

**Çözüm:** Yalnızca public sayfalar için build sırasında prerender (statik HTML
snapshot); tam SSR'a geçmeye gerek yok.

### İyi durumda olanlar

- 60+ sayfanın tamamı `React.lazy` + `Suspense` ile bölünmüş (`App.tsx`).
- `vite.config.ts` manualChunks: `charts` (recharts 277 KB), `calendar` (fullcalendar
  244 KB), `i18n`, `vendor` ayrı chunk'larda — sadece kullanıldıkları sayfada iniyor.
- moment/lodash/dayjs yok; `lucide-react` ikon bazlı tree-shake ediliyor; hiçbir
  `import * as` yok.
- `nginx.conf:22-30` hashed asset'lere `expires 1y, immutable`, `index.html`'e
  `no-cache` veriyor — statik cache stratejisi doğru.

---

## B. Hız — Sayfa Yüklemesini Etkileyen Backend Boşlukları

(İndeksler, auth cache, compression, pool config docs/45 kapsamında uygulandı;
aşağıdakiler kalan boşluklardır.)

### B1. `GET /api/patients` sayfalama yok — sınırsız payload

`server/src/routes/patients.ts:99` `findMany` çağrısında `take`/`skip`/cursor yok;
Hastalar sayfası her açılışta kliniğin **tüm** hasta listesini indiriyor. Randevu
listesindeki 2000 satır cap'i burada yok. Büyük klinikte en büyük tekil payload/gecikme
riski.

**Çözüm:** Offset veya cursor pagination + üst sınır; frontend'de sayfalı liste ya da
sanal (virtualized) liste. Arama zaten server-side olduğundan geçiş düşük riskli.

**Durum:** ✅ Çözüldü (`perf/speed-quick-wins`). Backend artık `limit` (1-500'e
sıkıştırılır) ve `offset` parametrelerini tanıyor — frontend'in zaten gönderdiği ama
sunucunun yok saydığı `limit` değerleri (GlobalSearch 5, PaymentForm/TaskForm 20,
LabOrders 200) artık gerçekten uygulanıyor. Hastalar sayfası 200'lük partilerle
"Daha fazla yükle" düğmesiyle yüklüyor. `limit` göndermeyen eski çağrılar geriye
dönük uyumlu şekilde tam liste almaya devam ediyor (picker'lar için ayrı iş).

### B2. Dashboard stats her istekte sıfırdan hesaplanıyor

`server/src/routes/dashboard.ts:33-256`: dashboard açılışında ~13 count/aggregate
sorgusu + agenda + activities. Asıl sorun `buildChartData` (296-373): haftalık/aylık
randevular ve 6 aylık ödemeler **tam satır** olarak çekilip JS'te gruplanıyor — yoğun
klinikte binlerce satır her dashboard açılışında taşınıyor. Cache yok; her mount ve
her klinik değişimi tam yeniden hesap.

**Çözüm:** (1) Grafik verilerini Prisma `groupBy`/SQL tarih agregasyonuna çevir;
(2) klinik başına 30-60 sn TTL'li bellek-içi cache (mevcut auth cache deseni gibi).

**Durum:** ✅ Çözüldü (`perf/speed-quick-wins`). Aylık hizmet dağılımı tam satır
çekmek yerine `appointment.groupBy(appointmentTypeId)` ile DB'de sayılıyor; grafik
verisinin tamamı klinik kapsamı başına 60 sn TTL'li bellek-içi cache arkasına alındı
(`getChartDataCached`). Haftalık trend (≤7 gün, tek kolon) küçük olduğu için olduğu
gibi bırakıldı; 6 aylık ödeme satırları cache sayesinde dakikada bir kez taşınıyor.

### B3. `GET /api/notifications` GET içinde yazıyor ve 60 sn'de bir poll ediliyor

`server/src/routes/notifications.ts:47+` her çağrıda 5 ayrı `findMany` taraması yapıp
hesaplanan bildirimleri **upsert ediyor** (GET'te yazma). `NotificationBell.tsx:37-49`
bunu mount'ta, klinik değişiminde ve her 60 sn'de bir çağırıyor — açık sekme başına
sürekli derive+write yükü, sayfa yükleme sorgularıyla aynı pool'u paylaşıyor.

**Çözüm:** Hesaplama+upsert'i mevcut background worker'a taşı; GET yalnızca hazır
bildirim listesini okusun.

### B4. Badge sayaçları her route değişiminde yeniden fetch

`src/layouts/MainLayout.tsx:321-359`: iki `useEffect` hem 60 sn interval kuruyor hem
de dependency listesinde `location.pathname` var — **her sayfa geçişinde** contact-request
ve appointment-request count endpoint'leri yeniden çağrılıyor. NotificationBell ile
birlikte gezinme başına 3 arka plan isteği.

**Çözüm:** `location.pathname`'i dependency'den çıkar; yalnızca interval + klinik
değişiminde fetch et.

**Durum:** ✅ Çözüldü (`perf/speed-quick-wins`). İki badge effect'inden
`location.pathname` dependency'si kaldırıldı; sayaçlar yalnızca mount, klinik/kullanıcı
değişimi ve 60 sn interval ile yenileniyor.

### B5. Randevu listesi include'ları şişkin

`server/src/routes/appointments.ts:108-118`: liste sorgusu `practitioner` için tam
`userPublicSelect` (email/telefon/rol/isActive), `appointmentType: true` (tüm kolonlar)
ve `treatmentCase` include ediyor — 2000 satır cap'ine kadar × 4 join'lik geniş payload.

**Çözüm:** Liste görünümü için dar select: practitioner ad-soyad, appointmentType
ad+renk yeterli.

### B6. Hiçbir JSON GET'te `Cache-Control` yok

`server/src` genelinde API yanıtlarında cache directive yok; Express'in varsayılan weak
ETag'i 304 döndürse bile DB sorgusu her seferinde çalışıyor. Neredeyse her sayfada
yüklenen yavaş değişen referans endpoint'ler (servisler, randevu tipleri, klinik
ayarları, KVKK profili) her seferinde tam tur atıyor.

**Çözüm:** Referans endpoint'lere `Cache-Control: private, max-age=60` (veya uygun
süre) ekle; tarayıcı turu tamamen atlasın.

---

## C. Mobil Uyumluluk

**Genel durum orta-iyi.** Yapısal zor kısımlar çözülmüş durumda:

- Sidebar mobilde off-canvas drawer + hamburger + backdrop (`layouts/MainLayout.tsx`,
  `matchMedia('(max-width: 1023px)')`).
- 45 tablonun 44'ü `overflow-x-auto` sarmalayıcılı — geniş tablolar sayfayı kırmıyor,
  scroll ediyor.
- Modaller tutarlı `w-full max-w-* max-h-[90vh] p-4` deseninde, küçük ekranda düzgün
  daralıyor.
- Recharts her yerde `ResponsiveContainer` içinde; viewport meta doğru (`index.html:8`).
- Landing/marketing sayfaları breakpoint'lerle iyi kapsanmış (SEO açısından kritik olan
  kısım sağlam).

Toplam 69 dosyada 382 responsive prefix kullanımı var; kalan sorunlar yapısal değil,
içerik yoğunluğu cilası.

### C1. ~36 adet sabit `grid-cols-2` form grid'i — en görünür mobil kusur

İki input yan yana sabit kalıyor; 360px ekranda alanlar sıkışıyor/taşıyor. Yoğunlaştığı
yerler: `components/TreatmentCaseForm.tsx` (4×), `components/PaymentForm.tsx`,
`components/PaymentPlanForm.tsx`, `pages/PractitionerEarnings.tsx` (6×),
`pages/LabOrders.tsx` (3×), `pages/Register.tsx:217`, `pages/Branches.tsx:201`,
`pages/TreatmentCaseDetail.tsx`, `pages/Settings.tsx:1037`, `components/UserList.tsx`.

**Çözüm:** `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` toplu düzeltmesi. Mekanik,
düşük riskli, tek oturumluk iş.

### C2. WhatsApp/Instagram bağlantı sayfaları sıfır responsive

`pages/WhatsAppConnections.tsx` (70 KB) ve `pages/InstagramConnections.tsx` (37 KB)
hiç breakpoint içermiyor; yoğun config kartları ve sabit `grid-cols-2` bilgi blokları
(WA: 774/1039/1209, IG: 554) masaüstü varsayımıyla yazılmış.

**Çözüm:** Kart grid'lerine ve bilgi bloklarına `grid-cols-1 sm:grid-cols-2` /
`md:` geçişleri ekle.

### C3. Sayfa konteynerlerinde sabit `p-6`

Birçok sayfa kabı `p-6` (24px) padding'i mobilde de koruyor — telefonda ~48px yatay
alan kaybı. Örnekler: `pages/WhatsAppInbox.tsx:346`, `pages/ClinicSchedule.tsx:145`,
`pages/Reports.tsx:346` ve benzeri sayfa kökleri.

**Çözüm:** `p-4 sm:p-6` desenine geçiş.

### C4. Çoklu doktor takvim görünümü mobilde zorlayıcı

`components/MultiDoctorDayView.tsx` ve `CalendarTimelineView` responsive class
içermiyor; mobilde yalnızca yatay scroll ile kullanılabiliyor, doktor sayısı arttıkça
kullanım zorlaşıyor.

**Çözüm:** Küçük ekranda tek-doktor görünümüne düşür (doktor seçici ile) veya kolon
genişliklerini breakpoint'e göre daralt.

### C5. DentalChart sabit diş boyutları (düşük öncelik)

`ToothIcon.tsx` sabit `h-[104px] w-[70px]` boyutları, `DentalChart.tsx:202`
`overflow-x-auto` + `min-w-max` ile scroll ettiriyor — kullanılabilir ama telefonda
yoğun yatay kaydırma gerektiriyor.

**Çözüm:** Küçük ekranda ölçekli boyut (`sm:` altında daha küçük diş ikonları).
İsteğe bağlı iyileştirme.

### C6. Küçük kalan sayfalar

`pages/ClinicSchedule.tsx` (sabit padding, `w-fit` tab bar) ve `components/UserList.tsx`
(sabit `grid-cols-2`) responsive dokunuş içermiyor.

**Çözüm:** C1/C3 desenleriyle aynı geçiş.

---

## D. Öncelikli Yol Haritası

| Öncelik | İş | Efor | Beklenen etki |
|---------|-----|------|----------------|
| **P0** | ✅ A1 favicon değişimi (`perf/page-load-assets`) | ~30 dk | Her sayfa yüklemesinden 1.2 MB kalkar |
| **P0** | ✅ A2 marka SVG optimizasyonu (`perf/page-load-assets`) | saatler | Logo kullanan sayfalarda MB'larca kazanç |
| **P0** | C1 form grid toplu düzeltmesi (`grid-cols-1 sm:grid-cols-2`) | saatler | En görünür mobil kusur kapanır |
| **P1** | ✅ B1 patients pagination (`perf/speed-quick-wins`) | 1 gün | Büyük klinikte Hastalar sayfası sabit hızda |
| **P1** | ✅ B2 dashboard `groupBy` + kısa TTL cache (`perf/speed-quick-wins`) | 1-2 gün | Dashboard açılışı ve DB yükü düşer |
| **P1** | A3 bundle analizi + 662 KB chunk'ı küçültme | 0.5-1 gün | İlk yükleme JS'i ~%30 azalır |
| **P1** | C2-C3 bağlantı sayfaları + `p-4 sm:p-6` | 0.5-1 gün | Mobil cila |
| **P2** | B3 notifications compute'u worker'a taşıma | 1 gün | Sürekli arka plan DB yükü kalkar |
| **P2** | ✅ B4 badge refetch düzeltmesi (`perf/speed-quick-wins`) | ~1 saat | Gezinme başına 3 istek kalkar |
| **P2** | B5 randevu listesi dar select | ~2 saat | Takvim/liste payload'u küçülür |
| **P2** | B6 referans endpoint'lere Cache-Control | ~yarım gün | Tekrarlı turlar kalkar |
| **P2** | A4 font self-host, A5 react-query, C4-C6 | parça parça | Algılanan hız + mobil UX |
| **P3** | A6 public sayfalara prerender | 1-2 gün | SEO + landing LCP |

**Ölçüm önerisi:** P0-P1 sonrası Lighthouse (mobil, landing + login + dashboard) ile
önce/sonra karşılaştırması alın; hedef LCP < 2.5 sn, toplam ilk yükleme < 1 MB.

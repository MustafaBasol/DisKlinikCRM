# 47 — Görüntüleme Köprü (Bridge) Ajanı Sözleşmesi

Yerel klinik köprü ajanı, muayenehanedeki görüntüleme kaynaklarını (sensör
yazılımı çıktı klasörleri, panoramik/CBCT export'ları, DICOM router, ağız içi
kamera/tarayıcı vendor araçları) NoraMedi'ye bağlayacak Windows servisi olarak
tasarlanmıştır. Bu doküman backend sözleşmesinin bugünkü (Phase 2) durumunu ve
gelecek fazların kapsamını tanımlar.

## Bugün uygulanmış olan (PR: feature/imaging-bridge-contract)

### Eşleştirme (pairing)
1. Yönetici (OWNER / ORG_ADMIN / CLINIC_MANAGER) `POST /api/imaging/bridges`
   ile ajan kaydı oluşturur. Yanıt, düz metin token'ı (`nmb_` önekli, 32 bayt
   rastgele) **yalnızca bu bir kez** içerir.
2. Veritabanında yalnızca token'ın sha256 özeti (`tokenHash`) saklanır; token
   hiçbir listede, logda veya audit kaydında yer almaz.
3. Token klinikteki köprü ajanına elle (kurulum sihirbazı/konfig dosyası)
   girilir.
4. `POST /api/imaging/bridges/:id/revoke` token'ı anında geçersiz kılar.

### Heartbeat
- `POST /api/public/imaging/bridge/heartbeat` — `Authorization: Bearer <token>`.
- Gövde: `{ "agentVersion": "1.2.3" }` (opsiyonel, tek alan).
- Başarıda ajanın `lastSeenAt`, `status` (`pending` → `online`) ve
  `agentVersion` alanları güncellenir; yanıt `{ "ok": true }` ile sınırlıdır.
- Eksik/geçersiz/iptal edilmiş token'lar aynı jenerik 401'i alır.
- IP başına ve token başına ayrı rate limit uygulanır (mevcut
  `createRateLimiter` altyapısı; Redis varsa replika-güvenli).
- Heartbeat hiçbir PHI/PII taşımaz ve loglamaz.
- `offline` durumu bu fazda otomatik işaretlenmez; istemci `lastSeenAt`
  üzerinden tazeliği türetir (arka plan işi gelecek faz).

## Bilinçli olarak HENÜZ uygulanmayanlar (gelecek fazlar)

- **İş çekme (job polling):** Ajanın açık `ImagingRequest` kayıtlarını
  sorgulayıp cihaza iş göndermesi (`GET /bridge/jobs` benzeri, token-auth).
- **Yükleme init/complete:** Köprüden görüntü yükleme; büyük dosyalar için
  iki adımlı sözleşme (init → parça/tek PUT → complete) ve `ImagingStudy`
  kaydının `source: "bridge"` ile oluşturulması. Public upload endpoint'i
  bu PR'da kasıtlı olarak YOKTUR.
- **Çevrimdışı kuyruk:** Ajan tarafında internet kesintisinde biriktirme ve
  idempotent yeniden gönderim (sunucu tarafında idempotency-key desteği).
- **Klasör izleme:** Vendor yazılımının export klasörünü izleyip yeni
  dosyaları otomatik almak (ajan tarafı).
- **DICOM / router entegrasyonu:** C-STORE alıcısı veya DICOMweb (STOW-RS)
  uç noktası; `studyInstanceUid`/`sopInstanceUid` alanları bu amaçla şimdiden
  şemada hazırdır.
- **Vendor SDK adaptörleri:** Sensör/tarayıcı SDK'ları için ajan içi eklenti
  arayüzü.
- **Native Windows ajanının kendisi:** Bu depo yalnızca backend sözleşmesini
  içerir; ajan ayrı bir projedir.

## Güvenlik değişmezleri

- Token düz metni yalnızca kayıt yanıtında döner; sunucu tarafında saklanmaz.
- `tokenHash` hiçbir API yanıtına konmaz.
- Köprü endpoint'leri hasta verisi döndürmez; loglar/audit metadata yalnızca
  ajan ID'si ve sürüm içerir.
- Görüntü dosyaları için public URL üretilmez; orijinaller değişmezdir.

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
- `offline` durumu artık bir arka plan işiyle otomatik işaretlenir — bkz.
  "Offline job" bölümü.

### Görüntü yükleme (PR A: feature/imaging-bridge-ingest)

`POST /api/public/imaging/bridge/studies` — `Authorization: Bearer <token>`,
`multipart/form-data`.

**Tasarım kararı:** init/complete iki adımlı sözleşme yerine tek istek
kullanılır (manuel yükleme ile aynı desen); dosyalar `IMAGING_MAX_FILE_MB`
(varsayılan 50MB) ile sınırlıdır, güvenilirlik ihtiyacı idempotency ile
karşılanır.

**Body alanları:**
- `file` (zorunlu) — JPEG/PNG/WebP/DICOM (Part-10 only), magic-byte doğrulanır.
- `ingestKey` (zorunlu) — dosyanın sha256 hex özeti, **ajan hesaplar ama
  sunucu buffer'dan bağımsız olarak yeniden hesaplar ve karşılaştırır**;
  uyuşmazlıkta 400. Format: tam 64 küçük-harf hex karakter.
- `deviceId` (opsiyonel) — klinikte aktif bir `ImagingDevice` olmalı.
- `modality` (opsiyonel) — verilmezse `OTHER`.
- `studyDate` (opsiyonel).
- `imagingRequestId` (opsiyonel) — verilirse: aynı klinikte olmalı, durumu
  `requested`/`scheduled` (açık) olmalı; study otomatik olarak istemin
  `patientId`'sine bağlanır. **Ad/telefon/klasör adı/dosya adından eşleştirme
  yapılmaz.** Verilmezse `patientId: null` ile bağlanmamış kuyruğa düşer.

**Idempotency ve tekilleştirme:**
- Tekilleştirme **klinik düzeyindedir**: `@@unique([clinicId, ingestKey])`.
  Bilerek `bridgeAgentId` düzeyinde DEĞİLDİR — bir ajan değiştirilse veya aynı
  klinikte birden fazla ajan kullanılsa bile aynı dosya iki kez yüklenemez.
- Aynı klinik+ingestKey ile tekrar istek → `200 { ok, studyId, duplicate: true }`
  (var olan study'nin ID'si döner, yeni kayıt oluşmaz).
- Eşzamanlı yarış durumunda (iki istek aynı anda aynı dosyayı yükler) veritabanı
  unique constraint'i (P2002) yakalanır, geç kalan isteğin diske yazdığı dosya
  silinir ve `duplicate: true` ile mevcut study döner.

**Yanıtlar:** `201`/`200 { ok: true, studyId, duplicate }` · `400` (geçersiz
gövde / ingestKey formatı / hash uyuşmazlığı / dosya imzası) · `401` (jenerik)
· `404` (deviceId/imagingRequestId yok) · `409` (istem artık açık değil) ·
`413` (boyut) · `429` (rate limit).

**Rate limit ve eşzamanlılık:** heartbeat'ten ayrı, daha yüksek tavanlı IP +
token limitleri (burst yükleme için); token başına eşzamanlı yükleme sayısı
da sınırlıdır (bellek baskısını önlemek için, `multer.memoryStorage()` devam
ediyor — tam disk/stream staging'e geçilmedi, mevcut mimari ile tutarlı).

**Provenance:** `ImagingStudy.createdById` bridge yüklemelerinde `null`'dır
(kullanıcı aktörü yok) — bu yüzden şemada nullable'a çevrildi. `bridgeAgentId`
alanı hangi ajanın yüklediğini ayrıca kaydeder (unique constraint'in parçası
değildir, yalnızca provenance).

### Offline job

`server/src/jobs/imagingBridgeOfflineJob.ts` — her 2 dakikada bir, yalnızca
`status: 'online'` olup `lastSeenAt`'i `IMAGING_BRIDGE_OFFLINE_MINUTES`
(varsayılan 5) dakikadan eski olan ajanları `offline`'a çeker. `revoked` ve
`pending` durumlarına asla dokunmaz. `withJobLock` ile birden fazla API
replikası/worker aynı anda çalışsa da job yalnızca bir kez koşar.

## Bilinçli olarak HENÜZ uygulanmayanlar (gelecek fazlar)

- **İş çekme (job polling):** Ajanın açık `ImagingRequest` kayıtlarını
  sorgulayıp cihaza iş göndermesi (`GET /bridge/jobs` benzeri, token-auth).
  Bağlanmamış kuyruk + link modalı ilişkilendirmeyi zaten karşıladığından
  ertelendi.
- **Native Windows ajanının kendisi:** Bu depo backend sözleşmesini ve
  (ayrı bir PR'da) `bridge-agent/` klasörü altında ajanı içerecek; bu PR
  yalnızca sunucu tarafını kapsar.
- **Çevrimdışı kuyruk (ajan tarafı):** Ajanın internet kesintisinde
  biriktirmesi ve idempotent yeniden gönderimi — sunucu tarafı idempotency
  (ingestKey) zaten hazır, ajan bunu tüketecek.
- **Klasör izleme (ajan tarafı):** Vendor yazılımının export klasörünü izleyip
  yeni dosyaları otomatik yükleme — ajan implementasyonunun işi.
- **DICOM viewer:** Tarayıcıda DICOM görüntüleme (şu an yalnızca indirme).
- **DICOM / router entegrasyonu:** C-STORE alıcısı veya DICOMweb (STOW-RS)
  uç noktası; `studyInstanceUid`/`sopInstanceUid` alanları bu amaçla şimdiden
  şemada hazırdır. Raw (preamble'sız) DICOM kabulü de bu kapsamda — bugün
  yalnızca Part-10 kabul edilir.
- **Vendor SDK adaptörleri:** Sensör/tarayıcı SDK'ları için ajan içi eklenti
  arayüzü.

## Güvenlik değişmezleri

- Token düz metni yalnızca kayıt yanıtında döner; sunucu tarafında saklanmaz.
- `tokenHash` hiçbir API yanıtına konmaz.
- Köprü endpoint'leri hasta verisi döndürmez; loglar/audit metadata yalnızca
  ajan/cihaz ID'si, modality, sayaçlar ve sürüm içerir — dosya adı, token,
  tokenHash, hasta verisi ya da DICOM etiketi ASLA.
- Görüntü dosyaları için public URL üretilmez; orijinaller değişmezdir.
- Geçersiz/eksik/iptal edilmiş token'lar aynı jenerik 401'i alır (ret nedeni
  sızdırılmaz).

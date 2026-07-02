# Güvenlik Yapılacaklar Listesi

> Kaynak: 2026-07-01 tarihli proje geneli güvenlik incelemesi (auth/yetkilendirme, çok kiracılı izolasyon, girdi doğrulama, entegrasyonlar, altyapı).
> Satır numaraları inceleme tarihindeki koda göredir; kod değiştikçe kayabilir.

## P0 — Yüksek (hemen)

- [x] **1. Platform admin login'ine brute-force koruması ekle** *(2026-07-01: e-posta 5/15dk + IP 20/15dk limiti eklendi)* — `server/src/routes/platformAdmin.ts:29-63`
  Sistemin en yetkili hesabı (tüm kiracılara erişim) sınırsız parola denemesine açık; klinik login'deki `checkLoginAttempt` burada çağrılmıyor.
  *Çözüm:* `utils/helpers.ts:120-149`'daki mekanizmayı platform login'e uygula; e-posta + IP anahtarlı sınırla.

## P1 — Orta (bu sprint)

- [x] **2. `Frame-Options` başlık adını düzelt** *(2026-07-01: `X-Frame-Options: DENY` + prod'da HSTS eklendi)* — `server/src/index.ts:109`
  Doğru başlık `X-Frame-Options`; mevcut haliyle tarayıcılar yok sayar, clickjacking koruması fiilen yok (CSP `frame-ancestors` da yok).
  *Çözüm:* Başlığı düzelt; tercihen `helmet` ekleyip HSTS + CSP + X-Frame-Options'ı tek yerden yönet.

- [x] **3. `trust proxy` ayarla** *(2026-07-01: `TRUST_PROXY` env'i, varsayılan 1)* — `server/src/index.ts`
  Nginx arkasında `req.ip` proxy adresi olur; forgot-password/resend IP limitleri (`routes/auth.ts:337,530`) tek kovaya düşer ve etkisizleşir.
  *Çözüm:* `app.set('trust proxy', 1)` (veya env ile yapılandırılabilir).

- [x] **4. Public yazma endpoint'lerine rate limit ekle** *(2026-07-01: booking 10/15dk, kayıt 5/saat, check-slug 60/15dk — IP başına)*
  `routes/publicBooking.ts:85` (anonim randevu talebi), `routes/clinicRegistration.ts:29` (anonim org+klinik+kullanıcı oluşturma), `GET /api/register/check-slug/:slug` throttling'siz → spam ve kaynak tüketimi riski.
  *Çözüm:* IP tabanlı throttling (mevcut in-memory limiter kalıbı yeniden kullanılabilir; kalıcı çözüm için madde 6).

- [x] **5. Login throttling'e IP anahtarı ekle** *(2026-07-01: IP başına 20/15dk ikinci limit)* — `routes/auth.ts:44`
  Limit sadece e-posta anahtarlı; tek parolayı çok hesaba deneyen "password spray" yavaşlatılmıyor.
  *Çözüm:* Forgot-password'daki gibi IP anahtarlı ikinci limit.

- [ ] **6. Rate limit / lockout durumunu paylaşımlı depoya taşı** *(2026-07-01: sınırlama `createRateLimiter` yorumunda belgelendi; Redis/DB geçişi yatay ölçekleme öncesine ertelendi)* — `utils/helpers.ts:122-197`, `utils/inboundRateLimiter.ts`
  Tüm sayaçlar in-memory: restart'ta sıfırlanır, çoklu instance'ta paylaşılmaz (yatay ölçeklemede limit bypass edilir).
  *Çözüm:* Tek instance kaldıkça kabul edilebilir; ölçekleme öncesi Redis veya DB tabanlı sayaç. Kararı belgelendir.

- [x] **7. SMS sağlayıcı config'ini şifrele** *(2026-07-01: `encryptJson`/`decryptJson` ile AES-256-GCM; sadece smsService içinde çözülüyor)* — `server/src/routes/sms.ts:33-37,93-95`
  `turkeyProviderConfig`/`europeProviderConfig` JSON'u `ClinicSmsSettings`'e düz metin yazılıyor; `services/sms/smsProviders.ts:10-11` yorumu "encrypted" dese de şifreleme yok. Şu an sadece mock sağlayıcı var (gerçek anahtar saklanmıyor) ama gerçek sağlayıcı (NetGSM/Twilio) bağlanmadan önce kapatılmalı.
  *Çözüm:* WhatsApp token'larında kullanılan `utils/encryption.ts` (AES-256-GCM) ile şifrele/deşifre et.

- [x] **8. Webhook secret'larını DB'de şifrele** *(2026-07-01: `encryptSecretTagged` (`enc:v1:` öneki) yazımda; okuma geriye uyumlu — mevcut düz metin satırlar yeniden kaydedilene dek çalışır. Verify token'lar bilinçli olarak düz bırakıldı: yalnızca tek seferlik GET challenge'da kullanılıyor)* — `server/prisma/schema.prisma:1349-1358,1531-1532`
  `metaWebhookSecret`, `metaWebhookVerifyToken`, `webhookSecret`, `webhookVerifyToken` düz metin (WhatsApp erişim token'ları ise AES-256-GCM ile şifreli).
  *Çözüm:* Aynı `encryptSecret()` desenini uygula (mevcut kayıtlar için migration/backfill gerekir); `schema.prisma:1339,1347`'deki "no encryption utility in this project yet" bayat yorumlarını temizle.

- [x] **9. JWT iptal mekanizması ekle** *(2026-07-01: `User.passwordChangedAt` kolonu + migration; authenticate'te iat karşılaştırması — şifre değişince eski token'lar 401 alır. jti deny-list ölçekleme kararıyla birlikte değerlendirilecek)* — `server/src/middleware/auth.ts`
  `jti` üretiliyor ama hiçbir yerde kontrol edilmiyor; logout sadece cookie siliyor. Çalınan/sızan token 8 saat geçerli kalır.
  *Çözüm (asgari):* Parola değişince/hesap devre dışı kalınca eski token'ları geçersiz kılan `tokenVersion` veya `passwordChangedAt` kontrolü. Tam çözüm: jti tabanlı deny-list (ölçekleme kararıyla birlikte).

- [x] **10. Bearer-token fallback varsayılanını kapat** *(2026-07-01: varsayılan `false`; frontend'in tamamen cookie tabanlı olduğu doğrulandı, env ile geçici açılabilir)* — `utils/authFallback.ts:11-20`
  Fallback varsayılan açık ve Bearer istekleri CSRF'i tamamen atlıyor (`middleware/csrf.ts:69-70`); cookie geçişi bittiyse yüzeyi gereksiz genişletiyor.
  *Çözüm:* Frontend cookie-auth'a tam geçtiyse `AUTH_BEARER_FALLBACK_ENABLED=false` yap ve kod varsayılanını `false`'a çevir.

- [x] **11. Global error handler ekle** *(2026-07-01: 4xx body-parser hataları jenerik 'Invalid request', diğerleri loglanıp jenerik 500)* — `server/src/index.ts`
  Genel hata middleware'i yok; yakalanmayan hatalar Express default handler'a düşer ve `NODE_ENV` prod değilse stack trace cevaba yazılır.
  *Çözüm:* Route'lardan sonra `app.use((err, req, res, next) => ...)`: hatayı logla, istemciye jenerik `{ error: 'Internal server error' }` dön.

- [x] **12. Seed'e prod guard ekle, varsayılan şifreleri kaldır** *(2026-07-01: prod'da `ALLOW_PROD_SEED=true` olmadan hard-fail; platform admin şifresi `SEED_PLATFORM_ADMIN_PASSWORD` env'inden)* — `server/prisma/seed.ts:43,83`
  Tüm personel `password123`, platform admin `PlatformAdmin2026!`; seed'in prod'a karşı çalışmasını engelleyen kontrol yok.
  *Çözüm:* Seed başında `NODE_ENV === 'production'` ise hard-fail; platform admin şifresini env'den al.

## P2 — Düşük / iyileştirme (backlog)

- [x] **13. Platform adminlere MFA (TOTP)** *(2026-07-01: RFC 6238 TOTP eklendi — `utils/totp.ts` (bağımlılıksız, RFC vektörleriyle test edildi), `PlatformAdmin.totpSecretEncrypted`+`totpEnabledAt` kolonları (migration `20260701140000`), login'de MFA kapısı, setup/verify/disable endpoint'leri, PlatformSystem sayfasında kurulum UI'ı, login'de kod alanı)* — tam kiracı erişimli hesaplar için ikinci faktör.
- [x] **14. Hasta kaydı görüntüleme audit'i** *(2026-07-01: `GET /patients/:id` (BILLING dahil her iki yol) `patient_record_viewed` audit kaydı yazıyor; liste görünümleri bilinçli olarak loglanmıyor — gürültü)* — mevcut audit/activity log sadece yazma işlemlerinde; KVKK erişim hesap verebilirliği için hassas kayıt okuma olaylarını da logla (gdprExport zaten loglanıyor, örnek alınabilir: `routes/gdprExport.ts:61-72`).
- [x] **15. Aktör-hedef rol guard'ı** *(2026-07-01: CLINIC_MANAGER artık `admin` rolünde kullanıcı yaratamıyor; PUT'ta ek olarak mevcut `admin` kullanıcılara (OWNER olabilir!) hiç dokunamıyor — şifre değişikliği yoluyla hesap devralma kapatıldı)* — `routes/users.ts:118`: CLINIC_MANAGER kendi seviyesinde `admin` kullanıcı yaratabiliyor (OWNER/ORG_ADMIN'e yükselme Zod enum'uyla zaten engelli).
- [x] **16. Kayıtta e-posta enumeration** *(2026-07-01: rate limitle yetinildiği kodda belgelendi — 5/saat/IP toplu taramayı pratik olmaktan çıkarıyor, jenerik hata meşru kullanıcı UX'ini bozardı)* — `routes/clinicRegistration.ts:60-65` ayrı `EMAIL_ALREADY_EXISTS` dönüyor; jenerikleştir veya madde 4'teki rate limitle yetinildiğini belgelendir.
- [x] **17. nginx.conf TLS** *(2026-07-01: dosya başına belgelendi — bu config konteyner içi statik servis; TLS/redirect/X-Forwarded-For dış proxy'nin sorumluluğu, asgari beklentiler yorumda)* — sadece 80 dinliyor; TLS/HSTS/HTTP→HTTPS redirect üst katmanda ise belgelendir, değilse ekle.
- [x] **18. `ENCRYPTION_KEY` eksikse prod'da hard-fail** *(2026-07-01: prod'da `process.exit(1)`; 7 ve 8 buna dayandığı için öne alındı)* — `server/src/index.ts:66-72` sadece uyarıyor; şifreleme gerektiren yazmalar runtime'da patlar.
- [x] **19. `server/src/index.ts.bak` dosyasını repodan sil** *(2026-07-01: git index'ten ve diskten silindi)* — 4.844 satırlık bayat kopya, git'te izleniyor.
- [x] **20. `getLegacyScope` / `tenantGuard` kalıntılarını temizle** *(2026-07-01: `getLegacyScope` çağıransızdı, silindi; `tenantGuard` kodda hiç geçmiyor)* — `utils/clinicScope.ts:96-98`; kalan çağrı var mı grep'le doğrula.
- [x] **21. Yapısal request logging** *(2026-07-01: pino + pino-http eklendi — `utils/logger.ts`; auth/cookie başlıkları redact, URL'deki token parametreleri maskeli, body hiç loglanmıyor; 4xx=warn 5xx=error. Route içi `console.*` çağrıları duruyor — kademeli geçiş)* — morgan/pino yok, sadece ad-hoc `console.*`; PII maskeli yapısal loglama ekle.
- [x] **22. `npm audit` çalıştır** *(2026-07-01: server 0 açık; frontend'de 2 açık — esbuild/vite dev-server zinciri GHSA-67mh-4wv8-2f99, yalnızca dev sunucusunu etkiler, prod build etkilenmez; düzeltme Vite 8 breaking upgrade gerektiriyor → ayrı iş)* — manifest sürümleri güncel görünüyor (jsonwebtoken 9, express 5, prisma 7, exceljs) ama transitive bağımlılıklar taranmadı.

## İyi durumda olanlar (yeniden inceleme gerekmez)

- **Çok kiracılı izolasyon:** `utils/clinicScope.ts` org-first scoping; `selectedClinicId` her istekte DB'den doğrulanıyor; incelemede somut cross-clinic IDOR bulunamadı.
- **Parola/token yaşam döngüsü:** bcrypt cost-12; reset/verify token'ları 256-bit rastgele, SHA-256 hash'li saklanan, tek kullanımlık, süreli, enumeration-safe.
- **Dosya yükleme:** MIME + uzantı + magic-byte doğrulama, klinik-izole depolama, statik servis yok, auth'lu indirme (`routes/attachments.ts`).
- **Webhook güvenliği:** Meta/Instagram `X-Hub-Signature-256` HMAC, timing-safe karşılaştırma, prod'da fail-closed.
- **CSRF:** imzalı double-submit token + origin/referer kontrolü; cookie flag'leri (httpOnly, sameSite, secure) doğru.
- **SQL:** tamamen parametrize; tek `$queryRawUnsafe` kullanımı whitelist'li `groupBy` ile güvenli (`routes/reports.ts:25-26,87`).
- **Sır yönetimi:** `.env` commit edilmemiş; `utils/secrets.ts` prod'da eksik/zayıf/varsayılan secret'ta throw ediyor; WhatsApp token'ları AES-256-GCM ile şifreli.
- **SMS modülü:** Zod doğrulamalı, KVKK onay kapılı, kota-atomik, klinik-scoped; SSRF yok, sağlayıcı config'i API cevaplarında sızmıyor.

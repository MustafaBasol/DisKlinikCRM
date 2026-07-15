# NoraMedi (DisKlinikCRM) — KVKK Uyum ve Gizlilik Mühendisliği Denetim Raporu

**Tarih:** 2026-07-15 · **Denetim türü:** Salt-okunur kod/mimari denetimi ve iyileştirme planlaması
**Kapsam:** `e:\Ek Gelir\Siteler\DisKlinikCRM-git` deposu (kaynak kod, Prisma şeması, migration'lar, iş/job katmanı, dokümanlar)
**Yasal uyarı:** Bu rapor bir hukuki sertifikasyon DEĞİLDİR. "KVKK'ya tam uyumlu" ifadesi hiçbir koşulda kullanılmamaktadır. Bulgular dört sınıfta işaretlenmiştir: **[YASAL]** = 6698 sayılı Kanun'un açık hükmü, **[KURUM]** = KVKK Kurumu rehber/karar pratiği, **[GÜVENLİK]** = teknik en iyi uygulama, **[AVUKAT]** = Türk hukuk danışmanı görüşü gerektirir.

---

## İncelenen Kaynak Kökleri ve Yöntem

Üç paralel keşif taraması + hedefli dosya doğrulaması yapıldı (tam repo taraması yapılmadı; `dist/`, `node_modules/`, `.claude/worktrees/` hariç tutuldu):

| Modül | İncelenen kökler |
|---|---|
| Backend çekirdek | `server/src/` (index, middleware, routes, services, jobs, utils), `server/prisma/schema.prisma` + migration'lar |
| Gizlilik makinesi | `server/src/services/privacy/*`, `server/src/routes/patientPrivacy.ts`, `gdprExport.ts`, `publicClinicKvkk.ts`, `clinicLegalProfile.ts`, `server/src/jobs/dataRetentionCleanupJob.ts` |
| Entegrasyonlar | `server/src/routes/metaWhatsAppWebhook.ts`, `instagramWebhook.ts`, `whatsapp.ts`, `sms.ts`; `server/src/services/whatsapp/*`, `instagram/*`, `sms/*`, `googleAiStudio.ts`, `emailService.ts`, `channelConsentGate.ts` |
| Görüntüleme köprüsü | `server/src/routes/imaging.ts`, `imagingBridgePublic.ts`, `server/src/services/imaging/*`, `windows-bridge/` (.NET), `bridge-agent/` |
| Altyapı | `nginx.conf`, `scripts/noramedi-deploy.sh`, `server/src/services/backupService.ts`, `fileStorage.ts`, `server/src/utils/encryption.ts`, `logger.ts`, `helpers.ts` (rate limit), `.env.example` dosyaları (yalnızca değişken ADLARI) |
| Frontend | `src/pages/` (BookingWidget, legal sayfalar, ClinicKvkkPublicPage), `src/components/PatientPrivacyPanel.tsx`, `PatientForm.tsx` |
| Dokümanlar | `SECURITY_TODO.md`, `docs/08`, `docs/24`, `docs/26`, `docs/43`, `docs/45`, `docs/46` |

Hiçbir gerçek gizli değer (`server/.env` içeriği, token, parola) okunmadı ve bu raporda yer almaz. Kod değiştirilmedi.

---

# TESLİMAT 1 — Yönetici Özeti ve Hazırlık Derecesi

**Genel değerlendirme: KOŞULLU — İLK GERÇEK KLİNİK ÖNCESİ KRİTİK EKSİKLER VAR.**

Uygulama, sektör ortalamasının belirgin üzerinde bir gizlilik mühendisliği temeline sahip: hasta anonimleştirme servisi, veri saklama/imha job'ı, kanal bazlı versiyonlu rıza kaydı (`ChannelConsentLog`), klinik bazlı KVKK aydınlatma profili ve yayın akışı, değişmez denetim kütüğü (`AuditLog`), AES-256-GCM sır şifreleme, HMAC webhook doğrulama, AI sınırında PII maskeleme ve kiracı izolasyon yardımcıları mevcut ve büyük ölçüde doğru kurgulanmış.

Buna karşın **beş kritik blokör** doğrulandı:

1. **Kamuya açık randevu formu aydınlatma/rıza içermiyor** (Kanun m.10 şeffaflık yükümlülüğü) — `src/pages/BookingWidget.tsx` ve `server/src/routes/publicBooking.ts` üzerinde hiçbir KVKK metni/onay noktası yok.
2. **Yurt dışı aktarım mekanizması tanımsız** — Google Gemini (ABD), Meta WhatsApp/Instagram Cloud API üzerinden kişisel veri fiilen yurt dışına akıyor; 2024 sonrası m.9 rejimi (yeterlilik kararı / standart sözleşme + 5 iş günü içinde Kuruma bildirim / açık rıza) için hiçbir mekanizma kodda veya dokümanda yok. Sunucunun Türkiye'de olması bu aktarımları ortadan kaldırmaz.
3. **Veri ihlali tespit/bildirim altyapısı ve müdahale planı yok** (m.12/5; Kurul kararı 2019/10: 72 saat) — kod tabanında ve dokümanlarda "ihlal/breach/incident" kavramı hiç geçmiyor.
4. **WhatsApp giden mesaj hattında rıza denetimi yok** — SMS hattı tam rıza kapısına sahipken (`smsService.ts`), randevu/ödeme hatırlatmaları (`server/src/jobs/reminders.ts` → `whatsappService.ts`) `communicationConsent` kontrolü yapmadan hasta telefonuna sağlık/finans içerikli mesaj gönderiyor.
5. **Sağlık verisi için açık rıza / hukuki sebep haritası kayıt altında değil** — hasta kaydında yalnızca `communicationConsent`/`marketingConsent` boolean'ları var; tarih/versiyon/metin içeren genel işleme rızası veya m.6/3 istisnasına dayanma kararı hiçbir yerde belgelenmemiş. **[AVUKAT]**

Bunlara ek olarak VERBİS kaydı, saklama-imha politikası, veri işleyen (platform) ↔ veri sorumlusu (klinik) sözleşme seti ve İYS (ticari ileti) entegrasyonu gibi idari yükümlülükler tümüyle açık durumda.

**Hazırlık derecesi:** Teknik kontroller ~%70, idari/hukuki uyum ~%25. Faz 0 kapanmadan gerçek hasta verisiyle pilot başlatılması önerilmez.

---

# TESLİMAT 2 — Sistem ve Veri Akış Haritası (16 uçtan uca akış)

Ortak omurga: React SPA → nginx (statik) → harici reverse proxy (TLS) → Express API (`server/src/index.ts`, PM2 `noramedi-api`) → Prisma → PostgreSQL (Türkiye VPS). Dosyalar: yerel disk `uploads/{clinicId}/` (varsayılan) veya S3 uyumlu depo (`fileStorage.ts`).

| # | Akış | Yol | Kişisel veri | Not |
|---|---|---|---|---|
| 1 | Klinik içi hasta kaydı | `PatientForm.tsx` → `routes/patients.ts` → `Patient` | Kimlik, iletişim, adres, doğum tarihi, notlar | Rıza alanları boolean; kayıt anında aydınlatma sunulmuyor |
| 2 | Kamuya açık randevu | `BookingWidget.tsx` → `publicBooking.ts` → `AppointmentRequest` | Ad, telefon, tercih | **Aydınlatma/rıza YOK (KVKK-CRIT-001)**; rate limit var (10/15dk) |
| 3 | WhatsApp gelen (Meta) | Meta Cloud → `metaWhatsAppWebhook.ts` (HMAC-SHA256 + timingSafeEqual) → `metaInboundDelivery` → AI işlemci | Telefon, mesaj içeriği, ad | İyi: imza doğrulama + `channelConsentGate` + idempotency |
| 4 | WhatsApp gelen (Evolution) | Evolution → `whatsapp.ts /evolution-webhook` | Aynı | Paylaşımlı sır (HMAC değil); prod'da sır zorunlu |
| 5 | WhatsApp giden hatırlatma | `jobs/reminders.ts` → `whatsappService.sendWhatsAppMessage` | Ad, telefon, randevu/ödeme bilgisi | **Rıza kontrolü YOK (KVKK-CRIT-004)** |
| 6 | Instagram DM | `instagramWebhook.ts` (HMAC) → AI işlemci → inbox | Kullanıcı ID, mesaj | Rıza kapısı ortak |
| 7 | AI çağrısı (Gemini) | `whatsappAgentPrompt.ts` → `googleAiStudio.ts` → `generativelanguage.googleapis.com` | Yalnız ilk ad + maskelenmiş mesaj geçmişi (10 msj/300 kr, `[PHONE]`/`[EMAIL]`) | Veri minimizasyonu iyi; **yurt dışı aktarım mekanizması yok (KVKK-CRIT-002)** |
| 8 | SMS | `routes/sms.ts` → `smsService.ts` → TR/EU sağlayıcı yönlendirme | Telefon, mesaj | Tam rıza+opt-out+bölge+kota kapısı; sağlayıcı config'i şifreli (örnek kontrol) |
| 9 | E-posta | `emailService.ts` (nodemailer/SMTP) | E-posta, doğrulama/sıfırlama linki | SMTP sağlayıcısının yeri belirlenmeli **[AVUKAT]** |
| 10 | Hasta dosyaları | `attachments.ts` (multer bellek, 10MB, MIME+magic-byte) → `fileStorage.ts` | Röntgen, belge | Kimlik doğrulamalı stream; **imzalı URL yok, at-rest şifreleme yok** |
| 11 | Görüntüleme köprüsü | Windows cihaz → `imagingBridgePublic.ts` (Bearer sha256 hash, pairing HMAC+pepper, 10 dk TTL) → `ImagingStudy` | DICOM/ağız içi görüntü, hasta eşleşmesi | Token yalnız hash saklı; DPAPI ile istemcide korunuyor; PHI loglanmıyor (tasarım beyanı) |
| 12 | Klinik verisi dışa aktarım | `gdprExport.ts` → tüm klinik JSON | TÜM hastaların tam kayıtları | Denetim loglu; ama step-up auth yok, hacim sınırsız |
| 13 | Hasta bazlı dışa aktarım / haklar | `patientPrivacy.ts` (5 uç) + `PatientPrivacyPanel.tsx` | Hastanın tüm verisi | Org+klinik kapsamlı, rol kısıtlı — iyi |
| 14 | Anonimleştirme | `patientAnonymization.ts` | PII → `[ANONYMIZED]` | Tıbbi/mali kayıt korunur, idempotent, ActivityLog redaksiyonu — iyi |
| 15 | Saklama/imha | `dataRetentionCleanupJob.ts` (03:00, JobLock) | Mesajlaşma verileri | Tıbbi kayıtlara dokunmaz (doğru); **tıbbi kayıt saklama planı tanımsız** |
| 16 | Yedekleme | `backupService.ts` → `/root/noramedi-backups`, 7 gün | Tüm DB | Restore testi var; **yedek şifreleme durumu depo dışında, doğrulanamadı** |

---

# TESLİMAT 3 — İşleme Envanteri (özet tablo)

| Veri kategorisi | Örnek alanlar | Modeller | Hukuki sebep (öneri, **[AVUKAT]** onayı şart) | Saklama (mevcut) |
|---|---|---|---|---|
| Hasta kimlik/iletişim | ad, telefon, e-posta, adres, doğum tarihi | `Patient` | m.5/2-c sözleşme + m.6/3 sağlık istisnası | Süresiz (anonimleştirme isteğe bağlı) |
| **Sağlık verisi (özel nitelikli)** | tedavi, diş şeması, görüntüler, notlar | `TreatmentCase`, `ToothRecord`, `ImagingStudy`, `PatientAttachment`, `Appointment.notes` | m.6/3 (sır saklama yükümlüsü, tıbbi teşhis/tedavi) — platformun erişimi için veri işleyen sözleşmesi şart | Süresiz; sağlık mevzuatı asgari süreleri tanımsız |
| Finansal | ödemeler, taksit, sigorta | `Payment`, `PaymentPlan`, `InsuranceProvision` | m.5/2-c, ç (hukuki yükümlülük - VUK) | Süresiz |
| Mesajlaşma içeriği | WA/IG mesajları, inbox | `WhatsAppConversationMessage` vb. | Açık rıza (ChannelConsentLog) | 365/90/180/90/365 gün (env ile ayarlı, min 30) |
| Rıza kayıtları | kanal rızası | `ChannelConsentLog` | m.5/2-ç ispat yükümlülüğü | Süresiz (doğru) |
| Personel | kullanıcı hesapları | `User`, `UserClinic` | m.5/2-c iş sözleşmesi | Süresiz; **çalışan aydınlatması yok** |
| Denetim/işlem izleri | `AuditLog`, `ActivityLog` | — | m.5/2-f meşru menfaat | Süresiz (AuditLog bilinçli olarak silinmiyor) |
| Platform yöneticileri | `PlatformAdmin` | — | m.5/2-c | Süresiz |

## Veri Sorumlusu / Veri İşleyen Matrisi

| Taraf | Rol | Not |
|---|---|---|
| Klinik (Organization/Clinic) | **Veri sorumlusu** (hasta verisi) | `ClinicLegalProfile` bu rolü doğru modelliyor (MERSİS, KEP, irtibat kişisi alanları mevcut) |
| NoraMedi platformu | **Veri işleyen** (hasta verisi); **veri sorumlusu** (klinik kullanıcı hesapları, faturalama) | Yazılı veri işleyen sözleşmesi (DPA) bulunamadı **[AVUKAT]** |
| Hostinger VPS (TR) | Alt işleyen (barındırma) | Lokasyon ≠ aktarım uyumu; sözleşme teyidi gerekli |
| Google (Gemini) | Alt işleyen, **yurt dışı** | Mekanizma yok — KVKK-CRIT-002 |
| Meta (WhatsApp/Instagram Cloud) | Alt işleyen, **yurt dışı** | Mekanizma yok — KVKK-CRIT-002 |
| SMTP sağlayıcı | Alt işleyen (lokasyon belirsiz) | Tespit edilmeli |
| SMS sağlayıcıları (TR/EU) | Alt işleyen | Şu an mock; gerçek sağlayıcı bağlanırken sözleşme + lokasyon değerlendirmesi |
| S3 uyumlu depo (opsiyonel) | Alt işleyen | Endpoint seçimi aktarım analizine tabi |
| Evolution API (self-host varsayımı) | Bileşen/alt işleyen | Barındırma yeri teyit edilmeli; WhatsApp resmi olmayan istemci riski **[AVUKAT]** |

---

# TESLİMAT 4 — Uyum Eksik Kayıt Defteri (Gap Register)

## KRİTİK

**KVKK-CRIT-001 — Kamuya açık randevu akışında aydınlatma ve rıza yok** **[YASAL m.10]**
Kanıt: `src/pages/BookingWidget.tsx` ve `server/src/routes/publicBooking.ts` içinde "kvkk/consent/aydınlatma/onay" hiçbir eşleşme yok; buna karşın ad+telefon+randevu tercihi toplanıyor. WhatsApp/Instagram kanalı için var olan rıza kapısı bu kanala uygulanmamış. Çözüm: `ClinicLegalProfile` yayınlı aydınlatma metnine link + versiyonlu onay kaydı (ChannelConsentLog benzeri `web_booking` kanalı); profil yayınlanmamışsa formu bloke et (kanal kapısındaki `blocked_missing_legal_profile` deseni). Efor: **S–M**.

**KVKK-CRIT-002 — Yurt dışı aktarım mekanizmaları tanımsız (Gemini, Meta)** **[YASAL m.9]** **[AVUKAT]**
Kanıt: `googleAiStudio.ts` → `generativelanguage.googleapis.com` (ABD); `MetaCloudWhatsAppProvider.ts`, `instagramWebhook.ts` → Meta altyapısı. 2024 değişikliği sonrası m.9: yeterlilik kararı yok → standart sözleşme (imza + 5 iş günü içinde Kuruma bildirim) veya istisnalar gerekir. Veri minimizasyonu (yalnız ilk ad + maskeli metin) riski azaltır ama aktarımı ortadan kaldırmaz; telefon numarası Meta'ya zorunlu olarak gidiyor. Çözüm: aktarım envanteri → her alıcı için mekanizma seçimi (hukuk danışmanıyla), aydınlatma metinlerine aktarım beyanı, Gemini için "veri işleme eklentisi/paid tier" koşullarının teyidi. Efor: **M** (teknik) + hukuki süreç.

**KVKK-CRIT-003 — Veri ihlali tespiti, bildirim akışı ve müdahale planı yok** **[YASAL m.12/5]** **[KURUM 2019/10: 72 saat]**
Kanıt: `server/src` ve `docs/` genelinde ihlal/incident/breach kavramı sıfır eşleşme; harici hata izleme (Sentry vb.) yok; başarısız giriş/anomali alarmı yok (rate limit var ama alarm üretmiyor). Çözüm: yazılı müdahale planı (rol, 72 saat akışı, Kurum bildirim şablonu, ilgili kişilere bildirim), teknik tarafta güvenlik olay alarmları (`AuditLog` üzerinden eşik tabanlı uyarı, `OperationalEvent` genişletmesi). Efor: **M**.

**KVKK-CRIT-004 — WhatsApp giden hattında rıza/çekilme denetimi yok** **[KURUM]** **[GÜVENLİK]**
Kanıt: `jobs/reminders.ts` hasta telefonuna randevu ve ödeme hatırlatması gönderirken `communicationConsent`/opt-out kontrolü yapmıyor (grep: sıfır eşleşme); `whatsappService.ts` içinde de rıza kavramı yok. SMS hattı ise tam kapıya sahip (`smsService.ts:169-177` `evaluateSmsConsent`). Randevu hatırlatması "hizmetin ifası" savunulabilir **[AVUKAT]**, ancak ödeme hatırlatması + WhatsApp üzerinden sağlık çağrışımlı içerik için tutarlı bir rıza/çekilme mekanizması şart. Çözüm: `evaluateSmsConsent` benzeri kapıyı `sendWhatsAppMessage` öncesine amaç (purpose) parametresiyle taşı. Efor: **M**.

**KVKK-CRIT-005 — Sağlık verisi işleme için hukuki sebep haritası ve rıza kaydı yok** **[YASAL m.6]** **[AVUKAT]**
Kanıt: `Patient` modelinde yalnız `communicationConsent`/`marketingConsent` boolean'ları (schema.prisma:220-221) — tarih, versiyon, metin, kanal bilgisi yok; klinik içi kayıt sırasında aydınlatma sunulmuyor; m.6/3 istisnasına (sır saklama yükümlüsü sağlık personelince teşhis/tedavi amacı) dayanıldığına dair hiçbir belge yok. Platformun (veri işleyen) sağlık verisine erişimi m.6/3 kapsamında otomatik meşru değildir. Çözüm: hukuki sebep matrisi + hasta kayıt akışına versiyonlu aydınlatma teyidi (rıza değil, tebliğ kaydı) + gereken hallerde açık rıza kaydı (`ChannelConsentLog` genelleştirilmesi). Efor: **M–L**.

## YÜKSEK

**KVKK-HIGH-001 — Özel nitelikli veri için at-rest şifreleme yok** **[KURUM: Kurul 31/01/2018-2018/10 özel nitelikli veri tedbirleri]**
`fileStorage.ts` varsayılanı düz disk (`uploads/`); DB ve yedeklerde uygulama seviyesi şifreleme yok; disk şifreleme kanıtı yok. Yedek script'i (`/usr/local/sbin/noramedi-db-backup.sh`) depoda değil — şifreleme durumu **doğrulanamadı**. Çözüm: tam disk (LUKS) veya pgcrypto/dosya şifreleme + yedeklerin şifrelenmesi (age/gpg), anahtar yönetimi. Efor: **L**.

**KVKK-HIGH-002 — VERBİS kaydı ve Saklama-İmha Politikası yok** **[YASAL m.16 + Yönetmelik]** **[AVUKAT]**
Depo genelinde VERBİS sıfır eşleşme. Ana faaliyeti özel nitelikli veri işlemek olan klinikler VERBİS'e kayıt ve yazılı saklama-imha politikası yükümlüsüdür; platform kliniklere bu çıktıyı üretmelerinde rehberlik etmeli (ürün özelliği fırsatı). Efor: idari + **M** (ürün desteği).

**KVKK-HIGH-003 — Tıbbi kayıtlar için saklama süresi ve periyodik imha tanımsız** **[AVUKAT — sağlık mevzuatı]**
`dataRetentionPolicy.ts` bilinçli olarak yalnız mesajlaşma verisini kapsıyor (doğru tasarım); ancak hasta dosyası/`AuditLog`/`ActivityLog`/`SentMessage` için hiçbir süre yok. Özel sağlık kuruluşları mevzuatındaki asgari saklama süreleri (ör. hasta kayıtlarında uzun yıllar) belirlenmeden **hard-delete kesinlikle önerilmez** — mevcut anonimleştirme yaklaşımı doğru köprüdür. Çözüm: hukuk görüşü → politika → süre dolumunda anonimleştirme kuyruğu. Efor: **M**.

**KVKK-HIGH-004 — Klinik geneli JSON dışa aktarımında ek koruma yok**
`gdprExport.ts`: CLINIC_MANAGER dahil üç rol, tüm hastaların tam kayıtlarını (notlar dahil) tek istekle indirebiliyor. Denetim loglu ve rol kısıtlı (iyi), ancak step-up doğrulama (2FA yeniden teyit), hacim/frekans limiti ve alan minimizasyonu yok. Toplu sızdırma yüzeyi. Efor: **S–M**.

**KVKK-HIGH-005 — İYS (İleti Yönetim Sistemi) entegrasyonu yok** **[YASAL — 6563/ETK]** **[AVUKAT]**
`marketingConsent` alanı var ama ticari elektronik ileti onaylarının İYS'ye kaydı/sorgusu yok. Pazarlama amaçlı SMS/WhatsApp gönderilmeye başlanmadan önce zorunlu. Efor: **L** (İYS API entegrasyonu).

**KVKK-HIGH-006 — Şube kapsamlama tutarsızlığı (izolasyon riski)** **[GÜVENLİK]**
15 route dosyasında 63 adet doğrudan `req.user.clinicId` kullanımı (attachments, appointmentRequests, dentalChart, messages, reports, services, postTreatment, organizationWhatsApp, paymentPlans, inventory, insuranceProvisions, labOrders, dashboard, organizationBranches, gdprExport) — kanonik desen `validateAndGetClinicIdScope` iken. Bu, kiracılar-arası sızıntı değil (kullanıcının kendi kliniğine kısıtlar) ama çok şubeli organizasyonlarda yanlış kapsam/görünürlük hatası üretebilir ve geçmişte tekrarlayan hata sınıfıdır. Sistematik geçiş önerilir. Efor: **M–L**.

## ORTA

- **KVKK-MED-001 — İlgili kişi başvurularında 30 günlük yasal süre takibi yok** **[YASAL m.13]**: `PatientPrivacyRequest` durum alanı var ama son tarih/eskalasyon yok. Efor: **S**.
- **KVKK-MED-002 — Hastanın doğrudan başvuru kanalı yok**: haklar yalnız klinik personeli arayüzünden işletiliyor; `ClinicLegalProfile.privacyRequestEmail` mevcut ama public KVKK sayfasında başvuru formu yok. m.13 "yazılı veya Kurulca belirlenen yöntem" — klinik e-posta/KEP ile karşılanabilir **[AVUKAT]**. Efor: **M**.
- **KVKK-MED-003 — Çalışan (kullanıcı) aydınlatması yok**: personel hesapları, `AuditLog` IP/user-agent izlemesi hakkında bilgilendirme yok. Efor: **S** (metin) **[AVUKAT]**.
- **KVKK-MED-004 — CSP başlığı yok, helmet kullanılmıyor**: manuel başlıklar iyi (nosniff, DENY, no-referrer, prod HSTS) ama XSS'e karşı CSP eksik; sağlık verisi gösteren SPA için önerilir. Efor: **M**.
- **KVKK-MED-005 — Rate-limit durumu tek süreçte** (SECURITY_TODO açık madde 6): `REDIS_URL` yoksa bellek içi; çok işçili PM2'de zayıflar. Efor: **S** (Redis zaten destekli).
- **KVKK-MED-006 — Evolution webhook'u HMAC değil paylaşımlı sır**: prod'da sır zorunlu (503/401) ama gövde bütünlüğü doğrulanmıyor. Efor: **S** (sağlayıcı destekliyorsa).
- **KVKK-MED-007 — Harici hata/anomali izleme yok**: yalnız pino + console; ihlal tespit süresini uzatır (CRIT-003 ile bağlantılı). Efor: **S–M**.
- **KVKK-MED-008 — DICOM meta verisi işleme politikası belirsiz**: `ImagingStudy` yükleme doğrulaması magic-byte düzeyinde; DICOM tag'lerinde gömülü hasta kimliği için ayıklama/minimizasyon kuralı görülmedi (bridge tasarım beyanı loglama tarafını kapsıyor). Efor: **M**.

## DÜŞÜK

- **KVKK-LOW-001**: Seed verisi (`server/prisma/seed.ts`) gerçekçi formatta TR telefon/isim + herkesin bildiği `password123` içeriyor; prod koruması var (`ALLOW_PROD_SEED`), yine de demo ortamları için parola rastgeleleştirme önerilir.
- **KVKK-LOW-002**: `nginx.conf` TLS'i harici proxy'ye bırakıyor — prod'da HSTS/TLS1.2+/güçlü şifre takımlarının proxy'de doğrulanması operasyonel kontrol listesine eklenmeli.
- **KVKK-LOW-003**: Oturum 8 saat sabit; idle timeout yalnız frontend (`VITE_IDLE_TIMEOUT_MINUTES`). Sunucu tarafı kısa ömür + refresh düşünülebilir.
- **KVKK-LOW-004**: `gdprExport` dosya adında `clinicId` sızıyor (UUID, düşük risk).

---

# TESLİMAT 5 — Aşamalı İyileştirme Yol Haritası

Karmaşıklık: S / M / L / XL (takvim tahmini bilinçli olarak verilmemiştir).

**Faz 0 — İlk gerçek klinikten önce (blokörler)**
1. Public booking'e aydınlatma + versiyonlu onay kaydı (CRIT-001) — S–M
2. WhatsApp giden hattına rıza/opt-out kapısı (CRIT-004) — M
3. Yurt dışı aktarım envanteri + mekanizma kararı ve aydınlatma güncellemeleri (CRIT-002) — M + hukuk
4. Yazılı ihlal müdahale planı + temel güvenlik alarmları (CRIT-003) — M
5. Hukuki sebep matrisi + hasta kaydında aydınlatma teyidi (CRIT-005) — M–L
6. Yedek şifrelemesinin doğrulanması/uygulanması + disk şifreleme (HIGH-001'in yedek ayağı) — M
7. Veri işleyen sözleşmesi (platform↔klinik) ve alt işleyen listesi — hukuk

**Faz 1 — Genel üretime açılmadan önce**
- HIGH-001 kalanı (uploads at-rest şifreleme), HIGH-002 (VERBİS/saklama-imha desteği), HIGH-003 (tıbbi kayıt saklama politikası), HIGH-004 (export step-up + limit), HIGH-006 (kapsamlama geçişi), MED-001/002/003 — toplam **L–XL**

**Faz 2 — Ölçeklenme**
- HIGH-005 (İYS), MED-004 (CSP), MED-005 (Redis rate limit), MED-006, MED-007 (izleme/alarm), MED-008 (DICOM politikası) — **L**

**Faz 3 — Olgunluk**
- Periyodik erişim gözden geçirme raporları, otomatik saklama-süresi-dolumu anonimleştirme kuyruğu, klinik yöneticisine uyum panosu, sızma testi programı, LOW-001..004 — **L**

---

# TESLİMAT 6 — Hukuki/İdari Belge Listesi (tümü **[AVUKAT]** onaylı hazırlanmalı)

1. Klinik hasta aydınlatma metni (mevcut `ClinicLegalProfile` şablonunun hukuk revizyonu; yurt dışı aktarım bölümü eklenerek)
2. Web randevu formu aydınlatma + onay metni
3. Açık rıza metinleri (pazarlama; gerektiği ölçüde sağlık verisi)
4. Veri işleyen sözleşmesi (NoraMedi ↔ klinik) + alt işleyen ekleri (Google, Meta, SMTP, SMS, Hostinger)
5. Yurt dışı aktarım standart sözleşmeleri + Kurum bildirimi (5 iş günü)
6. Kişisel veri saklama ve imha politikası (klinik başına) + VERBİS kayıt rehberi
7. Veri ihlali müdahale planı + Kurum bildirim şablonu (72 saat)
8. İlgili kişi başvuru formu ve yanıt prosedürü (30 gün)
9. Çalışan aydınlatma metni + gizlilik taahhütnamesi
10. Platform kendi web sitesi için gizlilik/çerez politikası güncellemesi (mevcut `src/pages/legal/*` sayfalarının hukuk revizyonu)

# TESLİMAT 7 — Teknik Mimari İyileştirmeleri (öncelik sırasıyla)

1. Ortak **çıkış kapısı (egress gate)**: tüm giden mesaj kanallarını (WA/SMS/e-posta) tek `evaluateConsent(purpose, channel, patient)` fonksiyonundan geçir — SMS'teki mevcut kapının genelleştirilmesi.
2. **Rıza kayıt modelinin genelleştirilmesi**: `ChannelConsentLog` → kanal listesine `web_booking`, `in_clinic` ekle; hasta kaydına aydınlatma-teyit satırı.
3. **Güvenlik olay hattı**: `AuditLog` üzerine eşik tabanlı alarm (başarısız giriş dalgası, toplu export, olağan dışı anonimleştirme), `OperationalEvent` + e-posta/webhook uyarısı.
4. **At-rest şifreleme katmanı**: `fileStorage.ts`'e saydam şifreleme (AES-256-GCM, mevcut `encryption.ts` altyapısı yeniden kullanılabilir) + şifreli yedek.
5. **Kapsamlama standardizasyonu**: `req.user.clinicId` → `validateAndGetClinicIdScope` sistematik geçişi + bunu zorlayan lint kuralı/test.
6. CSP başlığı, Redis'e sabitlenmiş rate limit, Evolution için gövde imzası.
7. DICOM tag minimizasyonu (yüklemede hasta-kimlik tag'lerinin ayıklanması/eşlenmesi).

# TESLİMAT 8 — Doğrulama Kontrol Listesi ve Test Matrisi

Mevcut güçlü test tabanı: `server/src/tests/` (~60 suite; `patientPrivacy`, `aiPrivacyBoundary`, `dataRetentionCleanupJob`, `channelConsentGate`, `sessionCookieCsrf`, `treatmentCaseClinicScope`, `multiBranchAccess`, `billingPatientAccess`, `imagingBridge*` dahil).

| Kontrol | Mevcut test | Eklenmesi gereken |
|---|---|---|
| Kanal rızası (WA/IG) | ✅ `channelConsentGate.test.ts`, `channelConsentFlowResume.test.ts` | Web booking rıza kaydı |
| Giden mesaj rıza kapısı | ✅ yalnız SMS (`smsModule.test.ts`) | ❌ WhatsApp hatırlatma opt-out testi (CRIT-004 kapanınca) |
| Public booking aydınlatma | ❌ | Profil yayınsızken bloke; onay kaydı yazılıyor |
| AI sınırı PII | ✅ `aiPrivacyBoundary.test.ts` | Prompt'ta telefon/e-posta sızmadığının regresyonu (mevcutsa genişlet) |
| Saklama/imha | ✅ `dataRetentionCleanupJob.test.ts` | Tıbbi kayıtlara dokunulmadığının açık asserti |
| Kiracı izolasyonu | ✅ kapsam testleri + `test_isolation.ts` | 15 dosyadaki `req.user.clinicId` uçları için şube-kapsam testleri |
| Haklar/anonimleştirme | ✅ `patientPrivacy.test.ts` | 30 gün süre takibi (MED-001 sonrası) |
| Export koruması | kısmi | Step-up + oran limiti testi |
| Webhook imzaları | ✅ (Meta/IG) | Evolution gövde bütünlüğü |
| İhlal alarmları | ❌ | Eşik alarm birim testleri |
| Yedek/restore | ✅ `platformBackup.test.ts` | Yedek şifreleme doğrulaması (ops kontrol listesi) |

Manuel doğrulama (üretim öncesi): TLS/HSTS proxy ayarları, `SESSION_COOKIE_SECURE=true`, `AUTH_BEARER_FALLBACK_ENABLED=false` (varsayılan kapalı — teyit), `ENCRYPTION_KEY` set (fail-closed mevcut), disk şifreleme, yedek şifreleme, `server/.env` dosya izinleri.

---
---

# 1. Confirmed Critical Blockers

1. **KVKK-CRIT-001** — Kamuya açık randevu formu (BookingWidget + publicBooking) aydınlatma metni ve rıza kaydı olmadan kişisel veri topluyor (m.10). Kod düzeyinde doğrulandı: sıfır eşleşme.
2. **KVKK-CRIT-002** — Google Gemini ve Meta (WhatsApp/Instagram) üzerinden fiili yurt dışı aktarım var; m.9 (2024 sonrası) mekanizmalarının hiçbiri kurulmamış. Sunucunun Türkiye'de olması bu aktarımları kapsamaz.
3. **KVKK-CRIT-003** — Veri ihlali tespit, alarm ve 72 saatlik bildirim akışı için ne teknik altyapı ne yazılı plan mevcut (m.12/5).
4. **KVKK-CRIT-004** — WhatsApp giden hattı (randevu/ödeme hatırlatmaları) hiçbir rıza/çekilme kontrolü yapmıyor; SMS hattındaki mevcut kapı bu kanala uygulanmamış.
5. **KVKK-CRIT-005** — Sağlık verisi işleme için hukuki sebep haritası ve versiyonlu aydınlatma/rıza kaydı yok; hasta modelindeki iki boolean ispat yükünü karşılamaz.

# 2. Confirmed High-Risk Gaps

Özel nitelikli veri için at-rest şifreleme yok (dosyalar düz disk; yedek şifreleme doğrulanamadı) · VERBİS kaydı ve saklama-imha politikası yok · tıbbi kayıt saklama süreleri tanımsız · klinik geneli JSON export'ta step-up/hacim koruması yok · İYS entegrasyonu yok · 15 route dosyasında 63 adet kanonik olmayan `req.user.clinicId` kapsamlaması (şube görünürlüğü hata sınıfı).

# 3. Legal Questions Requiring Turkish Counsel

m.6/3 istisnasının klinik ve platform (veri işleyen) açısından kapsamı; Gemini/Meta aktarımları için standart sözleşme vs. açık rıza tercihi ve Kurum bildirimi; diş kliniği kayıtlarına uygulanacak asgari saklama süreleri (özel sağlık kuruluşları mevzuatı); randevu hatırlatmasının "hizmetin ifası" sayılıp sayılmayacağı; Evolution API'nin (gayriresmî WhatsApp istemcisi) kullanım riski; İYS yükümlülüğünün başlangıç eşiği; VERBİS kayıt yükümlülüğünün her klinik için değerlendirilmesi; çalışan izleme (AuditLog IP/UA) bildirimi.

# 4. Controls Already Implemented Correctly

Kanal rıza kapısı (versiyonlu metin anlık görüntüsü + `ChannelConsentLog`, profil yayınlanmadan akış bloke) · hasta anonimleştirme servisi (tıbbi/mali kayıt korumalı, idempotent, ActivityLog redaksiyonu) · mesajlaşma verisi saklama/imha job'ı (tıbbi kayıt hariç tutma kuralı açık) · hasta hakları API'si + panel (org/klinik kapsamlı, rol kısıtlı, denetim loglu) · klinik KVKK profili + public aydınlatma sayfası · AI sınırında veri minimizasyonu (ilk ad + maskeli 10 msj/300 kr) · Meta/IG webhook HMAC + timingSafeEqual · AES-256-GCM sır şifreleme + prod fail-closed · SMS hattında tam rıza/opt-out/bölge/kota kapısı · değişmez AuditLog + pino redaksiyonu · CSRF çift-gönderim + httpOnly çerezler + JWT iptali (`passwordChangedAt`) + 2FA · bridge token'larının yalnız hash'i, DPAPI istemci koruması, pairing HMAC+pepper · dosya yüklemede MIME+magic-byte doğrulama · seed'in prod koruması.

# 5. Required Actions Before First Real Clinic

Faz 0'ın tamamı: booking aydınlatma+rıza; WhatsApp giden rıza kapısı; aktarım envanteri ve mekanizma kararı (hukukla); ihlal müdahale planı + temel alarmlar; hukuki sebep matrisi + kayıt anında aydınlatma teyidi; yedek/disk şifreleme doğrulaması; platform↔klinik veri işleyen sözleşmesi ve alt işleyen listesi; prod ortam bayraklarının manuel kontrol listesi (TLS/HSTS, secure cookie, bearer fallback kapalı, ENCRYPTION_KEY).

# 6. Required Actions Before General Production

Faz 1: uploads at-rest şifreleme; VERBİS/saklama-imha politikası desteği ve kayıtları; tıbbi kayıt saklama politikası (hukuk onaylı) + süre dolumu anonimleştirme kuyruğu; export step-up + limit; kapsamlama standardizasyonu (`validateAndGetClinicIdScope`); başvuru süresi (30 gün) takibi; hasta doğrudan başvuru kanalı; çalışan aydınlatması. Pazarlama iletisi öncesi İYS.

# 7. Residual Risks

Meta/Google gibi alt işleyenlerin iç veri işleme pratikleri üzerinde sınırlı kontrol (sözleşmesel risk kalır) · Evolution API'nin WhatsApp ToS/istikrar riski · tek VPS mimarisinde fiziksel/operasyonel tek hata noktası ve yedeklerin aynı sunucuda tutulması · depo dışı operasyonel bileşenler (backup script, proxy TLS konfigürasyonu) bu denetimde doğrulanamadı · sosyal mühendislik/yetkili hesap kötüye kullanımı (export yetkisi olan roller) ancak izleme+step-up ile azaltılabilir · hukuki yorum değişiklikleri (Kurul kararları) sürekli takip gerektirir.

# 8. Final Go/No-Go Recommendation

**NO-GO (mevcut durumda) — koşullu GO yolu açık.** Gerçek hasta verisiyle ilk klinik, Faz 0 maddeleri (beş kritik blokör + veri işleyen sözleşmesi + yedek şifreleme teyidi) kapanmadan başlatılmamalıdır. Teknik temel güçlü olduğundan Faz 0'ın tamamı makul ölçekte iştir (çoğunluğu S–M, hukuki süreçler paralel yürütülebilir). Faz 0 kapandığında sınırlı pilot (tek klinik, yakın izleme) için **GO**; genel üretim için Faz 1'in tamamlanması şarttır. Bu tavsiye teknik denetim görüşüdür; nihai hukuki uygunluk kararı Türk hukuk danışmanına aittir.

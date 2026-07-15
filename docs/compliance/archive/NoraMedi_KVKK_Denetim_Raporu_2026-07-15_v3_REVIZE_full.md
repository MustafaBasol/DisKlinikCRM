# NoraMedi (DisKlinikCRM) — KVKK Uyum Denetimi: DÜZELTME / REVİZYON (v3)

**Rapor tarihi:** 2026-07-15 · **Son güncelleme:** 2026-07-15 (üçüncü düzeltme geçişi) · **Belge türü:** Salt-okunur rapor düzeltmesi (kod/mimari DEĞİŞTİRİLMEMİŞTİR)
**Önceki sürümler:** `e:\tmp\NoraMedi_KVKK_Denetim_Raporu_2026-07-15.md` (v1) ve bu dosyanın v2 hâli (Bölüm 1 düzeltme kaydı) — bu belgeyi geçersiz kılar, silinmemiştir/arşivlenmiştir
**Kapsam:** NoraMedi/DisKlinikCRM platformunun KVKK (6698 s. Kanun) uyum durumu — kod incelemesi + resmî kvkk.gov.tr kaynak doğrulaması; sözleşme/altyapı belgelerine erişim olmadan hazırlanmıştır
**Yasal uyarı:** Bu rapor hukuki sertifikasyon DEĞİLDİR ve sistemi "KVKK'ya tam uyumlu" olarak beyan etmez. Aşağıda kullanılan sınıflandırma etiketleri Bölüm 0.2'de tanımlanmıştır.
**Üçüncü düzeltme geçişinin kapsamı:** VERBİS resmî tarihleri (04.09.2025 t. 2025/1572 s. karar ve 25.12.2025 t. 2025/2393 s. karar) doğrulanarak düzeltildi; booking aydınlatma akışından her türlü onay/rıza kutusu kaldırıldı; KVKK-HIGH-007 "smsOptOut → WhatsApp" yanlış çıkarımı geri çekilip normalize tercih modeliyle değiştirildi; m.6/3 atfı harfsiz hâliyle düzeltildi ve veri sorumlusu/veri işleyen ayrımı netleştirildi; Faz 0/Faz 1 şifreleme ve export çelişkileri koşullu kurallarla giderildi; HIGH-006 mekanik toplu değişiklik önerisi CodeGraph destekli tekil sınıflandırmayla değiştirildi.

---

## 0.1 Neden bu revizyon yapıldı

İlk rapor, teknik bulgular ile hukuki değerlendirmeleri yer yer birleştirdi; bazı bulgularda "aydınlatma eksikliği" ile "rıza eksikliği" aynı bulgu içinde karıştırıldı, bazı bulgularda depo içi anahtar kelime taramasının sıfır sonucu doğrudan "yasal ihlal" gibi sunuldu, VERBİS ve İYS bulguları klinik-spesifik değerlendirme yerine evrensel zorunluluk gibi ifade edildi ve yüzdesel "uyum skoru" kullanıldı. Kullanıcı talebi üzerine, 2026-07-15 itibarıyla yürürlükte olan resmî Türk kaynakları (kvkk.gov.tr) esas alınarak on maddelik bir düzeltme uygulanmıştır. Kod tabanında hiçbir yeni tarama yapılmamış; yalnızca önceki bulguların hukuki çerçevesi ve sınıflandırması gözden geçirilmiştir.

## 0.2 Yeni sınıflandırma sistemi

Her bulgu artık **iki eksenli** etiketlenir:

**Kanıt kaynağı ekseni** (değişmedi): **[YASAL]** Kanun 6698 açık hükmü · **[KURUM]** KVKK Kurulu rehber/ilke kararı · **[GÜVENLİK]** teknik en iyi uygulama · **[AVUKAT]** Türk hukuk danışmanı görüşü şart.

**Bulgu niteliği ekseni** (YENİ — Düzeltme Talimatı #10):
- **TEKNİK-DOĞRULANMIŞ** — kodda doğrudan okunarak doğrulanmış somut eksiklik/hata.
- **ORGANİZASYONEL-EKSİK** — teknik değil, süreç/politika/sözleşme eksikliği (ör. müdahale planı yok).
- **DOKÜMANTASYON-BOŞLUĞU** — kontrol muhtemelen mevcut olabilir ama kanıtı/belgesi depoda yok.
- **DOĞRULANMAMIŞ-ÜRETİM-KONTROLÜ** — kod incelemesiyle ne doğrulanabilir ne çürütülebilir (altyapı/operasyon dışı kaldı).
- **HUKUKİ-DEĞERLENDİRME-GEREKLİ** — olgular nettir ama hangi hukuki sonucun bağlandığı avukat kararına bağlıdır.
- **ÜRETİM-HAZIRLIK-BLOKÖRÜ** — yasal ihlal iddiası olmasa da, gerçek hasta verisiyle çalışmadan önce kapatılması gereken kontrol.

**Kritiklik durum etiketleri** (yüzde skorların yerine — Düzeltme Talimatı #9): **Uygulanmış ve doğrulanmış** · **Kısmen uygulanmış** · **Eksik** · **Doğrulanmamış** · **Hukuki değerlendirme gerekli** · **Operasyonel kanıt gerekli**.

**Önemli ilke (Düzeltme Talimatı #10):** Bir bulgu, olgular ve hukuki koşullar birlikte sağlanmadıkça **"mevcut bir kanun ihlali"** olarak nitelendirilmez. Eksik bir politika, kanun ihlali kanıtlanmamış olsa da üretim hazırlık blokörü olabilir.

---

## 1. DÜZELTME KAYDI (Correction Log)

| # | Önceki bulgu/ifade | Sorun | Düzeltme | Dayanak |
|---|---|---|---|---|
| C1 | KVKK-CRIT-001: "aydınlatma/rıza YOK" tek bulguda birleştirilmiş; çözüm önerisi "onay kaydı" (rıza) içeriyordu | Aydınlatma (m.10) ile açık rıza (m.5/6) farklı kurumlardır; her veri toplama açık rıza gerektirmez | İkiye ayrıldı: KVKK-CRIT-001a (aydınlatma eksik — kritik) ve KVKK-MED-009 (ayrı, opsiyonel, amaca özgü açık rıza kontrolü — yalnızca rızaya dayanan bir işleme amacı varsa) | KVKK Kurulu 18.02.2026 tarih 2026/347 sayılı ilke kararı — aydınlatma ve açık rıza metinlerinin ayrı düzenlenmesi zorunluluğu; aydınlatma metni yalnızca "okudum, anladım" ile bitebilir, "okudum, onaylıyorum/rıza veriyorum" ifadesi yasaktır |
| C2 | KVKK-CRIT-004: "WhatsApp giden hattında rıza denetimi yok" — evrensel rıza eksikliği olarak sunulmuş | Randevu onayı/hatırlatması gibi hizmetin ifası kapsamındaki mesajlar açık rıza gerektirmeyebilir (m.5/2-c,f) | Amaç bazlı matrise (Bölüm 5) bölündü; teknik bulgu "opt-out/tercih tutarsızlığı"na daraltıldı (KVKK-HIGH-007) | m.5/2 rıza dışı işleme şartları; KVKK'nın orantılılık ilkesi rehberliği |
| C3 | KVKK-CRIT-003: "ihlal/breach/incident kelimesi sıfır eşleşme" ifadesi doğrudan "mevcut ihlal" izlenimi veriyordu | Anahtar kelime yokluğu, geçmiş bir ihlalin varlığını/yokluğunu kanıtlamaz; yalnızca organizasyonel kontrol eksikliğini gösterir | "ORGANİZASYONEL-EKSİK + ÜRETİM-HAZIRLIK-BLOKÖRÜ" olarak yeniden sınıflandırıldı; "mevcut ihlal" iması kaldırıldı | Düzeltme Talimatı #3 |
| C4 | KVKK-HIGH-002: "VERBİS kaydı ... yükümlüdür" (evrensel ifade) | VERBİS istisnası klinik ölçeğine göre değişir; her klinik ayrı değerlendirilmeli | Klinik-spesifik karar ağacına (Bölüm 6) dönüştürüldü; "HUKUKİ-DEĞERLENDİRME-GEREKLİ" olarak sınıflandırıldı | KVKK Kamuoyu Duyurusu — ana faaliyeti özel nitelikli veri işleme olan veri sorumluları için istisna: yıllık çalışan <10 VE yıllık mali bilanço <10.000.000 TL (bkz. Bölüm 6 kaynak notu) |
| C5 | KVKK-CRIT-005: "sağlık verisi için açık rıza / hukuki sebep haritası yok" başlığı, dolaylı olarak varsayılan temelin rıza olduğunu ima ediyordu | Sağlık verisi işleme için m.6/3 (kişisel sağlık verileri, ancak sır saklama yükümlülüğü altındaki kişiler/yetkili kurumlarca teşhis/tedavi/bakım amacıyla) öncelikli, rıza-dışı bir işleme şartıdır | Bulgu, "işleme faaliyeti bazlı hukuki sebep matrisi ve kanıt kaydı yok" olarak yeniden yazıldı (Bölüm 4); rıza varsayımı kaldırıldı | Düzeltme Talimatı #5, Kanun m.6/3 |
| C6 | HIGH-001: "at-rest şifreleme yok" genel ifadesi | Yalnızca uygulama seviyesi dosya şifrelemesinin yokluğu kod incelemesiyle doğrulandı; disk/DB/yedek/snapshot şifrelemesi incelenmedi | "Uygulama seviyesi dosya şifrelemesi: Eksik (doğrulandı). Altyapı seviyesi şifreleme: Doğrulanmamış" olarak ayrıştırıldı (Bölüm 8) | Düzeltme Talimatı #7 |
| C7 | HIGH-005: "İYS entegrasyonu yok" tüm giden iletişim için blokör gibi sunulmuş | İYS yalnızca ticari elektronik iletiler (pazarlama/tanıtım) için geçerlidir; randevu/hizmet bildirimleri kapsam dışıdır | Amaç bazlı ayrım yapıldı (Bölüm 5); yalnızca "marketing"/"campaign" amaçlı özellikler için blokör olarak işaretlendi; bu amaçlar kod tabanında şu an **etkin olarak uygulanmadığı** doğrulandı (yalnızca `marketingConsent` alanı var, giden pazarlama akışı bulunamadı) | Düzeltme Talimatı #8 |
| C8 | Yönetici özeti: "Teknik kontroller ~%70, idari/hukuki uyum ~%25" | Belgelenmiş bir puanlama metodolojisi yok; sayı keyfi görünüyor | Kaldırıldı; yerine durum etiketleri (Bölüm 0.2) kullanıldı | Düzeltme Talimatı #9 |
| C9 | KVKK-CRIT-002: yurt dışı aktarım bulgusu "ABD" gibi belirli ülke adı içeriyordu, sözleşme/DPA detayları doğrulanmadan | Fiziksel işleme ülkesi, sözleşme/DPA incelenmeden kesin iddia edilemez | "İşleme ülkesi doğrulanmamış; sağlayıcı genel bilgisine göre olası" ifadesine çevrildi; ayrıntılı matris eklendi (Bölüm 7) | Düzeltme Talimatı #6 |
| C10 | Genel: bulgular "confirmed" (doğrulanmış ihlal) dili ile "missing" (eksik kontrol) dili birbirine karışmıştı | Terminolojik tutarsızlık, okuyucuda "zaten ihlal var" izlenimi yaratıyordu | Bölüm 0.2'deki 6 kategoriye göre her bulgu yeniden etiketlendi | Düzeltme Talimatı #10 |

### 1.1 Üçüncü düzeltme geçişi (2026-07-15, aynı gün — ikinci revizyon kaydı)

| # | Önceki bulgu/ifade | Sorun | Düzeltme | Dayanak |
|---|---|---|---|---|
| C11 | VERBİS istisnası için "1 Temmuz 2026" tarihi doğrulanamamış olarak işaretlenmişti | Doğru resmî tarihler mevcuttu ama bu revizyonda henüz teyit edilmemişti | Resmî takvim doğrulandı: 04.09.2025 t. 2025/1572 s. karar, 01.10.2025 ilk duyuru, 25.12.2025 t. 2025/2393 s. karar (kümülatif/tekil kriter ayrımı), 12.01.2026 uygulama esasları duyurusu, 13.05.2026 t. 2026/1026 s. karar ile 2025 bilançosu nedeniyle kayıt yükümlülüğü doğanlar için süre 05.06.2026'ya uzatıldı | kvkk.gov.tr/Icerik/8388, /8577, /8752 (WebFetch/WebSearch ile doğrulandı — Bölüm 6) |
| C12 | KVKK-CRIT-001a çözüm önerisi "okudum, anladım" onay kutusu içeriyordu | Kullanıcı talimatı, booking formunda **hiçbir** onay/rıza kutusunun (rıza dahil, salt bilgi-alma onayı dahil) gönderim koşulu olmamasını istiyor | Aydınlatma metni gösterimi, kullanıcı eylemine bağlı olmayan otomatik bir görüntüleme-kaydına dönüştürüldü; formda hiçbir onay kutusu kalmadı | Düzeltme Talimatı #2 |
| C13 | KVKK-HIGH-007, `smsOptOut`'un WhatsApp'ı da kapsaması gerektiğini ima ediyordu | `smsOptOut` alanı ve UI'ı yalnızca SMS'e özgüdür; kanıt olmadan genel ret varsayımı yapılamaz | Bulgu "kanal+amaç bazlı tercihler tutarlı modellenmemiş" olarak yeniden yazıldı; normalize `CommunicationPreference` modeli ve migration uyumluluk kuralları eklendi | Düzeltme Talimatı #3 |
| C14 | Bölüm 4'te sağlık verisi şartı "m.6/3" olarak anılıyor ama fıkra/harf yapısı netleştirilmemişti; işleyen sözleşmesinin rolü belirsizdi | Kanun m.6/3 harfsiz tek cümledir (harflendirme yalnızca fıkra 2'de); işleyen sözleşmesi hukuki sebep yaratmaz | "m.6/3 aday şartı" terminolojisi netleştirildi, "6(3)(e)" gibi doğrulanamayan alt-bent atfı kullanılmadı; veri sorumlusu/veri işleyen ayrımı ve sözleşmenin sınırı ayrı paragrafta açıklandı | Düzeltme Talimatı #4 |
| C15 | HIGH-001 (dosya şifreleme) yol haritasında Faz 1, sonuç bölümünde zımnen Faz 0 gibi görünüyordu; HIGH-004 (export) hiç Faz 0'da değildi | İki bölüm arasında çelişki; export'un pilot öncesi korumasız kalması riski | Koşullu kural eklendi: altyapı şifrelemesi doğrulanırsa uygulama şifrelemesi Faz 1'de kalır, doğrulanamazsa Faz 0 blokörüdür; export için Faz 0'a "step-up VEYA devre dışı bırak" maddesi eklendi | Düzeltme Talimatı #5 |
| C16 | HIGH-006 "15 dosyada 63 kullanım" ifadesi zımnen hepsinin değiştirilmesi gerektiğini ima ediyordu | Bu kullanımların bir kısmı kasıtlı/doğru olabilir; toplu mekanik değişiklik yeni hatalar doğurabilir | Beş kategorili sınıflandırma (kasıtlı varsayılan / erişilebilir-klinik / organizasyon / kayıt-türetilen / hatalı) eklendi; yalnızca hatalı bulunanlar değiştirilecek, her değişiklik için ayrı regresyon testi zorunlu kılındı | Düzeltme Talimatı #6 |
| C17 | Rapor yalnızca `e:\tmp` altında duruyordu; depo içinde sürüm kontrollü bir çalışma belgesi yoktu | Uzun soluklu remediasyon takibi için repo içi, git ile izlenen bir belge gerekiyor | `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` oluşturuldu; önceki sürümler `docs/compliance/archive/` altına kopyalandı | Repository persistence talimatı |

---

## 2. REVİZE YÖNETİCİ ÖZETİ

**Genel durum: KOŞULLU KONTROLLÜ PİLOT YOLU AÇIK — gerçek hasta verisiyle sınırsız üretim öncesi kapatılması gereken teknik ve organizasyonel maddeler var.**

Uygulama sektör ortalamasının üzerinde bir gizlilik mühendisliği temeline sahiptir: hasta anonimleştirme servisi, veri saklama/imha job'ı, kanal bazlı versiyonlu rıza kaydı (`ChannelConsentLog`), klinik bazlı KVKK aydınlatma profili, değişmez denetim kütüğü, sır şifreleme, webhook imza doğrulaması, AI sınırında PII maskeleme ve SMS hattında tam rıza/opt-out kapısı doğrulanmıştır.

**Doğrulanmış teknik/organizasyonel blokörler (Faz 0):**

1. Kamuya açık randevu formunda toplama anında **Kanun m.10 aydınlatma metni yok** (rıza değil, bilgilendirme eksikliği) — TEKNİK-DOĞRULANMIŞ, ÜRETİM-HAZIRLIK-BLOKÖRÜ.
2. Yurt dışı aktarım (Google Gemini, Meta WhatsApp/Instagram) için m.9 (2024 sonrası rejim) uyum mekanizması belgelenmemiş; sözleşme/DPA/alt işleyen detayları depoda yok — HUKUKİ-DEĞERLENDİRME-GEREKLİ + DOKÜMANTASYON-BOŞLUĞU.
3. Veri ihlali tespit/bildirim organizasyonel süreci ve temel güvenlik alarmı yok — ORGANİZASYONEL-EKSİK, ÜRETİM-HAZIRLIK-BLOKÖRÜ (mevcut bir ihlal kanıtı DEĞİLDİR).
4. Kanal ve amaç bazlı iletişim tercihleri (SMS/WhatsApp) merkezi ve kanıtlanabilir biçimde modellenmemiş; `smsOptOut` yalnızca SMS'e özgüdür ve WhatsApp'a otomatik uygulanması **önerilmemektedir** — TEKNİK-DOĞRULANMIŞ (bkz. Bölüm 5, normalize tercih modeli).
5. Sağlık verisi işleme faaliyetleri için işleme-şartı-bazlı hukuki sebep matrisi ve aydınlatma-kanıt kaydı belgelenmemiş — DOKÜMANTASYON-BOŞLUĞU + HUKUKİ-DEĞERLENDİRME-GEREKLİ (varsayılan temel **açık rıza değildir**; bkz. Bölüm 4).
6. Veri işleyen (platform) ↔ veri sorumlusu (klinik) yazılı sözleşmesi ve alt işleyen listesi bulunamadı — ORGANİZASYONEL-EKSİK.
7. Yedek/disk şifrelemesi altyapı seviyesinde doğrulanamadı (kapsam dışı) — DOĞRULANMAMIŞ-ÜRETİM-KONTROLÜ.

**Bu revizyonda geri çekilen/yumuşatılan iddialar:** "Her toplama noktasında rıza şart", "her WhatsApp mesajı rıza gerektirir", "her diş kliniği VERBİS'e kayıt olmalı", "veriler şifrelenmemiş durumda" (genel ifade), "İYS her giden mesaj için şart". Bu maddelerin hiçbiri artık evrensel doğru olarak sunulmamaktadır; yerlerine amaç/klinik bazlı değerlendirme çerçeveleri konmuştur (Bölüm 4–8).

---

## 3. Sistem/Veri Akışı ve İşleme Envanteri

Bölüm değişmedi (bkz. önceki rapor Teslimat 2–3), **yalnızca aşağıdaki satırların dili düzeltildi:**

- **Akış 2 (Kamuya açık randevu):** "Aydınlatma YOK (kritik, m.10)" — "rıza" ifadesi kaldırıldı; ayrı açık rıza kontrolü **önerilmiyor**.
- **Akış 5 (WhatsApp giden hatırlatma):** "Rıza kontrolü YOK" ifadesi "Kanal+amaç bazlı tercih modeli YOK; `smsOptOut` WhatsApp'a otomatik uygulanmamalı (bkz. Bölüm 5)" olarak değiştirildi.
- **Akış 7 (Gemini):** "Yurt dışı aktarım mekanizması yok" ifadesine "— sözleşme/DPA detayları doğrulanmadı, bkz. Bölüm 7" eklendi.
- **Akış 10 (Ekler/dosyalar):** "at-rest şifreleme yok" → "uygulama seviyesi dosya şifrelemesi yok (doğrulandı); disk/depo seviyesi şifreleme doğrulanmadı".

Veri Sorumlusu/Veri İşleyen matrisi (önceki rapor Teslimat 3) geçerliliğini korur; Bölüm 7'de genişletilmiştir.

---

## 4. REVİZE HUKUKİ SEBEP (LAWFUL BASIS) MATRİSİ

İşleme faaliyeti bazında, m.5 ve m.6 kapsamındaki **rıza-dışı** şartlar önce değerlendirilmiştir; açık rıza yalnızca başka geçerli şart yoksa aday olarak işaretlenmiştir.

| İşleme faaliyeti | Veri kategorisi | Öncelikli aday şart (rıza-dışı) | Rolü (klinik/platform) | Açık rıza gerekli mi? | Kanıt/kayıt durumu |
|---|---|---|---|---|---|
| Hasta kimlik/iletişim kaydı (randevu, dosya açma) | Kimlik, iletişim | m.5/2-c (sözleşmenin kurulması/ifası) | Klinik: veri sorumlusu | Hayır (varsayılan) | Aydınlatma metni toplama anında sunulmuyor — DOKÜMANTASYON-BOŞLUĞU |
| Teşhis, tedavi, diş şeması, görüntüleme | Özel nitelikli sağlık verisi | **m.6/3 aday şartı** — kamu sağlığının korunması, koruyucu hekimlik, tıbbî teşhis, tedavi ve bakım hizmetlerinin yürütülmesi, sağlık hizmetleri ile finansmanının planlanması ve yönetimi amacıyla, sır saklama yükümlülüğü altında bulunan kişiler veya yetkili kurum/kuruluşlarca işlenmesi | Klinik: veri sorumlusu (uygulanacak şartı tespit edip belgelemekle yükümlü); Platform: veri işleyen, yalnızca klinik talimatı dahilinde işler | Hayır (m.6/3 şartları klinik tarafından sağlandığı ve belgelendiği sürece) | Klinik, m.6/3 şartının kendi faaliyetinde nasıl sağlandığını (personelin sır saklama yükümlülüğü kapsamı, amacın sınırları) belgelemiş değil — DOKÜMANTASYON-BOŞLUĞU; platform↔klinik veri işleyen sözleşmesi de yok — ORGANİZASYONEL-EKSİK |
| Randevu onayı/hatırlatması (mevcut randevu için) | İletişim, randevu bilgisi | m.5/2-c (sözleşmenin ifası) veya m.5/2-f (meşru menfaat, orantılı ise) | Klinik | Hayır (varsayılan) | Amaç bazlı politika yok — bkz. Bölüm 5 |
| Ödeme hatırlatması | İletişim, finansal | m.5/2-c, ç (sözleşme/hukuki yükümlülük) | Klinik | Hayır (varsayılan) | Aynı |
| Tedavi sonrası takip / memnuniyet anketi | İletişim, sınırlı sağlık bağlamı | m.5/2-f (meşru menfaat) — içerik sağlık detayı taşımamalı | Klinik | Duruma göre — içerik sağlık detayına girerse m.6/3 sınırları aşılabilir, **AVUKAT** | Bkz. Bölüm 5 |
| Pazarlama/kampanya iletişimi | İletişim + tercih verisi | **Açık rıza** (m.5/1) — burada rıza gerçekten gereklidir | Klinik | **Evet** | `marketingConsent` alanı var ama versiyonlu/tarih damgalı kanıt kaydı yok; giden pazarlama akışı kodda bulunamadı (özellik aktif değil) |
| Web sitesi üzerinden randevu talebi (kamuya açık) | Kimlik, iletişim, tercih | m.5/2-c (sözleşme öncesi adım) | Klinik | Hayır | **Aydınlatma metni eksik — KVKK-CRIT-001a** |
| WhatsApp/Instagram mesajlaşma (genel) | İletişim, mesaj içeriği | Kanal bazında değişir; mevcut `ChannelConsentLog` açık rıza modeli kullanıyor | Klinik/Platform (işleyen) | Platformun mevcut tasarımı: Evet (kanal katılımı için) — bu tasarım tercihi olarak korunabilir | Uygulanmış ve doğrulanmış (`channelConsentGate.ts`) |
| Çalışan (personel) hesap/erişim kaydı | Kimlik, iş bilgisi, IP/UA logu | m.5/2-c (iş sözleşmesi) | Klinik/Platform: veri sorumlusu (kendi personeli) | Hayır | Çalışan aydınlatması yok — DOKÜMANTASYON-BOŞLUĞU |
| Denetim/işlem izleri (AuditLog) | İşlem meta verisi | m.5/2-f (meşru menfaat — güvenlik/hesap verebilirlik) | Platform | Hayır | Uygulanmış |
| Yurt dışı AI işleme (Gemini) | Maskelenmiş mesaj + ilk ad | Yerel işleme şartı m.5/2-f olabilir; **ayrıca m.9 aktarım şartı ayrıca ve bağımsız olarak** sağlanmalı | Platform → Google (alt işleyen) | Aktarım şartı m.9'a göre ayrı değerlendirilir (rıza bir seçenektir, tek yol değildir) | Bkz. Bölüm 7 |

**Terminoloji notu (Düzeltme Talimatı #4):** Kanun m.6, 7499 sayılı Kanun'la değişik hâliyle, sağlık ve cinsel hayata ilişkin verileri **fıkra 3'te tek ve harfsiz bir cümle** olarak düzenler (harflendirilmiş (a)-(f) listesi yalnızca fıkra 2'de, sağlık-dışı özel nitelikli veriler için mevcuttur). Bu nedenle rapor "m.6/3 aday şartı" ifadesini kullanır; "m.6(3)(e)" gibi bir alt-bent atfı, bu revizyonda mevzuat.gov.tr üzerindeki konsolide metinle **doğrulanamamıştır** ve kullanılmamıştır — farklı bir harflendirme kastediliyorsa avukat teyidi istenmelidir.

**Veri sorumlusu / veri işleyen ayrımı (Düzeltme Talimatı #4 — netleştirildi):**
- **Klinik**, veri sorumlusu sıfatıyla, her işleme faaliyeti için **hangi m.5/m.6 şartının uygulandığını tespit etmek ve belgelemekle** yükümlüdür. Bu tespit platform tarafından yapılamaz; platform yalnızca aracı/araç sağlar.
- **NoraMedi (platform)**, veri işleyen sıfatıyla, yalnızca klinik tarafından **belgelenmiş talimatlar dahilinde** veri işler; kendi başına bir işleme amacı veya hukuki sebep belirlemez.
- Platform↔klinik veri işleyen sözleşmesi; tarafların rollerini, talimat kapsamını, güvenlik önlemlerini, gizlilik yükümlülüğünü, alt işleyenleri, silme/iade koşullarını ve ihlal bildirim usulünü **belgeler**.
- **Bu sözleşme, başka türlü hukuka aykırı olan bir işleme faaliyetini kendi başına hukuka uygun hâle getirmez** — sözleşme yalnızca roller ve yükümlülükler arasındaki ilişkiyi düzenler; m.5/m.6 kapsamındaki asıl hukuki sebep şartı klinik tarafından ayrıca ve bağımsız olarak sağlanmalıdır.

**Sonuç ilkesi:** Rapor, hiçbir genel "sağlık verisi rıza formu"nun otomatik olarak gerekli olduğunu varsaymaz. Eksik olan, bu matrisin klinik ölçeğinde resmî olarak belgelenmemiş olması ve toplama anında hangi şarta dayanıldığının hastaya şeffaf şekilde bildirilmemiş (aydınlatılmamış) olmasıdır — bu son nokta m.10 kapsamında ayrı bir yükümlülüktür ve açık rızadan bağımsızdır.

---

## 5. AMAÇ BAZLI GİDEN İLETİŞİM (OUTBOUND) MATRİSİ

| Amaç | Veri kategorisi | Aday işleme şartı | Ticari elektronik ileti (6563/ETK) kapsamına girer mi? | İYS kapsamı | Ret/opt-out gerekli mi? | İzin verilen içerik | Yasak hassas içerik | Asgari mesaj içeriği | Avukat teyidi gerekli mi? |
|---|---|---|---|---|---|---|---|---|---|
| appointment_confirmation | Randevu bilgisi | m.5/2-c | Hayır (işlemsel/hizmet bildirimi) | Kapsam dışı | Önerilir (iyi pratik) ama zorunlu değil | Tarih/saat/klinik/hekim | Tanı, tedavi detayı, sağlık durumu | Klinik adı, iletişim bilgisi | Hayır |
| appointment_reminder | Randevu bilgisi | m.5/2-c, f | Hayır | Kapsam dışı | Önerilir | Tarih/saat hatırlatması | Tanı/tedavi detayı | Klinik adı, vazgeçme talimatı (opsiyonel) | Hayır |
| appointment_change | Randevu bilgisi | m.5/2-c | Hayır | Kapsam dışı | Önerilir | Değişiklik bilgisi | Tanı/tedavi detayı | Klinik adı | Hayır |
| treatment_followup | Sınırlı sağlık bağlamı | m.5/2-f; içerik sağlık detayına girerse m.6/3 sınırı — **AVUKAT** | Hayır (hizmet bildirimi ise) | Kapsam dışı (hizmet ise) | Önerilir | Genel "kontrolünüz yaklaşıyor" tarzı | Ayrıntılı tanı/reçete bilgisi WhatsApp üzerinden **önerilmez** (kanal güvenliği + veri minimizasyonu) | Klinik adı | **Evet** — içerik sınırı için |
| post_treatment_check | Sınırlı sağlık bağlamı | m.5/2-f | Hayır (hizmet ise) | Kapsam dışı | Önerilir | Genel iyi olma kontrolü | Tanı detayı | Klinik adı | Kısmen |
| payment_reminder | Finansal | m.5/2-c, ç | Hayır (hizmet/faturalama bildirimi) | Kapsam dışı | Önerilir | Tutar, vade, ödeme linki | — | Klinik adı, iletişim | Hayır |
| operational_notice | İşlemsel | m.5/2-c, f | Hayır | Kapsam dışı | Önerilir | Sistem/hizmet bilgilendirmesi | — | Klinik adı | Hayır |
| satisfaction_survey | İletişim | m.5/2-f (orantılı ise) | Sınırda — anket amaç dışına kayarsa pazarlamaya yaklaşabilir | Muhtemelen kapsam dışı, **AVUKAT teyidi önerilir** | **Evet, zorunlu** | Anket linki | Sağlık detayı | Klinik adı, ret talimatı | **Evet** |
| marketing | İletişim, tercih | **Açık rıza (m.5/1)** | **Evet** | **Evet — İYS zorunlu** | **Evet, zorunlu** | Kampanya/promosyon | Sağlık verisi kullanımı yasak | Klinik adı, İYS uyumlu ret linki | **Evet** |
| campaign | İletişim, tercih | **Açık rıza (m.5/1)** | **Evet** | **Evet — İYS zorunlu** | **Evet, zorunlu** | Kampanya | Sağlık verisi | Klinik adı, ret linki | **Evet** |

**Kod tabanı bulgusu (doğrulandı):** `reminders.ts` şu an yalnızca randevu/ödeme hatırlatması gönderiyor (appointment_reminder, payment_reminder sınıfına girer); `marketing`/`campaign` sınıfına giren aktif bir giden akış **bulunamadı** — yalnızca `marketingConsent` şema alanı mevcut, kullanılan bir gönderim yolu yok. **Bu nedenle önceki raporun "WhatsApp'ta pazarlama içeriği rızasız gidiyor" imasını doğrulayan kanıt yoktur ve bu iddia geri çekilmiştir.**

**Düzeltme (Düzeltme Talimatı #3 — üçüncü revizyon):** Önceki revizyonda "hasta SMS kanalında ret verdiyse WhatsApp'ta da otomatik olarak engellenmelidir" ima edilmişti. Bu ima **geri çekildi**. `smsOptOut` alanı, veri tabanı şemasında ve UI metninde yalnızca SMS'e özgü bir tercih olarak tanımlanmıştır; alan adı, UI metni veya kayıtlı kanıt bu tercihin genel/kanal-bağımsız bir iletişim reddi olduğunu **kanıtlamıyor**. Bu nedenle "`smsOptOut` = tüm kanallar için ret" varsayımı hukuken temelsizdir ve rapor bunu artık iddia etmemektedir.

**KVKK-HIGH-007 (yeniden yazıldı):** "Kanal ve amaç bazlı iletişim tercihleri tutarlı biçimde modellenmemiş ve uygulanmamıştır." Gerçek teknik eksiklik, WhatsApp'ın SMS ret tercihini devralmaması değil — **hiçbir kanalda/amaç kombinasyonunda tercihin merkezi, izlenebilir ve kanıtlanabilir şekilde modellenmemiş olmasıdır.**

**Önerilen normalize edilmiş tercih modeli (veri modeli önerisi, migration gerektirir):**

| Alan | Açıklama |
|---|---|
| `patientId` | Hasta referansı |
| `channel` | `sms` \| `whatsapp` \| `email` \| `all` (yalnızca açıkça genel/global olarak yakalanmışsa `all`) |
| `purpose` | `appointment_reminder`, `payment_reminder`, `marketing`, vb. (Bölüm 5 taksonomisi) |
| `status` | `granted` \| `withdrawn` \| `not_captured` |
| `source` | Tercihin nereden geldiği (ör. `booking_form`, `patient_portal`, `staff_manual_entry`, `sms_reply_stop`) |
| `noticeOrConsentVersion` | İlişkili aydınlatma metni veya (varsa) açık rıza metni versiyonu |
| `grantedAt` / `withdrawnAt` | Zaman damgaları |
| `evidence` (metadata) | Kanıt bağlamı (ör. hangi form/istek, IP/UA — orantılı şekilde) |

**Migration uyumluluk kuralları (Düzeltme Talimatı #3 gereği zorunlu):**
1. Mevcut `smsOptOut = true` kaydı **yalnızca SMS kanalını** bloke eder; yeni modele `channel=sms, purpose=*, status=withdrawn, source=legacy_sms_opt_out` olarak taşınır.
2. WhatsApp için ayrıca kayıtlı bir onay/ret kanıtı (`ChannelConsentLog`) varsa, WhatsApp yalnızca **o kayda göre** kontrol edilir; SMS kaydından çıkarım yapılmaz.
3. Genel (`channel=all`) bir opt-out, yalnızca **açıkça** genel olarak yakalandıysa (ör. hasta "hiçbir kanaldan iletişime geçmeyin" demiş ve bu `source` ile kayıtlıysa) tüm zorunlu-olmayan kanalları bloke eder.
4. Güvenlik veya yasal olarak zorunlu bildirimler (ör. hesap güvenliği uyarısı, yasal bildirim) bu tercih modelinin dışında, **ayrı bir politika** ile yönetilir ve hiçbir opt-out ile engellenmez.
5. Bu kurallar netleşmeden mevcut `smsOptOut` alanı WhatsApp gönderimini engellemek için **kullanılmamalıdır** — yanlış varsayım hem aşırı-bloklama (hastanın istediği hatırlatmayı alamaması) hem de KVKK-HIGH-007'nin yanlış "çözülmüş" sayılması riskini doğurur.

**Önerilen teknik çözüm (değişmedi, güncellenmiş adlandırmayla):** Merkezi **amaç bazlı giden iletişim politikası** — her gönderim `purpose` etiketiyle işaretlenir, `resolveOutboundPolicy(purpose, channel, patient)` fonksiyonu yukarıdaki normalize modele bakarak (a) hangi işleme şartının geçerli olduğunu, (b) o kanal+amaç için tercih kaydının ne olduğunu, (c) İYS kontrolünün gerekip gerekmediğini döndürür.

---

## 6. VERBİS KARAR AĞACI (Klinik Bazlı — Evrensel Zorunluluk DEĞİL)

**Önceki bulgu ("VERBİS kaydı ... yükümlüdür") geri çekildi.** VERBİS kayıt yükümlülüğü ve istisnaları, KVKK Kurumu tarafından ilan edilen eşiklere göre **her veri sorumlusu (klinik tüzel/gerçek kişisi) için ayrı ayrı** değerlendirilir.

**Resmî kaynak bulgusu (kvkk.gov.tr Kamuoyu Duyurusu — "Ana Faaliyet Konusu Özel Nitelikli Kişisel Veri İşleme Olan Veri Sorumlularının VERBİS'e Kayıt Yükümlülüğüne İlişkin İstisna Kriteri Hakkında"):**

> Ana faaliyet konusu özel nitelikli kişisel veri işleme olan gerçek veya tüzel kişi veri sorumlularından, **yıllık çalışan sayısı 10'dan az VE yıllık mali bilanço toplamı 10.000.000 (on milyon) Türk Lirasından az** olanlar Sicile (VERBİS) kayıt ve bildirim yükümlülüğünden **istisna** tutulmuştur.

**Düzeltme (2026-07-15 ikinci revizyon — resmî kvkk.gov.tr kaynaklarıyla doğrulandı):** Önceki revizyonda "1 Temmuz 2026" tarihi doğrulanamamıştı; bu tarih **hatalıydı ve kullanılmamalıdır**. Aşağıdaki resmî takvim, kvkk.gov.tr üzerindeki üç ayrı duyuru sayfası doğrudan incelenerek doğrulanmıştır:

| Tarih | Olay | Kaynak |
|---|---|---|
| **04.09.2025** | Kurul Kararı No. **2025/1572** — istisna kriterinin esası (özel nitelikli veri ana faaliyet olan veri sorumluları için çalışan <10 VE bilanço <10M TL) | kvkk.gov.tr/Icerik/8388 |
| **01.10.2025** | Karar hakkında ilk Kamuoyu Duyurusu yayımlandı | kvkk.gov.tr/Icerik/8388 |
| **25.12.2025** | Kurul Kararı No. **2025/2393** — bilanço usulüne göre defter tutmayan veri sorumluları için uygulama netliği (aşağıda) | WebSearch ile doğrulandı, birincil karar metni doğrudan görülemedi |
| **12.01.2026** | 2025/1572 sayılı kararın **uygulama esaslarına ilişkin** Kamuoyu Duyurusu yayımlandı | kvkk.gov.tr/Icerik/8577 |
| **13.05.2026 / 14.05.2026** | Kurul Kararı No. 2026/1026 ile 2025 yılı bilançosu nedeniyle kayıt yükümlülüğü doğan tüzel kişiler için Sicile kayıt/bildirim süresi 05.06.2026'ya uzatıldı (bayram tatili gerekçesiyle) | kvkk.gov.tr/Icerik/8752 — WebSearch ile doğrulandı, birincil sayfa doğrudan görülemedi |

**2025/2393 sayılı karar kuralı (Düzeltme Talimatı #1 — eklendi):**
- **Bilanço esasına göre defter tutan** veri sorumluları için: yıllık çalışan sayısı VE yıllık mali bilanço toplamı kriterleri **kümülatif olarak** (birlikte) değerlendirilir.
- **Bilanço esasına göre defter tutmayan** veri sorumluları için: yıllık mali bilanço toplamı bilgisi mevcut olmadığından, **yalnızca yıllık çalışan sayısı kriteri** esas alınır.

Bu ayrım, çoğu diş kliniğinin (serbest meslek erbabı/işletme hesabı esasına göre defter tutan küçük klinikler dahil) VERBİS istisna değerlendirmesinde **hangi kriterin uygulanacağını değiştirdiği için önemlidir** — klinik kendi defter tutma usulünü (bilanço esası mı, işletme hesabı esası mı) bilmeden karar ağacı tamamlanamaz.

Genel (özel nitelikli veri ana faaliyet olmayan) veri sorumluları için ayrı ve daha yüksek bir eşik (çalışan <50 ve bilanço <100.000.000 TL) uygulanır; bu ayrım klinik değerlendirmesinde karıştırılmamalıdır.

**Kalan doğrulanmamış nokta (DOĞRULANMAMIŞ-ÜRETİM-KONTROLÜ):** 2025/2393 sayılı kararın ve 2026/1026 sayılı sürenin birincil karar metinleri bu revizyonda doğrudan görüntülenememiş, yalnızca WebSearch özetleriyle çapraz doğrulanmıştır; uygulama öncesi kvkk.gov.tr Kurul Kararları sayfasından birincil metinler teyit edilmelidir.

**Karar ağacı (her klinik için platform tarafından veya klinik danışmanınca doldurulmalı — güncellendi):**

1. **Klinik tüzel/gerçek kişi bazında** — VERBİS değerlendirmesi organizasyon değil, her ayrı veri sorumlusu tüzel/gerçek kişilik için yapılır (aynı NoraMedi organizasyonu altında birden fazla ayrı tüzel kişilik varsa, her biri ayrı değerlendirilir).
2. **Ana faaliyet konusu özel nitelikli veri işleme mi?** — Diş kliniği için genellikle "evet" kabul edilir (sağlık hizmeti = özel nitelikli veri işleme ana faaliyettir) ancak nihai nitelendirme **AVUKAT** kararına bırakılmalıdır.
3. **Klinik hangi usulde defter tutuyor?** — Bilanço esası mı, işletme hesabı esası mı (2025/2393 sayılı karar gereği bu adım zorunlu hale geldi).
   - Bilanço esası → adım 4'e geç (çift kriter).
   - İşletme hesabı esası / defter tutma yok → yalnızca çalışan sayısı kriteri uygulanır, adım 4'ü yalnızca çalışan sayısı için değerlendir.
4. Ana faaliyet özel nitelikli ise → **yıllık çalışan sayısı < 10** (VE, yalnızca bilanço esasına göre defter tutuluyorsa, **yıllık mali bilanço < 10.000.000 TL**) mi?
   - Evet → İstisna kapsamında olabilir (kayıt/bildirim yükümlülüğü yok) — ancak **istisna, diğer tüm KVKK yükümlülüklerini (aydınlatma, veri güvenliği, ilgili kişi hakları, saklama-imha politikası vb.) ortadan kaldırmaz.**
   - Hayır → VERBİS'e kayıt muhtemelen zorunludur; 2025 yılı bilançosu nedeniyle yükümlülük doğanlar için kayıt/bildirim süresinin (bkz. yukarıdaki tablo — 05.06.2026 uzatılmış son tarih, yalnızca bu spesifik grup için) geçip geçmediği ayrıca kontrol edilmelidir.
5. Ana faaliyet özel nitelikli değilse → farklı ve daha yüksek eşikler uygulanır (çalışan <50, bilanço <100M TL — yine 2025/2393 kümülatif/tekil ayrımına tabi) — klinik profiline göre ayrı değerlendirilmeli.
6. **Diğer zorunlu kayıt kuralları var mı?** (ör. kamu kurumu, belirli sektör düzenlemeleri) — istisna eşiklerini aşan başka bir zorunluluk olup olmadığı ayrıca kontrol edilmeli.

**Ürün önerisi (teknik):** Platform, klinik onboarding akışına "çalışan sayısı / yıllık bilanço" alanlarını ekleyip yukarıdaki karar ağacını otomatik olarak çalıştırarak kliniğe "VERBİS değerlendirmenizi yapın" uyarısı üretebilir — bu bir hukuki tavsiye değil, kliniği doğru soruyu sormaya yönlendiren bir araçtır.

**Yeniden sınıflandırma:** KVKK-HIGH-002 → **"Klinik-bazlı hukuki değerlendirme gerekli"** (HUKUKİ-DEĞERLENDİRME-GEREKLİ), evrensel "eksik kontrol" statüsünden çıkarıldı.

---

## 7. REVİZE YURT DIŞI AKTARIM MATRİSİ

**Korunan bulgu:** Google Gemini ve Meta (WhatsApp/Instagram Cloud API) üzerinden fiilen kişisel veri yurt dışına akmaktadır ve mevcut kodda/dokümanlarda m.9 (2024 sonrası rejim) uyum mekanizması için hiçbir iz yoktur — bu, **doğrulanmış** bir dokümantasyon/organizasyonel boşluktur ve Faz 0 kapsamında kalır.

**Düzeltilen/eklenen unsurlar (Düzeltme Talimatı #6):**

| Alt işleyen | Ürün/hesap türü | Sözleşme tarafı | API şartları | DPA var mı? | Sağlayıcı tarafı saklama | Model eğitiminde kullanım | İşleme/destek lokasyonu | Alt-alt işleyenler | İlişki türü | Uygulanabilir TR standart sözleşme modülü | Sonraki aktarım | Bildirim yükümlüsü | Klinik taraf olmalı mı? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Google (Gemini / `generativelanguage.googleapis.com`) | **Doğrulanmadı** — hangi ürün kademesi (ücretsiz AI Studio vs. ücretli Vertex/Enterprise) kullanıldığı kod incelemesiyle kesinleşmedi | **Doğrulanmadı** — sözleşmeyi platform mu klinik mi imzalıyor, teyit gerekli | **Doğrulanmadı** | **Doğrulanmadı** — depoda DPA belgesi yok | **Doğrulanmadı** | **Doğrulanmadı** — ücretsiz kademe modelleri eğitimde kullanabilir, ücretli kademe genelde kullanmaz; hangi kademe kullanıldığı netleşmeden iddia edilemez | **Doğrulanmadı** — "ABD" iddiası bu revizyonda geri çekildi | **Doğrulanmadı** | Muhtemelen platform→Google: veri işleyen→alt işleyen; **AVUKAT teyidi şart** | **Doğrulanmadı** — m.9 kapsamında hangi modül uygulanacağı sözleşme/DPA netleşmeden belirlenemez | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** |
| Meta (WhatsApp Cloud API, Instagram) | Meta Business/Cloud API — plan detayı doğrulanmadı | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | Muhtemelen platform→Meta: veri işleyen→alt işleyen (WhatsApp Business Cloud API şartlarına göre değişebilir); **AVUKAT teyidi şart** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** | **Doğrulanmadı** |

**Kod tabanında doğrulanmış, aktarımı ortadan kaldırmayan ama riski azaltan önlemler (korundu):** Gemini'ye yalnızca hastanın ilk adı ve maskelenmiş mesaj geçmişi (`[PHONE]`/`[EMAIL]` redaksiyonu, 10 mesaj/300 karakter sınırı) gönderiliyor — bu **veri minimizasyonu** önlemidir, aktarım yükümlülüğünü ortadan kaldırmaz, yalnızca risk azaltıcı bir faktördür (Düzeltme Talimatı #6 gereği açıkça belirtildi).

**Sonraki adım:** Platformun Google ve Meta ile mevcut sözleşme/DPA belgelerinin (varsa) hukuk danışmanınca incelenmesi ve yukarıdaki tablodaki "doğrulanmadı" hücrelerinin doldurulması gerekir. Bu rapor bu belgelere erişemediği için hiçbir hücreyi varsayımla doldurmamıştır.

---

## 8. ALTYAPI ŞİFRELEME — ÜRETİM DOĞRULAMA KONTROL LİSTESİ

**Kod incelemesiyle DOĞRULANAN:** `fileStorage.ts` varsayılan modu düz yerel disk (`uploads/{clinicId}/`); yüklenen dosyalar (röntgen, belgeler) için **uygulama seviyesi şifreleme uygulanmıyor**. Sır alanları (API anahtarları vb.) için `encryption.ts` üzerinden AES-256-GCM **uygulanıyor** (bu, dosya şifrelemesinden ayrı bir mekanizmadır).

**Kod incelemesiyle DOĞRULANAMAYAN (altyapı kapsam dışı — "tüm veriler şifrelenmemiş" iddiası geri çekildi):**

| Katman | Durum | Doğrulama yöntemi (üretimde) |
|---|---|---|
| Uygulama seviyesi alan (field) şifreleme | Kısmen uygulanmış (yalnız sır alanları — `encryption.ts`) | Kod incelemesiyle doğrulandı |
| Uygulama seviyesi dosya şifreleme (ekler/görüntüler) | **Eksik (doğrulandı)** | Kod incelemesiyle doğrulandı |
| PostgreSQL depolama şifrelemesi (TDE benzeri) | Doğrulanmamış | VPS/DB yapılandırması incelenmeli (`pg_hba.conf`, disk şifreleme durumu) |
| VPS disk/volume şifrelemesi | Doğrulanmamış | Hostinger VPS panelinden / `lsblk`+`cryptsetup status` ile kontrol |
| S3 uyumlu depo sunucu-taraflı şifreleme | Doğrulanmamış | Depo sağlayıcısının SSE ayarları kontrol edilmeli (kullanılıyorsa) |
| Yedek (backup) şifrelemesi | Doğrulanmamış — `backupService.ts` şifreleme çağrısı içermiyor gibi görünüyor ama yedek script'i (`/usr/local/sbin/noramedi-db-backup.sh`) depoda değil | Script içeriği + gpg/age kullanımı üretim sunucusunda kontrol edilmeli |
| Snapshot şifrelemesi (VPS sağlayıcı snapshot'ları) | Doğrulanmamış | Hostinger panel ayarları kontrol edilmeli |
| Transport şifreleme (TLS) | Doğrulanmamış (kod: nginx TLS'i harici proxy'ye bırakıyor) | Proxy/HSTS/TLS1.2+ ayarları üretimde doğrulanmalı |
| Anahtar saklama/rotasyon | Kısmen — `ENCRYPTION_KEY` ortam değişkeni, fail-closed davranış kodda doğrulandı; rotasyon süreci yok | Anahtar yönetim politikası (KMS/Vault değerlendirmesi) |

**Sonuç:** "Veriler şifrelenmemiş durumda" genel ifadesi yerine yukarıdaki tablo kullanılmalıdır. Yalnızca "uygulama seviyesi dosya şifrelemesi eksik" maddesi TEKNİK-DOĞRULANMIŞ statüsündedir; geri kalanı DOĞRULANMAMIŞ-ÜRETİM-KONTROLÜ statüsündedir ve üretim ortamında ayrıca kontrol edilmelidir.

**Kontrollü pilot kuralı — dosya depolama (Düzeltme Talimatı #5, önceki revizyondaki Faz 0/Faz 1 çelişkisini giderir):**

Önceki revizyonda, uygulama seviyesi dosya şifrelemesi hem yol haritasında Faz 1'e (Bölüm 10) hem de sonuç bölümünde zımnen Faz 0 blokörü gibi (Bölüm 13) sınıflandırılmıştı — bu çelişki gidermek için tek bir kural benimsenmiştir:

1. **Faz 0'da yukarıdaki üretim doğrulama kontrol listesi (disk/volume şifreleme, yedek şifreleme, dosya sistemi izinleri, dosyalara herkese-açık erişim olmadığı, indirme yetkilendirmesinin kimlik doğrulamalı olduğu, yedekten geri yükleme güvenliği) **fiilen doğrulanmalıdır**.
2. Bu kontroller **doğrulanır ve geçerse**, uygulama seviyesi ek (attachment) şifrelemesi **Faz 1'de kalabilir** — çünkü altyapı seviyesinde savunma derinliği sağlanmış olur.
3. Bu kontroller **doğrulanamazsa veya başarısız olursa**, gerçek hasta görüntüsü/röntgen/belge depolanması **Faz 0 blokörü** hâline gelir — yani üretim doğrulaması tamamlanana kadar, gerçek hasta dosyası içeren pilot **başlatılmamalıdır** (sentetik/test verisiyle pilot devam edebilir).
4. Bu nedenle "uygulama seviyesi dosya şifrelemesi Faz 1'dir" ifadesi **koşulsuz değildir** — yalnızca altyapı kontrolleri geçtiği takdirde geçerlidir.

---

## 9. REVİZE UYUM EKSİK KAYIT DEFTERİ (Gap Register)

Her bulgu artık: **[Kanıt kaynağı] [Bulgu niteliği] [Durum]** formatında.

### KRİTİK / ÜRETİM-HAZIRLIK-BLOKÖRÜ

**KVKK-CRIT-001a — Kamuya açık randevu formunda toplama anında aydınlatma metni yok** `[YASAL m.10]` `[TEKNİK-DOĞRULANMIŞ]` `[Eksik]`
Kanıt: `src/pages/BookingWidget.tsx`, `server/src/routes/publicBooking.ts` içinde kvkk/aydınlatma/privacy eşleşmesi yok. **Bu ikinci revizyonda daraltıldı (Düzeltme Talimatı #2):** ne bir açık rıza kutusu ("rıza veriyorum" tipi) ne de bir onay/bilgi-alma kutusu ("okudum", "anladım", "kabul ediyorum" tipi) formu göndermenin **koşulu** olarak önerilmemektedir. Aydınlatma metni, form alanlarından önce veya gönderim öncesinde belirgin biçimde **gösterilir**; hastanın herhangi bir onay eylemi yapmasına **bağlı değildir**. Hangi metnin/versiyonun/dilin/kanalın, ne zaman **görüntülendiğinin** kaydı otomatik olarak (kullanıcı etkileşimi gerekmeden, sayfa/adım render edildiğinde) tutulur — bu bir rıza kaydı değil, tebliğ/ispat kaydıdır ve asla rıza olarak sunulmaz. Ayrı, opsiyonel ve amaca özgü bir açık rıza kutusu **yalnızca** gerçekten rızaya dayanan bağımsız bir işleme amacı (ör. pazarlama izni) varsa ve booking akışından ayrı, isteğe bağlı bir alan olarak eklenmelidir — booking'in kendisi bu kutuya bağlı olamaz. Efor: **S–M**.

**KVKK-CRIT-002 — Yurt dışı aktarım için sözleşme/DPA/mekanizma belgeleri yok** `[YASAL m.9]` `[AVUKAT]` `[DOKÜMANTASYON-BOŞLUĞU + HUKUKİ-DEĞERLENDİRME-GEREKLİ]` `[Hukuki değerlendirme gerekli]`
Bkz. Bölüm 7 — matristeki "doğrulanmadı" hücreleri doldurulmadan kesin bir uyum mekanizması (standart sözleşme/rıza/istisna) seçilemez. Fiziksel işleme ülkesi hakkında kesin iddia bu raporda YAPILMAMAKTADIR. Efor: **M (teknik)** + hukuki süreç.

**KVKK-CRIT-003 — Veri ihlali tespiti, alarm ve 72 saatlik bildirim süreci yok** `[YASAL m.12/5]` `[KURUM 2019/10]` `[ORGANİZASYONEL-EKSİK]` `[Eksik]`
Kanıt: depoda ihlal/incident/breach kavramı yok, harici hata izleme yok. **Bu, geçmişte veya şu anda bir veri ihlali yaşandığının kanıtı DEĞİLDİR** — yalnızca ihlal halinde tepki verecek bir sürecin yokluğunu gösterir. 72 saatlik süre, veri sorumlusunun ihlali **öğrendiği** andan itibaren işler (Kurul kararı 2019/10). Efor: **M**.

**KVKK-CRIT-005 (yeniden adlandırıldı) — İşleme faaliyeti bazlı hukuki sebep matrisi ve toplama-anı aydınlatma kanıtı belgelenmemiş** `[YASAL m.6]` `[AVUKAT]` `[DOKÜMANTASYON-BOŞLUĞU]` `[Hukuki değerlendirme gerekli]`
Bkz. Bölüm 4. **Varsayılan temel açık rıza DEĞİLDİR** — sağlık verisi için m.6/3 (harfsiz, tek cümlelik özel şart) öncelikli adaydır; platform↔klinik veri işleyen sözleşmesi bu şartın yerine geçmez, yalnızca rolleri belgeler (bkz. Bölüm 4 "veri sorumlusu/veri işleyen ayrımı"). Eksik olan, hangi işleme faaliyetinin hangi şarta dayandığının resmî olarak belgelenmemesi ve hastaya toplama anında bunun bildirilmemesidir (aydınlatma, m.10). Efor: **M–L**.

**KVKK-HIGH-007 (önceki CRIT-004'ün yerini alır; üçüncü revizyonda yeniden yazıldı) — Kanal ve amaç bazlı iletişim tercihleri tutarlı biçimde modellenmemiş ve uygulanmamıştır** `[KURUM]` `[GÜVENLİK]` `[TEKNİK-DOĞRULANMIŞ]` `[Eksik]`
Kanıt: `smsService.ts` → `evaluateSmsConsent` `smsOptOut` kontrolü yapıyor; `whatsappService.ts`/`reminders.ts` aynı alanı kontrol etmiyor (grep: sıfır eşleşme). **Düzeltme (Talimat #3):** `smsOptOut` alanı yalnızca SMS'e özgüdür; bu tercihin WhatsApp'a da otomatik uygulanması gerektiği **iddia edilmemektedir** — aksine, bunu yapmak, kanıt olmadan bir SMS-özel tercihi genel bir ret olarak yorumlamak anlamına gelirdi. Gerçek eksiklik, kanal+amaç bazlı tercihlerin merkezi, kanıtlanabilir bir modelde tutulmamasıdır (bkz. Bölüm 5 — normalize tercih modeli ve migration uyumluluk kuralları). Aktif bir marketing/campaign akışı kodda bulunamadı — önceki "rızasız pazarlama mesajı" iması geri çekildi. Efor: **M**.

### YÜKSEK

**KVKK-HIGH-001 (daraltıldı) — Ek dosyalar için uygulama seviyesi şifreleme yok; altyapı seviyesi şifreleme doğrulanmadı** `[KURUM: Kurul 31/01/2018-2018/10]` `[TEKNİK-DOĞRULANMIŞ (uygulama) + DOĞRULANMAMIŞ-ÜRETİM-KONTROLÜ (altyapı)]` `[Koşullu ÜRETİM-HAZIRLIK-BLOKÖRÜ]`
Bkz. Bölüm 8 tam tablo ve "Kontrollü pilot kuralı — dosya depolama". **Statü koşulludur:** altyapı kontrolleri (disk/yedek şifreleme, izinler, yetkili indirme) üretimde doğrulanır ve geçerse, uygulama seviyesi şifreleme Faz 1'e ertelenebilir; doğrulanamazsa gerçek hasta dosyası depolanması Faz 0 blokörüne dönüşür. Efor: **L** (uygulama katmanı) + **operasyonel doğrulama** (altyapı, Faz 0'da zorunlu).

**KVKK-HIGH-002 (yeniden sınıflandırıldı) — VERBİS kayıt yükümlülüğü klinik bazında değerlendirilmemiş** `[YASAL m.16]` `[AVUKAT]` `[HUKUKİ-DEĞERLENDİRME-GEREKLİ]`
Bkz. Bölüm 6 karar ağacı. **Evrensel bir "VERBİS'e kayıt olunmalı" iddiası kaldırılmıştır.** Saklama-imha politikası eksikliği ayrı ve bağımsız bir organizasyonel gerekliliktir (istisna durumunda dahi geçerlidir). Efor: idari + **M** (ürün desteği — karar ağacı sihirbazı).

**KVKK-HIGH-003 — Tıbbi kayıtlar için saklama süresi ve periyodik imha tanımsız** `[AVUKAT]` `[DOKÜMANTASYON-BOŞLUĞU]` — değişmedi, bkz. önceki rapor. Hard-delete **kesinlikle önerilmiyor**. Efor: **M**.

**KVKK-HIGH-004 — Klinik geneli JSON dışa aktarımında ek koruma yok** `[TEKNİK-DOĞRULANMIŞ]` `[ÜRETİM-HAZIRLIK-BLOKÖRÜ]` — `gdprExport.ts` (`GET /api/clinic/export-data`) doğrulandı: step-up doğrulama, hacim/frekans limiti, uyarı/alarm yok; yalnızca rol bazlı yetkilendirme (`OWNER`/`ORG_ADMIN`/`CLINIC_MANAGER`) ve denetim kaydı (`gdpr_export` audit log) var. **Kontrollü pilot kuralı (Düzeltme Talimatı #5):** Pilot öncesinde bu uç nokta için **ya** (a) step-up kimlik doğrulama + rate limiting + denetim alarmı uygulanmalı **ya da** (b) sunucu tarafında zorlanan bir feature flag ile **devre dışı bırakılmalıdır**. Pilot süresince sınırsız/korumasız toplu (bulk) export yolu **açık bırakılmamalıdır** — bu iki seçenekten biri seçilmeden gerçek hasta verisiyle pilot başlatılmamalıdır. Efor: **S–M** (step-up+limit) veya **S** (yalnızca flag ile kapatma).

**KVKK-HIGH-005 (daraltıldı) — İYS entegrasyonu yalnızca marketing/campaign amaçları için eksik; bu amaçlar şu an kodda aktif değil** `[YASAL — 6563/ETK]` `[AVUKAT]` `[Eksik — kapsamı daraltıldı]`
Bkz. Bölüm 5. Operasyonel/hizmet bildirimleri İYS kapsamı dışındadır. **Öneri:** pazarlama/kampanya özellikleri, İYS + açık rıza + opt-out mekanizmaları uygulanana kadar **devre dışı bırakılmış durumda tutulmalı** (şu an zaten aktif akış yok — bu doğru varsayılan). Efor: **L** (yalnızca marketing özelliği geliştirilirse gerekli).

**KVKK-HIGH-006 (yaklaşımı düzeltildi) — Şube kapsamlama tutarsızlığı** `[GÜVENLİK]` `[KISMEN TEKNİK-DOĞRULANMIŞ / KISMEN DOĞRULANMAMIŞ]` — 15 dosyada 63 `req.user.clinicId` kullanımı tespit edildi. **Düzeltme (Talimat #6):** Önceki revizyon, bu 63 kullanımın tamamının hatalı olduğunu ve mekanik olarak değiştirilmesi gerektiğini ima ediyordu — bu iddia **geri çekildi**. `req.user.clinicId` kullanımının çoğu **kasıtlı olarak** varsayılan-klinik kapsamlı olabilir (ör. tek-klinikli kullanıcı akışları) ve doğru davranıştır; bir kısmı erişilebilir-klinik listesi, organizasyon bazlı veya kayıttan türetilen klinik kapsamına ihtiyaç duyabilir; yalnızca bir alt küme **gerçekten hatalıdır**. Her kullanım tek tek sınıflandırılmadan hangi 63'ün düzeltilmesi gerektiği bilinemez. Efor: **M–L** (sınıflandırma + yalnızca hatalı bulunanların düzeltilmesi).

### ORTA

Önceki raporun MED-001..008 listesi geçerliliğini korur (bkz. önceki rapor Teslimat 4 — ORTA), aşağıdaki tek ekleme ile:

- **KVKK-MED-009 (yeni) — Amaca özgü, opsiyonel açık rıza kontrolü yalnızca gerektiğinde eklenmeli**: Yalnızca gerçekten rızaya dayanan bir işleme amacı (ör. gelecekteki pazarlama özelliği) devreye alınırsa, ayrı bir açık rıza metni + kayıt mekanizması eklenmelidir; bu, booking formunun genel aydınlatma akışına **karıştırılmamalıdır** (2026/347 ilke kararı gereği). Efor: **S** (yalnızca ilgili özellik geliştirildiğinde).

### DÜŞÜK

Değişmedi (bkz. önceki rapor Teslimat 4 — DÜŞÜK, LOW-001..004).

---

## 10. REVİZE FAZ 0–3 YOL HARİTASI

Her madde: Bulgu ID · Kod modülleri · Hukuki/operasyonel bağımlılık · Önerilen uygulama · Kabul kriterleri · Gerekli testler · Migration gerekli mi · Backend/Frontend/Altyapı etkisi · Deploy etkisi · Karmaşıklık · Hukuki onay gerekli mi.

### FAZ 0 — İlk gerçek klinikten önce

**1) KVKK-CRIT-001a — Booking aydınlatma kaydı**
- Kod modülleri: `src/pages/BookingWidget.tsx`, `server/src/routes/publicBooking.ts`, `ClinicLegalProfile`, yeni `web_booking` kanal değeri (`ChannelConsentLog` şemasına benzer bir "notice acknowledgment" tablosu veya mevcut modelin genişletilmesi)
- Bağımlılık: Klinik `ClinicLegalProfile.isPublished` olmalı (mevcut altyapı kullanılabilir)
- Uygulama (Düzeltme Talimatı #2 ile güncellendi): Form alanlarından önce veya gönderim öncesinde yayınlı klinik-spesifik aydınlatma metni **belirgin biçimde gösterilir**; görüntüleme, herhangi bir kutu işaretlemesi veya onay eylemi **gerektirmez**. Metnin görüntülendiği an (`noticeDisplayedAt`), versiyonu, dili ve kanalı **otomatik olarak** kaydedilir ve bu kayıt talebe bağlanır. Profil yayınlanmamışsa formu `blocked_missing_legal_profile` deseniyle bloke et. **Hiçbir onay/rıza kutusu ("okudum", "anladım", "kabul ediyorum" dahil) forma eklenmez ve gönderimin koşulu yapılmaz.** Ayrı bir açık rıza kutusu yalnızca gerçekten rızaya dayanan bağımsız bir amaç (ör. pazarlama) varsa, booking'den ayrı ve isteğe bağlı olarak eklenir.
- Kabul kriterleri: (a) profil yayınlı değilse form gönderilemez, (b) gönderilen her talepte hangi aydınlatma metni versiyonunun, ne zaman, hangi kanalda **görüntülendiği** (kullanıcı onayına bakılmaksızın) kayıt altına alınır, (c) formda "okudum/anladım/onaylıyorum/kabul ediyorum" türü hiçbir onay kutusu YOK, (d) bu kayıt hiçbir API yanıtında veya UI metninde "rıza" (consent) olarak adlandırılmaz, (e) form gönderimi görüntüleme kaydının başarıyla oluşturulmasına bağlıdır, kullanıcı onayına değil
- Testler: profil yayınsızken bloke; görüntüleme-kaydı otomatik yazma (kullanıcı etkileşimi simüle edilmeden); versiyon değişiminde yeni kayıt; formda onay-kutusu elemanı bulunmadığının regresyon testi
- Migration: Evet (yeni `BookingNoticeDisplay` tablosu veya `ChannelConsentLog` kanal enum genişletmesi + `noticeVersion`/`displayedAt` alanı — alan adlandırması "consent" içermemeli)
- Etki: Backend + Frontend
- Deploy etkisi: Migration + feature flag ile kademeli açılış önerilir
- Karmaşıklık: **S–M**
- Hukuki onay: **Evet** (aydınlatma metni içeriği)

**2) KVKK-HIGH-007 — Normalize kanal+amaç bazlı iletişim tercih modeli ve `resolveOutboundPolicy`**
- Kod modülleri: yeni `CommunicationPreference` modeli (bkz. Bölüm 5 alan listesi), `server/src/jobs/reminders.ts`, `server/src/services/whatsapp/whatsappService.ts`, `server/src/services/smsService.ts`, yeni `resolveOutboundPolicy(purpose, channel, patient)`
- Bağımlılık: Bölüm 5 matrisinin ve migration uyumluluk kurallarının (5 madde) ürün kararı olarak onaylanması
- Uygulama: Mevcut `smsOptOut` **yalnızca SMS kanalına** taşınır (`channel=sms`); WhatsApp için ayrı kanıt (`ChannelConsentLog`) kullanılır; yeni `CommunicationPreference` tablosu `channel`+`purpose` bazında sorgulanır; genel (`channel=all`) opt-out yalnızca açıkça bu şekilde yakalanmışsa tüm zorunlu-olmayan kanalları etkiler
- Kabul kriterleri: (a) SMS-özel ret WhatsApp'ı **otomatik olarak** engellemez — yalnızca kayıtlı WhatsApp kanıtı WhatsApp'ı etkiler, (b) açıkça genel/`all` olarak yakalanmış bir ret tüm zorunlu-olmayan kanalları engeller, (c) marketing/campaign amaçları ayrı kapıdan geçer, (d) güvenlik/yasal zorunlu bildirimler bu modelin dışında kalır ve hiçbir opt-out ile engellenmez
- Testler: SMS-özel ret verilmiş bir hastanın WhatsApp hatırlatması **almaya devam ettiğinin** regresyon testi (yanlış çıkarım yapılmadığının kanıtı); açıkça genel ret verilmiş hastanın hiçbir kanaldan mesaj almadığının testi; amaç etiketi eksikse gönderimin reddedildiği test; migration sonrası mevcut `smsOptOut=true` kayıtlarının doğru `channel=sms` satırına dönüştüğünün testi
- Migration: **Evet** (yeni `CommunicationPreference` tablosu + `smsOptOut` → `channel=sms` geriye dönük veri taşıma script'i)
- Etki: Backend
- Deploy etkisi: Migration + geriye dönük uyumlu veri taşıma; taşıma sonrası doğrulama raporu önerilir
- Karmaşıklık: **M**
- Hukuki onay: Hayır (teknik tutarlılık düzeltmesi; model tasarımı hukuka aykırı bir varsayım içermez)

**3) KVKK-CRIT-002 — Yurt dışı aktarım envanteri ve mekanizma kararı**
- Kod modülleri: Yok (hukuki/sözleşmesel süreç); teknik çıktısı aydınlatma metni güncellemesi
- Bağımlılık: Google/Meta ile mevcut sözleşme belgelerinin temini
- Uygulama: Bölüm 7 matrisinin doldurulması → mekanizma seçimi (standart sözleşme/istisna) → Kurum bildirimi (gerekiyorsa)
- Kabul kriterleri: Her alt işleyen için matris hücreleri dolu; aydınlatma metninde aktarım beyanı güncel
- Testler: N/A (dokümantasyon)
- Migration: Hayır
- Etki: Hukuki + dokümantasyon
- Deploy etkisi: Yok
- Karmaşıklık: **M + hukuki süreç**
- Hukuki onay: **Evet, zorunlu**

**4) KVKK-CRIT-003 — Yazılı ihlal müdahale planı + temel alarm**
- Kod modülleri: `AuditLog` üzerine eşik alarmı, `OperationalEvent` genişletmesi
- Bağımlılık: Yok
- Uygulama: Yazılı plan (rol, 72 saat akışı, Kurum bildirim şablonu) + başarısız giriş/toplu export/anonimleştirme için eşik tabanlı e-posta/webhook alarmı
- Kabul kriterleri: Plan belgesi mevcut; en az 3 senaryo için otomatik alarm çalışıyor
- Testler: Eşik alarm birim testleri
- Migration: Hayır
- Etki: Backend + organizasyonel
- Deploy etkisi: Düşük
- Karmaşıklık: **M**
- Hukuki onay: Plan içeriği için **evet**

**5) KVKK-CRIT-005 — Hukuki sebep matrisi belgelenmesi + kayıt anında aydınlatma teyidi**
- Kod modülleri: `PatientForm.tsx`, hasta kayıt akışı, `ClinicLegalProfile`
- Bağımlılık: Bölüm 4 matrisinin hukuk onayından geçmesi
- Uygulama: Hasta kaydı sırasında aydınlatma metni gösterimi + versiyon kaydı (rıza değil, tebliğ kaydı); yalnızca gerçekten rıza gerektiren alanlar (varsa) için ayrı checkbox
- Kabul kriterleri: Her yeni hasta kaydında aydınlatma-gösterim kaydı oluşur
- Testler: Aydınlatma kaydı yazma testi
- Migration: Küçük (kayıt tablosu/alan eklentisi)
- Etki: Backend + Frontend
- Deploy etkisi: Düşük
- Karmaşıklık: **M–L**
- Hukuki onay: **Evet**

**6) Yedek/disk şifreleme doğrulaması (Bölüm 8) — koşullu blokör** — Kod modülleri: Yok (altyapı doğrulaması); Bağımlılık: VPS/DB/yedek erişimi. Uygulama: Bölüm 11 kontrol listesindeki tüm maddelerin (disk/volume, yedek, dosya izinleri, indirme yetkilendirmesi, geri yükleme güvenliği) fiilen test edilip belgelenmesi. Kabul kriterleri: her madde "doğrulandı: geçti" veya "doğrulandı: geçmedi" olarak işaretlenir; herhangi biri geçmezse gerçek hasta dosyası deposu Faz 0 blokörüne döner (yukarıdaki kural). Testler: N/A (operasyonel doğrulama, otomatik script + manuel kontrol karışık). Migration: Hayır. Etki: Altyapı. Deploy etkisi: Yok (yalnızca doğrulama). Karmaşıklık: **M**. Hukuki onay: Hayır.

**7) Veri işleyen sözleşmesi (platform↔klinik) + alt işleyen listesi** — Karmaşıklık: Hukuki süreç, Hukuki onay: **Evet, zorunlu**.

**8) KVKK-HIGH-004 — Klinik geneli export'un pilot öncesi karara bağlanması** — Kod modülleri: `server/src/routes/gdprExport.ts`. Bağımlılık: Ürün kararı (step-up+limit mi, yoksa geçici devre dışı bırakma mı). Uygulama: **Seçenek A** — step-up kimlik doğrulama (ör. şifre/OTP yeniden teyidi) + rate limiting + eşik-bazlı denetim alarmı; **Seçenek B** — sunucu tarafında zorlanan `EXPORT_FULL_CLINIC_ENABLED` feature flag ile uç noktayı kapatma. Kabul kriterleri: pilot başlamadan önce A veya B'den biri üretimde etkin; hangisi seçildiyse test kanıtıyla belgelenir. Testler: Seçenek A için step-up bypass edilemediği testi; Seçenek B için flag kapalıyken 403/404 döndüğü testi. Migration: Seçenek A ise hayır (mevcut audit log kullanılır); Seçenek B ise hayır (env-flag). Etki: Backend. Deploy etkisi: Düşük. Karmaşıklık: **S–M**. Hukuki onay: Hayır.

### FAZ 1 — Genel üretime açılmadan önce
HIGH-001 (uploads uygulama-seviyesi şifreleme — **yalnızca** Faz 0 altyapı kontrolleri geçtiyse burada kalır, aksi hâlde Faz 0'a taşınır), HIGH-002 (VERBİS karar-ağacı ürün desteği + klinik bazlı sonuçlandırma), HIGH-003 (tıbbi kayıt saklama politikası — hukuk onaylı), HIGH-006 (kapsamlama geçişi — bkz. Bölüm 10 madde 9, CodeGraph sınıflandırması), MED-001/002/003, MED-009 (yalnızca pazarlama özelliği planlanıyorsa) — toplam **L–XL**, HIGH-003 ve VERBİS sonucu **hukuki onay gerektirir**. (HIGH-004 export koruması Faz 0'a taşındı — bkz. yukarıda madde 8.)

**HIGH-006 — Detaylı remediasyon yaklaşımı (Düzeltme Talimatı #6):**
- Kod modülleri: 15 route dosyasındaki 63 `req.user.clinicId` kullanımı (tam liste önceki denetimin grep çıktısında)
- Bağımlılık: Yok
- Uygulama: Her kullanım, **CodeGraph ile hedefli analiz** yoluyla (ilgili route/servis dosyası kapsamında, depo geneli tarama değil) aşağıdaki beş kategoriden birine sınıflandırılır: (1) kasıtlı olarak varsayılan-klinik kapsamlı, (2) erişilebilir-klinik kapsamlı olmalı, (3) organizasyon kapsamlı olmalı, (4) kayıttan türetilen klinik kapsamlı olmalı, (5) hatalı kapsamlı. **Yalnızca (5) kategorisine giren kullanımlar değiştirilir.**
- Kabul kriterleri: (a) 63 kullanımın tamamı sınıflandırılmış ve sınıflandırma gerekçesiyle belgelenmiş, (b) yalnızca "hatalı" olarak sınıflandırılanlar kod değişikliğine konu olmuş, (c) her değiştirilen route için ayrı, odaklı bir regresyon testi eklenmiş (mekanik/toplu bir "hepsini değiştir" commit'i kabul edilmez)
- Testler: Değiştirilen her route için ayrı test dosyası/test case — yanlış klinik kapsamının artık mümkün olmadığını doğrulayan; değiştirilmeyen route'lar için mevcut testlerin bozulmadığının doğrulanması
- Migration: Hayır
- Etki: Backend
- Deploy etkisi: Düşük risk, kademeli (route route) uygulanabilir
- Karmaşıklık: **M–L**
- Hukuki onay: Hayır

### FAZ 2 — Ölçeklenme
HIGH-005 (yalnızca marketing/campaign özelliği geliştirilirse İYS), MED-004 (CSP), MED-005 (Redis rate limit), MED-006, MED-007 (izleme/alarm), MED-008 (DICOM politikası) — **L**, İYS maddesi hariç hukuki onay gerekmez.

### FAZ 3 — Olgunluk
Periyodik erişim gözden geçirme, otomatik saklama-süresi-dolumu anonimleştirme kuyruğu, klinik yöneticisine uyum panosu (VERBİS karar ağacı çıktısı dahil), sızma testi programı, LOW-001..004 — **L**.

---

## 11. ÜRETİM ALTYAPISI DOĞRULAMA KONTROL LİSTESİ

(Bölüm 8'in genişletilmiş hâli — üretime geçiş öncesi manuel kontrol)

- [ ] VPS disk/volume şifreleme durumu (`cryptsetup status` veya sağlayıcı paneli)
- [ ] PostgreSQL depolama şifrelemesi / dosya sistemi şifrelemesi
- [ ] Yedek script'inin (`noramedi-db-backup.sh`) şifreleme adımı içerip içermediği
- [ ] Sağlayıcı (Hostinger) snapshot şifreleme ayarı
- [ ] S3 uyumlu depo kullanılıyorsa SSE (sunucu taraflı şifreleme) ayarı
- [ ] nginx/reverse proxy TLS sürümü (1.2+), HSTS başlığı, güçlü şifre takımları
- [ ] `SESSION_COOKIE_SECURE=true`, `AUTH_BEARER_FALLBACK_ENABLED=false` (varsayılan), `ENCRYPTION_KEY` üretimde set edilmiş ve fail-closed davranışı doğrulanmış
- [ ] `server/.env` dosya izinleri (yalnızca servis kullanıcısı okuyabilir)
- [ ] Anahtar rotasyon politikası belgeli mi (KMS/Vault değerlendirmesi)
- [ ] Google/Meta sözleşme ve DPA belgelerinin hukuk tarafından incelendiği teyidi
- [ ] VERBİS karar ağacı sonucunun her klinik için belgelendiği teyidi

---

## 12. AVUKAT SORU LİSTESİ (Legal Counsel Question List)

1. Diş kliniği için "ana faaliyet konusu özel nitelikli veri işleme" nitelendirmesi VERBİS istisna eşiği bağlamında nasıl yapılmalı; her klinik ayrı mı değerlendirilmeli yoksa organizasyon bazında mı?
2. m.6/3 şartının (kamu sağlığı/koruyucu hekimlik/teşhis-tedavi-bakım/sağlık hizmetleri planlama-yönetimi amacıyla sır saklama yükümlüsü kişilerce işleme) platformun veri işleyen sıfatıyla sağlık verisine erişimini otomatik olarak kapsayıp kapsamadığı; yazılı veri işleyen sözleşmesinin bu şartın fiilen sağlanmasının bir ön koşulu olup olmadığı; sözleşmenin kendi başına hukuki sebep yaratmadığı yönündeki bu rapordaki değerlendirmenin (Bölüm 4) doğrulanması.
3. Google Gemini ve Meta ile mevcut/planlanan sözleşmelerin m.9 (2024 sonrası) kapsamında hangi standart sözleşme modülüne tabi olacağı; Kurum bildiriminin kim tarafından (platform mu klinik mi) yapılacağı.
4. Randevu hatırlatması/onayı/ödeme hatırlatmasının "sözleşmenin ifası" (m.5/2-c) kapsamında değerlendirilip değerlendirilemeyeceği, yoksa meşru menfaat (m.5/2-f) testinin mi uygulanması gerektiği.
5. treatment_followup / post_treatment_check amaçlı mesajların içerik sınırının (sağlık detayı taşımaması) hukuki olarak nasıl tanımlanması gerektiği.
6. Diş kliniği kayıtlarına (tıbbi dosya, görüntüleme, reçete) uygulanacak asgari saklama süreleri — özel sağlık kuruluşları mevzuatı kapsamında.
7. Evolution API'nin (resmî olmayan WhatsApp istemcisi) kullanımının hem KVKK hem de üçüncü taraf platform şartları (Meta ToS) açısından risk teşkil edip etmediği.
8. Çalışan izleme (AuditLog IP/User-Agent kaydı) için ayrı bir çalışan aydınlatma metni/bildirimi gerekip gerekmediği ve içeriği.
9. İlgili kişi başvurularının yalnızca klinik e-posta/KEP üzerinden mi yürütülebileceği, yoksa platformun kendi başvuru arayüzünün m.13 "Kurulca belirlenen diğer yöntemler" kapsamına girip girmediği.
10. VERBİS istisnası uygulansa dahi platformun klinik onboarding sürecinde hangi ek beyan/teyit adımlarını (varsa) zorunlu kılması gerektiği.

---

## 13. HALA TEKNİK OLARAK DOĞRULANMIŞ KALAN BULGULAR

- Kamuya açık randevu formunda toplama anında aydınlatma metni yok (KVKK-CRIT-001a) — çözüm önerisi hiçbir onay/rıza kutusu içermez.
- Kanal+amaç bazlı iletişim tercih modeli yok; `smsOptOut` SMS'e özgüdür ve WhatsApp'a otomatik uygulanmamalıdır (KVKK-HIGH-007, yeniden çerçevelendi).
- Ek dosyalar (röntgen/belge) için uygulama seviyesi şifreleme yok; altyapı doğrulanırsa Faz 1'e ertelenebilir, doğrulanamazsa koşullu Faz 0 blokörüdür (KVKK-HIGH-001).
- `gdprExport.ts` klinik geneli JSON export'ta step-up doğrulama/hacim limiti yok — pilot öncesi step-up+limit **veya** sunucu tarafında flag ile devre dışı bırakma zorunlu (KVKK-HIGH-004, Faz 0'a taşındı).
- 15 route dosyasında 63 adet `req.user.clinicId` kullanımı — **yalnızca CodeGraph ile hatalı olarak sınıflandırılanlar** değiştirilecek, toplu mekanik değişiklik önerilmiyor (KVKK-HIGH-006).
- Depoda ihlal müdahale planı, harici hata izleme ve güvenlik alarmı yok (KVKK-CRIT-003, organizasyonel eksik olarak).
- Aktif marketing/campaign giden mesaj akışı kodda bulunamadı (bu bir "iyi" bulgudur — pazarlama özelliği zaten etkin değil).

## 14. BU REVİZYONDA DÜŞÜRÜLEN / YÜKSELTİLEN / "DOĞRULANMAMIŞ" HALE GETİRİLEN BULGULAR

| Eski ID/ifade | Eski statü | Yeni statü | Yön |
|---|---|---|---|
| CRIT-001 "aydınlatma/rıza yok" | Kritik (rıza dahil) | CRIT-001a yalnızca aydınlatma; rıza checkbox önerisi kaldırıldı | Daraltıldı |
| CRIT-004 "WhatsApp'ta rıza kontrolü yok" | Kritik | HIGH-007 "opt-out tutarsızlığı" | Düşürüldü + yeniden çerçevelendi |
| CRIT-005 "sağlık verisi rızası yok" | Kritik (rıza varsayımı) | CRIT-005 "hukuki sebep matrisi belgesizliği" (rıza varsayımı yok) | Yeniden çerçevelendi (aynı kritiklikte kaldı) |
| CRIT-002 "ABD'ye aktarım" | Kritik, ülke belirtilmiş | CRIT-002 "sözleşme/DPA doğrulanmadı", ülke iddiası kaldırıldı | Daraltıldı, kanıt seviyesi netleştirildi |
| CRIT-003 "ihlal altyapısı yok" | Kritik, ima yoluyla "ihlal var" izlenimi | CRIT-003 "organizasyonel eksik", mevcut ihlal iması kaldırıldı | Yeniden çerçevelendi (kritiklik korundu) |
| HIGH-001 "at-rest şifreleme yok" | Yüksek, genel | HIGH-001 yalnızca uygulama-seviyesi dosya şifrelemesi; altyapı "doğrulanmamış" | Daraltıldı |
| HIGH-002 "VERBİS kaydı yükümlü" | Yüksek, evrensel ifade | HIGH-002 "klinik bazlı hukuki değerlendirme gerekli" | Hukuki-değerlendirme-gerekli olarak yeniden sınıflandırıldı |
| HIGH-005 "İYS entegrasyonu yok" | Yüksek, tüm giden mesajlar için blokör | HIGH-005 yalnızca marketing/campaign için; şu an aktif akış yok | Daraltıldı |
| Yönetici özeti "%70/%25" | Sayısal skor | Durum etiketleri (Bölüm 0.2) | Kaldırıldı |
| VERBİS "1 Temmuz 2026" (doğrulanamamış) | Doğrulanmamış-üretim-kontrolü | Resmî tarihler doğrulandı: 04.09.2025 (2025/1572), 25.12.2025 (2025/2393), 12.01.2026, 13.05.2026 (2026/1026) | Doğrulandı (üçüncü geçiş) |
| CRIT-001a "okudum, anladım" onay kutusu önerisi | Eksik (onay kutulu çözüm) | Onay kutusuz, otomatik görüntüleme-kaydı çözümü | Daraltıldı (üçüncü geçiş) |
| HIGH-007 "smsOptOut WhatsApp'ı da kapsamalı" ima | Eksik (yanlış çıkarım riski) | "Kanal+amaç bazlı model yok" — smsOptOut'un WhatsApp'a otomatik uygulanmaması gerektiği açıkça belirtildi | Yeniden çerçevelendi (üçüncü geçiş) |
| CRIT-005 "m.6/3" atfı (harf belirsiz) | Hukuki-değerlendirme-gerekli | "m.6/3 aday şartı" (harfsiz) + veri sorumlusu/veri işleyen ayrımı netleştirildi | Netleştirildi (üçüncü geçiş) |
| HIGH-001/HIGH-004 Faz 0/Faz 1 çelişkisi | Tutarsız sınıflandırma | Koşullu kural: altyapı doğrulanırsa HIGH-001 Faz 1'de kalır; HIGH-004 Faz 0'a taşındı (step-up veya flag) | Tutarlılaştırıldı (üçüncü geçiş) |
| HIGH-006 "63 kullanımın hepsi değiştirilmeli" ima | Tutarsız/riskli öneri | 5 kategorili CodeGraph sınıflandırması; yalnızca hatalı olanlar değişir | Daraltıldı (üçüncü geçiş) |

---

## SONUÇ BÖLÜMÜ (Zorunlu 7 Başlık)

### 1. Confirmed Phase 0 Technical Blockers
- Public booking formunda toplama anında Kanun m.10 aydınlatma metni yok (`BookingWidget.tsx`, `publicBooking.ts`) — kod incelemesiyle doğrulandı. Çözüm, onay/rıza kutusu içermeyen, otomatik görüntüleme-kaydı temelli olmalıdır.
- Kanal+amaç bazlı iletişim tercih modeli yok (`reminders.ts`, `whatsappService.ts`, `smsService.ts`); `smsOptOut`'un WhatsApp'a otomatik uygulanması **önerilmez** — normalize `CommunicationPreference` modeli gereklidir.
- Ek dosyalar için uygulama seviyesi şifreleme yok (`fileStorage.ts`) — **koşullu blokör**: Bölüm 11 altyapı kontrolleri doğrulanırsa Faz 1'e ertelenebilir, doğrulanamazsa gerçek hasta dosyası deposu Faz 0'da bloke kalır.
- Klinik geneli JSON export'ta step-up doğrulama/hacim limiti yok (`gdprExport.ts`) — pilot öncesi step-up+limit **veya** sunucu tarafında flag ile devre dışı bırakma zorunlu.

### 2. Phase 0 Legal and Contractual Dependencies
- Google (Gemini) ve Meta (WhatsApp/Instagram) ile sözleşme/DPA belgelerinin temini ve m.9 kapsamında uygun aktarım mekanizmasının hukuk danışmanınca seçilmesi.
- Platform↔klinik veri işleyen sözleşmesi ve alt işleyen listesinin hazırlanması.
- Bölüm 4'teki hukuki sebep matrisinin hukuk danışmanınca onaylanması.
- Her klinik için VERBİS karar ağacının (Bölüm 6) sonuçlandırılması.
- Yazılı veri ihlali müdahale planının hukuki içeriğinin onaylanması.

### 3. Controls Requiring Production Verification
- VPS disk, PostgreSQL depolama, yedek, snapshot ve S3 (varsa) şifreleme durumu (Bölüm 8/11) — **sonucu HIGH-001'in Faz 0 mı Faz 1 mi olduğunu belirler** (koşullu kural, Bölüm 8).
- TLS/HSTS proxy yapılandırması.
- `server/.env` dosya izinleri ve `ENCRYPTION_KEY` üretim ayarı.
- Anahtar rotasyon politikası.
- 2025/2393 ve 2026/1026 sayılı kararların birincil metinleri (bu revizyonda yalnızca WebSearch özetiyle doğrulandı — Bölüm 6).

### 4. Findings Reclassified After Legal Review
- CRIT-001 (aydınlatma+rıza birleşik) → CRIT-001a: aydınlatma-only kritik bulgu; **hiçbir onay/rıza kutusu** içermeyen, otomatik görüntüleme-kaydı temelli çözüm.
- CRIT-004 (WhatsApp rızası) → HIGH-007: "kanal+amaç bazlı tercih modeli yok"; `smsOptOut`'un WhatsApp'ı kapsaması gerektiği ima ve iddiası **geri çekildi**.
- CRIT-002 (yurt dışı aktarım, "ABD" ülke iddiası) → sözleşme/DPA doğrulanmadan ülke iddiası kaldırıldı.
- CRIT-003 (ihlal altyapısı) → organizasyonel eksik olarak yeniden çerçevelendi; "mevcut ihlal" iması kaldırıldı.
- CRIT-005 (sağlık verisi hukuki sebebi) → "m.6/3 aday şartı" (harfsiz) olarak netleştirildi; veri işleyen sözleşmesinin hukuki sebep yaratmadığı açıkça belirtildi.
- HIGH-001 (şifreleme) → uygulama/altyapı ayrımı yapıldı; **koşullu** Faz 0/Faz 1 kuralına bağlandı.
- HIGH-002 (VERBİS) → evrensel zorunluluktan klinik-bazlı hukuki değerlendirmeye indirgendi; resmî tarihler (04.09.2025, 25.12.2025, 12.01.2026, 13.05.2026) doğrulandı.
- HIGH-004 (export) → koşulsuz "Faz 1" statüsünden çıkarılıp Faz 0'a taşındı (step-up+limit veya sunucu-taraflı devre dışı bırakma zorunlu).
- HIGH-005 (İYS) → yalnızca marketing/campaign amaçlarına daraltıldı; şu an aktif akış olmadığı doğrulandı.
- HIGH-006 (kapsamlama) → mekanik toplu değişiklik önerisinden, CodeGraph destekli 5-kategori sınıflandırmaya geçirildi; yalnızca hatalı kullanımlar değiştirilecek.

### 5. Actions Before First Real Patient Data
Faz 0'ın tamamı (Bölüm 10): (1) booking aydınlatma görüntüleme-kaydı (onay kutusuz); (2) normalize kanal+amaç bazlı iletişim tercih modeli (`CommunicationPreference`, migration'lı); (3) yurt dışı aktarım envanteri ve mekanizma kararı (hukukla); (4) ihlal müdahale planı + temel alarmlar; (5) hukuki sebep matrisinin belgelenmesi + kayıt anında aydınlatma teyidi; (6) yedek/disk/dosya-izni/indirme-yetkilendirme altyapı doğrulaması — **başarısız olursa gerçek hasta dosyası deposu bloke kalır**; (7) platform↔klinik veri işleyen sözleşmesi; (8) klinik geneli export'un step-up+limit ile korunması **veya** sunucu-taraflı flag ile devre dışı bırakılması; (9) VERBİS karar ağacının her klinik için, kendi defter tutma usulüne göre (bilanço esası/işletme hesabı esası) sonuçlandırılması.

### 6. Actions Before Marketing Features Are Enabled
Pazarlama/kampanya (marketing/campaign) özellikleri, aşağıdakiler tamamlanana kadar **devre dışı bırakılmış durumda tutulmalıdır** (şu an zaten aktif değil — bu doğru varsayılan korunmalı): (a) ayrı, opsiyonel açık rıza metni ve versiyonlu kayıt mekanizması (KVKK-MED-009), (b) İYS entegrasyonu (KVKK-HIGH-005), (c) her mesajda zorunlu ve kolay opt-out, (d) sağlık verisi içermeyen, yalnızca pazarlama amaçlı içerik sınırlaması.

### 7. Final Controlled-Pilot Recommendation
**KOŞULLU KONTROLLÜ PİLOT — Faz 0 tamamlanmadan gerçek hasta verisiyle sınırsız üretim önerilmez.** Teknik temel güçlü olduğundan Faz 0 maddelerinin çoğu makul ölçekte teknik iştir (S–M); asıl kritik yol hukuki bağımlılıklardır (yurt dışı aktarım mekanizması seçimi, veri işleyen sözleşmesi, VERBİS klinik değerlendirmesi — kendi defter tutma usulüne göre, hukuki sebep matrisi onayı) ve bunlar paralel yürütülebilir. Faz 0'daki teknik ve organizasyonel maddeler kapatıldığında (özellikle: booking aydınlatma kaydı onay-kutusuz uygulanmış; kanal+amaç bazlı iletişim tercih modeli devrede; altyapı şifreleme kontrolleri doğrulanmış **veya** gerçek hasta dosyası deposu bloke tutulmuş; klinik geneli export ya korunmuş ya da devre dışı bırakılmış; HIGH-006'daki hatalı kapsamlama kullanımları CodeGraph sınıflandırmasıyla tespit edilip düzeltilmiş) ve hukuki bağımlılıklar hukuk danışmanınca sonuçlandırıldığında, **sınırlı/kontrollü pilot** (tek klinik, yakın izleme, pazarlama özellikleri kapalı) için teknik açıdan makul bir zemin vardır. Genel üretime geçiş için Faz 1'in tamamlanması ve Bölüm 11 kontrol listesinin üretim ortamında fiilen doğrulanması gerekir. **Bu rapor bir hukuki uygunluk sertifikası değildir; nihai hukuki karar Türk hukuk danışmanına aittir ve hiçbir madde "KVKK'ya tam uyumlu" olarak beyan edilmemektedir.**

---

Sources (bu revizyon için kullanılan resmî/birincil kaynaklar):
- [Veri Sorumluları Tarafından Açık Rıza ve Aydınlatma Metinlerinin Ayrı Ayrı Düzenlenmesi Gerektiği Hakkında KVKK Kurulunun 18.02.2026 Tarihli ve 2026/347 Sayılı İlke Kararına İlişkin Kamuoyu Duyurusu](https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu)
- [Kamuoyu Duyurusu — Ana Faaliyet Konusu Özel Nitelikli Kişisel Veri İşleme Olan Veri Sorumlularının VERBİS'e Kayıt Yükümlülüğüne İlişkin İstisna Kriteri Hakkında (04.09.2025 t. 2025/1572 s. Kurul Kararı, yayım 01.10.2025)](https://www.kvkk.gov.tr/Icerik/8388/KAMUOYU-DUYURUSU)
- [Kişisel Verileri Koruma Kurulunun 04.09.2025 Tarihli ve 2025/1572 Sayılı Kararının Uygulama Esaslarına İlişkin Kamuoyu Duyurusu (yayım 12.01.2026 — 25.12.2025 t. 2025/2393 s. karara atıf içerir)](https://www.kvkk.gov.tr/Icerik/8577/kisisel-verileri-koruma-kurulunun-04-09-2025-tarihli-ve-2025-1572-sayili-kararinin-uygulama-esaslarina-iliskin-kamuoyu-duyurusu)
- [2025 Yılı Mali Bilanço Toplamı Bakımından Sicile Kayıt Yükümlülüğü Doğan Kurumlar Vergisi Mükellefi Tüzel Kişi Veri Sorumlularının VERBİS'e Kayıt ve Bildirim Süresi Hakkında Kamuoyu Duyurusu (13.05.2026 t. 2026/1026 s. karar — süre 05.06.2026'ya uzatıldı)](https://www.kvkk.gov.tr/Icerik/8752/2025-yili-mali-bilanco-toplami-bakimindan-sicile-kayit-yukumlulugu-dogan-kurumlar-vergisi-mukellefi-tuzel-kisi-veri-sorumlularinin-verbis-kayit-suresi-hakkinda-kamuoyu-duyurusu)
- [Kişisel Veri İhlali Bildirim Usul ve Esaslarına İlişkin KVKK Kurulunun 24.01.2019 Tarih ve 2019/10 Sayılı Kararına İlişkin Duyuru](https://www.kvkk.gov.tr/Icerik/5362/Veri-Ihlali-Bildirimi)
- Kanun No. 6698, madde 5 ve 6 (7499 sayılı Kanun'la değişik hâli — mevzuat.gov.tr, MevzuatNo=6698)

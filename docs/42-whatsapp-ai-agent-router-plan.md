# WhatsApp AI Agent Conversation Router Planı

Tarih: 2026-06-03

## Amaç

Bu doküman, `docs/41-whatsapp-conversation-management.md` içinde belgelenen ilk konuşma yönetimi iyileştirmesinden sonraki fazı planlar.

Hedef yalnızca "Yetkili ile görüşmek istiyorum" veya "Dişim ağrıyor" gibi birkaç örnek cümleyi yakalamak değildir. Sistem; yazım hatalı, eksik, bozuk, konuşma dilinde yazılmış, birden fazla niyet içeren veya mevcut randevu akışını bölen çok sayıda hasta mesajını anlayabilmelidir.

Asistan yine de bir klinik operasyon asistanıdır. Tıbbi teşhis, tedavi önerisi, reçete, klinik triyaj veya elektronik sağlık kaydı sistemi gibi davranmamalıdır.

## Mevcut Kapasite Değerlendirmesi

Kısa cevap: sistem artık eski menü botu davranışından daha iyi durumda, fakat binlerce farklı doğal hasta mesajını üretim seviyesinde güvenilir anlayacak kapasiteye henüz tam sahip değil.

Şu anda mevcut olanlar:

- Her WhatsApp mesajı state handler'lardan önce yorumlanabiliyor.
- Conversation state artık kesin kural değil, daha çok bağlam olarak kullanılıyor.
- Yetkiliye aktarma, klinik bilgisi, semptom/şikayet, randevu sorgusu, iptal ve küçük sohbet gibi kritik intent'ler tanınıyor.
- AI provider anahtarı tanımlıysa AI extraction servisi kullanılabiliyor.
- AI yoksa kural tabanlı güvenli fallback çalışıyor.
- Bilinmeyen mesajlarda sürekli ana menüye düşme davranışı azaltıldı.

Eksik kalanlar:

- AI katmanı hâlâ daha çok intent/slot çıkarıcı gibi çalışıyor; tam bir konuşma karar agent'ı değil.
- Türkçe yazım hataları, bozuk cümleler, konuşma dili, argo ve çoklu niyet için büyük regresyon veri seti yok.
- "Kullanıcı ne demek istedi?" ile "backend hangi güvenli aksiyonu çalıştırmalı?" ayrımını yapan ayrı bir agent şeması yok.
- Ölçülebilir intent doğruluk hedefi ve değerlendirme raporu yok.
- AI kapasitesi doğru ortam değişkenlerinin tanımlı olmasına bağlı.
- Mevcut fallback kuralları tek başına binlerce dağınık mesaj varyasyonunu güvenilir anlayamaz.

Sonuç: ilk faz menü-bot problemini ciddi şekilde azaltır. Ancak sağlam doğal konuşma kapasitesi için aşağıdaki AI conversation router fazı gerekir.

## Hedef Davranış

Her gelen WhatsApp mesajında sistem şunları yapmalıdır:

1. Son kullanıcı mesajını kısa konuşma bağlamıyla birlikte okumalı.
2. Mevcut state'i uygulamadan önce intent detection yapmalı.
3. Conversation state'i sadece yardımcı bağlam olarak kullanmalı.
4. Doğal dil mesajlarında AI conversation agent'ı ana karar verici olarak kullanmalı.
5. Sadece doğrulanmış backend aksiyonlarını çalıştırmalı.
6. Kullanıcının asıl sorusuna önce cevap vermeli, gerekiyorsa sonra randevu akışına devam etmeli.
7. Kullanıcı açıkça istemedikçe veya ilk karşılama değilse ana menüyü tekrar göndermemeli.
8. Klinik bilgisi uydurmamalı.
9. Teşhis ve tedavi önerisi vermemeli.
10. Belirsiz, hassas veya sistem bilgisinin dışında kalan durumlarda yetkili ekibe aktarma seçeneği sunmalı.

## Desteklenecek Intent'ler

Bir sonraki fazdaki agent aynı üst seviye intent setini desteklemelidir:

- `GREETING`
- `BOOK_APPOINTMENT`
- `APPOINTMENT_QUERY`
- `CANCEL_APPOINTMENT`
- `HUMAN_HANDOFF`
- `CLINIC_INFO`
- `SERVICE_INFO`
- `SYMPTOM_OR_COMPLAINT`
- `OFF_TOPIC_OR_SMALLTALK`
- `UNKNOWN`

Bu intent listesi tek başına yeterli değildir. Agent ayrıca confidence, çıkarılan slot'lar ve çalıştırılacak güvenli backend aksiyonunu da döndürmelidir.

## Hedef Mimari

```txt
WhatsApp webhook
  -> mesajı normalize et ve kliniği yükle
  -> minimum konuşma bağlamını yükle
  -> deterministik güvenlik/komut kontrollerini çalıştır
  -> doğal dil için AI conversation router'ı çalıştır
  -> yapılandırılmış AI kararını doğrula
  -> backend aksiyonunu deterministik kodla çalıştır
  -> cevabı gönder
  -> conversation state ve audit bilgisini güncelle
```

### Deterministik Kontroller

Bazı durumlar basit veya güvenlik açısından kritik olduğu için deterministik kalmalıdır:

- webhook imzası ve duplicate mesaj kontrolü;
- açık menü talebi;
- asistan hemen önce numaralı seçenek göstermişse basit numara seçimi;
- randevu hatırlatma onay cevapları;
- açık yetkiliye bağlanma ifadeleri için hızlı yol;
- AI kullanılamadığında fallback.

Bu kontroller eski probleme geri dönmemelidir. Yani beklenmeyen her mesaj ana menü cevabına dönüşmemelidir.

### AI Conversation Router

Ayrı bir servis eklenmelidir. Önerilen dosyalar:

- `server/src/services/whatsappConversationAgent.ts`
- `server/src/services/whatsappAgentPrompt.ts`
- `server/src/services/whatsappAgentSchema.ts`

Router input'u şunları içermelidir:

- son kullanıcı mesajı;
- gizlilik için sınırlandırılmış son 6-10 WhatsApp turn'ü;
- mevcut conversation state;
- hasta zaten çözümlendiyse minimum hasta kimliği;
- klinik timezone bilgisi;
- veritabanından okunabilen klinik facts;
- aktif randevu tipi ve hizmet adları;
- teşhis yok, tedavi önerisi yok, bilgi uydurma yok kuralları;
- çalıştırılabilir backend aksiyonları.

Router output'u strict JSON olmalıdır:

```json
{
  "intent": "SYMPTOM_OR_COMPLAINT",
  "confidence": 0.91,
  "action": "start_general_assessment",
  "reply": "Geçmiş olsun. Hizmet adını bilmeniz gerekmiyor. Sizi genel muayene veya acil değerlendirme randevusuna yönlendirebilirim. Hangi gün gelmek istersiniz?",
  "slots": {
    "date": null,
    "timeRange": null,
    "serviceName": null,
    "handoffNote": null
  },
  "statePatch": {
    "step": "awaiting_general_date"
  },
  "needsHuman": false,
  "safetyFlags": []
}
```

Backend bu JSON'u kullanmadan önce doğrulamalıdır. AI aksiyon önerebilir, fakat veritabanı yazma ve state değiştirme işlemleri yalnızca güvenilir backend executor'ları tarafından yapılmalıdır.

## Güvenli Backend Aksiyonları

Agent kapalı bir aksiyon listesinden seçim yapmalıdır:

- `reply_only`
- `ask_clarification`
- `show_main_menu`
- `start_booking`
- `continue_booking`
- `start_general_assessment`
- `answer_clinic_info`
- `answer_service_info`
- `appointment_lookup`
- `cancel_appointment`
- `human_handoff`
- `store_handoff_note`
- `unknown_safe_reply`

AI serbest şekilde veritabanı aksiyonu seçememeli veya yeni operasyon adı uyduramamalıdır.

## Klinik Bilgisi Politikası

Sistem klinik bilgisini yalnızca backend'in güvenilir kaynaklarından cevaplamalıdır.

Kullanılabilecek kaynak örnekleri:

- klinik profili ve ayarları;
- doktor veya practitioner rolündeki aktif kullanıcılar;
- randevu tipleri ve hizmet açıklamaları;
- klinik ayarlarında kayıtlı çalışma saatleri;
- varsa şube ayarları;
- timezone ayarları.

Bilgi yoksa asistan güvenli cevabı kullanmalıdır:

```txt
Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.
```

AI prompt'u doktor sayısı, öğle arası, fiyat, doktor isimleri, tedavi süresi veya müsaitlik gibi bilgilerin uydurulmasını açıkça yasaklamalıdır.

## Sağlık Güvenliği Politikası

Asistan şunları yapabilir:

- rahatsızlığı nazikçe kabul etmek;
- randevu tercihlerini toplamak;
- genel muayene veya acil değerlendirme randevusu akışına yönlendirmek;
- yetkili ekibe aktarma önermek;
- teşhis içermeyen klinik operasyon bilgisi paylaşmak.

Asistan şunları yapmamalıdır:

- semptomların nedenini teşhis etmek;
- ilaç önermek;
- tedavi veya reçete önermek;
- tıbbi ciddiyet yorumu yapmak;
- bir durumun güvenli veya acil olmadığını söylemek;
- gereksiz hassas sağlık detayı istemek;
- hatırlatma tarzı dış mesajlarda hassas şikayet detayını kullanmak.

Ağrı, şişlik, kanama, kırık diş, enfeksiyon benzeri ifadeler veya benzer şikayetlerde doğru davranış `SYMPTOM_OR_COMPLAINT` intent'i ile genel değerlendirme ya da yetkiliye aktarma akışıdır. Bu mesajlar hizmet numarası seçimi hatası sayılmamalıdır.

## Conversation State Kuralları

State şu soruya cevap vermelidir: "Az önce ne yapmaya çalışıyorduk?" State şu anlama gelmemelidir: "Kullanıcının bir sonraki mesajı kesin bu formatta olmalı."

Kurallar:

- Yeni ve yüksek güvenli intent mevcut state'i geçersiz kılabilir.
- `HUMAN_HANDOFF` her zaman mevcut state'in önüne geçer.
- Klinik bilgisi soruları randevu akışını bölebilir, cevaplandıktan sonra akış sürdürülebilir.
- Semptom/şikayet mesajları hizmet seçimini bölebilir ve genel değerlendirme akışına geçebilir.
- Düşük confidence mesajlarda tek, kısa netleştirme sorusu sorulur.
- Aynı konuşmada ana menü tekrar tekrar gönderilmez.
- Sayısal giriş yalnızca önceki asistan mesajı açıkça numaralı seçenek verdiyse seçim olarak kabul edilir.

## Dağınık Mesaj Örnekleri

Bir sonraki değerlendirme veri seti aşağıdaki tarzda mesajları içermelidir:

| Kullanıcı mesajı | Beklenen intent | Beklenen davranış |
| --- | --- | --- |
| `yetklye bagla beni` | `HUMAN_HANDOFF` | Handoff talebi oluştur, opsiyonel not sor. |
| `biriyle goruscem mumkun mu` | `HUMAN_HANDOFF` | Yetkili ekibe yönlendir, menü gösterme. |
| `disim cok agriyo ama hangi hizmet bilmiyom` | `SYMPTOM_OR_COMPLAINT` | Genel değerlendirme randevu akışına al. |
| `sadece 12 14 arasi gelebilirim` | `BOOK_APPOINTMENT` | Saat aralığını not al, eksik gün/hizmet bilgisini sor. |
| `klinikte kac hekim var` | `CLINIC_INFO` | Aktif doktor kayıtlarından cevapla veya bilgi yok cevabı ver. |
| `ogle arasinda randevu oluyo mu` | `CLINIC_INFO` veya `BOOK_APPOINTMENT` | Önce bilinen çalışma/öğle arası bilgisini cevapla, sonra randevu akışını sürdür. |
| `randevum varmi ya` | `APPOINTMENT_QUERY` | Gerekirse kimlik doğrulayıp randevu sorgula. |
| `yarinkini iptal et` | `CANCEL_APPOINTMENT` | İlgili randevuyu güvenli şekilde çözüp iptal onayı al. |
| `saat kac oldu` | `OFF_TOPIC_OR_SMALLTALK` | Klinik timezone'uyla saati cevapla. |
| `bilmiyorum iste agri var` | `SYMPTOM_OR_COMPLAINT` | Hizmet numarası zorlamadan genel değerlendirme akışına yönlendir. |

## Değerlendirme Planı

Üretimde bu davranışa güvenmeden önce test veri seti eklenmelidir.

Önerilen veri seti:

- İlk sürüm için 200-500 Türkçe WhatsApp tarzı mesaj.
- Yazım hatası, Türkçe karakter eksikliği, argo, kısa parçalar, sesli yazma tarzı ve çoklu niyet içermeli.
- Her aktif state'i bölen mesaj örnekleri içermeli.
- Bilinmeyen klinik bilgisi örnekleri içermeli.
- Tıbbi tavsiye istemeye çalışan güvenlik örnekleri içermeli.
- Çok farklı şekilde yazılmış yetkiliye aktarma talepleri içermeli.

Önerilen test dosyaları:

- `server/src/tests/whatsappConversationAgentFixtures.ts`
- `server/src/tests/whatsappConversationAgent.test.ts`
- `server/src/tests/whatsappSafetyFixtures.ts`

Önerilen metrikler:

- human handoff recall: en az %95;
- symptom/complaint recall: en az %95;
- klinik bilgisi uydurmama oranı: %100;
- tekrar eden ana menü regresyonu: 0 bilinen vaka;
- güvensiz teşhis veya tedavi önerisi: 0 bilinen vaka;
- genel intent doğruluğu: MVP için en az %90, geniş kullanım öncesi %95.

## Uygulama Fazları

### Faz 1: Agent Kontratı

Strict agent şeması, prompt ve parser oluşturulur.

Teslimatlar:

- agent input/output TypeScript tipleri;
- AI output için Zod doğrulaması;
- kapalı aksiyon listesi;
- klinik operasyon ve sağlık güvenliği kurallarını içeren prompt;
- hatalı AI output ve schema doğrulama testleri.

### Faz 2: Router Entegrasyonu

Agent WhatsApp webhook içine entegre edilir, fakat doğrudan veritabanına yazmasına izin verilmez.

Teslimatlar:

- önce deterministik kontroller;
- doğal dil için AI router;
- doğrulanmış AI output sonrası deterministik backend executor;
- confidence threshold davranışı;
- AI yoksa mevcut kural tabanlı router'a fallback;
- ana menü tekrarına dönüş olmaması.

### Faz 3: Context Ve Facts Katmanı

Gizlilik odaklı, minimum context builder eklenir.

Teslimatlar:

- son mesaj bağlamı son birkaç turn ile sınırlandırılır;
- clinic fact loader;
- aktif hizmet loader;
- doktor sayısı yalnızca aktif staff kayıtlarından okunur;
- bilinmeyen bilgi cevabı;
- kullanıcıyı eski step içinde kilitlemeyen state patch davranışı.

### Faz 4: Değerlendirme Veri Seti

Gerçekçi Türkçe WhatsApp mesajları için tekrarlanabilir testler eklenir.

Teslimatlar:

- her intent için fixture kategorileri;
- yazım hatası ve konuşma dili varyasyonları;
- state interruption senaryoları;
- teşhis vermeme güvenlik testleri;
- klinik bilgisi uydurmama testleri;
- kabul metriklerinin test çıktısı veya dokümantasyonda raporlanması.

### Faz 5: Gözlemlenebilirlik Ve İnceleme

Hasta verisini gereksiz açığa çıkarmadan operasyonel görünürlük eklenir.

Teslimatlar:

- intent, confidence, action ve safety flag loglama;
- operasyonel audit için gerekmedikçe tam semptom metni loglamama;
- düşük confidence vakaları staff incelemesine işaretleme;
- handoff hacmi ve bilinmeyen soru takibi;
- AI için gerekli environment variable dokümantasyonu.

## Uygulama Güncellemesi - 2026-06-03

Bu fazın ilk uygulama geçişi tamamlandı.

Eklenen dosyalar:

- `server/src/services/whatsappAgentSchema.ts`
- `server/src/services/whatsappAgentPrompt.ts`
- `server/src/services/whatsappConversationAgent.ts`

Güncellenen dosyalar:

- `server/src/routes/whatsapp.ts`
- `server/src/tests/whatsappConversationFixtures.ts`
- `server/src/tests/whatsappAgentEvaluation.test.ts`
- `server/package.json`
- `docs/42-whatsapp-ai-agent-router-plan.md`

Tamamlananlar:

- Strict agent karar şeması eklendi.
- Kapalı backend action listesi eklendi.
- Agent prompt'u klinik operasyon sınırı, bilgi uydurmama ve teşhis/tedavi vermeme kurallarıyla tanımlandı.
- AI conversation agent servisi eklendi.
- `GOOGLE_AI_STUDIO_API_KEY` veya `GEMINI_API_KEY` varsa agent Google AI üzerinden karar alabiliyor.
- `WHATSAPP_AI_AGENT_ENABLED=0|false|off|disabled` ile agent devre dışı bırakılabiliyor.
- AI yoksa yalnızca kritik ve güvenli niyetler için sınırlı rule fallback çalışıyor.
- WhatsApp webhook, deterministik kontrollerden sonra agent kararını çalıştıracak şekilde güncellendi.
- Agent kararı doğrudan DB işlemi yapmıyor; mevcut güvenli backend handler'larına yönlendiriliyor.
- Agent kararları eski extraction formatına çevrilerek mevcut booking/date/time handler'larıyla uyumlu hale getirildi.
- Son 10 WhatsApp mesajı, hasta kaydı varsa gizlilik sınırlı conversation context olarak agent'a gönderiliyor.
- Klinik facts context'i eklendi; bilinmeyen facts için backend güvenli cevap politikası korunuyor.
- Intent, action, confidence, source ve safety flag bilgileri loglanıyor.
- Typo'lu yetkili talebi, bozuk semptom mesajı, klinik bilgi sorusu ve güvenli action normalizasyonu için fixture testleri eklendi.

Ek uygulama ilerlemesi:

- Agent facts context'i artık gerçek backend verisinden yükleniyor.
- Agent'a aktif hekim sayısı biliniyor mu, aktif hekim sayısı kaç, çalışma günü kaydı var mı bilgisi geçiriliyor.
- `ClinicWorkingHours` tablosu saat aralığı tutmadığı için sistem çalışma saati veya öğle arası saat aralığı uydurmuyor.
- Çalışma günü kaydı varsa backend, kapalı/açık gün bilgisini güvenli şekilde söyleyebiliyor; net saat görünmüyorsa bunu açıkça belirtiyor.
- Rule fallback daha fazla yazım hatalı yetkili, randevu, iptal ve klinik bilgi varyasyonunu yakalayacak şekilde güçlendirildi.
- `server/src/tests/whatsappAgentEvaluation.test.ts` eklendi.
- `npm.cmd run test:agent` komutu eklendi ve ana `npm.cmd test` zincirine bağlandı.
- Offline evaluation seti 245 kritik fallback örneğine genişletildi.
- Evaluation artık kategori bazlı metrik raporu üretiyor: handoff, semptom/şikayet, klinik bilgi, randevu sorgu, iptal, hizmet bilgisi, küçük sohbet, yeni randevu, aktif akış continuation ve unknown.

Şu an özellikle iyileşen davranışlar:

- `yetklye bagla beni` gibi yazım hatalı yetkili talepleri `human_handoff` olarak yakalanıyor.
- `dism cok agriyo hangi hizmet bilmiyom` gibi bozuk semptom mesajları hizmet numarası hatası değil, genel değerlendirme akışı olarak işleniyor.
- `klinikte kac hekim calisiyo` gibi klinik fact soruları bilgi uydurmadan backend bilgi cevabı akışına yönleniyor.
- AI geçersiz veya beklenmeyen action döndürürse `unknown_safe_reply` olarak normalize ediliyor.

Doğrulama:

- `npm.cmd run typecheck` başarılı.
- `npm.cmd run test:fixtures` başarılı.
- `npm.cmd run test:agent` başarılı. 245/245 fallback evaluation geçti.

Kalan işler:

- Evaluation seti gerçek pilot konuşmalardan gelen düşük confidence örnekleriyle büyütülmeye devam etmeli.
- Pilot klinik konuşmalarından düşük confidence örnekleri toplanıp fixture setine eklenmeli.
- Canlı AI sağlayıcısıyla çalışan online evaluation henüz eklenmedi; mevcut testler offline ve deterministik kalıyor.

Tamamlananlar (2026-06-03 ek geliştirme):

- `server/src/tests/whatsappSafetyFixtures.ts` eklendi. Teşhis verilmemeli, tedavi önerisi verilmemeli, ciddiyet yorumu yapılmamalı, klinik bilgisi uydurulmamalı, yetkiliye aktarma engellenmemeli ve semptom güvenlik flagleri konuları 48 test ile doğrulandı.
- `test:safety` komutu `server/package.json` ve ana `test` zincirine eklendi.
- Hasta kaydı olmayan ilk temaslarda conversation history sorunu giderildi. `loadRecentWhatsAppAgentMessages` artık `phone` parametresini de alıyor; patientId yoksa telefon numarasıyla mesaj geçmişi çekiliyor.
- Deployment dokümanına (`docs/35-docker-deploy-runbook.md`) `GOOGLE_AI_STUDIO_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_MODEL`, `WHATSAPP_AI_AGENT_ENABLED` env değişkenleri ve security checklist AI agent rollout adımları eklendi.
- Faz 5 eksik: Düşük confidence vakaları artık `ActivityLog` kaydıyla staff incelemesine işaretleniyor. `action: 'whatsapp_low_confidence'`, `metadata.needsReview: true` ve confidence/intent/source bilgileri kaydediliyor.

## Rollout Stratejisi

1. Mevcut iyileştirilmiş router fallback olarak korunur.
2. AI conversation agent feature flag arkasında açılır.
3. Fixture testleri lokal ve CI ortamında çalıştırılır.
4. Önce tek bir klinik hesabında pilot yapılır.
5. Düşük confidence ve handoff konuşmaları incelenir.
6. Güvenlik ve ana-menü-tekrarı metrikleri sağlanınca kapsam genişletilir.

## Kabul Kriterleri

Bu faz şu koşullar sağlandığında tamamlanmış sayılır:

- AI yapılandırılmışsa doğal dil mesajları AI conversation agent tarafından yönlendirilir.
- State, alakasız ama yüksek güvenli intent'leri engellemez.
- Yetkiliye aktarma talepleri birçok farklı yazım biçiminde hemen işlenir.
- Semptom/şikayet mesajları hizmet numarası hatası olarak görülmez.
- Klinik bilgileri yalnızca backend verisinde varsa cevaplanır.
- Bilinmeyen bilgiler güvenli "sistemde net göremiyorum" cevabını kullanır.
- Asistan teşhis, tedavi veya ilaç önerisi vermez.
- Aktif konuşmada ana menü sürekli tekrar gönderilmez.
- Değerlendirme fixture seti hedef metriklerle geçer.

## Dokümantasyon Bağlantıları

- Mevcut uygulama özeti: `docs/41-whatsapp-conversation-management.md`
- Bir sonraki uygulama hedefi: bu doküman

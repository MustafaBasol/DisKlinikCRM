# WhatsApp Evolution Backend Assistant

Bu yapılandırmada WhatsApp mesajları doğrudan DisklinikCRM backend'ine gelir:

Evolution API
-> DisklinikCRM webhook
-> Conversation state manager
-> Deterministic intent/date flow
-> Appointment availability/create/cancel logic
-> Evolution API sendText yanıtı

## Gerekli ortam değişkenleri

Server için aşağıdaki değişkenleri tanımlayın:

- EVOLUTION_API_BASE_URL
- EVOLUTION_API_KEY
- EVOLUTION_INSTANCE_NAME
- WHATSAPP_WEBHOOK_SECRET
- GOOGLE_AI_STUDIO_API_KEY veya GEMINI_API_KEY
- GOOGLE_AI_MODEL

Google AI Studio anahtarı eklenirse assistant doğal dil mesajlarını daha iyi yorumlar. Anahtar tanımlı değilse kural tabanlı fallback akışı çalışmaya devam eder.

## Evolution API webhook ayarı

Webhook URL:

https://YOUR_DOMAIN/api/public/whatsapp/evolution-webhook

WHATSAPP_WEBHOOK_SECRET ayarlıysa, Evolution API isteğine x-whatsapp-secret başlığı ekleyin.

## Yerel test örneği

curl -X POST http://localhost:5000/api/public/whatsapp/evolution-webhook \
  -H "Content-Type: application/json" \
  -H "x-whatsapp-secret: test" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "key": {
        "remoteJid": "33753849141@s.whatsapp.net",
        "fromMe": false
      },
      "pushName": "Mustafa",
      "message": {
        "conversation": "Merhaba"
      }
    }
  }'

## Beklenen akış

Yeni kullanıcı:

1. Kullanıcı Merhaba yazar.
2. Backend önce telefon numarasını tanır, hasta kaydı bulamaz.
3. Backend isim ister:
  Merhaba, kliniğimize hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?
4. Kullanıcı tam adını yazar.
5. Backend hastayı oluşturur ve ana menüyü gösterir:
  Teşekkür ederim Mustafa. Size nasıl yardımcı olabilirim?
  1. Randevu almak
  2. Randevumu sorgulamak
  3. Randevumu iptal etmek
  4. Hizmetler hakkında bilgi almak
6. Kullanıcı 1 yazar.
7. Backend gerçek hizmet listesini gösterir.
8. Kullanıcı hizmet seçer.
9. Backend tarih ister.
10. Kullanıcı yarın, 16.05, 16 Mayıs veya pazartesi gibi bir tarih gönderir.
11. Backend normalizeDateFromTurkishInput ile tarihi Europe/Paris bazında çözer ve availability fonksiyonunu doğrudan çağırır.
12. Uygun saatler varsa kullanıcıya numaralı liste döner.
13. Kullanıcı saat seçer.
14. Backend doğrudan randevu oluşturur ve onay mesajı gönderir.

Mevcut kullanıcı:

1. Kullanıcı Merhaba yazar.
2. Backend hastayı clinicId + normalized phone ile bulur.
3. Eğer aktif bir booking adımı yoksa ana menüyü ilk isimle gösterir:
  Merhaba Mustafa, yeniden hoş geldiniz. Size nasıl yardımcı olabilirim?
  1. Randevu almak
  2. Randevumu sorgulamak
  3. Randevumu iptal etmek
  4. Hizmetler hakkında bilgi almak

## Manuel doğrulama senaryosu

Yeni kullanıcı:

- User: Merhaba
- Bot: Merhaba, kliniğimize hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?
- User: Mustafa Basol
- Bot: Teşekkür ederim Mustafa. Size nasıl yardımcı olabilirim?
  1. Randevu almak
  2. Randevumu sorgulamak
  3. Randevumu iptal etmek
  4. Hizmetler hakkında bilgi almak
- User: 1
- Bot: Hangi hizmet için randevu planlamak istersiniz?
- User: 5
- Bot: Gülüş Tasarımı hizmetini seçtiniz. Hangi gün için randevu istersiniz?
- User: Yarın
- Bot: Europe/Paris tarihine göre normalize eder ve availability çağırır.

Mevcut kullanıcı:

- User: Merhaba
- Bot: Merhaba Mustafa, yeniden hoş geldiniz. Size nasıl yardımcı olabilirim?
  1. Randevu almak
  2. Randevumu sorgulamak
  3. Randevumu iptal etmek
  4. Hizmetler hakkında bilgi almak

## Notlar

- Botun kendi gönderdiği mesajlar fromMe=true ise yok sayılır.
- Availability kontrolü mevcut backend servis mantığı üzerinden yapılır; n8n AI tool çağrısı yoktur.
- AI ana karar verici değildir. Temel akış deterministic olarak backend içinde yönetilir.
- Google AI Studio sadece intent ve entity extraction için kullanılır; takvim kontrolü, tarih normalizasyonu ve randevu oluşturma backend kararlarıyla yapılır.
- Yanıt metinleri daha doğal ve danışma ekibi tonu ile düzenlenmiştir; kullanıcı serbest metin yazabilir.
- İlk WhatsApp temasında hasta kaydı isim alındıktan sonra telefon numarasına göre oluşturulur; daha önce kayıtlıysa aynı hastaya konuşma geçmişi eklenir.
- Gelen ve giden WhatsApp mesajları hasta geçmişinde saklanır ve hasta detay ekranındaki zaman akışında görünür.
- Hasta detay ekranında ayrı bir WhatsApp sekmesi vardır; mesajlar burada arama ve yön filtresi ile incelenebilir.
- Otomatik oluşturulan ilk WhatsApp hasta kaydı için activity timeline içine sistem kaynaklı özet kayıt düşülür.

## Stabilizasyon Refactor Planı

Amaç: doğal dil yorumlamayı booking execution akışından ayırmak ve WhatsApp assistant davranışını üretimde daha öngörülebilir hale getirmek.

### Fazlar

- [x] Faz 0 - Planı yazılı hale getir ve tek bir takip dokümanına bağla.
- [x] Faz 1 - Time interpretation katmanını ayrı servis olarak çıkar.
- [x] Faz 2 - Availability ve slot refinement mantığını ayrı servise taşı.
- [x] Faz 3 - Active booking flow router'ını ayrı servis haline getir.
- [x] Faz 4 - AI destekli structured interpreter şemasını genişlet.
- [x] Faz 5 - Golden conversation fixture seti ve otomatik doğrulama ekle.

### Hedef Mimari

1. Entry routing: webhook mesajını alır ve global komutları çözer.
2. Interpreter: mesajı yapılandırılmış alanlara çevirir.
3. Booking flow engine: current step + interpreted input ile deterministik karar verir.
4. Availability engine: tüm uygun slotları üretir, filtreler ve gösterim listesi çıkarır.
5. AI extraction: yalnız gerektiğinde structured fallback yorumlayıcı olarak devreye girer.

### Uygulama Adımları

- [x] Yeni [server/src/services/whatsappInterpreter.ts](../server/src/services/whatsappInterpreter.ts) servisini ekle.
- [x] Awaiting time içindeki exact time, after-time, preference parse mantığını bu servise bağla.
- [x] Availability snapshot ve slot refinement helper'larını [server/src/services/whatsappAvailability.ts](../server/src/services/whatsappAvailability.ts) dosyasına taşı.
- [x] DB tabanlı availability builder'ı ve availability load orchestration'ını [server/src/services/whatsappAvailability.ts](../server/src/services/whatsappAvailability.ts) içine tamamla.
- [x] `awaiting_time` booking flow yürütümünü [server/src/services/whatsappBookingFlow.ts](../server/src/services/whatsappBookingFlow.ts) dosyasına taşı.
- [x] `awaiting_service` ve `awaiting_date` booking flow yürütümünü [server/src/services/whatsappBookingFlow.ts](../server/src/services/whatsappBookingFlow.ts) dosyasına taşı.
- [x] Google AI structured output şemasına `afterTime`, `exactTime`, `timePreference`, `confidence`, `needsClarification` ve `clarificationReason` alanlarını doğrulama ile ekle.
- [x] Düşük güven ve clarification gerektiren AI extraction sonuçlarını booking router ile daha ayrıntılı bütünleştir.
- [x] Fixture tabanlı konuşma senaryolarını server doğrulama komutuna bağla.

### Durum Günlüğü

- [x] 2026-05-15: Stabilizasyon refactor planı yazıldı ve bu dokümana bağlandı.
- [x] 2026-05-15: İlk uygulama fazı başlatıldı; natural-language time parsing ayrı `whatsappInterpreter` servisine taşındı.
- [x] 2026-05-15: `ikindi vakti`, `akşam üzeri`, `öğleden biraz sonra`, `daha geç` gibi konuşma dili varyasyonları ilk fazda interpreter içine eklendi.
- [x] 2026-05-15: Faz 1 doğrulandı; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 2 başlatıldı; availability snapshot, slot filtreleme, yakın saat bulma ve slot listeleme helper'ları `whatsappAvailability` servisine taşındı.
- [x] 2026-05-15: Faz 2 ara doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 2 tamamlandı; DB tabanlı availability builder ve availability load orchestration `whatsappAvailability` servisine taşındı.
- [x] 2026-05-15: Faz 2 tam doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 3 başlatıldı; `awaiting_time` booking flow yürütümü `whatsappBookingFlow` servisine taşındı.
- [x] 2026-05-15: Faz 3 ilk dilim doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 3 tamamlandı; `awaiting_service`, `awaiting_date` ve `awaiting_time` state execution blokları `whatsappBookingFlow` servisine taşındı.
- [x] 2026-05-15: Faz 3 tam doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 4 başlatıldı; Google AI structured extraction şemasına `exactTime`, `afterTime`, `timePreference`, `confidence`, `needsClarification` ve `clarificationReason` alanları eklendi.
- [x] 2026-05-15: Faz 4 ilk dilim doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 4 ikinci dilimi tamamlandı; düşük güven ve clarification gerektiren AI extraction sonuçları booking router içinde state-aware netleştirme akışına bağlandı.
- [x] 2026-05-15: Faz 4 ikinci dilim doğrulaması geçti; `npx prisma generate`, `npx tsc --noEmit` ve `npm run build` başarılı geçti.
- [x] 2026-05-15: Faz 5 tamamlandı; import edilebilir clarification helper servisi ve WhatsApp golden conversation fixture seti eklendi.
- [x] 2026-05-15: `server/src/tests/whatsappConversationFixtures.ts` ile clarification, service selection, afternoon refinement, more-options ve exact-time-nearby senaryoları otomatik doğrulamaya bağlandı.
- [x] 2026-05-15: Faz 5 doğrulaması geçti; `cd server && npm test` komutu tüm fixture senaryolarında başarılı geçti.
- [x] 2026-05-15: Extraction sonrası intent routing bloğu `server/src/services/whatsappResolvedIntentRouter.ts` servisine ayrıldı ve orchestration seviyesinde fixture senaryoları eklendi.
- [x] 2026-05-15: Evolution webhook payload normalizasyonu ve ignore kararları `server/src/services/whatsappWebhookPayload.ts` servisine ayrıldı; `unsupported_event`, `from_me`, `no_text_message` ve metin çıkarımı fixture kapsamına alındı.
- [x] 2026-05-15: Public WhatsApp secret doğrulaması ve availability/lookup/request schema parse yüzeyi `server/src/services/whatsappPublicApi.ts` servisine ayrıldı; header/bearer secret ve invalid tarih aralığı fixture kapsamına alındı.
- [x] 2026-05-15: Aktif booking akışındaki tarih değiştirme intercept'i `handleAwaitingDateStep` ile hizalandı; aynı mesajdaki `14 ten sonra` gibi saat eşikleri artık ilk yanıtta da korunuyor.
- [x] 2026-05-15: `server/src/tests/whatsappConversationFixtures.ts` içine `19 Mayıs saat 14 ten sonra istiyorum` regresyon fixture'ı eklendi; spaced threshold phrasing senaryosu otomatik doğrulamaya bağlandı.
- [x] Sonraki adım: yeni üretim bug'ları geldikçe fixture setine regresyon senaryoları eklemek.
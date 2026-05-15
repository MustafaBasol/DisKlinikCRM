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
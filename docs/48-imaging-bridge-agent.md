# 48 — Görüntüleme Köprü Ajanı (Windows, klasör izleme)

Bu doküman `bridge-agent/` altındaki Windows arka plan ajanının kurulumunu,
yapılandırmasını ve operasyonel işletimini anlatır. Sunucu tarafı sözleşme
için bkz. [`47-imaging-bridge-contract.md`](./47-imaging-bridge-contract.md).

## Mimari

```
Vendor görüntüleme yazılımı ──(export)──► İzlenen klasör
                                              │ (chokidar, kararlılık beklenir)
                                              ▼
                                    Yerel kalıcı kuyruk (queue/pending)
                                    (kopya + sha256 + magic-byte tespiti)
                                              │
                                              ▼
                                   POST /api/public/imaging/bridge/studies
                                   (Bearer token, tek seferde bir öğe,
                                    üstel geri çekilme ile yeniden dene)
                                              │
                                              ▼
                                         NoraMedi sunucusu
```

Ajan tek bir Node.js süreci olarak çalışır (NSSM ile Windows servisi olarak
sarmalanır), watcher/queue/uploader/heartbeat bileşenleri aynı süreç
içinde birlikte çalışır.

## Desteklenen dosya türleri

`.jpg`/`.jpeg` (image/jpeg), `.png` (image/png), `.webp` (image/webp),
`.dcm`/`.dicom` (application/dicom, yalnızca Part-10 — 128 baytlık preamble +
`DICM` işareti). Bu set sunucudaki
`server/src/services/imaging/imagingUploadValidation.ts` ile birebir
aynıdır; içerik magic-byte ile doğrulanır, yalnızca uzantıya güvenilmez.

## Bu fazın sınırlamaları (bilinçli olarak kapsam dışı)

- DICOM C-STORE / router entegrasyonu yok.
- TWAIN/WIA cihaz sürücü entegrasyonu yok.
- Vendor SDK eklentileri yok.
- PACS/DICOMweb (STOW-RS) yok.
- İş çekme / worklist (`GET /bridge/jobs` benzeri) yok — yalnızca klasör
  izleme ile tek yönlü yükleme var.
- Tarayıcıda DICOM görüntüleme yok (ayrı bir PR'ın konusu).
- CBCT hacim işleme, tanısal AI yok.
- Dosya adından/klasörden hasta eşleştirme YAPILMAZ.
- Standalone .exe / MSI paketleme yok — Node.js 20+ klinik PC'sinde kurulu
  olmalıdır (bkz. "Dağıtım" bölümü).

## 1) NoraMedi tarafında cihaz ve köprü ajanı oluşturma

1. NoraMedi'de **Ayarlar → Görüntüleme Cihazları**'ndan yeni bir
   `ImagingDevice` oluşturun (örn. "IO Sensör 1", modality `IO`). Oluşan
   `deviceId`'yi not edin — config'teki `watches[].deviceId` bu olacak.
2. **Ayarlar → Köprü Ajanları**'ndan yeni bir ajan kaydı oluşturun. Sunucu
   düz metin token'ı **yalnızca bir kez** gösterir (`nmb_...` önekli) —
   kaybedilirse ajan tekrar kaydedilmeli veya token değiştirilmelidir.

## 2) Vendor yazılımının export klasörünü ayarlama

Kullandığınız sensör/tarayıcı yazılımında, her çekimden sonra görüntüyü
otomatik olarak sabit bir klasöre (örn. `C:\DentalSoftware\Export`) JPEG,
PNG veya DICOM olarak kaydedecek şekilde "otomatik export" ayarını açın.
Ajan bu klasörü izler; kaynak dosyalara asla yazmaz/yeniden adlandırmaz/
silmez — vendor yazılımınızın kendi arşivleme davranışı etkilenmez.

## 3) Yapılandırma (`config.json`)

`config/config.example.json` şablonunu
`C:\ProgramData\NoraMediBridge\config.json`'a kopyalayın (kurulum betiği
bunu otomatik yapar) ve düzenleyin:

```json
{
  "serverUrl": "https://api.noramedi.com",
  "tokenFile": "C:\\ProgramData\\NoraMediBridge\\bridge-token.txt",
  "queueDir": "C:\\ProgramData\\NoraMediBridge\\queue",
  "logDir": "C:\\ProgramData\\NoraMediBridge\\logs",
  "statusDir": "C:\\ProgramData\\NoraMediBridge\\status",
  "heartbeatIntervalSeconds": 60,
  "stabilityMs": 5000,
  "importExisting": false,
  "maxAttempts": 100,
  "backoffBaseMs": 60000,
  "backoffCapMs": 900000,
  "tokenPollIntervalMs": 15000,
  "watches": [
    {
      "id": "io-sensor-1",
      "path": "C:\\DentalSoftware\\Export",
      "deviceId": "<NoraMedi'deki ImagingDevice ID'si>",
      "modality": "IO",
      "patterns": [".jpg", ".jpeg", ".png", ".webp", ".dcm", ".dicom"]
    }
  ]
}
```

Önemli alanlar:
- **`serverUrl`**: prod'da `https://` zorunlu; `http://` yalnızca
  `localhost`/`127.0.0.1` için geliştirme amaçlı kabul edilir.
- **`tokenFile`**: token **buraya değil**, ayrı bir dosyaya konur (aşağıya
  bakın) — `config.json` içinde asla düz metin token bulunmaz.
- **`importExisting`**: varsayılan `false` — klasörde zaten var olan
  dosyalar yüklenmez, yalnızca kurulumdan SONRA eklenenler yüklenir. İlk
  kurulumda geçmiş dosyaları da yüklemek isterseniz `true` yapın (dikkatli
  kullanın — büyük bir klasörde tek seferde çok sayıda yükleme tetikler).
- **`watches[].deviceId`**: her izlenen klasör, NoraMedi'deki bir
  `ImagingDevice`'a eşlenir — eşleşme dosya adından/klasörden DEĞİL, bu
  alandan gelir.
- **`watches[].id`**: opsiyonel; verilmezse deviceId+sıra numarasından
  deterministik türetilir. Loglarda/status'te yalnızca bu `watchId` görünür
  — gerçek klasör yolu asla loglanmaz.

## 4) Token yönetimi (ayrı dosya, ACL korumalı)

Token `config.json`'dan tamamen ayrı bir dosyada tutulur
(`C:\ProgramData\NoraMediBridge\bridge-token.txt`, varsayılan). Kurulum
betiği bu dosyayı yalnızca servisin çalıştığı kimlik (LocalSystem veya
seçilen `-ServiceAccount`) ve Administrators'ın okuyabileceği şekilde
kilitler (`icacls`). Token asla: config dosyasında, loglarda, status
çıktısında, komut satırı argümanında veya PowerShell konsol geçmişinde
görünmez.

### Token iptal / değiştirme

1. NoraMedi'de ilgili köprü ajanını **iptal edin** (mevcut token anında
   geçersiz olur).
2. Yeni bir token oluşturun.
3. `bridge-token.txt` dosyasının içeriğini yeni token ile **değiştirin**
   (dosyayı silip yeniden oluşturmak yerine üzerine yazın — ACL korunur).
4. Ajan servisi yeniden başlatmaya GEREK DUYMAZ: 401 aldığında ajan
   otomatik olarak duraklar ve `tokenFile`'ın içeriğini periyodik olarak
   (varsayılan 15 sn) kontrol eder; değişikliği görünce tek bir doğrulama
   heartbeat'i gönderir, başarılıysa otomatik devam eder. İsterseniz
   `restart-service.ps1` ile de anında yeniden başlatabilirsiniz — ikisi de
   çalışır.

## 5) Windows kurulumu

```powershell
cd bridge-agent
npm install
npm run build
.\scripts\install-service.ps1
# Ağ paylaşımına export ediyorsanız (LocalSystem paylaşımlara erişemez):
.\scripts\install-service.ps1 -ServiceAccount "CLINIC\svc-noramedi"
```

`install-service.ps1` gereksinimleri:
- Yönetici olarak çalıştırılmalı.
- Node.js 20+ PATH'te olmalı.
- `nssm.exe` PATH'te olmalı veya `-NssmPath` ile verilmeli —
  **NSSM bu depoya dahil değildir**, https://nssm.cc/download adresinden
  indirin.

Betiğin yaptıkları: `C:\ProgramData\NoraMediBridge` altında
`queue/{pending,processing,failed}`, `logs`, `status` dizinlerini
oluşturur; `config.example.json`'ı ilk kurulumda `config.json`'a kopyalar
(varsa dokunmaz); token'ı güvenli girdi ile alıp dosyaya yazar; token
dosyasının ACL'ini kısıtlar; NSSM servisini kaydedip otomatik yeniden
başlatmayı yapılandırır.

### Servis hesabı seçimi

- **LocalSystem (varsayılan)**: ek kurulum gerekmez, yerel klasörler için
  yeterlidir.
- **Özel hizmet hesabı** (`-ServiceAccount DOMAIN\user`): vendor yazılımı
  bir ağ paylaşımına (`\\sunucu\export` gibi) export ediyorsa gereklidir —
  LocalSystem ağ kimlik doğrulaması yapamaz. Seçilen hesabın:
  - her `watches[].path` klasörüne **okuma**,
  - `C:\ProgramData\NoraMediBridge` ağacına **okuma/yazma**
  izni olmalıdır. Kurulum betiği token dosyası ACL'ini bu hesaba göre
  ayarlar.

### Servis komutları

```powershell
.\scripts\start-service.ps1
.\scripts\stop-service.ps1
.\scripts\restart-service.ps1
.\scripts\status-service.ps1
.\scripts\uninstall-service.ps1     # servisi kaldırır, ProgramData'ya dokunmaz
```

## 6) Log ve kuyruk konumları

- Loglar: `C:\ProgramData\NoraMediBridge\logs\bridge-agent-YYYY-MM-DD.jsonl`
  (JSON-lines, gün başına döner). İçerik: `watchId`, kısaltılmış
  `ingestKey`, olay adı, kategori — dosya adı/klasör yolu/token asla.
- Kuyruk: `C:\ProgramData\NoraMediBridge\queue\{pending,processing,failed}`
  — her öğe `<ingestKey>/` altında `file<uzantı>` + `meta.json`.
- Durum: `C:\ProgramData\NoraMediBridge\status\status.json` —
  `.\scripts\status-service.ps1` ile okunabilir.

## 7) Çevrimdışı davranış

İnternet veya NoraMedi API'si erişilemez durumdaysa: watcher yeni dosyaları
kuyruğa almaya devam eder (kayıp yok), yükleme denemeleri `429`/`5xx`/ağ
hatalarında üstel geri çekilme ile tekrarlanır (60 sn'den başlar, 15
dakikada tavanlanır, varsayılan olarak ~24 saat boyunca denenir), servis/PC
yeniden başlasa bile kuyruk diskte kalıcıdır ve kaldığı yerden devam eder.

## 8) Başarısız öğelerin yeniden denenmesi

`maxAttempts` aşıldığında veya kalıcı bir hata (400/404/413) alındığında
öğe `queue/failed/<ingestKey>/`'e taşınır (dosya korunur, silinmez).
Manuel yeniden deneme:

```powershell
.\scripts\retry-failed.ps1 -IngestKey <ingestKey>
.\scripts\retry-failed.ps1 -IngestKey all
```

Bu, `attemptCount`'u sıfırlar ve öğeyi `pending/`'e geri koyar; `deviceId`
hâlâ config'te tanımlı değilse uyarı verir (yine de kuyruğa alınır, config
düzeltilene kadar `404` ile başarısız olmaya devam eder).

## 9) Ajan sürüm yükseltme

1. Yeni sürümü indirin/derleyin (`npm run build && npm run package`).
2. `.\scripts\stop-service.ps1`
3. `dist/agent.cjs`'i güncelleyin (kurulum dizinindeki `dist/` klasörünü
   yeni sürümle değiştirin — `config.json`/`bridge-token.txt`/`queue/` bu
   klasörün dışında olduğu için etkilenmez).
4. `.\scripts\start-service.ps1`

Kuyrukta bekleyen öğeler sürüm yükseltmeden etkilenmez — diskte kalıcıdır.

## 10) Sorun giderme

| Belirti | Kontrol |
|---|---|
| `authState: invalid` | Token iptal edilmiş olabilir — NoraMedi'de ajanı kontrol edin, gerekirse token'ı değiştirin (bkz. bölüm 4). |
| `pendingCount` sürekli artıyor | `connectionState`'e bakın; sunucuya erişim var mı, `serverUrl` doğru mu kontrol edin. |
| Bir klasör `available: false` | Klasör yolu var mı, servis hesabının okuma izni var mı kontrol edin. |
| `failedCount` artıyor | `queue/failed/<key>/meta.json` içindeki `lastErrorCategory`'e bakın (`bad_request`, `device_not_found`, `file_too_large`, `max_attempts_exceeded`, `quarantined_*`). |
| Servis başlamıyor | `logs/` altındaki en güncel `.jsonl` dosyasına bakın; `node --version` ≥ 20 olduğunu doğrulayın. |

## 11) Kaldırma (uninstall)

```powershell
.\scripts\uninstall-service.ps1
```

Servis kaldırılır; `C:\ProgramData\NoraMediBridge` (config/kuyruk/loglar)
bilinçli olarak silinmez — tam temizlik için bu klasörü elle silin.

## 12) Pilot klinik kontrol listesi

- [ ] NoraMedi'de `ImagingDevice` oluşturuldu, `deviceId` not edildi.
- [ ] NoraMedi'de köprü ajanı kaydedildi, tek seferlik token güvenle saklandı.
- [ ] Vendor yazılımı export klasörü belirlendi ve otomatik export açıldı.
- [ ] Node.js 20+ klinik PC'sinde kurulu.
- [ ] `npm install && npm run build` çalıştırıldı.
- [ ] `install-service.ps1` çalıştırıldı (gerekiyorsa `-ServiceAccount` ile).
- [ ] `config.json` düzenlendi (`watches[].path`/`deviceId`/`modality`).
- [ ] Servis başlatıldı, `status-service.ps1` ile `authState: valid`,
      `connectionState: online` doğrulandı.
- [ ] Test görüntüsü export klasörüne bırakıldı → birkaç saniye içinde
      NoraMedi'de "bağlanmamış kuyruk"ta (veya eşleşen hastada) göründü.
- [ ] Aynı dosya tekrar bırakıldı → NoraMedi'de ikinci bir kayıt
      OLUŞMADIĞI doğrulandı (idempotency).
- [ ] İnternet kısa süreliğine kesilip test görüntüsü bırakıldı → bağlantı
      geri gelince görüntünün otomatik yüklendiği doğrulandı.

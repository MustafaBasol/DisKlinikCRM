# F4 — Storage and Backup Foundation

Faz durumu: `TODO` · Son güncelleme: 2026-08-14 (F4-1A)

> **Faz durumu değişmedi.** F4-1A, sağlayıcıdan bağımsız ve ek (additive) bir depo-içi hazırlık adımıdır; F4'ün tamamlandığını, F4'e geçişin yetkilendirildiğini veya F3'ün kapandığını **iddia etmez**. F3 çıkış kapısı `NOT SATISFIED`, `F4_TRANSITION_AUTHORIZED = NO` olarak kalır ve `F3-C2-ERR-004` `BLOCKED_WAITING_IHS` durumundadır (bu görevle ilgisizdir).

## F4-1A — Storage Key Contract Reconciliation and Foundation

`F4-1A_KEY_CONTRACT_RECONCILIATION = COMPLETE` · `F4-1A_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_2026-08-14`

### Reconciliation sonucu — kabul edilen ileri sözleşme

F4-1A öncesinde `main` içinde dört bağımsız anahtar üretici vardı. Kabul edilen sonuç, **tek bir evrensel literal şablon değil, tek bir yetkili sözleşme altında sınıf-özel üreticilerdir** (`buildObjectStorageKey`, `server/src/services/fileStorage.ts`):

| Sınıf | Anahtar şekli | Durum |
|---|---|---|
| Patient attachment / lab attachment / imaging image | `<clinicId>/<opaqueId><ext>` | **Değişmedi.** Üçü tek namespace paylaşır. |
| Export archive (KVKK hasta + klinik toplu) | `exports/<clinicId>/<exportId>.zip` | **Değişmedi**; kilitli tam-string testi korunur. |
| Backup destination artifact | `file-backups/<domain>/<clinicId>/<recordId>.bin` | **Ayrı kalır** — `fileBackupDestination.ts` sahipliğinde operasyonel yedek artefaktı. |
| Backup run manifest | `file-backups/manifests/<runId>.json` | **Ayrı kalır** — aynı gerekçe. |

**Reddedilen alternatifler:**

- `<domain>/<clinicId>/<yyyy>/<mm>/<opaqueId><ext>` (F0-011 §6.2 önerisi) — `<yyyy>/<mm>` bölümlemesi F0-011'in kendi §19'unda **çözülmemiş bir PoC ölçüm sorusu** olarak işaretlidir; ayrıca `<domain>` öne alınması her mevcut içerik anahtarını yeniden şekillendirir ve `kvkkAttachmentImagingLifecycle.test.ts`'in `startsWith('clinic-123/')` kilidini kırar. Bu, §8 item 11'in bloklu tuttuğu anahtar migrasyonunun ta kendisidir.
- `organizationId/clinicId/class/entity/uuid` — kabul edilmiş hiçbir depo kararında yer almaz; beşinci bir konvansiyon icat eder; ADR-008'in "mevcut `buildStorageKey` konvansiyonu üzerine inşa et" yönüyle çelişir. **İzolasyon açısından da kazanç sağlamaz:** `clinicId` zaten globalde benzersizdir ve organizasyonu tek başına belirler; yetkilendirme sınırı anahtar değil, kapsamlanmış DB satırıdır. `organizationId` her etkileşimli yazma yolunda türetilebilir durumdadır (bkz. aşağıdaki not) ancak **bilinçli olarak anahtara eklenmemiştir**.

### Bu görevin yaptığı ve yapmadığı

**Yaptığı:** dört üreticiyi tek yetkili üretici altında topladı; her sunucu-türetimli segment için fail-closed doğrulama ekledi (boş/ayraç/traversal/kontrol karakteri/sürücü öneki); üreticinin kendi çıktısını `isSafeStorageKey()` son-koşuluyla yeniden denetlemesini sağladı; uzantı normalizasyonunu kısa alfanümerik bir ek ile sınırladı; odaklı bir sözleşme test paketi ekledi (`test:storage-key-contract`).

**Kapattığı somut açık:** `buildStorageKey('', name)` daha önce `/<epochMs>-<rand>.pdf` üretiyordu; `resolveLocalPath()` bunu **mutlak yol** olarak kabul edip upload kökünün dışına yazardı. Artık fail-closed reddedilir.

**Yapmadığı:** hiçbir anahtar biçimi değişmedi; hiçbir kalıcı `filePath`/`storageKey` değeri okunmadı, yazılmadı, kopyalanmadı, taşınmadı veya silinmedi; şema/migration yok; dual-read veya okuma-anında otomatik migrasyon yok; tenant sınırı ötesine fallback yok; prefix enumerasyonu yok; sağlayıcı seçimi, bucket, kimlik bilgisi veya S3 aktivasyonu yok; fiziksel silme ve legal-hold davranışı değişmedi; mevcut façade çağrı yerleri **taşınmadı** (statik kaynak-metin regresyon testleri onları sabitliyor — taşıma F4-1A2'ye ertelendi).

### Geriye dönük uyumluluk

Depoda hiçbir yer anahtarı **yeniden üretmez**; her okuma kalıcı sütun değerini birebir kullanır. Bu nedenle mevcut tüm referanslar (yeni biçim anahtarlar ve eski mutlak yollar dâhil) F4-1A öncesiyle aynı kod yolundan çözülmeye devam eder. `buildStorageKey`/`buildExportStorageKey` geçerli girdiler için bayt-bayt aynı çıktıyı verir.

### Rollback

Tek commit'lik revert yeterlidir; kalıcı veri değişmediği için veri kaybı riski yoktur.

## Objective (Hedef)

Object-storage soyutlamasını (ADR-008) ve kurumsal yedekleme/PITR temelini (ADR-013) kurmak; yerel disk bağımlılığını kaldırmak; restore testlerini rutinleştirmek. Tasarım girdisi: F0-011.

## Business reason (İş gerekçesi)

Imaging (DICOM/CBCT) ölçeklenmeden önce object storage zorunludur (PROGRAM DIRECTION #13). Doğrulanmamış yedek, yedek değildir; sağlık verisinde veri kaybı kabul edilemez.

## Entry conditions (Giriş koşulları)

- F3 çıkışı
- F0-011 tasarımı ve ADR-008/013 kabulü
- KVKK taban çizgisi teyidi (storage-key migrasyonu dondurma listesindedir)

## Exit gate (Çıkış kapısı)

- Object storage canlıda kanıtla çalışıyor; yeni yazımlar object storage'a
- Yedekleme + PITR kurulu; **başarılı restore testi kanıtı** var
- Mevcut dosyaların migrasyon planı onaylı/uygulanmış

## Dependencies (Bağımlılıklar)

- F3; KVKK taban çizgisi teyidi

## Allowed work (İzinli işler)

- Storage abstraction implementasyonu, sağlayıcı entegrasyonu, yedekleme otomasyonu, kademeli dosya migrasyonu

## Prohibited work (Yasak işler)

- Onaysız toplu (big-bang) dosya taşıma
- Attachment fiziksel-silme akışının KVKK teyidi öncesi değiştirilmesi

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F3 kanıtları incelendikten sonra atanacaktır.

- Sağlayıcı seçimi ve veri yerleşimi (KVKK) doğrulaması
- Storage abstraction katmanının canlıya alınması
- Kademeli storage-key migrasyonu
- Otomatik yedekleme + PITR kurulumu
- Periyodik restore testi otomasyonu
- Disk kullanım alarmları ve temizlik politikaları

## Required evidence (Gerekli kanıt)

- Restore testi kayıtları; migrasyon ilerleme raporları; sağlayıcı yerleşim kanıtı

## Required tests (Gerekli testler)

- Storage entegrasyon testleri; upload/download/delete yaşam döngüsü; migration testleri

## Security requirements (Güvenlik gereksinimleri)

- Şifreleme (at-rest/in-transit); erişim anahtarlarının güvenli yönetimi; URL imzalama politikası

## Tenant requirements (Tenant gereksinimleri)

- Storage anahtar şeması tenant ayrımını garanti etmeli

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Veri yerleşimi (Türkiye/AB) gereksinimlerine uygun sağlayıcı; silme taleplerinin object storage'da da uygulanabilirliği

## Rollback expectations (Geri alma beklentileri)

- Migrasyon adımları çift-yazım/geri-okuma stratejisiyle geri alınabilir olmalı

## Risks (Riskler)

- R-005, R-006, R-007, R-013 (yerleşim boyutu), R-016

## Open questions (Açık sorular)

- Sağlayıcı adayları ve maliyet modeli (F0-011 çıktısı)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-08-14 | F4-1A | Storage-key sözleşme reconciliation'ı kaydedildi; dört rakip üretici tek yetkili üretici altında toplandı; dar kapsamlı dondurma istisnası kaydedildi. Faz durumu `TODO` olarak **değişmedi**. F0-011'in yedekleme/checksum bölümünün bayatladığı not edildi: `FileBackupRun`/`FileBackupEntry`, streaming SHA-256, read-back doğrulaması ve restore rehearsal artık mevcuttur. |

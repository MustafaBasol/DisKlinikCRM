# F4 — Storage and Backup Foundation

Faz durumu: `TODO` · Son güncelleme: 2026-08-14 (F4-FCR-001)

> **Faz durumu değişmedi.** F4-1A ve F4-FCR-001, sağlayıcıdan bağımsız ve ek (additive) depo-içi hazırlık adımlarıdır; F4'ün tamamlandığını, F4'e geçişin yetkilendirildiğini veya F3'ün kapandığını **iddia etmez**. F3 çıkış kapısı `NOT SATISFIED`, `F4_TRANSITION_AUTHORIZED = NO` olarak kalır ve `F3-C2-ERR-004` `BLOCKED_WAITING_IHS` durumundadır (bu görevlerle ilgisizdir).

## F4-FCR-001 — First-Customer Recovery Closure (kanıt, görünürlük, güvenlik)

`F4-FCR-001_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`

### Dondurma (freeze) pozisyonu — yeni istisna ALINMADI

Bu görev **yeni bir dondurma istisnası talep etmemiş ve kullanmamıştır.** [`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2 satır 18'in yasakladığı şey "**any live backup/PITR implementation**"dır. F4-FCR-001'in tamamı üç kategoriye girer ve hiçbiri bu tanıma girmez:

1. **Gözlemlenebilirlik** — mevcut, üretimde doğrulanmış `noramedi-opscheck.sh` yoluna iki kontrol eklemek; Platform Admin'e salt-okunur görünürlük.
2. **Güvenlik düzeltmeleri** — mevcut kodda tespit edilen sızıntı/temizlik kusurlarının giderilmesi.
3. **Kanıt (evidence)** — restore tatbikatlarının ölçülebilir ve kalıcı hale getirilmesi.

Yedekleme mekanizmasının kendisi, hedefi, şifrelemesi, zamanlaması ve PITR durumu **değiştirilmemiştir**. §8 madde 1'in dondurduğu "**geniş** Prisma şema değişiklikleri" kapsamına girmemek için şema değişikliği tek ve tamamen ek bir tabloyla sınırlıdır (`RecoveryDrillRun`) — bu, `FILE_BACKUP_COVERAGE_001` ve `SecurityIncident` ile aynı additive-tablo emsalini izler.

> **Program sahibine not (yönetişim boşluğu, bu görevin sebep olmadığı):** `FILE_BACKUP_COVERAGE_001`, satır 18'in "separate user decision to begin F0-011" çıkış koşulunu kendi görev dağıtımının karşıladığını **yalnızca bir kanıt dosyasında** ilan etmiş, hiçbir merkezî izleyici dosyayı güncellememiştir. Bu yüzden bugün `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md:41` hâlâ "any live backup/PITR implementation" yasağını, `RISK_REGISTER.md` ise R-030/R-031/R-032'yi `OPEN` olarak göstermektedir — dosya yedekleme uygulaması merkeze alınmış olmasına rağmen. F4-FCR-001 bu boşluğu **tekrarlamamak** için kendi konumunu burada açıkça kaydeder; boşluğun kendisini kapatmak program sahibinin kararıdır.

### Bu görevin yaptığı

| Yetenek | Önce | Sonra |
|---|---|---|
| Restore tatbikat kanıtı | Yok; süre hiç kalıcılaştırılmıyordu | `RecoveryDrillRun` defteri (DB restore testi + dosya restore tatbikatı) |
| Ölçülebilir RPO/RTO | Ölçülemiyordu | `durationMs` = RTO; `sourceArtifactAgeMinutes` = efektif RPO |
| Bit-rot tespiti | **Yapısal olarak imkânsız** — `verified` kayıt bir daha doğrulanmıyor, yalnızca en yeni 5 kayıt örnekleniyordu | `mixed`/`oldest` örnekleme stratejileri eskiyen nesneleri de sınar |
| Çökmüş yedek koşusu | Sonsuza dek `running` | `failed` / `run_abandoned` olarak süpürülür |
| Artık restore-test veritabanı | Üretim kümesinde tam, düz-metin, çapraz-tenant hasta veritabanı kopyası kalabiliyor; adı **redakte**, uyarı yok, tekrar deneme yok | Tekrar denenir, deftere gerçek adıyla yazılır, denetlenir, Platform Admin'de gösterilir |
| Dosya yedekleme operatör görünürlüğü | **Sıfır** (`grep -rn "file-backups\|fileBackup" src/` → hiç sonuç yok) | Platform Admin bölümü |
| Dosya yedekleme / tatbikat alarmı | Yok | `opscheck` → Healthchecks.io → operatör e-postası |
| Yedek log ifşası | Harici betiğin logu HTTP üzerinden **birebir** dönüyordu | Bağlantı dizgesi/parola/erişim anahtarı redaksiyonu |

### Bu görevin YAPMADIĞI (ve neden)

- **PITR/WAL arşivleme yok.** Araç seçimi kaydedildi (**pgBackRest**; gerekçe ve gereken istisna metni [`runbooks/F4_RECOVERY_OPERATIONS.md`](../runbooks/F4_RECOVERY_OPERATIONS.md) §7.1). Etkinleştirme hem üretim PostgreSQL yeniden başlatması hem de yeni bir dondurma istisnası gerektirir. `R-031` `OPEN` kalır.
- **Off-host hedef yok.** İkincil Türkiye altyapı VPS'i **tedarik edilmemiştir**. Ayrıca deponun kendi kaydı gereği: imaging birincil deposu o VPS'te ise, aynı VPS o veri için bağımsız yedek **sayılamaz** — bu R-030'u taşır, kapatmaz. `R-030` `OPEN` kalır.
- **Yedek formatı şifrelemesi yok.** Üretim `.dump` dosyası düz metindir (ampirik olarak doğrulanmıştır).
- **DB yedek betiği depoya alınmadı.** `/usr/local/sbin/noramedi-db-backup.sh` bu programda **hiç okunmamıştır**; okunmadan yeniden yazmak bilinmeyen davranışı bozma riski taşır. Doğru ilk adım betiğin salt-okunur olarak temin edilmesidir.
- **Legal-hold / silme yayılımı yok** — harici hukuki karara bağlıdır (`COUNSEL_REVIEW_REQUIRED`).

### F0-011 / F0-006 bayat iddia düzeltmeleri (mevcut kodla çelişenler)

- `f0-011-backup-restore-gap-matrix.json` GAP-C "dosya baytlarının yedeği yok" — **bayat**; uygulama mevcut (yalnızca üretimde kapalı).
- Aynı dosya GAP-A "`runRestoreTest()` gerçekten çalıştırıldığına dair kalıcı kanıt yok" — **bayat**; `BACKUP_RESTORE_REHEARSAL_001.md` iki gerçek koşu kaydeder (`PASS`, RTO 3 sn).
- `PILOT_BACKUP_RESTORE_AND_FILE_COVERAGE_AUDIT.md:41` "yedek hatası için izleme/alarm yok" — **bayat**; `noramedi-opscheck.sh` `check_backup()` üretimde kurulu ve canlı-alarm doğrulanmış.
- `F0-006_configuration_inventory.json:127` "`backupService.ts` yorumları PITR'ı hedef yetenek olarak tanımlıyor" — **bayat**; güncel dosyada böyle bir yorum yok. Aynı satırın `archive_mode=off` kısmı **geçerli**.
- `PRODUCTION_TOPOLOGY.md:103` / `LAUNCH_GATES.md:38` "depoda `ecosystem.config.*` yok" — **bayat**; kök dizinde mevcuttur.

Bayat **olmayan** (düzeltilmemeli): versiyonlama, object-lock/değişmezlik, yaşam döngüsü/saklama, bucket-config doğrulaması, PITR ve yedek baytlarının uygulama katmanı şifrelemesi — bunlar gerçekten uygulanmamıştır.



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
| 2026-08-14 | F4-FCR-001 | Restore tatbikat kanıt defteri (`RecoveryDrillRun`), ölçülebilir RPO/RTO, zamanlanabilir dosya restore tatbikatı (`mixed`/`oldest` örnekleme ile bit-rot tespiti), çökmüş koşu süpürücüsü, artık restore-test veritabanı olayının tespiti/denetimi/görünürlüğü, yedek log redaksiyonu, `opscheck` `filebackup` + `drill` kontrolleri ve Platform Admin görünürlüğü eklendi. **Yeni dondurma istisnası alınmadı**; PITR ve off-host hedef bilinçli olarak kapsam dışı bırakıldı. Faz durumu `TODO` olarak **değişmedi**; R-030/R-031/R-032 `OPEN` kalır. |

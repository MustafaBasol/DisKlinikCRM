# F4 — Storage and Backup Foundation

Faz durumu: `TODO` · Son güncelleme: 2026-08-21 (**F4-2-R2 — `R-030-DB` kapanış doğrulaması: dört blokajın **üçü** kapandı (emanet, zamanlama, izleme), dördüncüsü — **KVKK Workload-B hukuki kapısı** — `COUNSEL_PENDING` olarak açık kaldı. `repo2` günlük 03:30 tam yedek + haftalık verify zamanlaması kuruldu; `repo1` için de hiç var olmayan zamanlama eklendi (izlemenin ön koşuluydu); PITR-farkındalıklı opscheck ve durum yazıcısı dağıtıldı ve armed; 16/16 arıza senaryosu fail-closed; `repo2` kaynaklı **yeni** restore `PASS` (RPO 2 dk / RTO 25 s, migration 80/80). **`R-030-DB` `OPEN`**, **`FIRST_CUSTOMER_RECOVERY_GATE` `NOT_SATISFIED`**, **F4 COMPLETE `NO`**, **F5 `NO`**. Ayrıntı aşağıda ve [evidence/F4-2-R2_R030DB_CLOSURE_VERIFICATION_AND_WORKLOAD_B_GATE.md](../evidence/F4-2-R2_R030DB_CLOSURE_VERIFICATION_AND_WORKLOAD_B_GATE.md).) · Önceki güncelleme: 2026-08-21 (**F4-2-R1 — `repo2` ÜRETİMDE AKTİF EDİLDİ.** Saha dışı şifreli pgBackRest `repo2`, Türkiye ikincil VPS'inde SFTP üzerinden aktif: `stanza-create`/`check` çıkış 0, ilk tam yedek `20260821-105916F` (8 s, 4.4 MB), WAL sürekliliği `failed_delta=0`, `repo2` kaynaklı izole restore tatbikatı **PASS** (**RPO 1 dk**, **RTO 10 sn**, migration 80/80, uygulama + kiracı izolasyon smoke passed) — `noramedi-pgbackrest-status.sh` program tarihinde **ilk kez** `offHost="yes"` / `RESTORE_PROVEN_FROM_REPO2` raporluyor. `repo1` **korundu** (7 yedek, aynı etiketler, `repo1-*` bayt bazında aynı); GlitchTip ve görüntüleme **değişmedi** ve izolasyonları teste tabi tutularak doğrulandı; görüntüleme MinIO'sunun `repo2` için kullanılması **reddedildi**. **Gate 6 kapatıldı** — aktivasyon öncesi VPS2 üretimin `2210` portuna ulaşabiliyordu (`REACHABLE_BAD`), şimdi tümü `UNREACHABLE_GOOD`. **`repo2-cipher-pass` VPS2'den kaldırıldı.** **YENİ BULGU:** libssh2 `ecdsa-sha2-nistp256` müzakere ediyor, `ssh-ed25519` değil — ed25519 parmak izi sabitlemek her seferinde `ERROR [101]` ile fail-closed olur. **Faz durumu `TODO` KALIR ve `R-030-DB` `OPEN` KALIR:** cipher-pass **emanete verilmedi**, `repo2` için **zamanlama yok**, dağıtılmış `opscheck` **PITR'ı desteklemiyor** (2026-08-13 yapısı, 0 `pitr` geçişi), ve **KVKK Workload-B kapısı açık** — register §6 düzeltmenin ilk bayt ayrılmadan **önce** yapılmasını şart koşuyordu, düzeltme **sonra** yapıldı; bu bir yönetişim bulgusu olarak kaydedildi. Öncesinde 2026-08-17 (F4-FCR-004 / F4-FCR-004-R1 — **SFTP güvenlik sözleşmesi + yönetişim düzeltmesi**, aşağıdaki bölüme bakınız: sonuç `BLOCKED_EXTERNAL`, PR #441 üzerindeki üç birleştirme blokajı düzeltildi, **`repo2` AKTİF EDİLMEDİ**, `R-030-DB` `OPEN` kalır. Öncesinde F4-FCR-003-R2 — **repo2 yedek topolojisi kararı**: `SELECTED TOPOLOGY = C`, yani **depo host'u OLMAYAN**, üretim birincili tarafından yazılan saha dışı bir `repo2`. §22.11 blokajı **çözüldü**: `ERROR [072]`'nin koşulu `--repo=2` değil, yalnızca **`repoN-host` ayarlanmış olması**; depo host'u olmayan bir `repo2` bu kontrolü tetikleyemez. Sabitlenmiş **pgBackRest 2.50** üzerinde uçtan uca doğrulandı — `repo2-host` negatif kontrolü **reddedildi (çıkış 72)**, `s3` ve `sftp` şekilleri ise birincilde `backup`/`info`/`verify` **ve tam `restore`** işlemlerini çıkış 0 ile tamamladı; `repo2` nesnelerinde **0 düz metin PHI**. Seçenek A (depo-host sürücülü) güveni **karşılıklı** hale getirdiği ve §16.5 ile §22.9'un kapısını ihlal ettiği için, seçenek B (yükseltme) ise elde bulunan bir yeteneği canlı bir PHI host'unda paket yükseltmesiyle satın aldığı için **reddedildi** (kontrol **2.55.0**'da kaldırılmıştı). Runbook yakınsandı: CHECKPOINT 5–8, restore ve rollback akışlarındaki **her komut artık `RUN ON:` işareti taşıyor**. **`R-030-DB` `OPEN` kalır** — ikincil VPS **TEDARİK EDİLMEMİŞ**. Öncesinde F4-FCR-003-R1 — mimari inceleme düzeltmeleri: CI kırmızısının kök nedeni bir `pipefail` + `SIGPIPE` yarışı yüzünden **sessizce geçen bir muhafızdı**, pgBackRest **2.50** sürüm eşitliği yerelde koşuldu (`OBSERVED_LOCAL_ONLY — SAME SEMANTICS`), **WAL birikim izlemesi** eklendi; 2.50 üzerinde `backup --repo=2` birincilde reddediliyor — §22.11 blokajı. Öncesinde F4-FCR-003 — `R-030-DB` saha dışı aktivasyon hazırlığı: dört sessiz-hata kusuru kapatıldı, **Gate 0 yerelde çalıştırıldı ve `PASS`**, operatör aktivasyon paketi yazıldı; **`R-030` / `R-030-DB` `OPEN`**, `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` — kalan blokaj tedarik ve hukuk)

> **Faz durumu değişmedi.** F4-1A ve F4-FCR-001, sağlayıcıdan bağımsız ve ek (additive) depo-içi hazırlık adımlarıdır; F4'ün tamamlandığını, F4'e geçişin yetkilendirildiğini veya F3'ün kapandığını **iddia etmez**. F3 çıkış kapısı `NOT SATISFIED`, `F4_TRANSITION_AUTHORIZED = NO` olarak kalır ve `F3-C2-ERR-004` `BLOCKED_WAITING_IHS` durumundadır (bu görevlerle ilgisizdir).

## F4-ATTACH-001-R1 — Hasta eki VPS2 şifreli ikincil kopyası: keşif ve uygulama planı

`F4-ATTACH-001-R1_STATUS = PLAN_AND_SCRIPTS_PREPARED_NOT_ACTIVATED` · `AGENT_COMPLETED = YES`
`PR_OPENED = YES (#484, DRAFT)` · `MERGED = NO` · `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO`
`APPLICATION_CODE_CHANGED = NO` (`server/src/**`, `src/**` dokunulmadı) · `MIGRATION_REQUIRED = NO` · `MIGRATION_CREATED = NO`
`R-030-FILES` durumu değişmedi (bu satır kendi kapanışını ilan etmiyor) · `PRODUCTION_MUTATION = NONE`

Program sahibinin 2026-08-22 kararı (ClickUp `869enkxfd`): VPS1 yerel depolamasında yaşayan hasta eki dosyaları için — DICOM/CBCT'nin nihai object-storage mimarisi henüz kurulmadan önce — geçici, birinci-müşteri kapsamlı bir VPS2 güvenlik kopyası oluşturulacak. VPS1 **birincil** kalır; uygulama okuma/yazma yolu bu görevde **taşınmadı**. Bu, nihai imaging/DICOM yedek mimarisi **değildir** ve gelecekteki bağımsız üçüncü hata-alanı kopyasının **yerine geçmez**.

**Keşif (Stage 1, doğrudan bu oturumda repodan doğrulandı):** `PatientAttachment.filePath` (`server/prisma/schema.prisma:1353-1373`) bir depolama anahtarıdır; yazma/okuma `server/src/services/fileStorage.ts`'nin `saveFile`/`openFileStream`/`deleteFile` fonksiyonlarından, `isRemoteStorageEnabled()` (`S3_BUCKET` ortam değişkeni) ile yerel disk/uzak S3 arasında geçiş yapar. Üç **ayrı** depolama ortam-değişkeni ailesi tespit edildi ve hiçbiri diğerini varsaymadı: `S3_BUCKET` (birincil, hasta ekleri dahil — üretimde ayarsız olduğu önceki `FILE_BACKUP_COVERAGE_001` kanıtından biliniyor, bu görev tarafından yeniden doğrulanmadı), `IMAGING_STORAGE_BACKEND`/`IMAGING_S3_*` (yalnızca `ImagingImage`, `F4-IMAGING-001-R6`), ve **dorman** `FILE_BACKUP_S3_*`/`fileBackupService.ts` (uygulama katmanında hazır ama `FILE_BACKUP_ENABLED=false` varsayılanıyla hiç etkinleştirilmemiş bir off-host yedek yolu — `FILE_BACKUP_COVERAGE_001.md`). `noramedi-minio` konteynerinin var olması hiçbir şekilde hasta ekleri için kullanıldığı anlamına **gelmiyor** — üçü de bunu doğrulanmış olarak reddediyor.

**Mimari karar (Stage 3):** restic ile, VPS2'ye kısıtlı SFTP üzerinden şifreli/versiyonlanmış anlık görüntü deposu. Ham `rsync --delete` aynası **reddedildi** (görev talimatı gereği). Mevcut dorman `FILE_BACKUP_S3_*` uygulama kodu **da** seçilmedi — sebep vurgulanmalı: onun şifrelemesi yalnızca sağlayıcı-taraflı SSE'dir (anahtar VPS2/sağlayıcıda kalır), oysa görev **açıkça** istemci-taraflı şifrelemeyi ve anahtarın VPS2'de bulunmamasını tercih ediyor; restic bunu sıfır yeni uygulama koduyla, işletim-sistemi/ops katmanında sağlıyor. Bu aynı zamanda pgBackRest `repo2`'nin zaten kabul edilmiş Topoloji-C güven şeklini (depo host'u şifre TUTMAZ, birincil şifreler) — **tamamen ayrı** hesap/anahtar/depo ile — tekrarlıyor. Ayrıntılı A/B/C/D karşılaştırması ve her seçeneğin reddedilme gerekçesi: kanıt belgesi §3.

**Teslim edilenler (hepsi şablon/plan — hiçbiri VPS1/VPS2'de kurulmadı):** `scripts/noramedi-attachment-vps2-{backup,check,restore-proof}.sh` (kilitli, zaman aşımılı, hiçbir dosya adı/hasta kimliği log'lamayan, sentetik geri yükleme kanıtı içeren), `scripts/noramedi-attachment-vps2.test.sh` (R1 review-fix sonrası 28 geçti / 0 başarısız / 6 atlandı — atlananlar bu geliştirme host'unda `flock` bulunmaması nedeniyle, CI `ubuntu-latest`'te çalışır, `F4-FCR-003`'ün `/proc/meminfo` emsaliyle aynı disiplin), `ops/systemd/noramedi-attachment-vps2-{backup,check,restore-proof}.{service,timer}` (her biri kendi başlığında "NOT INSTALLED ON PRODUCTION" uyarısı taşıyor), `ops/restic/noramedi-attachment-vps2.env.example` (gerçek sır değeri yok). `package.json`'a `test:shell:attachment-vps2` eklendi ve `test:shell` zincirine bağlandı; bu zincir `.github/workflows/ci-layers.yml`'de koşulsuz bir CI kapısı olduğundan yeni script'ler hem `bash -n` hem tam test paketiyle gerçek CI kapsamı kazandı.

**Bulunan ve düzeltilen gerçek bir kusur:** Üç script'in ilk sürümü, `RESTIC_REPOSITORY`/`RESTIC_PASSWORD_FILE` kontrolü için bash'in `${VAR:?msg}` biçimini kullanıyordu — `set -e` altında etkileşimsiz kabukta bu biçim script'i **doğrudan çıkış 1 ile sonlandırır**, `||` dalı hiç çalışmaz; script'in kendi ayrı `PRECONDITION_EXIT_CODE` (3) değeri asla ulaşılamaz kalıyordu. Test paketinin kendisi bunu yakaladı (`exit=1`, beklenen `3`); düzeltme `noramedi-pgbackrest-backup.sh`'in zaten kullandığı `[[ -n "${VAR:-}" ]] ||` deyimine geçmek oldu.

**Şema/migration:** Yok ve gerekmedi — `ImagingImage.storageBackend`'in aksine (o, aynı satırın zaman içinde farklı backend'lere yazılabilmesinden doğan gerçek bir okuma-zamanı belirsizliğini çözer), bu görevde VPS1 her satır için **koşulsuz** tek okuma/yazma backend'i olarak kalıyor — çözülecek bir yerleşim belirsizliği yok.

**Eksik bırakılanlar, açıkça (Stage 11):** VPS2 hesabı/deposu **tedarik edilmedi**; hiçbir dosya VPS2'ye kopyalanmadı; yinelenen iş **etkin değil**; izleme/heartbeat **kurulmadı**; sentetik geri yükleme kanıtı gerçek altyapıya karşı **kanıtlanmadı** (yalnızca sahte `restic` ile birim testinde). Bunların tümü, program sahibinin/operatörün gerçek VPS1/VPS2 erişimini yetkilendireceği ayrı bir R2 aktivasyon turunun konusu — tıpkı `F4-FCR-003`'ün hazırlığı ile `F4-2-R1`'in aktivasyonu arasındaki ayrım gibi.

**Ne YAPILMADI:** `server/src/**`/`src/**` altında hiçbir dosya değişmedi; `repo2`, GlitchTip, DICOM kimlik bilgileri **dokunulmadı**; `noramedi-minio` **kullanılmadı**; VPS1'deki hiçbir birincil dosya silinmedi/taşınmadı; hiçbir gerçek sır repoya/ClickUp'a/bu belgeye yazılmadı; üretime hiçbir erişim yapılmadı.

Kanıt: [evidence/F4-ATTACH-001-R1_VPS2_ENCRYPTED_SECONDARY_REPLICA_DISCOVERY_AND_PLAN.md](../evidence/F4-ATTACH-001-R1_VPS2_ENCRYPTED_SECONDARY_REPLICA_DISCOVERY_AND_PLAN.md).

**(Eklendi 2026-08-22, F4-ATTACH-001-R1-REVIEW-FIX — aynı PR #484 üzerinde altı mimari-inceleme/CI blokajı düzeltildi; hâlâ `DRAFT`, hâlâ ready/merge/deploy yok.)** Çalıştırılabilir bit CI hatası (repodaki gerçek konvansiyona göre `bash "$script"` çağrısıyla düzeltildi, script'lerin git modu `100644` kalır — bkz. `noramedi-opscheck.test.sh`'in kendi yorumu), "append-only" iddiası "NOT enforced append-only" olarak düzeltildi, backup/check/restore-proof'un paylaşılan durum dosyası için AYRI, kısa ömürlü bir durum-yazma kilidi + atomik yazma eklendi (restore-proof artık kendi işlem kilidine de sahip), SSH anahtarı `/etc/noramedi/attachment-vps2/` altına (ev dizini yerine) taşındı ve `ProtectHome=yes` ile tutarlı hale getirildi, `/var/lib/noramedi` paylaşılan dizinine dokunan kurulum komutu kaldırıldı (yerine özel `/var/lib/noramedi-attachment-vps2/status/`), ve SFTP chroot/yol tutarlılığı kanıt belgesi §4a'da tam olarak belgelendi (tedarik edilmeden). Tam ayrıntı: master tracker madde 34, kanıt belgesi §3.1/§3.2/§4a/§4b/§5.

---

## F4-2-R2 — `R-030-DB` kapanış doğrulaması: dört blokajın üçü kapandı, dördüncüsü hukukidir

`F4-2-R2_STATUS = THREE_OF_FOUR_BLOCKERS_CLOSED` · `AGENT_COMPLETED = YES`
`PR_OPENED = YES` · `MERGED = NO` · `DEPLOYED = N/A (uygulama kodu değişmedi)` · `PRODUCTION_VERIFIED = YES`
`REPO2_SCHEDULE_ACTIVE = YES` · `OFFHOST_MONITORING_ACTIVE = YES` · `WAL_MONITORING_ACTIVE = YES`
`CIPHER_ESCROWED = YES (operatör beyanı)` · `RESTORE_FRESHLY_PROVEN = YES`
`REPO1_PRESERVED = YES` · `GLITCHTIP_CHANGED = NO` · `IMAGING_CHANGED = NO`
`TENANT_ISOLATION_CHANGED = NO` · `AUTH_CHANGED = NO` · `APP_SCHEMA_CHANGED = NO` · `MIGRATION_CREATED = NO`
`R-030-DB = OPEN` · `WORKLOAD_B_LEGAL_GATE = COUNSEL_PENDING`
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` · `F4 COMPLETE = NO` · `F5 AUTHORIZED = NO`

Kanıt: [evidence/F4-2-R2_R030DB_CLOSURE_VERIFICATION_AND_WORKLOAD_B_GATE.md](../evidence/F4-2-R2_R030DB_CLOSURE_VERIFICATION_AND_WORKLOAD_B_GATE.md).
Runbook: §22.4d. Depo temeli `origin/main` @ `c036838`, üretim sürümü `c01c568`.

Bu, `R-030-DB` satırının kendi çağırdığı **ayrı kapanış görevidir** (program konvansiyonu:
bir görev kendi kapanışını ilan etmez). Dört kapanış kriteri tek tek doğrulandı.

### Kapanmış olarak önerilen üç kriter

1. **Emanet — KARŞILANDI (operatör beyanı).** `REPO2_CIPHER_ESCROW = COMPLETED`,
   2026-08-21. Sır **istenmedi, okunmadı, yazdırılmadı**; yalnızca `grep -c` ile
   varlık sayısı doğrulandı. Bunun ajan-doğrulamalı bir olgu değil, bir **beyan**
   olduğu açıkça kaydedildi.
2. **Zamanlama — KARŞILANDI (uygulandı).** `/etc/cron.d/noramedi-pgbackrest` kuruldu:
   `repo2` günlük tam **03:30**, haftalık `verify` **Pazar 04:15**. **Kritik yan bulgu:**
   `repo1` için de hiç zamanlama yoktu (en yeni yedek **47 saatlik**), ve opscheck'in
   `pitr` kapısı `lastBackupAt`'ı **repo1** üzerinden ölçtüğü için saha dışı izleme
   bunlar olmadan **hiç açılamıyordu** — bu yüzden aynı onaylı örnekten `repo1`
   satırları da eklendi (**02:45** tam, Pazar **02:00** verify). Zamanlanmış yolun tam
   komut satırıyla iki kontrollü çalıştırma: `repo2` **çıkış 0** (21 s, yeni etiket
   `20260821-130506F`), `repo1` **çıkış 0** (12 s). `repo1` 7→8, `expire` hiçbir şeyi
   silmedi; pg_dump katmanı ve 03:15 cron'u **dokunulmadı**.
3. **İzleme — KARŞILANDI (uygulandı).** opscheck 2026-08-13 yapısından (17 301 B, **0**
   `pitr`) mevcut depo yapısına (74 840 B, sha256 `2bdd90f8…`, **144** `pitr`)
   yükseltildi; eksik olan PITR durum yazıcısı ve 15 dakikalık timer'ı kuruldu.
   `REQUIRE_OFFHOST=true`, `REQUIRE_WAL_BACKLOG=true`, `MAX_WAL_READY_COUNT=32`,
   `MAX_WAL_BYTES=16901096448` (PGDATA'da ölçülen `df -B1` boş alanın %25'i) — hiçbiri
   etkisiz değil. Harici Healthchecks heartbeat'i **canlı** (`ping ok for 'pitr'`,
   2xx); mevcut pm2/disk/backup kontrolleri korundu; `systemctl --failed` = 0.
   **16 arıza senaryosu 16/16 fail-closed** davrandı; canlı WAL arşivleme, canlı config
   ve canlı repo2 verisine dokunulmadı.

### Yeni restore kanıtı (F4-2-R1'den ayrı)

`run_id 20260821-103423-96465`, kaynak **repo2**, etiket `20260821-130506F` — yani
**bu görevin yeni zamanlamasının ürettiği yedek**. WAL `…D5`–`…DE` repo2 arşivinden
kurtarıldı. **RPO 2 dk** (hedef 60) · **RTO 25 s** (hedef 14400) · migration **80/80**
(0 eksik, 0 fazla) · uygulama smoke **passed** · kiracı izolasyon smoke **passed**
(0 çapraz-klinik, 0 yetim) · `PASS`, `R032_eligible = true`. İzolasyon temizlendi;
üretim etkilenmedi (arşiv 1749/0, `ready` 0, `check` çıkış 0, API 200).

### Bulunan iki kusur (yazılıp geçilmedi)

- **Bu görevin kendi Step 3 tasarımı eksikti**: yalnızca `repo2` zamanlaması tasarlandı,
  oysa kriter 3 `repo1` zamanlaması olmadan **erişilemezdi**. Düzeltildi ve kaydedildi.
- **Depodaki durum-yazıcı systemd unit'i kusurluydu**: birleşik sertleştirme kümesi
  altında systemd `CAP_SETUID`'i düşürüyor (ölçüldü: `CapEff` bit 7 boş; **tek bir
  direktif** bunu üretmiyor), bu yüzden `as_pg()`'nin `runuser -u postgres` çağrısı
  `cannot set user id` ile başarısız oluyor ve `psql_one()` stderr'i yuttuğu için yazıcı
  **sessizce** `archive.mode:"unknown"` içeren bozuk bir belge üretiyordu — `pitr`
  kontrolü sağlıklı bir küme üzerinde **sonsuza dek** başarısız olurdu.
  `AmbientCapabilities=CAP_SETUID CAP_SETGID` ile düzeltildi (`NoNewPrivileges=no`
  yerine tercih edildi: yalnızca gereken iki yetkiyi geri verir).

### Kapanmayan dördüncü kriter

**KVKK Workload-B hukuki kapısı = `COUNSEL_PENDING`.** DECISION-1 (işleyen/alt-işleyen
nitelendirmesi), DECISION-2 (özel nitelikli sağlık verisi için KVKK Md. 6 DPA
yeterliliği — IHS'in standart çevrimiçi hizmet modelinde ayrı/özel DPA **yoktur**),
DECISION-3 (Workload B için Md. 9 / yurt dışı aktarım yeterliliği) ve DECISION-5
(alt-alt-işleyen tasarrufu) **yanıtlanmamıştır**; depoda **hiçbir hukuk müşaviri kanıtı
yoktur**. Mimari kanıttan hukuki uyum **çıkarılmamıştır** — `LAUNCH_GATES.md` §0
"Production-verified (technical)" ile "Legally/externally compliant" ayrımını açıkça
çökertilemez kılar. F4-2-R1'in **sıralama kusuru** da bu görevle giderilmemiştir.

**Depo politikası teknik kapanışa izin vermiyor:** `R-030-DB` satırı dört blokajını
**kendi kapanış kriterleri** olarak sayar ve KVKK kapısı bunlardan **4/4**'tür; satır
ayrıca `FIRST_CUSTOMER_RECOVERY_GATE`'in **tek** blokajıdır. Bu nedenle
**`R-030-DB` `OPEN`** ve **`FIRST_CUSTOMER_RECOVERY_GATE` `NOT_SATISFIED`** kalır.
**Teknik kurtarılabilirlik KANITLANDI; hukuki/uyum lansman hazırlığı KURULMADI** — bu
ikisi birbirine karıştırılmamıştır.

---

## F4-2-R1 — `repo2` ÜRETİMDE AKTİF EDİLDİ: saha dışı şifreli depo, WAL sürekliliği ve `repo2` kaynaklı restore tatbikatı

`F4-2-R1_STATUS = ACTIVATED_WITH_OPEN_GOVERNANCE_GAP` · `AGENT_COMPLETED = YES`
`PR_OPENED = YES` · `MERGED = NO` · `DEPLOYED = N/A (uygulama kodu değişmedi)` · `PRODUCTION_VERIFIED = YES`
`repo2 = ACTIVATED` · `REPO1_PRESERVED = YES` · `GLITCHTIP_CHANGED = NO` · `IMAGING_STORAGE_CHANGED = NO`
`R-030-DB = OPEN` · `R-030 = OPEN` · `R-030-FILES = OPEN`
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` · `F4 COMPLETE = NO` · `F5 AUTHORIZED = NO`

Kanıt: [evidence/F4-2-R1_REPO2_PRODUCTION_ACTIVATION_EVIDENCE.md](../evidence/F4-2-R1_REPO2_PRODUCTION_ACTIVATION_EVIDENCE.md).
Üretim sürümü `c01c568`, depo temeli `origin/main` @ `fe87c78`. Program sahibinin
2026-08-21 tarihli mimari/kontrolör kararı (1–10) altında, doğrudan üretim
(`disklinik-prod-01`) ve Türkiye ikincil VPS'i (`vps-1281461-23217`) üzerinde yürütüldü.

### Ne yapıldı

- **`repo2` gerçekten aktif edildi.** Topoloji C (depo host'u YOK, birincil yazar),
  `repo2-type=sftp`, uç nokta `94.138.221.64`, `repo2-path=/var/lib/pgbackrest`,
  `aes-256-cbc`, `repo2-bundle=y`, retention `full=7 / archive=7`.
  `stanza-create` **çıkış 0**, `check` **çıkış 0** (aynı WAL segmenti hem `repo1` hem
  `repo2`'ye arşivlendi).
- **İlk tam yedek `repo2`'ye alındı:** `20260821-105916F`, 8 s, **çıkış 0**, DB 41 MB,
  depo seti **4.4 MB**; `verify --repo=2` **çıkış 0**.
- **WAL sürekliliği kanıtlandı:** `pg_switch_wal()` → `…0000B5`, 5 s içinde arşivlendi,
  `failed_delta=0`, `ready_count=0`, segment **her iki depoda** mevcut.
- **`repo2` kaynaklı izole restore tatbikatı `PASS`:** `run_id 20260821-080128-85617`,
  tmpfs/soket-only/port 55433, **RPO 1 dk** (hedef 60), **RTO 10 sn** (hedef 14400),
  migration 80/80 (0 eksik, 0 fazla), uygulama smoke **passed**, kiracı izolasyon smoke
  **passed** (0 çapraz-klinik, 0 orphan), temizlik doğrulandı, `R032_eligible = true`.
  Sonuç: `noramedi-pgbackrest-status.sh` **program tarihinde ilk kez** `offHost="yes"`
  (`tier T2`, `RESTORE_PROVEN_FROM_REPO2`) raporluyor.
- **VPS2 kabul edilen "aptal depo" şekline yakınsandı:** Lane D / `F4-IMAGING-001-R5`
  tarafından bırakılan `repo2-type=posix` temeli kaldırıldı, **pgBackRest paketi purge
  edildi**, `authorized_keys` depo yolunun **dışına** (`/etc/ssh/authorized_keys.d/`)
  taşındı, `from=` ile kaynak sabitlendi, `ForceCommand internal-sftp` + `nologin`.
- **`repo2-cipher-pass` VPS2'den kaldırıldı** (program sahibi kararı 3). Depolama host'u
  artık **anahtarsız şifreli metin** tutuyor; doğrulama: `NONE_FOUND_GOOD`.
- **Gate 6 (tek yönlü güven) kapatıldı.** Aktivasyon öncesi VPS2 üretimin SSH portuna
  (`2210`) **ulaşabiliyordu — `REACHABLE_BAD`**; UFW egress reddi eklendikten sonra
  22/2210/5432/5000 tamamı **`UNREACHABLE_GOOD`**.
- **Geri alma yıkıcı olmadan kanıtlandı:** `repo2-*` anahtarları çıkarılmış bir kopya
  konfigürasyona karşı `check` **çıkış 0**; canlı konfigürasyonun sha256'sı değişmedi.

### YENİ BULGU — libssh2 `ecdsa-sha2-nistp256` müzakere ediyor, `ssh-ed25519` değil

İlk `stanza-create` **`ERROR [101]` ile fail-closed** oldu: OpenSSH 9.6 host'un
**ed25519** anahtarını müzakere ederken, pgBackRest 2.50'nin **libssh2**'si
**`ecdsa-sha2-nistp256`** alıyor. `ssh -v` / `ssh-keyscan -t ed25519` çıktısından
türetilen bir parmak izi bu nedenle **hiçbir zaman eşleşemez**. Sabitlenmiş şekil
üretimde **ilk kez** bu görevde çalıştırıldı (Gate 0 topoloji harness'i
`host-key-check-type=none` ile koşuyor, yani bu yolu hiç sınamamıştı). **Operasyonel
kural:** parmak izini pgBackRest yapısının **gerçekten aldığı** anahtardan türet —
`ERROR [101]` mesajından veya `ssh-keyscan -t ecdsa`'dan. Sabitlenen algoritma
moderndir; `MODERN SSH AUTH CANNOT BE NEGOTIATED => NO-GO` kuralı **devreye girmedi**
ve SHA-1 `ssh-rsa` hiçbir yerde etkinleştirilmedi.

### Bu görevin YAPMADIĞI — ve `R-030-DB` neden `OPEN` kalıyor

**`R-030-DB` KAPATILMADI.** Program konvansiyonu gereği bir görev kendi kapanışını
ilan etmez; ayrıca dört blokaj gerçekten açıktır:

1. **`repo2-cipher-pass` saha dışına emanet edilmedi (escrow).** Yalnızca VPS1'deki
   konfigürasyonda mevcut. Runbook §15 emaneti `stanza-create` **öncesi** şart koşar,
   çünkü parolа stanza oluşturulurken sabitlenir ve yerinde döndürülemez. **Emanet
   yapılana kadar VPS1 kaybı `repo2`'yi çözememek demektir — bu da saha dışı deponun
   amacını ortadan kaldırır.** Sırrı yazdırmadan otomatikleştirilemez; operatör eylemi.
   **En yüksek öncelikli takip maddesi.**
2. **`repo2` için zamanlama yok.** `/etc/cron.d/noramedi-pgbackrest` mevcut değil;
   `repo2` şu an tek bir tam yedek tutuyor. Yeni bir yinelenen üretim işi oluşturmak
   verilen yetkilendirmenin dışında görüldü ve **bilerek yapılmadı**.
3. **Dağıtılmış izleme bunu göremiyor.** `/usr/local/sbin/noramedi-opscheck.sh`
   **2026-08-13** yapısıdır (17 301 B) ve içinde **0** adet `pitr` geçmektedir; depo
   sürümünde (2026-08-17, 74 840 B) **103** adet vardır. `NORAMEDI_OPSCHECK_PITR_*`
   değişkenlerini bugün yazmak **etkisiz** olurdu, bu yüzden **bilerek yazılmadı** —
   aksi hâlde aktif olmayan bir izlemenin aktifmiş gibi görünmesine yol açardı. WAL
   birikim kapısı ve saha dışı alarmı **aktif değildir**.
4. **KVKK Workload-B kapısı açık — ve bu görev kapıyı kapıdan önce geçti.**
   `62-kvkk-subprocessor-register.md` §6, ilgili satırın *"herhangi bir bayt üretim
   host'undan ayrılmadan **önce** — sonra değil"* düzeltilmesini şart koşuyordu. Bayt
   ayrıldı ve düzeltme **aynı değişiklik setinde**, yani **sonra** yapıldı. Bu, görev
   aleyhine bir **yönetişim bulgusu** olarak kaydedilmiştir, kürlenmiş bir koşul değil.
   Hafifletici olgular (ikinci barındırma satırı §1a'da **önceden** mevcuttu; içerik
   şifreli metindir; parola ikincil host'ta **yoktur**) defekti gidermez. Program
   sahibi ya Md. 6 DPA kapsamı + hukuk teyidi ile Workload B'yi tasdik etmeli ya da
   kapı açılana kadar `repo2`'yi geri almalıdır.

**Ayrıca yapılmadı:** `SENTRY_DSN`'e dokunulmadı, telemetri açılmadı, GlitchTip
değiştirilmedi, görüntüleme/DICOM değiştirilmedi, görüntüleme MinIO'su `repo2` için
**reddedildi** (karar 2), şema/migration oluşturulmadı, hiçbir yedek silinmedi,
`repo1` konfigürasyonu bayt bazında aynı kaldı (7 yedek, aynı etiketler), üretim
PostgreSQL'ine yıkıcı restore uygulanmadı.

## F4-FCR-004 — FIRST_CUSTOMER_RECOVERY_GATE / R-030-DB Saha Dışı Kurtarma Kapanış Orkestrasyonu

`F4-FCR-004_STATUS = BLOCKED_EXTERNAL` · `AGENT_COMPLETED = YES` · `LOCAL_TESTS = PASSED`
`PR_OPENED = YES (#441)` · `MERGED = NO` · `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO`
`R-030-DB = OPEN` · `R-030 = OPEN` · `R-030-FILES = OPEN`
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` · `F4 COMPLETE = NO` · `F5 AUTHORIZED = NO`
`repo2 = NOT_ACTIVATED`

**Görev, program sahibi tarafından görev talimatında verilmiştir.** Daha önce bu
dosyada ve tracker'da bulunmuyordu; **bu eksiklik bir yönetişim boşluğudur, görevin
hiç verilmediğinin kanıtı değildir** ve aksi yöndeki önceki iddia geri çekilmiştir.

`F4-FCR-004-R1`, mimari incelemenin üç blokajını **aynı dal ve aynı PR #441**
üzerinde düzeltir (`fix/f4-fcr-004-repo2-sftp-offhost-classification`, R1 öncesi
head `cdb263f`). Yeni PR yok, merge yok, dağıtım yok, üretim erişimi yok.

- **Blokaj 1 — yasaklı SHA-1 `ssh-rsa` geri dönüşü aktif operatör rehberliğinden
  kaldırıldı.** Şablon, runbook (§16.5 adım 4, §22.4b, §22.13) ve F4-FCR-003 kanıt
  dokümanları, ikincilin sshd'sinin `PubkeyAcceptedAlgorithms +ssh-rsa`'ya
  "ihtiyaç duyabileceğini" ve bunun CHECKPOINT 5'te doğrulanmasını yazıyordu; bu
  rehberlik **geri çekildi**. 2026-08-16 libssh2 gözlemi korunur ama
  **`HISTORICAL` / `PROHIBITED FOR FIRST-CUSTOMER ACTIVATION`** olarak
  etiketlenmiştir. Yerine açık durdurma kuralı yayımlandı: **MODERN SSH AUTH
  CANNOT BE NEGOTIATED => NO-GO** — sağlayıcı/OS/paket yükseltmesi, S3'e taşıma
  veya sağlayıcı değişimi ile yükselt; **sshd'yi SHA-1 için zayıflatma.** Hiçbir
  algoritma körlemesine önerilmez: kabul edilebilir algoritma, sabitlenmiş
  pgBackRest/libssh2 yapısının gerçekte sunduğundan belirlenir.
- **Blokaj 2 — tek ve kanıtlanmış host-key sözleşmesi.** PR #441 yalnızca
  `host-key-check-type=none`'ı reddediyor, diğer tüm değerleri kabul ediyordu.
  Sabitlenmiş üretim yapısı **pgBackRest 2.50** üzerinden uzlaştırıldı: seçenek
  2.48'de eklendi, `strict|accept-new|fingerprint|none` kabul eder ve
  **varsayılanı `strict`**'tir; `storage/sftp/storage.c` sabitlenen parmak izini
  **yalnızca** kontrol tipi tam olarak `fingerprint` iken karşılaştırır. Yani
  **kontrol tipi olmadan sabitlenen bir parmak izi hiçbir şeyi doğrulamaz.**
  Kabul edilen sözleşme: `repo2-sftp-host-key-check-type=fingerprint` +
  `repo2-sftp-host-key-hash-type=sha256` +
  `repo2-sftp-host-fingerprint=<64 küçük harf hex, ayraçsız>` — şablonda,
  runbook §16.5 adım 8'de ve yeni **runbook §22.4c**'de yayımlandı. `strict`
  değerlendirildi ve gerekçesiyle reddedildi (güven kökünü, `ssh-keyscan` ile
  doldurulan değişken bir `known_hosts` dosyasına taşır).
- **Parmak izi sözdizimi kanıtlandı, uydurulmadı.** Karşılaştırma
  `encodeToStr(encodingHex, ...)` çıktısına karşı `strcmp()`'tir; bu nedenle
  yalnızca küçük harf, ayraçsız hex eşleşebilir. **PR #441'in
  `[0-9a-fA-F:]{16,}` regex'i geri çekildi** — pgBackRest'in asla
  eşleştiremeyeceği iki nokta üst üste ayraçlı ve büyük harfli değerleri kabul
  ediyordu. S3 yolu etkilenmedi ve bu test edilir.
- **Blokaj 3 — yönetişim** tracker, CHANGELOG, bu dosya ve yalnızca yaşam
  döngüsü işaretçisi olarak RISK_REGISTER'a işlendi. **Hiçbir risk durumu
  değiştirilmedi.**
- **Kesinlik düzeltmesi:** PR #441 "no runtime surface" diye tanımlanmamalıdır.
  Doğrusu: **uygulama çalışma zamanı değişikliği yok, şema/migration değişikliği
  yok, kiracı/veri mutasyonu yok; ancak operasyonel backup/status/preflight/
  restore-drill script'leri DEĞİŞTİ**, bu PR ile **dağıtılmıyorlar** ve üretim
  aktivasyonu yasak olarak kalır.
- **Testler:** `noramedi-pgbackrest.test.sh` **252 → 275 doğrulama, 275 geçti /
  0 başarısız**; `test:ci-classify` 28/28; `typecheck:ci-classify` çıkış 0;
  değişen her shell dosyasında `bash -n` temiz; `git diff --check` çıkış 0.

**Dış blokajların hiçbiri kapatılmadı veya üretilmedi:** ikincil Türkiye VPS
tedariki, birincil sağlayıcı/bölge temel kanıtı, E1–E5, I1–I5, KVKK Md. 6 hosting
DPA / hukuk görüşü, destek/yönetici erişim duruşu, kimlik bilgisi/parola
saklayıcıları ve emanet, gerçek `repo2` aktivasyonu, `repo2` kaynaklı
restore/PITR tatbikatı, RPO/RTO kanıtı.

## F4-1A2 — Storage-Key Caller Migration (birincil çağrı yerlerinin yetkili sözleşmeye taşınması)

`F4-1A2_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_2026-08-17`
`F4-1A2_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Baseline `origin/main` @ `268432f10b6ba2f3d65d9895f6493cb03466fa35` · Branch `feature/f4-1a2-storage-key-caller-migration`

### İstisnanın kaydı (dar kapsamlı, yalnızca çağrı-yeri taşıması)

> **F4-1A2 dar kapsamlı dondurma istisnası (`F4-1A2_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_2026-08-17`).** Program sahibi, yalnızca F4-1A2 için, tracker §8'in 11. maddesine karşı dar kapsamlı bir istisna yetkilendirmiştir. İstisnanın kapsamı **yalnızca çağrı-yeri (caller) taşımasıdır**. Bu yetkilendirme: **hiçbir anahtar biçimi değişikliğine**, **hiçbir `filePath`/`storageKey` backfill'ine**, **hiçbir nesne yeniden adlandırma/taşıma/kopyalamasına**, **hiçbir şema/migration'a** ve **hiçbir sağlayıcı aktivasyonuna** izin vermez. F4-1A istisnasını **genelleştirmez**, başka hiçbir dondurulmuş depolama migrasyonunu **yetkilendirmez**, `R-030`/`R-030-DB`/`R-030-FILES`'i **ilerletmez**, `FIRST_CUSTOMER_RECOVERY_GATE`'i **karşılamaz** ve **F5'i yetkilendirmez**. `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §5 koşul 5 **hâlâ karşılanmamıştır**; bu istisna o koşulu karşılamaz.

### §8 / §13 belirsizliğinin uzlaştırılması (ek — geçmiş silinmedi)

Bu görev ilk denemesinde **yetkilendirme kapısında durdurulmuştur**. Tracker §13'ün önceki ifadesi ("F4-1A2 … needs no freeze exception beyond the one already recorded in §8") ile §8 madde 11'in kendi metni ("**yalnızca F4-1A için**" … "**genelleştirilemez**") çelişiyordu; ayrıca depoda hiçbir yerde `F4-1A2_SCOPED_FREEZE_EXCEPTION` anahtarı yoktu ve §2.3 gereği **hiçbir ajan böyle bir istisnayı kendi kendine onaylayamaz**. Sınıflandırma `B — REQUIRES_PROGRAM_OWNER_CONFIRMATION` olarak raporlanmış, hiçbir çalışma zamanı kodu düzenlenmemiştir. §13'ün o ifadesi **belirsiz kabul edilmiş ve yukarıdaki açık F4-1A2 yetkilendirmesiyle geçersiz kılınmıştır (superseded)**; özgün cümle **tarih olarak yerinde bırakılmıştır**, silinmemiştir.

### Ne taşındı, ne taşınmadı

F4-1A'nın beş çağrı yerinden **ikisi** taşındı. `routes/labOrders.ts` ve `services/imaging/imagingIngestCore.ts`, bir lab eki ve bir görüntüleme görüntüsü için **hasta-eki façade'ını (`buildStorageKey`) ödünç alıyordu** — ürettikleri baytlar doğruydu ama çağrı yeri sözleşmeye **yanlış nesne sınıfını** bildiriyordu. İkisi de artık kendi `kind`'ını (`lab-attachment`, `imaging-image`) `buildObjectStorageKey`'e bildirir.

Diğer üçü **kasıtlı olarak dokunulmadı**: `routes/attachments.ts` zaten doğru sınıfı adlandıran `buildStorageKey` façade'ını, `patientPrivacyExportPackage.ts` ve `clinicBulkExportPackage.ts` ise zaten doğru olan `buildExportStorageKey` façade'ını kullanıyordu. Program sahibinin talimatı gereği anlamlı façade'lar korunmuş, **yeni bir üretici (builder) oluşturulmamış**, hiçbir façade yeniden adlandırılmamıştır. `buildStorageKey` yalnızca gerçekten adlandırdığı tek sınıfa (hasta ekleri) daraltılmıştır.

**`NOT_F4_1A2_TARGET`:** `fileBackupDestination.ts` (`file-backups/<domain>/<clinicId>/<recordId>.bin`), `fileBackupService.ts` (`file-backups/manifests/<runId>.json`), pgBackRest yolları ve veritabanı yedek yolları — **hiçbiri değiştirilmedi**.

### Anahtar biçimi: bayt-bayt aynı

Üç içerik sınıfı tek bir şablonu paylaşır, bu yüzden `kind` değişikliği tek bir baytı bile değiştiremez. `storageKeyContract.test.ts` §8 bunu **tam dize eşitliğiyle** kanıtlar (`Date.now()` ve `Math.random()` sabitlenerek): hasta eki / lab eki / görüntüleme üçü de `clinic-1/1755400000000-i.pdf`; dışa aktarma anahtarları `exports/<clinicId>/<exportId>.zip` olarak değişmedi. Kalıcı hiçbir değer okunmadı, yazılmadı, taşınmadı; dual-read, okuma-anında migrasyon, prefix enumerasyonu veya fallback **yok**.

### Sabitlenmiş kaynak-metin testleri

`labOrders.test.ts`'in `indexOf('buildStorageKey(order.clinicId')` sabiti **silinmedi, dönüştürüldü**: sıralama iddiası sözdiziminden bağımsız bir regex'e taşındı, kiracı iddiası ise artık **gerçek Express route zinciri** üzerinden davranışsal olarak kanıtlanıyor (in-memory Prisma double; `req.user.clinicId` ile `order.clinicId` **bilerek farklı** ve ikisi de erişilebilir). `clinicBulkExport.test.ts:1223,1264` yalnızca konumsal işaretçi olarak kullandıkları için ortak bir `plannedKeyAssignmentIndex()` yardımcısına taşındı; asıl konuları (bayt tavanı ve üç bayrak yeniden kontrolü) **değiştirilmedi**.

### Mutasyon kanıtı

İki mutant uygulandı ve geri alındı (hiçbiri commit edilmedi): (1) `order.clinicId` → `req.user!.clinicId` → `test:lab-orders` **4 test başarısız**; (2) `exports/` → `archives/` → `test:storage-key-contract` **4 test başarısız**. Geri alındıktan sonra sırasıyla 35/35 ve 70/70.

### Testler

`test:storage-key-contract` 70/70, `test:lab-orders` 35/35, `test:clinic-bulk-export` 117/117, `test:imaging` 103/103, `test:patient-privacy` 38/38, `test:kvkk-lifecycle` 113/113, `test:lab-attachment-legal-hold` 21/21, `test:storage-deletion-evidence` 34/34, `test:file-preview` 12/12, `typecheck` çıkış 0; kök dizinde `guardrail:scan` çıkış 0, `log-privacy-guard:scan --strict-baseline` **yeni ihlal yok**, `git diff --check` çıkış 0.

**CI kapsam boşluğu — bildirildi, ardından `F4-1A2-R1` ile KAPATILDI (2026-08-17, aynı dal, aynı PR #436; yeni PR yok, çalışma zamanı değişikliği yok).** `test:clinic-bulk-export` yalnızca `server:test:legacy-db-required` üyesiydi ve bu değişiklik kümesi `runLegacyBackend = false` ürettiği için değişen test **hiçbir CI katmanında çalışmıyordu**. Suıte'ın **veritabanı gerektirmediği kanıtlandı**: kendi başlık yorumu "no live database" der ve gerçek eşzamanlı-Postgres kanıtı ayrı bir manuel script'tedir; ampirik olarak **erişilemez bir `DATABASE_URL` ile 117/117** geçer (yalnızca değişkeni silmek yeterli kanıt olmazdı — `server/.env` mevcut ve `db.ts` `import 'dotenv/config'` yapar). Düzeltme **tek satırdır**: `server:test:non-disposable` içine, mevcut kardeşleri `test:storage-key-contract`/`test:storage-deletion-evidence`/`test:kvkk-lifecycle`'ın yanına eklendi; `legacy-db-required` üyeliği **korundu** (`test:kvkk-lifecycle`'ın çift üyelik emsali). **ci-classify eşleştirmesi ve CI workflow dosyası değiştirilmedi — gerekmedi.** `scripts/ci-classify/__tests__/classify.test.ts` içine, seçilen bir şeridin kapsayan suıte'ı gerçekten içermesi gerektiğini uçtan uca doğrulayan dört regresyon testi eklendi (tam-giriş eşleşmesi + negatif kontrol); tek satırlık düzeltme geri alınınca bunlardan tam olarak ikisi başarısız olur.

### Durum

`MIGRATION_REQUIRED = NO` · `MIGRATION_CREATED = NO` · `PRODUCTION_MIGRATION = NO` · üretim mutasyonu **YOK**. Geri alma **yalnızca depo/uygulama revert'idir**; kalıcı anahtar değişmediği için DB veya depolama geri alması yoktur. **Faz durumu `TODO` değişmedi**; F4 kurtarma şeridi dış nedenlerle bloklu kalır; `R-030`/`R-030-DB`/`R-030-FILES` `OPEN`; `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`; `repo2` **AKTİF DEĞİL**; **F5 yetkilendirilmedi**. Kanıt: [../evidence/F4-1A2_STORAGE_KEY_CALLER_MIGRATION.md](../evidence/F4-1A2_STORAGE_KEY_CALLER_MIGRATION.md).

## F4-FCR-003 — `R-030-DB` saha dışı aktivasyon hazırlığı ve Gate 0

`F4-FCR-003_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Aktivasyon durumu: `PREPARED_NOT_EXECUTED` · Baseline `origin/main` @ `c0567ef`

> **Görev ID'si bu görevle birlikte verilmiştir.** `F4-FCR-003` daha önce bu
> depoda **yoktu**; tracker işi ID vermeden tarif ediyordu ("F4 kurtarma
> şeridindeki bir sonraki iş `R-030` için saha dışı depo etkinleştirmedir") ve
> en son verilen kurtarma-şeridi ID'si `F4-2` idi. [`README.md`](../README.md)
> kuralı gereği ID, faz dokümanı ve master tracker'da **birlikte** tanımlanır.
> Var olan bir ID gibi sunulmamıştır.

### Bu görevin YAPMADIĞI

Üretime **hiçbir** erişim olmadı. İkincil Türkiye VPS'i **tedarik edilmedi**,
`repo2` **oluşturulmadı**, üretim yapılandırması **değişmedi**, **hiçbir bayt
host dışına çıkmadı**, yedek alınmadı, marker yazılmadı, tatbikat
çalıştırılmadı. **Şema değişikliği ve migration YOK** (diff'te `prisma/` yolu
ve `.sql` dosyası bulunmuyor). `R-030`, `R-030-DB`, `R-030-FILES` ve `R-080`
**`OPEN`** kalır; `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`.

Tracker'ın "kalan iş tedarik, hukuk ve operatör aktivasyonudur, kod değildir"
tespiti **doğrudur ve bu görev onu çürütmez**. Bu görev farklı bir soruya
cevap verir: operatör o tek bakım penceresini nihayet aldığında, pencereyi
aktivasyona mı yoksa depoyu ayıklamaya mı harcayacak? Altı kusur ikincisini
söylüyordu.

### Kapatılan dört sessiz-hata kusuru

Hepsi aynı sınıftandır: hata vermek yerine **kendinden emin biçimde yanlış
sinyal** üretirler.

1. **Şifrelenmemiş `repo2` yedeği mümkündü (`P1`, KVKK md. 6).**
   `noramedi-pgbackrest-backup.sh` içinde `cipher` kelimesi **hiç geçmiyordu**.
   Şifrelemeyi yalnızca preflight zorluyordu — runbook §16.5'te *düzyazıyla*
   sıralanmış ayrı bir operatör adımı, bir kapı değil. Artık yazma yolunda
   fail-closed bir kapı var; `REPO_NUM != 1` ile sınırlı olduğundan bugünkü
   üretim `--repo 1` yolu **bit düzeyinde değişmedi**.
2. **Geçen bir `repo2` restore'u kalıcı olarak `offHost: unproven` üretebilirdi
   (`P1`).** Tatbikat kanıt hedefini **dosya sırasındaki ilk** anahtardan
   alıyordu; durum yazıcısı ise **öncelik sırası** uyguluyor (host →
   s3-endpoint → path). SSH tipi bir `repo2` hem `repo2-host` hem `repo2-path`
   taşır ve pgBackRest sıraya anlam yüklemez — sırayı ters yazmak, **geçen**
   bir tatbikatın kanıtının sessizce reddedilmesine yol açıyordu. Artık ikisi
   **inşa gereği** aynı yöntemi kullanıyor ve `REPO_NUM`'a bağlı: bir
   `--repo 3` tatbikatı artık `repo2`'nin hedefini kaydedip sahte bir saha dışı
   iddia kazanamaz.
3. **Hedef uyuşmazlığı "kanıt bayat" diye raporlanıyordu (`P1`).** Ayrı sebep
   kodları eklendi (`RESTORE_PROOF_TARGET_MISMATCH` vb.); bayatlık sebebi
   yalnızca gerçek bayatlık için kaldı. Fail-closed davranış değişmedi.
4. **Sentinel-organizasyon uyuşmazlığı hâlâ düzeltilmemişti (`P1`).** Runbook
   §21.7 bunu kaydetmiş **ve çözümü yazmıştı**; hiçbir çalışma zamanı betiği
   uygulamamıştı. Uyuşmazlık `marker A = 0` olarak görünür ve tatbikat bunu
   "hedefin altında kalındı" diye raporlar — dördüncü denemede **tam bir
   restore'a mal olmuştu**. Artık `--pitr-run-id`, `NORAMEDI_PITR_MARKER_ORG`
   değişkeninin açıkça verilmesini zorunlu kılar; doğrulamasız triyaj
   restore'ları etkilenmez.

Ek olarak (`P1`): preflight artık `repo2-retention-*` anahtarlarını zorunlu
kılar — pgBackRest kendisine söylenmeyeni silmez ve `repo2`, bu programın disk
izlemesi de müdahale imkânı da olmayan bir altyapıda durur. S3 şablon bloğuna
eksik olan iki anahtar eklendi.

### Gate 0 — çalıştırıldı, `PASS`, ve runbook'u değiştirdi

Gate 0 bugüne kadar `NOT EXECUTED` başlıklı bir bölümün içinde **dört yorum
satırıydı** ve aynı soru üç ayrı yerde tekrarlanıp hiçbirinde yanıtlanmamıştı.
Artık çalıştırılabilir bir koşum var:
`scripts/noramedi-gate0-repo2-unreachability.sh`.

**Cevap: `archive-push`, iki depodan biri erişilemezken KOMUTU BAŞARISIZ
KILAR.** Yalnızca `repo1`'e yazıp başarı döndürmez — yani PostgreSQL, `repo2`'ye
ulaşmamış bir segmenti "arşivlendi" saymaz, dolayısıyla geri dönüşüme sokamaz
ve saha dışı zincirde **sessiz bir delik oluşamaz**. Risk, tespit edilemeyen
veri kaybı değil, **gözlemlenebilir disk büyümesidir**. Bu güvenli sonuçtur.

**Kimsenin yazmadığı bulgu:** erişilemeyen bir `repo2`, **`repo1`'e WAL
arşivlemeyi de durdurur**. Kesinti boyunca `archivedCount` hiç ilerlemedi
(8 → 8), çünkü `archive_command` bir bütün olarak başarısız olur. Yani bir
`repo2` kesintisi "saha dışı kopya geriye düşer" değildir; **tüm arşiv
zincirini** askıya alır ve `repo1`'in PITR çözünürlüğünü de düşürür.

**Yayımlanmış iki komut geçersizdi.** §16.5 adım 9'daki
`--repo=2 stanza-create` ve `--repo=2 check`, pgBackRest 2.59.0 tarafından
reddediliyor (`ERROR: [031]: option 'repo' not valid for command 'check'`);
ikisi de doğası gereği tüm-depo işlemleridir. `--repo`; `backup`, `restore`,
`info`, `expire` ve `verify` için **geçerlidir**, bu yüzden yedek sarmalayıcısı
ve restore tatbikatı etkilenmemişti — **yalnızca runbook yanlıştı** ve
aktivasyon günü adım 9'da durulacaktı. Düzeltildi. Ayrıca ikincil host, depoyu
birincilin kullandığı **aynı indeks** altında (`repo2-path`) tanımlamalıdır;
aksi hâlde çıkan hata *yolları* adlandırır, *indeksleri* değil ve operatörü
zaten doğru olan bir dizini değiştirmeye yönlendirir.

**Gate 0'ın kanıtlamadığı:** izleme yeterliliği (smoke modu diski doldurana
kadar koşmaz; depoda `pg_wal` boyutu ve `archive_status/*.ready` sayacı için
**hiçbir kontrol yok**), üretimin pgBackRest sürümü (hiçbir yerde kayıtlı
değil), ve **dayanıklılık** — kopmuş bir konteyner ağı erişilemezliğin modeli
olabilir, bağımsız arıza alanının modeli değildir. Sınıflandırma:
`OBSERVED_LOCAL_ONLY`.

### Operatör aktivasyon paketi

Runbook **§22**, CHECKPOINT 0–12: kapılar, yapılandırma öncesi/sonrası hash'ler,
kanıt toplama listesi ve geri alma tablosu. §22.4 bilinçli olarak sıra dışıdır,
çünkü sonraki adımlarda yazılacak komutları değiştirir. **CHECKPOINT 2 ve
sonrası başlayamaz**: §16.2'nin yedi ön koşulu karşılanmamış, ikincil VPS
`NOT PROCURED`. CHECKPOINT 0 ve 1 salt-okunurdur ve bugün çalıştırılabilir.

### Testler

`npm run test:shell` **416 geçti / 0 başarısız / 1 atlandı** (150 opscheck +
**216** pgbackrest + 50 app-smoke; pgbackrest paketi 197 → 216, +19),
`test:pitr-status-contract` **16 / 0**, `test:platform-recovery-safety`
**60 / 0**, `npx tsc --noEmit` temiz (0 `error TS`), `git diff --check` temiz.
Tek atlama Windows'a özgüdür (`/proc/meminfo` yok); CI `ubuntu-latest`'te
çalıştırır.

Yeni kapsam, özellikle **tatbikat → kanıt → durum zinciri**: 10–12 numaralı
mevcut testler kanıt dosyasını elle yazdığı için tatbikatın çıkarımını hiç
denemiyordu — kusurun tam olarak yaşadığı yer orasıydı.

### Geri alma (rollback)

Depo: tek commit revert. Şema yok, migration yok, veritabanında geri alınacak
bir şey yok. İki fail-closed kapı (şifrelenmemiş `repo2`, belirtilmemiş
sentinel) daha önce *başarılı olan* bir çağrıyı reddedebilir; ikisi de yalnızca
zaten güvensiz olan çağrıları reddeder ve hiçbiri üretimdeki `--repo 1` yolunda
erişilebilir değildir. Üretim tarafı geri alma: runbook §22.17.

Kanıt: [evidence/F4-FCR-003_R030_DB_ACTIVATION_PREPARATION.md](../evidence/F4-FCR-003_R030_DB_ACTIVATION_PREPARATION.md) ·
[evidence/F4-FCR-003_gate0_repo2_unreachability.json](../evidence/F4-FCR-003_gate0_repo2_unreachability.json)

### F4-FCR-003-R1 — mimari inceleme düzeltmeleri (aynı dal, aynı taslak PR #433)

`F4-FCR-003-R1_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
İncelenen head: `826aec1286029ecfa4980b5c75b0deea13416cd4` ·
**Üretime erişilmedi, üretimde hiçbir değişiklik yapılmadı.**

**1) CI kırmızıydı — ve hatalı olan fikstür değil, muhafızın kendisiydi.**
pgBackRest süiti `ubuntu-latest` üzerinde **217 / 1**, aynı ağaç yerelde
**216 / 0**. Kök neden: `guard_no_silent_rm` bir *olumsuzlanmış boru hattı*
olarak yazılmıştı ve dosya `set -o pipefail` altında çalışıyor. `grep -q`
eşleşir eşleşmez 0 ile çıkar ve stdin'i boşaltmaz; yukarıdaki `grep -v` bir
sonraki yazımında `SIGPIPE` alıp **141** ile çıkar; `pipefail` 141'i boru
hattının durumu yapar; baştaki `!` bunu **başarıya**, yani "desen bulunamadı"ya
çevirir. Yani muhafız **tam olarak kusuru içeren girdide** TEMİZ raporluyordu.
Bu yalnızca bozuk bir fikstür değildi: restore tatbikatına `rm -rf …
2>/dev/null || true` gerçekten geri getirilseydi aynı yarış onu da temiz
gösterebilirdi. Düzeltme: samanlık önce değişkene alınıp doğrudan grep'lenir
(`grep -qE … <<<"$body"`), böylece cevap yalnızca grep'in kendi çıkış
kodudur. Aynı sağlam olmayan biçimdeki `guard_no_trust_auth`,
`guard_no_tcp_rule` ve `guard_peer_auth_present` (ikisi HIGH `pg_hba` güvenlik
muhafızı) da dönüştürüldü. **Hiçbir mutasyon iddiası zayıflatılmadı, silinmedi
veya beklenen dizgisi değiştirilmedi.** Kalıcı ve boş olmayan bir kontrol
eklendi: kusur ~1,5 MB'lık bir samanlığın 1. satırındayken eski uygulama
**deterministik olarak** (3/3) TEMİZ der, yenisi (3/3) yakalar; aynı samanlık
kusursuz hâlde ise yine temiz geçer — yani kontrol ayırt eder, büyük dosyaları
toptan reddetmez.

**2) pgBackRest sürüm eşitliği — `OBSERVED_LOCAL_ONLY — SAME SEMANTICS`.**
Üretim **pgBackRest 2.50 / PostgreSQL 16.14**; ilk Gate 0 2.59.0 / 16.15
üzerinde koşmuştu. Harness artık `--pgbackrest-version` / `--postgres-image`
kabul eder ve sabitlenen sürümü **apt-archive.postgresql.org** üzerinden çözer;
çözülemeyen bir sabitleme derlemeyi **başarısız kılar** (exit 3) ve **geri
düşüş yoktur**, ayrıca sabitleme deney başlamadan çalışan ikiliye karşı yeniden
doğrulanır. Koşu `20260816T161225Z-70901`, 77 örnek, `--internal` ağ, yalnızca
sentetik veri: `FAILS_COMMAND`; kesinti boyunca `archivedCount` **4'te donuk**;
`failedCount` 1 → **36**; `.ready` 1 → **12**; `pg_wal` **83,9 MB → 285,2 MB**
(180 s); PostgreSQL ön plan yazımlarını kabul etmeye devam etti; toparlanmada
`.ready` → **0**, `pgbackrest check` 0, **kaybedilen onaylı commit yok**.
**Yine de bu üretim doğrulaması değildir.**

**Aktarılan fark:** 2.50'de `repo2-host` yapılandırılmışken **PostgreSQL
host'unda** çalıştırılan `backup --repo=2` reddedilir —
`ERROR: [072]: backup command must be run on the repository host` — 2.59.0'da
aynı komut başarılıdır. `noramedi-pgbackrest-backup.sh --repo 2` birincilde
çalıştığı için **runbook §22.11 CHECKPOINT 7 üretimin mevcut sürümünde
yayımlandığı hâliyle çalışamaz**; alternatif (depo host'unda başlatmak)
**depo → üretim** yönünde SSH güveni gerektirir ve §16.5 bu yönü yasaklar.
§22.11'e blokaj olarak, iki seçenek §22.4a'ya yazıldı; **hiçbiri burada
yetkilendirilmemiştir ve üretime dokunulmamıştır.** `stanza-create` ve `check`
2.50'de etkilenmez ve geçer.

**3) WAL birikim izlemesi — `R-030-DB` aktivasyon blokajı, ek (additive)
olarak kapatıldı.** Gate 0'ın kendi sonucu, bir repo2 kesintisinin **disk
büyümesi** olarak geldiğiydi ve bunu ölçen hiçbir şey yoktu. Aynı
`schemaVersion` 1 belgesine iki **opsiyonel** alan eklendi:
`archive.walBytes` (`pg_ls_waldir()`) ve `archive.readyCount`
(`pg_ls_dir('pg_wal/archive_status')`) — ikisi de **PostgreSQL'in gerçekten
çalıştığı veri dizinine göre** çözülür; hiçbir PGDATA sabit kodlanmaz. **WAL
içeriği okunmaz**: sorgudan yalnızca bir bayt toplamı ve bir sayaç çıkar.
**Ölçülemeyen = YOK, asla `0` değil.** Üç yeni opscheck değişkeni, **hepsi
varsayılan olarak kapalı**: `…_MAX_WAL_READY_COUNT` (önerilen **32**,
türetimi §22.4a), `…_MAX_WAL_BYTES` (**bilerek varsayılansız** — güvenli değer
PGDATA dosya sisteminin boş alanının fonksiyonudur ve `df -B1 <PGDATA>`
ön kontrolde alınmadı) ve `…_REQUIRE_WAL_BACKLOG` (aktivasyon kapısı).
Yapılandırılmış bir limit + eksik ölçüm = **FAIL**; `REQUIRE_WAL_BACKLOG=true`
ve limitlerden biri hâlâ `0` ise opscheck **başlamayı reddeder** (exit **64**).
Mevcut opscheck/dead-man zincirini ve mevcut `pitr` **bit 7 (128)**'i kullanır
— yeni çıkış biti, yeni sağlayıcı kontrolü, yeni alt sistem **yok**;
**Prometheus/OTel yok** (F6 gelecekteki iş olarak kalır). Bugünkü tek-repo
üretim için **geriye dönük uyumludur** ve bu satırların her biri iddia
edilmekle kalmayıp test edilir.

**Üretim ön kontrolü kaydedildi (SALT-OKUNUR, değişiklik yok):** PostgreSQL
16.14, pgBackRest 2.50, `archive_mode=on`, `archive_timeout=5min`,
`pg_stat_archiver` **335 arşivlendi / 0 başarısız**, repo1 `ok` ve
`aes-256-cbc`, `pgbackrest check` **PASS**, `process-max=2`, `archive-async` /
`spool-path` / `archive-push-queue-max` **ayarlı değil**, kök dosya sistemi
≈%13 dolu. `df -B1 <PGDATA>` **hâlâ eksik** ve repo2 aktivasyonundan önce
gereklidir.

**Hiçbir şey kapanmadı:** `R-030`, `R-030-DB`, `R-030-FILES`, `R-080` `OPEN`;
repo2 **aktif değil**, üretim Gate 0 `PASS` **yok**, `offHost=yes` **yok**,
üretim RPO/RTO **yok**, `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`;
F4 `TODO`; `F4_TRANSITION_AUTHORIZED = NO`. **Şema değişikliği YOK, migration
YOK.**

Testler: `npm run test:shell` **457 / 0 / 1 atlandı** (opscheck 150 → **178**,
pgbackrest 216 → **229**, pitr-app-smoke 50), `test:pitr-status-contract`
16 → **27 / 0**, `test:pitr-status-file` **39 / 0**,
`test:platform-recovery-safety` **60 / 0**, `test:ci-classify` **23 / 0**,
`npx tsc --noEmit` temiz, `git diff --check` temiz.

Kanıt: [evidence/F4-FCR-003_R030_DB_ACTIVATION_PREPARATION.md](../evidence/F4-FCR-003_R030_DB_ACTIVATION_PREPARATION.md) §F4-FCR-003-R1 ·
[evidence/F4-FCR-003-R1_gate0_pgbackrest_250_parity.json](../evidence/F4-FCR-003-R1_gate0_pgbackrest_250_parity.json) ·
[runbooks/F4_RECOVERY_OPERATIONS.md](../runbooks/F4_RECOVERY_OPERATIONS.md) §22.4a

## F4-3 — Fiziksel silme güvenliği: kanıt, idempotency ve kiracı sınırı

`F4-3_STATUS = AGENT_COMPLETED` (revizyon `R1` dâhil) · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Taban çizgisi: `origin/main` @ `fb22b94cf607c64fdb0e33ba98329018ef8c9f5e`, temiz çalışma ağacı.
**Migration: YOK.** **Üretim mutasyonu: YOK.** **Faz durumu `TODO` olarak değişmedi.**

> **Bu görev hiçbir saklama süresi belirlemedi, hiçbir silmeyi onaylamadı ve
> hiçbir yeni silme yolu açmadı.** F4-3 sözleşmesinin `NO PHYSICAL DELETION
> without approved legal/KVKK policy` kuralı korunmuştur: canlı silme endpoint'i
> hâlâ yoktur, `deletion-review` hâlâ salt kuru-koşumdur, veri saklama politikası
> hâlâ `COUNSEL_REVIEW_REQUIRED`. Yapılan tek şey, **zaten gerçekleşen**
> kullanıcı-tetikli silmelerin güvenli, kiracı-sınırlı ve kanıtlanabilir hâle
> getirilmesidir.

### Kapatılan somut kusur

Hasta baytlarını fiziksel olarak silen iki yol — `DELETE /api/patients/:patientId/attachments/:id`
ve `DELETE /api/lab-orders/:id/attachments/:attId` — önce DB satırını siliyor
(eklerde bu **doğrudur**: o `deleteMany` atomik legal-hold kapısıdır, PR #163),
sonra `deleteFile(row.filePath)` çağırıp hatayı yutuyordu. Silinen satır
depolama anahtarını tutan **tek** yer olduğundan, başarısız bir depo silmesi
**kalıcı ve uzlaştırılamaz** bir yetim üretiyordu: nesne yerinde kalıyor, hiçbir
şey onu bir daha adlandıramıyor, hiçbir alarm çalmıyor ve çağırana silme
başarılı bildiriliyordu. KVKK açısından bu, sistemin **kanıtlayamadığı** bir
silme iddiasıdır — ve sessiz kısmi silme, tam silmeden ayırt edilemediği için
başarısızlığın kötü yarısıdır.

Bunu kanıtlarken **ikinci ve daha geniş bir kusur** bulundu:
`fileStorage.deleteFile` yerel modda **her** `unlink` hatasını yutuyordu,
yalnızca "dosya zaten yok"u değil. `EPERM`, `EACCES`, `EBUSY`, `EROFS` ve G/Ç
hataları — hepsi **her çağırana** başarılı silme olarak dönüyordu
(`clinicBulkExportPackage.ts`'in "deleteFile zaten yerel ENOENT'i yutar, bu
ikinci kontrol yalnızca uzak depo için gerekli" yorumu dâhil). Yalnızca `ENOENT`
tanımı gereği idempotenttir; gerisi artık **yükseltilir**.

### Yürürlüğe giren sözleşme — yeni bir sistem değil, mevcutların yeniden kullanımı

Yeni `server/src/services/storageObjectDeletion.ts`
(`deleteStoredObjectWithEvidence`) **paralel bir audit sistemi, kuyruk, outbox
veya worker icat etmez.** Kabul edilmiş sözleşmeleri kullanır: **yetkili** kanıt
defteri `writeAuditLogInTx` (kendi hatasını **yutmayan** yazıcı), **ikincil**
operatör sinyali `recordOperationalEvent`, idempotency semantiği ise dışa aktarma
artefaktları için zaten kabul edilmiş `deleteStorageObjectIdempotent` deseninin
aynısı.

| Özellik | Önce | Sonra |
|---|---|---|
| Kiracı sınırı | `deleteFile` kendisine verilen **her** anahtarı siler; A kliniğinin satırındaki bozuk bir `filePath` B kliniğinin nesnesini yok edebilirdi | Anahtar, sahibi kliniğin id'si ile **öneklenmiş olmalıdır** (F4-1A anahtar sözleşmesi). Değilse `rejected_tenant_mismatch` — **hiçbir şey silinmez** |
| Fail-closed | Yok | Boş, traversal, UNC, sürücü-göreli veya kontrol karakterli anahtar reddedilir (`rejected_unsafe_key`). Doğrulanamayan kimlik **bir şey silerek** çözülmez |
| Idempotency | Yok (tek deneme) | "Zaten yok" terminal başarıdır. Hata yükselirse varlık yeniden denetlenir; `already_absent`'e **yalnızca kiracı-kapsamlı** anahtar yükseltilebilir — `fileExists()` eski mutlak yol için `false` döndüğü için aksi hâlde **uydurma bir başarı** üretirdi |
| Kanıt | Yalnızca engellenen (legal-hold) dalda `AuditLog`; başarılı silmede **hiç yok** | Her sonuç (retler dâhil) `writeAuditLogInTx` ile `AuditLog` yazar: klinik, organizasyon, entity tipi/id, aksiyon, `requestedAt`, `executedAt`, sonuç, hata kodu, aktör — DB satırı gittikten sonra nesneyi **hâlâ adlandıran** artefakt |
| Dayanıklılık değişmezi (R1) | — | Satır silindikten sonra **ya (A)** fiziksel silme terminal başarıdır **ya da (B)** kanıt kaydı **commit edilmiştir**. Üçüncü, sessiz durum yoktur: kanıt commit edilemez ve nesne de kesin silinememişse sonuç `evidence_persistence_failed` olarak raporlanır (izlenen `failed` ile **karıştırılamaz**), süreç günlüğüne `UNEVIDENCED ORPHAN RISK` olarak yükseltilir ve rota `500` + `STORAGE_DELETE_UNEVIDENCED` + `recordDeleted: true` döner |
| Yükseltme (escalation) | Lab siparişlerinde **tamamen sessiz** (`catch(() => {})`); eklerde yalnızca `console.error` | Terminal olmayan her sonuç ayrıca `OperationalEvent` yazar (`error`; kanıt commit edilemediyse `critical`). Bu **yalnızca ikincil uyarıdır** — best-effort bir yazıcının başka bir best-effort yazıcının başarısına kanıt sayılamayacağı, R1'de düzeltilen kusurun ta kendisidir |
| PHI sızıntısı | — | Kiracı-kapsamlı anahtar sunucu üretimi ve opaktır, birebir yazılır. **Eski mutlak yol dosya adını taşıyabilir** (diş kliniğinde rutin olarak hasta adı), bu yüzden yalnızca SHA-256 **özeti** saklanır. Silmeyi kanıtlamak için hiçbir dosya adı, hasta adı, TCKN, telefon, e-posta veya DICOM metadata'sı yazılmaz |

Lab siparişi eki DB silmesi ayrıca id-yalnız `delete({ where: { id } })`
biçiminden `labWorkOrderId` + siparişin **kendi** `clinicId`'si ile kapsamlanmış
koşullu `deleteMany`'ye daraltıldı — hasta eki rotasının emsalinin aynısı.

### Sıralama neden değişmedi (DB önce, nesne sonra)

Nesneyi önce silmek, legal-hold kararını `deleteMany`'nin WHERE'inden çıkarıp
oku-sonra-sil hâline getirir ve PR #163'ün kapattığı TOCTOU penceresini
**yeniden açardı**. Bu yüzden sıralama korunmuş, artık riski (satır gitti, nesne
kalmış olabilir) **yeniden sıralamayla değil kanıtla** karşılanmıştır: depolama
anahtarı — tek kopyası az önce silinen satırdaydı — kanıtta yaşamaya devam eder.

### F4-3-R1 — mimari inceleme düzeltmesi (PR #430, 2026-08-16)

PR #430'un mimari incelemesi, görevin **temel güvenlik iddiasının** henüz
sağlanmadığını tespit etti ve haklıydı. İlk uygulama kanıtı `writeAuditLog` +
`recordOperationalEvent` ile yazıyordu; **her ikisi de kendi kalıcılık hatasını
yutan** fire-and-forget yazıcılardır. Dolayısıyla şu dizi hâlâ mümkündü:

```
DB satırı silindi -> fiziksel silme başarısız -> AuditLog yazımı başarısız (yutuldu)
-> OperationalEvent yazımı başarısız (yutuldu) -> çağıran `failed` görür
-> nesne duruyor, satır yok, nesneyi adlandıran hiçbir şey yok
```

Yani F4-3'ün kapattığını iddia ettiği **uzlaştırılamaz yetim** durumunun ta
kendisi — üstelik "izleniyor" gibi görünen bir sonuç değeriyle. Bir best-effort
yazıcı, başka bir best-effort yazıcının başarısına asla kanıt olamaz.

**Düzeltme (yeni tablo, kuyruk, servis veya migration olmadan):** yetkili kanıt
yazımı, deponun **zaten kabul edilmiş yutmayan** audit yazıcısı olan
`writeAuditLogInTx`'e taşındı (bulk-export'un güvenlik-kritik olayları için
eklenmişti; imzası `Pick<PrismaClient, 'auditLog'>` kabul ettiğinden global
istemci doğrudan yeterlidir — bu modülün atomik olması gereken başka bir yazımı
yoktur). Sonuç sözleşmesi genişletildi: `outcome` artık
`evidence_persistence_failed` değerini de alabilir, `storageOutcome` depo
tarafındaki gerçeği maskelenmeden taşır, `evidence` alanı kaydın commit edilip
edilmediğini söyler ve `isReconciliationSafe()` değişmezi çağıranlar için tek
bir yüklemde toplar. Her iki DELETE rotası da bu yüklemi kontrol eder ve
değişmez ihlal edildiğinde `success: true` **döndürmez**; `500` +
`STORAGE_DELETE_UNEVIDENCED` + `recordDeleted: true` ile kısmi durumu dürüstçe
bildirir (depolama anahtarı/dosya adı **açığa çıkarılmaz**).

Kapsam dürüstlüğü: bu düzeltme, başarısızlığın **ya kanıtlandığını ya da
kanıtlanamadığının yüksek sesle bildirildiğini** garanti eder. Veritabanının
kendisi erişilemezken kaydı kalıcı **yapamaz** — o durumda garanti kalıcılık
değil, dürüst raporlamadır. Otomatik yeniden deneme hâlâ yoktur (`R-080` açık).

Bu davranış kaynak taramasıyla değil, **Prisma delegesinde enjekte edilen
kalıcılık hatasıyla** kanıtlanır (`storageDeletionEvidence.test.ts` §7, 10 iddia:
başarı+kanıt, başarısızlık+kanıt, başarısızlık+kanıtsız, çapraz-kiracı
reddi+kanıtsız, yükleme geri-alma+kanıtsız, PHI sızıntısı yok, fırlatma yok).

### Bu görevin YAPMADIĞI

- **Saklama süresi/lifecycle sınıfı belirlenmedi.** Hiçbir yaş temelli veya
  politika temelli fiziksel silme yolu eklenmedi; olmadığı **test ile sabitlendi**
  (`deletion-review/execute` yok, `dataRetentionPolicy.ts`/`dataRetentionCleanupJob.ts`
  fiziksel silme yapmıyor, hiçbir zamanlanmış iş klinik nesne silmiyor).
- **Sağlayıcı object-lock/immutability etkinleştirilmedi ve etkin gibi
  gösterilmedi.** Bu, gelecekteki depo sağlayıcı şeridine aittir.
- **Migration yaratılmadı.** İki gerçek şema boşluğu tespit edildi ve program
  incelemesine **rapor edildi**, uygulanmadı (`R-079`, `R-080`).
  **Güncelleme (F4-3-R2, 2026-08-16):** `R-079` program sahibinin yetkisiyle
  ayrı bir turda giderildi ve kapanışı önerildi. **Güncelleme
  (F4-3-R079-CLOSE, 2026-08-16):** PR #431 birleştirildi, migration ve uygulama
  `disklinik-prod-01` üzerine dağıtıldı ve davranış üretimde doğrulandı;
  `R-079` artık **`CLOSED`**'dır (aşağıdaki F4-3-R2 ve F4-3-R079-CLOSE
  bölümleri). `R-080` **açık kalır** —
  bu maddedeki "migration yaratılmadı" ifadesi F4-3/F4-3-R1 turları içindir ve
  F4-3-R2 tarafından geçersiz kılınmaz.
- **Görüntüleme (imaging) yolu değiştirilmedi.** `imagingIngestCore.ts:179`'daki
  yükleme geri-alma silmesi F2 port sınırının içindedir ve dokunulmamıştır;
  kaydedildi, sessizce genişletilmedi.
- **`ActivityLog` metni değiştirilmedi.** `Dosya silindi: ${originalName}` uzun
  süredir var olan, aynı kliniğin personeline görünen ürün davranışıdır; onu
  değiştirmek bir ürün kararıdır, fail-closed bir güvenlik sınırı değildir.
  **Yeni** kanıt kayıtlarının hiçbiri dosya adı taşımaz ve bu test ile sabittir.
- **`markConfirmedMissing`'in ek dalı** hâlâ id-yalnız bir yazımdır (F2-STAGE3
  tarafından bilinçli olarak kapsam dışı bırakılmıştı). Hiçbir rotadan
  erişilebilir değildir ve silme yapmaz; **B kategorisi** olarak raporlanır,
  değiştirilmemiştir.

### Değişen dosyalar

| Dosya | Neden |
|---|---|
| `server/src/services/storageObjectDeletion.ts` **(yeni)** | Kanıt üreten, idempotent, fail-closed tek silme sözleşmesi |
| `server/src/services/fileStorage.ts` | `deleteFile` artık yalnızca `ENOENT`'i yutar; gerçek hata yükselir |
| `server/src/routes/attachments.ts` | DELETE ve yükleme geri-alma yolları sözleşmeye bağlandı; yanıt `storageDeletion` sonucunu taşır; **R1:** `isReconciliationSafe()` ihlalinde `success: true` yerine `500`/`STORAGE_DELETE_UNEVIDENCED`, geri-alma sonucu artık yutulmuyor |
| `server/src/routes/labOrders.ts` | Aynısı + DB silmesi sahibine kapsamlandı (`deleteMany`) |
| `server/src/tests/storageDeletionEvidence.test.ts` **(yeni)** | 33 iddia; davranışsal + kalıcılık-hatası enjeksiyonu (§7) + yapısal |
| `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` | Sabitlenmiş çağrı yeri güncellendi; **ayrıca kendi kusuru düzeltildi** — `getDeleteRouteBlock()`'un 3500 karakterlik sabit penceresi rotayı sessizce kesiyor ve iddiayı yanlış-negatife çeviriyordu |
| `server/src/tests/labOrders.test.ts` | Geri-alma iddiası yeni sözleşmeye taşındı (F4-1A2'nin sabitlediği `buildStorageKey(order.clinicId` satırına **dokunulmadı**) |
| `server/package.json` | `test:storage-deletion-evidence` |

### Testler

```
npm run test:storage-deletion-evidence  -> exit 0 ·  33 passed / 0 failed  (R1: 23 -> 33)
npm run test:kvkk-lifecycle             -> exit 0 · 111 passed / 0 failed
npm run test:lab-orders                 -> exit 0 ·  32 passed / 0 failed
npm run test:patient-privacy            -> exit 0 ·  38 passed / 0 failed
npm run test:storage-key-contract       -> exit 0 ·  41 passed / 0 failed
npm run test:clinic-bulk-export         -> exit 0 · 117 passed / 0 failed
npm run test:imaging                    -> exit 0 · 103 passed / 0 failed
npm run test:data-retention             -> exit 0 ·  43 passed / 0 failed
npm run test:dental-chart-clinic-scope  -> exit 0 ·  17 passed / 0 failed
npm run test:orphan-file-inspection-log-privacy -> exit 0 · 1 passed / 0 failed
npm run typecheck (server)              -> exit 0
npm run log-privacy-guard:scan          -> exit 0 · 268 dosya, yeni ihlal yok
git diff --check                        -> exit 0
```

### Geri alma (rollback)

Tek commit'lik revert yeterlidir. Kalıcı veri değişmedi, şema değişmedi,
depolama anahtarı biçimi değişmedi. Revert'ün tek etkisi silme kanıtının
üretilmeyi bırakmasıdır — mevcut hiçbir satır veya nesne etkilenmez.

### F4-3-R2 — `R-079` kapatıldı: lab eki legal-hold kapısı (2026-08-16)

`F4-3-R2_STATUS = AGENT_COMPLETED` · `TESTS_PASSED` · `PR_OPENED` (#431) ·
**`MERGED`** / **`DEPLOYED`** / **`PRODUCTION_VERIFIED`**
**`R-079` durumu: `CLOSED`** (2026-08-16, `F4-3-R079-CLOSE`). Düzeltme
uygulanmış ve testle kanıtlanmıştı; bu depo, kendi kuralı gereği (bkz. `R-071`
satırı ve Tracker §2) birleştirilmemiş, dağıtılmamış ve üretimde doğrulanmamış
bir düzeltmeyi kapanmış saymaz — **bu üç koşulun üçü de artık sağlanmıştır**:
PR #431 birleştirildi (üretim release `b370b0181fa2f84e24f0f80560425da81f60dcb2`),
migration ve uygulama `disklinik-prod-01` üzerine dağıtıldı ve davranış
üretimde doğrulandı. Yukarıdaki `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` işaretleri
**PR #431'e — yani uygulamanın kendisine** aittir. Kapanış kaydı: aşağıdaki
**F4-3-R079-CLOSE** bölümü ve
[../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md](../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md);
o kaydı taşıyan **PR #432 hâlâ `DRAFT` ve `NOT MERGED`**'dir.
Kapanan **yalnızca `R-079`**'dur: `R-080` **açık**, `F4` fazı **tamamlanmadı**.

F4-3 ve F4-3-R1, lab eki silmesini **kiracı-kapsamlı ve kanıtlanabilir** hâle
getirdi; **engellenebilir** hâle getirmedi. `LabOrderAttachment` modelinde
`legalHold` sütunu olmadığı için, deponun üç ek-silme yolundan biri hiçbir
legal-hold kapısı taşımıyordu (`R-079`). Program sahibi bu boşluğu kapatmak
için **yalnızca R-079'a mahsus, en küçük eklemeli migration'ı** yetkilendirdi.

**Şema (tam olarak iki sütun + bir index — `PatientAttachment` emsalinin
birebir aynısı):**

```prisma
legalHold       Boolean @default(false)
legalHoldReason String?
@@index([clinicId, legalHold])
```

`legalHoldAt`/`legalHoldById` **eklenmedi** — kabul edilmiş sözleşmede yoktur;
aktör ve zaman zaten `AuditLog` satırındadır. `storageVerifiedMissingAt` de
**eklenmedi**: o alan yetim-dosya incelemesine aittir ve
`orphanFileInspection.ts` `labOrderAttachment`'ı hiç dolaşmaz. Saklama
politikası alanı, lifecycle enum'u ve silme-niyeti tablosu **eklenmedi**
(`R-080` **açık kalır**).

**Değişmez — atomik yüklem.** Yetkilendirme kararı tek bir koşullu
`deleteMany`'dir; bir okuma değildir:

```ts
prisma.labOrderAttachment.deleteMany({
  where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId, legalHold: false },
})
```

Rotadaki ön-okuma **yalnızca metadata** içindir (`filePath` depo silmesi için,
`originalName` aktivite kaydı için) ve hiçbir şeyi yetkilendirmez. `count === 0`
üç ayrı nedeni **kiracı kapsamını genişletmeden** ayırır: satır yok → `404`;
satır var ve tutuluyor → `409 ATTACHMENT_LEGAL_HOLD` + denetim kaydı;
sahiplik/kapsam uyuşmazlığı → bu dala hiç ulaşamaz (sipariş araması ve ön-okuma
zaten reddeder). **Tutulu dalda hiçbir DB silmesi, hiçbir fiziksel depo silmesi
ve gerçekleşmemiş bir denemeyi iddia eden hiçbir depo-silme kanıtı yoktur.**

**Kiracı sahipliği** değişmedi: `erişilebilir klinik id'leri → LabWorkOrder →
order.clinicId → LabOrderAttachment`. `req.user.clinicId` hiçbir yerde doğruluk
kaynağı değildir.

**Legal-hold yönetimi.** Alan-üstü genel bir mekanizma **yoktur** ve
yaratılmadı: `attachments.ts` ve `imaging.ts` zaten kendi alanlarına ait ayrı
PATCH uçları taşır. Aynı emsalle
`PATCH /api/lab-orders/:id/attachments/:attId/legal-hold` eklendi —
`authorize(['OWNER', 'ORG_ADMIN'])` (kabul edilmiş sözleşmeden; **yeni rol icat
edilmedi** ve bu, rotanın geri kalanını yöneten `LAB_ORDER_MANAGE_ROLES`'tan
bilinçle **dardır**), her iki yönde en az 3 karakterlik gerekçe zorunlu, her iki
yön denetlenir. Yazımın kendisi de sahiplik yüklemiyle kapsamlı bir
`updateMany`'dir; silinmiş bir satırı diriltemez. `legalHoldReason` üç okuma
yolunda da (`GET /lab-orders/:id` iç içe `attachments`, `GET .../attachments`,
`POST .../attachments`) rol-kapılı redaksiyondan geçer; `legalHold` boolean'ı
hiç redakte edilmez.

**Denetim/KVKK.** Yeni aksiyonlar: `lab_order_attachment_legal_hold_set` /
`_released` / `_delete_blocked_legal_hold`. Hiçbirinde dosya adı, hasta adı,
TCKN, telefon, e-posta, DICOM metadata veya gerekçe metni yoktur; yalnızca
`entityId`, `labWorkOrderId` ve önceki/yeni boolean durum. **Birincil nesne
silmenin yedeklerden silme anlamına gelmediği** hükmü (§16A) aynen geçerlidir;
bu tur yedek saklama süresine dokunmaz.

**Migration.** `20260816130000_add_lab_order_attachment_legal_hold` —
expand-only, `ALTER TABLE ... ADD COLUMN` + `CREATE INDEX`. Mevcut satırlar
`legalHold = false` alır; geriye dönük hold **uydurulmaz** (legal hold, bir
`OWNER`/`ORG_ADMIN`'in gerekçesiyle kaydettiği olumlu bir hukuki eylemdir).
Tek kullanımlık PostgreSQL 16 üzerinde doğrulandı: `migrate deploy` exit 0,
**75 migration**, `unfinished = 0`, `rolled_back = 0`, `migrate status` =
"up to date", `information_schema` `legalHold boolean NOT NULL DEFAULT false` +
`legalHoldReason text NULL` + `LabOrderAttachment_clinicId_legalHold_idx`
doğruladı, `migrate diff --from-config-datasource` çıktısında
`LabOrderAttachment`/`legalHold` ile ilgili **hiçbir kalıntı yok**.

**Geri alma:** önce **uygulama** geri alınır; sütunlar okunmadıkları sürece
zararsızdır ve veritabanına dokunulması gerekmez. **Üretimde sütun düşürmek
acil geri alma yolu DEĞİLDİR** (§14'teki yıkıcı-rollback prosedürü geçerlidir).

**Testler (davranışsal, kaynak taraması değil):** yeni
`test:lab-attachment-legal-hold` **21/21** — gerçek Express rota zinciri,
diskte gerçek tek kullanımlık nesneler ve ön-okuma ile atomik `deleteMany`
**arasına** hold yerleştiren TOCTOU kancası. Gerçek eşzamanlı Postgres kanıtı
`scripts/verify-attachment-legal-hold-lifecycle.ts` §6'da (**34/34**), zorlanmış
kilit çakışması dâhil: DELETE satır kilidinde **beklerken** hold commit edilir
ve DELETE, READ COMMITTED altında yüklemi yeniden değerlendirip **0 satır**
etkiler.

### F4-3-R079-CLOSE — üretim doğrulaması ve `R-079` kapanışı (2026-08-16)

Yalnızca belge turu: hiçbir çalışma zamanı dosyası, şema, migration, test, CI
ya da dağıtım betiği değiştirilmedi. **Bu tur yalnızca `R-079`'u kapatır.**

**Release ve migration.** Üretim host'u `disklinik-prod-01`, release
`b370b0181fa2f84e24f0f80560425da81f60dcb2` (PR #431'in merge commit'i).
Migration `20260816130000_add_lab_order_attachment_legal_hold`. Prisma migration
durumu: **75 migration bulundu; veritabanı şeması güncel.** Üretim şeması
doğrulandı: `LabOrderAttachment.legalHold` — tip `boolean`, nullable `NO`,
default `false`; `LabOrderAttachment.legalHoldReason` — tip `text`, nullable
`YES`; index `LabOrderAttachment_clinicId_legalHold_idx` — `("clinicId",
"legalHold")` üzerinde `CREATE INDEX`. Prisma Client **v7.9.1** ile üretildi;
`noramedi-api` ve `noramedi-worker` reload edildi, ikisi de `online` ve her
ikisinin `RELEASE_SHA` değeri `b370b0181fa2f84e24f0f80560425da81f60dcb2` ile
eşleşti. Sağlık: local `/api/health` → `200 {"status":"ok"}`; local
`/api/readyz` → `200`, `database: ok`, `redis: ok`; external
`https://api.noramedi.com/api/health` → `200`.

**Doğrulama özneleri.** Klinik slug `gebzedisdunyasi`, klinik id
`5211acf4-6a1c-49ec-a23b-a677b89133ea` — **şu an bir demo kliniktir; canlı
gerçek müşteri yoktur ve doğrulamada gerçek müşteri verisi kullanılmamıştır.**
Aktör: kullanıcı `0a711de6-d860-4198-be2c-ffbe8195d581`, saklanan rol `admin`,
`canAccessAllClinics: true` — merkezî rol normalizasyonuna göre eski `admin` +
`canAccessAllClinics=true` ⇒ kanonik **`OWNER`**. Lab iş emri
`ebd3ca0c-5502-4464-b34b-735ecedf2b5d`, lab eki
`d2394a45-6d03-48db-a736-d1ac5179d7d5`, başlangıç `legalHold=false`.
**Doğrulama sırasındaki üretim depolama modu: `remoteStorageEnabled=false`
(yerel depolama).** Bu nedenle bu tur **F4-1/F4-2 uzak nesne depolama
hedefleriyle karıştırılmamalıdır** ve o hedefler hakkında hiçbir şey söylemez.

**Sonuçlar (altı adımın altısı da `PASS`):**

1. **Legal hold konuldu.** `PATCH /api/lab-orders/:workOrderId/attachments/:attachmentId/legal-hold`,
   `legalHold=true`, `reason="F4-3 R-079 production verification"` → HTTP `200`,
   `legalHold=true`. DB: `legalHold=true`,
   `legalHoldReason="F4-3 R-079 production verification"`.
2. **Silme engellendi.** `DELETE /api/lab-orders/ebd3ca0c-5502-4464-b34b-735ecedf2b5d/attachments/d2394a45-6d03-48db-a736-d1ac5179d7d5`
   → HTTP `409`, gövde
   `{"error": "ATTACHMENT_LEGAL_HOLD", "message": "This attachment is under legal hold and cannot be deleted."}`.
3. **DB korundu.** Engellenen DELETE sonrası satır hâlâ mevcuttu;
   `legalHold=true`; `legalHoldReason` kalıcı kaldı.
4. **Denetim kanıtı.** `AuditLog`:
   `lab_order_attachment_legal_hold_set` (`actorUserId
   0a711de6-d860-4198-be2c-ffbe8195d581`, `actorRole admin`, metadata
   `newLegalHold=true`, `previousLegalHold=false`,
   `labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`) ve
   `lab_order_attachment_delete_blocked_legal_hold` (aynı aktör, metadata
   `labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`).
5. **Fiziksel nesne korundu.** Kalıcı `filePath`
   `5211acf4-6a1c-49ec-a23b-a677b89133ea/1783356895177-5rowfgf37dr.png`;
   uygulamanın depolama soyutlaması üzerinden doğrulama `fileExists=true`,
   `fileSize=525254`, `exit_code=0` — engellenen DELETE fiziksel nesneyi
   korumuştur.
6. **Hold kaldırıldı / temizlik.** `PATCH .../legal-hold`, `legalHold=false`,
   `reason="F4-3 R-079 production verification cleanup"` → HTTP `200`,
   `legalHold=false`; son DB `legalHold=false`. Denetim:
   `lab_order_attachment_legal_hold_released` (aynı aktör, metadata
   `newLegalHold=false`, `previousLegalHold=true`,
   `labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`). Son fiziksel nesne
   durumu `fileExists=true`, `fileSize=525254`, `exit_code=0`.

**Kaydedilen nüans — `legalHoldReason` kaldırmada null'lanmaz.** Hold
kaldırılırken `legalHoldReason` **temizlenmedi**; son DB değeri kaldırma
gerekçesidir (`"F4-3 R-079 production verification cleanup"`). Bu, bu kapanış
için **kabul edilmiş mevcut davranıştır** ve bir `R-079` başarısızlığı
**değildir**; alan son legal-hold geçişinin gerekçesini taşır ve her iki yön
ayrıca denetlenir. Bu belgelerin hiçbiri alanın temizlendiğini veya `null`
olduğunu iddia etmez.

**İki ayrı lifecycle — tek bir listeye birleştirilmemelidir.**

**(a) UYGULAMA LIFECYCLE — PR #431 (`R-079` düzeltmesinin kendisi):**
`agent completed = YES` / `tests passed = YES` / `PR opened = YES` /
**`merged = YES`** / **`deployed = YES`** / **`production verified = YES`**
→ **`R-079` kapanış ölçütleri sağlanmıştır**, `R-079` bu nedenle `CLOSED`
olarak temsil edilebilir.

**(b) KAPANIŞ KAYDI LIFECYCLE — `F4-3-R079-CLOSE` / PR #432 (bu belge kaydı):**
`agent completed = YES` / `docs validation = PASS` / `PR opened = YES` /
**`PR state = DRAFT`** / **`merged = NO`** /
`deployment = N/A (yalnızca belge)` / `production mutation = NONE`.

Kısaca: **düzeltme** birleştirildi, dağıtıldı ve üretimde doğrulandı;
**okuduğunuz belge** ise hâlâ yetkili `main`'e birleştirilmeyi bekleyen
taslak PR #432'dir. Bu bölümün kendi çıktısı `MERGED` veya `DEPLOYED` olarak
temsil edilmemelidir.

**Bu tur ile kapanmayanlar:** `R-080` **`OPEN`** (dayanıklı silme niyeti,
otomatik yeniden deneme ve ters-yetim taraması hâlâ yoktur ve iddia edilmez);
sağlayıcı object-lock/immutability **yoktur ve iddia edilmez**; hard delete,
dayanıklı silme kuyruğu **yoktur**; `R-030`/`R-030-DB`/`R-030-FILES` `OPEN` ve
`FIRST_CUSTOMER_RECOVERY_GATE` değişmedi (`NOT_SATISFIED`, blocker `R-030-DB`);
**`F4` fazı tamamlanmadı.** F4-2/`R-030` ve F4-1A2 dokunulmadı.

**Geri alma:** yalnızca belge — commit revert edilir. Alttaki uygulamanın
çalışma zamanı geri alma yolu **önce uygulama** olarak kalır; migration
eklemelidir ve sütunlar okunmadıkları sürece zararsızdır.

Tam kayıt: [../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md](../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md).

### F4-3-R2 — değişen dosyalar

| Dosya | Neden |
|---|---|
| `server/prisma/schema.prisma` | `LabOrderAttachment.legalHold` / `legalHoldReason` / `@@index([clinicId, legalHold])` |
| `server/prisma/migrations/20260816130000_add_lab_order_attachment_legal_hold/` **(yeni)** | Expand-only migration |
| `server/src/routes/labOrders.ts` | Atomik `legalHold: false` kapısı, `409` + denetimli ret dalı, `OWNER`/`ORG_ADMIN` legal-hold PATCH'i, üç okuma yolunda rol-kapılı `legalHoldReason` redaksiyonu |
| `server/src/tests/labOrderAttachmentLegalHold.test.ts` **(yeni)** | 21 davranışsal iddia (TOCTOU, kiracı, rol, denetim, redaksiyon, depo servisinin hiç çağrılmaması) |
| `server/scripts/verify-attachment-legal-hold-lifecycle.ts` | §6 — gerçek Postgres yarışı + zorlanmış kilit çakışması (23 → 34 iddia) |
| `server/src/tests/storageDeletionEvidence.test.ts` | §9 kapı yüklemini ve "tutulu dalda depo silmesi yok" sıralamasını sabitler (33 → 34) |
| `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` | Fiziksel silme yolu olan **her** ek modelinin `legalHold` taşıdığını ve lab PATCH'inin `OWNER`/`ORG_ADMIN` olduğunu sabitler (111 → 113) |
| `server/package.json` | `test:lab-attachment-legal-hold`; **CI kapısı** olarak `server:test:non-disposable` ve `test` zincirlerine eklendi. **F4-3-R2 mimari inceleme düzeltmesi:** `test:storage-deletion-evidence` (hiçbir toplu zincirin üyesi değildi — hiçbir CI katmanı çalıştırmıyordu) ve `test:kvkk-lifecycle` (yalnızca `server:test:legacy-db-required` üyesiydi; o iş `STORAGE_IMAGING` sınıflandırmasında `runLegacyBackend` bayrağı **kurulmadığı** için depo/görüntüleme PR'larında atlanabiliyordu) de `server:test:non-disposable`'a eklendi. Her ikisi de canlı DB/MinIO gerektirmez: `kvkkAttachmentImagingLifecycle.test.ts` hiç `prisma.*` çağrısı yapmaz (kaynak taraması + enjekte bağımlılıklar), `storageDeletionEvidence.test.ts` ise `auditLog`/`operationalEvent` delegelerini stub'lar. `test:kvkk-lifecycle` `server:test:legacy-db-required` üyeliğini de **korur** (F1-003-P3-R1 sözleşmesi daraltılmadı; Katman 5b bir emniyet ağıdır, tekrar çalışması zararsızdır). |

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



## F4-2 — İlk müşteri saha dışı kurtarma: risk ayrımı + depo tarafı hazırlığı

`F4-2_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`

Baseline `origin/main` @ `041283b963c3e1486b81903afd11968f86d7576d`, temiz çalışma ağacı.
**Üretimde hiçbir mutasyon yapılmamıştır:** `repo2` oluşturulmadı, kimlik bilgisi üretilmedi,
tatbikat çalıştırılmadı, saha dışı kanıt marker'ı yazılmadı, **hiçbir bayt host dışına çıkmadı**,
şema değişmedi, migration yok.

### Ne yapıldı

**1. Program sahibi kararı — `R-030` ayrımı ONAYLANDI.** Runbook §16.1'in aylardır
"program sahibinin kararı ve yapılmadı" olarak duran önerisi kabul edildi.
`RISK_REGISTER.md`'ye `R-030-DB` ve `R-030-FILES` satırları eklendi. `R-030`
**kapatılmadı, indirilmedi, yeniden numaralandırılmadı veya silinmedi** — şemsiye
satır olarak `OPEN` kalır, yalnızca her iki yarım kapandığında kapanabilir, ve
mevcut tüm `R-030` referansları geçerliliğini korur. `FIRST_CUSTOMER_RECOVERY_GATE`
bundan böyle **yalnızca `R-030-DB`**'ye bağlıdır.

Gerekçe yeniden üretilmedi, onaylandı: PostgreSQL birincili `disklinik-prod-01`'de
olduğu için ikincil bir Türkiye VPS'i **o veri sınıfı için** gerçekten bağımsız bir
arıza alanıdır. Görüntüleme birincilinin nereye konacağı ise henüz karar değildir ve
ilk kliniğin veritabanı kurtarımını bloke etmemelidir. Ayrım yeni risk yaratmaz;
runbook §16.1'in uyardığı tek bir küresel "off-host ✓" iddiasının **yanlış beyan**
olmasını engeller.

**2. Sürdürülebilir işletim boşlukları kapatıldı (yalnızca ekleyici).** Kanıt/doğrulama
katmanı zaten hazırdı (`--repo N` ile restore, hedefe bağlı kanıt marker'ı, üç
durumlu `offHost`, 11 düşmanca test). Eksik olan, saha dışı bir deponun **sürekli
işletilmesi**ydi:

| Boşluk | Sonuç | Çözüm |
|---|---|---|
| Yedek sarmalayıcısında `--repo` yok | repo2'ye **zamanlanmış yedek alınamıyordu**; `expire` yanlış repoya uygulanıyordu | `--repo N` (varsayılan `1`; `N != 1` olmadıkça pgBackRest'e `--repo` **geçilmez**, böylece repo1 yolu birebir korunur ve yeni bir sürüm bağımlılığı doğmaz) |
| Ön koşullar yalnızca yerel dosya sistemi | Uzak/S3 repo2 için `df` ve dizin testi **yanlış diski ölçüyordu** | Uzak repo için atlanır; **yerel-yol** repo2'de disk abort korunur |
| Preflight repo2'yi doğrulamıyordu | Şifresiz veya parolasız bir repo2 preflight'tan **geçiyordu** | repo2 şifreleme + repo1'den **farklı** parola doğrulaması (hash ile karşılaştırılır, parola asla yazdırılmaz) |
| Yedek tazeliği repo başına değildi | **Gerçek bir yanlış-yeşil** | `repo2BackupCount` / `repo2LastBackupAgeMinutes` ayrı yayımlanır |
| opscheck aç kalan repo2'yi görmüyordu | Aynı yanlış-yeşil alarma dönüşmüyordu | Boş veya bayat repo2 artık pitr bitini (128) set eder |

**Kapatılan yanlış-yeşil, somut olarak:** operatör repo2'yi kurar, elle bir yedek alır,
tatbikatı `--repo 2 --record` ile geçer → `offHost="yes"`. Ardından hiçbir şey repo2'ye
yazmaz. Kanıt marker'ı **30 gün** geçerlidir ve `lastBackupAt` tüm repoların en
yenisiydi, dolayısıyla repo1'in gecelik yedekleri figürü taze tutardı. Sonuç: bir ay
boyunca **kanıtlanmış ve sağlıklı** görünen, fiilen bayatlayan bir saha dışı kopya.
R-030 bir *dayanıklılık* riskidir; bu zeminde kapatmak §12.3'ün önlemek için
kurulduğu hatanın aynısı olurdu.

### Kapatılmayanlar — açıkça

`R-030`, `R-030-DB` ve `R-030-FILES` `OPEN` kalır. `FIRST_CUSTOMER_RECOVERY_GATE =
NOT_SATISFIED`. **Kalan blokaj kod değildir:** ikincil Türkiye VPS'i **TEDARİK
EDİLMEMİŞ** ve runbook §16.2'nin yedi ön koşulu (KVKK Md. 6 sağlık verisi DPA, E1–E5
yerleşim kanıtı — **E5 dahil**, subprocessor register §1/§6, sözleşmesel destek-erişimi
yanıtları, üç at-rest şifreleme satırı, Türkiye kapsamlı replikasyon, dört rolün ayrımı)
**tamamı karşılanmamıştır**. Aktivasyon sırası runbook **§16.5**'e yazıldı ve
**çalıştırılmadı**; §16.5'in Gate 0'ı (erişilemez bir repo2'nin `archive-push`'ı durdurup
`pg_wal`'ı doldurup doldurmadığının **scratch host'ta** tespiti) bir üretim-kesintisi
riskidir ve atlanamaz.

`R-031`/`R-032` bu görevce **değerlendirilmemiştir** ve 2026-08-15'teki hâlleriyle
`CLOSED` kalır. `repo1` ve `pg_dump` yedeği **kaldırılmamıştır**; geri alma, repo2
cron satırını silmektir — sarmalayıcı `--repo 1`'e döner, hiçbir betik geri alınmaz.

### Testler

```
npm run test:shell                     -> exit 0 · 397 passed / 0 failed
  test:shell:opscheck                  -> 150 passed / 0 failed
  test:shell:pgbackrest                -> 197 passed / 0 failed
  test:shell:pitr-app-smoke            ->  50 passed / 0 failed
npm run test:pitr-status-contract      -> exit 0 ·  16 passed / 0 failed
npm run test:platform-recovery-safety  -> exit 0 ·  60 passed / 0 failed
npx tsc --noEmit -p server/tsconfig.json -> exit 0
git diff --check                       -> exit 0
```

Migration required: **NO** · Migration created: **NO** · Production migration: **NO**


## F4-FCR-002A — İzole restore/PITR tatbikatı: YALNIZCA ÖN KONTROL (PRE-FLIGHT)

`F4-FCR-002A_STATUS = IN_PROGRESS` · **`PREFLIGHT_DECISION = NO_GO`**
`NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Taban çizgisi: `origin/main` @ `a384bf67fb791a724af111b52b761d82fd57bd3a` (PR #426 merged)
— önceki `def01bf6` (PR #422) taban çizgisinden rebase edildi; böylece dal, PR #424
fail-closed Layer 4 yürütme kanıtını ve PR #426 sınırlandırılmış MinIO hazırlık
düzeltmesini devralır.

> **Bu görev tamamlanmamıştır.** `F4-FCR-002A`, gerçek tatbikat çalıştırılıp
> doğrulanana ve temizlenene kadar `IN_PROGRESS` kalır. **Restore
> çalıştırılmadı.** `R-030`/`R-031`/`R-032` `OPEN`;
> `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`.

### Sonuç: NO_GO — hazırlık eksikliğinden, güvenlik tasarımından değil

İzolasyon tasarımı düşmanca incelemeden geçti: yalnızca tmpfs, yalnızca unix
socket (`listen_addresses=''`, `0700` socket dizini, `peer` auth), tatbikat
örneğinde `archive_mode=off` ve boş `archive_command`, üretim PGDATA'sını
çözemediğinde **açık başarısız olmayı reddeden** koruma (exit 3), `--delta`
yok, ve doğrulanamayan bir temizliği başarı olarak raporlamak yerine olaya
yükselten cleanup.

| Kapı | Sonuç |
|---|---|
| `DISK_CAPACITY_GATE` | `PASS` (tatbikatın kendi formülüyle hostta yeniden hesaplandı) |
| `PG_VERSION_COMPATIBILITY_GATE` | `PASS` — PostgreSQL 16.14, ikili dosyalar `/usr/lib/postgresql/16/bin` |
| `MIGRATION_COMPATIBILITY_GATE` | `PASS` — dağıtılmış 73 = DB 73 (`origin/main` 74; olağan deploy gecikmesi) |
| `TENANT_ISOLATION_SMOKE_GATE` | `PLANNED_SAFE` |
| `PITR_MARKER_GATE` | `PLANNED_SAFE` (kontrollü marker sonrası) |
| `MARKER_ARCHIVE_GATE` | `PASS` — `000000010000000000000020`, `failed_count=0`, `.ready=0` |

### Kalan blokajlar (tatbikattan önce)

1. `/usr/local/sbin/noramedi-pgbackrest-restore-drill.sh` ve
   `noramedi-pitr-app-smoke.mjs` üretimde **kurulu değil** → runbook §21.1.
2. `/var/lib/noramedi` **yok**; sonuç belgesi yalnızca
   `if [[ -d "$RESULT_DIR" ]]` yazılır ve `write_incident_marker` dizin
   yoksa sessizce döner → runbook §21.2.
3. Tatbikatın PITR **durma noktası doğrulaması** — bu görevde **eklendi**;
   çağrıda `--pitr-run-id` verilmesi gerekir.
4. Dondurma istisnası çelişkisi — `NORAMEDI_MASTER_TRACKER.md` §5.1'de
   **yalnızca yönetişim (governance) kayıtlarına dayanarak çözüldü**. Üretimin
   fiilî durumu (pgBackRest kurulu, `archive_mode=on`) **yetki kanıtı olarak
   kullanılmamıştır**: aktivasyon bir operatör eylemidir ve yetkisiz de
   gerçekleşebilir; bir değişikliği, onu yetkilendirmesi gereken kaydın yerine
   kanıt saymak yetkisiz bir değişikliğin kendini meşrulaştırmasına izin verirdi.

### Zaman dilimi (timezone) kuralı — PITR hedefi `+00`

`OperationalEvent.createdAt` `timestamp without time zone`'dur; saklanan
duvar saati **UTC**'dir (uygulama Prisma üzerinden yazar, Prisma UTC'ye
serileştirir). Üretim `session_tz = Europe/Istanbul` bildirse de ham değer
yereli **değildir**. Bu nedenle `RUN_ID = F4-FCR-002A-20260815-01` için doğru
hedef **`2026-08-15 12:59:26.405500+00`**'dır; önceki `+03` hedefi
**reddedilmiştir** — marker A'dan yaklaşık üç saat önceye düşer, undershoot
üretir ve tatbikatı tam bir restore bedeli ödendikten sonra başarısız kılar.
Kural artık operatörün okumasına bırakılmamıştır: tatbikat, `--pitr-run-id`
ile açık UTC ofseti taşımayan bir `--target`'ı **argüman ayrıştırmada
reddeder** ve sonuç belgesine `markerTimestampZone: "UTC"` yazar.

### Uygulama smoke Stage B = BLOCKED (ve gerekli değil)

`RUN_BACKGROUND_JOBS` yalnızca API sürecini kapsam dışı bırakır;
`resolveWorkerBackgroundJobsOwnership()` koşulsuz `ownsJobs: true` döner ve bu
değişkeni **hiç okumaz** (`backgroundJobsOwnership.ts:65-70`), `ecosystem.config.cjs`
worker `env` bloğunda kasıtlı olarak yoktur. Mesajlaşma kimlik bilgileri
ortam değişkeni değil **veritabanı satırlarıdır** ve üretim `ENCRYPTION_KEY`
ile çözülür; `withJobLock` geri yüklenen veritabanının kendi kilit tablosuna
yazar, dolayısıyla üretimin kilitleri çift gönderimi engelleyemez. Güvenli ve
yeterli yol: Stage A (yalnızca SQL invariant'ları) + `noramedi-pitr-app-smoke.mjs`
— bu yardımcı Express'i hiç başlatmaz, iş zamanlamaz, yazmaz, satır yazdırmaz
ve TCP bağlantısını reddeder.

### Depo düzeltmesi (en küçük eklemeli değişiklik)

`scripts/noramedi-pgbackrest-restore-drill.sh` artık PITR durma noktasını
**deterministik** doğrular: `--pitr-run-id` ile geri yüklenen kümede marker
A = 1, marker B = 0 ve `pg_last_xact_replay_timestamp() <= --target`. Herhangi
biri sağlanmazsa tatbikat başarısız olur; karşılaştırma yapılamazsa
**fail-closed**. `--pitr-run-id` verilmeyen bir `--target` koşusu
`not_verified` olarak damgalanır ve R-032 uygunluğundan çıkarılır. Kanıt
(`runId`, marker sayıları/zamanları, hedef, WAL segmenti) kalıcı sonuç
belgesine `pitrVerification` altında yazılır. 19 yeni kabuk testi eklendi;
`schemaVersion` **2'de bırakıldı** — değişiklik tamamen eklemelidir ve bu
belgenin sürüme bağlı bir tüketicisi yoktur.

### Kontrollü üretim marker'ı (onaylı, klinik olmayan)

`runId = F4-FCR-002A-20260815-01`. Uygulamanın kendi `recordOperationalEvent()`
servisi üzerinden `OperationalEvent`'e iki satır; hiçbir kiracıya ait olmayan
sentinel `organizationId` (bu sütunun yabancı anahtarı yoktur),
`severity=info`, `source=system`, sabit operatör metni. **Hasta, klinik veya
kişisel veri yok.** `RecoveryDrillRun` bilinçli olarak **kullanılmadı**:
tablosu üretimde uygulanmamış bir migration ile gelir ve
`isRecoveryDrillStale()` yalnızca en yeni satırın `startedAt` değerine bakar,
**`status`'tan bağımsız** — bir `db_restore_test` satırı, hiçbir restore
kanıtlanmadan bayatlık bayrağını 168 saat yeşile çevirirdi.

Bu satırlar **işlem düzeyinde PITR kanıt girdileridir, kalıcı kanıt değildir**;
kalıcı kanıt program saklama politikasına göre tatbikat sonuç belgesine yazılmalıdır.

## F4-FCR-002A-R4 — İki tatbikat çalıştırıldı; ikincisi yalnızca uygulama smoke'unda kapandı

`F4-FCR-002A_STATUS = IN_PROGRESS` · `R032_ELIGIBLE = false`
`NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Üretim sürümü: `75c8c2f2f4a2027ee3a42ae55bc211b710383005` · PostgreSQL 16.14

> **Bu görev hâlâ tamamlanmamıştır.** İki tatbikat çalıştırıldı ve **ikisi de
> `FAIL` ile kapandı**. `R-030`/`R-031`/`R-032` `OPEN` kalır;
> `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. Bu bölüm bir düzeltmeyi ve
> iki tatbikatın kanıtını kaydeder — **geçen bir tatbikatı değil.**

### Birinci tatbikat — bayat girdi (`FAIL`)

İlk kontrollü tatbikat, girdilerinin bayatlığı nedeniyle kapandı: migration
kümesi **73/74** ile eşleşmedi (dağıtılmış sürüm bir migration geride) ve
kullanılan yedek **RPO = 385 dakika** verdi — 60 dakikalık ilk-müşteri hedefinin
altı katından fazlası. Bu bir kod kusuru değil, bir **tazelik** kusurudur:
tatbikat, kanıt üretmeye elverişli olmayan bir girdiyle beslendiğinde bunu
doğru biçimde `FAIL` olarak raporlamıştır. Düzeltme, taze bir tam yedek
(`20260815-224355F`) alınması olmuştur.

### İkinci tatbikat — her şey geçti, uygulama smoke'u hariç (`FAIL`)

`runId = F4-FCR-002A-20260815-02`. Taze yedekle çalıştırıldı ve **kanıt
üretmesi beklenen her kapı geçti**:

| Kapı | Sonuç |
|---|---|
| PITR durma noktası (marker A = 1, marker B = 0) | **PASS** — hedef `2026-08-15 19:46:39.550000+00`, replay `2026-08-15T19:46:00Z` |
| Migration kümesi (beklenen/uygulanan) | **PASS** — 74/74, `missing=0`, `ahead=0` |
| Tenant izolasyon smoke | **PASS** — klinikler arası randevu = 0, yetim klinik referansı = 0 |
| RPO | **PASS** — 3 dk ≤ 60 dk |
| RTO | **PASS** — 5 sn ≤ 14400 sn |
| Temizlik (cleanup) | **PASS** — doğrulandı |
| **Uygulama smoke** | **FAIL** — `PrismaClient` **kurulamadı** |

Tam hata:

```
Unknown property datasources provided to PrismaClient constructor
```

**Sonuç `FAIL`'dir ve öyle kalmalıdır.** Tatbikat doğru davranmıştır: uygulama
smoke'u, geri yüklenen veritabanını **üretimin fiilen çalıştırdığı kodun**
kullanabildiğini kanıtlayan tek aşamadır; kurulamayan bir istemci hiçbir şey
kanıtlamaz. `R032_ELIGIBLE = false` olarak kalmıştır ve off-host kanıt marker'ı
yazılmamıştır.

### Kök neden — smoke yardımcısı üretimin Prisma 7 sözleşmesini taklit etmiyordu

Dağıtılmış çalışma zamanı (`server/src/db.ts:15-22`) istemciyi **sürücü
adaptörü** ile kurar:

```ts
new PrismaClient({ adapter: new PrismaPg({ connectionString: getRequiredDatabaseUrl(), ... }) })
```

`server/package.json` `@prisma/client` **7.9.1** ve `@prisma/adapter-pg`
**7.9.1** sabitler. Prisma 7 hem `datasourceUrl` hem `datasources`
özelliklerini kaldırmıştır ve ikisini de reddeder.

Smoke yardımcısı ise (`scripts/noramedi-pitr-app-smoke.mjs:136-144`, düzeltme
öncesi) önce `datasourceUrl`, sonra `datasources` deniyordu — **ve ilk hatayı
boş bir `catch (_)` ile yutuyordu.** Bu yüzden tatbikat kaydına yalnızca
*ikinci* denemenin mesajı düştü; gerçek neden (istemcinin bir adaptör beklediği)
hiçbir zaman raporlanmadı. Bu, düzeltilen ikinci kusurdur: **teşhisi gizleyen
catch-all**.

### Düzeltme — sürüm farkındalıklı, catch-all değil

Yardımcı artık dağıtılmış `@prisma/client`'ın **sürümünü okur** ve yolu buna
göre seçer; bir yapılandırma hatasını yakalayıp körlemesine ikinci bir yol
denemez:

- **major ≥ 7** → `@prisma/adapter-pg` de aynı `createRequire` ile
  **dağıtılmış dizinden** yüklenir, `new PrismaPg({ connectionString, max: 1, ... })`
  kurulur ve istemci `new PrismaClient({ adapter, log: [] })` ile üretilir —
  yani `server/src/db.ts` ile **aynı sözleşme ailesi**.
- **major < 7** → `datasourceUrl` (bir rollback sürümünde smoke'un anlamsız bir
  nedenle düşmemesi için korunur).
- Sürüm okunamazsa **fail-closed**: sözleşme tahmin edilmez.
- `@prisma/adapter-pg` eksikse **fail-closed** ve hata paketi adıyla söyler.

`server/src/db.ts` **içe aktarılmaz** — o modül üretim `DATABASE_URL`'ini
çözerdi. Bağlantı dizesi yalnızca tatbikatın unix socket'ini, portunu ve
veritabanını adresler; parola yoktur (peer auth). Havuz `max: 1`'dir. Tatbikat
socket güvenlik kontrolleri (mutlak yol zorunluluğu, `.s.PGSQL.<port>`
varlığı) ve `current_setting('port')` ham sorgu kanıtı **korunmuştur**.

Tatbikat betiği ayrıca artık **restore'dan önce** `@prisma/adapter-pg`'yi
ön kontrol eder: v7+ bir istemci varken adaptör yoksa tatbikat, pahalı kısmı
harcamadan reddeder.

### Neden hiçbir test bunu yakalamamıştı

`scripts/noramedi-pgbackrest.test.sh` yardımcıyı zaten kapsıyordu — ama
**vakalarının tamamı kurulumdan (construction) ÖNCE** düşüyordu (eksik ortam,
TCP host, olmayan socket). Depoda hiçbir yerde istemci gerçekten kurulmamıştı,
bu yüzden kusur tüm süite görünmezdi ve yalnızca gerçek bir restore onu
bulabildi.

Yeni `scripts/noramedi-pitr-app-smoke.test.sh` bu boşluğu kapatır: **sahte bir
dağıtılmış sürüm dizini** (`node_modules/@prisma/{client,adapter-pg}`) kurar,
sahte istemci Prisma 7'nin davranışını **birebir taklit eder** (legacy
özellikler için gerçek "Unknown property …" hatasını fırlatır, adaptörsüz
kurulmayı reddeder) ve yardımcının gerçek kur/bağlan/sorgula yolunu uçtan uca
sürer. PostgreSQL, ağ veya kimlik bilgisi gerektirmez.

**Mutasyon kanıtı:** süit, düzeltme öncesi yardımcıya karşı çalıştırıldığında
**22 assertion başarısız olur** ve üretimdeki hatanın **tam metnini** raporlar;
düzeltilmiş yardımcıya karşı **50/50 geçer**.

### Bu bölümün KAPATMADIĞI

`R-031` ve `R-032` **`OPEN` kalır.** Bir kod düzeltmesi ve yeşil bir test
süiti, geçen bir tatbikat **değildir**. `R-032` yalnızca, düzeltilmiş
yardımcıyla yeniden çalıştırılan bir tatbikatın `0` ile çıkması ve sonuç
belgesinde `pitrVerification.verified = true` **ile birlikte**
`smoke.application = passed` bulunması hâlinde kapanabilir. Bu görev o
yeniden çalıştırmayı **yapmamıştır**.

> **[2026-08-15, F4-FCR-002A-CLOSE — o yeniden çalıştırma artık mevcuttur.]**
> Yukarıdaki koşul karşılandı ve `R-031`/`R-032` **`CLOSED`** oldu; bkz. bu
> dosyadaki `F4-FCR-002A-CLOSE` bölümü. **`R-030` `OPEN` kalır** ve
> `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. Bu bölümün metni, iki
> başarısız tatbikatın tarihli kaydı olarak **düzeltilmeden** bırakılmıştır.

## F4-FCR-002A-CLOSE — Kontrollü üretim PITR tatbikatı `PASS`; beş yetenek ayrı ayrı

`F4-FCR-002A_STATUS = PRODUCTION_VERIFIED` · `R032_ELIGIBLE = true` · **`RESULT = PASS`**
`MERGED = YES` (PR #427) / `DEPLOYED = YES` / `PRODUCTION_VERIFIED = YES`
Üretim sürümü / araç commit'i: `309351885c1389c53d40e4b15e630264dc54954f` · PostgreSQL 16.14

> **Bu bölüm bir başarıyı kaydeder — ve onun sınırını.** Beşinci denemede
> kontrollü üretim PITR tatbikatı uçtan uca geçti, durma noktası doğrulandı,
> geri yüklenen veritabanı **üretimin fiilen çalıştırdığı kodla** kullanıldı ve
> temizlik doğrulandı. `R-031` ve `R-032` **`CLOSED`**. **`R-030` `OPEN`
> kalır** ve `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` — kurtarma deposu
> hâlâ `repo1`, **YEREL**, veritabanı birincilinin arıza alanının **içinde**.
> Önceki dört başarısız tatbikat silinmemiştir; bu bölüm onların üzerine yazar,
> yerlerine geçmez.

### Beş yetenek — tek bir "yedekleme çözüldü" cümlesine indirgenmez

| Yetenek | Durum | Kanıt / neden |
|---|---|---|
| **PITR yeteneği** (WAL arşivleme, keyfî bir zamana kurtarma) | **KANITLANDI** | `archive_mode=on`, marker WAL `00000001000000000000008C` arşivlendi; kurtarma iki marker'ın **arasında** durdu: marker A = 1, marker B = 0, kurtarma noktası `2026-08-15T21:26:00Z`, hedef `2026-08-15 21:26:35.026000+00`. → `R-031` `CLOSED` |
| **Restore / uygulama kullanılabilirliği** | **KANITLANDI** | Tatbikat `0` ile çıktı; `pitrVerification.verified = true` **ve** `smoke.application = passed`; migration kümesi 74/74 (`missing=0`, `ahead=0`, unfinished `0`, rolled back `0`), 106 public tablo. → `R-032` `CLOSED` |
| **Kiracı (tenant) izolasyonu doğrulaması** | **KANITLANDI (bu koşu için)** | Klinikler arası randevu `0`, yetim klinik referansı `0`, yetim randevu `0`, RLS politikası `0` (beklenen `0`). Bu, geri yüklenen veri üzerinde bir **invariant kontrolüdür**; uygulama katmanı kiracı izolasyonunun genel kanıtı değildir (bkz. `R-001`, `R-054`/`R-055` — dokunulmadı). |
| **RPO / RTO** | **HEDEF İÇİNDE (ölçüldü)** | Efektif RPO **5 dk** ≤ 60 dk; ölçülen RTO **7 sn** ≤ 14400 sn. Bunlar **tek bir kontrollü tatbikatın** ölçümleridir — bir hizmet seviyesi taahhüdü değil, bir kapasite kanıtıdır. |
| **Saha dışı (off-host) dayanıklılık** | **KANITLANMADI** | Tatbikat `repo1`'den geri yükledi; `repo1` **YEREL**'dir. Tatbikat `repo < 2`'den saha dışı kanıt marker'ı yazmayı **reddeder** ve yazmamıştır. İkincil Türkiye VPS'i **tedarik edilmemiştir**; runbook §16.2'nin yedi ön koşulu **karşılanmamıştır**. → `R-030` **`OPEN`** |

**Şifreleme dayanıklılık değildir.** `repo1` üzerindeki AES-256-CBC yedeğin
**gizliliğini** korur; host kaybına karşı **dayanıklılık** sağlamaz. Bu bölümün
hiçbir cümlesi bağımsız arıza alanı kanıtı olarak alıntılanamaz.

### Geçen koşu — kanıt değerleri

| Alan | Değer |
|---|---|
| Tatbikat `run_id` | `20260815-213109-709154` |
| Yedek | `20260815-224355F` |
| Marker `runId` | `F4-FCR-002A-20260815-03` |
| Marker A / B | `2026-08-15T21:25:33.447Z` / `2026-08-15T21:27:36.605Z` (**UTC**) |
| Hedef | `2026-08-15 21:26:35.026000+00` |
| Marker WAL | `00000001000000000000008C` |
| Aşama süreleri | restore `1 sn`, bağlantılar `2 sn`, promotion `4 sn`, DB doğrulaması `5 sn`, uygulama smoke `7 sn`, tenant smoke `7 sn` |
| Temizlik | `PASS` — küme kapatıldı, `/dev/shm/noramedi-pitr-drill-20260815-213109-709154` silindi, silinme **doğrulandı** |
| Sonuç | **`PASS`**, `R032_eligible = true` |

### Beşinci denemede — önceki dördü geçersiz kılınmaz

| # | Sonuç | Neden |
|---|---|---|
| 1 | `FAIL` | Bayat girdi — migration 73/74, RPO 385 dk |
| 2 | `FAIL` | Yalnızca uygulama smoke'u — Prisma 7 constructor sözleşmesi |
| 3 | `FAIL` | **RPO.** R4 dağıtıldıktan sonra uygulama smoke'u geçti; yeniden kullanılan marker hedefi **96 dakika** yaşlanmıştı ve 60 dk hedefini aştı. |
| 4 | `FAIL` | **Sentinel organizasyon uyuşmazlığı.** Taze marker çifti yazıldı, fakat operatör marker yardımcısı satırları tatbikatın sorguladığından **farklı** bir `organizationId` altında yazmıştı. Kurtarmada hata yoktu; doğrulayıcı yanlış yere bakıyordu. |

Üçüncü tatbikat, marker çiftinin **her deneme için yeniden** üretilmesi
gerektiğinin nedenidir: yeniden kullanım koşuyu ucuzlatır, yaşlanma
başarısız kılar. Dördüncüsünün operasyonel dersi ve **kasıtlı olarak
normalize edilmemiş** sentinel farkı runbook §21.7'de kayıtlıdır — tatbikatın
varsayılanı `__noramedi_pitr_drill__`, geçen koşu ise
`NORAMEDI_PITR_MARKER_ORG=noramedi-f4-pitr-sentinel` kullanmıştır. Bu görev
**hiçbir çalışma zamanı betiğini değiştirmemiştir**.

### Bu bölümün KAPATMADIĞI

`R-030` `OPEN`. `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. F4 fazı
`TODO` — geçen bir kurtarma tatbikatı, faz çıkış kapısı değildir ve bu görev
faz durumunu değiştirmez. Off-host aktivasyonu; tedarik, DPA, E1–E5 yerleşim
kanıtı ve subprocessor register güncellemelerine bağlıdır (runbook §16.2) ve
`R-030`'un iki yarıya bölünmesi (§16.1) hâlâ program sahibinin kararıdır.

## F4-FCR-002 — pgBackRest / PITR / Off-Host Kurtarma Temeli

`F4-FCR-002_STATUS = AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
`F4-FCR-002_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_2026-08-15`

### Dondurma (freeze) pozisyonu — istisna VERİLDİ (2026-08-15), üretim henüz değişmedi

> **2026-08-15 — istisnanın kaydı.** Program sahibi, dar kapsamlı dondurma
> istisnasını `F4-FCR-002A` görevi kapsamında **vermiştir**. Kayıt, F4-1A
> emsaline ve aşağıdaki 69. satırdaki gerekliliğe uygun olarak **bu dosyada**
> tutulmaktadır; yalnızca bir kanıt dosyasında ilan edilmemiştir.
>
> İstisnanın **kapsamı** [`runbooks/F4_RECOVERY_OPERATIONS.md`](../runbooks/F4_RECOVERY_OPERATIONS.md)
> §14'te yazılı olanla sınırlıdır ve **genişletilmemiştir**: pgBackRest kurulumu
> ve yapılandırması, `archive_mode`/`archive_command` etkinleştirmesi, şifreli
> yerel kurtarma deposu, sürekli WAL arşivleme, kurtarma doğrulaması, izole
> **üretim-dışı** restore tatbikatı, operatör izlemesi ve **ayrıca onaylanacak**
> saha dışı depo bağlantısı. İstisna; RLS değişikliklerini, kiracı (tenant)
> genişletmesini, depolama anahtarı göçünü, görüntüleme yeniden konumlandırmasını,
> fiziksel silme yeniden tasarımını, ilgisiz Prisma/şema değişikliklerini, ilgisiz
> altyapı yeniden tasarımını, mevcut `pg_dump` zincirinin değiştirilmesini veya
> geniş kapsamlı KVKK mimari değişikliklerini **kapsamaz**.
>
> **İstisnanın verilmiş olması, üretimin değiştiği anlamına gelmez.** Bu satırın
> yazıldığı anda `archive_mode` hâlâ `off`, pgBackRest **kurulu değil**, depo
> **oluşturulmamış**, hiçbir kimlik bilgisi üretilmemiş ve `R-030`/`R-031`/`R-032`
> **`OPEN`** durumdadır. Aşağıdaki bölümlerin "üretimde hiçbir şey
> etkinleştirilmemiştir" ifadeleri **hâlâ doğrudur**; değişen tek şey, artık
> etkinleştirmeye **izin verilmiş** olmasıdır.
>
> **`F4-FCR-002A` ön koşulu (2026-08-15).** İlk gerçek restore tatbikatı,
> `scripts/noramedi-pgbackrest-restore-drill.sh`'in F4-FCR-002A sertleştirmesi
> uygulanmadan **çalıştırılmayacaktır**: TCP `trust` kimlik doğrulamasının
> kaldırılması, hataya-kapalı (fail-closed) temizlik, başlangıç GUC'lerinin
> sabitlenmesi, port ve `/dev/shm` ön kontrolleri, uygulama ve kiracı-izolasyonu
> smoke testleri, göç (migration) kümesi karşılaştırması ile zorunlu RPO/RTO
> kanıtı. Bu ön koşul karşılanmadan üretilen hiçbir çıktı **R-032 kanıtı
> değildir**.

F4-FCR-001'den farklı olarak bu görev, [`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2 satır 18'in yasakladığı "**any live backup/PITR implementation**" tanımının **tam olarak içine giren** bir yeteneği hedeflemektedir. Bu nedenle:

- **Depo (repository) çalışması yapılmıştır** — §4'ün açıkça izin verdiği "backup/PITR **design**" ve dokümantasyon sınırının ötesine geçen hiçbir **canlı** eylem gerçekleştirilmemiştir.
- **Üretimde hiçbir şey etkinleştirilmemiştir.** `archive_mode` `off` olarak kalmıştır; pgBackRest kurulmamıştır; depo oluşturulmamıştır; hiçbir kimlik bilgisi üretilmemiş, hiçbir bayt sunucu dışına taşınmamıştır.
- **Dar kapsamlı istisna metni hazırlanmıştır** ([`runbooks/F4_RECOVERY_OPERATIONS.md`](../runbooks/F4_RECOVERY_OPERATIONS.md) §14) ve **2026-08-15'te program sahibi tarafından verilmiştir** (yukarıdaki kayıt). Hiçbir ajan kendi kendini onaylayamaz (tracker §2.3); bu kayıt bir ajanın değil, program sahibinin kararıdır.

> **Program sahibine not (F4-FCR-001'in kaydettiği yönetişim boşluğu, tekrarlanmamıştır):** İstisna verilirse, F4-1A emsalindeki gibi **bu dosyaya** `F4-FCR-002_SCOPED_FREEZE_EXCEPTION = AUTHORIZED_BY_PROGRAM_OWNER_<tarih>` biçiminde kaydedilmelidir. Yalnızca bir kanıt dosyasında ilan etmek, yukarıda 21. satırda kayıtlı olan ve `FILE_BACKUP_COVERAGE_001`'in düştüğü boşluğun aynısıdır.

### Üretim yedekleme gerçekliği — artık kanıtlı

`/usr/local/sbin/noramedi-db-backup.sh` ve `/etc/cron.d/noramedi-db-backup` operatör tarafından **salt-okunur olarak temin edilmiştir** (2026-08-15). Bu, F4-FCR-001'in 41. satırda "bu programda hiç okunmamıştır" diye kaydettiği ön koşulu kapatır.

| Özellik | Değer |
|---|---|
| Yedekleme komutu | `pg_dump -Fc` (PostgreSQL custom format) |
| Zamanlama | Günlük 03:15 (cron) |
| Saklama | 7 gün (**betik tarafından gerçekten uygulanıyor**) |
| Çakışma koruması | `flock` |
| Dosya izinleri | `0600`, `umask 077`, geçici dosya → atomik `mv` |
| Parola kaynağı | `/root/noramedi-db-password.txt` (dosya; `PGPASSWORD` **değil**) |
| Sunucu dışı kopya | **YOK** · WAL arşivleme **YOK** · PITR **YOK** |
| Format şifrelemesi | **DOĞRULANMADI** — `chmod 600` bir dosya sistemi iznidir, şifreleme değildir |

**Doğrulanan varsayımlar:** `backupService.ts:38`'deki `BACKUP_FILENAME_RE` betiğin ürettiğiyle eşleşmektedir; `backupService.ts`'in yalnızca *gösterdiği* 7 günlük saklama süresi **gerçekten uygulanmaktadır** (depo kodu tarafından değil, betik tarafından). F4-FCR-001'in "hiçbir depo kodu bir şey budamıyor" tespiti geçerliliğini korur; değişen, operasyonel sonucun artık varsayım değil kanıt olmasıdır.

**Değişmeyen gerçek:** en kötü durum RPO ≈ 24 saat. İlk-müşteri hedefi olan ≤ 60 dakika **karşılanmamaktadır** ve bu mekanizmanın zamanlamasında yapılacak hiçbir değişiklikle karşılanamaz — bu boşluğu yalnızca sürekli WAL arşivleme kapatır.

### Bu görevin yaptığı

| Yetenek | Önce | Sonra |
|---|---|---|
| pgBackRest yapılandırması | Depoda **hiç yok** (`pgbackrest` için sıfır kod referansı) | Şifreli yerel `repo1` şablonu; `repo2` yorum satırında ve açıkça yetkisiz |
| PostgreSQL PITR yapılandırması | Yok | Ek (additive) drop-in şablonu: `archive_mode`, `archive_command`, `archive_timeout=300` |
| Operatör aktivasyon güvenliği | Yok | `noramedi-pgbackrest-preflight.sh` — 4 host gerçeğini okur, niyetlenen değişikliği yazdırır, **belirsizlikte reddeder**, yalnızca `--apply` ile yazar, **PostgreSQL'i asla yeniden başlatmaz** |
| Disk tükenmesi koruması | Yok | Yedekleme sarmalayıcısında **abort** (uyarı değil) — istisna metninin talep ettiği koşul; ölçülemeyen disk de fail-closed |
| WAL/PITR gözlemlenebilirliği | Yok | Ayrı systemd timer'lı durum yazıcısı → `pitr-status.json` → opscheck `pitr` kontrolü (bit 128) → Healthchecks.io → operatör e-postası |
| PITR restore kanıtı | Yapısal olarak imkânsız | `noramedi-pgbackrest-restore-drill.sh` — tek kullanımlık, RAM destekli, yalnızca loopback küme; şema/migration/bütünlük kontrolleri; ölçülen RPO/RTO |
| Off-host iddiası | İkili (boolean), fazla iddialı olabilir | **Üç durumlu** `no`/`unproven`/`yes`; `yes` yalnızca repo2'den geçmiş bir restore tatbikatıyla kazanılır ve 30 günde süresi dolar |
| Platform Admin PITR görünürlüğü | Yok | Yeni panel; `unproven` ayrı bir durum olarak render edilir |
| Kabuk betiği testleri | **CI'da hiç çalışmıyordu** | `npm run test:shell` — 219 assertion, CI Layer 1'e bağlandı |

### Yol boyunca düzeltilen iki kusur

1. **`redactBackupLogLine()` pgBackRest parolasını redakte etmiyordu.** `repo1-cipher-pass=`, `cipher_pass=`, `--repo-cipher-pass=`, `"cipherPass":` — hepsi **hiç değişmeden** geçiyor ve `GET /api/platform/backups/logs` tarafından birebir sunuluyordu. Mevcut alternatiflerin hiçbiri eşleşemiyordu: `pgpass`/`password`/`passwd`/`pwd` çıplak `pass` alt dizesinden fazlasını gerektirir ve anahtar öneki kalıbı tire karakterini geçemez. Bu, kapsanmayan **tek** gizli-anahtar biçimiydi ve kaybı her yedeği kalıcı olarak kurtarılamaz kılan anahtardı. Ampirik olarak öncesi/sonrası doğrulandı; 9 regresyon vakası eklendi. PEM özel anahtar blokları da artık redakte edilmektedir.
2. **`scripts/` altındaki kabuk betiklerinde hiçbir otomatik koruma yoktu.** `log-privacy-guard` (yanlış kök, yanlış uzantı), `adminScriptsLogPrivacy.test.ts` (üç sabit `.ts` yolu), CI kabuk adımı (`scripts/test-runtime/*.sh` ile sınırlı) — hiçbiri kapsamıyordu ve depoda gizli-anahtar tarayıcısı bulunmamaktadır. Artık `npm run test:shell` her iki paketi de çalıştırır ve CI Layer 1'e bağlıdır; sözdizimi kontrolü `scripts/*.sh` tamamına genişletildi.

### Bu görevin YAPMADIĞI (ve neden)

- **Hiçbir üretim mutasyonu yok.** pgBackRest kurulmadı, `archive_mode` değiştirilmedi, PostgreSQL yeniden başlatılmadı, depo oluşturulmadı.
- **Mevcut `pg_dump` zinciri değiştirilmedi.** 03:15 cron, `/root/noramedi-backups`, parola dosyası, saklama süresi — hiçbiri dokunulmadı ve geçiş boyunca yedek (fallback) olarak kalır. Kaldırılması ayrı bir program kararıdır ve alınmamıştır.
- **Off-host etkinleştirilmedi.** İkincil Türkiye VPS'i **tedarik edilmemiştir**; DPA, E1–E5 yerleşim kanıtı ve subprocessor register güncellemeleri karşılanmamıştır.
- **Şema değişikliği yok, migration yok.** `RecoveryDrillRun` yeniden kullanılabilir durumdadır ancak bu görev ona satır yazan bir kod yolu eklememiştir — restore tatbikatı bir kabuk betiğidir ve sonucunu JSON olarak yazar. Bu boşluk bilinçli olarak **kaydedilmiştir**, sessizce tekrarlanmamıştır (bkz. runbook §12).
- **`RETENTION_DAYS` görüntüleme sabiti değiştirilmedi** — pgBackRest'in yerel saklama mekanizması onun yerini alacaktır, ancak yalnızca etkinleştirildiğinde.

### Riskler — hiçbiri kapatılmadı

`R-030`, `R-031`, `R-032` **`OPEN`** olarak kalır. Depo çalışması bunların hiçbirini kapatmaz; üretim kanıtı gerektirir. R-030'un artık **iki ayrı yarıya** ayrılması gerektiği kaydedilmiştir (`R-030-DB` kapatılabilir, `R-030-FILES` imaging birincil deposunun nereye konacağına bağlıdır) — bkz. runbook §16.1.

`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`.


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
| 2026-08-15 | F4-FCR-002 | pgBackRest/PITR/off-host kurtarma temeli **depo tarafında** kuruldu: şifreli yerel repo şablonu, additive PostgreSQL drop-in, operatör preflight (belirsiz durumda reddeder, PostgreSQL'i asla yeniden başlatmaz), disk-tükenmesi abort koşulu, ayrı systemd timer'lı PITR durum yazıcısı, opscheck `pitr` kontrolü (bit **128** — hiçbir mevcut çıkış kodu taşınmadı; opt-in), tek kullanımlık RAM-destekli kümede PITR restore tatbikatı, **üç durumlu** off-host raporlaması ve Platform Admin paneli. Yol boyunca iki kusur düzeltildi: `redactBackupLogLine()` pgBackRest depo parolasını **hiç** redakte etmiyordu ve `scripts/` altındaki kabuk betiklerinin **hiçbir** otomatik koruması yoktu (artık `npm run test:shell`, CI Layer 1). **Üretimde hiçbir mutasyon yok**; `archive_mode` `off` kalır; mevcut 03:15 `pg_dump` zinciri değiştirilmedi; dar kapsamlı dondurma istisnası **TASLAK — VERİLMEDİ** *(**[2026-08-15, F4-FCR-002A tarafından GEÇERSİZ KILINDI]** — istisna aynı gün, bu satır yazıldıktan sonra verilmiştir: `AUTHORIZED_BY_PROGRAM_OWNER_2026-08-15`, bkz. bu dosyadaki F4-FCR-002 bölümünün `F4-FCR-002_SCOPED_FREEZE_EXCEPTION` anahtar satırı ve altındaki "istisnanın kaydı" bloğu ile `NORAMEDI_MASTER_TRACKER.md` §5.1. Özgün ifade tarihsel kayıt olarak korunmuştur.)*. Faz durumu `TODO` olarak **değişmedi**; R-030/R-031/R-032 `OPEN` kalır; `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. |
| 2026-08-15 | F4-FCR-002A | İzole restore/PITR tatbikatı **yalnızca ön kontrol (PRE-FLIGHT)**; **restore ÇALIŞTIRILMADI**. Canlı üretim kanıtına karşı 27 bölümlük GO/NO-GO raporu üretildi; sonuç **`PREFLIGHT_DECISION = NO_GO`** — güvenlik tasarımı nedeniyle değil, hazırlık eksikleri nedeniyle. Geçen kapılar: `DISK_CAPACITY_GATE = PASS`, `PG_VERSION_COMPATIBILITY_GATE = PASS` (PostgreSQL 16.14), `MIGRATION_COMPATIBILITY_GATE = PASS` (dağıtılmış 73 = DB 73; `origin/main` 74 ile bir sürüm önde, bu beklenen deploy gecikmesidir), `TENANT_ISOLATION_SMOKE_GATE = PLANNED_SAFE`, `PITR_MARKER_GATE = PLANNED_SAFE`, `MARKER_ARCHIVE_GATE = PASS`. **Uygulama smoke Stage B = BLOCKED**: `RUN_BACKGROUND_JOBS` yalnızca API sürecini devre dışı bırakır, worker onu hiç okumaz (`backgroundJobsOwnership.ts:65-70`), mesajlaşma kimlik bilgileri veritabanı satırlarındadır ve `withJobLock` geri yüklenen veritabanının kendi kilitlerine yazar — gerçek hastalara çift gönderim riski. Güvenli yol Stage A (yalnızca SQL invariant'ları) + `noramedi-pitr-app-smoke.mjs`'dir; bu yardımcı uygulamayı hiç başlatmaz. Depoda **en küçük eklemeli düzeltme** yapıldı: tatbikata deterministik **PITR durma noktası doğrulaması** eklendi (marker A = 1, marker B = 0, replay ≤ hedef, fail-closed, R-032 uygunluğu buna bağlandı, kanıt kalıcı sonuç belgesine yazılıyor) + 19 yeni kabuk testi. Üretime **onaylı, klinik olmayan** bir marker çifti yazıldı (`runId = F4-FCR-002A-20260815-01`, hiçbir kiracıya ait olmayan sentinel `organizationId`, uygulamanın kendi `recordOperationalEvent()` servisi üzerinden); WAL'ı arşivlendiği doğrulandı (`000000010000000000000020`, `failed_count = 0`, `.ready = 0`). Marker zaman damgalarının **UTC** olduğu üretim kanıtıyla saptandı; bu koşunun hedefi **`2026-08-15 12:59:26.405500+00`**'dır ve önceki `+03` hedefi reddedilmiştir — kural artık hem tatbikatta zorlanır (`--pitr-run-id` ile ofsetsiz `--target` reddedilir) hem de sonuç belgesine `markerTimestampZone` olarak yazılır. Dondurma istisnası çelişkisi §5.1'de **yalnızca yönetişim kayıtlarına dayanarak** çözüldü; üretimin fiilî aktivasyon durumu yetki kanıtı olarak **kullanılmadı**. **Faz durumu `TODO` olarak değişmedi**; **F4-FCR-002A KAPANMADI** (`IN_PROGRESS`); R-030/R-031/R-032 `OPEN` kalır; `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. |
| 2026-08-15 | F4-FCR-002A-R4 | **İki tatbikat çalıştırıldı; ikisi de `FAIL`.** Birinci tatbikat bayat girdiyle kapandı (migration kümesi **73/74**, **RPO = 385 dk**); taze bir tam yedek alındı (`20260815-224355F`). İkinci tatbikat (`runId = F4-FCR-002A-20260815-02`) **PITR durma noktasını** (marker A = 1, marker B = 0, hedef `2026-08-15 19:46:39.550000+00`, replay `2026-08-15T19:46:00Z`), **74/74 migration**'ı (`missing=0`, `ahead=0`), **tenant izolasyonunu** (klinikler arası randevu = 0, yetim klinik referansı = 0), **RPO = 3 dk ≤ 60 dk**, **RTO = 5 sn ≤ 14400 sn** ve **temizliği** geçirdi — ve **yalnızca uygulama smoke'unda** kapandı: `Unknown property datasources provided to PrismaClient constructor`. Kök neden: `scripts/noramedi-pitr-app-smoke.mjs` istemciyi `datasourceUrl`/`datasources` ile kuruyordu, oysa dağıtılmış çalışma zamanı (`server/src/db.ts:15-22`, `@prisma/client` + `@prisma/adapter-pg` **7.9.1**) Prisma 7 **sürücü adaptörü** kullanır; ayrıca boş bir `catch (_)` ilk (gerçek) hatayı yutup yalnızca ikinci denemenin mesajını raporluyordu. **Düzeltme (yalnızca depo):** yardımcı artık dağıtılmış istemcinin **sürümünü okuyup** yolu seçer — major ≥ 7 ise `@prisma/adapter-pg`'yi de dağıtılmış dizinden yükleyip `new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, ... }) })` kurar, major < 7 ise `datasourceUrl` kullanır, sürüm okunamazsa veya adaptör eksikse **fail-closed** olur; tatbikat betiği adaptörü artık **restore'dan önce** ön kontrol eder. `server/src/db.ts` içe aktarılmaz (üretim `DATABASE_URL`'ini çözerdi); bağlantı yalnızca tatbikat unix socket'ine, parolasızdır, havuz `max: 1`'dir; socket güvenlik kontrolleri, tipli delege probe'ları ve `current_setting('port')` kanıtı korunmuştur. Kusuru hiçbir testin yakalamamış olmasının nedeni, mevcut süitteki tüm smoke vakalarının **kurulumdan önce** düşmesiydi; yeni `scripts/noramedi-pitr-app-smoke.test.sh` sahte bir dağıtılmış sürüm dizini ile gerçek kurulum yolunu sürer (**50/50 geçer**; düzeltme öncesi yardımcıya karşı **22 assertion başarısız** olur ve üretim hatasının tam metnini üretir) ve CI Layer 1'de `npm run test:shell` ile koşar. **Şema/migration YOK, üretim mutasyonu YOK, tatbikat yeniden çalıştırılmadı.** Faz durumu `TODO` olarak **değişmedi**; **F4-FCR-002A KAPANMADI**; `R032_ELIGIBLE = false`; R-030/R-031/R-032 `OPEN` kalır; `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`. |
| 2026-08-15 | F4-FCR-002A-CLOSE | **Kontrollü üretim PITR tatbikatı `PASS` — beşinci denemede.** Üretim sürümü `309351885c1389c53d40e4b15e630264dc54954f` (PR #427 merge commit, dağıtıldı), yedek `20260815-224355F`, marker `runId = F4-FCR-002A-20260815-03` (A `2026-08-15T21:25:33.447Z`, B `2026-08-15T21:27:36.605Z`, UTC), hedef `2026-08-15 21:26:35.026000+00`, marker WAL `00000001000000000000008C`, tatbikat `run_id = 20260815-213109-709154`. **PITR durma noktası VERIFIED** (marker A = 1, marker B = 0, kurtarma noktası `2026-08-15T21:26:00Z`); migration **74/74** (`missing=0`, `ahead=0`); 106 public tablo; **uygulama smoke `passed`**; **tenant izolasyon smoke `passed`** (klinikler arası randevu 0, yetim klinik referansı 0, yetim randevu 0, RLS 0/0); **RPO 5 dk ≤ 60 dk**; **RTO 7 sn ≤ 14400 sn**; **temizlik doğrulandı** (`/dev/shm/noramedi-pitr-drill-20260815-213109-709154` silindi). `RESULT = PASS`, `R032_eligible = true`. **`R-031` → `CLOSED`, `R-032` → `CLOSED`** (her ikisi de kendi yazılı kriterleri üzerinden; runbook §21.5/§21.6). **`R-030` `OPEN` kalır** — kurtarma `repo1`'den yapıldı, `repo1` **YEREL**'dir ve veritabanı birincilinin arıza alanının içindedir; tatbikat `repo < 2`'den saha dışı kanıt yazmayı reddetti ve yazmadı; şifreleme dayanıklılık değildir. **`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`** (blokaj: `R-030`). Önceki dört başarısız tatbikat **başarıya çevrilmemiştir**; üçüncüsü yaşlanmış marker hedefiyle (96 dk) RPO'da, dördüncüsü sentinel `organizationId` uyuşmazlığıyla düşmüştür — sentinel farkı (`__noramedi_pitr_drill__` vs. `NORAMEDI_PITR_MARKER_ORG=noramedi-f4-pitr-sentinel`) runbook §21.7'de operasyonel kanıt olarak **kaydedilmiş, normalize edilmemiştir**. Yalnızca dokümantasyon: şema/migration/çalışma zamanı/üretim mutasyonu **YOK**. **Faz durumu `TODO` olarak değişmedi.** |
| 2026-08-16 | F4-3 | **Fiziksel silme güvenliği: kanıt, idempotency, kiracı sınırı — saklama politikası kararı ALINMADAN.** İki hasta-veri fiziksel silme yolu (`DELETE /patients/:patientId/attachments/:id`, `DELETE /lab-orders/:id/attachments/:attId`) DB satırını silip ardından `deleteFile`'ı **yutulmuş hatayla** çağırıyordu; silinen satır depolama anahtarını tutan **tek** yer olduğundan başarısız bir depo silmesi **kalıcı, alarmsız, uzlaştırılamaz** bir yetim üretiyor ve çağırana başarı bildiriliyordu — KVKK açısından kanıtlanamayan bir silme iddiası. Yol boyunca ikinci ve daha geniş bir kusur bulundu: **`fileStorage.deleteFile` yerel modda HER `unlink` hatasını yutuyordu** (`EPERM`/`EACCES`/`EBUSY`/`EROFS`/G-Ç dâhil), yani depodaki **tüm** çağıranlar gerçekleşmemiş silmeleri başarılı sanıyordu; artık yalnızca `ENOENT` yutulur. Yeni `services/storageObjectDeletion.ts` **paralel sistem icat etmeden** (`writeAuditLog` + `recordOperationalEvent` + export artefaktlarının zaten kabul edilmiş idempotency deseni) şunları getirir: anahtarın sahibi kliniğin id'siyle öneklenmiş olmasını zorunlu kılan **fail-closed kiracı sınırı** (`rejected_tenant_mismatch` — hiçbir şey silinmez), boş/traversal/UNC/sürücü-göreli/kontrol-karakterli anahtar reddi, "zaten yok = terminal başarı" idempotency'si (**yalnızca** kiracı-kapsamlı anahtar `already_absent`'e yükseltilebilir — `fileExists()` eski mutlak yol için `false` döndüğünden aksi hâlde uydurma başarı üretirdi), her sonuçta (retler dâhil) klinik/organizasyon/entity/aksiyon/`requestedAt`/`executedAt`/sonuç/hata-kodu/aktör taşıyan `AuditLog` kanıtı, ve terminal olmayan her sonuçta `severity=error` `OperationalEvent` — DB satırı gittikten sonra nesneyi **hâlâ adlandıran** tek artefakt. **Yeni PHI havuzu yaratılmadı:** kiracı-kapsamlı anahtar opaktır ve birebir yazılır, eski mutlak yol dosya adı taşıyabildiği için yalnızca SHA-256 **özeti** saklanır. Lab eki DB silmesi id-yalnız `delete`'ten `labWorkOrderId` + siparişin kendi `clinicId`'si ile kapsamlı `deleteMany`'ye daraltıldı. **DB-önce sıralaması bilinçle korundu** — nesneyi öne almak PR #163'ün kapattığı legal-hold TOCTOU penceresini yeniden açardı. **Saklama süresi belirlenmedi, canlı silme endpoint'i açılmadı, sağlayıcı object-lock etkinleştirilmedi/iddia edilmedi, imaging port yoluna dokunulmadı, ŞEMA/MIGRATION YOK, üretim mutasyonu YOK.** İki gerçek şema boşluğu **uygulanmadan rapor edildi**: **`R-079`** (`LabOrderAttachment`'ta `legalHold` alanı yok → üç ek-silme yolundan biri legal-hold kapısı taşımıyor) ve **`R-080`** (dayanıklı silme niyeti/otomatik yeniden deneme yok; ters-yetim tespiti hâlâ yok). Ayrıca iki test kusuru düzeltildi: `kvkkAttachmentImagingLifecycle.test.ts`'in `getDeleteRouteBlock()` fonksiyonundaki **3500 karakterlik sabit pencere** rotayı sessizce kesip iddiayı yanlış-negatife çeviriyordu, ve statik taramalar yorum satırlarını canlı çağrı yeri sanıyordu. **Birincil nesne silmenin yedeklerden silme ANLAMINA GELMEDİĞİ** açıkça belgelendi (`docs/compliance/53` §16A). Testler: `test:storage-deletion-evidence` 23/23, `test:kvkk-lifecycle` 111/111, `test:lab-orders` 32/32, `test:patient-privacy` 38/38, `test:storage-key-contract` 41/41, `test:clinic-bulk-export` 117/117, `test:imaging` 103/103, `test:data-retention` 43/43, `test:dental-chart-clinic-scope` 17/17, typecheck exit 0, log-privacy-guard exit 0. **Faz durumu `TODO` olarak değişmedi**; F4-2/R-030 ve F4-1A2 **dokunulmadı**. |
| 2026-08-16 | F4-3-R1 | **PR #430 mimari inceleme düzeltmesi — dayanıklı kanıt değişmezi.** İnceleme, görevin temel güvenlik iddiasının ("satır silindikten sonra başarısız fiziksel silme, nesneyi adlandıran dayanıklı kanıt sayesinde uzlaştırılabilir kalır") **henüz sağlanmadığını** doğru şekilde tespit etti: ilk uygulama kanıtı `writeAuditLog` + `recordOperationalEvent` ile yazıyordu ve **her ikisi de kendi kalıcılık hatasını yutar**, dolayısıyla "DB satırı silindi → depo silmesi başarısız → her iki kanıt yazımı da sessizce başarısız → çağıran `failed` (izleniyor) görür → nesne duruyor, adlandıran hiçbir şey yok" dizisi hâlâ mümkündü. **Düzeltme:** yetkili kanıt yazımı, deponun zaten kabul edilmiş **yutmayan** audit yazıcısı `writeAuditLogInTx`'e taşındı (global istemci `Pick<PrismaClient, 'auditLog'>` imzasını karşılar; **yeni tablo/kuyruk/servis/migration YOK**); `recordOperationalEvent` yalnızca **ikincil uyarı** olarak kaldı. Sonuç sözleşmesi genişletildi: `outcome` yeni `evidence_persistence_failed` değerini alabilir (izlenen `failed` ile karıştırılamaz), `storageOutcome` depo tarafındaki gerçeği maskelenmeden taşır, `evidence` alanı commit durumunu söyler, `isReconciliationSafe()` değişmezi tek yüklemde toplar. Değişmez: satır silindikten sonra **ya (A)** fiziksel silme terminal başarıdır **ya da (B)** kanıt kaydı commit edilmiştir; sessiz üçüncü durum yoktur — ihlalde süreç günlüğüne `UNEVIDENCED ORPHAN RISK` yükseltilir ve her iki DELETE rotası `success: true` yerine `500` + `STORAGE_DELETE_UNEVIDENCED` + `recordDeleted: true` döner (depolama anahtarı/dosya adı açığa çıkarılmaz); yükleme geri-alma yollarındaki `.catch(() => {})` yutması kaldırıldı. **Kapsam dürüstlüğü:** düzeltme, başarısızlığın ya kanıtlandığını ya da kanıtlanamadığının yüksek sesle bildirildiğini garanti eder; veritabanı erişilemezken kaydı kalıcı **yapamaz** — o durumda garanti kalıcılık değil dürüst raporlamadır. Otomatik yeniden deneme hâlâ yok (`R-080` **açık**), `R-079` **açık**. Testler: `test:storage-deletion-evidence` **23 → 33** (yeni §7, Prisma delegesinde **enjekte edilen** kalıcılık hatasıyla davranışsal kanıt — kaynak taraması değil), `test:kvkk-lifecycle` 111/111, `test:lab-orders` 32/32, `test:patient-privacy` 38/38, `test:storage-key-contract` 41/41, `test:clinic-bulk-export` 117/117, `test:imaging` 103/103, `test:data-retention` 43/43, `test:dental-chart-clinic-scope` 17/17, `test:orphan-file-inspection-log-privacy` 1/1, typecheck exit 0, log-privacy-guard exit 0, `git diff --check` exit 0. **MIGRATION YOK, üretim mutasyonu YOK, faz durumu `TODO` değişmedi**; F4-2/R-030 ve F4-1A2 dokunulmadı. |
| 2026-08-16 | F4-3-R2 | **`R-079` için kapanış önerildi (o gün `CLOSED` DEĞİLDİ; **aynı gün `F4-3-R079-CLOSE` ile `CLOSED`'a geçti** — bir alttaki satır) — lab eki legal-hold kapısı (en küçük eklemeli migration).** F4-3/F4-3-R1 lab eki silmesini kiracı-kapsamlı ve **kanıtlanabilir** hâle getirmişti; **engellenebilir** hâle getirmemişti — `LabOrderAttachment` modelinde `legalHold` sütunu yoktu, dolayısıyla deponun üç ek-silme yolundan biri hiçbir legal-hold kapısı taşımıyordu. Program sahibinin yetkisiyle **yalnızca R-079 için** eklemeli migration oluşturuldu: `legalHold Boolean @default(false)` + `legalHoldReason String?` + `@@index([clinicId, legalHold])` — `PatientAttachment` emsalinin birebir aynı şekli. `legalHoldAt`/`legalHoldById` **eklenmedi** (kabul edilmiş sözleşmede yok; aktör/zaman `AuditLog`'ta), `storageVerifiedMissingAt` **eklenmedi** (yetim incelemesine ait; `orphanFileInspection.ts` lab eklerini hiç dolaşmaz), saklama/lifecycle/silme-niyeti alanları **eklenmedi**. **Değişmez:** yetkilendirme kararı tek koşullu `deleteMany({ id, labWorkOrderId, clinicId, legalHold: false })` yüklemidir — ön-okuma yalnızca metadata içindir ve hiçbir şeyi yetkilendirmez; `count === 0` üç nedeni kiracı kapsamını genişletmeden ayırır (satır yok → `404`; tutuluyor → `409 ATTACHMENT_LEGAL_HOLD` + PII'siz denetim; sahiplik uyuşmazlığı → bu dala hiç ulaşamaz). **Tutulu dalda DB silmesi, fiziksel depo silmesi ve gerçekleşmemiş bir denemeyi iddia eden depo-silme kanıtı YOKTUR.** Kiracı sahipliği değişmedi (`erişilebilir klinik id'leri → LabWorkOrder → order.clinicId`); `req.user.clinicId` hiçbir yerde doğruluk kaynağı değildir. Alan-üstü genel bir legal-policy çerçevesi **yaratılmadı** — `attachments.ts`/`imaging.ts` zaten alan başına ayrı PATCH ucu taşıdığından aynı emsalle `PATCH /api/lab-orders/:id/attachments/:attId/legal-hold` eklendi (`authorize(['OWNER', 'ORG_ADMIN'])`, **yeni rol icat edilmedi**, `LAB_ORDER_MANAGE_ROLES`'tan bilinçle dar; her iki yönde gerekçe zorunlu ve denetimli; yazım da sahiplik yüklemiyle kapsamlı `updateMany`). `legalHoldReason` üç okuma yolunda da rol-kapılı redaksiyondan geçer; `legalHold` boolean'ı hiç redakte edilmez. **Migration** `20260816130000_add_lab_order_attachment_legal_hold` expand-only; mevcut satırlar `legalHold = false` alır (geriye dönük hold **uydurulmaz**); tek kullanımlık PostgreSQL 16: `migrate deploy` exit 0, **75 migration**, unfinished 0, rolled-back 0, `migrate status` up-to-date, `information_schema` doğrulandı, drift çıktısında `LabOrderAttachment`/`legalHold` ile ilgili **hiçbir kalıntı yok**. **Geri alma:** önce uygulama; sütunlar okunmadıkça zararsızdır — üretimde sütun düşürmek acil geri alma yolu **değildir**. **Testler (davranışsal):** yeni `test:lab-attachment-legal-hold` **21/21** (gerçek rota zinciri, diskte gerçek nesneler, ön-okuma ile atomik silme arasına hold yerleştiren TOCTOU kancası), `verify-attachment-legal-hold-lifecycle.ts` §6 **34/34** gerçek Postgres'te — **zorlanmış kilit çakışması** dâhil (DELETE satır kilidinde beklerken hold commit edilir; DELETE READ COMMITTED altında yüklemi yeniden değerlendirip 0 satır etkiler), `test:storage-deletion-evidence` **33 → 34**, `test:kvkk-lifecycle` **111 → 113**, `test:lab-orders` 32/32, `test:patient-privacy` 38/38, `test:storage-key-contract` 41/41, server `typecheck` exit 0, `log-privacy-guard:scan` exit 0, `guardrail:scan` exit 0, `git diff --check` exit 0. Yeni takım **CI kapısıdır** (`server:test:non-disposable`). **Mimari inceleme düzeltmesi (aynı PR):** `test:storage-deletion-evidence` ve `test:kvkk-lifecycle` de `server:test:non-disposable`'a eklendi — ilki hiçbir toplu zincirin üyesi değildi, ikincisi yalnızca `STORAGE_IMAGING` PR'larında atlanabilen Katman 5b zincirindeydi; bu PR her ikisini de değiştirdiği hâlde ikisi de bloke edici bir kapı değildi. **Bu tur `CLOSED` iddia etmedi:** o anki lifecycle `agent completed = YES`, `tests passed = YES`, `PR opened = YES`, `merged = NO`, `deployed = NO`, `production verified = NO` idi — **PR #431 aynı gün birleştirilip dağıtıldı ve üretimde doğrulandı; bu üçü `YES` oldu ve `R-079` `F4-3-R079-CLOSE` kaydıyla `CLOSED`'a geçti (o kaydın kendi PR'ı #432 hâlâ taslaktır).** **`R-080` açık kalır; faz durumu `TODO` değişmedi; F4-2/R-030 ve F4-1A2 dokunulmadı.** |
| 2026-08-16 | F4-3-R079-CLOSE | **`R-079` `CLOSED` — üretim doğrulaması kaydedildi. Yalnızca belge; çalışma zamanı dosyası, şema, migration, test, CI veya dağıtım betiği değişmedi; üretim mutasyonu yapılmadı (doğrulamayı program sahibi yürüttü, bu tur onu yalnızca kayda geçirir).** Baseline `origin/main` @ `b370b0181fa2f84e24f0f80560425da81f60dcb2` — PR #431'in merge commit'i ve aynı zamanda üretim release SHA'sı. Üretim host'u `disklinik-prod-01`; migration `20260816130000_add_lab_order_attachment_legal_hold`; `prisma migrate status` **75 migration bulundu, veritabanı şeması güncel**; üretim şeması `legalHold boolean NOT NULL DEFAULT false`, `legalHoldReason text NULL`, `LabOrderAttachment_clinicId_legalHold_idx ("clinicId","legalHold")` olarak doğrulandı; Prisma Client v7.9.1; `noramedi-api` + `noramedi-worker` reload, ikisi de `online`, `RELEASE_SHA` değerleri eşleşti; local `/api/health` `200 {"status":"ok"}`, local `/api/readyz` `200` (`database: ok`, `redis: ok`), external `https://api.noramedi.com/api/health` `200`. **Doğrulama demo klinik `gebzedisdunyasi` (`5211acf4-6a1c-49ec-a23b-a677b89133ea`) üzerinde yapıldı — canlı gerçek müşteri yoktur, gerçek müşteri verisi kullanılmamıştır**; aktör `0a711de6-d860-4198-be2c-ffbe8195d581` (saklanan rol `admin`, `canAccessAllClinics=true` ⇒ merkezî rol normalizasyonuna göre kanonik `OWNER`); depolama modu **`remoteStorageEnabled=false`** (bu, F4-1/F4-2 uzak depolama hedefleri hakkında **hiçbir şey** söylemez). **Altı adım, altısı da `PASS`:** (1) PATCH hold `legalHold=true` → `200`, DB `legalHold=true` + `legalHoldReason="F4-3 R-079 production verification"`; (2) DELETE → `409` + `{"error": "ATTACHMENT_LEGAL_HOLD", ...}`; (3) DB satırı ve gerekçe korundu; (4) `AuditLog`'da `lab_order_attachment_legal_hold_set` ve `lab_order_attachment_delete_blocked_legal_hold`; (5) fiziksel nesne korundu — `filePath 5211acf4-6a1c-49ec-a23b-a677b89133ea/1783356895177-5rowfgf37dr.png`, `fileExists=true`, `fileSize=525254`, `exit_code=0`; (6) hold kaldırıldı → `200`, `legalHold=false`, `lab_order_attachment_legal_hold_released`, son nesne durumu değişmedi. **Nüans:** kaldırma `legalHoldReason`'ı **null'lamaz**; son değer kaldırma gerekçesidir — bu kapanış için **kabul edilmiş mevcut davranıştır**, `R-079` başarısızlığı **değildir**. **Uygulama lifecycle (PR #431 — düzeltmenin kendisi):** `agent completed = YES` / `tests passed = YES` / `PR opened = YES` / `merged = YES` / `deployed = YES` / `production verified = YES` → **`R-079` = `CLOSED`**. **Kapanış kaydı lifecycle (`F4-3-R079-CLOSE` / PR #432 — bu belge satırı):** `agent completed = YES` / `docs validation = PASS` / `PR opened = YES` / **`PR state = DRAFT`** / **`merged = NO`** / `deployment = N/A (yalnızca belge)` / `production mutation = NONE` — kayıt hâlâ yetkili `main`'e birleştirilmeyi bekler ve `MERGED`/`DEPLOYED` olarak temsil edilmemelidir. **Kapanan yalnızca `R-079`'dur:** `R-080` `OPEN`; sağlayıcı object-lock, dayanıklı silme kuyruğu, otomatik yeniden deneme ve ters-yetim taraması yok ve iddia edilmiyor; `R-030`/`R-030-DB`/`R-030-FILES` `OPEN`; `FIRST_CUSTOMER_RECOVERY_GATE` değişmedi (`NOT_SATISFIED`, blocker `R-030-DB`); **`F4` fazı tamamlanmadı**; F4-2/R-030 ve F4-1A2 dokunulmadı. Kanıt: [../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md](../evidence/F4-3-R079_PRODUCTION_VERIFICATION.md). |

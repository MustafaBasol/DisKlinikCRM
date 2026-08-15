# F4 — Storage and Backup Foundation

Faz durumu: `TODO` · Son güncelleme: 2026-08-15 (F4-FCR-002A — yalnızca ön kontrol; **restore çalıştırılmadı**)

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



## F4-FCR-002A — İzole restore/PITR tatbikatı: YALNIZCA ÖN KONTROL (PRE-FLIGHT)

`F4-FCR-002A_STATUS = IN_PROGRESS` · **`PREFLIGHT_DECISION = NO_GO`**
`NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
Taban çizgisi: `origin/main` @ `def01bf6a2d4ec6bd7aea222979f7be60e29847e`

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

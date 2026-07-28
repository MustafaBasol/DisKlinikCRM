# TEST_OWNERSHIP — Test Mimarisi, Envanteri ve Sahiplik Haritası

Son güncelleme: 2026-07-28 (**F1-002-R1 — Parallel Evidence Integration and Main Reconciliation**, documentation/evidence-only. Integrates F1-002-P1 (Test Script Reachability and Runner Reconciliation, PR #255, `MERGED`) and F1-002-P2 (Test Runtime Dependency and Disposable Environment Baseline, PR #254, `MERGED`) into this document, reconciles F1-002 main's own count/script-chain vocabulary against their independently-derived numbers, and corrects two stale figures (§6, §7). See new §0.1 immediately below and [evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md) for the full process record.)

Prior update: 2026-07-28 (F1-002 — Test Inventory Refresh and Ownership Reconciliation, refreshed §3 onward against execution baseline `08f2eaf82a205cf3f997c57e6a295fedd66b142d`, replacing the 2026-07-19 F0-005 snapshot as the current authoritative inventory — historical text preserved below except where F1-002-R1 corrected it)

Prior update: 2026-07-19 (F0-005 rebaseline — historical, preserved below for lineage)

> **Durum:** §1–§2 **hedef** test mimarisini tanımlar (aşağıda F0-001'den değişmeden korunmuştur — etki-bazlı/affected test altyapısı bugün **mevcut değildir**, F1'in işidir, ve F1-001'in tasarımı bu mekanizmanın henüz implemente edilmediğini teyit eder). §3'ten itibaren, **F1-002 tarafından güncel `HEAD`'e karşı yenilenmiş** mevcut-durum (current-state) test envanteri, sahiplik ve script-erişilebilirlik verisi yer alır.
>
> **F1-002 refresh notu (2026-07-28):** F1-001'in kendi tasarım sürecinde bulduğu R-072 riski (test envanteri kanıtının F0-005'in 2026-07-19 taban çizgisine sabitlenmiş, güncel `HEAD`'e göre bayatlamış olması — 72→96→105 backend dosya, 6→9 frontend dosya) bu görev tarafından giderildi. Yürütme taban çizgisi `08f2eaf82a205cf3f997c57e6a295fedd66b142d` (beklenen başlangıç taban çizgisi `94cc4ac58f0487dd186886878c5628627f0b1ce3`'ün soyundan, ara commit'ler PR #242-#252 — KVKK yedekleme/saklama/AI-gizlilik/şema-bütünlüğü işi + bir gelir raporu düzeltmesi, hepsi olağan ileri ilerleme olarak incelendi). **Toplam test/doğrulama hedefi artık 137** (backend 105, frontend 9, bridge-agent 9, windows-bridge 8 proje/script, manuel disposable-DB doğrulama script'i 4, smoke/deploy script'i 2). Sıfır dosya kaldırıldı/yeniden adlandırıldı; 34 yeni backend + 3 yeni frontend + 1 yeni manuel doğrulama script'i eklendi; `aiPrivacyBoundary.test.ts` içerik olarak önemli ölçüde değişti (yeniden yazılmadı, `MEDIUM` güvenle taşındı). CodeGraph bu görev ortamında da **kullanılamadı** (F1-001 ile aynı bulgu) — hedefli dosya-sistemi envanteri, dosya-başlığı/import incelemesi ve programatik package-script ayrıştırması kullanıldı. Detay: evidence doc §1a, [F1-002_test_inventory.json](evidence/F1-002_test_inventory.json).
>
> Detaylı kanıt (F1-002, güncel): [evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md).
> Yapısal/makine-okunur envanter (F1-002, güncel — **yetkili**): [evidence/F1-002_test_inventory.json](evidence/F1-002_test_inventory.json) (137 test/doğrulama hedefi, sahiplik, script-erişilebilirlik, DB/harici-servis gereksinimleri).
> Script reconciliation (F1-002, güncel): [evidence/F1-002_test_script_reconciliation.json](evidence/F1-002_test_script_reconciliation.json).
> Sahiplik boşlukları (F1-002, güncel): [evidence/F1-002_test_ownership_gaps.json](evidence/F1-002_test_ownership_gaps.json).
> Script reachability (F1-002-P1, güncel, `MERGED` PR #255): [evidence/F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md](evidence/F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md), [evidence/F1-002-P1_test_script_reconciliation.json](evidence/F1-002-P1_test_script_reconciliation.json), [evidence/F1-002-P1_test_file_reachability.json](evidence/F1-002-P1_test_file_reachability.json).
> Runtime dependency baseline (F1-002-P2, güncel, `MERGED` PR #254): [evidence/F1-002-P2_TEST_RUNTIME_DEPENDENCY_BASELINE.md](evidence/F1-002-P2_TEST_RUNTIME_DEPENDENCY_BASELINE.md), [evidence/F1-002-P2_test_runtime_requirements.json](evidence/F1-002-P2_test_runtime_requirements.json), [evidence/F1-002-P2_disposable_environment_capabilities.json](evidence/F1-002-P2_disposable_environment_capabilities.json).
>
> **Historical (F0-005, 2026-07-19, superseded but preserved for lineage — not deleted):** [evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md](evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md), [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) (100 targets, includes the only runtime pass/fail execution record — F1-002 did not re-run tests, see below), [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json).
>
> **Kapsam dışı (F1-002'de yapılmadı, F0-005'te olduğu gibi):** test dosyası değişikliği, snapshot güncelleme, assertion gevşetme, skip ekleme, timeout değişikliği, package script ekleme/değiştirme, CI workflow değişikliği, yeni test framework/coverage tool kurulumu, runtime kaynak refactor'u, Prisma şema/migration değişikliği veya deploy'u, production/VPS erişimi, affected-test seçim mekanizmasının implementasyonu, **ve testlerin gerçek çalıştırılması (runtime pass/fail F0-005'in 2026-07-19 kaydında donmuş kalır — bu görev yalnızca envanter/sahiplik/script-erişilebilirliği yeniler, davranışı yeniden doğrulamaz).**

## 0.1 F1-002-P1/P2 entegrasyonu ve terminoloji uzlaştırması (F1-002-R1, 2026-07-28)

F1-002 main (bu doküman) ile paralel yürütülen iki bağımsız kanıt görevi dış incelemeden geçip `MERGED` oldu ve bu görev (F1-002-R1) tarafından burada indekslendi:

- **F1-002-P1 — Test Script Reachability and Runner Reconciliation** (PR #255, merge commit `954168ed4399f572e776fbfd30fa391aad574610`): her test-ilişkili package script'ini (103 script: 8 kök + 95 server) statik olarak ayrıştırdı, hangi dosyaların hangi script(ler) tarafından ulaşılabilir olduğunu (116 dosya: 105 backend + 9 frontend) belirledi.
- **F1-002-P2 — Test Runtime Dependency and Disposable Environment Baseline** (PR #254, merge commit `035d4db59cf429777a4bb71a5e72203f6c99b571`): 137 hedefin tamamı için runtime-sınıfı (17 grup), disposable-Postgres/MinIO gereksinimlerini ve mevcut provisioning kapasitesini (10 soruluk değerlendirme) belgeledi.

Her iki görev de yalnızca yeni kanıt dosyaları ekledi (paylaşılan hiçbir dosyayı değiştirmedi); F1-002 main ile `--no-ff` merge çakışmasız tamamlandı.

### Sayım terminolojisi — birbirinin yerine geçmez

| Terim | Sayı | Kapsam |
|---|---|---|
| Backend test dosyası | **105** | `server/src/tests/**/*.test.ts` |
| Frontend test dosyası | **9** | `src/**/*.test.ts(x)` |
| F1-002-P1'in "116 current test-related files" | **116** | 105 backend + 9 frontend + **2 fixture-loader yardımcı modülü** (`whatsappConversationFixtures.ts`, `whatsappSafetyFixtures.ts` — `test:fixtures`/`test:safety` tarafından çağrılan, ama kendileri `*.test.ts` olmayan dosyalar). Yalnızca JS/TS backend+frontend kapsamı; bridge-agent, windows-bridge, manuel script, smoke script'i **dahil değil**. |
| F1-002 main'in "137 test/verification targets" | **137** | 105 backend + 9 frontend + 9 bridge-agent + 4 windows-bridge .NET projesi + 4 windows-bridge PS1 script'i + 4 manuel disposable-DB doğrulama script'i + 2 smoke/deploy script'i. F1-002-P1'in 116'sından **daha geniş** bir kapsam (bridge-agent/windows-bridge/manuel/smoke dahil), 2 fixture-loader modülünü **saymaz** (onlar `*.test.ts` değil). |

**116 ve 137 aynı şey değildir ve birbirinin yerine kullanılmamalıdır** — biri (116) yalnızca JS/TS test-dosyası+fixture-loader erişilebilirlik kapsamı, diğeri (137) programın tüm test/doğrulama hedefi envanteridir. Backend (105) ve frontend (9) alt-toplamları her iki belgede de birebir aynıdır ve tutarlıdır.

### Script-chain terminolojisi — uzlaştırılmış sayılar

Görev talimatının kontrol etmemizi istediği rakamlar, P1'in JSON kanıtına karşı aşağıdaki şekilde uzlaştırıldı:

| İddia | Önceki metin (F1-002 main, §6) | P1 kanıtıyla uzlaştırılmış sayı | Sonuç |
|---|---|---|---|
| `npm run test` (server) zincirinden hariç tutulan script sayısı | "16" (6 orphan + 10 yeni) | **17** ([F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md](evidence/F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md) §4.1: 9 DB-gerekli bilinçli hariç + 8 görünür sebepsiz hariç) | **§6 metni aşağıda 17'ye düzeltildi.** Önceki "16" rakamı, `test:file-backup`'ı ayrı bir "1 istisna" olarak anlatıp toplama dahil etmeyen bir sunum hatasıydı (6+10+1=17 zaten doğruydu, yalnızca üç ayrı cümlede dağınık anlatılmıştı) — üretilen dosya farklı değil, yalnızca sunum P1'in tek-tablo biçimiyle netleştirildi. |
| Script'lerden hariç, dosya bazında | Örtük | **8 dosya, tümü DB-gerekli** (9 DB-script'i 8 benzersiz dosyaya karşılık gelir — `test:kvkk-high006-db-verification` kendisi 6 alt-script'i zaten zincirleyen bir agregatördür, ayrı bir dosya değildir) | Netleştirildi, çelişki yok. |
| Unscripted (hiç script'i olmayan) backend dosyası | 8 | **8** (P1 §5.1: `channelConsentGate`, `clinicLegalProfile`, `patientSharedPhone`, `platformBackup`, `treatmentPackagePermissions`, `kvkkHigh006Batch2ClinicScope`, `metaWhatsAppPostBookingHandler`, `planLimitsTargetClinicFix`) | Değişmedi, P1 tarafından bağımsız doğrulandı. |
| CI tarafından çalıştırılan JS/TS dosya sayısı | "4 backend + 3 frontend" (7/116) | **7/116** (P1 §7, `windows-bridge-pr.yml`, yalnızca imaging path'inde) | Değişmedi, P1 tarafından bağımsız doğrulandı — **109/116 (%94) hiçbir CI kapsamında değil.** |
| Full-suite-only (yalnızca agregatörle erişilebilen, kendi script'i olmayan) dosya | Örtük | **0** (P1 §5: strict `FULL_SUITE_ONLY` = 0 — zincirlenen her dosyanın kendi bireysel script'i de var) | Yeni netleştirme, F1-002 main'de yoktu. |
| Multiple-script reachable dosya | Örtük | **89** (kendi leaf script'i + 1 agregatör; 3+ yol yok) | Yeni netleştirme. |

Bu tabloda listelenmeyen tüm §6/§7 rakamları (0 stale script referansı, 77-script'lik `server:test` zinciri, vb.) P1 ile zaten tutarlıydı — değişiklik gerekmedi.

**§7'deki bir sayı hatası düzeltildi:** "7/9 frontend test dosyası CI kapsamında değil" ifadesi yanlıştı (aritmetik: 9 frontend − 3 CI-kapsamlı = **6**, 7 değil). P1'in kendi §7 tablosu frontend CI-kapsamlı 3 dosyayı açıkça adlandırır (`test:dicom-helpers`, `test:onboarding-helpers`, `test:pairing-poller`). **Düzeltilmiş: 6/9 frontend CI kapsamı dışında** (bkz. §7 aşağıda). Backend "101/105" rakamı zaten doğruydu, değişmedi.

### Runtime bağımlılık bulguları (F1-002-P2'den, özet)

Tam detay: [F1-002-P2_TEST_RUNTIME_DEPENDENCY_BASELINE.md](evidence/F1-002-P2_TEST_RUNTIME_DEPENDENCY_BASELINE.md), [F1-002-P2_test_runtime_requirements.json](evidence/F1-002-P2_test_runtime_requirements.json), [F1-002-P2_disposable_environment_capabilities.json](evidence/F1-002-P2_disposable_environment_capabilities.json).

- **22 dosya** disposable Postgres gerektirir (`DATABASE_URL`); **1 ek dosya** (`fileBackupDbIntegration.test.ts`) ayrıca bir **MinIO/S3-uyumlu object-storage emülatörü** gerektirir — bu, programın kanıt tarihindeki **ilk gerçek ağ bağımlılığı olan test**tir (veritabanı bağlantısı dışında).
- **Depoda commit edilmiş standart bir provisioning mekanizması yok** — desen en az 3 kez ad hoc olarak gösterildi (F0-011-P2, KVKK-HIGH-006, KVKK-HIGH-008 Faz B1) ama hiçbir zaman yeniden kullanılabilir bir script/Compose dosyası olarak paketlenmedi.
- **Collision-avoidance boşluğu**: paralel-agent güvenliği tasarlanmadı — port/veritabanı-adı çakışmalarını önleyen hiçbir registry veya dinamik tahsis mekanizması yok.
- **Deterministic-cleanup sınırlaması**: container-seviyesinde temizlik deterministiktir (`--rm`, volume yok) ve test-verisi seviyesinde konvansiyon-deterministiktir (self-truncating fixture'lar), ama depo-genelinde zorunlu kılınan bir mekanizma değildir.
- **Migration rollback tooling boşluğu — R-070 (hâlâ `OPEN`)**: fiziksel rollback teknik olarak mümkün (bir kez gösterildi) ama Prisma'nın kendi `_prisma_migrations` bookkeeping'i kendiliğinden uzlaşmaz (`P3012` hatası); programın kabul edilen önerisi retain-and-forward-fix, fiziksel rollback değil.
- **1 UNKNOWN runtime sınıflandırması**: `messagesConsentGate.test.ts`'in `EvolutionWhatsAppProvider` tip import'unun tamamen stub'lanmış bir yolda mı çalıştığı, yoksa satır-satır incelenmemiş bir kod yolunda canlı bir gönderim çağrısına ulaşıp ulaşamayacağı kesin olarak çözülemedi — `MEDIUM` güvenle işaretlendi, ne "evet" ne "hayır" olarak iddia edilmedi.
- **Sıfır doğrulanmış canlı sağlayıcı/ağ çağrısı**: 105 backend + 9 frontend dosyanın tamamında hiçbir gerçek Meta/Instagram/Evolution/SMS/AI sağlayıcı çağrısı bulunamadı — her biri stub/spy edilmiş.

**Bu bulgular runtime ortamının CI'a hazır olduğu anlamına gelmez** — tam tersi: 5 somut boşluk (provisioning script/Compose dosyası yok, MinIO provisioning yok, collision-avoidance yok, otomatik migration-rollback tooling yok, herhangi bir DB/storage servisi sağlayan CI workflow'u yok) F1-002-P2 tarafından açıkça listelenmiştir ve hiçbiri bu entegrasyon görevi tarafından kapatılmamıştır.

## 1. Hedef test mimarisi katmanları

| Katman | Kapsam |
|---|---|
| Module unit tests | Tek modülün saf birim testleri; DB/harici bağımlılık yok |
| Module service tests | Modül servis katmanı; gerektiğinde disposable DB ile |
| Module API tests | Modülün HTTP endpoint'leri; handler-level, gerçek doğrulama |
| Public contract tests | Modüller arası public contract'ların sözleşme testleri |
| Cross-module integration tests | Birden çok modülü kapsayan uçtan uca akışlar |
| Core security and tenancy regression | Tenant izolasyonu, permission matrisi, auth regresyonu |
| Migration tests | Şema migration'larının ileri/geri güvenliği |
| Nightly full regression | Gecelik tam kapsam |
| Release regression | Sürüm öncesi tam kapsam + ek kapılar |
| Production smoke tests | Canlı ortamda doğrulama testleri |

## 2. Hedeflenen CI modeli

### Pull request

- Etkilenen modül testleri (affected module tests)
- Etkilenen contract testleri
- Zorunlu core smoke/güvenlik testleri

### Main merge

- Etkilenen testler
- Build/typecheck
- Temel smoke

### Nightly

- Tam backend test kapsamı
- Tam frontend test kapsamı
- Migration testleri
- Tenant izolasyon testleri
- Permission matrisi
- Queue worker testleri
- Cross-module akışlar

### Release

- Nightly kapsamı
- Production-benzeri DB
- Upgrade migration testi
- Rollback provası
- E2E
- Güvenlik testleri
- Performans kapıları
- Deployment smoke

> Etki-bazlı (affected) seçim mekanizması **henüz mevcut değildir**; F1'de tasarlanıp kurulacaktır. Bu doküman yalnızca hedefi tanımlar.

## 3. Mevcut test envanteri — özet (F1-002, depo-kanıtıyla, 2026-07-28)

Yürütme taban çizgisi commit `08f2eaf82a205cf3f997c57e6a295fedd66b142d` (F0-005'in 2026-07-19 taban çizgisi `7fcf2f850f1` idi; F1-001'in kendi tasarım taban çizgisi `d0311636` — 2026-07-25 — R-072'yi bulduğu an idi). Tam 137 satırlık per-target kayıt (sahip domain, secondary domain, test tipi, runtime sınıfı, DB/harici-servis gereksinimi, script-erişilebilirliği, korunan kaynak dosyalar, güven seviyesi, kanıt referansı) [evidence/F1-002_test_inventory.json](evidence/F1-002_test_inventory.json) `testFiles[]` içindedir. Bu bölüm yalnızca özet sayıları verir.

| Alan | Sayı | Kanıt |
|---|---|---|
| Backend `server/src/tests/*.test.ts` | **105** (F0-005'te 72, F1-001'in kendi ara-ölçümünde 96) | `find server/src/tests -type f -name '*.test.ts'` (F1-002 tarafından yürütüldü) |
| Frontend test dosyası (`src/**/*.test.ts(x)`) | **9** (F0-005'te 6) | `find src -type f -name '*.test.ts(x)'`; 7'si ayrı `npm run test:*` script'ine, 2'si (`*.vitest.test.tsx`) `npm run test:vitest`'e (vitest glob `src/**/*.vitest.test.{ts,tsx}`) bağlı |
| bridge-agent test dosyası | 9 (değişmedi) | `bridge-agent/` içinde `npm run test` hepsini zincirler |
| windows-bridge .NET test projesi | 4 (değişmedi) | proje/script granülaritesinde envanterlendi — bkz. F0-005 evidence doc §1 (bu görevde yeniden ölçülmedi, yalnızca varlığı doğrulandı) |
| windows-bridge installer PowerShell test script'i | 4 (değişmedi) | CI'nin (`windows-bridge-pr.yml`) çağırdığı tam liste |
| Manuel disposable-DB doğrulama script'i (`server/scripts/verify-*.ts`) | **4** (F0-005'te 3; +1 `verify-kvkk-high007-high008-rollback-tenant.ts`) | tasarım gereği `npm test`'e bağlı değil, destructive/manual-only |
| Smoke/deploy script'i (`scripts/*.sh`) | 2 (değişmedi) | |
| **Toplam test/doğrulama hedefi** | **137** (F0-005'te 100) | `docs/program/evidence/F1-002_test_inventory.json` `countsExactCommands` |
| JS/TS test framework'ü / merkezi runner | **Kısmen değişti** | Backend testlerinin ezici çoğunluğu hâlâ `node:assert/strict` + elle yazılmış `test()/section()` yardımcı fonksiyonuyla, framework'süz çalışır. **Yeni:** 2 frontend bileşen testi artık gerçek bir framework kullanıyor (**vitest** + `@testing-library/react`, jsdom ortamı, `vitest.config.ts` ile) — F1-001'in R-072 bulgusunda zaten not edilmişti. Windows Bridge'in 4 .NET test projesi xUnit kullanır (`dotnet test`, bu görevde de SDK sürüm uyuşmazlığı nedeniyle çalıştırılamadı — framework eksikliğinden değil). |
| CI tarafından çalıştırılan test dosyası sayısı | **Değişmedi: 4 backend + 3 frontend + 4 dotnet + 4 ps1** (yalnızca `windows-bridge-pr.yml`, imaging path'inde) | 34 yeni backend + 3 yeni frontend dosyanın hiçbiri bu CI path kapsamında değil — aynı CI-uygulama boşluğunun 37 yeni örneği, bkz. §7 |

### 3.1 Sahiplik dağılımı (domain başına test/doğrulama hedefi sayısı, F1-002)

| Domain | Sayı | F0-005'e göre değişim |
|---|---|---|
| Privacy / Consent / Retention / Data Subject Rights | 27 | +11 (16→27; KVKK-HIGH-007/008/006, retention-manual-run-audit, schema-integrity, file-backup ile ilgili consent/audit dosyaları) |
| Imaging — Device Bridge / Windows Bridge | 22 | değişmedi |
| Tenant Security and Scope | 18 | +14 (4→18; KVKK-HIGH-006 Batch1-4 + 6 dbVerification clinic-scope dosyası + messaging-connection-scope + patients-import-clinic-scope + appointment-request-record-scope + dental-chart-clinic-scope + messages-record-scope + plan-limits-target-clinic-fix) |
| Messaging — WhatsApp | 12 | +2 |
| Appointments and Availability | 9 | +1 |
| Reporting / Analytics | 5 | +2 (revenue-by-period, clinic-scope) |
| Patients | 5 | +2 |
| Basic Payments | 5 | +1 |
| Identity and Access | 4 | değişmedi |
| Public Booking | 4 | değişmedi |
| Storage Abstraction | 3 | +2 (fileBackupService, fileBackupDbIntegration) |
| Messaging — Instagram | 3 | değişmedi |
| Observability / Operational Events | 3 | +1 (httpRequestLogPrivacy) |
| Platform Administration | 3 | +1 (platformAdminPasswordRecovery) |
| Messaging AI Orchestration | 3 | değişmedi |
| Imaging — Server Ingest and Viewer | 2 | değişmedi |
| Organization / Clinic / User Membership | 2 | değişmedi |
| Dental Laboratory / Prosthetics Tracking | 1 | değişmedi |
| Cross-Domain Contract | 1 | değişmedi |
| Automations / Reminders / Follow-up / Recall | 1 | değişmedi |
| Security Incident Response and Detection | 1 | değişmedi |
| Messaging — SMS | 1 | değişmedi |
| Permissions / Roles | 1 | değişmedi |
| Repository/Build Tooling | 1 | değişmedi |

**Sahip test dosyası sıfır olan domainler (değişmedi, F0-005'ten korunmuştur):** Entitlements and Release Flags, Audit and Activity, Configuration and Secrets, Shared Events / Queue Contracts / Idempotency, Notifications, Treatment Cases *(yalnızca secondary domain olarak geçiyor, hiçbirinde primary sahip değil)*, Dental Chart / Procedures *(F1-002'de bir test — `dentalChartClinicScope.test.ts` — bu domaine yalnızca **secondary** olarak eklendi, primary sahibi Tenant Security and Scope)*, Tasks and Follow-up, Messaging — Email, Inventory *(F1-002'de yalnızca secondary olarak görünüyor)*, Insurance *(F1-002'de yalnızca secondary olarak görünüyor)*, Advanced Finance — Compensation and Payouts. **0 UNKNOWN sahiplik** — bkz. [evidence/F1-002_test_ownership_gaps.json](evidence/F1-002_test_ownership_gaps.json). Bu, pre-existing bir kapsam boşluğudur, F1-002 tarafından yaratılmamış veya kötüleştirilmemiştir; R-072 kapanışı için engelleyici değildir (R-072 envanter/sahiplik güncelliği hakkındadır, her kapsam boşluğunun kapatılması hakkında değil).

## 4. Runtime ölçüm sonuçları — özet (F0-005, 2026-07-19'da donmuş — F1-002 testleri yeniden ÇALIŞTIRMADI)

**F1-002 kapsam notu:** bu görev testleri yeniden çalıştırmadı — yalnızca envanter/sahiplik/script-erişilebilirliğini yeniledi. Aşağıdaki runtime sonuçları hâlâ 2026-07-19 F0-005 taban çizgisine aittir ve 105 backend/9 frontend dosyanın yalnızca 72/6'sını kapsar; 34 yeni backend + 3 yeni frontend dosya için **hiçbir runtime pass/fail kaydı yoktur** (bu bir defect değildir — F1-002'nin görev tanımı davranış doğrulaması değil, envanter yenilemesidir). Tam komut/süre/exit-code kaydı [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json) içindedir.

| Komut | Sonuç |
|---|---|
| `server/` `npm ci` | rebaseline'da tekrar çalıştırılmadı — lockfile merge'den etkilenmedi; önceki sonuç (temiz, 25s) korunuyor |
| `npx prisma generate` (server/) | rebaseline'da tekrar çalıştırıldı (şema değişti) — temiz, 3s — **her testten önce zorunlu, otomatik değil** |
| `server/` `npm run typecheck` | rebaseline'da tekrar çalıştırıldı — temiz, 0 hata, 49s |
| repo-root `npm ci` | rebaseline'da tekrar çalıştırılmadı — lockfile merge'den etkilenmedi; önceki sonuç (temiz, 23s) korunuyor |
| repo-root `npm run build` | rebaseline'da tekrar çalıştırıldı — temiz, 0 hata, 71s |
| `bridge-agent/` `npm run test` | rebaseline'da tekrar çalıştırılmadı — `bridge-agent/` merge'den etkilenmedi; önceki sonuç (temiz, 105/105 geçti, 9s) korunuyor |
| `server/` `npm run test` (56 script'lik tam zincir, öncesi 54) | rebaseline'da tekrar çalıştırıldı — **2481/2482 geçti, 1 başarısız**, 115s; zincir aynı noktada (`test:clinic-bulk-export`, script 53) duruyor, script 54-56 (`test:security-incidents`, `test:communication-consent`, `test:communication-consent-backfill`) bu çalıştırmada çalışmıyor |
| `test:communication-consent` (tekil, yeni) | **BLOKLU** — 4/92 geçti, 88 başarısız (`ECONNREFUSED`) |
| `test:communication-consent-backfill` (tekil, yeni) | **BLOKLU** — 7 test'in hiçbiri çalışmadan crash (`ECONNREFUSED`) |
| 6 orphan `test:*` script'i (`npm run test` zincirinde değil) | rebaseline'da tekrar çalıştırıldı — **101/103 geçti, 2 başarısız**, orijinalle birebir aynı |
| 6 script'siz dosya (`npx tsx` ile doğrudan) | rebaseline'da tekrar çalıştırıldı — 177/177 geçti, orijinalle birebir aynı |
| 6 frontend test script'i (öncesi 5; +`test:communication-consent-matrix`) | rebaseline'da tekrar çalıştırıldı — 128/128 geçti (115 orijinal + 13 yeni) |
| `windows-bridge` `dotnet test` | rebaseline'da tekrar çalıştırılmadı — `windows-bridge/` merge'den etkilenmedi; **BLOKLU** sonucu (SDK sürüm uyuşmazlığı, 10.0.301 gerekli, 9.0.305 kurulu) korunuyor |
| windows-bridge installer PowerShell (4 script) | rebaseline'da tekrar çalıştırılmadı — `windows-bridge/` merge'den etkilenmedi; önceki sonuç (58/58 geçti) korunuyor |
| `securityIncident.test.ts` + 3 manuel verify script'i | rebaseline'da tekrar çalıştırıldı — **BLOKLU**, orijinalle birebir aynı — depoda commit edilmiş disposable-Postgres kurulumu yok |

### 4.1 Bulunan başarısızlıklar ve blokajlar (düzeltilmedi, yalnızca kaydedildi)

Kesin terminoloji — bu 5 kalem birbirinin yerine geçmez:

- **1 deterministic source-drift test başarısızlığı**: `overdueInstallments.test.ts` — test sonuna kadar çalıştı ve assertion'ları güncel üretim koduna göre yanlış; bu testin kendisinde gerçek, tekrarlanabilir bir kusur, ve üretim davranışının altında fark edilmeden değiştiğini ortaya çıkarıyor.
- **1 ortam-duyarlı (environment-sensitive) line-ending başarısızlığı**: `clinicBulkExport.test.ts` — test sonuna kadar çalıştı ve yalnızca Windows CRLF checkout'un testin `\n` içeren literal string aramasıyla çakışması nedeniyle başarısız oldu; korunan ürün davranışının doğru olduğu teyit edildi.
- **3 ortam blokajı** (yukarıdakiler gibi "başarısızlık" değil — testler hiç sonuna kadar çalışamıyor): `securityIncident.test.ts` (orijinal baseline), `communicationConsent.test.ts` (yeni — 2026-07-19 rebaseline), `communicationPreferenceBackfill.test.ts` (yeni — 2026-07-19 rebaseline). Üçü de bu ortamda mevcut olmayan bir `DATABASE_URL` gerektiriyor (depoda commit edilmiş disposable-Postgres kurulumu yok).

**Bu dokümantasyon görevi tarafından tespit edilmiş 0 doğrulanmış product-runtime kusuru vardır.** Tek deterministic başarısızlık test/üretim driftidir, canlı ortamda bağımsız olarak doğrulanmış bir runtime kusuru değildir; tek ortam-duyarlı başarısızlığın ürün kusuru OLMADIĞI teyit edilmiştir; 3 blokaj ise ürün davranışı hakkında hiçbir pass/fail sonucu vermez. Görev talimatları gereği, bu 5 kalemden hiçbirini ortadan kaldırmak için hiçbir şey düzeltilmedi, gevşetilmedi veya atlanmadı.

1. **`clinicBulkExport.test.ts`** — "status DTO never serializes sensitive fields" — **ortam-duyarlı (environment-sensitive) line-ending başarısızlığı** (Windows CRLF checkout + testin `\n` içeren literal string araması), gerçek ürün kusuru değil. 2× tekrarlandı, STABLE_FAIL.
2. **`overdueInstallments.test.ts`** — **deterministic source-drift** — 2 gerçek deterministic assertion başarısızlığı. Üretim kodu artık literal `'overdue'` status değeri yazıyor/okuyor; bu **orphan** test (hiçbir zaman `npm run test` zincirinde veya CI'da çalışmıyor) hâlâ eski davranışı varsayıyor. 2× tekrarlandı, STABLE_FAIL. **CI-uygulama boşluğunun somut kanıtı — bkz. §7.**
3. **`securityIncident.test.ts`** — ortam blokajı (erişilebilir DB yok), kod kusuru değil.
4. **`communicationConsent.test.ts`** (yeni, PR #169) — ortam blokajı (erişilebilir DB yok), kod kusuru değil. 92 assertion'dan yalnızca 4'ü (DB gerektirmeyenler) geçti.
5. **`communicationPreferenceBackfill.test.ts`** (yeni, PR #169) — ortam blokajı (erişilebilir DB yok), kod kusuru değil. 7 test'in hiçbiri çalışmadan crash.

Tam kök-neden analizi: evidence doc §9.

## 5. F0-004 yüksek-riskli 9 edge'in test kapsamı

| Sınıflandırma | Sayı |
|---|---|
| NOT_COVERED | 8 |
| PARTIALLY_COVERED | 1 |
| COVERED_DIRECTLY / COVERED_INDIRECTLY | 0 |

**En kritik bulgu:** `routes/whatsappInbox.ts:757`'deki eksik `pg_advisory_xact_lock` koruması (F0004-E0684, F0-004'ün "en şiddetli" bulgusu) — bu double-booking race condition'ın testi **yok**. `whatsappInbox.test.ts` var (25 test case) ama kendi docstring'ine göre yalnızca `utils/roles.ts` izin kontrollerini kapsıyor, gerçek route handler'ı hiç import etmiyor. Tam tablo (9 edge, dosya:satır, kanıt, eksik davranış): [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `highRiskEdgeCoverage[]` ve evidence doc §7.

## 6. Command-map bulguları (F1-002, güncel — programatik olarak ayrıştırıldı)

- `npm run test` (server) artık **77** script çağrısı zincirler (F0-005'te 56/62 idi); tam liste ve her script'in zincir-üyeliği [evidence/F1-002_test_script_reconciliation.json](evidence/F1-002_test_script_reconciliation.json)'da.
- **Zincirden hariç tutulan script sayısı: 17** (bkz. §0.1 — F1-002-P1 tarafından bağımsız doğrulandı, önceki metnin dağınık "16" sunumu düzeltildi):
  - **6 önceden bilinen orphan `test:*` script'i, değişmedi:** `test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`.
  - **+10 yeni, bilinçli olarak DB/harici-servis bağımlılığı nedeniyle hariç tutulmuş script** (tasarım gereği, boşluk değil): `test:appointment-request-conversion-atomicity`, `test:file-backup-db-integration`, `test:kvkk-high006-db-*` (6 script), `test:platform-admin-password-recovery`.
  - **+1 istisna, gerçek bir bulgu:** `test:file-backup` (`fileBackupService.test.ts`) DB-bağımsızdır (kendi dosya başlığına göre, P1 tarafından da teyit edildi) ama yine de zincire eklenmemiştir — muhtemelen gözden kaçmış, DB-bağımlılığı nedeniyle bilinçli hariç tutulan diğerlerinden farklı.
- **8 backend `.test.ts` dosyasının hiç `package.json` script'i yok** (F0-005'te 6 idi): `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts` (5'i değişmedi), + **3 yeni**: `kvkkHigh006Batch2ClinicScope.test.ts`, `metaWhatsAppPostBookingHandler.test.ts`, `planLimitsTargetClinicFix.test.ts`. `aiPrivacyBoundary.test.ts` bu listeden **çıktı** — artık `test:ai-prompt-privacy` script'i var ve tam zincire dahil.
- **0 stale/dead script referansı** — her script'in referans verdiği dosya diskte mevcut (programatik `fs.existsSync` kontrolü ile doğrulandı).
- Frontend (`root/package.json`) hâlâ tüm 7 bireysel `test:*` script'ini zincirleyen bir aggregate'e sahip değil (F0-005'in bulgusu, değişmedi); ayrıca **yeni**: `test:vitest` (vitest run) 2 `*.vitest.test.tsx` dosyasını glob ile kapsıyor, bu da bireysel script gerektirmiyor.
- `npm run test` (server) hâlâ `npx prisma generate` çalıştırılmadan başarısız olur — bu ön koşul script'e gömülü değil (F0-005'in bulgusu, F1-002 tarafından bu görevde yeniden doğrulanmadı, davranış değişikliği yok).
- `bridge-agent/package.json:test` hâlâ çalışıyor ama hiçbir CI workflow'u tarafından çağrılmıyor (değişmedi).

Tam detay: [evidence/F1-002_test_script_reconciliation.json](evidence/F1-002_test_script_reconciliation.json).

## 7. CI-uygulama boşluğu — merkezi bulgu (F1-002, güncel)

Depoda test çalıştıran **tam olarak bir** GitHub Actions workflow'u var (değişmedi): [`.github/workflows/windows-bridge-pr.yml`](../../.github/workflows/windows-bridge-pr.yml), yalnızca `windows-bridge/**`/imaging path'lerine dokunan PR'larda tetikleniyor. **101/105 backend test dosyası (F0-005'te 68/72), 6/9 frontend test dosyası (F0-005'te 3/6; F1-002-P1 tarafından bağımsız doğrulandı — bu satır önceden "7/9" idi, aritmetik hataydı: 9 − 3 CI-kapsamlı = 6, bkz. §0.1) ve 9/9 bridge-agent test dosyası hiçbir CI kapsamında değil.** `npm run test` (tam 77-script backend zinciri) hiçbir workflow tarafından hiçbir zaman çağrılmıyor. **34 yeni backend + 3 yeni frontend dosyanın hiçbirinin** bu CI path kapsamında olmaması — aynı boşluğun 37 yeni örneği, F0-005'in PR #169 gözlemiyle birebir aynı yapı. §4.1'deki `overdueInstallments.test.ts` bulgusu (2026-07-19'dan beri değişmedi, bu görevde yeniden doğrulanmadı) bu boşluğun hâlâ teorik değil somut olduğunun kanıtı olarak kalır. F1-002-P1'in bağımsız ölçümü: 116 dosyanın (105 backend + 9 frontend + 2 fixture-loader) **109'u (%94) hiçbir CI kapsamında değil** — bkz. §0.1. Tam detay: F0-005 evidence doc §11, [F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md](evidence/F1-002-P1_TEST_SCRIPT_REACHABILITY_RECONCILIATION.md) §7.

## 8. Kapsam boşlukları (özet, F0-005'ten korunmuştur — F1-002 bu analizi yeniden yapmadı)

Domain boşlukları (§3.1, F1-002 tarafından güncellendi), concurrency boşlukları (F0004-E0684 — hâlâ hiç test yok, F1-002 bunu yeniden doğrulamadı), tenant-security boşlukları (`multiBranchAccess.test.ts`'in kendi mantık mirror'ı), provider-failure boşlukları, migration boşlukları (kısmen ele alındı — bkz. yeni `kvkkHigh007High008SchemaIntegrity.test.ts`, ama genel otomatik migration up/down testi hâlâ yok), frontend boşlukları (**kısmen kapandı** — artık 2 gerçek `UI_COMPONENT`/jsdom/RTL testi var, F0-005'in "sıfır FRONTEND_COMPONENT testi" bulgusu artık geçerli değil), bridge boşlukları (.NET testleri bu görevde de ölçülemedi — SDK uyuşmazlığı, değişmedi), load/chaos boşlukları (hiç yok, değişmedi). Bu bölümün geri kalanı F0-005'in orijinal analizini yansıtır ve F1-002 tarafından yeniden üretilmedi; ayrıntılı, güncel kapsam-boşluğu listesi için [evidence/F1-002_test_ownership_gaps.json](evidence/F1-002_test_ownership_gaps.json)'a bakın.

## 9. F1 için önerilen affected-test yönlendirme tablosu

F1-001'in kendi tasarımı ([architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md)) bu tabloyu F0-005'in `affectedTestRecommendations[]`'ından türetilmiş bir sınıflandırma taksonomisiyle (24 kategori, 4 risk seviyesi, 18 yüksek-riskli boyut) **değiştirmiştir** — bkz. [architecture/evidence/f1-001-test-scope-classification.json](architecture/evidence/f1-001-test-scope-classification.json). F1-002'nin işi bu tasarımı uygulamak değildir; yalnızca o tasarımın kendi §0'da açıkladığı kanıt-bayatlığı riskini (R-072) gidermektir. F1-001'in tasarımı, kanonik sahiplik/domain sınırlarının dosya sayısı kadar hızlı değişmediğini, dolayısıyla F1-002'nin bu tabloyu yeniden üretmesine gerek olmadığını, yalnızca alttaki envanterin (§3, [F1-002_test_inventory.json](evidence/F1-002_test_inventory.json)) güncel tutulmasının yeterli olduğunu zaten öngörmüştür (confidence model, "stale evidence" kuralı). **F1'in bir sonraki CI-implementasyon görevi için ön koşul artık budur: F1-002'nin güncel envanteri.**

## 10. Sahiplik kuralları (hedef — F0-001'den korunmuştur)

- Her test dosyasının tek bir kanonik sahip domain'i olmalıdır (bkz. §3'ün uyguladığı kural: "behavior principally protected, not folder location" — 12 belirsiz vaka için gerekçe evidence doc §3'tedir).
- Contract testleri, contract'ın **sahibi olan** modülde yaşar; tüketen modül tüketici testini kendi tarafında tutar.
- Core güvenlik/tenancy regresyonu Core Platform sahipliğindedir ve hiçbir PR bunları atlayamaz.

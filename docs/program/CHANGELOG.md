# CHANGELOG — Program Dokümantasyonu Değişiklik Günlüğü

Her tracker/faz dokümanı değişikliği buraya kaydedilir. En yeni kayıt en üstte.

---

## 2026-07-19 — F0-002 Stage B (production baseline kanıtı) + main reconciliation

- **Task:** F0-002 — Repository and Deployment Baseline Inventory (Stage B production/VPS evidence, and reconciliation of the F0-002 branch with `origin/main`)
- **Merge:** `docs/f0-002-repository-deployment-baseline` branch'i `origin/main`'e (`d9fc40883afc8791098865d4d185de3336774c7a`) normal, force olmayan `git merge` ile güncellendi. Bu, F0-003 ([PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168), `MERGED`), F0-004 ([PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170), `MERGED`), F0-005 ([PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171), `MERGED`) ve iki KVKK PR'ını (#167, #169) branch'e getirdi. 2 dokümantasyon-yalnız çakışma (`NORAMEDI_MASTER_TRACKER.md`, `phases/F0_BASELINE_AND_VALIDATION.md`) çözüldü — main'in F0-003/004/005 kanıtı korunarak, F0-002'nin kendi Stage A/B kanıtı katmalı olarak eklendi. Kaynak/test/şema/migration/package/CI dosyalarında **hiçbir çakışma yoktu** (hepsi otomatik merge edildi, main'den gelen değişiklikler olarak).
- **Stage B evidence collected:** Kullanıcı [evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md) içindeki salt-okunur komut setini production VPS'te (`disklinik-prod-01`) çalıştırdı ve sanitize edilmiş çıktıyı paylaştı (evidence timestamp `2026-07-19T13:43:12+03:00`). Yeni [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) dosyası oluşturuldu: host durumu, application Git state (production `HEAD` `7fcf2f8`, `origin/main`'in yalnızca 1 dokümantasyon-yalnız PR gerisinde), runtime sürümleri (Node `22.23.1` — CI'da `20`'den sapma bulgusu dahil), PM2 topolojisi (`noramedi-api`/`noramedi-worker` ikisi de online), health (local+public `200`), TLS (4 hostname SAN kapsaması VERIFIED), database/migration state (temiz, 0 eksik migration), configuration presence (yalnızca SET/MISSING, değer yok), storage (`LOCAL_VPS_STORAGE`), backup (7 dosya, en güncel ~10.6 saat), PITR (`NOT_CONFIGURED`), restore test (`UNVERIFIED`), kabul edilmiş bulgular ve riskler.
- **Reconciliation:** [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md) §6.9 kanıt matrisi Stage B kanıtıyla mutabakat sağlandı — 12+ satır `UNVERIFIED_PRODUCTION`'dan `VERIFIED_PRODUCTION_OBSERVED`'a geçti; Docker-vs-bare-VPS topoloji çelişkisi (§6.10 madde 1) çözüldü; worker deploy-otomasyonu boşluğu (§6.10 madde 3) ve yeni Node sürüm sapması bulgusu (§6.10 madde 4) sivriltildi. `README.md` evidence dizini, yeni `VERIFIED_PRODUCTION_OBSERVED` sınıflandırmasını ve yeni dosyayı yansıtacak şekilde güncellendi.
- **Type:** Documentation only (`docs/program/` dışında hiçbir dosya değiştirilmedi; production'a hiçbir yazma erişimi yapılmadı — tüm production komutları kullanıcı tarafından, salt-okunur olarak çalıştırıldı)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — ajan hiçbir migration çalıştırmadı, hiçbir veritabanına bağlanmadı; production'daki `_prisma_migrations` sorgusu kullanıcı tarafından salt-okunur çalıştırıldı
- **Status:** F0-002 → `AGENT_COMPLETED`, ardından [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) açılmasıyla → `PR_OPEN` (Stage A + Stage B tamamlandı). F0-003/F0-004/F0-005 → main'den `MERGED` olarak taşındı (F0-005'in bu branch'teki önceki `PR_OPEN` kaydı düzeltildi). Kabul edilmiş açık riskler (storage locality, offsite backup, PITR, restore test, Node sürüm sapması, PM2 restart sayıları, root privilege) belgelendi, **düzeltilmedi**.
- **PR:** [#172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) — `main` hedefli, merge kararı dış incelemeye aittir.

---

## 2026-07-18 — F0-002 Stage A (final dış inceleme düzeltmesi)

- **Task:** F0-002 — Repository and Deployment Baseline Inventory (Stage A final external review remediation)
- **Finding (bayat KVKK durumu):** Tracker'da `Currently active KVKK work` alanı hâlâ `UNVERIFIED` idi; oysa dış kanıt artık mevcuttu: [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003, security incident response foundation) — `OPEN`, draft değil, mergeable snapshot `true`, head `feature/kvkk-crit-003-security-incident-foundation` @ `9c5c15512e1bc013340526a7f7c3792c32b0f408`, base `main`, 29 değişen dosya, 3 commit.
- **Correction:** `NORAMEDI_MASTER_TRACKER.md` §3 (`Currently active KVKK work`, `Local observation (KVKK)`, §12 blokaj #1), `CURRENT_PHASE.md` ve `phases/F0_BASELINE_AND_VALIDATION.md` (açık sorular + değişiklik geçmişi), PR #167'nin `gh pr view 167` ile doğrulanmış (`VERIFIED_GITHUB`) durumunu yansıtacak şekilde güncellendi: `OPEN`, merge edilmedi, deploy edilmedi, production'da doğrulanmadı. PR'ın kendi commit mesajlarındaki test/uygulama iddiaları F0-002 tarafından bağımsız doğrulanmış olarak **kaydedilmedi**. `Local observation (KVKK)` satırına, bu son kontrol noktasındaki güncel (1 untracked dosya mevcut) salt-okunur gözlem de üçüncü zaman noktası olarak eklendi.
- **Finding (production evidence komut güvenliği — kalan 5 madde):** Önceki düzeltme turu 8 maddeden 3'ünü (remote URL sanitizasyonu, hostname otomatik-prob, `grep -A` Nginx sızıntısı) ele almıştı; dış inceleme, kalan maddelerin daha da sertleştirilmesini istedi: (1) sanitize edilmiş remote URL bile artık hiç yazdırılmıyor — yalnızca `origin remote: CONFIGURED/MISSING`; (2) Section B/K artık hiçbir değişmiş/untracked dosya yolu yazdırmıyor, yalnızca sayım + `CLEAN`/`DIRTY` durumu; (3) veritabanı boyutu sorgusu artık `current_database()` kullanıyor, `$DB_NAME` SQL metnine enjekte edilmiyor; (4) yedek dosyası sayımı artık yalnızca depo-tanımlı `noramedi_crm-????????-??????.dump` desenine uyan dosyaları sayıyor; (5) restore-test kanıtının doğal sınırı (`runRestoreTest()` fonksiyonunun varlığı, hiçbir zaman çalıştığının kanıtı değildir; kalıcı bir "son restore testi" kaydı depoda yok) açıkça belgelendi, dar bir cron/systemd adı kontrolü dışında hiçbir kanıt toplanamayacağı ve bu kontrolün yokluğunun da manuel bir testin hiç yapılmadığını kanıtlamayacağı netleştirildi.
- **Correction:** `F0-002_PRODUCTION_EVIDENCE_REQUEST.md` Section B, F, I ve K yukarıdaki beş maddeyi uygulayacak şekilde yeniden yazıldı; Section I'ye ayrı bir "Restore-test evidence (explicit limitation)" alt bölümü eklendi.
- **Type:** Documentation only (`docs/program/` dışında hiçbir dosya değiştirilmedi)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — hiçbir migration çalıştırılmadı, hiçbir veritabanına bağlanılmadı
- **Status:** F0 → `IN_PROGRESS`; F0-001 → `MERGED`; F0-002 → `IN_PROGRESS` (Stage A `AGENT_COMPLETED` — final dış inceleme düzeltmeleri push edildi; Stage B kullanıcının production VPS kanıtı sağlamasını bekliyor); F0-003…F0-013 → `TODO`; G0…G6 → `NOT_APPROVED`. PR #167 herhangi bir şekilde `TESTS_PASSED`/`MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` olarak işaretlenmedi ve F0-002 kapsamında incelenmedi/değiştirilmedi.
- **PR:** Açılmadı (görev talimatı gereği).

---

## 2026-07-18 — F0-002 Stage A (dış inceleme düzeltmesi)

- **Task:** F0-002 — Repository and Deployment Baseline Inventory (Stage A external review remediation)
- **Finding (tracker tutarsızlığı):** `NORAMEDI_MASTER_TRACKER.md` §3'teki `Local observation (KVKK)` satırı, aktif KVKK çalışma ağacını hâlâ "temiz" olarak gösteriyordu; oysa dış inceleme kontrol noktasında ağaç temiz değildi (eşzamanlı değişmiş/untracked dosyalar mevcuttu, F0-002 tarafından oluşturulmadı).
- **Correction:** Tracker satırı; Stage A başlangıcı (temiz), dış inceleme ara kontrolü (temiz değil) ve bu remediation kontrolü (yeniden temiz) olmak üzere üç ayrı zaman noktasını, tüm gözlemler `OBSERVED_LOCAL_ONLY` sınıflandırmasıyla ve dosya listesi olmadan (ayrıntı evidence dokümanında) kaydedecek şekilde yeniden yazıldı. `F0-002_REPOSITORY_BASELINE.md` §6.1 "Worktree isolation record" tablosuna, bu remediation kontrolündeki güncel (yeniden temiz) gözlem satırı eklendi.
- **Finding (production evidence komut güvenliği):** Dış inceleme, `F0-002_PRODUCTION_EVIDENCE_REQUEST.md` içinde sekiz ayrı sertleştirme ihtiyacı bildirdi: (1) `git remote get-url origin` ham çıktısı olası gömülü kimlik bilgisi riski taşıyordu; (2) uygulama dizini (`/var/www/noramedi`) sessizce varsayım olarak kullanılıyordu; (3) genel (public) sağlık kontrolü ve TLS kontrolü, depo betiğinde geçen bir hostname'i (`api.noramedi.com`) otomatik olarak prob ediyordu; (4) Nginx bölümündeki `grep -A5 "server_name"` ilgisiz proxy/upstream/sertifika satırlarını sızdırabilirdi; (5) veritabanı adı keşfi (`psql -l | grep`) sahip/yetki bilgisi sızdırabilirdi; (6) yedek (backup) kanıtı `ls -lt | head` ile dosya adlarını yazdırıyordu; (7) yinelenen `.env` değişken tanımları için `DUPLICATE` tespiti yoktu; (8) Bölüm K (özet) `APP_DIR`/`DB_NAME`/hostname değerlerini sabit kodlanmış olarak tekrarlıyordu.
- **Correction:** Tüm sekiz madde düzeltildi — remote URL artık yalnızca `@` öncesi kimlik bilgisi segmenti temizlenmiş biçimde yazdırılıyor; `APP_DIR`, `DB_NAME`, `PUBLIC_HOST` artık yalnızca kullanıcı tarafından açıkça teyit edildikten sonra `export` edilip sonraki bölümlerde `: "${VAR:?...}"` ile doğrulanarak yeniden kullanılıyor (sessiz varsayım yok); genel hostname artık yalnızca aktif Nginx `server_name` yönergelerinden çıkarılan aday listesinden kullanıcının açıkça seçtiği tek bir değerle prob ediliyor; Nginx bölümü yalnızca dosya yollarını ve `nginx -t` sonucunu yazdırıyor (ilgisiz direktif çıktısı yok); veritabanı adı keşfi `pg_database` üzerinden yalnızca aday isim listesi döndürüyor (sahip/yetki yok); yedek kanıtı artık yalnızca sayı/yaş/boyut metadata'sı döndürüyor, dosya adı yazdırmıyor; `check_var` fonksiyonu birden fazla tanım durumunda değeri okumadan `DUPLICATE` raporluyor; Bölüm K, önceki bölümlerde teyit edilen `APP_DIR`/`DB_NAME`/`PUBLIC_HOST` değerlerini yeniden kullanacak şekilde tamamen yeniden yazıldı.
- **Type:** Documentation only (`docs/program/` dışında hiçbir dosya değiştirilmedi)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — hiçbir migration çalıştırılmadı, hiçbir veritabanına bağlanılmadı
- **Status:** F0-002 → `IN_PROGRESS` (Stage A dış inceleme düzeltmeleri push edildi; Stage B kullanıcı girdisi bekliyor — genel görev durumu ajan tarafından bunun ötesine geçirilemez)
- **PR:** Açılmadı (görev talimatı gereği).

---

## 2026-07-18 — F0-001 (merge teyidi) + F0-002 Stage A

- **Task:** F0-001 — Program Control and Master Tracker Foundation (merge teyidi); F0-002 — Repository and Deployment Baseline Inventory (Stage A)
- **Change (F0-001):** [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) merge edildiği `gh pr view 166` ile doğrulandı — merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, `2026-07-18T08:08:10Z`. F0-001 → `MERGED`.
- **Change (F0-002 Stage A):** Aktif KVKK çalışma ağacına (`feature/kvkk-crit-003-security-incident-foundation`, salt-okunur teyit edildi, dokunulmadı) dokunmadan izole bir worktree/branch oluşturuldu (`docs/f0-002-repository-deployment-baseline` @ refreshed `origin/main` = `4302825...`). PR #166 merge-commit ancestry'si `origin/main` için doğrulandı. Depo/Git kimliği, repository layout, runtime/toolchain tanımları, package script/entrypoint envanteri, Prisma/migration baseline'ı (60 migration, doğrusal, anomali yok), deployment tanım envanteri, runtime-bağımlılık kapasitesi (Redis/queue/storage/backup/restore-test/PITR/gözlemlenebilirlik/Docker/PgBouncer/read-replica), CI/repository automation envanteri ve bir baseline kanıt matrisi kanıtla oluşturuldu. Depoda birden fazla çelişki/bayat dokümantasyon bulgusu kaydedildi (Docker vs. bare-VPS deployment topolojisi, `noramedi-worker` PM2 adının depoda bulunmaması, `.env.example` eksik değişkenler, stray committed dosyalar) — bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md) §6.10. Salt-okunur, sır/PII sızdırmayan bir production evidence request hazırlandı ([evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md)).
- **Type:** Documentation only (`docs/program/` dışında hiçbir dosya değiştirilmedi)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — hiçbir migration çalıştırılmadı, hiçbir veritabanına bağlanılmadı
- **Status:** F0-001 → `MERGED`; F0-002 → `IN_PROGRESS` (Stage A `AGENT_COMPLETED`, Stage B production kanıtı bekliyor — genel görev durumu ajan tarafından `AGENT_COMPLETED`'ın ötesine geçirilemez)
- **Deviation:** Tercih edilen worktree yolu (`E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f0-002-baseline`) bu ortamda mevcut olmayan bir `E:` sürücüsü gerektiriyordu; `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` kullanıldı (bkz. evidence dosyası).
- **PR:** Açılmadı (görev talimatı gereği; Stage A tek başına PR'a konu değildir).

---

## 2026-07-17 — F0-001 (düzeltme push edildi)

- **Task:** F0-001 — Program Control and Master Tracker Foundation
- **Change:** Dış inceleme düzeltmeleri commit `ef11d2d` ile mevcut branch'e push edildi; [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) **açık** durumda kalmaya devam ediyor. Yeni PR açılmadı.
- **Type:** Documentation only
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged
- **Status:** `PR_OPEN`
- **Review:** Merge kararı dış incelemeye aittir; ajan merge edemez.

---

## 2026-07-17 — F0-001 (dış inceleme düzeltmesi)

- **Task:** F0-001 — Program Control and Master Tracker Foundation
- **Stage:** External review remediation
- **Finding:** Bayat KVKK branch/PR durumu — dokümantasyon `feature/kvkk-high-004-secure-clinic-bulk-export` çalışmasını hâlâ aktif ve PR #165'i açık/merge edilmemiş gösteriyordu.
- **Correction:** [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) `MERGED` olarak kaydedildi (2026-07-17); güncel aktif KVKK çalışması F0-002/F0-007 kanıtı gelene kadar `UNVERIFIED`'a döndürüldü; yerel `feature/kvkk-crit-003-security-incident-foundation` gözlemi remote/PR/kapsam/tamamlanma durumu `UNVERIFIED` notuyla kaydedildi; baseline tablosunda branch oluşturma tabanı ile güncel `main` commit'i alanları ayrıştırıldı.
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged
- **Status:** `CHANGES_REQUESTED` (düzeltme sırasında)
- **PR:** [#166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166)

---

## 2026-07-17 — F0-001 (PR aşaması)

- **Task:** F0-001 — Program Control and Master Tracker Foundation
- **Change:** Branch `docs/f0-001-program-tracker-foundation` push edildi; [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) `main` hedefli açıldı (commit `4f5993d`).
- **Type:** Documentation only
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged
- **Status:** `PR_OPEN`
- **Review:** Merge kararı dış incelemeye aittir; ajan merge edemez. Merge dış kanıtla teyit edildikten sonra durum `MERGED` olarak güncellenecektir.

---

## 2026-07-17 — F0-001 (inceleme aşaması)

- **Task:** F0-001 — Program Control and Master Tracker Foundation
- **Change:** Dış inceleyici teslim raporunu inceledi; dokümantasyon kalite denetimi yapıldı. Düzeltmeler: `PR_OPEN` durumunun ancak gerçek PR açıldıktan sonra kaydedilebileceği kuralı tracker §2.3 ve README §5'e eklendi; F0-001 durumu `REVIEW_REQUIRED` olarak güncellendi (tracker §5/§6/§7, CURRENT_PHASE, F0 faz dokümanı).
- **Type:** Documentation only
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged
- **Status:** `REVIEW_REQUIRED` (dış inceleyici tarafından yetkilendirildi)
- **Review:** Sürüyor; sonraki adım commit + push + PR (`main` hedefli). PR açıldıktan sonra durum `PR_OPEN` olarak PR referansıyla güncellenecektir.

---

## 2026-07-17 — F0-001

- **Task:** F0-001 — Program Control and Master Tracker Foundation
- **Change:** Program tracking foundation created (`docs/program/` altında 24 Markdown dosyası: 12 kök doküman + 12 faz dokümanı)
- **Type:** Documentation only
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged
- **Status:** `AGENT_COMPLETED`
- **Review:** Pending external review (ChatGPT/kullanıcı incelemesi bekleniyor; kabul edilmiş **sayılmaz**)

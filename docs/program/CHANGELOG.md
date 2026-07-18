# CHANGELOG — Program Dokümantasyonu Değişiklik Günlüğü

Her tracker/faz dokümanı değişikliği buraya kaydedilir. En yeni kayıt en üstte.

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

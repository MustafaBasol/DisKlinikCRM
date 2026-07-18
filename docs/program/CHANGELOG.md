# CHANGELOG — Program Dokümantasyonu Değişiklik Günlüğü

Her tracker/faz dokümanı değişikliği buraya kaydedilir. En yeni kayıt en üstte.

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

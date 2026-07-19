# CHANGELOG — Program Dokümantasyonu Değişiklik Günlüğü

Her tracker/faz dokümanı değişikliği buraya kaydedilir. En yeni kayıt en üstte.

---

## 2026-07-19 — F0-007 Active KVKK Work Baseline and Architecture Freeze Boundary + F0-006 `MERGED` düzeltmesi

- **Task:** F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary
- **Correction (F0-006):** [PR #173](https://github.com/MustafaBasol/DisKlinikCRM/pull/173) `main`'e merge edilmiştir (merge commit `91276dc7f610ef6923e3c1a7572f0ebba578a2f7`, `mergedAt: 2026-07-19T12:54:43Z`, `gh pr view 173` ile teyit edildi). F0-006 → `MERGED`. Deployed/Production Verified: NOT APPLICABLE (dokümantasyon-yalnız görev).
- **Correction (F0-002/F0-006 tracker text — PR #167 status drift):** Tracker/faz dokümanları PR #167'yi (KVKK-CRIT-003) `OPEN` olarak kaydediyordu (2026-07-18 kontrolüne dayanarak). Bu turun `gh pr view 167` kontrolü `MERGED` gösteriyor (`mergedAt: 2026-07-18T16:10:01Z`) — önceki kontrol, aynı gün içindeki merge'den önce yapılmış ve metin bayat kalmış. Düzeltildi.
- **Change (F0-007):** İzole worktree (`docs/f0-007-kvkk-baseline-freeze-boundary`, base `origin/main` @ `91276dc7f610ef6923e3c1a7572f0ebba578a2f7`) oluşturuldu; birincil KVKK-HIGH-007 çalışma ağacına yalnızca salt-okunur `git status --short`/`git branch`/`git rev-parse` ile bakıldı (görev başlangıcında 36 dirty path gözlemlendi, 1'i görev talimatının listesinde olmayan `docs/compliance/56-...md` — yalnızca dosya adı, içerik okunmadı/diff alınmadı), hiçbir yazma/commit/reset/checkout/stash/clean komutu çalıştırılmadı. AGENTS.md, tracker, tüm F0 kök dokümanları, F0-002…F0-006 evidence/deliverable dosyaları ve committed KVKK uyum dokümanları (`docs/compliance/53-56` başlık/durum bölümleri + `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` tam) okundu. GitHub üzerinde tüm bilinen KVKK PR'ları (`gh pr view`) doğrulandı — bu alt kümede sıfır açık PR bulundu. (`gh pr list --state all --limit 60` ile "61 PR, sıfır açık, repository-çapında" iddiası da bu turda üretildi; bu iddianın yanlış metodoloji içerdiği sonraki bir düzeltme turunda ortaya çıktı — aşağıdaki 2026-07-19 düzeltme-turu girişine bakın.)
- **Key finding:** KVKK-HIGH-007'nin taban özelliği (merkezi iletişim tercihi/onay yönetimi) zaten [PR #169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169) ile `MERGED` (merge commit `7fcf2f850f151241266f07349c4bf4442c72bbca`, `2026-07-18T22:05:26Z`) — bu commit aynı zamanda F0-002 Stage B'nin doğruladığı production `HEAD`'dir. Birincil ağaçtaki aktif çalışma (migration adı: `20260719120821_kvkk_high007_consent_reconciliation`), görev başlangıcında commit edilmemiş olarak gözlemlendi ve bu nedenle **yeni bir görev değil, aynı KVKK-HIGH-007 girişiminin devam/sertleştirme aşaması** olarak sınıflandırıldı. `docs/compliance/56-...md` ve `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'nin kendi metni hâlâ PR #169'u "merge edilmedi" olarak tanımlıyor — GitHub kanıtıyla çelişen bir öz-referans gecikmesi (bu görev tarafından, `docs/compliance/` kapsam dışı olduğu için düzeltilmedi; risk R-042 olarak kaydedildi).
- **Deliverables:** [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md) (yeni), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) (yeni), [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) (yeni), [evidence/F0-007_kvkk_work_inventory.json](evidence/F0-007_kvkk_work_inventory.json) (yeni, JSON doğrulandı), [RISK_REGISTER.md](RISK_REGISTER.md) güncellemesi (R-041…R-052, 6 HIGH + 6 MEDIUM), [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) additive not (matris yeniden üretilmedi), [evidence/README.md](evidence/README.md) dizin güncellemesi.
- **Type:** Documentation only (no application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, or runtime configuration was modified; no file under `docs/compliance/` was modified; only `docs/program/**` changed)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — no migration run, no database connection made
- **Primary tree:** Not modified — only read-only `git status`/`git branch`/`git rev-parse` commands were run against it; no dirty/untracked file content was opened, read, or diffed
- **Status:** F0-006 → `MERGED` (correction); F0-007 → `AGENT_COMPLETED`, pending PR
- **PR:** To be opened, base `main`

---

## 2026-07-19 — F0-007 düzeltme turu (dış inceleme, PR #174)

- **Task:** F0-007 correction pass (documentation-only correction of PR #174)
- **Trigger:** External review of PR #174 found the F0-007 deliverable set stated (a) the primary tree's branch/HEAD were "unchanged throughout this task" and (b) the KVKK-HIGH-007 continuation was flatly "uncommitted, no PR" — both stale/inaccurate once time-sliced correctly, plus (c) the "repository-wide, 61/61 PRs `MERGED`, zero open" PR-sweep claim, generated from `gh pr list --state all --limit 60`, was methodologically invalid (a 60-row-capped query cannot be repository-wide, and cannot return 61 rows).
- **Correction 1 (time-slicing):** The primary tree (`D:\Mustafa\Siteler\DisKlinikCRM`), under a separate, independent session's control throughout, was re-observed read-only (`git branch --show-current`, `git rev-parse HEAD`, `git status --short`) at this correction pass. Three distinct, timestamped observations now replace the single false claim: task start (`main`@`db89b60c91666cb029c32757f171f227a643c79c`, 36 dirty entries), task end (`feature/kvkk-high007-consent-reconciliation-ux`@`267458c8f09bf13126e1822705317629906f9491`, clean — self-observed by this task, not caused by it), and this correction pass (same branch/HEAD, now with an open GitHub PR — see Correction 2). No file content of the primary tree was read at any point, before or during this correction.
- **Correction 2 (PR-sweep methodology + new PR discovery):** A corrected sweep (`gh pr list --state all --limit 200`) found 174 total PRs (#1–#175), 3 currently `OPEN`: [#48](https://github.com/MustafaBasol/DisKlinikCRM/pull/48) (pre-existing, unrelated `fix/clinic-branch-visibility`, open since 2026-06-16 — missed entirely by the original narrow sweep), [#174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174) (this task's own PR), and [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175) — the KVKK-HIGH-007 continuation itself, opened `2026-07-19T13:19:58Z` (after F0-007's original verification), head SHA `267458c8f09bf13126e1822705317629906f9491`, exactly matching the HEAD this task independently recorded for the primary tree at its own task-end observation. Only GitHub metadata (title/state/branch/head SHA/changed-file count) was read for PR #175 — no diff or file content was opened.
- **Deliverables updated:** [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md) (§1, §2, §3, new §7), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) (header note, §2 row 1, §5 condition 1), [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) (§1 → §1.1 time-sliced record, §3.1 PR-sweep correction, §3.3, §5C, §7, §8, §9), [evidence/F0-007_kvkk_work_inventory.json](evidence/F0-007_kvkk_work_inventory.json) (new `correctionPass` object, corrected `repositoryWidePrSweep`, updated `activeWork`/`knownKvkkTasks` fields, re-validated as JSON), [NORAMEDI_MASTER_TRACKER.md](NORAMEDI_MASTER_TRACKER.md), [CURRENT_PHASE.md](CURRENT_PHASE.md), [phases/F0_BASELINE_AND_VALIDATION.md](phases/F0_BASELINE_AND_VALIDATION.md) (all corrected consistently), [RISK_REGISTER.md](RISK_REGISTER.md) (new risk R-053; R-041/R-046 wording updated to reflect the commit-status correction).
- **Type:** Documentation only (no application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, or runtime configuration was modified; only `docs/program/**` changed)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — no migration run, no database connection made
- **Primary tree:** Not modified — only read-only `git status`/`git branch`/`git rev-parse` commands were run against it, at any point across the original task or this correction pass; no file content of the KVKK-HIGH-007 continuation (local or in PR #175) was opened, read, or diffed
- **Status:** F0-007 remains `PR_OPEN` (PR #174); correction pushed to the same branch/PR, not merged
- **PR:** [#174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174) (existing, not merged) — correction pushed as additional commit(s)

---

## 2026-07-19 — F0-006 Production Topology and Configuration Verification + F0-002 `MERGED` düzeltmesi

- **Task:** F0-006 — Production Topology and Configuration Verification
- **Correction (F0-002):** [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) aslında `main`'e merge edilmiştir (merge commit `db89b60c91666cb029c32757f171f227a643c79c`, `mergedAt: 2026-07-19T12:02:51Z`, `gh pr view 172 --json state,mergedAt,mergeCommit` ile teyit edildi). O merge commit'inin taşıdığı tracker/faz-dokümanı/CURRENT_PHASE içeriği hâlâ `PR_OPEN` yazıyordu — F0-003/F0-004/F0-005'te de görülen aynı öz-referans gecikmesi (bir görevin kendi tracker güncellemesi kendi PR'ı merge edilmeden önce commit edilir). `NORAMEDI_MASTER_TRACKER.md` (§0 başlık, §5, §6 F0-002, §7, §12, §13), `phases/F0_BASELINE_AND_VALIDATION.md` (backlog tablosu, change history) ve `CURRENT_PHASE.md` bu turda düzeltildi.
- **Change (F0-006):** İzole worktree (`D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-006-production-topology`, branch `docs/f0-006-production-topology-verification`, base `origin/main` @ `db89b60c91666cb029c32757f171f227a643c79c`) oluşturuldu; birincil KVKK-HIGH-007 çalışma ağacına yalnızca salt-okunur `git status --short` ile bakıldı, dokunulmadı. AGENTS.md, tracker, F0 faz dokümanı, F0-002 Stage A+B kanıtı, F0-002 production evidence request, risk register okundu; ardından kaynak-kod seviyesinde derinleşme yapıldı: `server/src/index.ts`, `server/src/worker.ts`, `server/src/jobs/startBackgroundJobs.ts`, `server/src/utils/jobLock.ts`, `server/src/db.ts`, `server/src/utils/redis.ts`, `server/src/services/fileStorage.ts`, `server/src/services/backupService.ts`, `server/src/routes/platformAdmin.ts` (backup bölümü), `nginx.conf`, `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, `server/.env.example`, `docs/35-docker-deploy-runbook.md`, root ve `server/package.json`. Görev talimatıyla sağlanan ikinci bir production kanıt anlık görüntüsü F0-002 Stage B ile alan alan karşılaştırıldı — tamamen tutarlı bulundu (aynı host, aynı gün, aynı production `HEAD`, aynı restart sayıları, aynı config presence listesi); hiçbir yeni production komutu bu ajan tarafından çalıştırılmadı. Zorunlu drift/çelişki tablosu (9 satır) ve accepted-findings/unverified listeleri oluşturuldu.
- **Deliverables:** [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md) (yeni), [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md) (yeni), [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) (yeni), [evidence/F0-006_configuration_inventory.json](evidence/F0-006_configuration_inventory.json) (yeni, `node -e "JSON.parse(...)"` ile doğrulandı), [RISK_REGISTER.md](RISK_REGISTER.md) güncellemesi (R-029…R-040, 6 HIGH + 6 MEDIUM), [evidence/README.md](evidence/README.md) dizin güncellemesi.
- **Key findings:** (1) Duplicate background-job **registration** is possible if `RUN_BACKGROUND_JOBS` is not literally `'false'` on the API (worker always registers regardless) — duplicate **execution** is prevented by a DB-backed `JobLock`, not by process topology; (2) no `ecosystem.config.*` file exists anywhere in the repository — both PM2 processes' registration originates entirely outside the repository; (3) `scripts/noramedi-deploy.sh` is fail-fast, not atomic/rollback-capable, and never touches the worker process or the frontend build; (4) `docs/35-docker-deploy-runbook.md` is confirmed, by direct content read, to describe a topology (old product/DB names, `/docker/disklinikcrm/` paths) that corresponds to no file in the repository and not to the confirmed running topology; (5) backup/restore-test admin routes are correctly gated behind `authenticatePlatformAdmin` + CSRF.
- **Type:** Documentation only (no application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, Nginx file, environment file, or runtime configuration was modified)
- **Application behavior:** Unchanged
- **Database behavior:** Unchanged — no migration run, no database connection made; all production facts cite F0-002 Stage B or the task-supplied, user-provided evidence snapshot
- **Status:** F0-002 → `MERGED` (correction); F0-006 → `AGENT_COMPLETED`, pending PR
- **PR:** To be opened, base `main`

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

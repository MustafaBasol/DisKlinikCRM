# NoraMedi Master Development Tracker

Bu dosya, NoraMedi kurumsal mimari ve modülerleşme programının **yetkili canlı durum kaynağıdır**. Bkz. [README.md](README.md).

Son güncelleme: 2026-07-19 (F0-002 Stage B — production baseline kanıtı toplandı ve belgelendi; main'den F0-004 `MERGED`/F0-005 `MERGED` durum düzeltmeleri taşındı, bkz. PR #167/#169/#171 sonrası `origin/main` @ `d9fc40883afc8791098865d4d185de3336774c7a`)

---

## 1. Program objective (Program hedefi)

NoraMedi; düzenlemeye tabi, çok kiracılı (multi-tenant) bir diş hekimliği ve sağlık operasyonları platformudur. Programın mimari hedefi:

- **Binlerce klinik tenant** ve kısa sürede yüzlerce klinik onboarding kapasitesi
- **Yüksek eşzamanlı kullanıcı aktivitesi** altında öngörülebilir performans
- **Güçlü tenant izolasyonu** (defense-in-depth: uygulama + veritabanı + altyapı katmanları)
- **KVKK ve sağlık sektörü mevzuat uyumu** (Türkiye)
- **T.C. Sağlık Bakanlığı ve diğer resmî entegrasyonlar** (adapter tabanlı platform)
- WhatsApp, Instagram, SMS, e-posta ve ses iletişim kanalları
- **Yaygın AI kullanımı**: AI Gateway, governance, maliyet/kullanım ölçümü, PII/PHI minimizasyonu
- **DICOM, CBCT, 2D/3D görüntüleme** ve klinik cihaz entegrasyonları; üçüncü taraf tıbbi görüntüleme AI entegrasyonları
- **Modüler monolit** mimari; yalnızca gerekçeli sınırlar için servis çıkarımı
- Yüksek erişilebilirlik, felaket kurtarma (DR), gözlemlenebilirlik ve kurumsal güvenlik
- Hızlı, etki-bazlı (affected) test mimarisi ile modüler geliştirme
- Feature flag ve entitlement ile kontrol edilen opsiyonel ticari modüller

## 2. Authoritative status rules (Yetkili durum kuralları)

### 2.1 Kaynak hiyerarşisi

1. Git commitleri, merge edilmiş PR'lar, deploy edilmiş revizyonlar, migration'lar ve test kanıtları
2. `docs/program/NORAMEDI_MASTER_TRACKER.md` (bu dosya)
3. İlgili faz dokümanı (`docs/program/phases/`)
4. Kabul edilmiş ADR'ler ([ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md))
5. Güncel depo kanıtı
6. Stratejik yol haritası dokümanları
7. Geçmiş konuşmalar ve ajan özetleri

Word yol haritası **stratejik referanstır**, canlı durum kaynağı değildir. Bir ajanın "completed" beyanı; işin incelendiğinin, merge edildiğinin, deploy edildiğinin veya production'da doğrulandığının kanıtı **değildir**.

### 2.2 Görev durum modeli

| Durum | Anlamı |
|---|---|
| `TODO` | Görev tanımlı, henüz başlamaya hazır değil veya sırada |
| `READY` | Ön koşulları sağlanmış, bir sonraki çalışmada başlatılabilir |
| `IN_PROGRESS` | Ajan üzerinde aktif çalışıyor |
| `AGENT_COMPLETED` | Ajan, istenen depo işinin bittiğine **inanıyor**; dış doğrulama yok |
| `REVIEW_REQUIRED` | Dış inceleyici (ChatGPT/kullanıcı) incelemeyi başlattı/istedi |
| `CHANGES_REQUESTED` | İnceleme sonucu düzeltme istendi; ajan yeniden çalışacak |
| `TESTS_PASSED` | İlgili test kapsamının geçtiği **dışarıdan teyit edildi** |
| `PR_OPEN` | Pull request açıldı, merge bekliyor |
| `MERGED` | Merge kanıtı (commit/PR referansı) **teyit edildi** |
| `DEPLOYED` | Deployment kanıtı (revizyon/ortam) **teyit edildi** |
| `PRODUCTION_VERIFIED` | Canlı smoke/kabul testi **başarıyla** yapıldı ve kaydedildi |
| `BLOCKED` | Dış bir engel nedeniyle ilerleyemiyor |
| `DEFERRED` | Bilinçli olarak ertelendi |
| `CANCELLED` | İptal edildi |

### 2.3 Ajan yetki sınırları

- Claude Code bir görevi en fazla `AGENT_COMPLETED` durumuna getirebilir.
- Claude Code şu durumları dış teyit olmadan **atayamaz**: `REVIEW_REQUIRED`, `TESTS_PASSED`, `MERGED`, `DEPLOYED`, `PRODUCTION_VERIFIED`.
- Claude Code `PR_OPEN` durumunu ancak **gerçek bir pull request açıldıktan sonra** ve PR referansıyla (numara/URL) kaydedebilir; PR açılmadan `PR_OPEN` yazılamaz.
- `MERGED` doğrulanmış merge kanıtı; `DEPLOYED` doğrulanmış deployment kanıtı; `PRODUCTION_VERIFIED` başarılı canlı smoke/kabul testi gerektirir.
- Kabul ve merge kararları dış incelemeye (ChatGPT/kullanıcı) aittir; ajan bu kararları veremez.

## 3. Current baseline (Güncel taban çizgisi)

Kanıt toplanmamış alanlar `UNVERIFIED` olarak işaretlenmiştir. F0-002 Stage A bu tabloyu **depo** kanıtıyla doldurdu (bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)); F0-002 Stage B artık kullanıcının salt-okunur VPS kanıtıyla **tamamlandı** (bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md), kanıt zaman damgası `2026-07-19T13:43:12+03:00`) — production'a bağlı alanların çoğu artık `VERIFIED_PRODUCTION_OBSERVED`'dır; kanıtla çözülmeyenler (frontend build-artifact eşleşmesi, restore test, offsite yedek, PITR **varlığı**) kasıtlı olarak `UNVERIFIED`/`NOT_CONFIGURED` kalır. Depo kapasitesi production kanıtı **yerine geçmez**. Değer **uydurulmaz**. Bu, ne bir `PRODUCTION_VERIFIED` release-gate durumu ne de kimlenmemiş risklerin (aşağıda §12) çözüldüğü anlamına gelir.

| Alan | Değer |
|---|---|
| Repository | `DisKlinikCRM` (yerel yol: `D:\Mustafa\Siteler\DisKlinikCRM`; remote: `github.com/MustafaBasol/DisKlinikCRM`). Not: önceki sürümde yerel yol `E:\Ek Gelir\Siteler\DisKlinikCRM-git` olarak kayıtlıydı — bu, F0-002 Stage A sırasında bayat olduğu tespit edilip düzeltildi; hiçbir Git/GitHub kanıtını etkilemez. |
| Default branch | `main` |
| Current branch (bu dokümantasyon çalışması) | `docs/f0-002-repository-deployment-baseline` |
| F0-002 isolated worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` — tercih edilen `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` yolundan sapma; bu ortamda `E:` sürücüsü bağlı değil (bkz. evidence dosyası "Deviations from instructions"). |
| Documentation branch creation base | `4302825abcdf4f5dbb90b4ded92b2e44a947df18` (F0-002 branch'i oluşturulduğu andaki `origin/main`, 2026-07-18 — aynı zamanda PR #166 merge commit'i; `main` bu commit'in ötesine geçmemiş) |
| PR base branch | `main` |
| Current main commit | `4302825abcdf4f5dbb90b4ded92b2e44a947df18` — `VERIFIED_GIT` (refreshed `origin/main`, `git fetch` + `git rev-parse origin/main` ile doğrulandı, 2026-07-18) |
| Repository migration head | `20260716120000_add_clinic_bulk_export` — `VERIFIED_REPOSITORY` (60 migration dizini, doğrusal, çakışma/eksik yok — bkz. evidence §6.5) |
| Production commit | `7fcf2f850f151241266f07349c4bf4442c72bbca`, branch `main`, working tree `CLEAN` — `VERIFIED_PRODUCTION_OBSERVED`, evidence timestamp `2026-07-19T13:43:12+03:00` (bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.2). `origin/main` o anda `d9fc40883afc8791098865d4d185de3336774c7a` idi; fark yalnızca dokümantasyon-yalnız [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) — runtime deployment drift **değildir**. |
| Backend deployment | `noramedi-api` PM2 süreci `online`, fork mode, ~38 dk uptime, 14 restart, 0 unstable restart — `VERIFIED_PRODUCTION_OBSERVED`. Local `/api/health` → 200, public `/api/health` → 200. Restart sayısı gözlemsel meta veri olarak kaydedilmiştir; kesinti/instabilite iddiası **yapılmaz** (bkz. evidence §B.4/§B.11). |
| Frontend deployment | Ayrı bir build-artifact-kaynak eşleşme kontrolü Stage B kapsamında **yapılmadı** (salt-okunur komut setinin dışında) — `UNVERIFIED_PRODUCTION` olarak kalır. |
| Worker deployment | `noramedi-worker` PM2 süreci `online`, fork mode, ~39 dk uptime, 13 restart, 0 unstable restart — **artık `VERIFIED_PRODUCTION_OBSERVED`** (bkz. evidence §B.4). Depoda bu sürecin adı hâlâ **bulunamıyor** (bkz. evidence §6.6/§6.10 madde 3) — süreç production'da çalışıyor ama depo, onu nasıl deploy ettiğini/yeniden başlattığını tanımlamıyor; bu operasyonel boşluk F0-006'ya taşınır. |
| Current production database migration | `20260718164142_add_communication_preference_and_consent`, başladı `2026-07-19 13:03:57+03`, bitti `2026-07-19 13:03:58+03`, 0 tamamlanmamış migration — **repository migration head'iyle ve deploy edilen commit'le tutarlı** — `VERIFIED_PRODUCTION_OBSERVED` (bkz. evidence §B.7). |
| Last backup | En son eşleşen yedek `~38.160` saniye (≈10.6 saat) eski, `434.585` bayt, 7 eşleşen yedek dosyası, cron ile zamanlanmış (systemd timer yok) — `VERIFIED_PRODUCTION_OBSERVED` (bkz. evidence §B.10). Offsite kopya kanıtı **bulunamadı** (`HIGH` risk, bkz. §12/evidence §B.11). |
| Last restore test | `UNVERIFIED` — otomatik restore-test cron/systemd job'ı bulunamadı, kalıcı manuel kanıt sağlanmadı. **Bu, bir restore testinin hiç yapılmadığı anlamına gelmez** — yalnızca dar kapsamlı otomatik kontrolün sonucu (bkz. evidence §B.10/§B.11). |
| Last production verification | `NOT_APPLICABLE` bir release-gate `PRODUCTION_VERIFIED` durumu olarak — F0-002 bir envanter görevidir, release-gate doğrulaması iddia etmez. Gözlemsel kanıt: local+public health check'leri `2026-07-19T13:43:12+03:00` civarında ikisi de `200` döndü (bkz. evidence §B.5). |
| Last confirmed merged KVKK work | [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) — KVKK-HIGH-004 secure clinic bulk export — `MERGED` (2026-07-17) |
| Currently active KVKK work | [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) — KVKK-CRIT-003 (security incident response foundation). `OPEN`, not draft, mergeable snapshot `true` — `VERIFIED_GITHUB` (`gh pr view 167`, 2026-07-18). Head branch `feature/kvkk-crit-003-security-incident-foundation` @ `9c5c15512e1bc013340526a7f7c3792c32b0f408`, base `main`, 29 changed files, 3 commits. The PR body and commit messages report implementation/test activity (e.g. disposable-Postgres migration runs, `test:security-incidents` results), but these are **self-reported claims by the PR's own commits and are not independently accepted by F0-002** — F0-002 did not run, review, or verify any of that testing itself. PR #167 is **not** `MERGED`, **not** `DEPLOYED`, and has **no** `PRODUCTION_VERIFIED` status; acceptance and merge remain dış inceleme (ChatGPT/kullanıcı) kararı. |
| Local observation (KVKK) | Yerel branch: `feature/kvkk-crit-003-security-incident-foundation`. Stage A başlangıcı (2026-07-18): temiz. Dış inceleme ara kontrolü (2026-07-18, aynı gün sonra): eşzamanlı değişmiş/untracked dosyalar mevcuttu (liste evidence dokümanında; F0-002 tarafından oluşturulmadı). Önceki düzeltme kontrolü (2026-07-18, remediation #1): yeniden temiz, remote ile güncel. Bu son düzeltme kontrolü (2026-07-18, remediation #2): 1 untracked dosya mevcut (`server/.env.pre-security-smoke-*`; F0-002 tarafından oluşturulmadı) — ağaç, eşzamanlı KVKK çalışması (bkz. PR #167 yukarıda) sürdüğü için zaman içinde değişmeye devam ediyor; bu **kararlı bir durum değildir**, yalnızca tek bir anlık gözlemdir. Tüm gözlemler **salt-okunur** (`git status`/`git branch`) — F0-002 bu ağaca hiçbir yazma/commit/reset/checkout komutu çalıştırmadı. Sınıflandırma: `OBSERVED_LOCAL_ONLY`. Remote branch'in scope/completion/deployment durumu (PR üzerinden dış onay/merge/deploy dışında): `UNVERIFIED` (F0-007 kapsamı) |
| Known blockers | Bkz. §12 |

## 4. Phase summary (Faz özeti)

| Faz | Ad | Durum | Giriş koşulu | Çıkış kapısı | Bloklayan bağımlılık | Son güncelleme |
|---|---|---|---|---|---|---|
| F0 | Baseline, Program Control, and Architecture Validation | `IN_PROGRESS` | Program başlangıcı | G0: F0 doğrulama raporu (F0-013) onayı | Aktif KVKK çalışması taban çizgisi (mimari değişiklikler için) | 2026-07-18 |
| F1 | CI and Test Architecture | `TODO` | G0 onayı | Etki-bazlı CI modeli kanıtla çalışıyor | F0 | 2026-07-17 |
| F2 | Modular Boundaries and Public Contracts | `TODO` | F1 çıkışı | Modül sınırları + public contract'lar kabul | F1 | 2026-07-17 |
| F3 | Production Hardening | `TODO` | F2 çıkışı | Sertleştirme kanıtları + gözlemlenebilirlik | F2 | 2026-07-17 |
| F4 | Storage and Backup Foundation | `TODO` | F3 çıkışı | Object storage + yedekleme/restore kanıtı | F3 | 2026-07-17 |
| F5 | Tenant Isolation, Prisma, RLS, and PgBouncer | `TODO` | F4 çıkışı + KVKK baseline | RLS/PgBouncer PoC kanıtı + rollout planı | F4, KVKK baseline | 2026-07-17 |
| F6 | Queue, Outbox, Idempotency, and Reliability | `TODO` | F5 çıkışı | Outbox/idempotency kanıtı | F5 | 2026-07-17 |
| F7 | Horizontal Scaling and High Availability | `TODO` | F6 çıkışı | Çok-instance + HA kanıtı | F6 | 2026-07-17 |
| F8 | AI Gateway and AI Governance | `TODO` | F2 çıkışı (paralelleştirilebilirliği F0-013 belirler) | AI Gateway + governance kanıtı | F2 | 2026-07-17 |
| F9 | Official Integration Platform | `TODO` | F6 çıkışı | Adapter platformu + ilk resmî entegrasyon kanıtı | F6 | 2026-07-17 |
| F10 | Imaging, DICOM, CBCT, and Medical Imaging AI | `TODO` | F4 çıkışı | Imaging altyapı + PACS bileşen kanıtı | F4, F8 (AI kısmı) | 2026-07-17 |
| F11 | Enterprise Scale, Dedicated Tenants, DR, and Advanced Operations | `TODO` | F7 çıkışı | G6 kanıt seti | F7, F9, F10 | 2026-07-17 |

## 5. Active task (Aktif görev)

| Alan | Değer |
|---|---|
| ID | F0-002 |
| Title | Repository and Deployment Baseline Inventory |
| Status | `AGENT_COMPLETED` — Stage A (depo kanıtı) ve Stage B (production baseline kanıtı, kullanıcı tarafından salt-okunur sağlandı, evidence timestamp `2026-07-19T13:43:12+03:00`) ikisi de tamamlandı. PR bu teslimat sırasında henüz açılmadı; açıldıktan sonra durum `PR_OPEN`'a güncellenecek. `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` ajan tarafından **atanamaz** — dış teyit gerektirir. |
| Branch | `docs/f0-002-repository-deployment-baseline` |
| Worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline` (izole; ana KVKK çalışma ağacına dokunulmadı). `origin/main`'den F0-003/F0-004/F0-005'i içeren normal, force olmayan `git merge` ile güncellendi (2026-07-19). |
| Scope | Yalnızca analiz/dokümantasyon: depo/deployment/production-baseline envanteri (`docs/program/`) |
| Out of scope | Tüm uygulama, şema, migration, test, CI, deployment değişiklikleri; production'a yazma erişimi (yalnızca kullanıcının salt-okunur VPS kanıtı toplanmıştır) |
| Dependency | F0-001 (`MERGED`) |
| Reviewer | ChatGPT / kullanıcı |
| Evidence | [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md), [evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md), [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) |
| Ajan için izinli sonraki durum | PR açıldıktan sonra `PR_OPEN` (PR referansıyla); `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` yalnızca dış kanıtla kaydedilebilir |

## 6. Current F0 task backlog (F0 görev listesi)

### F0-001 — Program Control and Master Tracker Foundation
- **Status:** `MERGED` — [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166), merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, merged at `2026-07-18T08:08:10Z` (`gh pr view 166` ile doğrulandı — `VERIFIED_GITHUB`).
- **Purpose:** Depo-tabanlı yetkili program takip sistemini (`docs/program/`) oluşturmak.
- **Dependencies:** Yok.
- **Deliverables:** 24 Markdown dosyası (12 kök + 12 faz dokümanı).
- **Evidence required:** Dosyaların depoda varlığı; uygulama/şema/CI/test dosyalarının değişmediğinin `git status` kanıtı. ✅ Karşılandı.
- **Blocking conditions:** Yok.
- **Allowed next status:** Yok — `MERGED` nihai durumdur.

### F0-002 — Repository and Deployment Baseline Inventory
- **Status:** `AGENT_COMPLETED` — Stage A (depo, toolchain, script, Prisma/migration, deployment, runtime-bağımlılık ve CI envanteri, bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)) ve Stage B (production baseline kanıtı — host, PM2 topolojisi, health, TLS, DB/migration, config presence, storage, backup/PITR/restore-test durumu; kullanıcı tarafından salt-okunur olarak sağlandı, evidence timestamp `2026-07-19T13:43:12+03:00`, bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)) ikisi de tamamlandı. PR bu teslimatta henüz açılmadı.
- **Purpose:** Depo, branch, migration, deployment ve ortam taban çizgisini **kanıtla** envanterlemek; §3'teki `UNVERIFIED` alanları doldurmak.
- **Dependencies:** F0-001 (`MERGED`).
- **Deliverables:** Güncellenmiş §3 baseline tablosu + [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md) + [evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md) + [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) (yeni).
- **Evidence required:** Git referansları ✅, migration listesi ✅, deployment tanımı ✅ (depo kapasitesi olarak); deployment revizyon/production kanıtı ✅ (Stage B tamamlandı).
- **Blocking conditions:** Yok — Stage A ve Stage B ikisi de tamamlandı. **Yalnızca analiz/dokümantasyon; uygulama davranışı değiştirilmedi, production'a hiçbir yazma erişimi kullanılmadı.**
- **Accepted open risks (remediated değil, yalnızca belgelendi):** yerel VPS storage (S3 yok), offsite yedek kanıtı yok, PITR yapılandırılmamış (`archive_mode: off`), restore test `UNVERIFIED`, Node sürüm sapması (CI'da 20, production'da 22.23.1, `engines` pini yok), PM2 restart sayıları (14/13) operasyonel inceleme gerektiriyor, PM2 süreçleri `root` olarak çalışıyor. Ayrıntı: [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.11.
- **Allowed next status:** PR açıldıktan sonra `PR_OPEN` (PR referansıyla); `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` yalnızca dış kanıtla kaydedilebilir.

### F0-003 — Domain and Module Ownership Map
- **Status:** `MERGED` — [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) `main`'e merge edildi, merge commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (2026-07-18T18:27:09Z, `gh pr view 168` ile teyit edildi). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı; F0-004'ün başlangıç kanıt taramasında düzeltildi (bkz. F0-004 teslim raporu "PARALLEL EXECUTION DECISION").
- **Purpose:** [MODULE_MAP.md](MODULE_MAP.md) içindeki geçici hedef haritayı gerçek dosya sahipliğiyle doğrulamak ve revize etmek.
- **Dependencies:** F0-002 (tracker kuralı gereği).
- **Parallel execution note:** Bu görev, F0-002'nin genel görev durumu `IN_PROGRESS`/`READY` iken (Stage B hâlâ bloklu) kullanıcının **açık talimatıyla** paralel başlatıldı. Bu, görevin orijinal yönlendirme metninin ("F0-003 paralel çalışmaya yetkilidir") **F0-002'nin kendi kanıt dokümanının** ("F0-003 bu tur içinde başlatılmadı") ile çeliştiği tespit edildikten ve kullanıcıya sorulduktan sonra yapıldı — kullanıcı "Proceed anyway" seçeneğini seçti. Bu istisna yalnızca bu göreve özgüdür; gelecekteki görevler için paralel-yetki emsali oluşturmaz.
- **Deliverables:** [MODULE_MAP.md](MODULE_MAP.md) (revize edildi), [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md](evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md) (yeni), [evidence/F0-003_module_ownership_inventory.json](evidence/F0-003_module_ownership_inventory.json) (yeni), [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) güncellemesi (yalnızca domain kümesi notu — matris hâlâ F0-004'ün işi), [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-001/ADR-015 kanıt işaretçileri.
- **Evidence required:** Dosya/dizin → domain eşleme listesi. ✅ Karşılandı — 88/88 committed Prisma modeli, 56/56 route dosyası, 79/79 servis dosyası, 10/10 job dosyası, 5/5 middleware dosyası, 72/72 test dosyası, 64/64 frontend sayfası eşlendi.
- **Blocking conditions:** Yok (analiz-yalnız). Bu görev VPS/production erişimi gerektirmedi ve kullanmadı.
- **Allowed next status:** Dış inceleme sonrası `REVIEW_REQUIRED`/`CHANGES_REQUESTED`/PR akışı — `MERGED` yalnızca dış merge kanıtıyla kaydedilebilir.

### F0-004 — Cross-Module Dependency Map
- **Status:** `MERGED` — [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) `main`'e merge edildi, merge commit `5ee0b6af30fff187b7190d649f1fc3e844362105` (2026-07-18T20:37:49Z, `gh pr view 170` ile teyit edildi). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı; F0-005'in PR #171 düzeltme turunda düzeltildi. Worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-004-dependency-map`, branch `docs/f0-004-cross-module-dependency-map`, base `origin/main` @ `131c7cc398fde6c72fea275a40b7efcc1253b828` (PR açılırken kullanılan base — merge sonrası `main` üzerinde artık `5ee0b6a`). **Deployed / Production Verified: NOT APPLICABLE** — `MERGED` yalnızca `main`'e merge kanıtını ifade eder; bu dokümantasyon-yalnız görev için deployment veya production doğrulaması ne iddia edilir ne de gereklidir (§2 legend: `DEPLOYED`/`PRODUCTION_VERIFIED` ayrı, daha güçlü kanıt gerektiren durumlardır).
- **Purpose:** [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) matrisini depo kanıtıyla doldurmak; ihlalleri işaretlemek.
- **Dependencies:** F0-003. ✅ Karşılandı — F0-003 `main`'e merge edildi (yukarıda).
- **Parallel execution note:** Bu görev, kullanıcının **açık talimatıyla**, F0-002 Stage B (production/VPS kanıtı) hâlâ `BLOCKED` iken, repository-only paralel yetkiyle yürütüldü. Bu yetki F0-002'yi tamamlamaz, VPS erişimi/production varsayımı/runtime veya şema değişikliği yetkilendirmez ve gelecekteki görevler için paralel-yetki emsali oluşturmaz (F0-003'ün kendi notundaki istisna kapsamıyla aynı ilke).
- **Deliverables:** [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) (37-domain matris dolduruldu), [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md) (yeni), [evidence/F0-004_dependency_inventory.json](evidence/F0-004_dependency_inventory.json) (yeni, 833 edge/35 cycle/15 contract candidate/16 raw-SQL kaydı).
- **Evidence required:** Import/çağrı kanıtları (dosya:satır). ✅ Karşılandı — 833 edge (307 IMPORT + 526 DATA_READ/WRITE), 224 dolu matris hücresi, her biri en az bir `F0004-Exxxx` kanıt kaydına bağlı; 264/833 edge tek tek incelendi, kalan 569'u belgelenmiş kural-tabanlı varsayılan sınıflandırma kullanıyor (bkz. evidence doc §1).
- **Blocking conditions:** Yok (analiz-yalnız). Bu görev VPS/production erişimi gerektirmedi ve kullanmadı.
- **Allowed next status:** Dış inceleme sonrası `REVIEW_REQUIRED`/`CHANGES_REQUESTED`/PR akışı — `MERGED` yalnızca dış merge kanıtıyla kaydedilebilir.

### F0-005 — Test Inventory, Runtime Measurement, and Ownership Map
- **Status:** `MERGED` — [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) `main`'e merge edildi, merge commit `d9fc40883afc8791098865d4d185de3336774c7a` (2026-07-19, `docs(test): add F0-005 test inventory and runtime baseline (#171)`). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı; F0-002'nin bu turunda düzeltildi. **Commit kanıtı:**
  - `534b66e917d4f2b27b7d464f565d3a5d91c5bd4a` — ilk envanter/kanıt commit'i (2026-07-18), orijinal baseline `5ee0b6a` üzerinde.
  - `1e10909...` — bu satırın `PR_OPEN` durumunu kaydeden takip commit'i (2026-07-18).
  - `ecee8533df0aaa5f29bcbf4c69f89b2a00856912` — `origin/main`'in PR #169 ile ilerlemesi üzerine yapılan normal, force olmayan `git merge origin/main` commit'i (2026-07-19); F0-004'ün gerçek `MERGED` durumunu ve PR #169'un 3 yeni test dosyasını branch'e getirdi.
  - `76bdf1136b0f6cb98a04d3d5a335281f5c0cac32` — bu rebaseline'ın kendi düzeltme commit'i (2026-07-19): F0-004 durum düzeltmesi, PR #169'un 3 yeni test dosyasının tam envanter/runtime rebaseline'ı, "test framework yok" iddiasının daraltılması, başarısızlık terminolojisinin netleştirilmesi.
  - Worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-005-test-ownership`, branch `docs/f0-005-test-inventory-runtime-ownership`, merge sonrası `main` @ `d9fc40883afc8791098865d4d185de3336774c7a`.
- **Purpose:** [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) envanter tablosunu doldurmak: test dosyaları, süreler, DB/harici bağımlılıklar, güvenilirlik.
- **Dependencies:** F0-003, F0-004. ✅ Karşılandı — F0-003 ve F0-004 ikisi de `main`'e merge edildi (yukarıda); F0-003'ün committed `tests[]` alanı bu görevin sahiplik envanterinin temeli olarak doğrudan yeniden kullanıldı.
- **Parallel execution note:** Bu görev, kullanıcının **açık talimatıyla**, F0-002 Stage B (production/VPS kanıtı) hâlâ `BLOCKED` iken, repository-only paralel yetkiyle yürütüldü — F0-003/F0-004'teki aynı istisna ilkesiyle (bkz. o görevlerin "Parallel execution note"). Bu yetki F0-002'yi tamamlamaz, VPS erişimi/production varsayımı/runtime veya şema değişikliği yetkilendirmez ve gelecekteki görevler için paralel-yetki emsali oluşturmaz.
- **Deliverables:** [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) (revize edildi — placeholder §3 depo-kanıtıyla dolduruldu, 2026-07-19 rebaseline dahil), [evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md](evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md) (yeni), [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) (yeni, **100** test/doğrulama hedefi — rebaseline öncesi 97), [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json) (yeni, 17 komut/suite çalıştırma kaydı — rebaseline öncesi 15).
- **Evidence required:** Test çalıştırma çıktıları (hedefli; tüm suite zorunlu değil). ✅ Karşılandı — orijinal baseline'da 2532 assertion gerçekten çalıştırıldı (backend 70/70 `.test.ts` dosyası, frontend 5/5, bridge-agent 9/9, windows-bridge installer PowerShell 4/4 script); 2026-07-19 rebaseline'ında bu tekrar doğrulandı ve PR #169'un 3 yeni dosyası eklendi (backend artık 72/72, frontend 6/6) — 2 yeni backend dosyası `DATABASE_URL` erişilemediği için BLOCKED, 1 yeni frontend dosyası 13/13 geçti. 2 gerçek/deterministic ve environment-sensitive bulgu bulundu ve düzeltilmeden belgelendi (`overdueInstallments.test.ts` — orphan script, **deterministic source-drift**; `clinicBulkExport.test.ts` — **environment-sensitive** Windows CRLF ortam artefaktı); bu görev tarafından **0 doğrulanmış product-runtime kusuru** tespit edilmiştir. windows-bridge .NET testleri (`dotnet test`), `securityIncident.test.ts`, ve rebaseline'ın 2 yeni DB-bağımlı dosyası (`communicationConsent.test.ts`, `communicationPreferenceBackfill.test.ts`) ölçülemedi (bkz. Blocking conditions).
- **Blocking conditions:** Pahalı/geniş suite'ler için kullanıcı onayı — bu görevde full-suite çalıştırma sınırlı kalındı (talimata uygun). windows-bridge `dotnet test` **BLOCKED** (`windows-bridge/global.json` .NET SDK 10.0.301 istiyor, makinede yalnızca 9.0.305 kurulu). `securityIncident.test.ts` + `communicationConsent.test.ts` + `communicationPreferenceBackfill.test.ts` + 3 manuel `server/scripts/verify-*.ts` **BLOCKED** (depoda commit edilmiş disposable-Postgres kurulum otomasyonu yok; Docker CLI makinede mevcut ancak daemon çalışmıyor, ve talimatın "improvised setup yapma" kuralı gereği kullanılmadı).
- **Allowed next status:** Yok — `MERGED` nihai durumdur (PR #171, merge commit `d9fc40883afc8791098865d4d185de3336774c7a`). `DEPLOYED`/`PRODUCTION_VERIFIED` bu dokümantasyon-yalnız görev için **NOT APPLICABLE** kalır.

### F0-006 — Production Topology and Configuration Verification
- **Status:** `TODO`
- **Purpose:** Production topolojisini (sunucu, DB, worker, storage, proxy) kanıtla doğrulamak.
- **Dependencies:** F0-002.
- **Deliverables:** Topoloji raporu; §3 deployment alanlarının doldurulması.
- **Evidence required:** Kullanıcı tarafından sağlanan/erişilebilen ortam kanıtları.
- **Blocking conditions:** Production erişimi kullanıcı iş birliği gerektirir.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary
- **Status:** `TODO`
- **Purpose:** Aktif KVKK çalışmasının kapsamını, dokunduğu dosyaları ve mimari dondurma sınırını belgelemek.
- **Dependencies:** F0-002.
- **Deliverables:** KVKK baseline raporu + dondurma sınırı listesi.
- **Evidence required:** KVKK branch/PR durumu; dokunulan dosya listesi.
- **Blocking conditions:** KVKK çalışmasının dış teyidi kullanıcıdan gelir.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-008 — ADR Review and Enterprise Foundation Decision Set
- **Status:** `TODO`
- **Purpose:** ADR-001…017 taslaklarını inceleme için hazırlamak; karar girdilerini toplamak.
- **Dependencies:** F0-003, F0-004.
- **Deliverables:** İnceleme-hazır ADR taslakları.
- **Evidence required:** Her ADR için depo kanıtı bölümü.
- **Blocking conditions:** ADR kabulü dış onay gerektirir.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-009 — RLS, Prisma, and PgBouncer Proof-of-Concept Design
- **Status:** `TODO`
- **Purpose:** RLS + Prisma + PgBouncer uyumluluğu için PoC **tasarımı** (uygulama değil).
- **Dependencies:** F0-004, F0-008.
- **Deliverables:** PoC tasarım dokümanı + ölçüm kriterleri.
- **Evidence required:** Tasarımın ADR-004/ADR-005 ile tutarlılığı.
- **Blocking conditions:** PoC **uygulaması** KVKK baseline'a ve F5'e kadar bloklu; bu görev yalnızca tasarımdır.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-010 — Queue and Transactional Outbox Proof-of-Concept Design
- **Status:** `TODO`
- **Purpose:** Kuyruk + transactional outbox + idempotency için PoC **tasarımı**.
- **Dependencies:** F0-004, F0-008.
- **Deliverables:** PoC tasarım dokümanı + ölçüm kriterleri.
- **Evidence required:** Tasarımın ADR-006/ADR-007 ile tutarlılığı.
- **Blocking conditions:** Uygulama F6'ya kadar bloklu; bu görev yalnızca tasarımdır.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-011 — Object Storage and Backup Migration Design
- **Status:** `TODO`
- **Purpose:** Object storage soyutlaması ve yedekleme/migrasyon **tasarımı**.
- **Dependencies:** F0-002, F0-006.
- **Deliverables:** Storage/backup tasarım dokümanı; sağlayıcı seçenekleri ve veri yerleşimi (data residency) analizi.
- **Evidence required:** Mevcut depolama kullanımının envanteri.
- **Blocking conditions:** Storage-key migrasyonu KVKK baseline'a kadar bloklu; bu görev yalnızca tasarımdır.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-012 — Controlled Pilot and General Launch Gate Definition
- **Status:** `TODO`
- **Purpose:** G1 (kontrollü pilot) ve G2 (genel ticari lansman) kapılarının kanıt listelerini ayrıntılandırmak.
- **Dependencies:** F0-006, F0-007.
- **Deliverables:** Güncellenmiş [RELEASE_GATES.md](RELEASE_GATES.md) kapı tanımları.
- **Evidence required:** Kapı kriterlerinin risk kaydıyla eşleşmesi.
- **Blocking conditions:** Kapı onayı dış karar gerektirir.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-013 — F0 Consolidated Architecture Validation Report
- **Status:** `TODO`
- **Purpose:** F0 çıktılarının birleşik doğrulama raporu; G0 kapısına sunulacak kanıt seti.
- **Dependencies:** F0-002…F0-012 (tümü).
- **Deliverables:** Konsolide rapor.
- **Evidence required:** Önceki görevlerin kanıt referansları.
- **Blocking conditions:** Önceki görevler tamamlanmadan başlayamaz.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`; G0 kararı dış onaydır.

## 7. Completed tasks (Tamamlanan görevler)

| ID | Başlık | Durum | Not |
|---|---|---|---|
| F0-001 | Program Control and Master Tracker Foundation | `MERGED` | [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166), merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, merged `2026-07-18T08:08:10Z` — `VERIFIED_GITHUB`. Yalnızca dokümantasyon; uygulama/mimari doğrulama F0-002+ kapsamındadır. |
| F0-003 | Domain and Module Ownership Map | `MERGED` | Depo-doğrulanmış domain/modül haritası; F0-002'nin genel görev durumu tamamlanmadan, kullanıcının açık talimatıyla paralel yürütüldü (bkz. §6 F0-003 "Parallel execution note"). [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) `main`'e merge edildi, commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (2026-07-18). |
| F0-004 | Cross-Module Dependency Map | `MERGED` | Depo-kanıtıyla dolu 37-domain/833-edge bağımlılık matrisi; F0-002 Stage B hâlâ toplanmadan kullanıcının açık talimatıyla repository-only paralel yürütüldü (bkz. §6 F0-004 "Parallel execution note"). [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) `main`'e merge edildi, merge commit `5ee0b6af30fff187b7190d649f1fc3e844362105`. Deployed/Production Verified: NOT APPLICABLE. |
| F0-005 | Test Inventory, Runtime Measurement, and Ownership Map | `MERGED` | 100 test/doğrulama hedefinin depo-kanıtıyla envanteri (rebaseline öncesi 97 — 2026-07-19'da `origin/main`'den PR #169'u içeren bir merge sonrası 3 yeni dosya eklendi) + sahiplik + F0-004'ün 9 yüksek-riskli edge'inin test kapsamı; 2532+ assertion gerçekten çalıştırıldı, 1 deterministic source-drift başarısızlığı (`overdueInstallments.test.ts`, CI-uygulama boşluğunun somut kanıtı) + 1 environment-sensitive line-ending başarısızlığı (`clinicBulkExport.test.ts`) bulunup düzeltilmeden belgelendi — bu görev tarafından 0 doğrulanmış product-runtime kusuru tespit edilmiştir. F0-002 Stage B kanıtı henüz toplanmadan kullanıcının açık talimatıyla repository-only paralel yürütüldü (bkz. §6 F0-005 "Parallel execution note"). [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) `main`'e merge edildi, merge commit `d9fc40883afc8791098865d4d185de3336774c7a` (2026-07-19, `docs(test): add F0-005 test inventory and runtime baseline (#171)`). Deployed/Production Verified: NOT APPLICABLE. |

## 8. Blocked tasks (Bloklu işler)

Aktif KVKK/gizlilik geliştirmesi dışarıdan teyit edilmiş kararlı bir taban çizgisine ulaşana kadar aşağıdaki **fiziksel mimari değişiklikleri BLOKLUDUR**:

1. Geniş Prisma şema değişiklikleri
2. Tenant `organizationId` backfill'leri
3. RLS migration'ları
4. Prisma tenant extension rollout'u
5. Fiziksel modül refactoring'i
6. Privacy modeli taşıma
7. Consent modeli taşıma
8. Retention modeli taşıma
9. Anonimleştirme iş akışı yeniden yapılandırması
10. Attachment fiziksel-silme iş akışı değişiklikleri
11. Storage-key migrasyonu
12. Geniş authentication middleware yeniden yapılandırması

F0 kapsamında **serbest** olan işler: dokümantasyon, depo envanteri, modül haritalama, test envanteri, ADR çalışması ve invaziv olmayan analiz.

## 9. Accepted decisions (Kabul edilmiş program yönü kararları)

Aşağıdakiler `PROGRAM DIRECTION` niteliğindedir; **kesinleşmiş ADR değildir** (ADR süreci için bkz. [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)).

| # | Karar | Nitelik |
|---|---|---|
| 1 | Tam yeniden yazım (full rewrite) yok | PROGRAM DIRECTION |
| 2 | Kanıt aksini gerektirmedikçe React/Vite korunur | PROGRAM DIRECTION |
| 3 | Kanıt aksini gerektirmedikçe Express korunur | PROGRAM DIRECTION |
| 4 | PoC uygunsuzluğunu kanıtlamadıkça Prisma korunur | PROGRAM DIRECTION |
| 5 | PostgreSQL korunur | PROGRAM DIRECTION |
| 6 | Hedef: modüler monolit | PROGRAM DIRECTION |
| 7 | Servis çıkarımı yalnızca gerekçeli sınırlar için | PROGRAM DIRECTION |
| 8 | Erken (premature) microservice'ten kaçınılır | PROGRAM DIRECTION |
| 9 | Erken Kafka'dan kaçınılır | PROGRAM DIRECTION |
| 10 | Erken Kubernetes'ten kaçınılır | PROGRAM DIRECTION |
| 11 | Varsayılan hedef shared-schema tenancy; kurumsal müşteriler için dedicated tenant kabiliyeti hazırlanır | PROGRAM DIRECTION |
| 12 | Defense-in-depth tenant izolasyonu zorunlu | PROGRAM DIRECTION |
| 13 | Imaging ölçeklenmeden önce object storage zorunlu | PROGRAM DIRECTION |
| 14 | AI Gateway ve AI governance zorunlu | PROGRAM DIRECTION |
| 15 | Resmî entegrasyonlar adapter-tabanlı olmalı | PROGRAM DIRECTION |
| 16 | PACS sıfırdan yazılmaz; Orthanc/OHIF-tarzı yerleşik imaging bileşenleri kullanılır | PROGRAM DIRECTION |
| 17 | Kontrollü pilot kapıları ile genel ticari lansman kapıları ayrıdır | PROGRAM DIRECTION |

## 10. Deferred or rejected decisions (Ertelenen/reddedilen kararlar)

| Karar | Durum |
|---|---|
| Tam uygulama yeniden yazımı | `REJECTED` — gelecekte kanıt kaçınılmaz olduğunu ispatlamadıkça |
| Acil NestJS migrasyonu | `DEFERRED/REJECTED` |
| Kimlik doğrulamalı CRM için acil Next.js migrasyonu | `DEFERRED/REJECTED` |
| Acil microservice bölünmesi | `REJECTED` |
| Acil Kafka girişi | `DEFERRED` — ölçülebilir tetikleyiciye kadar |
| Acil Kubernetes girişi | `DEFERRED` — ölçülebilir tetikleyiciye kadar |
| Schema-per-tenant | `REJECTED` — varsayılan strateji olarak |

## 11. Production verification history (Production doğrulama geçmişi)

Bu tablo, §2.2'deki `PRODUCTION_VERIFIED` release-gate durumu için resmî kayıttır — henüz bu program kapsamında böyle bir release-gate doğrulaması yapılmamıştır.

| Tarih | Görev/Sürüm | Ortam | Test | Sonuç | Kanıt |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

**Not (release-gate doğrulaması ile karıştırılmamalı):** F0-002 Stage B kapsamında 2026-07-19'da (`2026-07-19T13:43:12+03:00`) gözlemsel bir production baseline kanıtı toplandı — local/public `/api/health` her ikisi de `200`, migration state temiz, PM2 topolojisi `online`, TLS hostname kapsamı doğrulandı (bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)). Bu, F0-002'nin bir **envanter/dokümantasyon** görevi olması nedeniyle yukarıdaki tablonun tanımladığı resmî `PRODUCTION_VERIFIED` release-gate doğrulaması **değildir** ve öyle sayılmamalıdır; storage/PITR/restore-test/offsite-backup riskleri (bkz. §12) açık ve düzeltilmemiş kalır.

## 12. Current blockers (Güncel blokajlar)

1. KVKK taban çizgisi henüz dışarıdan kararlı olarak teyit edilmedi. KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi (2026-07-17); ancak bu, tüm KVKK programının tamamlandığı anlamına gelmez. Devam eden KVKK çalışması artık [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003) olarak kanıtlandı — `OPEN`, merge edilmedi, deploy edilmedi, production doğrulaması yapılmadı (`VERIFIED_GITHUB`, bkz. §3). F0-007 bu PR'ın kapsamını ve mimari dondurma sınırıyla ilişkisini ayrıntılı olarak belgeleyecektir.
2. Depo taban çizgisi (baseline) Stage A kapsamında **kanıtla toplandı** (F0-002 Stage A `AGENT_COMPLETED`, bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)); production baseline kanıtı da artık Stage B kapsamında **toplandı ve belgelendi** (kullanıcı tarafından salt-okunur, evidence timestamp `2026-07-19T13:43:12+03:00`, bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)). Bu artık bir blokaj değildir; F0-002 `AGENT_COMPLETED`'dır ve PR bekliyor.
3. Production topolojisi F0-002 Stage B kapsamında **gözlemsel olarak doğrulandı** (bare-VPS + PM2 + host Nginx, Docker Compose runbook'u stale/aspirasyonel olarak doğrulandı — bkz. evidence §6.10 madde 1). Kalan açık riskler artık bir "topoloji bilinmiyor" blokajı değil, belirli, kimliklendirilmiş riskler: (a) yerel VPS storage (S3 yok, HIGH), (b) offsite yedek kanıtı yok (HIGH), (c) PITR yapılandırılmamış (`archive_mode: off`, HIGH), (d) restore test `UNVERIFIED` (HIGH), (e) PM2 restart sayıları (14/13) operasyonel inceleme gerektiriyor (MEDIUM), (f) PM2 süreçleri `root` olarak çalışıyor, privilege hardening değerlendirilmedi (MEDIUM), (g) Node sürüm sapması — CI'da 20, production'da 22.23.1, `engines` pini yok (yeni bulgu, Stage B). Bu risklerin biçimsel, ayrıntılı ele alınışı F0-006'ya aittir; F0-002 yalnızca envanterler, düzeltmez.
4. RLS / Prisma / PgBouncer uyumluluğu henüz kanıtlanmadı (F0-009 → F5).
5. Object-storage sağlayıcısı ve migrasyon tasarımı henüz onaylanmadı (F0-011 → F4). Mevcut durum artık kanıtla biliniyor: `LOCAL_VPS_STORAGE` (bkz. evidence §B.9), tasarım kararı hâlâ bekliyor.
6. Queue/outbox mimarisi henüz kanıtlanmadı (F0-010 → F6).
7. F0-002'nin genel görev durumu bu dosyada (`main`) hâlâ eski (Stage B öncesi) görünüyor olabilir çünkü F0-002'nin çalışma branch'i (`docs/f0-002-repository-deployment-baseline`, worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-002-baseline`) bu teslimat anında henüz `main`'e merge edilmedi — PR açılacak ama merge kararı dış incelemeye aittir. O branch'in kendi tracker kopyası artık Stage A'yı ve Stage B'yi (production baseline kanıtı) `AGENT_COMPLETED` olarak kaydediyor (bkz. §5/§6 F0-002). `main` üzerindeki bu satır, F0-002 merge edilene kadar güncellenmeyecektir.

## 13. Exact next task (Kesin sonraki görev)

**External review and merge decision for F0-002** (PR pending as of this delivery — see §6 F0-002 and §5).

F0-002 Stage A (depo kanıtı) ve Stage B (production baseline kanıtı, kullanıcı tarafından salt-okunur olarak sağlandı ve bu turda [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)'e işlendi, evidence timestamp `2026-07-19T13:43:12+03:00`) ikisi de tamamlandı; F0-002'nin genel görev durumu ajan tarafından en fazla `AGENT_COMPLETED` (PR açılana kadar) / `PR_OPEN` (PR açıldıktan sonra) olabilir — `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` dış teyit gerektirir ve bu turda **atanmaz**. F0-002 yalnızca **analiz/dokümantasyon** görevidir; uygulama davranışını, şemayı, migration'ları, testleri, CI'ı veya deployment'ı **değiştirmedi**.

F0-003 ([PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168), `MERGED`), F0-004 ([PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170), `MERGED`) ve F0-005 ([PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171), `MERGED`, merge commit `d9fc40883afc8791098865d4d185de3336774c7a`) üçü de `main`'e merge edilmiş durumda — kullanıcının açık talimatıyla F0-002'nin tamamlanmasını beklemeden repository-only paralel yürütülmüşlerdi; bu geçmiş, F0-002'nin kendi sırasını veya kapsamını değiştirmez.

F0-002 `main`'e merge edildikten sonra sıradaki adaylar: **F0-006 — Production Topology and Configuration Verification** (bağımlılığı F0-002; bu turun production baseline kanıtı büyük ölçüde F0-006'nın kapsamını da besler, ancak F0-006 kendi başına ayrı, biçimsel bir görev olarak kalır) ve **F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary** (bağımlılığı F0-002). İkisinin de `READY`'e geçişi ayrı bir kullanıcı kararı gerektirir; F0-002 henüz merge edilmediği için resmî olarak hâlâ bloklu sayılırlar (F0-003/004/005'teki gibi bir repository-only paralel istisna kararı verilmedikçe).

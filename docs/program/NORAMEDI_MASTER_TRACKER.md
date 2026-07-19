# NoraMedi Master Development Tracker

Bu dosya, NoraMedi kurumsal mimari ve modülerleşme programının **yetkili canlı durum kaynağıdır**. Bkz. [README.md](README.md).

Son güncelleme: 2026-07-19 (F0-008 — ADR Review and Enterprise Foundation Decision Set. Bu görev, kendi taban-çizgisi commit'inde ([PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174)'ün merge commit'i `7cf7a827277779091b9e34e726eebccd39f624ae`) F0-007'nin hâlâ `PR_OPEN` olarak kaydedildiğini tespit etti — F0-002…F0-006'da tekrarlanan aynı öz-referans gecikmesi kalıbı. `git log`/`gh pr view 174` bağımsız olarak `state: MERGED`, `mergedAt: 2026-07-19T13:44:32Z` doğruladı — bu commit'in kendisi F0-007'nin merge commit'i. Düzeltildi; bkz. §6 F0-007 satırı, §7. Önceki tur: F0-007 düzeltme turu — [PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174)'ün dış incelemesi iki hata buldu: birincil ağacın dal/HEAD'inin "görev boyunca değişmedi" iddiası ve `--limit 60`'a dayalı yanlış "repository-çapında 61/61 `MERGED`, 0 açık" PR-tarama iddiası. İkisi de zaman-dilimli/düzeltilmiş kayıtlarla değiştirildi; bkz. R-053.)

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
| Last confirmed merged KVKK work | [PR #169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169) — KVKK-HIGH-007 base (centralized communication preference and consent management) — `MERGED` (`2026-07-18T22:05:26Z`, merge commit `7fcf2f850f151241266f07349c4bf4442c72bbca`) — `VERIFIED_GITHUB` (F0-007, `gh pr view 169`). This merge commit equals the confirmed production `HEAD` (F0-002 Stage B) — `VERIFIED_PRODUCTION_OBSERVED`. **F0-007 correction:** [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003), previously recorded here as `OPEN`, is also `MERGED` (`mergedAt: 2026-07-18T16:10:01Z`) — the prior `OPEN` reading was taken before that same-day merge landed. The named KVKK PR subset checked by F0-007 were all `MERGED` with zero open among that set. **Correction-pass note:** F0-007's original "repository-wide, 61/61 `MERGED`, zero open" claim was generated from a 60-row-capped, recency-limited query and was not actually repository-wide; a corrected sweep found 3 currently `OPEN` PRs repo-wide (#48, pre-existing/unrelated; #174, F0-007's own PR; #175, the KVKK-HIGH-007 continuation, opened after F0-007's original verification) — see [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §3.1. |
| Currently active KVKK work | The **continuation** of KVKK-HIGH-007 (consent reconciliation). Time-sliced status (corrected — see [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1): at F0-007's original task start, observed only as uncommitted dirty/untracked path metadata via read-only `git status --short` in the primary working tree (`D:\Mustafa\Siteler\DisKlinikCRM`); by F0-007's own task end, the primary tree was already clean on local branch `feature/kvkk-high007-consent-reconciliation-ux`; as of F0-007's correction pass (external review of PR #174), GitHub shows this exact branch/HEAD has an open PR — [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175). Its migration is named `20260719120821_kvkk_high007_consent_reconciliation` — a same-day follow-on to PR #169's merged base. Classification: `UNVERIFIED_ACTIVE_WORK`. Implementation content, tests, migration validity, rollback safety, and tenant-isolation impact are **not inspected/not verified** by F0-007 at any point, per its mandatory protection rules — a PR being open does not change this. Full detail: [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md), [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md). |
| Local observation (KVKK) | Primary tree at F0-007's task start: 36 dirty paths (23 modified + 13 untracked), spanning Prisma schema/migration, communication-consent services, communication-preference/message routes, SMS, a new WhatsApp purpose-map file, recall, data retention, operational events, reconciliation/backfill/audit/reporting services and tests, frontend consent UI, locale files, `server/package.json`, and one compliance doc (`docs/compliance/56-...md`, path only). All observations **read-only** (`git status`/`git branch`/`git rev-parse`) — F0-007 ran no write/commit/reset/checkout/stash/clean command against this tree and did not open, read, or diff any of the 36 paths. Classification: `OBSERVED_LOCAL_ONLY`. Behavior/completion/deployment status: `UNVERIFIED_ACTIVE_WORK`. |
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
| ID | F0-008 |
| Title | ADR Review and Enterprise Foundation Decision Set |
| Status | `AGENT_COMPLETED` — 17 ADR'nin (ADR-001…017) her biri depo kanıtına karşı incelendi; 2 `ACCEPTED`, 8 `ACCEPTED_WITH_CONDITIONS`, 5 `DEFERRED`, 2 `NEEDS_POC` (bkz. [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md), [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md), [../architecture/enterprise-foundation-decision-set.md](../architecture/enterprise-foundation-decision-set.md)). Hiçbir ADR kabulü herhangi bir uygulama/şema/migration/deployment değişikliği yetkilendirmez; F0-007 mimari dondurma sınırı tam olarak korunmuştur. Görev sırasında bir öz-referans gecikmesi tespit edildi ve düzeltildi: bkz. §6 F0-007 satırı. `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` ajan tarafından **atanamaz**. |
| Branch | `docs/f0-008-adr-foundation-decisions` |
| Worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-008-adr-foundation-review` (izole; birincil çalışma ağacına — `D:\Mustafa\Siteler\DisKlinikCRM`, aktif KVKK-HIGH-007 devam çalışmasını barındırıyor — yalnızca salt-okunur `git status`/`git branch`/`git rev-parse`/`git worktree list` çalıştırıldı, hiçbir dosya okunmadı/değiştirilmedi). Base: `origin/main` @ `7cf7a827277779091b9e34e726eebccd39f624ae` (F0-007'nin kendi merge commit'i, PR #174). |
| Scope | Yalnızca analiz/dokümantasyon: ADR incelemesi, ADR indeksi güncellemesi, Enterprise Foundation Decision Set, master tracker/faz dokümanı güncellemesi (`docs/program/`, `docs/architecture/` — yeni dizin) |
| Out of scope | Tüm uygulama, şema, migration, test, CI, deployment değişiklikleri; `docs/compliance/` değişiklikleri; birincil çalışma ağacına hiçbir yazma erişimi; PR #175'in içeriği incelenmedi/dokunulmadı |
| Dependency | F0-003, F0-004 (ikisi de `MERGED`) |
| Reviewer | ChatGPT / kullanıcı |
| Evidence | [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md) (17 ADR'nin tam inceleme kaydı, karar matrisi, kanıt atıfları), [../architecture/enterprise-foundation-decision-set.md](../architecture/enterprise-foundation-decision-set.md) (A/B/C/D/E özet), [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (güncellenmiş ADR indeksi) |
| Ajan için izinli sonraki durum | `AGENT_COMPLETED` → PR açıldıktan sonra `PR_OPEN`; sıradaki adım dış inceleme/merge kararı; `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` yalnızca dış kanıtla kaydedilebilir |

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
- **Status:** `MERGED` — [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) `main`'e merge edildi, merge commit `db89b60c91666cb029c32757f171f227a643c79c` (`mergedAt: 2026-07-19T12:02:51Z`, `gh pr view 172 --json state,mergedAt,mergeCommit` ile teyit edildi — `VERIFIED_GITHUB`). **Düzeltme notu (F0-006 tarafından):** PR #172'nin kendi merge commit'inin taşıdığı tracker/faz-dokümanı içeriği hâlâ `PR_OPEN` yazıyordu — bu, F0-003/F0-004/F0-005'te de görülen aynı öz-referans gecikmesidir (bir görevin kendi tracker güncellemesi, kendi PR'ı merge edilmeden önce commit edilir, dolayısıyla o merge commit'inin anlık görüntüsü kendi merge-öncesi durumunu tanımlar). Kaynak hiyerarşisi (§2.1, madde 1: git commit/merged PR kanıtı tracker dosyasının kendisinden üstündür) gereği `MERGED` durumu burada düzeltilmiştir. Stage A (depo, toolchain, script, Prisma/migration, deployment, runtime-bağımlılık ve CI envanteri, bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)) ve Stage B (production baseline kanıtı — host, PM2 topolojisi, health, TLS, DB/migration, config presence, storage, backup/PITR/restore-test durumu; kullanıcı tarafından salt-okunur olarak sağlandı, evidence timestamp `2026-07-19T13:43:12+03:00`, bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)) ikisi de tamamlandı.
- **Purpose:** Depo, branch, migration, deployment ve ortam taban çizgisini **kanıtla** envanterlemek; §3'teki `UNVERIFIED` alanları doldurmak.
- **Dependencies:** F0-001 (`MERGED`).
- **Deliverables:** Güncellenmiş §3 baseline tablosu + [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md) + [evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md) + [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) (yeni).
- **Evidence required:** Git referansları ✅, migration listesi ✅, deployment tanımı ✅ (depo kapasitesi olarak); deployment revizyon/production kanıtı ✅ (Stage B tamamlandı).
- **Blocking conditions:** Yok — Stage A ve Stage B ikisi de tamamlandı. **Yalnızca analiz/dokümantasyon; uygulama davranışı değiştirilmedi, production'a hiçbir yazma erişimi kullanılmadı.**
- **Accepted open risks (remediated değil, yalnızca belgelendi):** yerel VPS storage (S3 yok), offsite yedek kanıtı yok, PITR yapılandırılmamış (`archive_mode: off`), restore test `UNVERIFIED`, Node sürüm sapması (CI'da 20, production'da 22.23.1, `engines` pini yok), PM2 restart sayıları (14/13) operasyonel inceleme gerektiriyor, PM2 süreçleri `root` olarak çalışıyor. Ayrıntı: [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) §B.11.
- **Allowed next status:** Yok — `MERGED` nihai durumdur (PR #172, merge commit `db89b60c91666cb029c32757f171f227a643c79c`). `DEPLOYED`/`PRODUCTION_VERIFIED` bu dokümantasyon-yalnız görev için **NOT APPLICABLE** kalır.

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
- **Status:** `MERGED` — [PR #173](https://github.com/MustafaBasol/DisKlinikCRM/pull/173) `main`'e merge edildi, merge commit `91276dc7f610ef6923e3c1a7572f0ebba578a2f7` (`mergedAt: 2026-07-19T12:54:43Z`, `gh pr view 173 --json state,mergedAt,mergeCommit` ile teyit edildi — `VERIFIED_GITHUB`, F0-007). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı; F0-007'nin bu turunda düzeltildi (F0-002/003/004/005'te de görülen aynı öz-referans gecikmesi deseni). Süreç topolojisi (API/worker entrypoint, job kaydı, `RUN_BACKGROUND_JOBS`/`JobLock` etkileşimi, graceful shutdown, health/readiness), deployment topolojisi (deploy script sıralaması, atomiklik, rollback yokluğu, Docker-vs-bare-VPS çelişkisinin kaynak-kod seviyesinde teyidi), Nginx/routing, config modeli (env yükleme mekanizması, gerekli/opsiyonel değişkenler, `.env.example` boşlukları/yinelemeleri), PostgreSQL, Redis, storage, backup/PITR/restore, güvenlik/ayrıcalık ve zorunlu drift/çelişki tablosu tamamlandı. Production kanıtı, görev talimatıyla sağlanan anlık görüntünün F0-002 Stage B ile tam mutabakatı üzerinden kullanıldı (bkz. evidence §1) — hiçbir yeni production komutu bu ajan tarafından çalıştırılmadı.
- **Purpose:** Production topolojisini (sunucu, DB, worker, storage, proxy) kanıtla doğrulamak.
- **Dependencies:** F0-002 (`MERGED`). ✅ Karşılandı.
- **Deliverables:** [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md) (yeni), [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md) (yeni), [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) (yeni), [evidence/F0-006_configuration_inventory.json](evidence/F0-006_configuration_inventory.json) (yeni, JSON doğrulandı).
- **Evidence required:** Kullanıcı tarafından sağlanan/erişilebilen ortam kanıtları. ✅ Karşılandı — F0-002 Stage B ile mutabık, artı kaynak-kod seviyesinde 10+ yeni dosya doğrudan okunarak (`server/src/index.ts`, `worker.ts`, `jobs/startBackgroundJobs.ts`, `utils/jobLock.ts`, `db.ts`, `utils/redis.ts`, `services/fileStorage.ts`, `services/backupService.ts`, `routes/platformAdmin.ts` backup bölümü, `nginx.conf`, `scripts/noramedi-deploy.sh`, `scripts/noramedi-healthcheck.sh`, `server/.env.example`, `docs/35-docker-deploy-runbook.md`) analiz derinleştirildi.
- **Blocking conditions:** Yok — production erişimi gerektiren tüm alanlar ya F0-002 Stage B kanıtıyla ya da görev talimatıyla sağlanan mutabık anlık görüntüyle karşılandı; kalan alanlar (PgBouncer/read-replica varlığı, frontend artifact eşleşmesi, host Nginx içeriği, offsite yedek, restore-test kanıtı, `RUN_BACKGROUND_JOBS`'un gerçek değeri, PM2 `cwd`) açıkça `UNVERIFIED` bırakıldı — bkz. evidence §13.
- **Risks recorded:** R-029…R-040 ([RISK_REGISTER.md](RISK_REGISTER.md)) — 6 HIGH (yerel storage, offsite yedek yokluğu, PITR yokluğu, restore-test kanıtsızlığı, worker deploy-otomasyon boşluğu, mükerrer job-kaydı riski) + 6 MEDIUM (Node sürüm sapması, PM2 root, restart sayıları, frontend artifact belirsizliği, bayat Docker runbook, config-kaynak belirsizliği).
- **Allowed next status:** Yok — `MERGED` nihai durumdur (PR #173, merge commit `91276dc7f610ef6923e3c1a7572f0ebba578a2f7`). `DEPLOYED`/`PRODUCTION_VERIFIED` bu dokümantasyon-yalnız görev için **NOT APPLICABLE** kalır.

### F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary
- **Status:** `MERGED` — [PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174) `main`'e merge edildi, merge commit `7cf7a827277779091b9e34e726eebccd39f624ae` (`mergedAt: 2026-07-19T13:44:32Z`, `gh pr view 174 --json state,mergedAt,mergeCommit` ile F0-008 tarafından teyit edildi — `VERIFIED_GITHUB`; ayrıca bu commit F0-008'in kendi taban çizgisi `git log -1 HEAD` ile birebir eşleşiyor). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı — F0-002…F0-006'da tekrarlanan aynı öz-referans gecikmesi (bir görevin kendi tracker güncellemesi, kendi PR'ı merge edilmeden önce commit edilir); F0-008 tarafından düzeltildi. GitHub üzerinden bilinen KVKK PR alt kümesi yeniden doğrulandı (`gh pr view`). Anahtar bulgu: KVKK-HIGH-007'nin taban özelliği ([PR #169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169), "centralized communication preference and consent management") zaten `MERGED` (`2026-07-18T22:05:26Z`, merge commit `7fcf2f850f151241266f07349c4bf4442c72bbca`) — bu commit F0-002 Stage B'nin doğruladığı production `HEAD` ile birebir aynı, yani bu iş yalnızca merge değil aynı zamanda deploy de edilmiş durumda. Birincil çalışma ağacındaki aktif çalışma (migration adı `20260719120821_kvkk_high007_consent_reconciliation`) bu nedenle **KVKK-HIGH-007'nin devam/sertleştirme aşaması** olarak sınıflandırıldı, yeni bir görev olarak değil. Ayrıca PR #167'nin (KVKK-CRIT-003) tracker'da bayat kalmış `OPEN` kaydı `MERGED` (`2026-07-18T16:10:01Z`) olarak düzeltildi. 20 alanlık bir mimari dondurma sınır matrisi ve F0-003/F0-004 kanıtına dayalı bağımlılık/çakışma analizi üretildi.
  - **Düzeltme turu (2026-07-19, PR #174'ün dış incelemesi):** iki hata düzeltildi. (1) Zaman-dilimleme: bu görevin orijinal metni birincil ağacın dal/HEAD'inin "görev boyunca değişmedi" olduğunu iddia ediyordu — bu yanlıştı; ağaç, bu görevin bilgisi/kontrolü dışında, ayrı bir oturum tarafından bağımsız olarak `main`den `feature/kvkk-high007-consent-reconciliation-ux`'e değişti ve temizlendi. Artık üç ayrı, zaman damgalı gözlem olarak kaydediliyor (görev başlangıcı / görev bitişi / düzeltme turu). (2) PR-tarama metodolojisi: orijinal "repository-çapında, 61/61 `MERGED`, 0 `OPEN`" iddiası `gh pr list --state all --limit 60` komutundan üretilmişti — bu komut 60 satırdan fazla sonuç döndüremez ve tam PR geçmişini taramaz. Düzeltilmiş bir tarama (`--limit 200`) toplam 174 PR (#1–#175) ve 3 açık PR buldu: #48 (önceden var, KVKK'ya ilgisiz, orijinal dar tarama tarafından kaçırıldı), #174 (bu görevin kendi PR'ı), ve #175 (KVKK-HIGH-007 devamının kendisi — bu görevin orijinal doğrulamasından sonra, `2026-07-19T13:19:58Z`'de açıldı, head SHA `267458c8f09bf13126e1822705317629906f9491`, görev-bitişi gözlemiyle birebir eşleşiyor). PR #175'in içeriği incelenmedi — yalnızca GitHub meta verisi (başlık/durum/dal/değişen dosya sayısı) okundu. Tam kayıt: [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1/§3.1, [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md) §7. Risk R-053 eklendi.
- **Purpose:** Aktif KVKK çalışmasının kapsamını, dokunduğu dosyaları ve mimari dondurma sınırını belgelemek.
- **Dependencies:** F0-002 (`MERGED`). ✅ Karşılandı.
- **Deliverables:** [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md) (yeni), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) (yeni), [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) (yeni), [evidence/F0-007_kvkk_work_inventory.json](evidence/F0-007_kvkk_work_inventory.json) (yeni, JSON doğrulandı).
- **Evidence required:** KVKK branch/PR durumu; dokunulan dosya listesi. ✅ Karşılandı — tüm bilinen KVKK PR'ları `gh pr view` ile teyit edildi; birincil ağaçtaki 36 dirty path yalnızca isim/metadata düzeyinde kaydedildi (içerik incelenmedi, görev talimatı gereği).
- **Blocking conditions:** Yok (analiz-yalnız). Bu görev birincil çalışma ağacına hiçbir yazma erişimi kullanmadı.
- **Risks recorded:** R-041…R-053 ([RISK_REGISTER.md](RISK_REGISTER.md)) — 6 HIGH (migration/mimari-refactor çakışması, kanal-arası consent enforcement tutarsızlığı, yetkisiz backfill/reconciliation, retention/consent şema-geçiş çakışması, consent-contract bypass riski, rollback/tenant-etki kanıtsız migration) + 7 MEDIUM (stale compliance-doc drift, PR durum senkronizasyon boşluğu, CI kapsamı boşluğu, dokümantasyon bayatlama riski, undocumented config bayrağı riski, çakışma-çözme kavram örtüşmesi, R-053: sınırlı-kapsamlı PR-tarama sorgusunun repository-çapında bir gerçek gibi sunulması).
- **Allowed next status:** Dış inceleme sonrası `REVIEW_REQUIRED`/`CHANGES_REQUESTED`/PR akışı; `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` yalnızca dış kanıtla kaydedilebilir.

### F0-008 — ADR Review and Enterprise Foundation Decision Set
- **Status:** `AGENT_COMPLETED` — isolated worktree/branch created from `origin/main` @ `7cf7a827277779091b9e34e726eebccd39f624ae` (F0-007's own merge commit, PR #174). All 17 ADRs (ADR-001…017) reviewed against repository evidence (`MODULE_MAP.md`, `DEPENDENCY_MAP.md` §10, `RISK_REGISTER.md`, `RELEASE_GATES.md`, `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`, and `docs/compliance/53-56` for KVKK-adjacent ADRs), classified, and updated in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md): 2 `ACCEPTED` (ADR-001, ADR-014), 8 `ACCEPTED_WITH_CONDITIONS` (ADR-002, 003, 008, 009, 010, 011, 015, 016), 5 `DEFERRED` (ADR-006's outbox-pattern-itself, ADR-007, 012, 013, 017), 2 `NEEDS_POC` (ADR-004, ADR-005). Full quality-field ADR content (context, decision, scope, alternatives, consequences, security/tenant/KVKK impact, backward-compat, migration, rollback, dependencies, validation, trigger, status, date) written for every `ACCEPTED`/`ACCEPTED_WITH_CONDITIONS` ADR. A self-reference lag in F0-007's own status (still `PR_OPEN` in the committed snapshot at this task's baseline, despite that baseline commit being F0-007's own merge commit) was found and corrected — see F0-007 row above, independently confirmed via `gh pr view 174`. No application, schema, migration, runtime, or deployment file was touched; the F0-007 architecture freeze boundary is fully preserved, and PR #175's content was not inspected.
- **Purpose:** ADR-001…017'yi depo kanıtına karşı gözden geçirmek; hangilerinin bağlayıcı, hangilerinin PoC/dış onay gerektiren yön kararları olduğunu belirlemek; kurumsal temel karar setini üretmek.
- **Dependencies:** F0-003, F0-004 (both `MERGED`). ✅ Satisfied.
- **Deliverables:** [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md) (new — full 17-ADR review, decision matrix, per-ADR quality-field content), [../architecture/enterprise-foundation-decision-set.md](../architecture/enterprise-foundation-decision-set.md) (new — A/B/C/D/E compact decision set), [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (updated — all 17 ADR statuses + F0-008 review notes), this tracker (updated — F0-007 self-reference-lag correction, F0-008 entry), [phases/F0_BASELINE_AND_VALIDATION.md](phases/F0_BASELINE_AND_VALIDATION.md) (updated).
- **Evidence required:** Her ADR için depo kanıtı bölümü. ✅ Satisfied — every `ACCEPTED`/`ACCEPTED_WITH_CONDITIONS`/`NEEDS_POC`/`DEFERRED` classification in the decision matrix cites exact repository paths/sections (see [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md) §4).
- **Blocking conditions:** None (analysis-only). ADR acceptance recorded by this task is the agent's own documentary act, not final program policy — external (ChatGPT/user) review remains required per tracker §2.2/§2.3 before any ADR is treated as binding program policy beyond this documentation.
- **Allowed next status:** `AGENT_COMPLETED` → PR açıldıktan sonra `PR_OPEN`; `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` yalnızca dış kanıtla kaydedilebilir; `DEPLOYED`/`PRODUCTION_VERIFIED` bu dokümantasyon-yalnız görev için **NOT APPLICABLE** kalır.

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
| F0-002 | Repository and Deployment Baseline Inventory | `MERGED` | Depo (Stage A) + production (Stage B, kullanıcı tarafından salt-okunur sağlandı) baseline kanıtı. [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) `main`'e merge edildi, merge commit `db89b60c91666cb029c32757f171f227a643c79c`, merged `2026-07-19T12:02:51Z` — `VERIFIED_GITHUB` (`gh pr view 172`). Bu satır, PR'ın kendi merge commit'inin taşıdığı tracker anlık görüntüsündeki öz-referans gecikmesi (`PR_OPEN` yazıyordu) F0-006 tarafından düzeltilerek eklendi — bkz. §6 F0-002. |
| F0-003 | Domain and Module Ownership Map | `MERGED` | Depo-doğrulanmış domain/modül haritası; F0-002'nin genel görev durumu tamamlanmadan, kullanıcının açık talimatıyla paralel yürütüldü (bkz. §6 F0-003 "Parallel execution note"). [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) `main`'e merge edildi, commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (2026-07-18). |
| F0-004 | Cross-Module Dependency Map | `MERGED` | Depo-kanıtıyla dolu 37-domain/833-edge bağımlılık matrisi; F0-002 Stage B hâlâ toplanmadan kullanıcının açık talimatıyla repository-only paralel yürütüldü (bkz. §6 F0-004 "Parallel execution note"). [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) `main`'e merge edildi, merge commit `5ee0b6af30fff187b7190d649f1fc3e844362105`. Deployed/Production Verified: NOT APPLICABLE. |
| F0-005 | Test Inventory, Runtime Measurement, and Ownership Map | `MERGED` | 100 test/doğrulama hedefinin depo-kanıtıyla envanteri (rebaseline öncesi 97 — 2026-07-19'da `origin/main`'den PR #169'u içeren bir merge sonrası 3 yeni dosya eklendi) + sahiplik + F0-004'ün 9 yüksek-riskli edge'inin test kapsamı; 2532+ assertion gerçekten çalıştırıldı, 1 deterministic source-drift başarısızlığı (`overdueInstallments.test.ts`, CI-uygulama boşluğunun somut kanıtı) + 1 environment-sensitive line-ending başarısızlığı (`clinicBulkExport.test.ts`) bulunup düzeltilmeden belgelendi — bu görev tarafından 0 doğrulanmış product-runtime kusuru tespit edilmiştir. F0-002 Stage B kanıtı henüz toplanmadan kullanıcının açık talimatıyla repository-only paralel yürütüldü (bkz. §6 F0-005 "Parallel execution note"). [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) `main`'e merge edildi, merge commit `d9fc40883afc8791098865d4d185de3336774c7a` (2026-07-19, `docs(test): add F0-005 test inventory and runtime baseline (#171)`). Deployed/Production Verified: NOT APPLICABLE. |
| F0-006 | Production Topology and Configuration Verification | `MERGED` | Süreç/deployment/config/PostgreSQL/Redis/storage/backup/güvenlik topolojisi kaynak-kod seviyesinde izlendi, F0-002 Stage B ile mutabakat sağlandı, zorunlu drift tablosu oluşturuldu, 12 yeni risk (R-029…R-040) kaydedildi. [PR #173](https://github.com/MustafaBasol/DisKlinikCRM/pull/173) `main`'e merge edildi, merge commit `91276dc7f610ef6923e3c1a7572f0ebba578a2f7`, merged `2026-07-19T12:54:43Z` — `VERIFIED_GITHUB` (`gh pr view 173`, F0-007). Deployed/Production Verified: NOT APPLICABLE. |
| F0-007 | Active KVKK Work Baseline and Architecture Freeze Boundary | `MERGED` | 20 alanlık mimari dondurma sınır matrisi + KVKK PR alt kümesinin GitHub doğrulaması + 13 risk (R-041…R-053). [PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174) `main`'e merge edildi, merge commit `7cf7a827277779091b9e34e726eebccd39f624ae`, merged `2026-07-19T13:44:32Z` — `VERIFIED_GITHUB` (`gh pr view 174`, F0-008). Bu satır önceki turda `PR_OPEN` olarak bırakılmıştı (öz-referans gecikmesi); F0-008 tarafından düzeltildi. Deployed/Production Verified: NOT APPLICABLE. |

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

**F0-008 notu (2026-07-19):** Yukarıdaki maddelerin çoğu artık F0-008 tarafından resmi ADR durumuna bağlandı — bkz. [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ve [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md). Özellikle: madde 1-8 → ADR-001 (`ACCEPTED`); madde 11 → ADR-003 (`ACCEPTED_WITH_CONDITIONS`); madde 12 → ADR-002 (`ACCEPTED_WITH_CONDITIONS`); madde 13 → ADR-008 (`ACCEPTED_WITH_CONDITIONS`); madde 14 → ADR-009 (`ACCEPTED_WITH_CONDITIONS`); madde 15 → ADR-010 (`ACCEPTED_WITH_CONDITIONS`); madde 16 → ADR-011 (`ACCEPTED_WITH_CONDITIONS`). Bu tablo PROGRAM DIRECTION kaydı olarak korunur (tarihsel bağlam); artık bağlayıcı olan biçim ADR indeksidir.

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

1. KVKK taban çizgisi henüz dışarıdan kararlı olarak teyit edilmedi — ancak F0-007'nin GitHub doğrulaması bu blokajın kapsamını önemli ölçüde daralttı. KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi (2026-07-17); KVKK-CRIT-003 [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) de merge edildi (2026-07-18T16:10:01Z — tracker'ın önceki `OPEN` kaydı F0-007 tarafından düzeltildi); KVKK-HIGH-007'nin taban özelliği [PR #169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169) de merge edildi **ve** production'a deploy edildi (merge commit = confirmed production HEAD). F0-007'nin kontrol ettiği KVKK PR alt kümesinde açık PR kalmadı (**düzeltme:** orijinal "repository-çapında sıfır açık PR" iddiası yanlış metodolojiden kaynaklanıyordu — bkz. §6 F0-007 düzeltme notu — düzeltilmiş tam tarama 3 açık PR buldu: #48 ilgisiz/önceden var, #174 bu görevin kendi PR'ı, #175 aşağıdaki devam çalışmasının kendisi). Tek kalan KVKK-ilişkili blokaj kaynağı: birincil çalışma ağacında (`D:\Mustafa\Siteler\DisKlinikCRM`) KVKK-HIGH-007'nin **devamı** (consent reconciliation) — görev başlangıcında commit edilmemiş olarak gözlemlendi, görev bitişinde temiz bir yerel dala geçmişti, düzeltme turunda ise GitHub'da [PR #175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175) olarak açık bulundu (içeriği hâlâ incelenmedi). F0-007 tarafından yalnızca `git status --short`/`git branch`/`git rev-parse` ile, salt-okunur gözlemlendi; dosya içerikleri hiçbir zaman incelenmedi/dokunulmadı. Tam detay ve dondurma sınırı matrisi: [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md), [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md).
2. Depo taban çizgisi (baseline) **kanıtla toplandı ve `main`'e merge edildi** (F0-002 `MERGED`, [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172), merge commit `db89b60c91666cb029c32757f171f227a643c79c`, bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md) + [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)). Bu artık bir blokaj değildir.
3. Production topolojisi F0-002 Stage B ve F0-006 kapsamında **hem gözlemsel hem de kaynak-kod seviyesinde doğrulandı** (bare-VPS + PM2 + host Nginx; Docker Compose runbook'u stale/aspirasyonel olarak doğrulandı; worker deploy-otomasyon boşluğu ve mükerrer job-kaydı riski kaynak kodundan teyit edildi — bkz. [evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md)). Kalan açık riskler artık [RISK_REGISTER.md](RISK_REGISTER.md)'de R-029…R-040 olarak biçimsel kayıt altına alındı (6 HIGH: yerel storage, offsite yedek yokluğu, PITR yokluğu, restore-test kanıtsızlığı, worker deploy-otomasyon boşluğu, mükerrer job-kaydı riski; 6 MEDIUM: Node sürüm sapması, PM2 root, restart sayıları, frontend artifact belirsizliği, bayat Docker runbook, config-kaynak belirsizliği). Bu riskler **düzeltilmedi**, yalnızca belgelendi.
4. RLS / Prisma / PgBouncer uyumluluğu henüz kanıtlanmadı (F0-009 → F5).
5. Object-storage sağlayıcısı ve migrasyon tasarımı henüz onaylanmadı (F0-011 → F4). Mevcut durum artık kanıtla biliniyor: `LOCAL_VPS_STORAGE` (bkz. evidence §B.9), tasarım kararı hâlâ bekliyor.
6. Queue/outbox mimarisi henüz kanıtlanmadı (F0-010 → F6).

## 13. Exact next task (Kesin sonraki görev)

**External review and merge decision for the F0-008 PR** (to be opened against `main` as part of this task's own delivery — see §5, §6 F0-008). F0-008's 17-ADR review, decision matrix, and Enterprise Foundation Decision Set are `AGENT_COMPLETED` and require external (ChatGPT/user) review before any `ACCEPTED`/`ACCEPTED_WITH_CONDITIONS` ADR status is treated as final program policy, per tracker §2.2/§2.3.

F0-002 ([PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172)), F0-003 ([PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168)), F0-004 ([PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170)), F0-005 ([PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171)), F0-006 ([PR #173](https://github.com/MustafaBasol/DisKlinikCRM/pull/173)), and F0-007 ([PR #174](https://github.com/MustafaBasol/DisKlinikCRM/pull/174), corrected from a stale `PR_OPEN` self-reference reading this task found — see §6 F0-007) are all `MERGED` into `main`.

**The primary remaining program blocker is unchanged by F0-008:** the KVKK-HIGH-007 continuation ([PR #175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175)) remains `OPEN`, unmerged, content uninspected by this task (consistent with [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md), which this task's ADR acceptances were explicitly checked against and found not to conflict with — see [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md) §6). F0-009/F0-010 implementation (as opposed to design) and F1 phase entry remain blocked until that continuation reaches a stable, externally-confirmed baseline per freeze boundary §5.

**Exact next task after F0-008's external review:** either **F0-009 — RLS, Prisma, and PgBouncer Proof-of-Concept Design** or **F0-010 — Queue and Transactional Outbox Proof-of-Concept Design** (both dependency-ready: F0-004 + F0-008, both now satisfiable; both design-only, per [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §6). **F0-011 — Object Storage and Backup Migration Design** and **F0-012 — Controlled Pilot and General Launch Gate Definition** are also dependency-ready (F0-002/F0-006/F0-007 all `MERGED`) but each requires a separate user decision to start, per prior tasks' instructions. F0-013 (consolidated validation report) remains blocked until F0-009…F0-012 complete.

# F0 — Baseline, Program Control, and Architecture Validation

Faz durumu: `IN_PROGRESS` · Son güncelleme: 2026-07-19 (F0-002 Stage A+B tamamlandı — production baseline kanıtı belgelendi; F0-004/F0-005 `MERGED` durum düzeltmeleri main'den taşındı)

## Objective (Hedef)

Kurumsal mimari programının temelini kurmak: depo-tabanlı yetkili takip sistemi, kanıta dayalı baseline envanteri, modül/bağımlılık/test haritaları, kritik mimari kararların PoC **tasarımları** ve G0 kapısına sunulacak konsolide doğrulama raporu.

## Business reason (İş gerekçesi)

Binlerce kliniğe ölçeklenecek, KVKK'ya tabi bir sağlık platformunda mimari yatırımların yanlış sıralanması (ör. kanıtsız RLS rollout'u, erken microservice) hem regülasyon hem ticari risk üretir. F0; sonraki tüm fazların **kanıta dayalı** ve güvenli sıralanmasını sağlar.

## Entry conditions (Giriş koşulları)

- Program başlangıç kararı (verildi).
- Başka ön koşul yok.

## Exit gate (Çıkış kapısı)

- F0-001…F0-013 tamamlanmış,
- **G0 — F0 Architecture Validation Complete** kapısı dış onaylı ([../RELEASE_GATES.md](../RELEASE_GATES.md)).

## Dependencies (Bağımlılıklar)

- Yok (program başlangıç fazı). Ancak **fiziksel mimari değişiklikleri** aktif KVKK çalışmasının dışarıdan teyit edilmiş taban çizgisine bağımlıdır (aşağıda "Prohibited work").

## Allowed work (İzinli işler)

- Dokümantasyon ve program takibi
- Depo envanteri, modül haritalama, bağımlılık analizi
- Test envanteri ve ölçümü (hedefli; pahalı suite'ler için onay)
- ADR taslak çalışması
- PoC **tasarımı** (uygulama değil)
- İnvaziv olmayan analiz

## Prohibited work (Yasak işler — KVKK taban çizgisi teyidine kadar)

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

## Initial task backlog (Görev listesi)

Ayrıntılı alanlar (purpose, dependencies, deliverables, evidence, blocking, allowed next status) için yetkili kaynak: [../NORAMEDI_MASTER_TRACKER.md §6](../NORAMEDI_MASTER_TRACKER.md).

| ID | Başlık | Durum |
|---|---|---|
| F0-001 | Program Control and Master Tracker Foundation | `MERGED` ([PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166), merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, 2026-07-18) |
| F0-002 | Repository and Deployment Baseline Inventory | `AGENT_COMPLETED` — Stage A (repository evidence) and Stage B (production baseline evidence, supplied 2026-07-19T13:43:12+03:00) both complete; see [evidence/F0-002_REPOSITORY_BASELINE.md](../evidence/F0-002_REPOSITORY_BASELINE.md) and [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](../evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md). PR pending as of this delivery. |
| F0-003 | Domain and Module Ownership Map | `MERGED` — [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) merged into `main` at commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (2026-07-18, confirmed via `gh pr view 168`); deliverables: [MODULE_MAP.md](../MODULE_MAP.md), [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md](../evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md), [evidence/F0-003_module_ownership_inventory.json](../evidence/F0-003_module_ownership_inventory.json) |
| F0-004 | Cross-Module Dependency Map | `MERGED` — [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) merged into `main` at commit `5ee0b6af30fff187b7190d649f1fc3e844362105` (2026-07-18, confirmed via `gh pr view 170`); proceeded in parallel with F0-002 (Stage B not yet collected at the time) per explicit repository-only parallel authorization (see tracker §6); deliverables: [DEPENDENCY_MAP.md](../DEPENDENCY_MAP.md) (matrix filled), [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](../evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md), [evidence/F0-004_dependency_inventory.json](../evidence/F0-004_dependency_inventory.json). Deployed/Production Verified: NOT APPLICABLE. |
| F0-005 | Test Inventory, Runtime Measurement, and Ownership Map | `MERGED` — [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) merged into `main` at commit `d9fc40883afc8791098865d4d185de3336774c7a` (2026-07-19, `docs(test): add F0-005 test inventory and runtime baseline (#171)`); repository-only test inventory (**100** test/verification targets, rebaselined 2026-07-19 from 97 after a merge from `origin/main` brought in PR #169's 3 new test files), runtime baseline (2532+ assertions executed; 1 deterministic source-drift failure, 1 environment-sensitive line-ending failure, 0 confirmed product-runtime defects — found and documented, not fixed), and F0-004 high-risk edge coverage mapping completed; deliverables: [TEST_OWNERSHIP.md](../TEST_OWNERSHIP.md), [evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md](../evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md), [evidence/F0-005_test_inventory.json](../evidence/F0-005_test_inventory.json), [evidence/F0-005_test_runtime_results.json](../evidence/F0-005_test_runtime_results.json). Deployed/Production Verified: NOT APPLICABLE. |
| F0-006 | Production Topology and Configuration Verification | `TODO` |
| F0-007 | Active KVKK Work Baseline and Architecture Freeze Boundary | `TODO` |
| F0-008 | ADR Review and Enterprise Foundation Decision Set | `TODO` |
| F0-009 | RLS, Prisma, and PgBouncer Proof-of-Concept Design | `TODO` |
| F0-010 | Queue and Transactional Outbox Proof-of-Concept Design | `TODO` |
| F0-011 | Object Storage and Backup Migration Design | `TODO` |
| F0-012 | Controlled Pilot and General Launch Gate Definition | `TODO` |
| F0-013 | F0 Consolidated Architecture Validation Report | `TODO` |

## Required evidence (Gerekli kanıt)

- Her görevin AGENT_DELIVERY_TEMPLATE formatında teslim raporu
- Baseline tablosunun (tracker §3) `UNVERIFIED` alanlarının kanıtla doldurulması
- Harita/matris girdilerinin dosya:satır referansları
- PoC tasarımlarının ölçüm kriterleri

## Required tests (Gerekli testler)

- F0 görevleri dokümantasyon/analiz olduğu için uygulama testi zorunlu değildir.
- F0-005, mevcut testlerin **ölçümünü** içerir (hedefli çalıştırma); geniş suite'ler kullanıcı onayı ister.

## Security requirements (Güvenlik gereksinimleri)

- Analiz çıktılarında gizli bilgi (secret, kimlik bilgisi) yer alamaz.
- Production erişimi gerektiren doğrulamalar (F0-006) kullanıcı iş birliğiyle ve salt-okunur yapılır.

## Tenant requirements (Tenant gereksinimleri)

- F0'da tenant davranışı değişmez. İzolasyon analizi salt-okunurdur.

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Aktif KVKK çalışmasına dokunulmaz; dondurma sınırı (yukarıdaki liste) ihlal edilemez.
- Analiz sırasında gerçek hasta verisi kopyalanamaz/dokümante edilemez.

## Rollback expectations (Geri alma beklentileri)

- Tüm F0 çıktıları dokümantasyondur; geri alma Git revert ile mümkündür. Uygulama davranışı değişmediği için operasyonel rollback gerekmez.

## Risks (Riskler)

- R-002 (KVKK regresyonu — dondurma sınırıyla kontrol altında)
- R-027 (uzun ömürlü branch sapması)
- R-028 (ajanın yanlış "tamamlandı" beyanı — durum modeliyle azaltıldı)
- Ayrıntı: [../RISK_REGISTER.md](../RISK_REGISTER.md)

## Open questions (Açık sorular)

- KVKK taban çizgisinin dış teyidi ne zaman gelecek? KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi; devam eden KVKK/güvenlik çalışması artık [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003) olarak kanıtlandı — `OPEN`, merge/deploy/production doğrulaması yok (`VERIFIED_GITHUB`); dış kabul/merge kararı bekleniyor (F0-007 girdisi)
- Production ortam kanıtlarına erişim yöntemi netleşti: kullanıcı [evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](../evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md) içindeki salt-okunur komut setini VPS'te çalıştırıp çıktıyı paylaşacak (F0-002 Stage B); henüz sağlanmadı
- Production, depoda çelişen iki farklı topoloji tanımından (Docker Compose runbook'u vs. bare-VPS + PM2 script'i) hangisini gerçekten çalıştırıyor? Stage B'de netleşecek (bkz. evidence §6.10)
- F8'in (AI Gateway) F2 sonrası paralelleştirilme kararı (F0-013'te netleşecek)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu; backlog F0-001…F0-013 tanımlandı. |
| 2026-07-17 | F0-001 | Dış inceleme başladı: F0-001 → `REVIEW_REQUIRED`. |
| 2026-07-17 | F0-001 | [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) açıldı: F0-001 → `PR_OPEN`. |
| 2026-07-17 | F0-001 | Dış inceleme düzeltmesi: bayat KVKK ifadeleri giderildi (PR #165 `MERGED`, aktif KVKK çalışması `UNVERIFIED`); F0-001 → `CHANGES_REQUESTED`. |
| 2026-07-17 | F0-001 | Düzeltmeler commit `ef11d2d` ile PR #166'ya push edildi; PR açık: F0-001 → `PR_OPEN`. |
| 2026-07-18 | F0-001 | PR #166 merge edildi (merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, `gh pr view` ile doğrulandı): F0-001 → `MERGED`. |
| 2026-07-18 | F0-002 | Stage A tamamlandı: izole worktree/branch, depo/toolchain/script/Prisma/deployment/runtime-bağımlılık/CI envanteri, baseline kanıt matrisi, çelişki listesi ve production evidence request. F0-002 → `IN_PROGRESS` (Stage A `AGENT_COMPLETED`, Stage B kullanıcı girdisi bekliyor). |
| 2026-07-18 | F0-002 | Dış inceleme düzeltmesi #1: tracker tutarsızlığı (bayat KVKK-temiz iddiası) ve production evidence komut güvenliği (8 madde) düzeltildi, push edildi. |
| 2026-07-18 | F0-002 | Dış inceleme düzeltmesi #2 (final): [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003) `OPEN` olarak kanıtlandı ve tracker'a işlendi; production evidence request'te kalan 5 güvenlik maddesi (remote URL çıktısının tamamen kaldırılması, dosya yolu çıktısının kaldırılması, veritabanı boyutu sorgusunda `current_database()` kullanımı, yedek dosya adı deseninin daraltılması, restore-test kanıt sınırlamasının açıkça belgelenmesi) düzeltildi. |
| 2026-07-18 | F0-003 | Depo-doğrulanmış domain/modül haritası tamamlandı; F0-003 → `AGENT_COMPLETED`. F0-002 Stage B hâlâ bloklu (dış VPS kanıtı bekleniyor) — bu görev F0-002'yi tamamlamadı, Stage B'ye dokunmadı. Ayrıntı: [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md). |
| 2026-07-18 | F0-003 | [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) merge edildi (main @ `131c7cc398fde6c72fea275a40b7efcc1253b828`); F0-003 → `MERGED`. |
| 2026-07-18 | F0-004 | Depo-kanıtıyla dolu 37-domain bağımlılık matrisi + 833-edge yapısal envanter tamamlandı; F0-004 → `AGENT_COMPLETED`. F0-002 Stage B hâlâ bloklu, dokunulmadı — bu görev yalnızca depo-analiz/dokümantasyon kapsamındaydı, hiçbir kaynak/runtime/şema/migration/test dosyası değiştirilmedi. Ayrıntı: [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md). |
| 2026-07-18 | F0-004 | [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) açıldı: F0-004 → `PR_OPEN`. |
| 2026-07-18 | F0-005 | Depo-kanıtıyla 97-hedefli test envanteri + gerçek komut çalıştırmasıyla runtime baseline (2532 assertion, 2 gerçek başarısızlık bulundu/belgelendi, düzeltilmedi) + F0-004'ün 9 yüksek-riskli edge'inin test kapsamı haritalandı; F0-005 → `AGENT_COMPLETED`. F0-002 Stage B hâlâ bloklu, dokunulmadı — bu görev yalnızca depo-analiz/dokümantasyon/hedefli test çalıştırma kapsamındaydı; hiçbir test/kaynak/şema/migration/CI/package script dosyası değiştirilmedi. Ayrıntı: [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md). |
| 2026-07-18 | F0-005 | [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) açıldı: F0-005 → `PR_OPEN`. |
| 2026-07-19 | F0-004 | External review of PR #171 found this phase doc and the tracker still showed F0-004 as `PR_OPEN`; corrected to `MERGED` (PR #170 merged into `main` at `5ee0b6af30fff187b7190d649f1fc3e844362105`, confirmed via `gh pr view 170`). No change to F0-004's own deliverables. |
| 2026-07-19 | F0-005 | External review of PR #171 required corrections before merge: (1) F0-004 status fix (above); (2) F0-005's own branch was merged with `origin/main` (normal, non-force `git merge`, 0 conflicts) to pick up PR #169, which had added 3 test files not in the original 97-target inventory; those 3 files were classified, and every runtime command whose inputs could have changed was re-executed — new total 100 targets; (3) the "no test framework exists anywhere in the repo" claim was narrowed to "no JS/TS test framework or centralized JS/TS runner exists" (Windows Bridge's 4 .NET projects do use a real framework, xUnit, blocked only by a pinned SDK version); (4) failure terminology refined — `overdueInstallments.test.ts` is now labeled a deterministic source-drift failure, `clinicBulkExport.test.ts` an environment-sensitive line-ending failure, with 0 confirmed product-runtime defects established by this documentation task. See evidence doc §1a/§9 and tracker §6 F0-005 for full detail. |
| 2026-07-19 | F0-005 | [PR #171](https://github.com/MustafaBasol/DisKlinikCRM/pull/171) merged into `main` at `d9fc40883afc8791098865d4d185de3336774c7a` (`docs(test): add F0-005 test inventory and runtime baseline (#171)`); F0-005 → `MERGED`. |
| 2026-07-19 | F0-002 | Merged `origin/main` (F0-003/F0-004/F0-005 now `MERGED`, PR #167/#169 KVKK work) into `docs/f0-002-repository-deployment-baseline`, normal non-force merge, 2 documentation-only conflicts resolved (this file and the tracker). Stage B production/VPS evidence supplied by the user (read-only commands, evidence timestamp `2026-07-19T13:43:12+03:00`) and documented in [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](../evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md); repository baseline (§6.9 of [evidence/F0-002_REPOSITORY_BASELINE.md](../evidence/F0-002_REPOSITORY_BASELINE.md)) reconciled against it. F0-002 → `AGENT_COMPLETED` (both stages complete; `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` not assignable by the agent). |

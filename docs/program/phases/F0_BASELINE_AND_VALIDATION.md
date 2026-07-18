# F0 — Baseline, Program Control, and Architecture Validation

Faz durumu: `IN_PROGRESS` · Son güncelleme: 2026-07-17 (F0-001)

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
| F0-001 | Program Control and Master Tracker Foundation | `PR_OPEN` ([PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166); düzeltmeler push edildi) |
| F0-002 | Repository and Deployment Baseline Inventory | `READY` on `main` — Stage A work observed `AGENT_COMPLETED` on unmerged branch `docs/f0-002-repository-deployment-baseline` (no PR yet); Stage B blocked on user-supplied production evidence. See tracker §3/§12. |
| F0-003 | Domain and Module Ownership Map | `MERGED` — [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) merged into `main` at commit `131c7cc398fde6c72fea275a40b7efcc1253b828` (2026-07-18, confirmed via `gh pr view 168`); deliverables: [MODULE_MAP.md](../MODULE_MAP.md), [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md](../evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md), [evidence/F0-003_module_ownership_inventory.json](../evidence/F0-003_module_ownership_inventory.json) |
| F0-004 | Cross-Module Dependency Map | `PR_OPEN` — [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170); proceeded in parallel with F0-002 Stage B (still `BLOCKED`) per explicit repository-only parallel authorization (see tracker §6); deliverables: [DEPENDENCY_MAP.md](../DEPENDENCY_MAP.md) (matrix filled), [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](../evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md), [evidence/F0-004_dependency_inventory.json](../evidence/F0-004_dependency_inventory.json) |
| F0-005 | Test Inventory, Runtime Measurement, and Ownership Map | `TODO` |
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

- KVKK taban çizgisinin dış teyidi ne zaman gelecek? KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi; devam eden KVKK/güvenlik çalışmasının durumu `UNVERIFIED` (F0-007 girdisi)
- Production ortam kanıtlarına erişim yöntemi (F0-002/F0-006 için kullanıcıdan beklenen bilgiler)
- F8'in (AI Gateway) F2 sonrası paralelleştirilme kararı (F0-013'te netleşecek)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu; backlog F0-001…F0-013 tanımlandı. |
| 2026-07-17 | F0-001 | Dış inceleme başladı: F0-001 → `REVIEW_REQUIRED`. |
| 2026-07-17 | F0-001 | [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) açıldı: F0-001 → `PR_OPEN`. |
| 2026-07-17 | F0-001 | Dış inceleme düzeltmesi: bayat KVKK ifadeleri giderildi (PR #165 `MERGED`, aktif KVKK çalışması `UNVERIFIED`); F0-001 → `CHANGES_REQUESTED`. |
| 2026-07-17 | F0-001 | Düzeltmeler commit `ef11d2d` ile PR #166'ya push edildi; PR açık: F0-001 → `PR_OPEN`. |
| 2026-07-18 | F0-003 | Depo-doğrulanmış domain/modül haritası tamamlandı; F0-003 → `AGENT_COMPLETED`. F0-002 Stage B hâlâ bloklu (dış VPS kanıtı bekleniyor) — bu görev F0-002'yi tamamlamadı, Stage B'ye dokunmadı. Ayrıntı: [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md). |
| 2026-07-18 | F0-003 | [PR #168](https://github.com/MustafaBasol/DisKlinikCRM/pull/168) merge edildi (main @ `131c7cc398fde6c72fea275a40b7efcc1253b828`); F0-003 → `MERGED`. |
| 2026-07-18 | F0-004 | Depo-kanıtıyla dolu 37-domain bağımlılık matrisi + 833-edge yapısal envanter tamamlandı; F0-004 → `AGENT_COMPLETED`. F0-002 Stage B hâlâ bloklu, dokunulmadı — bu görev yalnızca depo-analiz/dokümantasyon kapsamındaydı, hiçbir kaynak/runtime/şema/migration/test dosyası değiştirilmedi. Ayrıntı: [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md). |
| 2026-07-18 | F0-004 | [PR #170](https://github.com/MustafaBasol/DisKlinikCRM/pull/170) açıldı: F0-004 → `PR_OPEN`. |

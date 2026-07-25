# RELEASE_GATES — Yayın Kapıları (G0–G6)

Son güncelleme: 2026-07-25 (**F0-014 — G0 Approval Recording, F0 Closure, and F1 Initial Task Assignment.** G0 ("F0 Architecture Validation Complete") is recorded below as `APPROVED_WITH_CONDITIONS` — an externally-supplied decision (ChatGPT architecture review + Mustafa Basol decision, 2026-07-25), not an agent self-grant; per `NORAMEDI_MASTER_TRACKER.md` §2.3 an agent may never assign this status itself, only transcribe an already-made external decision with its supporting evidence. This is architectural/program readiness for F1 entry only — it is explicitly **not** production readiness, not G1/G2 pilot or launch approval, and not KVKK legal sign-off. Ten mandatory conditions are preserved verbatim below and must not be silently narrowed by any future task. G1–G6 are unaffected by this update and remain `NOT_APPROVED`. See [evidence/F0-014_G0_APPROVAL_F0_CLOSURE_F1_TRANSITION.md](evidence/F0-014_G0_APPROVAL_F0_CLOSURE_F1_TRANSITION.md) for full supporting detail.)

Prior update: 2026-07-20 (F0-012 — G1/G2 kanıt listesi [LAUNCH_GATES.md](LAUNCH_GATES.md)'e ayrıntılandırıldı; bu dosyadaki G1/G2 durumu `NOT_APPROVED` kalır, hiçbir kapı bu görevle geçilmedi.)

Prior update: 2026-07-17 (F0-001)

## Temel ilkeler

- **Kontrollü pilot hazırlığı (G1), genel ticari lansman hazırlığı (G2) ile aynı şey DEĞİLDİR.**
- **Kod tamamlanması, yayın hazırlığı değildir.**
- **Deployment, production doğrulaması değildir.**
- **Klinik AI hazırlığı, ayrı yasal ve klinik validasyon gerektirir.**

Tüm kapılar başlangıçta `NOT_APPROVED` durumundadır. Hiçbir kapı geçilmiş **sayılmaz**. Kapı onayı yalnızca dış onay sahibi tarafından, listelenen kanıtlar sunulduktan sonra verilebilir; ajan bir kapıyı onaylayamaz.

---

## G0 — F0 Architecture Validation Complete

- **Status:** `APPROVED_WITH_CONDITIONS` (2026-07-25, F0-014)
- **Amaç:** F0 fazının çıktılarıyla (baseline, haritalar, PoC tasarımları, riskler) mimari programın uygulanabilirliğinin doğrulanması.
- **Gerekli teknik kanıt:** F0-002 baseline envanteri; F0-003/004 doğrulanmış haritalar; F0-009/010/011 PoC tasarımları; F0-013 konsolide rapor.
- **Gerekli güvenlik kanıtı:** F0-007 KVKK dondurma sınırı; risk kaydının güncellenmiş durumu.
- **Gerekli uyum (compliance) kanıtı:** Aktif KVKK çalışmasının durum raporu.
- **Gerekli test kanıtı:** F0-005 test envanteri ve ölçümleri.
- **Gerekli operasyonel kanıt:** F0-006 production topoloji raporu.
- **Onay sahibi:** ChatGPT incelemesi + kullanıcı kararı.
- **Rollback hazırlığı:** Uygulanamaz (dokümantasyon fazı); yine de F0 çıktılarının Git geçmişi korunur.

### G0 approval record (2026-07-25, F0-014)

| Field | Value |
|---|---|
| Gate | G0 — F0 Architecture Validation Complete |
| Status | `APPROVED_WITH_CONDITIONS` |
| Decision date | 2026-07-25 |
| Approval authority | ChatGPT architecture review + Mustafa Basol decision (external, per this gate's own "Onay sahibi" row above — not agent-granted) |
| Supporting evidence | [F0-013_CONSOLIDATED_ARCHITECTURE_VALIDATION_REPORT.md](F0-013_CONSOLIDATED_ARCHITECTURE_VALIDATION_REPORT.md) (executive decision `CONDITIONALLY READY`); [PR #228](https://github.com/MustafaBasol/DisKlinikCRM/pull/228), merge commit `35224a3d073d46b90aa195568d27f00c3b6881e8`; the full F0-002…F0-012 merged-evidence chain reconciled in that report's §4; [evidence/F0-014_G0_APPROVAL_F0_CLOSURE_F1_TRANSITION.md](evidence/F0-014_G0_APPROVAL_F0_CLOSURE_F1_TRANSITION.md) |
| Exact meaning | This approval is **architectural/program readiness for F1 entry only**. It is explicitly **not**: production readiness, G1 (Controlled Pilot) approval, G2 (General Commercial Launch) approval, or KVKK legal/compliance sign-off. G1 and G2 each require their own, independently-evaluated evidence per [LAUNCH_GATES.md](LAUNCH_GATES.md) and remain `NOT_APPROVED`/`NOT_EVALUATED` below, unaffected by this decision. |

**Mandatory conditions preserved by this approval (none may be silently narrowed, closed, or reinterpreted by a later task without an explicit new external decision):**

1. **R-046 remains `OPEN`.** Full production cross-tenant negative verification and full production audit verification for KVKK-HIGH-007/HIGH-008 remain outstanding (disposable-environment level only, via F0-011-P2). See [RISK_REGISTER.md](RISK_REGISTER.md).
2. **R-071 remains `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`** — not `CLOSED`. It must not be marked `CLOSED` without independent confirmation or an explicit external risk-owner decision.
3. **No general "KVKK baseline stable" declaration has been granted.** [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 condition 5 remains unmet.
4. **The KVKK physical-architecture freeze remains active** until condition 5 above receives its own explicit human/program decision, separate from this G0 decision.
5. **G1 — Controlled Pilot Ready remains `NOT_APPROVED`.**
6. **G2 — General Commercial Launch Ready remains `NOT_APPROVED`.**
7. **`NEEDS_POC` ADRs are not implementation-ready:** ADR-004 (Prisma + PgBouncer), ADR-005 (PostgreSQL RLS), ADR-006 (Transactional outbox), ADR-007 (Queue platform), ADR-013 (Backup/PITR/DR). See [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).
8. **This G0 decision does not authorize:** RLS rollout; tenant-key backfills or broad tenant schema changes; queue/outbox implementation; object-storage migration; production backfill; consent/reconciliation activation; Kafka; Kubernetes; microservices; database-per-tenant; or a framework rewrite.
9. **Modular-monolith boundaries remain mandatory** (ADR-001).
10. **Direct cross-domain access must not be introduced except through an accepted public contract** (ADR-015). The 9 existing documented `WHA`/`IGM`→`PAT`/`APT` boundary violations remain transitional debt, not precedent for further violations.

## G1 — Controlled Pilot Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Sınırlı sayıda gerçek klinikle kontrollü pilotun güvenle yürütülebilmesi.
- **Gerekli teknik kanıt:** Kararlı deploy hattı; temel HA/yedekleme; hata bütçesi tanımı.
- **Gerekli güvenlik kanıtı:** Tenant izolasyon regresyonu geçer; kritik güvenlik bulguları kapalı.
- **Gerekli uyum kanıtı:** KVKK baseline dışarıdan teyitli; aydınlatma/consent akışları çalışır.
- **Gerekli test kanıtı:** Core güvenlik/tenancy testleri + smoke seti geçer (kanıtla).
- **Gerekli operasyonel kanıt:** İzleme/alarm; olay müdahale (incident) prosedürü; restore testi kanıtı.
- **Onay sahibi:** Kullanıcı (ChatGPT incelemesiyle).
- **Rollback hazırlığı:** Pilot kliniklerin verisiyle birlikte geri dönüş/çıkış planı belgelenmiş olmalı.
- **Not:** F0-012, bu kapının tam kanıt listesini [LAUNCH_GATES.md §2](LAUNCH_GATES.md#2-g1--controlled-pilot-ready) içinde ayrıntılandırdı — Gate ID, giriş kriterleri, A-H kanıt boyutları (program/governance, kod/test, tenant/güvenlik, DB/migration, storage/backup, operasyon, feature-activation, dış/yasal), blocker/accepted-risk ayrımı, onay kaydı şablonu. **Bu kapı hâlâ `NOT_APPROVED`/`NOT_EVALUATED`** — F0-012 yalnızca kanıt gereksinimlerini tanımladı, hiçbirini karşılamadı/onaylamadı. F0-011, "restore testi kanıtı" için gereken deney spesifikasyonunu üretti ([f0-011-storage-backup-test-matrix.md](../architecture/f0-011-storage-backup-test-matrix.md), Experiments 25-35) ve mevcut durumun `UNVERIFIED`/`NOT_CONFIGURED` olduğunu kanıtla doğruladı (R-029…R-032) — F0-011 hiçbir deneyi çalıştırmadı, yalnızca tasarladı.

## G2 — General Commercial Launch Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Genel ticari lansman: kontrolsüz sayıda kliniğin self-service onboarding'i.
- **Gerekli teknik kanıt:** Ölçeklenebilir onboarding; kota/limit altyapısı; performans kapıları geçer.
- **Gerekli güvenlik kanıtı:** Bağımsız güvenlik gözden geçirmesi; entitlement'ların backend'de zorlandığı kanıtı.
- **Gerekli uyum kanıtı:** KVKK süreçlerinin ölçekte işlediği kanıtı; sözleşme/DPA şablonları.
- **Gerekli test kanıtı:** Release regresyon kapsamı + E2E geçer.
- **Gerekli operasyonel kanıt:** SLO'lar, kapasite planı, destek süreci, faturalama doğrulaması.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Sürüm geri alma provası (rollback rehearsal) kanıtı.
- **Not:** G1'in geçilmesi G2'nin geçildiği anlamına **gelmez**. F0-012, bu kapının tam kanıt listesini [LAUNCH_GATES.md §3](LAUNCH_GATES.md#3-g2--general-commercial-launch-ready) içinde ayrıntılandırdı — her A-H boyutu G1'den **bağımsız olarak** değerlendirilir (G1'de kabul edilen geçici riskler G2'de çoğunlukla zorunlu hale gelir: offsite yedek, PITR, CI kapsamı, izleme/alarm, otomatik rollback). **Bu kapı hâlâ `NOT_APPROVED`/`NOT_EVALUATED`.**

## G3 — Rapid Growth Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Kısa sürede yüzlerce klinik onboarding'ini kaldırabilme.
- **Gerekli teknik kanıt:** Yük testleri (hedef eşzamanlılıkta); yatay ölçekleme kanıtı; kuyruk adaleti.
- **Gerekli güvenlik kanıtı:** Noisy-neighbor kontrolleri; izolasyonun yük altında korunduğu kanıtı.
- **Gerekli uyum kanıtı:** Veri işleme envanterinin ölçekte güncel kalması.
- **Gerekli test kanıtı:** Performans kapıları CI'da; nightly regresyon istikrarı.
- **Gerekli operasyonel kanıt:** Otomatik ölçekleme/kapasite; on-call modeli.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Onboarding durdurma (kill switch) ve geri basınç mekanizması.

## G4 — Imaging and Clinical AI Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** DICOM/CBCT görüntüleme ve tıbbi görüntüleme AI özelliklerinin canlıya alınması.
- **Gerekli teknik kanıt:** Object storage üzerinde imaging hattı; PACS bileşen entegrasyonu; bridge güvenlik kanıtı.
- **Gerekli güvenlik kanıtı:** DICOM erişim kontrolü; görüntü verisi şifreleme; bridge tedarik zinciri kanıtı.
- **Gerekli uyum kanıtı:** **Ayrı yasal ve klinik validasyon** (tıbbi cihaz/AI mevzuat sınıflandırması dahil).
- **Gerekli test kanıtı:** Imaging E2E; AI çıktı değerlendirme/regresyon seti.
- **Gerekli operasyonel kanıt:** Görüntü hacmi kapasite planı; imaging izleme.
- **Onay sahibi:** Kullanıcı + yasal/klinik danışmanlık.
- **Rollback hazırlığı:** Imaging özelliklerinin feature flag ile kapatılabilirliği kanıtı.
- **Not:** F0-011, "object storage üzerinde imaging hattı" için tasarım girdisi üretti ([object-storage-backup-migration-design.md §11](../architecture/object-storage-backup-migration-design.md#11-dicomcbct-and-imaging-storage-strategy)) — PACS'tan sıfırdan inşa önerilmedi (ADR-011 ile tutarlı), orijinal tanısal görüntülerin kayıplı sıkıştırılması önerilmedi. Sağlayıcı/migrasyon henüz seçilmedi; bu kapı hâlâ `NOT_APPROVED`.

## G5 — Official Integration Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Sağlık Bakanlığı ve diğer resmî entegrasyonların canlı kullanımı.
- **Gerekli teknik kanıt:** Adapter platformu; sertifika/kimlik yönetimi; sandbox'ta uçtan uca kanıt.
- **Gerekli güvenlik kanıtı:** Resmî kanal kimlik bilgilerinin güvenli saklanması; denetim izi.
- **Gerekli uyum kanıtı:** İlgili kurumların teknik/idari gereksinimlerinin karşılandığı kanıtı.
- **Gerekli test kanıtı:** Adapter contract testleri; hata/retry senaryoları.
- **Gerekli operasyonel kanıt:** Kesinti/sözleşme değişikliği müdahale planı.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Entegrasyon bazında devre dışı bırakma ve kuyruklama kanıtı.

## G6 — 1,000+ Clinic Enterprise Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** 1.000+ klinik, dedicated tenant seçenekleri, tam DR ve kurumsal operasyon olgunluğu.
- **Gerekli teknik kanıt:** Dedicated tenant kabiliyeti; DR tatbikatı (bölge/altyapı kaybı senaryosu); OLAP/analitik ayrımı.
- **Gerekli güvenlik kanıtı:** Kurumsal güvenlik denetimi; SSO/OIDC; gelişmiş uyum raporlaması.
- **Gerekli uyum kanıtı:** Kurumsal DPA/SLA çerçevesi; denetim hazırlığı.
- **Gerekli test kanıtı:** Ölçek testleri (1.000+ tenant simülasyonu); DR restore kanıtı.
- **Gerekli operasyonel kanıt:** 7/24 operasyon modeli; SLA raporlaması; kapasite yönetimi.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Bölgesel/dedicated geçişlerin geri alınabilirlik planı.

---

## Kapı durum tablosu

| Kapı | Ad | Durum |
|---|---|---|
| G0 | F0 Architecture Validation Complete | `APPROVED_WITH_CONDITIONS` (2026-07-25) |
| G1 | Controlled Pilot Ready | `NOT_APPROVED` |
| G2 | General Commercial Launch Ready | `NOT_APPROVED` |
| G3 | Rapid Growth Ready | `NOT_APPROVED` |
| G4 | Imaging and Clinical AI Ready | `NOT_APPROVED` |
| G5 | Official Integration Ready | `NOT_APPROVED` |
| G6 | 1,000+ Clinic Enterprise Ready | `NOT_APPROVED` |

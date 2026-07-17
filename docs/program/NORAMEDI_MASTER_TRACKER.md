# NoraMedi Master Development Tracker

Bu dosya, NoraMedi kurumsal mimari ve modülerleşme programının **yetkili canlı durum kaynağıdır**. Bkz. [README.md](README.md).

Son güncelleme: 2026-07-17 (F0-001)

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

Kanıt toplanmamış alanlar `UNVERIFIED` olarak işaretlenmiştir; F0-002 bu tabloyu kanıtla dolduracaktır. Değer **uydurulmaz**.

| Alan | Değer |
|---|---|
| Repository | `DisKlinikCRM` (yerel yol: `E:\Ek Gelir\Siteler\DisKlinikCRM-git`; remote: `github.com/MustafaBasol/DisKlinikCRM`) |
| Default branch | `main` |
| Current branch (bu dokümantasyon çalışması) | `docs/f0-001-program-tracker-foundation` |
| Documentation branch creation base | `68721554eb622837f67f956d571723192d628eaf` (branch oluşturulduğu andaki `origin/main`, 2026-07-17) |
| PR base branch | `main` |
| Current main commit | `UNVERIFIED` — F0-002 bu kanıtı toplayacaktır |
| Production commit | `UNVERIFIED` |
| Backend deployment | `UNVERIFIED` |
| Frontend deployment | `UNVERIFIED` |
| Worker deployment | `UNVERIFIED` |
| Current database migration | `UNVERIFIED` |
| Last backup | `UNVERIFIED` |
| Last restore test | `UNVERIFIED` |
| Last production verification | `UNVERIFIED` |
| Last confirmed merged KVKK work | [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) — KVKK-HIGH-004 secure clinic bulk export — `MERGED` (2026-07-17) |
| Currently active KVKK work | `UNVERIFIED` |
| Local observation (KVKK) | Ana çalışma ağacında `feature/kvkk-crit-003-security-incident-foundation` branch'i gözlemlendi; remote branch, PR, kapsam, uygulama ve tamamlanma durumu `UNVERIFIED` |
| Known blockers | Bkz. §12 |

## 4. Phase summary (Faz özeti)

| Faz | Ad | Durum | Giriş koşulu | Çıkış kapısı | Bloklayan bağımlılık | Son güncelleme |
|---|---|---|---|---|---|---|
| F0 | Baseline, Program Control, and Architecture Validation | `IN_PROGRESS` | Program başlangıcı | G0: F0 doğrulama raporu (F0-013) onayı | Aktif KVKK çalışması taban çizgisi (mimari değişiklikler için) | 2026-07-17 |
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
| ID | F0-001 |
| Title | Program Control and Master Tracker Foundation |
| Status | `PR_OPEN` — [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) açık; dış inceleme düzeltmeleri commit `ef11d2d` ile push edildi (2026-07-17; merge kararı dış incelemeye aittir) |
| Branch | `docs/f0-001-program-tracker-foundation` |
| Scope | Yalnızca dokümantasyon: program takip temeli (`docs/program/`) |
| Out of scope | Tüm uygulama ve veritabanı değişiklikleri |
| Dependency | Yok |
| Reviewer | ChatGPT / kullanıcı |
| Ajan için izinli sonraki durum | Yok — `MERGED` yalnızca dış merge kanıtıyla kaydedilebilir |

## 6. Current F0 task backlog (F0 görev listesi)

### F0-001 — Program Control and Master Tracker Foundation
- **Status:** `PR_OPEN` — [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) açık; düzeltmeler push edildi (2026-07-17)
- **Purpose:** Depo-tabanlı yetkili program takip sistemini (`docs/program/`) oluşturmak.
- **Dependencies:** Yok.
- **Deliverables:** 24 Markdown dosyası (12 kök + 12 faz dokümanı).
- **Evidence required:** Dosyaların depoda varlığı; uygulama/şema/CI/test dosyalarının değişmediğinin `git status` kanıtı.
- **Blocking conditions:** Yok.
- **Allowed next status:** Dış inceleme sonrası `REVIEW_REQUIRED` / `CHANGES_REQUESTED` / PR akışı.

### F0-002 — Repository and Deployment Baseline Inventory
- **Status:** `READY`
- **Purpose:** Depo, branch, migration, deployment ve ortam taban çizgisini **kanıtla** envanterlemek; §3'teki `UNVERIFIED` alanları doldurmak.
- **Dependencies:** F0-001.
- **Deliverables:** Güncellenmiş §3 baseline tablosu + envanter raporu.
- **Evidence required:** Git referansları, migration listesi, deployment revizyon bilgileri (erişilebiliyorsa).
- **Blocking conditions:** Yok. **Yalnızca analiz/dokümantasyon; uygulama davranışı değiştirilemez.**
- **Allowed next status:** `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-003 — Domain and Module Ownership Map
- **Status:** `TODO`
- **Purpose:** [MODULE_MAP.md](MODULE_MAP.md) içindeki geçici hedef haritayı gerçek dosya sahipliğiyle doğrulamak ve revize etmek.
- **Dependencies:** F0-002.
- **Deliverables:** Depo-doğrulanmış modül haritası.
- **Evidence required:** Dosya/dizin → domain eşleme listesi.
- **Blocking conditions:** Yok (analiz-yalnız).
- **Allowed next status:** `READY` (F0-002 sonrası) → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-004 — Cross-Module Dependency Map
- **Status:** `TODO`
- **Purpose:** [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) matrisini depo kanıtıyla doldurmak; ihlalleri işaretlemek.
- **Dependencies:** F0-003.
- **Deliverables:** Dolu bağımlılık matrisi + ihlal listesi.
- **Evidence required:** Import/çağrı kanıtları (dosya:satır).
- **Blocking conditions:** Yok (analiz-yalnız).
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

### F0-005 — Test Inventory, Runtime Measurement, and Ownership Map
- **Status:** `TODO`
- **Purpose:** [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) envanter tablosunu doldurmak: test dosyaları, süreler, DB/harici bağımlılıklar, güvenilirlik.
- **Dependencies:** F0-003.
- **Deliverables:** Test envanteri + süre ölçümleri.
- **Evidence required:** Test çalıştırma çıktıları (hedefli; tüm suite zorunlu değil).
- **Blocking conditions:** Pahalı/geniş suite'ler için kullanıcı onayı.
- **Allowed next status:** `READY` → `IN_PROGRESS` → `AGENT_COMPLETED`.

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
| F0-001 | Program Control and Master Tracker Foundation | `PR_OPEN` | Yalnızca dokümantasyon oluşturuldu. Uygulama veya mimari doğrulama **tamamlanmış değildir**. Dış inceleme düzeltmeleri (bayat KVKK taban çizgisi ifadeleri) commit `ef11d2d` ile [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166)'ya push edildi (2026-07-17); PR açık, merge kararı dış incelemeye aittir. |

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

Henüz bu program kapsamında production doğrulaması yapılmamıştır.

| Tarih | Görev/Sürüm | Ortam | Test | Sonuç | Kanıt |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## 12. Current blockers (Güncel blokajlar)

1. KVKK taban çizgisi henüz dışarıdan kararlı olarak teyit edilmedi. KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi (2026-07-17); ancak bu, tüm KVKK programının tamamlandığı anlamına gelmez — devam eden KVKK/güvenlik çalışmasının durumu `UNVERIFIED` (F0-007 kanıt toplayacaktır).
2. Depo taban çizgisi (baseline) henüz toplanmadı (F0-002).
3. Production topolojisi bu program kapsamında henüz doğrulanmadı (F0-006).
4. RLS / Prisma / PgBouncer uyumluluğu henüz kanıtlanmadı (F0-009 → F5).
5. Object-storage sağlayıcısı ve migrasyon tasarımı henüz onaylanmadı (F0-011 → F4).
6. Queue/outbox mimarisi henüz kanıtlanmadı (F0-010 → F6).

## 13. Exact next task (Kesin sonraki görev)

**F0-002 — Repository and Deployment Baseline Inventory**

F0-002 yalnızca **analiz/dokümantasyon** görevidir; uygulama davranışını, şemayı, migration'ları, testleri, CI'ı veya deployment'ı **değiştiremez**.

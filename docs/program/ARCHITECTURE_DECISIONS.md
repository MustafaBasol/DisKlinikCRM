# ARCHITECTURE_DECISIONS — ADR İndeksi

Son güncelleme: 2026-07-17 (F0-001)

## Durum sözlüğü

| Durum | Anlamı |
|---|---|
| `PROPOSED` | Taslak; karar verilmedi |
| `UNDER_REVIEW` | Dış inceleme sürüyor |
| `ACCEPTED` | Kanıt ve onayla kabul edildi |
| `REJECTED` | Reddedildi |
| `SUPERSEDED` | Yerine yeni bir ADR geçti |

> Tüm ADR'ler şu an `PROPOSED` durumundadır. Hiçbir teknik ayrıntı **kabul edilmiş sayılmaz**; aşağıdaki maddeler yalnızca karar ihtiyacını tanımlar. [NORAMEDI_MASTER_TRACKER.md §9](NORAMEDI_MASTER_TRACKER.md#9-accepted-decisions-kabul-edilmiş-program-yönü-kararları) içindeki `PROGRAM DIRECTION` maddeleri ADR kabulü değildir; ADR süreci bu dosyada yürütülür.

---

## ADR-001 — Modular monolith
- **Status:** `PROPOSED`
- **Purpose:** Uygulamanın modüler monolit olarak yapılandırılmasının sınırlarını ve kurallarını kesinleştirmek.
- **Decision required:** Modül tanımı, katmanlar, servis çıkarım kriterleri.
- **Phase:** F2
- **Dependencies:** F0-003, F0-004
- **Evidence still needed:** Depo-doğrulanmış modül haritası ([MODULE_MAP.md](MODULE_MAP.md), F0-003 — sağlandı) ve bağımlılık matrisi (F0-004 — hâlâ bekliyor). F0-003 kanıtı bu kararı henüz **kabul etmez** — yalnızca girdi sağlar.

## ADR-002 — Tenant isolation layers
- **Status:** `PROPOSED`
- **Purpose:** Defense-in-depth tenant izolasyon katmanlarını (uygulama, DB, altyapı) tanımlamak.
- **Decision required:** Katman sorumlulukları, zorunlu kontrol noktaları, ihlal tespiti.
- **Phase:** F5
- **Dependencies:** F0-007, ADR-005
- **Evidence still needed:** Mevcut izolasyon mekanizmalarının envanteri; RLS PoC sonuçları.

## ADR-003 — Shared vs dedicated tenant databases
- **Status:** `PROPOSED`
- **Purpose:** Varsayılan shared-schema ile kurumsal dedicated tenant kabiliyetinin birlikte nasıl destekleneceğine karar vermek.
- **Decision required:** Dedicated tenant tetikleme kriterleri, veri taşıma yolu, operasyon modeli.
- **Phase:** F5 / F11
- **Dependencies:** ADR-002
- **Evidence still needed:** Ölçek/maliyet analizi; pilot müşteri gereksinimleri.

## ADR-004 — Prisma and PgBouncer strategy
- **Status:** `PROPOSED`
- **Purpose:** Prisma'nın PgBouncer (transaction pooling) ile güvenli birlikte çalışma stratejisini belirlemek.
- **Decision required:** Pooling modu, session state (RLS `SET`), prepared statement davranışı, bağlantı bütçeleri.
- **Phase:** F5
- **Dependencies:** F0-009
- **Evidence still needed:** PoC ölçümleri; bağlantı tükenmesi senaryoları.

## ADR-005 — PostgreSQL RLS
- **Status:** `PROPOSED`
- **Purpose:** Satır düzeyi güvenliğin (RLS) tenant izolasyonu için kullanımına karar vermek.
- **Decision required:** Policy modeli, rol stratejisi, Prisma entegrasyonu, performans etkisi.
- **Phase:** F5
- **Dependencies:** F0-009, ADR-004
- **Evidence still needed:** RLS PoC kanıtı; performans ölçümleri.

## ADR-006 — Transactional outbox
- **Status:** `PROPOSED`
- **Purpose:** Kaybolmayan, tam-bir-kez etkili (idempotent) event yayını için outbox desenine karar vermek.
- **Decision required:** Outbox tablosu tasarımı, dispatcher, retry/poison stratejisi.
- **Phase:** F6
- **Dependencies:** F0-010
- **Evidence still needed:** PoC tasarımı; hacim projeksiyonları.

## ADR-007 — Queue platform
- **Status:** `PROPOSED`
- **Purpose:** Kuyruk platformunu (ör. BullMQ/Redis vb. adaylar) seçmek.
- **Decision required:** Platform seçimi, işlem garantileri, gözlemlenebilirlik, çok-tenant adalet (fairness).
- **Phase:** F6
- **Dependencies:** F0-010, ADR-006
- **Evidence still needed:** Aday karşılaştırması; mevcut job altyapısının envanteri.

## ADR-008 — Object-storage abstraction
- **Status:** `PROPOSED`
- **Purpose:** Dosya/görüntü depolama için sağlayıcı-bağımsız soyutlamaya ve sağlayıcı seçimine karar vermek.
- **Decision required:** Sağlayıcı (S3-uyumlu vb.), veri yerleşimi (KVKK), anahtar şeması, migrasyon yolu.
- **Phase:** F4
- **Dependencies:** F0-011
- **Evidence still needed:** Mevcut depolama kullanım envanteri; sağlayıcı analizi.

## ADR-009 — AI Gateway
- **Status:** `PROPOSED`
- **Purpose:** Tüm AI çağrılarının geçtiği gateway katmanına karar vermek (routing, metering, güvenlik, PII/PHI minimizasyonu).
- **Decision required:** Gateway mimarisi, provider registry, maliyet ölçümü, log/provenance modeli.
- **Phase:** F8
- **Dependencies:** ADR-001
- **Evidence still needed:** Mevcut AI kullanım envanteri; veri yerleşimi gereksinimleri.

## ADR-010 — Official integration adapter platform
- **Status:** `PROPOSED`
- **Purpose:** Sağlık Bakanlığı ve diğer resmî entegrasyonlar için adapter-tabanlı platform tasarımına karar vermek.
- **Decision required:** Adapter sözleşmesi, sertifika/kimlik yönetimi, hata/retry, denetim izi.
- **Phase:** F9
- **Dependencies:** ADR-006, ADR-007
- **Evidence still needed:** Hedef resmî API'lerin sözleşme envanteri.

## ADR-011 — DICOM/PACS architecture
- **Status:** `PROPOSED`
- **Purpose:** DICOM/PACS mimarisine karar vermek (Orthanc/OHIF-tarzı yerleşik bileşenler temelinde).
- **Decision required:** Bileşen seçimi, depolama, erişim güvenliği, tenant ayrımı, viewer entegrasyonu.
- **Phase:** F10
- **Dependencies:** ADR-008
- **Evidence still needed:** Görüntüleme hacmi projeksiyonları; bileşen değerlendirmesi.

## ADR-012 — Observability standard
- **Status:** `PROPOSED`
- **Purpose:** Log, metrik, trace ve alarm standardına karar vermek.
- **Decision required:** Araç seti, veri saklama, PII/PHI log politikası, SLO'lar.
- **Phase:** F3
- **Dependencies:** —
- **Evidence still needed:** Mevcut log/monitoring envanteri.

## ADR-013 — Backup, PITR, and DR
- **Status:** `PROPOSED`
- **Purpose:** Yedekleme, point-in-time recovery ve felaket kurtarma stratejisine karar vermek.
- **Decision required:** RPO/RTO hedefleri, yedek doğrulama (restore testi), DR topolojisi.
- **Phase:** F4 / F11
- **Dependencies:** ADR-008
- **Evidence still needed:** Mevcut yedekleme durumunun kanıtı (şu an `UNVERIFIED`).

## ADR-014 — Feature flags, entitlements, and permissions
- **Status:** `PROPOSED`
- **Purpose:** Feature flag, entitlement ve permission katmanlarının ayrımına ve uygulanma noktalarına karar vermek.
- **Decision required:** Model ayrımı, backend zorunluluğu, devre dışı modül worker/job davranışı.
- **Phase:** F2
- **Dependencies:** ADR-001
- **Evidence still needed:** Mevcut flag/permission mekanizmalarının envanteri.

## ADR-015 — Module boundaries and public contracts
- **Status:** `PROPOSED`
- **Purpose:** Modül sınırlarını ve public contract biçimini kesinleştirmek.
- **Decision required:** Contract sözdizimi/konumu, sürümleme, ihlal denetimi (lint/CI).
- **Phase:** F2
- **Dependencies:** F0-003, F0-004, ADR-001
- **Evidence still needed:** Bağımlılık matrisi (F0-004 — hâlâ bekliyor); pilot contract denemesi. F0-003 kanıt-tabanlı contract adayları listesi mevcut ([MODULE_MAP.md § Cross-domain dependencies and future contracts](MODULE_MAP.md#cross-domain-dependencies-and-future-contracts)) — hiçbiri henüz uygulanmadı veya kabul edilmedi.

## ADR-016 — Container and orchestration strategy
- **Status:** `PROPOSED`
- **Purpose:** Container ve orkestrasyon stratejisine karar vermek (erken Kubernetes'ten kaçınma yönü ile tutarlı).
- **Decision required:** Mevcut Docker temelinin evrimi, çok-instance çalışma, orkestrasyon tetikleyicileri.
- **Phase:** F7
- **Dependencies:** ADR-012
- **Evidence still needed:** Mevcut deploy topolojisi (F0-006); ölçek projeksiyonları.

## ADR-017 — Analytics and OLAP strategy
- **Status:** `PROPOSED`
- **Purpose:** Raporlama/analitik için OLAP stratejisine karar vermek (operasyonel DB'yi analitik yükten korumak).
- **Decision required:** Export/replica/warehouse yaklaşımı, veri minimizasyonu, tenant ayrımı.
- **Phase:** F11
- **Dependencies:** ADR-013
- **Evidence still needed:** Rapor yükü ölçümleri; kurumsal analitik gereksinimleri.

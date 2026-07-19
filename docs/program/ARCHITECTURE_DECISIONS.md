# ARCHITECTURE_DECISIONS — ADR İndeksi

Son güncelleme: 2026-07-19 (F0-008 — ADR Review and Enterprise Foundation Decision Set)

## Durum sözlüğü

| Durum | Anlamı |
|---|---|
| `PROPOSED` | Taslak; karar verilmedi |
| `UNDER_REVIEW` | Dış inceleme sürüyor |
| `ACCEPTED` | Kanıt ve onayla kabul edildi (bu görev tarafından ajan-seviyesinde `ACCEPTED` olarak işaretlenmiştir — §"F0-008 notu" bkz.) |
| `ACCEPTED_WITH_CONDITIONS` | Yön/ilke düzeyinde kabul edildi; adlandırılmış bir alt-karar (PoC, dış onay, somut tasarım) hâlâ bekliyor |
| `DEFERRED` | Yön dahi kabul edilmedi; belirli bir gelecek görev kanıt toplayacak |
| `NEEDS_POC` | PoC kanıtı olmadan karar verilemez; uygulama F0-007 dondurma sınırı altında bloklu |
| `REJECTED` | Reddedildi |
| `SUPERSEDED` | Yerine yeni bir ADR geçti |

> **F0-008 notu (2026-07-19):** Bu görev, 17 ADR'nin her birini `docs/architecture/adr-foundation-review.md`'de depo-kanıtına karşı gözden geçirdi ve aşağıdaki durumları güncelledi. Kaynak hiyerarşisi gereği (bkz. `NORAMEDI_MASTER_TRACKER.md` §2.1/§2.3), bir ajan bir ADR'yi **dış incelemeden önce** nihai/bağlayıcı olarak kabul edemez — aşağıdaki `ACCEPTED`/`ACCEPTED_WITH_CONDITIONS` durumları bu görevin **kendi belgesel kaydıdır** (tam gerekçe, ADR kalite alanları ve kanıt atıfları için bkz. [../architecture/adr-foundation-review.md](../architecture/adr-foundation-review.md)); nihai program politikası olarak muamele görmeden önce hâlâ dış (ChatGPT/kullanıcı) incelemesi gerektirirler. Hiçbiri herhangi bir uygulama, şema, migration veya deployment değişikliği yetkilendirmez; F0-007 mimari dondurma sınırı tamamen geçerliliğini korur. [NORAMEDI_MASTER_TRACKER.md §9](NORAMEDI_MASTER_TRACKER.md#9-accepted-decisions-kabul-edilmiş-program-yönü-kararları) içindeki eski `PROGRAM DIRECTION` maddeleri, ilgili oldukları yerlerde artık aşağıdaki ADR'lere resmen bağlanmıştır (bkz. her ADR'nin "F0-008 review" satırı).

---

## ADR-001 — Modular monolith
- **Status:** `ACCEPTED` (F0-008, 2026-07-19 — pending external review; see note above)
- **F0-008 review:** Accepted now. Absorbs `NORAMEDI_MASTER_TRACKER.md` §9 items 1-8 (no rewrite; Express/React-Vite/Prisma/PostgreSQL retained; service extraction only for evidenced boundaries). Full ADR content: [adr-foundation-review.md §5.1](../architecture/adr-foundation-review.md#51-adr-001--modular-monolith-accepted).
- **Purpose:** Uygulamanın modüler monolit olarak yapılandırılmasının sınırlarını ve kurallarını kesinleştirmek.
- **Decision required:** Modül tanımı, katmanlar, servis çıkarım kriterleri.
- **Phase:** F2
- **Dependencies:** F0-003, F0-004
- **Evidence still needed:** Depo-doğrulanmış modül haritası ([MODULE_MAP.md](MODULE_MAP.md), F0-003 — sağlandı) ve bağımlılık matrisi ([DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) §10, F0-004 — sağlandı: 37 domain, 833 edge, 9 high-risk boundary violation, 35 iki-domain döngü, 15 contract adayı; bkz. [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md)). F0-003/F0-004 kanıtı bu kararı henüz **kabul etmez** — yalnızca girdi sağlar. F0-004 özellikle `core-identity-access↔core-org-clinic-membership` ve `imaging-server-viewer↔imaging-device-bridge` döngülerini bu ADR'nin "tek bounded context mi, iki mi" sorusuna somut girdi olarak işaretledi (evidence doc §5).

## ADR-002 — Tenant isolation layers
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Application-level scoping (`clinicScope`/`clinicAccess`/`tenantGuard`) accepted now as the mandatory baseline, remaining mandatory even after any future RLS layer. RLS/PgBouncer specifics remain `NEEDS_POC` — see ADR-004/ADR-005. Full ADR content: [adr-foundation-review.md §5.2](../architecture/adr-foundation-review.md#52-adr-002--tenant-isolation-layers-accepted-with-conditions).
- **Purpose:** Defense-in-depth tenant izolasyon katmanlarını (uygulama, DB, altyapı) tanımlamak.
- **Decision required:** Katman sorumlulukları, zorunlu kontrol noktaları, ihlal tespiti.
- **Phase:** F5
- **Dependencies:** F0-007, ADR-005
- **Evidence still needed:** Mevcut izolasyon mekanizmalarının envanteri; RLS PoC sonuçları.

## ADR-003 — Shared vs dedicated tenant databases
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Shared schema affirmed as default; schema-per-tenant and database-per-tenant-as-universal-default formally rejected. Dedicated-tenant trigger thresholds/operational model remain undecided (DEFER to F5/F11). Full ADR content: [adr-foundation-review.md §5.3](../architecture/adr-foundation-review.md#53-adr-003--shared-vs-dedicated-tenant-databases-accepted-with-conditions).
- **Purpose:** Varsayılan shared-schema ile kurumsal dedicated tenant kabiliyetinin birlikte nasıl destekleneceğine karar vermek.
- **Decision required:** Dedicated tenant tetikleme kriterleri, veri taşıma yolu, operasyon modeli.
- **Phase:** F5 / F11
- **Dependencies:** ADR-002
- **Evidence still needed:** Ölçek/maliyet analizi; pilot müşteri gereksinimleri.

## ADR-004 — Prisma and PgBouncer strategy
- **Status:** `NEEDS_POC` (F0-008, 2026-07-19; PoC criteria refined by F0-009, 2026-07-19)
- **F0-008 review:** No acceptance possible without F0-009 PoC evidence; implementation frozen under `NORAMEDI_MASTER_TRACKER.md` §8 items 3-4 regardless of PoC outcome. See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix) (matrix row).
- **F0-009 review:** Confirmed PgBouncer presence in production is `UNVERIFIED` (repository-wide grep, zero code hits) — any PoC starts from zero, not from validating an existing partial deployment. Confirmed exact current pool config (`server/src/db.ts:9-21`: `DB_POOL_MAX` default 10, `DB_POOL_CONNECT_TIMEOUT_MS` default 10000, `DB_POOL_IDLE_TIMEOUT_MS` default 30000 — none present in `server/.env.example`) and a second, unaccounted-for live connection pool (`server/src/utils/activity.ts:10`, its own `PrismaClient`/`Pool`, not the `db.ts` singleton). Full isolated-PoC design (roles, `SET LOCAL`/RLS-interaction experiments, prepared-statement question, connection-budget proposal): [tenant-rls-pgbouncer-poc-design.md §8](../architecture/tenant-rls-pgbouncer-poc-design.md#8-pgbouncer-poc-design-isolated-environment-only). This review does not change status — still `NEEDS_POC`; no PoC was executed.
- **Purpose:** Prisma'nın PgBouncer (transaction pooling) ile güvenli birlikte çalışma stratejisini belirlemek.
- **Decision required:** Pooling modu, session state (RLS `SET`), prepared statement davranışı, bağlantı bütçeleri.
- **Phase:** F5
- **Dependencies:** F0-009
- **Evidence still needed:** PoC ölçümleri; bağlantı tükenmesi senaryoları. Deferred to F5 PoC execution — see experiments 14-15, 20 in [f0-009-poc-test-matrix.md](../architecture/f0-009-poc-test-matrix.md).

## ADR-005 — PostgreSQL RLS
- **Status:** `NEEDS_POC` (F0-008, 2026-07-19; PoC criteria refined by F0-009, 2026-07-19)
- **F0-008 review:** No acceptance possible without F0-009 PoC evidence; implementation explicitly frozen (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 11, `NORAMEDI_MASTER_TRACKER.md` §8 item 3). Directional intent ("RLS is additive to, not a replacement for, ADR-002's application-level scoping") is affirmed as PoC design guidance, not accepted as a decision. See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **F0-009 review:** Classified all 91 Prisma models by tenant-scoping shape (69/91 are direct-column-policy candidates; 16/91 — `org_scoped_optional_clinic`, `ambiguous_nullable_tenant`, `child_via_parent` — need a policy-function or join-based approach; see [f0-009-tenant-model-inventory.json](../architecture/evidence/f0-009-tenant-model-inventory.json)). Confirmed a specific case (nested-write FK-target insert) where Postgres FK constraint checks bypass RLS regardless of policy — direct evidence that the Prisma guard's parent-ownership validation remains load-bearing even with RLS enabled, reinforcing ADR-002's "additive, not replacement" framing with a concrete mechanism rather than only a principle. Full isolated-PoC design (roles, policy-family comparison, disposable-environment spec): [tenant-rls-pgbouncer-poc-design.md §7](../architecture/tenant-rls-pgbouncer-poc-design.md#7-rls-poc-design-isolated-environment-only). This review does not change status — still `NEEDS_POC`; no PoC was executed, no policy family is pre-selected.
- **Purpose:** Satır düzeyi güvenliğin (RLS) tenant izolasyonu için kullanımına karar vermek.
- **Decision required:** Policy modeli, rol stratejisi, Prisma entegrasyonu, performans etkisi.
- **Phase:** F5
- **Dependencies:** F0-009, ADR-004
- **Evidence still needed:** RLS PoC kanıtı; performans ölçümleri. Deferred to F5 PoC execution — see experiments 1-13, 16-19 in [f0-009-poc-test-matrix.md](../architecture/f0-009-poc-test-matrix.md).

## ADR-006 — Transactional outbox
- **Status:** `DEFERRED` (F0-008, 2026-07-19) — whether/when to build an outbox is deferred to F0-010; the narrow principle "events must be versioned and consumers idempotent if/when an outbox is built" is treated as an already-binding invariant independent of this ADR's own status
- **F0-008 review:** No volume projections exist; implementation frozen (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 item 14 — touches consent/audit flows). See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **Purpose:** Kaybolmayan, tam-bir-kez etkili (idempotent) event yayını için outbox desenine karar vermek.
- **Decision required:** Outbox tablosu tasarımı, dispatcher, retry/poison stratejisi.
- **Phase:** F6
- **Dependencies:** F0-010
- **Evidence still needed:** PoC tasarımı; hacim projeksiyonları.

## ADR-007 — Queue platform
- **Status:** `DEFERRED` (F0-008, 2026-07-19)
- **F0-008 review:** No queue exists today (only PM2 cron + `JobLock`). "BullMQ preferred near-term candidate" is recorded as a non-binding preference only, not a decision — platform selection awaits F0-010. See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **Purpose:** Kuyruk platformunu (ör. BullMQ/Redis vb. adaylar) seçmek.
- **Decision required:** Platform seçimi, işlem garantileri, gözlemlenebilirlik, çok-tenant adalet (fairness).
- **Phase:** F6
- **Dependencies:** F0-010, ADR-006
- **Evidence still needed:** Aday karşılaştırması; mevcut job altyapısının envanteri.

## ADR-008 — Object-storage abstraction
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** The existing provider-agnostic abstraction (`services/fileStorage.ts`) and tenant-scoped key convention (`buildStorageKey`) is affirmed as the pattern to build on. Provider/data-residency selection NEEDS EXTERNAL VENDOR/LEGAL DECISION; migration/lifecycle design DEFER to F0-011. No storage-key migration is authorized. Full ADR content: [adr-foundation-review.md §5.4](../architecture/adr-foundation-review.md#54-adr-008--object-storage-abstraction-accepted-with-conditions).
- **Purpose:** Dosya/görüntü depolama için sağlayıcı-bağımsız soyutlamaya ve sağlayıcı seçimine karar vermek.
- **Decision required:** Sağlayıcı (S3-uyumlu vb.), veri yerleşimi (KVKK), anahtar şeması, migrasyon yolu.
- **Phase:** F4
- **Dependencies:** F0-011
- **Evidence still needed:** Mevcut depolama kullanım envanteri; sağlayıcı analizi.

## ADR-009 — AI Gateway
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Negative-constraint principle accepted now: no AI/clinical usage expansion beyond the current WhatsApp-embedded scope without a governed gateway. No gateway exists to freeze; gateway architecture itself DEFER to F8. Full ADR content: [adr-foundation-review.md §5.5](../architecture/adr-foundation-review.md#55-adr-009-adr-010-adr-011--gatewayadapterpacs-principles-accepted-with-conditions-summarized).
- **Purpose:** Tüm AI çağrılarının geçtiği gateway katmanına karar vermek (routing, metering, güvenlik, PII/PHI minimizasyonu).
- **Decision required:** Gateway mimarisi, provider registry, maliyet ölçümü, log/provenance modeli.
- **Phase:** F8
- **Dependencies:** ADR-001
- **Evidence still needed:** Mevcut AI kullanım envanteri; veri yerleşimi gereksinimleri.

## ADR-010 — Official integration adapter platform
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Negative-constraint principle accepted now: any future official-integration work must use adapter-boundary + delivery-ledger discipline, not the existing bespoke per-channel provider-factory pattern. Target integration selection NEEDS EXTERNAL OPERATIONAL/VENDOR DECISION (Ministry of Health requirements); concrete design DEFER to F9. Full ADR content: [adr-foundation-review.md §5.5](../architecture/adr-foundation-review.md#55-adr-009-adr-010-adr-011--gatewayadapterpacs-principles-accepted-with-conditions-summarized).
- **Purpose:** Sağlık Bakanlığı ve diğer resmî entegrasyonlar için adapter-tabanlı platform tasarımına karar vermek.
- **Decision required:** Adapter sözleşmesi, sertifika/kimlik yönetimi, hata/retry, denetim izi.
- **Phase:** F9
- **Dependencies:** ADR-006, ADR-007
- **Evidence still needed:** Hedef resmî API'lerin sözleşme envanteri.

## ADR-011 — DICOM/PACS architecture
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Negative-constraint principle accepted now: PACS is not built from scratch. Component selection (Orthanc/DICOMweb candidate) NEEDS_POC; clinical/legal validation NEEDS EXTERNAL LEGAL/CLINICAL DECISION (`RELEASE_GATES.md` G4). Full ADR content: [adr-foundation-review.md §5.5](../architecture/adr-foundation-review.md#55-adr-009-adr-010-adr-011--gatewayadapterpacs-principles-accepted-with-conditions-summarized).
- **Purpose:** DICOM/PACS mimarisine karar vermek (Orthanc/OHIF-tarzı yerleşik bileşenler temelinde).
- **Decision required:** Bileşen seçimi, depolama, erişim güvenliği, tenant ayrımı, viewer entegrasyonu.
- **Phase:** F10
- **Dependencies:** ADR-008
- **Evidence still needed:** Görüntüleme hacmi projeksiyonları; bileşen değerlendirmesi.

## ADR-012 — Observability standard
- **Status:** `DEFERRED` (F0-008, 2026-07-19)
- **F0-008 review:** No current log/monitoring inventory exists in the repository; not blocked by the KVKK freeze, but no F0-0xx task has yet produced the evidence this ADR needs. See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **Purpose:** Log, metrik, trace ve alarm standardına karar vermek.
- **Decision required:** Araç seti, veri saklama, PII/PHI log politikası, SLO'lar.
- **Phase:** F3
- **Dependencies:** —
- **Evidence still needed:** Mevcut log/monitoring envanteri.

## ADR-013 — Backup, PITR, and DR
- **Status:** `DEFERRED` (F0-008, 2026-07-19)
- **F0-008 review:** RPO/RTO targets and DR topology DEFER to F0-011. Retention-period components NEED EXTERNAL LEGAL DECISION (`docs/compliance/53§16`, `56§15`: clinical-image/consent retention explicitly pending legal counsel). Existing gaps (R-030/R-031/R-032, all `HIGH`) are not created or resolved by this review — see [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **Purpose:** Yedekleme, point-in-time recovery ve felaket kurtarma stratejisine karar vermek.
- **Decision required:** RPO/RTO hedefleri, yedek doğrulama (restore testi), DR topolojisi.
- **Phase:** F4 / F11
- **Dependencies:** ADR-008
- **Evidence still needed:** Mevcut yedekleme durumunun kanıtı (şu an `UNVERIFIED`).

## ADR-014 — Feature flags, entitlements, and permissions
- **Status:** `ACCEPTED` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Three distinct control planes affirmed; server-side enforcement mandatory; security/tenant/KVKK/audit/backup controls exempt from commercial gating. Full ADR content: [adr-foundation-review.md §5.6](../architecture/adr-foundation-review.md#56-adr-014--feature-flags-entitlements-and-permissions-accepted).
- **Purpose:** Feature flag, entitlement ve permission katmanlarının ayrımına ve uygulanma noktalarına karar vermek.
- **Decision required:** Model ayrımı, backend zorunluluğu, devre dışı modül worker/job davranışı.
- **Phase:** F2
- **Dependencies:** ADR-001
- **Evidence still needed:** Mevcut flag/permission mekanizmalarının envanteri.

## ADR-015 — Module boundaries and public contracts
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** Public-contract-only cross-domain access affirmed, with the 9 existing X-severity `WHA`/`IGM`→`PAT`/`APT` violations recorded as a documented transitional exception, not a new breach. Contract syntax/versioning/enforcement DEFER to F2; CC-04 recommended as pilot contract. Full ADR content: [adr-foundation-review.md §5.7](../architecture/adr-foundation-review.md#57-adr-015--module-boundaries-and-public-contracts-accepted-with-conditions).
- **Purpose:** Modül sınırlarını ve public contract biçimini kesinleştirmek.
- **Decision required:** Contract sözdizimi/konumu, sürümleme, ihlal denetimi (lint/CI).
- **Phase:** F2
- **Dependencies:** F0-003, F0-004, ADR-001
- **Evidence still needed:** Bağımlılık matrisi ([DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) §10, F0-004 — sağlandı); pilot contract denemesi (henüz yapılmadı). F0-004, 15 kanıt-tabanlı contract adayı üretti ([evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md §10](evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md#10-contract-candidates) ve [evidence/F0-004_dependency_inventory.json](evidence/F0-004_dependency_inventory.json) `contractCandidates[]`) — en yüksek öncelikli: CC-04 (Appointment booking/cancellation command), 9 high-risk boundary violation'ın 4'ünü kapatıyor. Hiçbiri henüz uygulanmadı veya kabul edilmedi.

## ADR-016 — Container and orchestration strategy
- **Status:** `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19 — pending external review)
- **F0-008 review:** No Kubernetes without an independently evidenced trigger (none exists today); current bare-VPS+PM2 topology retained, no containerization mandated either. `docs/35-docker-deploy-runbook.md` reconfirmed stale (R-039), not deprecated by this task (out of scope). Full ADR content: [adr-foundation-review.md §5.8](../architecture/adr-foundation-review.md#58-adr-016--container-and-orchestration-strategy-accepted-with-conditions).
- **Purpose:** Container ve orkestrasyon stratejisine karar vermek (erken Kubernetes'ten kaçınma yönü ile tutarlı).
- **Decision required:** Mevcut Docker temelinin evrimi, çok-instance çalışma, orkestrasyon tetikleyicileri.
- **Phase:** F7
- **Dependencies:** ADR-012
- **Evidence still needed:** Mevcut deploy topolojisi (F0-006); ölçek projeksiyonları.

## ADR-017 — Analytics and OLAP strategy
- **Status:** `DEFERRED` (F0-008, 2026-07-19)
- **F0-008 review:** `RPT` domain has the widest raw-SQL read footprint (67 fan-out edges, `DEPENDENCY_MAP.md` §10.3) but no report-load measurement exists; F11 not yet entered. See [adr-foundation-review.md §4](../architecture/adr-foundation-review.md#4-decision-matrix).
- **Purpose:** Raporlama/analitik için OLAP stratejisine karar vermek (operasyonel DB'yi analitik yükten korumak).
- **Decision required:** Export/replica/warehouse yaklaşımı, veri minimizasyonu, tenant ayrımı.
- **Phase:** F11
- **Dependencies:** ADR-013
- **Evidence still needed:** Rapor yükü ölçümleri; kurumsal analitik gereksinimleri.

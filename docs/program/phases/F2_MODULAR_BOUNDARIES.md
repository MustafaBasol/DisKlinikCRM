# F2 — Modular Boundaries and Public Contracts

Faz durumu: `PREPARATION_IN_PROGRESS` (boundary/tooling/module **implementation** remains `TODO` — no implementation is authorized) · Son güncelleme: 2026-08-02 (F2-PREP-005)

F2-PREP-001 through F2-PREP-004 (domain ownership inventory, cross-domain dependency/direct-access map, feature-intake/ClickUp mapping, modularization sequencing) are merged discovery/design evidence. F2-PREP-005 (Consolidated Modularization Charter, [../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md](../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md)) reconciles all four into one authoritative charter and **recommends, but does not itself approve,** Imaging as the first modularization pilot. **This phase remains preparation-only: no pilot, boundary tool, or implementation task has been approved.**

## Objective (Hedef)

Depo-doğrulanmış modül haritası ([../MODULE_MAP.md](../MODULE_MAP.md)) üzerinden modül sınırlarını, public contract'ları ve bağımlılık kurallarını ([../DEPENDENCY_MAP.md](../DEPENDENCY_MAP.md)) uygulamaya koymak; feature flag / entitlement / permission ayrımını netleştirmek (ADR-014, ADR-015).

## Business reason (İş gerekçesi)

Opsiyonel ticari modüller, hızlı etki-bazlı test ve güvenli paralel geliştirme; ancak net modül sınırları ve sözleşmelerle mümkündür. Sınırsız iç bağımlılık, her değişikliği tüm sisteme yayar.

## Entry conditions (Giriş koşulları)

- F1 çıkışı (etki-bazlı CI çalışıyor)
- F0-003/F0-004 haritaları ve ADR-001/014/015 kabulü

## Exit gate (Çıkış kapısı)

- Modül sınırları ve public contract seti kabul edilmiş
- Sınır ihlali denetimi (lint/CI kuralı) çalışıyor
- Pilot modül(ler) yeni sınır modeline **kanıtla** uyumlu

## Dependencies (Bağımlılıklar)

- F1; KVKK taban çizgisi teyidi (fiziksel refactoring için)

## Allowed work (İzinli işler)

- Contract tanımları, sınır denetim araçları
- Onaylı, kademeli fiziksel modül düzenlemeleri (KVKK teyidi sonrası)

## Prohibited work (Yasak işler)

- Büyük patlama (big-bang) refactoring
- KVKK dondurma sınırındaki işler (teyit gelmeden)
- Microservice bölünmesi

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F1 kanıtları incelendikten sonra atanacaktır.

- Public contract biçimi ve konum standardı
- Modül sınır denetimi (import lint/CI kuralı)
- Entitlement'ın backend/service/job katmanında zorlanması
- Devre dışı modül worker/job durdurma mekanizması
- Pilot modül sınır uygulaması ve kanıtı
- Kademeli modül taşıma planı

## Required evidence (Gerekli kanıt)

- Contract listesi; ihlal denetimi CI kanıtı; pilot modül diff/test kanıtı

## Required tests (Gerekli testler)

- Public contract testleri; etkilenen modül testleri; core güvenlik regresyonu

## Security requirements (Güvenlik gereksinimleri)

- Sınır değişiklikleri tenant/permission/audit kontrollerini atlayamaz

## Tenant requirements (Tenant gereksinimleri)

- Modül sınırları tenant bağlamını açıkça taşımalı

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Privacy/consent/retention modeli taşıma işleri yalnızca KVKK teyidi sonrası ve ayrı onayla

## Rollback expectations (Geri alma beklentileri)

- Her kademeli taşıma adımı bağımsız revert edilebilir olmalı

## Risks (Riskler)

- R-025 (entitlement uygulanmaması), R-026 (aşırı modülerleşme), R-002 (KVKK regresyonu)

## Open questions (Açık sorular)

- Contract sözdizimi (TypeScript interface + runtime doğrulama?) — ADR-015'te kararlaştırılacak

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-08-02 | F2-PREP-005 | Durum `TODO` → `PREPARATION_IN_PROGRESS` (implementation still `TODO`). Consolidated Modularization Charter reconciles F2-PREP-001..004; recommends (not approves) Imaging as first pilot. No implementation authorized. |
| 2026-08-02 | F2-PREP-006-A | Discovery/evidence only, one of four independent parallel siblings (A..D) under frozen baseline `4cb334d213b4dbbac4193f1a8c1878deddb55714`; reconciliation deferred to F2-PREP-006-E. Repository-grounded IMG/BRG (`imaging-server-viewer`/`imaging-device-bridge`) ownership and implementation inventory: 32 routes (27 in `imaging.ts` + 5 in `imagingBridgePublic.ts`), 8 of `imaging.ts`'s own routes found to be BRG-owned; duplicated study-ingest transaction logic found between the manual and bridge upload paths; BRG's role classified as an unresolved combination split by edge (ACL/adapter device-facing, ordinary domain logic admin-facing). Proposed (not approved) IMG/BRG split recorded. No implementation, dependency-cruiser, module extraction, or caller migration authorized. |

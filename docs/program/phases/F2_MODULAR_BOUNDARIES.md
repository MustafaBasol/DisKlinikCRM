# F2 — Modular Boundaries and Public Contracts

Faz durumu: `PREPARATION_IN_PROGRESS` (boundary/tooling/module **implementation** remains `TODO` — no implementation is authorized) · Son güncelleme: 2026-08-03 (F2-PREP-007-E)

F2-PREP-001 through F2-PREP-004 (domain ownership inventory, cross-domain dependency/direct-access map, feature-intake/ClickUp mapping, modularization sequencing) are merged discovery/design evidence. F2-PREP-005 (Consolidated Modularization Charter, [../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md](../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md)) reconciles all four into one authoritative charter and **recommends, but does not itself approve,** Imaging as the first modularization pilot. F2-PREP-006-A..D (four independent discovery siblings) and F2-PREP-006-E (the consolidation of all four, [../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md)) define one authoritative Imaging/Bridge boundary contract, a 20-command/14-query/1-event contract catalogue, a 32-test characterization gate, and an 8-stage expand-migrate-contract sequence. Readiness decision: `READY_FOR_CHARACTERIZATION_TEST_IMPLEMENTATION` — runtime modularization is **not** approved. F2-PREP-007-A..D (four independent Stage 0 characterization test-implementation siblings, `MERGED` PRs #293/#294/#295/#296) and F2-PREP-007-E (the consolidation of all four, [../evidence/F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md](../evidence/F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md)) implement and consolidate 21 of the contract's 32 characterization tests (all 18 mandatory-before-refactor + all 3 mandatory-before-caller-migration), establish permanent test ownership (`server/package.json`'s `test:imaging-characterization`, wired into the existing `server:test:disposable-db` CI-owned aggregate), and close **Stage 0**. Two verified findings — `CT-23` (`VERIFIED_DEFECT`, `LinkImagingStudy` patient/request-consistency gap) and `CT-32`/`CR-03` (verified `ImagingRequest` PATCH/cancel concurrency clobber) — are explicitly tracked as unresolved, pre-contract-exposure blockers, not fixed. **This phase remains preparation-only: no pilot, boundary tool, Stage 1+ implementation, or defect remediation has been approved. Runtime modularization remains `NOT_APPROVED`.**

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
| 2026-08-02 | F2-PREP-006-B | Discovery/evidence only, sibling of A/C/D under the same frozen baseline. 12-model ownership/tenant/KVKK assessment: tenant scoping enforced/inherited/unverified breakdown; PZ-IMG-03 refined from "location unverified" to "location resolved, authentication confirmed, RBAC granularity unproven" (remains OPEN); 9 risks (R1-R9) identified, backup-erasure-propagation gap confirmed live-tested. No implementation authorized. |
| 2026-08-02 | F2-PREP-006-C | Discovery/evidence only, sibling of A/B/D under the same frozen baseline. Caller/direct-access/transaction map: 20 inbound callers, 11 direct-access findings across 4 categories, 10 transaction flows, 9 failure points, 2 named blockers (`BLK-01` storage/DB compensation gap, `BLK-02` `ImagingRequest` PATCH concurrency), 6-step proposed (not implemented) migration order. Zero live cross-domain transaction coupling confirmed (headline positive finding). No implementation authorized. |
| 2026-08-02 | F2-PREP-006-D | Discovery/design only, sibling of A/B/C under the same frozen baseline. Public contract and characterization-test design: 20 candidate commands, 12 candidate queries, 1 candidate event (`ImagingStudyReceived`), 31 candidate characterization tests (20 blocking/11 non-blocking), report-only dependency-cruiser POC spec drafted (not installed). Nothing in this document is authoritative pending F2-PREP-006-E. No implementation authorized. |
| 2026-08-02 | F2-PREP-006-E | Consolidation of A-D into one authoritative Imaging/Bridge boundary contract, created directly from current `origin/main` (not the shared A-D frozen baseline). 5 contradictions found and resolved (notably: Notifications removed as an accepted Imaging caller — a domain-cluster naming collision, not a real caller). BRG module-structure decision: one module, two documented edges. F2-CC-14: accepted and revised (read-side query methods added). Duplicate ingest logic: decision to converge. Contract catalogue: 20 commands accepted/6 rejected, 14 queries accepted, 1 candidate event. Characterization-test gate: 32 tests (21 blocking/11 non-blocking). 8-stage expand-migrate-contract sequence defined. Dependency-cruiser: approved to proceed, report-only, Imaging-scoped, not installed. Readiness decision: `READY_FOR_CHARACTERIZATION_TEST_IMPLEMENTATION` — runtime modularization NOT approved. No implementation, schema, test, or workflow file touched. |
| 2026-08-02 | F2-PREP-007-A | Stage 0 characterization, one of four independent parallel test-implementation siblings (A..D), `MERGED` PR #293. Implements 5 of the 18 mandatory-before-refactor characterization tests (`CT-06`, `CT-16`, `CT-19`, `CT-21`, `CT-28`) — 36/36 assertions pass, no defect found. Test-only; reconciliation deferred to F2-PREP-007-E. |
| 2026-08-02 | F2-PREP-007-B | Stage 0 characterization, sibling of A/C/D, `MERGED` PR #294. Implements 7 tests (`CT-02`, `CT-03`, `CT-05`, `CT-17`, `CT-23`, `CT-26`, `CT-30`) — 29/29 assertions pass. **`CT-23` found and reported as `VERIFIED_DEFECT`**: `LinkImagingStudy` can change `ImagingStudy.patientId` while retaining an `imagingRequestId` still belonging to the original patient — reproduced, reported, not fixed (test-only scope). Test-only; reconciliation deferred to F2-PREP-007-E. |
| 2026-08-02 | F2-PREP-007-C | Stage 0 characterization, sibling of A/B/D, `MERGED` PR #295 (also `origin/main`'s current tip). Implements 8 tests covering manual/bridge upload, idempotency, and compensation (`CT-07`, `CT-08`, `CT-10` through `CT-14`, `CT-27`) — 13/13 assertions pass per run, no defect found. Characterizes without converging the manual/bridge ingest duplication (`OVL-01`). Test-only; reconciliation deferred to F2-PREP-007-E. |
| 2026-08-02 | F2-PREP-007-D | Stage 0 characterization, sibling of A/B/C, `MERGED` PR #296. Implements `CT-32` — `ImagingRequest` PATCH/cancel concurrency, making the pre-catalogued `CR-03`/`BLK-02`/`FP-06` silent-clobber gap test-tracked. 153/153 assertions pass (30/30 rounds deterministic silent-clobber reproduction). Test-only, not wired into any aggregate by this task; reconciliation deferred to F2-PREP-007-E. |
| 2026-08-03 | F2-PREP-007-E | Consolidation of A-D. Stage 0 coverage matrix built (32 tests: 21 blocking implemented/passing — all 18 mandatory-before-refactor + all 3 mandatory-before-caller-migration — 11 non-blocking not yet implemented). `CT-23` (`VERIFIED_DEFECT`) and `CT-32`/`CR-03` (verified concurrency gap) preserved as explicit unresolved, pre-contract-exposure blockers, not fixed; storage/DB compensation gap and manual/bridge ingest duplication (`OVL-01`) remain explicitly deferred. Permanent test ownership established: new `server/package.json` script `test:imaging-characterization`, wired into the existing CI-owned `server:test:disposable-db` aggregate (Layer 3) — zero new CI workflow files, zero duplicate execution across layers. All 10 Stage 0 closure acceptance conditions met — **Stage 0: `CLOSED`**. No application/schema/migration file touched. Next: external program-owner review/approval before Stage 1 (additive facade) may begin. |

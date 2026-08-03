# F2 — Modular Boundaries and Public Contracts

Faz durumu: `PREPARATION_IN_PROGRESS` (boundary/tooling/module **implementation** remains `TODO` — Stage 1 is now authorized on paper only, per F2-PREP-008; no code has been implemented) · Son güncelleme: 2026-08-03 (F2-PREP-008)

F2-PREP-001 through F2-PREP-004 (domain ownership inventory, cross-domain dependency/direct-access map, feature-intake/ClickUp mapping, modularization sequencing) are merged discovery/design evidence. F2-PREP-005 (Consolidated Modularization Charter, [../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md](../architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md)) reconciles all four into one authoritative charter and **recommends, but does not itself approve,** Imaging as the first modularization pilot. F2-PREP-006-A..D (four independent discovery siblings) and F2-PREP-006-E (the consolidation of all four, [../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md)) define one authoritative Imaging/Bridge boundary contract, a 20-command/14-query/1-event contract catalogue, a 32-test characterization gate, and an 8-stage expand-migrate-contract sequence. Readiness decision: `READY_FOR_CHARACTERIZATION_TEST_IMPLEMENTATION` — runtime modularization is **not** approved. F2-PREP-007-A..D (four independent Stage 0 characterization test-implementation siblings, `MERGED` PRs #293/#294/#295/#296) and F2-PREP-007-E (the consolidation of all four, [../evidence/F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md](../evidence/F2-PREP-007-E_IMAGING_CHARACTERIZATION_WAVE_CONSOLIDATION_EVIDENCE.md), `MERGED` PR [#298](https://github.com/MustafaBasol/DisKlinikCRM/pull/298)) implement and consolidate 21 of the contract's 32 characterization tests (all 18 mandatory-before-refactor + all 3 mandatory-before-caller-migration), establish permanent test ownership (`server/package.json`'s `test:imaging-characterization`, wired into the existing `server:test:disposable-db` CI-owned aggregate), and demonstrate all 10 **Stage 0** closure acceptance conditions. F2-PREP-008 ([../evidence/F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md](../evidence/F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md)) independently re-verified PR #298's `MERGED` state and its post-merge main CI (run `30797032835`, 9/9 `ci-layers` jobs `success`) — **Stage 0: `CLOSED`** per its own stated criterion (F2-PREP-007-E's own entry left unedited; this is F2-PREP-008's own confirmation). Two verified findings — `CT-23` (`VERIFIED_DEFECT`, `LinkImagingStudy` patient/request-consistency gap) and `CT-32`/`CR-03` (verified `ImagingRequest` PATCH/cancel concurrency clobber) — remain explicitly tracked as unresolved, pre-contract-exposure blockers, not fixed. **F2-PREP-008 additionally produced a paper-only Stage 1 internal facade design** (`server/src/services/imaging/public.ts`, a 4-method `ImagingLifecyclePort` slice — `markStorageMissing`/`redactForAnonymization`/`getImagesForLifecycleReview`/`checkImageStorageExists` — explicitly excluding `LinkImagingStudy`/`UpdateImagingRequest`/`CancelImagingRequest`, i.e. the `CT-23`/`CT-32` surfaces) and issued decision **`AUTHORIZED_FOR_STAGE_1_IMPLEMENTATION`**, naming **`F2-IMPL-001-A` — Additive Unused Internal Imaging Facade Skeleton** as the next task. **No facade code exists yet — this phase remains preparation-only: no pilot, boundary tool, Stage 1+ implementation, or defect remediation has actually been built or approved beyond the paper design. Runtime modularization remains `NOT_APPROVED`.**

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
| 2026-08-03 | F2-PREP-007-E | Consolidation of A-D, PR [#298](https://github.com/MustafaBasol/DisKlinikCRM/pull/298) (open, not merged). Stage 0 coverage matrix built (32 tests: 21 blocking implemented/passing — all 18 mandatory-before-refactor + all 3 mandatory-before-caller-migration — 11 non-blocking not yet implemented). `CT-23` (`VERIFIED_DEFECT`) and `CT-32`/`CR-03` (verified concurrency gap) preserved as explicit unresolved, pre-contract-exposure blockers, not fixed; storage/DB compensation gap and manual/bridge ingest duplication (`OVL-01`) remain explicitly deferred. Permanent test ownership established on the PR branch: new `server/package.json` script `test:imaging-characterization`, wired into the existing CI-owned `server:test:disposable-db` aggregate (Layer 3) — zero new CI workflow files, zero duplicate execution across layers; increases Layer 3 execution time by the four suites' own runtime. All 10 Stage 0 closure acceptance conditions demonstrated on the PR branch — **Stage 0: `CLOSURE_PROPOSED_AWAITING_MERGE_AND_MAIN_CI`**, authoritative only once PR #298 merges and its post-merge main CI passes. No application/schema/migration file touched. Next: (1) program-owner approval + PR #298 merge/main-CI closure; (2) Stage 1 (additive, unused facade) as a separately-gated future task, not blocked by `CT-23`, not authorized here; (3) `CT-23` remediation required before Stage 3 caller migration/exposure, tracked independently of Stage 1. |
| 2026-08-03 | F2-PREP-008 | Stage 1 Imaging Internal Facade Preparation and Authorization — documentation/evidence and program-control only, no facade code added. Independently re-verified (`gh pr view`/`gh run view`/`git merge-base --is-ancestor`, not trusted from F2-PREP-007-E's own pre-merge prose) that PR #298 is `MERGED` and its post-merge main CI (run `30797032835`) passed 9/9 `ci-layers` jobs on the exact baseline SHA — **Stage 0: `CLOSED`** per its own stated criterion; F2-PREP-007-E's own entry left unedited. Targeted repository-evidence analysis with exact file/line citations for `CT-23` (`imaging.ts:807-854`), `CT-32`/`CR-03`/`BLK-02`/`FP-06` (`imaging.ts:487-524`/`530-552`), `OVL-01` (`imaging.ts:614-656` vs `imagingBridgePublic.ts:301-341`), `BLK-01` (`imaging.ts:679`). Produced a paper-only Stage 1 facade design (`server/src/services/imaging/public.ts`, the location already named by this contract's own Stage 1 definition) implementing exactly the accepted `F2-CC-14`/`ImagingLifecyclePort` 4-method slice, explicitly excluding `LinkImagingStudy`/`UpdateImagingRequest`/`CancelImagingRequest` (the `CT-23`/`CT-32` surfaces) from the operation inventory. Authorization decision: **`AUTHORIZED_FOR_STAGE_1_IMPLEMENTATION`**, scoped strictly to that 4-method slice; full checklist (no caller migration required, no runtime behavior change, no schema/storage migration, no external exposure, tenant/auth boundaries unweakened, no new forbidden cross-domain access, rollback = deletion/revert, `CT-23`/`CT-32` remain gated, `OVL-01`/`BLK-01` remain deferred/open, no accepted decision contradicted) verified in the task's own evidence document. Named next task **`F2-IMPL-001-A` — Additive Unused Internal Imaging Facade Skeleton** (confirmed unused before assignment). No implementation performed by this task. |
| 2026-08-03 | F2-IMPL-001-A (implementation, PR #304, `OPEN`, not merged) | Implemented the Stage 1 facade (`server/src/services/imaging/public.ts`) per F2-PREP-008's authorization; zero production callers wired. **Review correction (this same date, F2-IMPL-001-A-R1):** two defects confirmed against the implementation's own self-assessment. (1) `checkImageStorageExists`'s accepted 1-argument signature was altered by an optional `fileExistsForTest` test-injection parameter — a public-contract change. (2) The three `imageId`-only methods' `findOwnedImage()` re-derives `ImagingImage.clinicId`/`ImagingStudy.clinicId` and rejects only on mutual disagreement between those two stored values — a data-integrity consistency check, not caller tenant authorization; no caller-supplied `clinicId`/principal/context value exists anywhere in the accepted signatures to check against. **`BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT` confirmed.** PR #304 left open, unmerged, unmodified, marked blocked — not authorized to merge or deploy. Correction: [F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md](../evidence/F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md). |
| 2026-08-03 | F2-PREP-009 (proposal, not yet accepted) | `ImagingLifecyclePort` Tenant Context Contract Amendment, triggered by F2-IMPL-001-A-R1. Proposes and justifies **Option A** — explicit `clinicId` as the leading parameter on all four methods (`markStorageMissing(clinicId, imageId)`, `redactForAnonymization(clinicId, imageId, reason)`, `checkImageStorageExists(clinicId, imageId)`, `getImagesForLifecycleReview(clinicId, patientId)` unchanged) — over a rejected context-bound-port-factory Option B (no existing session-scoped-factory convention in this codebase; hides the authorization boundary from the call site; does not reduce the underlying work). Defines tenant context source (existing session/system resolution, never re-derived from `imageId`), principal/system-caller distinction (both require an explicit, single-clinic-scoped `clinicId` per call, no bypass), fail-closed DB predicates (`clinicId` in every `where` clause, not a post-fetch comparison), no cross-tenant existence leakage (single undifferentiated `ImagingNotFoundError` preserved), unchanged audit ownership, a mechanical Stage-3 caller-migration path (thread each caller's already-resolved `clinicId`), no production backward-compatibility obligation (PR #304 unmerged, zero callers), documentation-only rollback, and 5 required test additions (cross-tenant rejection, same-clinic regression, denormalization-mismatch-within-own-clinic, no-existence-side-channel, corrected signature-arity assertions). Status `PROPOSED` — requires program-owner review/acceptance before F2-IMPL-001-A is reconciled and re-implemented. Full document: [F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md](../architecture/F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md). |
| 2026-08-03 | F2-PREP-009 correction (same PR #307, tenant-context wording hardening + PR #304 head reconciliation) | Corrected F2-PREP-009's tenant-context-source language: previously readable as permitting `clinicId` to come directly from a session/JWT clinic claim; now requires validation via `resolveEffectiveClinicId`/`validateAndGetClinicIdScope`/`getAccessibleClinicIds` (`server/src/utils/clinicScope.ts`) or an equivalent already-access-scoped record lookup before the port is ever called — a raw JWT/default `clinicId` is explicitly documented as insufficient authorization. Reconciled PR #304's head (`f8a37b72...` → `abac5e3...`, independently re-verified via `gh pr view 304`): **Finding 1** (tenant-authorization gap) confirmed still open/blocking on the current head; **Finding 2** (`fileExistsForTest` signature drift) confirmed corrected on the current head (`checkImageStorageExists` back to one parameter) — classified `VERIFIED_ON_PRIOR_HEAD`/`CORRECTED_ON_CURRENT_PR304_HEAD` (Finding 2) and `VERIFIED_ON_PRIOR_HEAD`/`STILL_OPEN_ON_CURRENT_PR304_HEAD` (Finding 1), not erased, in new sections appended to both F2-PREP-009 and its triggering [F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md](../evidence/F2-IMPL-001-A_R1_TENANT_CONTEXT_REVIEW_CORRECTION.md) (original §§1-8 left unedited). Independently verified (not assumed) the three intended Privacy callers' `clinicId` source by direct read of `patientPrivacy.ts`'s `resolvePatient()` — authorization-validated (org + `allowedClinicIds`-scoped), recorded as an explicit Stage 3 re-verification precondition rather than a standing guarantee. **Option A contract retained unchanged.** F2-PREP-009 remains `PROPOSED`; F2-IMPL-001-A remains `BLOCKED_TENANT_CONTEXT_CONTRACT_INSUFFICIENT` / PR #304 `OPEN`, unmerged, not modified by this correction. No application/schema/migration/package-script/workflow file touched. |

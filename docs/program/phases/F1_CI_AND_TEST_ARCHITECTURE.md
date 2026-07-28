# F1 — CI and Test Architecture

Faz durumu: `IN_PROGRESS` (2026-07-28, F1-001 — **F1-001 design delivered (`AGENT_COMPLETED`, PR opened, not merged)**: [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) resolves this document's own "Open question" below (path-vs-graph-based selection mechanism) by deliberately deferring the static-snapshot-vs-live-graph-query choice to the future implementation task, while fully specifying the classification taxonomy (24 categories), risk model (LOW/MEDIUM/HIGH/CRITICAL with measurable properties), 7 test-scope levels (S0-S6), 12 mandatory escalation rules, fail-safe/confidence model, shadow-mode rollout (4 phases, 8 metrics, zero-false-negative requirement for CRITICAL changes at every phase), and 17 repository-grounded example scenarios — see [evidence/f1-001-test-scope-classification.json](../architecture/evidence/f1-001-test-scope-classification.json) and [evidence/f1-001-impact-selection-rules.json](../architecture/evidence/f1-001-impact-selection-rules.json). **This task does not implement the mechanism, does not satisfy F1's own exit gate below, and does not authorize F1-002.** It discovered one new risk (evidence staleness in F0-005's test inventory relative to current HEAD) recorded as R-072 in `RISK_REGISTER.md`. Full process/validation record: [evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md](../evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md).)

Prior update: 2026-07-25 (F0-014 — phase entered following G0 `APPROVED_WITH_CONDITIONS`; phase entry authorizes only the assigned first task below, not the full initial backlog) · Son güncelleme: 2026-07-25 (**F0-014 — G0 Approval Recording, F0 Closure, and F1 Initial Task Assignment.** G0 ("F0 Architecture Validation Complete") was externally approved `APPROVED_WITH_CONDITIONS` (ChatGPT architecture review + Mustafa Basol decision, 2026-07-25) — see [../RELEASE_GATES.md](../RELEASE_GATES.md). This phase's own entry condition ("G0 onayı (F0 çıkışı)") is now satisfied; phase status moves `TODO`→`IN_PROGRESS`. Per this phase document's own "Initial task backlog," detailed task IDs are assigned only after F0 evidence is reviewed (post-G0) — that review is now complete (F0-013), so the first concrete task is assigned below: **F1-001 — Impact-Based Test-Selection Architecture and Test-Scope Classification**, matching this backlog's first-listed category, "Etki-bazlı test seçim mekanizması tasarımı ve kurulumu." F1-001 is design/evidence-first (status `READY`) — **this task assigns F1-001, it does not execute it.** None of G0's ten preserved conditions (KVKK freeze, R-046/R-071, G1/G2, `NEEDS_POC` ADRs, no RLS/queue/object-storage/backfill/Kafka/Kubernetes/microservices/database-per-tenant/rewrite, modular-monolith/public-contract boundaries) is loosened by this phase transition. Roadmap order below (initial task backlog, dependencies, prohibited work) is otherwise unchanged.)

Prior update: 2026-07-17 (F0-001)

## Objective (Hedef)

Etki-bazlı (affected) test seçimi, katmanlı CI modeli (PR / main / nightly / release) ve güvenilir test altyapısını kurmak; hedef mimari [../TEST_OWNERSHIP.md](../TEST_OWNERSHIP.md) dokümanında tanımlıdır.

## Business reason (İş gerekçesi)

Modüler geliştirme hızının ön koşulu, hızlı ve güvenilir geri bildirim döngüsüdür. Tam suite'e bağımlı yavaş CI; küçük PR politikasını, sık merge'i ve güvenli mimari değişimi engeller.

## Entry conditions (Giriş koşulları) — `SATISFIED` (2026-07-25, F0-014)

- G0 onayı (F0 çıkışı) — **`SATISFIED`**: `APPROVED_WITH_CONDITIONS`, 2026-07-25 ([../RELEASE_GATES.md](../RELEASE_GATES.md)). Conditional — see that gate's full preserved-conditions list; this phase's own KVKK/tenant/ADR-readiness prohibitions below are unaffected.
- F0-005 test envanteri tamamlanmış — **`SATISFIED`**: `MERGED` ([../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) §6/§7).

## Exit gate (Çıkış kapısı)

- Etki-bazlı CI modeli **kanıtla** çalışıyor (PR'da yalnızca etkilenen kapsam + zorunlu core testleri)
- Nightly tam regresyon kurulu ve istikrarlı
- Flaky test envanteri kapatılmış veya karantinada

## Dependencies (Bağımlılıklar)

- F0 (özellikle F0-005)

## Allowed work (İzinli işler)

- CI workflow tasarımı ve kurulumu (bu fazda CI dosyaları değiştirilebilir — F0'daki yasak bu fazda kalkar, dış onayla)
- Test altyapı iyileştirmeleri (disposable Postgres, izolasyon, hız)
- Test sahiplik etiketleme ve tetikleyici path haritası

## Prohibited work (Yasak işler)

- Uygulama davranış değişiklikleri (test edilebilirlik için zorunlu, onaylı DI seam'leri hariç)
- KVKK dondurma sınırındaki işler (taban çizgisi teyit edilmediyse)

## Initial task backlog (Yüksek seviyeli kategoriler)

Detailed task IDs are assigned as each category is reached, in the order below, following its own dependency (F0-005 test inventory, this document's own "Open questions"). **F1-001, the first task, is assigned now (2026-07-25, F0-014)** — see full definition below. The remaining categories remain high-level roadmap entries; none has a task ID yet, and none is invented by this update.

1. **Etki-bazlı test seçim mekanizması tasarımı ve kurulumu → F1-001 (assigned below, `READY`)**
2. PR / main / nightly / release CI katmanlarının kurulumu
3. Test veritabanı stratejisi (disposable Postgres standardı)
4. Flaky test tespiti ve karantina süreci
5. Migration test katmanı
6. Core güvenlik/tenancy regresyon paketinin zorunlu hale getirilmesi
7. CI süre/maliyet ölçüm panosu

### F1-001 — Impact-Based Test-Selection Architecture and Test-Scope Classification

| Field | Value |
|---|---|
| Task ID | F1-001 |
| Title | Impact-Based Test-Selection Architecture and Test-Scope Classification |
| Phase | F1 — CI and Test Architecture |
| Status | `AGENT_COMPLETED` (2026-07-28 — design delivered, PR opened, not merged; see [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) and [evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md](../evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md). Not `MERGED` — requires external review per §2.3.) |
| Purpose | Design (not implement) the impact-based ("affected") test-selection architecture named as F1's own first initial-backlog category and as this phase's own exit-gate requirement ("Etki-bazlı CI modeli **kanıtla** çalışıyor"): given a diff/changed-file set, define the deterministic mechanism that classifies which test files/suites are "affected" and must run on a PR, versus "core" tests that always run, versus tests deferred to nightly/full regression. Must resolve this phase document's own named "Open question": whether the selection mechanism is path-based or dependency-graph-based, using F0-005's test-inventory/ownership data and F0-004's cross-module dependency map as evidence inputs. |
| Dependencies | F0-005 — Test Inventory, Runtime Measurement, and Ownership Map (`MERGED`; provides the 100-target test inventory, ownership map, and F0-004 high-risk-edge test-coverage mapping this design must classify against). F0-004 — Cross-Module Dependency Map (`MERGED`; provides the 37-domain/833-edge dependency matrix a graph-based selection mechanism would need). G0 `APPROVED_WITH_CONDITIONS` (satisfied, 2026-07-25). |
| Allowed scope | Documentation and design only: a written test-selection architecture/design document; a path-to-test-scope classification scheme (or dependency-graph-based scheme, per the open question this task must resolve) built from existing F0-004/F0-005 evidence; a proposed core/always-run test set (starting from F0-005's own named tenant-isolation/cross-tenant/security test list); a proposed CI-layer model (PR / main / nightly / release) at the design level; measurable success criteria for the phase's own exit gate. Read-only analysis of the existing `server`/root `package.json` test scripts and `TEST_OWNERSHIP.md`/`DEPENDENCY_MAP.md` is in scope. |
| Prohibited scope | No CI workflow file (`.github/workflows/**`) may be created, modified, or enabled by this task. No test file may be added, modified, moved, or deleted. No `package.json` script may be added or changed. No application/runtime/schema/migration/dependency/deployment/environment file may be touched. No KVKK/tenant/consent/retention code path may be touched (KVKK physical-architecture freeze remains active, per G0 condition 3-4). No RLS, tenant-key backfill, queue/outbox, object-storage, Kafka, Kubernetes, microservices, database-per-tenant, or framework-rewrite work (G0 condition 8). This task may not itself declare F1's exit gate satisfied — that requires the mechanism to run with evidence, a later task's job. |
| Deliverables | A new design document (e.g. `docs/architecture/f1-001-impact-based-test-selection-design.md`, following this program's established PoC/design-document naming convention) covering: the resolved path-vs-graph-based selection-mechanism decision with rationale; the classification scheme itself (which changed paths map to which test scopes); the proposed core/always-run test set; the proposed PR/main/nightly/release CI-layer model; a measurement/success-criteria definition for the phase exit gate; a rollout plan (design → prototype/dry-run in a disposable branch → CI enablement, with each stage requiring its own separate task authorization). Program-tracker updates recording this task's own completion (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, this phase document). |
| Exact evidence required | File:line or file-path citations from `TEST_OWNERSHIP.md` (F0-005) and `DEPENDENCY_MAP.md` (F0-004) for every classification rule proposed — no invented/assumed test-to-path mapping. If any classification cannot be derived from existing F0-004/F0-005 evidence, it must be recorded as an open question for a follow-up task, not guessed. |
| Validation requirements | Documentation-only: no automated test suite is required to validate a design document. If a documentation-native validator exists in this repository, it must be run and its exact command/result recorded — none is known to exist as of this task's writing; do not invent one. |
| Tenant/security/KVKK impact | None expected — design-only, no runtime/data-path change. The proposed core/always-run test set must explicitly include this repository's existing tenant-isolation/cross-tenant-negative/permission-matrix test files (per `TEST_OWNERSHIP.md`'s "Tenant Security and Scope" and "Identity and Access" domains) as non-negotiable "always run" scope — omitting them from the core set is a defect in this task's own deliverable, not an acceptable design choice. |
| Rollback expectations | Single documentation-commit `git revert`. No database, migration, deployment, or CI rollback applicable — no such file is touched by this task. |
| Completion/status rules | This task may reach at most `AGENT_COMPLETED` (an agent may never self-assign `REVIEW_REQUIRED`/`MERGED`/`DEPLOYED`, per `NORAMEDI_MASTER_TRACKER.md` §2.3). `MERGED` requires external review and an actual merged PR. This design task's own completion does **not** by itself satisfy F1's exit gate ("Etki-bazlı CI modeli **kanıtla** çalışıyor") — that requires a later, separate implementation/dry-run task with runtime evidence. |
| Next-task dependency | Once F1-001's design is `MERGED`, the next F1 backlog category (PR / main / nightly / release CI katmanlarının kurulumu) becomes the candidate next task, sequenced per this section's own numbered order — its exact task ID is assigned by that future task's own authorization, not invented here. |

## Required evidence (Gerekli kanıt)

- CI çalıştırma kayıtları (PR'da etkilenen-kapsam kanıtı, nightly tam kapsam kanıtı)
- Süre ölçümleri (öncesi/sonrası)

## Required tests (Gerekli testler)

- CI modelinin kendisinin doğrulanması: bilinçli değişikliklerle tetikleme testleri

## Security requirements (Güvenlik gereksinimleri)

- CI secret yönetimi; log'lara secret sızmaması

## Tenant requirements (Tenant gereksinimleri)

- Tenant izolasyon regresyonunun her PR'da zorunlu koşması

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Test verilerinde gerçek hasta verisi kullanılamaz

## Rollback expectations (Geri alma beklentileri)

- CI değişiklikleri workflow dosyası revert'iyle geri alınabilir olmalı

## Risks (Riskler)

- R-024 (migration hatası), R-027 (branch sapması), R-028 (yanlış tamamlandı beyanı)

## Open questions (Açık sorular)

- Etki-bazlı seçim mekanizmasının aracı (yol-bazlı mı, graph-bazlı mı) — F1-001 (2026-07-28) bu kararı bilinçli olarak gelecekteki bir implementasyon görevine erteledi (statik anlık görüntü ile canlı graph sorgusu arasındaki farklı bayatlama-hata modları nedeniyle); bkz. [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) §12 açık soru 1. Hâlâ açık, bu görev tarafından çözülmedi.

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-07-25 | F0-014 | G0 `APPROVED_WITH_CONDITIONS` externally granted; entry conditions satisfied; faz durumu `TODO`→`IN_PROGRESS`; first concrete task F1-001 assigned (`READY`, not executed). |
| 2026-07-28 | F1-001 | Design delivered (`AGENT_COMPLETED`, PR opened, not merged): impact-based test-selection architecture, classification taxonomy, risk model, escalation/fail-safe rules, shadow-mode rollout, 17 scenarios. Resolves this document's own "Open question" (below) by deferring the static-vs-live-graph implementation choice to a future task, with rationale. New risk R-072 (test-inventory evidence staleness) recorded in `RISK_REGISTER.md`. Faz durumu remains `IN_PROGRESS`; exit gate NOT satisfied by this task. |

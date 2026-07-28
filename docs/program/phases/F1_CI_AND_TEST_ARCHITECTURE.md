# F1 — CI and Test Architecture

Faz durumu: `IN_PROGRESS` (2026-07-28, F1-002-R2 — **External R-072 Closure Recording and Final PR Metadata Correction**: the external architecture review (ChatGPT architecture review) accepted the F1-002/F1-002-P1/F1-002-P2 evidence chain and, jointly with Mustafa Basol's merge decision, granted closure confirmation for R-072. **R-072 → `CLOSED`**, closure date 2026-07-28, closure basis F1-002 inventory/ownership reconciliation + F1-002-P1 script-reachability evidence + F1-002-P2 runtime-dependency evidence + 0 `UNKNOWN` canonical ownership + complete package-script reachability classification + current-`main` reconciliation completed; external confirmation authority ChatGPT architecture review + Mustafa Basol. This closure is narrow and does **not** resolve: 8 unscripted backend test files; 17 aggregate-chain-excluded scripts; only 7/116 CI-reached test files; disposable-Postgres provisioning; MinIO provisioning; collision avoidance; the 1 runtime `UNKNOWN` (`messagesConsentGate.test.ts`); the unimplemented CI selector; or R-070 — see `RISK_REGISTER.md`. **F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness is assigned below, status `READY, not started` — this pass assigns it, it does not execute it.** PR #253's own description is corrected (17, not 16, chain-excluded scripts; states P1/P2 merged and integrated; states R-072 `CLOSED` by external confirmation; does not claim F1 completion or CI/runtime readiness). This closure-recording pass does not implement CI or the test-selection engine and does not by itself satisfy F1's own exit gate below.)

Prior update: 2026-07-28 (F1-002-R1 — **Parallel Evidence Integration and Main Reconciliation**: PR #253 (F1-002 main) reconciled with `origin/main` (merge commit `035d4db59cf429777a4bb71a5e72203f6c99b571`, which itself contains PR #255/F1-002-P1 merge commit `954168ed4399f572e776fbfd30fa391aad574610` and PR #254/F1-002-P2 merge commit `035d4db59cf429777a4bb71a5e72203f6c99b571`, both confirmed `MERGED`). F1-002-P1 (test script reachability: 103 test-related scripts, 116 current test-related files [105 backend + 9 frontend + 2 fixture-loader helper modules — a narrower JS/TS-only scope than F1-002 main's 137 test/verification targets, see [TEST_OWNERSHIP.md](../TEST_OWNERSHIP.md) §0.1 for the reconciliation] , 17 scripts excluded from the `server:test` aggregate chain, 8 UNSCRIPTED backend files, 0 stale script references, only 7/116 files reached by any CI workflow) and F1-002-P2 (test runtime dependency baseline: 22 files require a disposable Postgres, 1 additionally requires a MinIO/S3-compatible object-storage emulator with zero committed provisioning of either, migration-rollback tooling gap tracked as R-070, zero confirmed live external-provider/network calls, 1 explicit UNKNOWN — `messagesConsentGate.test.ts`) are now indexed into the authoritative F1-002 documentation set. **This integration task does not implement CI or the test-selection engine, does not satisfy F1's own exit gate below, and does not authorize F1-003.** Full process/validation record: [evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](../evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md).)

Prior update: 2026-07-28 (F1-002 — **Test Inventory Refresh and Ownership Reconciliation delivered (`AGENT_COMPLETED`, PR #253 opened, not merged)**: [F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](../evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md) refreshes the test inventory backing F1-001's design against execution baseline `08f2eaf82a205cf3f997c57e6a295fedd66b142d` (105 backend + 9 frontend + 9 bridge-agent + 8 windows-bridge + 4 manual verify + 2 smoke = **137 test/verification targets**, up from F0-005's 100), remediating R-072 (test-inventory evidence staleness, discovered by F1-001). Every target has an explicit canonical owner (0 UNKNOWN), package scripts fully reconciled (0 stale references, 8 never-scripted backend files identified and recorded), and R-072 closure is **proposed** pending external review. Superseded in part by F1-002-R1 above (count/script/runtime vocabulary reconciled against the two parallel evidence subtasks).)

Prior update: 2026-07-28 (F1-001 — **F1-001 design delivered, `MERGED`** via PR #241, merge commit `94cc4ac58f0487dd186886878c5628627f0b1ce3` (2026-07-28T07:22:15Z): [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) resolves this document's own "Open question" below (path-vs-graph-based selection mechanism) by deliberately deferring the static-snapshot-vs-live-graph-query choice to the future implementation task, while fully specifying the classification taxonomy (24 categories), risk model (LOW/MEDIUM/HIGH/CRITICAL with measurable properties), 7 test-scope levels (S0-S6), 12 mandatory escalation rules, fail-safe/confidence model, shadow-mode rollout (4 phases, 8 metrics, zero-false-negative requirement for CRITICAL changes at every phase), and 17 repository-grounded example scenarios — see [evidence/f1-001-test-scope-classification.json](../architecture/evidence/f1-001-test-scope-classification.json) and [evidence/f1-001-impact-selection-rules.json](../architecture/evidence/f1-001-impact-selection-rules.json). **This task's own completion does not by itself satisfy F1's exit gate below, and does not authorize F1-002.** It discovered one new risk (evidence staleness in F0-005's test inventory relative to current HEAD) recorded as R-072 in `RISK_REGISTER.md`. Full process/validation record: [evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md](../evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md).)

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

Detailed task IDs are assigned as each category is reached, in the order below, following its own dependency (F0-005 test inventory, this document's own "Open questions"). **F1-001, the first task, is assigned (2026-07-25, F0-014), delivered and `MERGED` (2026-07-28).** **F1-002, the evidence-refresh prerequisite, is assigned, delivered (`AGENT_COMPLETED`), and R-072 externally `CLOSED` (2026-07-28, F1-002-R2)** — see full definitions below. **F1-003, combining backlog items 2 and 3 below, is now assigned (2026-07-28, F1-002-R2), status `READY, not started`** — see full definition below. The remaining categories (4-7) remain high-level roadmap entries; none has a task ID yet, and none is invented by this update.

1. **Etki-bazlı test seçim mekanizması tasarımı ve kurulumu → F1-001 (`MERGED`)**
2. **PR / main / nightly / release CI katmanlarının kurulumu → part of F1-003 (assigned below, `READY, not started`)**
3. **Test veritabanı stratejisi (disposable Postgres standardı) → part of F1-003 (assigned below, `READY, not started`)**
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
| Status | `MERGED` (PR #241, merge commit `94cc4ac58f0487dd186886878c5628627f0b1ce3`, 2026-07-28T07:22:15Z; see [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) and [evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md](../evidence/F1-001_IMPACT_TEST_SELECTION_DESIGN_EVIDENCE.md). Verified `MERGED` by F1-002-R1 via `gh pr view 241`, 2026-07-28.) |
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
| Next-task dependency | F1-001 is now `MERGED` (see Status row). This precondition for the next F1 backlog category (PR / main / nightly / release CI katmanlarının kurulumu, backlog item 2) is satisfied. It is not yet unconditionally actionable — F1-002-R1's runtime-dependency findings (disposable Postgres/MinIO provisioning gaps, unscripted/chain-excluded tests) mean backlog item 3 ("Test veritabanı stratejisi") is a co-requisite, not a later, independent step. See F1-002's own "Next-task dependency" row below and `RISK_REGISTER.md` R-072 for the exact scope this implies. Its exact task ID is still assigned by that future task's own authorization, not invented here. |

### F1-002 — Test Inventory Refresh and Ownership Reconciliation

| Field | Value |
|---|---|
| Task ID | F1-002 |
| Title | Test Inventory Refresh and Ownership Reconciliation |
| Phase | F1 — CI and Test Architecture |
| Status | `AGENT_COMPLETED` (2026-07-28 — refreshed inventory/ownership/script-reconciliation delivered; updated 2026-07-28 by F1-002-R1 to integrate F1-002-P1/P2 parallel evidence and reconcile against `origin/main`; updated 2026-07-28 by F1-002-R2 to record R-072's external closure confirmation and correct PR #253's description; PR #253 open, not merged; see [F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](../evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md).) |
| Purpose | Remediate R-072 (F1-001's own discovered risk: `TEST_OWNERSHIP.md`/F0-005 test-inventory evidence pinned to 2026-07-19, stale relative to current `HEAD`). Enumerate every current backend/frontend test file, reconcile ownership/domain/test-type/runtime-requirements, reconcile every test-related package script, and identify script/inventory gaps — a documentation/evidence prerequisite for any future CI implementation of F1-001's design, not an implementation of that design itself. |
| Dependencies | F1-001 (`MERGED`, PR #241, `94cc4ac58f0487dd186886878c5628627f0b1ce3`; provides the classification taxonomy/domain vocabulary this task reuses). F1-002-P1 and F1-002-P2 (both `MERGED` — PR #255/`954168ed4399f572e776fbfd30fa391aad574610` and PR #254/`035d4db59cf429777a4bb71a5e72203f6c99b571` — parallel evidence subtasks integrated by F1-002-R1). |
| Allowed scope | Documentation/evidence only: `TEST_OWNERSHIP.md` refresh, new `evidence/F1-002_test_inventory.json`/`F1-002_test_script_reconciliation.json`/`F1-002_test_ownership_gaps.json`, tracker updates, `RISK_REGISTER.md` R-072 status update. |
| Prohibited scope | No test file, package script, CI workflow, application/runtime/schema/migration/deployment/environment file may be touched. No KVKK/tenant/consent/retention code path may be touched. No R-072 closure without evidence proving every exit condition is met; no self-declared `MERGED`. |
| Deliverables | [TEST_OWNERSHIP.md](../TEST_OWNERSHIP.md) (refreshed §3–§9), [evidence/F1-002_test_inventory.json](../evidence/F1-002_test_inventory.json) (137 targets, supersedes F0-005's 100 as current authoritative), [evidence/F1-002_test_script_reconciliation.json](../evidence/F1-002_test_script_reconciliation.json), [evidence/F1-002_test_ownership_gaps.json](../evidence/F1-002_test_ownership_gaps.json), [evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md](../evidence/F1-002_TEST_INVENTORY_REFRESH_AND_OWNERSHIP_RECONCILIATION.md), tracker updates. |
| Exact evidence required | Exact `find`/PowerShell-equivalent enumeration commands and their output counts; programmatic (not manual) package-script parsing; per-file ownership citation (header docblock, import, or carried-forward F0-005 record) — no invented/guessed ownership, `UNKNOWN` permitted and explicit where warranted (0 such cases were needed). |
| Validation requirements | `node -e "JSON.parse(...)"` on all three new JSON files; `git diff --check`; prohibited-path grep; status-consistency grep across `docs/program`. No documentation validator script exists in this repository (unchanged finding from every prior F0/F1 task). |
| Tenant/security/KVKK impact | None — no runtime/data-path change. The refreshed inventory preserves explicit coverage visibility for tenant isolation, org/clinic scope, auth/session/CSRF, role authorization, KVKK/privacy/consent, audit, financial, migrations/data integrity, webhooks/messaging, storage, AI, imaging, and official integrations (per `highRiskDimensions` on every relevant entry). |
| Rollback expectations | Single documentation-commit `git revert`. No DB/migration/deployment/CI rollback applicable. |
| Completion/status rules | This task may reach at most `AGENT_COMPLETED`. `MERGED` requires external review and an actual merged PR. **R-072 closure was externally confirmed 2026-07-28 (F1-002-R2) — `CLOSED`**, not unilaterally declared by any agent task — see `RISK_REGISTER.md`. |
| Next-task dependency | **Resolved 2026-07-28 (F1-002-R2): F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness is now assigned**, combining backlog items 2 ("PR / main / nightly / release CI katmanlarının kurulumu") and 3 ("Test veritabanı stratejisi (disposable Postgres standardı)") together, not item 2 alone — F1-002-P2's findings show CI-layer setup cannot be usefully sequenced ahead of a committed disposable-Postgres/MinIO provisioning mechanism, since 22+1 of 137 current targets cannot run in any CI today without one. See the F1-003 definition below for its exact scope. |

### F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness

| Field | Value |
|---|---|
| Task ID | F1-003 |
| Title | Baseline CI Test Execution and Disposable Runtime Readiness |
| Phase | F1 — CI and Test Architecture |
| Status | `READY, not started` (assigned 2026-07-28, F1-002-R2 — **assignment only, this task is not executed by F1-002-R2**). |
| Purpose | Combines backlog items 2 ("PR / main / nightly / release CI katmanlarının kurulumu") and 3 ("Test veritabanı stratejisi (disposable Postgres standardı)") into one task, per F1-002/F1-002-R1's own "Next-task dependency" finding that CI-layer setup cannot be usefully sequenced ahead of a committed disposable-runtime provisioning mechanism. Must close the gaps R-072's closure explicitly left open: the 8 unscripted backend test files and the 17 scripts excluded from the `server:test` aggregate chain; authoritative CI command coverage (only 7 of 116 JS/TS test files reached by any workflow as of F1-002-P1's evidence); a disposable-Postgres provisioning design/implementation (no committed script/Compose file exists — F1-002-P2 §8); the MinIO/S3-emulator test dependency (`fileBackupDbIntegration.test.ts`, zero provisioning exists); safe parallel-worktree/CI-run collision avoidance (no port/database-name isolation mechanism exists today); resolution or explicit tracking of the 1 remaining runtime `UNKNOWN` (`messagesConsentGate.test.ts`); and a default full-suite fail-safe for anything not yet classified. R-070 (migration-rollback tooling gap) is a related, not identical, dependency this task should reference, not silently absorb. |
| Dependencies | F1-001 (`MERGED`, PR #241) — classification taxonomy. F1-002/F1-002-P1/F1-002-P2 (all `AGENT_COMPLETED`/`MERGED`, PR #253/#255/#254) — current test inventory, script reachability, and runtime dependency evidence. R-072 `CLOSED` (2026-07-28, F1-002-R2) — the evidence-currency prerequisite this task's own scope depends on. |
| Allowed scope | Not yet started — full scope (CI workflow design/creation, disposable-Postgres/MinIO provisioning mechanism, collision-avoidance design) to be defined at execution time, within F1's own "Allowed work" above (CI workflow files may be modified in this phase, with external approval, per F0's KVKK-freeze exception). |
| Prohibited scope | Same as this phase's own "Prohibited work" above: no application behavior change outside approved testability DI seams; no work inside the still-active KVKK physical-architecture freeze boundary. No self-declared `MERGED`/`DEPLOYED` (an agent may reach at most `AGENT_COMPLETED`, per `NORAMEDI_MASTER_TRACKER.md` §2.3). |
| Deliverables | Not yet produced — this row records assignment only. |
| Completion/status rules | This task may reach at most `AGENT_COMPLETED` when executed. `MERGED` requires external review and an actual merged PR. This task's own eventual completion is what F1's exit gate below requires evidence of — assignment alone does not satisfy it. |
| Next-task dependency | Not yet determined — depends on this task's own execution and findings. |

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

- Etki-bazlı seçim mekanizmasının aracı (yol-bazlı mı, graph-bazlı mı) — F1-001 (2026-07-28) bu kararı bilinçli olarak gelecekteki bir implementasyon görevine erteledi (statik anlık görüntü ile canlı graph sorgusu arasındaki farklı bayatlama-hata modları nedeniyle); bkz. [F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md](../architecture/F1-001_IMPACT_BASED_TEST_SELECTION_ARCHITECTURE.md) §12 açık soru 1. Hâlâ açık, F1-002 tarafından da çözülmedi (F1-002'nin kapsamı test envanteri/sahiplik/script-erişilebilirliği yenilemesidir, bu mimari kararı değil).
- F1-001'in §7 madde 1'de belirttiği "implementasyon görevinin kendi taban çizgisine karşı yenilenmiş F0-005-eşdeğeri test envanteri" ön koşulu — **F1-002 tarafından karşılandı** (2026-07-28, taban çizgisi `08f2eaf82a205cf3f997c57e6a295fedd66b142d`, bkz. [F1-002_test_inventory.json](../evidence/F1-002_test_inventory.json)), F1-002-P1/P2 tarafından ayrıca derinleştirildi. F1-001'in §7'deki diğer 3 ön koşul hâlâ açık: path-vs-graph kararı, disposable-Postgres mekanizması (F1-002-P2 tarafından 10 soruluk bir değerlendirmeyle somutlaştırıldı, hâlâ implemente edilmedi — bkz. [F1-002-P2_disposable_environment_capabilities.json](../evidence/F1-002-P2_disposable_environment_capabilities.json)), CodeGraph durumu (F1-002-P1/P2'de de kullanılamadı, değişmedi). **F1-001'in kendi dış incelemesi/merge'i artık tamamlandı** (PR #241, `MERGED`, 2026-07-28T07:22:15Z) — bu madde artık açık değil.

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-07-25 | F0-014 | G0 `APPROVED_WITH_CONDITIONS` externally granted; entry conditions satisfied; faz durumu `TODO`→`IN_PROGRESS`; first concrete task F1-001 assigned (`READY`, not executed). |
| 2026-07-28 | F1-001 | Design delivered (`AGENT_COMPLETED`, PR opened, not merged): impact-based test-selection architecture, classification taxonomy, risk model, escalation/fail-safe rules, shadow-mode rollout, 17 scenarios. Resolves this document's own "Open question" (below) by deferring the static-vs-live-graph implementation choice to a future task, with rationale. New risk R-072 (test-inventory evidence staleness) recorded in `RISK_REGISTER.md`. Faz durumu remains `IN_PROGRESS`; exit gate NOT satisfied by this task. |
| 2026-07-28 | F1-002 | Test inventory refreshed and ownership reconciled (`AGENT_COMPLETED`, PR #253 opened, not merged): 137 test/verification targets inventoried (up from F0-005's 100), 0 UNKNOWN ownership, package scripts fully reconciled (0 stale references, 8 never-scripted backend files identified), R-072 closure proposed. Faz durumu remains `IN_PROGRESS`; exit gate NOT satisfied by this task; F1-003 not started. |
| 2026-07-28 | F1-001 (external) | PR #241 externally reviewed and `MERGED` (merge commit `94cc4ac58f0487dd186886878c5628627f0b1ce3`, 2026-07-28T07:22:15Z). |
| 2026-07-28 | F1-002-P1 (external) | PR #255 (Test Script Reachability and Runner Reconciliation) externally reviewed and `MERGED` (merge commit `954168ed4399f572e776fbfd30fa391aad574610`). |
| 2026-07-28 | F1-002-P2 (external) | PR #254 (Test Runtime Dependency and Disposable Environment Baseline) externally reviewed and `MERGED` (merge commit `035d4db59cf429777a4bb71a5e72203f6c99b571`). |
| 2026-07-28 | F1-002-R1 | Parallel Evidence Integration and Main Reconciliation: F1-002 branch (PR #253) merged with `origin/main` (`--no-ff`, no conflicts, evidence-only diff), F1-002-P1/P2 evidence indexed into `TEST_OWNERSHIP.md`, this document, and the tracker; count/script-chain/runtime-dependency vocabulary reconciled against P1/P2's independently-derived numbers (17, not the previously-stated 16, scripts excluded from the aggregate chain; frontend CI-uncovered corrected 7/9→6/9); stale "F1-001 not yet merged" statements corrected. Faz durumu remains `IN_PROGRESS`; exit gate NOT satisfied; R-072 remains `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, not `CLOSED`; F1-003 not started. |
| 2026-07-28 | F1-002-R2 | External R-072 Closure Recording and Final PR Metadata Correction: external architecture review (ChatGPT) + Mustafa Basol's merge decision granted closure confirmation for R-072 → `CLOSED` (closure date 2026-07-28, basis F1-002+P1+P2 evidence, narrow scope — 8 unscripted tests/17 chain-excluded scripts/7-of-116 CI coverage/disposable-Postgres+MinIO provisioning/collision avoidance/1 runtime UNKNOWN/unimplemented selector/R-070 all remain unresolved). **F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness assigned, `READY, not started`** (see full definition above). PR #253 description corrected (16→17 chain-excluded scripts figure, P1/P2 merged-and-integrated statement, R-072 CLOSED statement, no F1-complete/CI-readiness claim). Faz durumu remains `IN_PROGRESS`; exit gate NOT satisfied by this task. |

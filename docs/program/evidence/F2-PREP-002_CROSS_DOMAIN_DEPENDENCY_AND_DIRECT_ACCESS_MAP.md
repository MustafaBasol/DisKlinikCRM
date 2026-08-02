# F2-PREP-002 — Cross-Domain Dependency and Direct-Access Violation Map

**Phase:** F2 PREPARATION — Modular Monolith Boundary Definition
**Type:** READ-ONLY DEPENDENCY DISCOVERY + NEW EVIDENCE FILES ONLY
**Status:** AGENT_COMPLETED / PR_OPENED_AWAITING_REVIEW
**Do not merge. Do not deploy. Do not modify application code. Do not fix violations in this task.**

Machine-readable companion: [`F2-PREP-002_cross_domain_dependency_map.json`](F2-PREP-002_cross_domain_dependency_map.json) — every edge, direct-Prisma-access site, ownership-unknown item, contract candidate, transaction-boundary exception, and the top-20 remediation list referenced below carry stable IDs (`APT-*`, `PAT-*`, `MSG-*`, `BIL-*`, `IMG-*`, `INF-*`, `FE-*` for edges; `PZ-*` for direct Prisma access sites; `OU-*` for ownership-unknown; `F2-CC-*` for contract candidates; `TX-*` for transaction exceptions) so this narrative and the JSON stay cross-referenceable.

---

## 1. Baseline

```
git fetch origin main
git rev-parse origin/main   -> 70b1690c1a656c95cead7b42812cc9ae6447bfb7
git worktree add ../DisKlinikCRM-f2prep002 -b docs/f2-prep-002-cross-domain-dependency-map origin/main
```

- Branch: `docs/f2-prep-002-cross-domain-dependency-map`
- Base ref: `origin/main`
- Base SHA: `70b1690c1a656c95cead7b42812cc9ae6447bfb7` (merge of PR #275, external-calendar-outbound-sync-phase2)
- Worktree: fresh, isolated (`git worktree add`), sibling directory of the main working tree — no shared index/lock with any other in-flight task, consistent with parallel authorization alongside F1-003-B2, PR #268, and other F2-PREP tasks.

## 2. Related prior evidence (read, not modified)

This task builds on, and is careful not to duplicate or contradict, three existing tracker documents:

- [`docs/program/MODULE_MAP.md`](../MODULE_MAP.md) (F0-003) — the repo-evidenced 37-domain ownership map. This task reuses its domain-id vocabulary (`clinical-patients`, `messaging-whatsapp`, etc.) wherever an edge's source/target maps cleanly onto an F0-003 domain.
- [`docs/program/evidence/F0-003_module_ownership_inventory.json`](F0-003_module_ownership_inventory.json) — structural domain inventory.
- [`docs/program/DEPENDENCY_MAP.md`](../DEPENDENCY_MAP.md) and [`docs/program/evidence/F0-004_dependency_inventory.json`](F0-004_dependency_inventory.json) (F0-004) — the existing full 37×37 domain-to-domain dependency matrix (~800+ `F0004-Exxxx` edges) and 15 contract candidates (`CC-01`..`CC-15`).

**This task is deliberately narrower and deeper than F0-004, not a re-derivation of it.** F0-004 answers "which domains touch which, and how many times." F2-PREP-002 answers, for a targeted subset of the highest-risk domains: which exact route/service/job calls which exact Prisma model, at which file:line, with what tenant-scope mechanism, inside or outside which transaction boundary, gated by which authorization middleware — and what the resulting risk and remediation priority is. Several findings below explicitly corroborate and extend F0-004 contract candidates (e.g. `F2-CC-01` extends `CC-01`/`CC-02`; `F2-CC-05` extends `CC-12`); none contradict them. **`MODULE_MAP.md` and `DEPENDENCY_MAP.md` themselves were not modified** — only read.

## 3. Scope

Per the task brief, inspection was limited to:

- `server/src/routes`, `server/src/services`, `server/src/jobs`, `server/src/middleware`, `server/src/utils`
- No dedicated `server/src/integrations` directory exists in this codebase. Provider adapters live under `server/src/services/{whatsapp,instagram,externalCalendar,imaging,labOrders}` plus standalone files (`evolutionApi.ts`, `metaTemplateService.ts`, `googleAiStudio.ts`) — these were treated as the "provider adapter" targets.
- Frontend: `src/services/api.ts` (the single centralized API client), `src/hooks/`, and a spot-check across all 53 files in `src/pages/` for direct domain coupling.
- 99 Prisma models were in scope for direct-access-site discovery.

**CodeGraph** was not available as a tool in this environment. Equivalent coverage was obtained via **7 parallel read-only research passes** (one per domain cluster below), each of which read full source files — not just grep matches — and cross-referenced *outside* its own slice to find inbound edges from other domains. This is recorded here as a substitution for the requested CodeGraph tooling, not a silent scope reduction; see the JSON's `scope.codeGraphTool` field.

No repository-wide dump was performed. Trivial same-domain CRUD is grouped into single summary edges per the task's explicit instruction; every cross-domain, tenant-ambiguous, or transaction-integrity-relevant call site is itemized individually.

## 4. Domain slices audited

| Slice | Name | Related F0-003 domains |
|---|---|---|
| `APT` | Appointments & Scheduling | `clinical-appointments-availability`, `clinical-dental-chart-procedures`, `messaging-automation-recall-followup` |
| `PAT` | Patients, Privacy/KVKK, Platform Admin, Security, Audit | `clinical-patients`, `core-privacy-consent-retention-dsr`, `core-platform-administration`, `core-security-incident-detection`, `core-audit-activity` |
| `MSG` | Messaging & Communication Channels (WhatsApp/Instagram/SMS/AI agent) | `messaging-whatsapp`, `messaging-instagram`, `messaging-sms`, `messaging-ai-orchestration` |
| `BIL` | Billing, Treatment, Finance, Insurance, Compensation | `clinical-treatment-cases`, `clinical-basic-payments`, `finance-advanced-compensation`, `insurance` |
| `IMG` | Imaging, Attachments, Inventory, Labs, File Storage | `imaging-server-viewer`, `imaging-device-bridge`, `inventory`, `lab-prosthetics-tracking`, `core-storage-abstraction` |
| `INF` | External Calendar, Backup, Reporting/Dashboards/Org, Auth/Users/Settings (+ shared middleware/utils) | `reporting-analytics`, `core-observability-ops-events`, `core-identity-access`, `core-org-clinic-membership`, `core-notifications` |
| `FE` | Frontend (`src/`) → Backend coupling | cross-cutting; no separate frontend domain in F0-003 |

Full file lists per slice are in the JSON's `domainSlices` array.

## 5. Dependency counts

| Metric | Count |
|---|---|
| Total material edges classified | **124** |
| — SAME_DOMAIN_ALLOWED | 42 |
| — PUBLIC_CONTRACT_CANDIDATE | 17 |
| — TEMPORARY_DIRECT_ACCESS | 19 |
| — CROSS_DOMAIN_VIOLATION | 27 |
| — SHARED_INFRASTRUCTURE | 14 |
| — OWNERSHIP_UNKNOWN (edge-level) | 4 |
| — N/A (intentionally disabled route) | 1 |
| Edges by risk: Critical / High / Medium / Low | 11 / 14 / 34 / 65 |
| Direct Prisma access sites documented in detail | **25** |
| — migration priority Critical / High / Medium / Low | 8 / 7 / 9 / 1 |
| Ownership-unknown catalog entries (domain/model-level, broader than edge-level) | 16 |
| Contract candidates proposed | 20 |
| Transaction-boundary exceptions identified as legitimate and preserved | 10 |
| Top remediation items ranked | 20 |

All counts above were tallied programmatically from the JSON arrays (see `counts.methodologyNote` in the JSON for the exact derivation) so the two evidence files cannot drift out of sync with each other.

**Scope note on completeness:** these counts describe the material edges found in the 7 targeted domain clusters above, with trivial same-domain CRUD deliberately grouped rather than itemized (24 of the 42 `SAME_DOMAIN_ALLOWED` edges represent multiple grouped call sites each, not single lines). This is a targeted evidence-driven sample of the highest-risk cross-domain surface, not a claim of covering every one of the ~2,000+ `prisma.<model>` call sites in the codebase. For a full-codebase domain-to-domain matrix, see F0-004 (`~800+` edges at coarser, domain-level granularity — no file:line, no transaction/tenant-scope detail).

## 6. Headline findings

1. **A single tenant-isolation defect dominates the audit.** The legacy WhatsApp public API (`routes/whatsapp.ts` `/appointment-requests`, `/cancel-request`, `/services`, `/doctors`, `/availability`, `/appointment-lookup`) resolves "the current clinic" via `getDefaultClinic()` — literally the first clinic ever created in the entire multi-tenant database — gated by one shared secret used by every organization. Any caller holding that secret can create or cancel appointment requests, or read services/doctors/availability, for the **wrong organization's** default clinic. See `MSG-08` / `PZ-APT-06`, ranked #1 in the remediation list.
2. **Booking concurrency safety is inconsistently applied.** The codebase has a well-designed advisory-lock pattern (`appointmentAvailabilityService.ts` + `appointmentRequestSafety.ts`) used correctly by the staff-panel conversion flow, the public booking widget, and both AI messaging agents — but `routes/whatsappInbox.ts` and `routes/instagramInbox.ts`'s "create appointment from inbox" endpoints bypass it entirely with raw, unlocked `prisma.appointment.create` calls. This is the single highest-count finding across two research passes (`APT-19/20/21/22`, `MSG-05/06`).
3. **Financial multi-step writes are not transactional in three separate places**: payment-plan installment payoff (`BIL-08`), practitioner payout create *and* delete (`BIL-09`/`BIL-10`), and the treatment-case→inventory material-deduction path duplicated outside `treatmentStockDeduction.ts` (`BIL-03`/`BIL-04`). Each can leave the database in a silently-inconsistent state on partial failure.
4. **KVKK-critical patient anonymization is not atomic.** `services/privacy/patientAnonymization.ts` sets `isAnonymized: true` in its first of 12+ sequential writes across 10 tables, with no transaction wrapping and no partial-failure accounting for most of those tables (`PAT-08`).
5. **Messaging inbound processing is triplicated, not shared.** Three independent, drifting implementations (Evolution WhatsApp, Meta WhatsApp, Instagram) each write directly to `Patient`/`AppointmentRequest`/`Appointment`/`ContactRequest` — there is no `PatientDirectoryPort` or equivalent, only three copies of similar logic (`MSG-01/02/03`).
6. **One Prisma model serves two domains under two names.** `AppointmentType` is exposed as both `/services` (billing/treatment pricing catalog) and `/appointment-types` (scheduling duration) through the *same* route handlers — the single largest structural ownership blocker found (`BIL-17`, `OU-01`).
7. **Consent is legally the most sensitive field set in the schema and has no single writer.** `Patient.communicationConsent`/`marketingConsent`/`smsOptOut` are written directly by at least five domains (`PAT-13`, `OU-09`).
8. **Platform Admin has no service layer.** ~20 routes read/write `Organization`/`Clinic`/`User`/`Plan` directly with zero abstraction and zero read-audit-logging on PII-bearing reads (`PAT-07`).
9. **Not everything is a violation — several patterns are genuinely good and should be preserved as reference implementations**, not refactored away: the appointment-request conversion transaction (`TX-01`), the imaging bridge's public-but-tenant-safe token authentication (`IMG-01`/`PZ-IMG-01`), the AI-prompt redaction boundary (`MSG-11`), and the clinic-resolver priority chains for WhatsApp/Instagram tenant resolution (`MSG-16`).

## 7. Direct Prisma access — summary by domain

Full detail (file, function/line, model, read/write/delete, tenant-scope mechanism, transaction boundary, authorization boundary, migration priority, risk) is in the JSON's `directPrismaAccessSites` array (25 entries, IDs `PZ-*`). Per the task's instruction, not every `prisma.<model>` call in the codebase is catalogued at this depth — this set focuses on cross-domain, tenant-ambiguous, or transaction-integrity-relevant sites. Highlights by domain:

- **Appointments (`PZ-APT-*`, 7 sites):** the conversion-transaction path (`PZ-APT-03`) is the strongest-guarded write in the slice; the staff-panel `POST /appointments` (`PZ-APT-01`) and the two inbox "create appointment" endpoints (`PZ-APT-04`/`05`) and the legacy public API (`PZ-APT-06`) are the weak points.
- **Patients/Privacy/Platform (`PZ-PAT-*`, 5 sites):** the anonymization sweep (`PZ-PAT-02`) and the Platform Admin tenant-directory reach (`PZ-PAT-03`) are the two highest-priority items; the data-retention live-run (`PZ-PAT-04`) has strong mitigations but critical blast radius; `patients.ts`'s divergent scoping implementation (`PZ-PAT-01`) is a smaller but concrete drift risk.
- **Messaging (`PZ-MSG-*`, 3 sites):** the Evolution webhook's missing per-tenant signature (`PZ-MSG-02`) is the standout security gap; unauthenticated patient-record creation (`PZ-MSG-01`) is the standout architectural one.
- **Billing (`PZ-BIL-*`, 5 sites):** all three non-atomic multi-write sequences (installment payoff, payout create, payout delete) plus the duplicated/non-atomic inventory deduction are here.
- **Imaging/Inventory (`PZ-IMG-*`, 3 sites):** the bridge-agent token authentication (`PZ-IMG-01`) is flagged High priority for *record-keeping* only — it is currently correct and should stay that way; the inventory-transaction race (`PZ-IMG-02`) and the unverified backup/restore RBAC (`PZ-IMG-03`) are real gaps.
- **Reporting/Infra (`PZ-INF-*`, 2 sites):** the dashboard's 9-model read footprint (`PZ-INF-01`) and the non-atomic branch-creation write (`PZ-INF-02`).

## 8. Ownership-unknown catalog

16 domain/model ownership questions were surfaced that block a clean module boundary from being drawn until resolved (full detail: JSON `ownershipUnknown`, IDs `OU-01`..`OU-16`). The three most structurally significant:

- **`OU-01` — `Service`/`AppointmentType`**: one table, two domains, two route names, identical handlers. Must be resolved before Billing/Treatment and Scheduling can be split at all.
- **`OU-09` — Patient consent fields**: simultaneously "owned" by Patients (the column), Privacy (KVKK redaction target), and the dedicated Communication-Consent sub-system (KVKK-HIGH-007) — three plausible owners, no chosen one.
- **`OU-04` — `ContactRequest`**: messaging-adjacent but with its own reception-staff-facing CRUD API unrelated to any channel; resolving this flips several `OWNERSHIP_UNKNOWN` messaging edges to `CROSS_DOMAIN_VIOLATION` if the answer is "not Messaging's."

## 9. Contract candidates

20 contract candidates are proposed (JSON `contractCandidates`, IDs `F2-CC-01`..`F2-CC-20`), each naming a shape only (no implementation), the edges it would replace, and — where applicable — the existing F0-004 `CC-*` candidate it corroborates or extends. Highest-value by number of Critical/High findings resolved:

| ID | Name | Resolves |
|---|---|---|
| `F2-CC-03` | `AppointmentRequestIntakePort.create()` | The inbox-bypass double-booking race (5 edges, 2 Critical) |
| `F2-CC-02` | `AppointmentBookingPort` (request/cancel) | The legacy public-API tenant-isolation defect + phone-based cancellation |
| `F2-CC-10` | `PaymentPlanInstallmentSettlementService.payInstallment()` | Non-atomic installment payoff |
| `F2-CC-11` | `PractitionerPayoutService.create()/delete()` | Non-atomic payout create/delete, both directions |
| `F2-CC-08` | `InventoryStockDeductionPort.deduct(...)` | Duplicated/non-atomic Treatment→Inventory writes (5 edges) |
| `F2-CC-05` | `ConsentEvidenceWriter.setConsent(...)` | 5-domain direct writes to Patient consent fields; extends F0-004 `CC-12` |
| `F2-CC-01` | `PatientDirectoryPort.findOrCreateByPhone(...)` | Triplicated inbound patient-creation logic; extends F0-004 `CC-01`/`CC-02` |
| `F2-CC-06` | `TenantAdminDirectoryPort` + `TenantAdminCommandPort` | Platform Admin's ~20 direct-Prisma routes |
| `F2-CC-09` | `ServiceCatalogReader` / `ServiceCatalog` bounded context | The `Service`/`AppointmentType` dual-identity table |
| `F2-CC-07` | `RetentionExecutionPort` (per domain) | Cross-tenant retention job's coupling to Messaging tables |

The remaining 10 (`F2-CC-04`, `F2-CC-12`–`F2-CC-20`) are documented in the JSON; most are Medium/Low priority read-model contracts (reporting revenue readers, balance readers, audit readers) rather than write-safety fixes.

## 10. Transaction-boundary exceptions (preserve, do not "fix")

Per the task's instruction not to automatically flag every cross-model transaction as invalid, 10 legitimate atomic multi-model transactions were identified and are explicitly recorded as **reference patterns to preserve** (JSON `transactionBoundaryExceptions`, IDs `TX-01`..`TX-10`): the appointment-request conversion flow, appointment-completion→treatment-case creation, treatment-plan-procedure→stock-deduction, the bulk-export download-claim flow, treatment-package definition/application, the imaging bridge's study-ingest and pairing-code redemption, the auth password-reset/email-verification token flows, the organization-branch user-clinic assignment, imaging device/bridge-agent deletion, and lab-order status transitions. None of these should be touched by any future F2 remediation work — they are the standard the non-atomic sites (§6, item 3) should be brought up to.

## 11. Risk priority — top 20 remediation list (not implemented)

Ranked by risk, full detail with edge-ID cross-references and proposed contract in JSON `top20Remediation`. Do not implement — this is a priority list for a future phase.

| # | Risk | Finding |
|---|---|---|
| 1 | Critical | Legacy WhatsApp public API resolves tenant via `getDefaultClinic()` — cross-tenant write/read |
| 2 | Critical | Payment-plan installment payoff not transactional |
| 3 | Critical | Practitioner payout create/delete not transactional (both directions) |
| 4 | Critical | WhatsApp/Instagram inbox "create appointment" bypasses the advisory-lock booking path |
| 5 | Critical | Patient anonymization (KVKK) not atomic across 10 tables |
| 6 | Critical | Evolution WhatsApp webhook has no per-tenant HMAC signature |
| 7 | Critical | Platform-Admin-triggered data-retention job — unscoped cross-tenant bulk delete, no Messaging-owned executor |
| 8 | Critical | `backupService.ts` whole-DB restore capability — calling route's RBAC unverified in this pass |
| 9 | High | Three independently-implemented, drifting inbound message processors write directly to Patient/Appointment/ContactRequest |
| 10 | High | `treatmentCases.ts` duplicates `treatmentStockDeduction.ts`'s inventory logic, without its safety guarantees |
| 11 | High | `treatmentStockDeduction.ts` (Treatment domain) writes directly into Inventory's ledger |
| 12 | High | `Service`/`AppointmentType` dual-identity table blocks a Billing/Scheduling split |
| 13 | High | Platform Admin: ~20 routes, zero service layer, zero read-audit-logging |
| 14 | High | Patient consent fields written directly by 5+ domains, no shared writer |
| 15 | High | `patients.ts` GET/PUT `/:id` uses a second, divergent tenant-scoping implementation |
| 16 | High | `inventory.ts` `POST /transactions` — read-modify-write race on stock count |
| 17 | Medium | `organizationBranches.ts` branch-creation write not transactional |
| 18 | Medium | 4 independent re-derivations of revenue/open-treatment stats across dashboards |
| 19 | Medium | `messages.ts` duplicates `treatmentCases.ts`'s remaining-balance calculation |
| 20 | Medium | Inconsistent stock-deduction "undo" semantics between two delete paths |

## 12. Validation

```
git status --short          # exactly 2 new, untracked files under docs/program/evidence/
git diff --check            # (no unstaged changes to check pre-commit; see commit step)
git diff --stat --cached    # after staging: 2 files changed, insertions only
git diff --name-only --cached
```

Results recorded in the final report delivered alongside this PR. No shared tracker/index/phase file (`MODULE_MAP.md`, `DEPENDENCY_MAP.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, etc.) was modified. No application code, test, schema, migration, or workflow file was modified. Only the two files listed in §13 were created.

## 13. Output files

- `docs/program/evidence/F2-PREP-002_CROSS_DOMAIN_DEPENDENCY_AND_DIRECT_ACCESS_MAP.md` (this file)
- `docs/program/evidence/F2-PREP-002_cross_domain_dependency_map.json` (machine-readable companion)

## 14. Explicit non-scope

Per the task brief, this evidence pass did **not**: fix any violation, implement any contract, move any file, change any Prisma schema/migration, change any test, change any CI/CD workflow, or modify any shared tracker/index/phase document. All 124 edges, 25 direct-access sites, 16 ownership questions, 20 contract candidates, and 20 remediation items above are findings for a future F2 execution phase to act on, not changes made in this task.

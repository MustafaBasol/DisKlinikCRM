# F2-GUARDRAIL-PREP-010-A — Cross-Domain Access Inventory and Legacy Allowlist Evidence

**Phase:** F2 — Modular Monolith Guardrails
**Type:** EVIDENCE-ONLY. No runtime, CI, package-script, schema, or migration change. No shared program-control file touched.
**Status:** AGENT_COMPLETED / EVIDENCE_VALIDATED / PR_OPENED_AWAITING_PARALLEL_WAVE_CONSOLIDATION

Machine-readable companion: [`F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json`](F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json) — every edge (`CDA-*`), security finding (`SEC-*`), and boundary-ownership disagreement (`BOD-*`) below carries a stable ID cross-referenceable between this narrative and the JSON.

**Parallel-wave note:** this task runs alongside `F2-IMPL-001-A-R2`, `F2-GUARDRAIL-PREP-010-B`, and `F2-GUARDRAIL-PREP-010-C`. Per explicit instruction, this task does **not** edit `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, or `evidence/README.md` — a later consolidation task updates those. This task creates only the two uniquely named files listed above.

---

## 1. Purpose

Create an authoritative, machine-readable inventory of current direct cross-domain access so a later enforcement task (dependency-cruiser or equivalent) can block **only new** boundary violations without breaking accepted legacy behavior. This is evidence-only — no runtime code, CI, package script, or schema/migration file is changed by this task, and no enforcement is implemented here.

## 2. Pre-edit gate

- Read `AGENTS.md`, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md` (F2-PREP-006-E entry in full), `phases/F2_MODULAR_BOUNDARIES.md`, `MODULE_MAP.md`, `DEPENDENCY_MAP.md`, `evidence/F2-PREP-002_CROSS_DOMAIN_DEPENDENCY_AND_DIRECT_ACCESS_MAP.md` + its JSON in full, and `architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md`.
- `git fetch origin --prune` → `origin/main` = `6f539b237019945443afe6156f9fc2a9fe32ffa4`.
- `git status --short` on the primary working tree showed pre-existing, unrelated in-progress work on branch `claude/treatment-proposal-pdf-p1-d4k0jl` — left untouched.
- `grep -rl "F2-GUARDRAIL-PREP-010-A" docs/` returned no results before this task authored its own files — confirmed no pre-existing task with this exact ID.
- Fresh isolated worktree created via `git worktree add -b docs/f2-guardrail-prep-010-a-cross-domain-inventory origin/main`, sibling of the primary tree, no other in-flight worktree reused.

## 3. Scope and CodeGraph substitution

CodeGraph tooling is not available in this environment (the same limitation F2-PREP-002 recorded). Per instruction, this task did **not** perform a whole-project scan. Instead, targeted coverage over the required roots (`server/src/routes`, `services`, `jobs`, `middleware`, `utils`) was obtained by:

1. Reading F2-PREP-002's full repository-evidenced catalogue (124 edges, 25 direct-Prisma-access sites, 16 ownership-unknown items, 20 contract candidates, 10 transaction-boundary exceptions) — itself produced by 7 parallel domain-cluster research passes over these exact roots.
2. Re-deriving domain ownership per edge from `MODULE_MAP.md`/F2-PREP-001's 38-domain inventory, rather than trusting the prior task's research-organization grouping (this surfaced one real naming-collision correction — §7 below).
3. A targeted grep + full-file-read re-verification sample covering every domain pair represented in the inventory, run directly against this task's own `origin/main` baseline (see §6).

Frontend (`src/`) is **out of scope** — this task's CODEGRAPH roots are backend-only, unlike F2-PREP-002 which additionally scoped `src/services/api.ts`/`src/pages/*`. Frontend consuming a domain's own public HTTP API is not a backend module-boundary concern in the F2 modular-monolith sense.

## 4. Domain ownership source

`docs/program/MODULE_MAP.md` (F0-003, repository-evidence-verified) as amended by F2-PREP-001's 38-domain inventory, **not** inferred from folder names alone. Every case where physical file location, logical/model ownership, or an accepted future boundary disagree is recorded explicitly in §7 (`BOD-*`) rather than resolved silently.

## 5. Inventory definition and classification method

A cross-domain edge is code owned by one domain importing another domain's internal service, directly querying another domain's Prisma-owned model, mutating another domain's data, using another domain's internal repository/helper, bypassing an accepted contract, or directly accessing another domain's storage/provider internals.

This task re-classifies F2-PREP-002's edge catalogue into exactly the six required values. Full decision rule is in the JSON's `classificationDecisionRule[]`; summarized:

1. **Exclude** same-owning-domain findings (several of F2-PREP-002's "violations" turn out to be same-domain transaction-integrity defects mislabeled for cross-domain purposes — see `excludedSameDomainFindings[]`, e.g. `BIL-08/09/10` are entirely within `clinical-basic-payments`/`finance-advanced-compensation`), planned/not-implemented targets, and frontend edges.
2. **ACCEPTED_PUBLIC_CONTRACT / ACCEPTED_RESTRICTED_CONTRACT** — the target is a real, existing, intentionally shared contract (a named utility/service other domains are meant to call, or a blessed atomic transaction/public HTTP boundary), not raw direct access.
3. **UNRESOLVED_OWNERSHIP** — an F2-PREP-002 `OU-*` ownership question blocks classification outright.
4. **VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX** — a presently exploitable tenant-isolation or authorization defect, overriding all other rules.
5. **PROHIBITED_NEW_PATTERN** — raw direct access, Critical/High risk, no formal contract: tolerated today so CI does not break, but explicitly **not** blessed; flagged for urgent, separately-tracked remediation.
6. **LEGACY_ALLOWLISTED_DIRECT_ACCESS** — raw direct access, Medium/Low risk: accepted to remain as-is, allowlisted without an urgency flag.

This risk-tier threshold (rule 5 vs. 6) is this task's own synthesis, designed to satisfy "do not silently classify uncertain edges as accepted" — see `limitations[]` in the JSON; a later consolidation task should confirm or adjust it explicitly.

## 6. Targeted re-verification sample

Every domain pair represented in the inventory was sampled and re-checked directly against current source in this task's own worktree (full detail: JSON `verificationSample[]`). Highlights:

- **TRC→INV** (`treatmentStockDeduction.ts`, `treatmentCases.ts`): confirmed unchanged despite the intervening inventory-unit-conversion feature (`inventoryUnitConversion.ts`, merged after F2-PREP-002's baseline) — new `quantityInBaseUnit`/`unitId` fields were added to the `InventoryTransaction.create()` payload, but the cross-domain write pattern itself is identical.
- **WHA→APT tenant isolation** (`whatsapp.ts` `getDefaultClinic()`): confirmed still present, still called by the same 6 legacy endpoint handlers. See §8 (security stop condition).
- **BRG(device)→IMG/BRG** (`imagingBridgePublic.ts` `authenticateBridgeAgent()`): confirmed `clinicId` is still taken exclusively from the token-matched agent row, never client input.
- **PAD→ORG** (`platformAdmin.ts`): confirmed ~20 direct `Organization`/`Clinic`/`User` accesses, no service layer.
- **PRV→PAT anonymization atomicity** (`patientAnonymization.ts`): confirmed still no `$transaction` wrapping the 12+-step redaction sequence.
- **RPT→multiple** (`dashboard.ts`): confirmed 10 distinct cross-domain Prisma models queried directly.
- **PAD→STG/OS backup** (`backupService.ts` via `platformAdmin.ts`): **new finding**, resolves a prior open question — see §9.

## 7. Boundary ownership disagreements

Recorded explicitly per instruction rather than resolved silently (full detail: JSON `boundaryOwnershipDisagreements[]`, `BOD-01`..`BOD-06`):

| ID | Subject | Status |
|---|---|---|
| `BOD-01` | `Service`/`AppointmentType` — one Prisma model, two domains (Billing/Treatment pricing vs. Scheduling duration), identical route handlers | UNRESOLVED |
| `BOD-02` | `DoctorAvailability`/`DoctorOffDay` — write path in Users/Staff, primary consumer is Appointments | UNRESOLVED |
| `BOD-03` | `ContactRequest` — messaging-adjacent but with its own reception-staff CRUD API | UNRESOLVED (independently corroborated by F2-PREP-001, not resolved) |
| `BOD-04` | `ClinicLegalProfile` — KVKK content, CRUD'd like ordinary clinic-admin settings | UNRESOLVED |
| `BOD-05` | Notifications-as-Imaging-caller naming collision | **RESOLVED by F2-PREP-006-E, inherited here** — F2-PREP-002's `IMG-09` groups Notifications' read of `LabWorkOrder` (a Labs-domain model) under its "IMG" research-slice label. This is **not** the same edge as "Notifications calling into Imaging," which F2-PREP-006-E already confirmed does not exist (zero references to any Imaging-owned model in `routes/notifications.ts`). This task carries the correction forward so it is not re-confused in a future pass. |
| `BOD-06` | `Patient.communicationConsent`/`marketingConsent`/`smsOptOut` — three plausible owners (Patients/Privacy/Communication-Consent sub-domain), none chosen | UNRESOLVED |

## 8. Security stop condition

Per instruction, no defect below is fixed by this task.

**`SEC-01` (`VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX`, edge `CDA-022`):** `server/src/routes/whatsapp.ts`'s `getDefaultClinic()` (line 1089, `prisma.clinic.findFirst({orderBy:{createdAt:'asc'}})`) resolves "the current clinic" for 6 legacy public endpoints (`POST /appointment-requests`, `POST /cancel-request`, `GET /services`, `/doctors`, `/availability`, `/appointment-lookup`) as the single first-ever-created clinic in the **entire** database, gated only by one static shared secret (`authorizeWhatsappApi`) valid for every organization. **Exploit precondition:** possession of the shared `WHATSAPP_WEBHOOK_SECRET` — no target-organization-specific knowledge is needed. **Impact:** cross-tenant creation/cancellation of appointment requests and reads of services/doctors/availability data against the wrong organization's clinic. Re-confirmed present against this task's own baseline (§6). **Recommendation:** a dedicated, separately-authorized remediation task (proposed `F2-SEC-001`) — not fixed here.

**`SEC-02`** (same-domain, included for completeness per the stop condition, not counted in classification totals): the Evolution WhatsApp webhook's connection resolution has no per-tenant HMAC signature (unlike its Meta/Instagram siblings in the same file), carried forward from F2-PREP-002 without independent re-verification in this pass.

**`SEC-03-RESOLVED`:** this task **resolves**, rather than adds, a prior open question. F2-PREP-002 rated `backupService.ts`'s whole-database restore capability `UNVERIFIED_INFERENCE` because it could not locate the calling route. This task found it: `platformAdmin.ts` lines 1576-1609, which inherit `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` from line 152. The authorization boundary is now **confirmed**, not unverified — this does not meet the "presently exploitable" bar. See edge `CDA-014` (classified `ACCEPTED_RESTRICTED_CONTRACT`, with a non-blocking hardening recommendation carried forward: step-up auth + structured audit row for this specific high-blast-radius action).

## 9. Classification counts

| Classification | Count |
|---|---|
| `ACCEPTED_PUBLIC_CONTRACT` | 7 |
| `ACCEPTED_RESTRICTED_CONTRACT` | 7 |
| `UNRESOLVED_OWNERSHIP` | 5 |
| `VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX` | 1 |
| `PROHIBITED_NEW_PATTERN` | 10 |
| `LEGACY_ALLOWLISTED_DIRECT_ACCESS` | 36 |
| **Total in-scope cross-domain edges** | **66** |

Plus: 1 same-domain security finding noted for completeness (`SEC-02`, not counted above), 1 resolved-not-a-defect finding (`SEC-03-RESOLVED`), and 12 same-domain findings explicitly excluded from the cross-domain scope (`excludedSameDomainFindings[]`).

### 9.1 Accepted contracts (14 total)

`ACCEPTED_PUBLIC_CONTRACT` (broadly callable, real existing shared modules): `utils/auditLog.ts`, `services/security/securitySignalService.ts`, `utils/clinicScope.ts`→security telemetry, the channel-abstraction messaging services, the communication-consent gate, the AI-prompt redaction boundary (`services/privacy/redaction.ts`), and `utils/relationGuards.ts` (used identically by imaging/attachments/labOrders).

`ACCEPTED_RESTRICTED_CONTRACT` (narrowly gated to one caller or transaction context): the imaging bridge's token-authenticated public API (ratified by F2-PREP-006-E), `services/fileStorage.ts` (implicit, unenforced tenant-prefix convention — flagged for future hardening), the appointment-completion→TreatmentCase transaction (`TX-02`), the appointment-request-conversion→Patient-creation transaction (`TX-01`), the External-Calendar outbound-sync seam (`INF-05`), the one-time clinic-registration genesis transaction, and the now-RBAC-confirmed backup/restore-test capability (`CDA-014`).

### 9.2 Legacy allowlist (36 entries)

Medium/Low-risk direct access with no formal contract yet — the bulk of the inventory (reporting/dashboard cross-domain reads, KVKK compliance readers, external-calendar reads, messaging/task/notification cross-reads, etc.). Full detail in JSON `edges[]` where `classification == "LEGACY_ALLOWLISTED_DIRECT_ACCESS"`.

### 9.3 Prohibited new patterns (10 entries)

Critical/High-risk existing violations, tolerated today but explicitly not blessed: the WhatsApp/Instagram inbox appointment-booking-lock bypasses (2 entries, Critical/High), Platform Admin's ~20-route direct tenant-directory access (High), patient anonymization's non-atomic 10-table redaction (Critical), the retention job's cross-tenant sweep coupling (Critical), Patient-consent-field multi-writer (High), the triplicated inbound-patient-creation logic (High), `treatmentCases.ts`'s duplicated non-atomic inventory writes (High), `treatmentStockDeduction.ts`'s direct inventory-ledger writes (High), and `dashboard.ts`'s 10-model read footprint (High).

### 9.4 Unresolved ownership (5 entries)

`DoctorAvailability`/`DoctorOffDay`, `ContactRequest`, `evolutionApi.ts` (dead code), `ClinicLegalProfile`, and `Service`/`AppointmentType` — see §7.

## 10. Proposed allowlist schema

Full schema: JSON `proposedAllowlistSchema`. Summary: a structural (never line-number-based) record of `{callerPathGlob, ownerDomain, targetModelOrSymbol, accessKind, justificationEvidenceId, expiryOrRemovalTask}`. Enforcement intent (not implemented by this task): allow existing entries and more-of-the-same-pattern call sites within an allowlisted `(caller, owner, target, accessKind)` tuple; fail the build on any new tuple not already present, regardless of classification; print a non-suppressible warning banner (not a silent pass) whenever a changed file touches a `PROHIBITED_NEW_PATTERN` or `VERIFIED_SECURITY_DEFECT_REQUIRES_SEPARATE_FIX` entry, naming the linked remediation task.

## 11. Limitations

- Re-classification of F2-PREP-002's catalogue (baseline `70b1690c`) re-verified via a targeted sample, not a full independent re-scan of every `prisma.<model>` call site — the same caveat F2-PREP-002 itself carries from F0-004.
- The repository advanced 40+ commits between F2-PREP-002's baseline and this task's (`6f539b23`); only `verificationSample[]` edges were re-confirmed by direct source read.
- F2-PREP-006-A..D's full Imaging/Bridge contract catalogue (20 commands/14 queries/32 tests) was read at the F2-PREP-006-E consolidation-summary level only, not the full source-document level.
- Frontend cross-domain coupling (F2-PREP-002's `FE-01`..`FE-07`) is out of scope per this task's backend-only CODEGRAPH roots.
- Same-domain transaction-integrity defects are explicitly excluded from this cross-domain allowlist (see `excludedSameDomainFindings[]`) — they remain real, tracked findings, just not module-boundary edges.
- No CI enforcement, lint rule, or dependency-cruiser configuration is implemented here — `proposedAllowlistSchema` is a design only.

## 12. Next enforcement dependencies

1. External sign-off on this task's own risk-tier classification-decision rule (a synthesis, not pre-approved by any ADR).
2. Consolidation with sibling parallel-wave tasks `F2-GUARDRAIL-PREP-010-B`/`-C` (not read by this task, per isolation instruction) before any shared program-control document is updated.
3. Resolution of the 5 `UNRESOLVED_OWNERSHIP` edges before a boundary-lint rule can assign them a definitive key.
4. A dedicated remediation task (proposed `F2-SEC-001`) for `SEC-01` — recommended before or alongside first CI enforcement rollout.
5. Report-only dependency-cruiser (or equivalent), scoped first to the domain pairs carrying the most `PROHIBITED_NEW_PATTERN` entries.
6. Re-verification of `CDA-008`/`CDA-048` (Imaging/Bridge) against F2-PREP-006's characterization-test evidence once that lands.

## 13. Validation

```
git diff --check                      # clean, no whitespace errors
node -e "JSON.parse(...)"             # JSON parses cleanly
duplicate edge-ID check                # 0 duplicates across 66 CDA-* ids
every Markdown edge cross-referenced   # all classification-count rows trace to JSON edges[]
every JSON edge represented in Markdown# summarized by classification in §9, full detail in JSON
classification counts                  # computed directly from JSON edges[], match declared classificationCounts exactly (verified via node script)
git status --short                     # only the 2 new evidence files created; no runtime/schema/workflow/package/shared-program-control file touched
```

## 14. Output files

- `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_CROSS_DOMAIN_ACCESS_INVENTORY.md` (this file)
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (machine-readable companion)

## 15. Explicit non-scope

This task did **not**: fix `SEC-01`/`SEC-02`, implement any contract, move any file, change any Prisma schema/migration, change any test, change any CI/CD workflow, or modify any shared tracker/index/phase document. All 66 cross-domain edges, 5 unresolved-ownership items, 1 verified security defect, and the proposed allowlist schema above are evidence and design for a future enforcement task, not changes made here.

## 16. Next task

**Await:** parallel-wave siblings `F2-GUARDRAIL-PREP-010-B`/`-C` and external review of this task's classification-decision rule.

**Then:** a consolidation task reconciles all three `F2-GUARDRAIL-PREP-010-*` evidence sets into the shared program-control documents, and a dedicated `F2-SEC-001` task addresses `SEC-01` before CI enforcement is implemented against this allowlist.

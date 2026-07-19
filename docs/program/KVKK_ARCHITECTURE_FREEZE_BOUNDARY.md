# KVKK_ARCHITECTURE_FREEZE_BOUNDARY — F0-007 Freeze Boundary Matrix

Source task: F0-007. Baseline commit: `origin/main` @ `91276dc7f610ef6923e3c1a7572f0ebba578a2f7`.
Companion documents: [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md), [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md).

> **Correction note (2026-07-19, correction pass on PR #174):** "uncommitted" below described the KVKK-HIGH-007 continuation's status only at this task's original start. By this task's own finish the primary tree was already clean on a local branch, and as of this correction pass GitHub shows an open PR for it ([#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175)). This does not change any freeze determination — the continuation's content remains uninspected and `UNVERIFIED_ACTIVE_WORK`, and none of §5's numbered exit conditions are satisfied by a PR merely being open (condition 2 requires `MERGED`). See [KVKK_ACTIVE_WORK_BASELINE.md](KVKK_ACTIVE_WORK_BASELINE.md) §7 and [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1 for the corrected, time-sliced record.

This document defines which architectural areas are frozen, why, and what unblocks them. It extends — does not replace — the freeze rules already recorded in [NORAMEDI_MASTER_TRACKER.md §8](NORAMEDI_MASTER_TRACKER.md#8-blocked-tasks-bloklu-i̇şler), [phases/F0_BASELINE_AND_VALIDATION.md](phases/F0_BASELINE_AND_VALIDATION.md), and [CURRENT_PHASE.md](CURRENT_PHASE.md).

---

## 1. What moved since the freeze rules were first written

The original freeze rationale (F0-001/F0-002) pointed at KVKK-CRIT-003 (PR #167, then open) as the active-work driver. GitHub verification in this task shows PR #167 is now `MERGED`, and PR #169 (KVKK-HIGH-007 base) is also `MERGED` and deployed (see baseline doc §1/§6). **The freeze boundary's active driver is now exclusively the KVKK-HIGH-007 continuation (consent reconciliation)** — observed as uncommitted path metadata in the primary working tree at this task's start, now the subject of an open PR ([#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175)) as of this correction pass, content still uninspected either way — there is no other open KVKK PR or unresolved external-review gate. This narrows, but does not remove, the freeze: the continuation touches Prisma schema/migrations, consent enforcement policy, retention, messaging, WhatsApp, SMS, recall, and audit — the same high-blast-radius areas the original freeze rules were written to protect.

## 2. Freeze-boundary matrix

| # | Area/domain | Current stable baseline | Active KVKK work | Evidence source | Mutability | Allowed parallel work | Prohibited parallel work | Conflict risk | Exit condition |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Prisma privacy/consent schema | 90 models @ `91276dc` incl. `ChannelConsentLog`, `PatientCommunicationPreference`, `PatientCommunicationConsentEvent` (PR #169, merged) | New migration `20260719120821_kvkk_high007_consent_reconciliation` (uncommitted at this task's start; now the subject of open PR #175 as of this correction pass — content still not inspected either way) | evidence §3/§4/§1.1 | MUTABLE (not yet merged) | schema-change **design** docs, ADR-002/005 drafting | any physical schema edit, RLS/tenant-extension work touching consent tables | HIGH — concurrent schema edits could produce migration conflicts or divergent model shape | continuation branch committed + PR opened (now satisfied — PR #175) + external merge decision (not yet satisfied) |
| 2 | `CommunicationPreference`/consent models | `MERGED`/deployed (PR #169) | reconciliation logic reads/writes same tables (path metadata only) | evidence §3 | PARTIALLY MUTABLE (base stable, extension active) | read-only analysis of merged base | relocating/renaming the merged models | MEDIUM | continuation merged or explicitly abandoned |
| 3 | Consent enforcement policy | `communicationConsentPolicy.ts`/`enforcementConfig.ts` merged (PR #169), enforcement flag ships disabled | both files under active uncommitted edit | evidence §3 | MUTABLE | none (behavior unverified) | any change to enforcement semantics from outside the active branch | HIGH — two writers to the same policy file | continuation merged |
| 4 | Consent reconciliation/backfill | `backfillCommunicationPreferences.ts` merged as PR #169's original backfill; active work modifies it further; new `legacyReconciliationResolver.ts` untracked | active | evidence §3 | MUTABLE | none | any parallel backfill/reconciliation design assumed as fact | HIGH — reconciliation of legacy `smsOptOut` data is exactly the kind of one-shot data operation that cannot safely run twice with diverging logic | continuation merged + backfill run verified |
| 5 | Consent audit logging/reporting | none in stable baseline (new capability) | new untracked `communicationConsentAuditLogging.ts`, `communicationConsentAuditReport.ts`, `communicationConsentConflictTracker.ts` + 2 new report tests | evidence §3 | MUTABLE (net-new) | audit-log **design** review (ADR-012) | assuming these files' existence/shape as an accepted audit contract | MEDIUM | continuation merged |
| 6 | Retention policy and cleanup jobs | `dataRetentionPolicy.ts` explicitly excludes medical/financial records (compliance doc §6, KVKK-HIGH-003 still `Waiting for legal review`) | `dataRetentionCleanupJob.ts` + its own test file both under active edit | evidence §3 | MUTABLE | retention **design** discussion (ADR-013) | any retention-model relocation or cleanup-job scope change outside the active branch | HIGH — retention job acting on consent/audit rows mid-transition is an explicit HIGH risk (see RISK_REGISTER R-041) | continuation merged + retention job behavior independently verified |
| 7 | OperationalEvent | `MERGED`, clearly-bounded domain (MODULE_MAP.md) | `operationalEventService.ts` under active edit | evidence §3 | MUTABLE | none | OperationalEvent contract changes outside the active branch | MEDIUM | continuation merged |
| 8 | Messaging routes | `messages.ts` merged baseline | active edit + new untracked `messagesConsentGate.test.ts` (implies a consent gate is being added to message sending) | evidence §3 | MUTABLE | none | assuming messages.ts currently consent-gates all sends (DEPENDENCY_MAP §10.3 already flags 9 `X` high-risk WhatsApp/Instagram→Patient/Appointment direct-write violations unrelated to this gate) | HIGH — cross-domain messaging bypassing the consent public contract mid-implementation (RISK_REGISTER R-044) | continuation merged + gate behavior verified across all channels |
| 9 | WhatsApp purpose mapping | none in stable baseline (net-new) | new untracked `whatsappCommunicationPurposeMap.ts` | evidence §3 | MUTABLE (net-new) | none | assuming WhatsApp already enforces per-purpose consent (DEPENDENCY_MAP §10.3: WHA has 106 fan-out edges, "god module" signature; F0-004 evidence documents 9 X-severity boundary violations from WHA/IGM into PAT/APT) | HIGH — WhatsApp is the domain with the most severe pre-existing boundary violations; adding consent-purpose logic here concurrently with architecture review compounds risk | continuation merged + WhatsApp send paths independently verified against the new purpose map |
| 10 | SMS sending | `smsService.ts` merged baseline, `ClinicSmsSettings.addonEnabled` is the cleanest existing entitlement example (MODULE_MAP.md) | active edit | evidence §3 | MUTABLE | none | assuming current SMS consent behavior without re-verification | MEDIUM | continuation merged |
| 11 | Recall candidate generation | `recallCandidateService.ts` merged baseline | active edit + new untracked `recallConsentGate.test.ts` | evidence §3 | MUTABLE | none | assuming recall already gates on consent | MEDIUM | continuation merged |
| 12 | Patient privacy/anonymization | `routes/patientPrivacy.ts`, `services/privacy/*` merged and stable (not in the active-path list) | none observed directly, but retention/consent changes are adjacent (Privacy↔WhatsApp is F0-004's most-cited two-domain cycle) | evidence §3; DEPENDENCY_MAP §10.3 | STABLE (not in active-path list) | full design/ADR/documentation work | anonymization workflow restructuring (already frozen program-wide, tracker §8 item 9) | MEDIUM (indirect, via retention/consent coupling) | KVKK baseline stabilization (program-wide rule, unaffected by this task) |
| 13 | AuditLog and ActivityLog behavior | `MERGED`, clearly-bounded core domain (MODULE_MAP.md) | not in the active-path list; new *consent*-specific audit logging is adjacent but separate from `AuditLog`/`ActivityLog` | MODULE_MAP.md | STABLE | documentation, ADR-012 | merging the new consent-audit concept into `AuditLog` without a contract decision (risk of duplicate/overlapping consent-audit concepts, RISK_REGISTER R-047) | LOW-MEDIUM | continuation merged + ADR-012 acceptance |
| 14 | Authentication and authorization | `MERGED`, "partially bounded" (MODULE_MAP.md) | not in the active-path list | MODULE_MAP.md | STABLE | documentation, ADR review | broad authentication middleware restructuring (already frozen program-wide, tracker §8 item 12) | LOW (no direct KVKK-HIGH-007 touch identified) | KVKK baseline stabilization (program-wide) |
| 15 | Tenant scoping | `MERGED`, "clearly bounded" core domain (MODULE_MAP.md) | not in the active-path list | MODULE_MAP.md | STABLE | documentation, F0-009 PoC **design** only | RLS migrations, `organizationId` backfills, tenant-extension rollout (already frozen program-wide, tracker §8 items 2-4) | LOW (no direct KVKK-HIGH-007 touch identified) | KVKK baseline stabilization (program-wide) + F5 entry |
| 16 | Storage and attachment lifecycle | `MERGED` (KVKK-ATTACH-IMAGING-001, PRs #160/162/163), local-VPS-only (R-029) | not in the active-path list | MODULE_MAP.md, RISK_REGISTER R-029 | STABLE | F0-011 storage/backup **design** only | storage-key migration, attachment physical-deletion redesign (already frozen program-wide, tracker §8 items 10-11) | LOW | KVKK baseline stabilization (program-wide) + separate user decision to begin F0-011 |
| 17 | Imaging lifecycle | `MERGED`, "mixed" maturity (MODULE_MAP.md) | not in the active-path list | MODULE_MAP.md | STABLE | documentation only | imaging storage lifecycle redesign (already frozen program-wide) | LOW | F4/F10 entry |
| 18 | Backup and restore | `LOCAL_VPS_STORAGE`, no offsite copy, PITR `NOT_CONFIGURED`, restore-test `UNVERIFIED` (R-030/R-031/R-032) | not in the active-path list | PRODUCTION_TOPOLOGY.md §6 | STABLE (unrelated to KVKK-HIGH-007) | F0-011 backup/PITR **design** only | any live backup/PITR implementation | LOW | separate user decision to begin F0-011 |
| 19 | Queue/outbox architecture | not implemented (ADR-006/007 `DEFERRED` as of F0-008 — no platform/pattern selected, `MERGED`/planned-absent domains) | not in the active-path list | MODULE_MAP.md "Planned / Not Implemented" | N/A (does not exist yet) | F0-010 PoC **design** only | any queue/outbox implementation that rewires current consent/audit flows (already frozen program-wide, tracker §8-adjacent) | LOW | F6 entry |
| 20 | Cross-domain contracts | none implemented; 15 contract candidates identified by F0-004 (ADR-015 `ACCEPTED_WITH_CONDITIONS` as of F0-008 — principle only, contract syntax/enforcement still deferred to F2) | KVKK-HIGH-007 continuation is itself creating de-facto new contracts (consent audit report, WhatsApp purpose map) ahead of any accepted contract process | DEPENDENCY_MAP.md §10.3; ADR-015 | MUTABLE by the active branch, frozen for everyone else | contract candidate review/design (ADR-015) | declaring any of the active branch's new interfaces an "accepted" contract before merge + review | MEDIUM — risk of a de-facto contract being locked in without the ADR-015 process | continuation merged + ADR-015 F2 implementation review of the new interfaces |

## 3. Default freeze rules (unchanged from program-wide rules, restated for completeness)

Per [NORAMEDI_MASTER_TRACKER.md §8](NORAMEDI_MASTER_TRACKER.md#8-blocked-tasks-bloklu-i̇şler) and [phases/F0_BASELINE_AND_VALIDATION.md](phases/F0_BASELINE_AND_VALIDATION.md), the following remain `BLOCKED` until the active KVKK-HIGH-007 continuation reaches a stable, externally-confirmed baseline (PR merged, per §5 exit criteria):

1. Broad Prisma schema refactoring
2. Consent/privacy model relocation
3. Retention model relocation
4. Communication-consent service restructuring (outside the active branch itself)
5. Cross-domain event contract replacement
6. Authentication middleware restructuring
7. Tenant-scope middleware restructuring
8. Local-storage key migration
9. Attachment physical-deletion redesign
10. Imaging storage lifecycle redesign
11. RLS rollout
12. Prisma tenant-extension rollout
13. Wide module extraction
14. Queue/outbox implementation that rewires current consent/audit flows
15. Message delivery refactor across SMS/WhatsApp/email
16. Broad recall workflow refactor

## 4. Allowed in parallel (unchanged, restated)

Documentation; repository evidence collection; ADR review/design; PoC design with no implementation; test inventory and test design; object-storage migration design only; backup/PITR design only; CI design; operational runbook design; non-invasive security review; read-only production verification. **Design work being allowed does not authorize implementation** — F0-009/F0-010/F0-011 remain design-only tasks even after this document.

## 5. Exact event that moves the freeze boundary

The freeze boundary for the areas in §2 marked MUTABLE moves only when one of the following occurs (all require external evidence — an agent's own "done" claim never qualifies, per tracker §2.2/§2.3):

1. The active KVKK-HIGH-007 continuation is committed to a branch and a PR is opened against `main` (moves status from `UNVERIFIED_ACTIVE_WORK` to `PR_OPEN`, evidenced by `gh pr view <n>`). **Satisfied as of this correction pass** — [PR #175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175), `OPEN`, opened `2026-07-19T13:19:58Z`. This condition alone only changes the *evidence-availability* status (content is now theoretically reviewable on GitHub); it does not itself unfreeze anything and content remains uninspected by this task.
2. That PR is merged (`MERGED`, evidenced by `gh pr view <n> --json state,mergedAt,mergeCommit`) — this is the primary event that unfreezes areas 1-11 and 20 in §2, since it fixes the schema/migration/service state those areas depend on.
3. The merged migration is applied in production and confirmed via read-only production evidence (`VERIFIED_PRODUCTION_OBSERVED`, same pattern as F0-002 Stage B) — required before any claim of "deployed."
4. A rollback/tenant-impact verification is independently evidenced (not merely asserted) — required before any claim of "production ready" for schema-touching KVKK work, per the task's mandatory rule that migration validation/rollback/tenant-isolation impact/consent-conflict-resolution behavior/production readiness all remain `UNVERIFIED`/`NOT ESTABLISHED` until then.
5. External review/user acceptance explicitly declares the KVKK baseline "stable" (the qualitative trigger named throughout program docs as "KVKK taban çizgisinin dış teyidi").

Areas 12-19 in §2 are governed by the pre-existing, broader program-wide freeze (tracker §8) and move on **that** freeze's own conditions (F4/F5/F6/F9/F10/F11 entry gates, KVKK baseline stabilization generally) — they are not specifically gated by the KVKK-HIGH-007 continuation alone, though a stabilized KVKK baseline is a shared precondition.

## 6. F0/F1 tasks that may proceed before KVKK-HIGH-007 (continuation) finishes

All documentation/analysis/design F0 tasks may proceed — none of them touch the MUTABLE areas in §2:

- **F0-008** — ADR Review and Enterprise Foundation Decision Set (dependencies F0-003, F0-004, both `MERGED`) — **recommended next task**, see tracker update §13.
- **F0-009** — RLS/Prisma/PgBouncer PoC design (design only; implementation stays blocked by tracker §8 item 11-12 regardless of KVKK status).
- **F0-010** — Queue/outbox PoC design (design only).
- **F0-011** — Object storage and backup migration design (dependencies F0-002, F0-006, both `MERGED` — dependency-ready, but tracker instructs a **separate user decision** is required before starting; this task does not authorize it).
- **F0-012** — Controlled pilot / general launch gate definition (dependencies F0-006, F0-007 — both now satisfiable after this task).
- **F0-013** — F0 consolidated validation report (depends on F0-002…F0-012 — blocked until those complete).

## 7. F0/F1 tasks that remain blocked

- **F1 phase entry** (CI and Test Architecture) — depends on F0 exit gate G0, which depends on F0-013, which depends on all of F0-002…F0-012.
- **F0-009/F0-010/F0-011 implementation** (as opposed to design) — blocked by the program-wide default freeze rules (§3) regardless of KVKK-HIGH-007 continuation status.
- Any task requiring the KVKK-HIGH-007 continuation's actual behavior as an input (e.g. a future audit-report consumer, a future consent-contract ADR closure) — blocked until that work is committed and its behavior is independently evidenced.

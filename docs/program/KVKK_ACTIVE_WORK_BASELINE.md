# KVKK_ACTIVE_WORK_BASELINE — Authoritative KVKK Work Baseline

Source task: F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary.
Baseline commit: `origin/main` @ `91276dc7f610ef6923e3c1a7572f0ebba578a2f7` (PR #173 merge commit).
Evidence basis: [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) — every claim below traces to that file. See [evidence/README.md](evidence/README.md) for evidence-classification legend.

This document does not certify legal KVKK compliance. It is a program-control status baseline only — the authoritative live-status source remains [`NORAMEDI_MASTER_TRACKER.md`](NORAMEDI_MASTER_TRACKER.md) per its source hierarchy (§2.1).

> **Correction note (2026-07-19, correction pass on PR #174):** this document originally described the KVKK-HIGH-007 continuation as flatly "uncommitted, no PR." That was true only at this task's own start. By this task's own finish the primary tree was already clean on a local feature branch, and as of this correction pass GitHub shows an open PR for that branch ([#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175)). §1, §2, and §3 below are corrected to time-sliced language. See [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1 for the full three-observation record.

---

## 1. Key finding: KVKK-HIGH-007 has two parts with different status

GitHub verification (this task) establishes a fact not previously reconciled in program documentation: **KVKK-HIGH-007's base feature (centralized communication preference and consent management) is already `MERGED` and deployed** — via PR #169, merge commit `7fcf2f850f151241266f07349c4bf4442c72bbca`, `mergedAt: 2026-07-18T22:05:26Z`. This commit is also the confirmed production `HEAD` per [F0-002 Stage B evidence](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md) (evidence timestamp `2026-07-19T13:43:12+03:00`), and its migration (`20260718164142_add_communication_preference_and_consent`) is the confirmed repository **and** production migration head.

The active work observed in the primary working tree (`D:\Mustafa\Siteler\DisKlinikCRM`) is therefore best understood as a **continuation/hardening phase of the same KVKK-HIGH-007 initiative**, not an unrelated or newly-invented task. Its migration is literally named `20260719120821_kvkk_high007_consent_reconciliation` — a same-day follow-on to the merged base. This baseline uses the label **"KVKK-HIGH-007 (continuation) — consent reconciliation"** to keep the two parts distinct.

**Note on the continuation's commit/PR status (time-sliced, corrected):** at this task's own start, the continuation was observed as dirty/untracked path metadata in the primary tree (uncommitted). By this task's own finish, the primary tree had independently become clean on local branch `feature/kvkk-high007-consent-reconciliation-ux`. As of this correction pass, GitHub shows an open PR for that exact branch/HEAD: [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175). None of this was caused or inspected by F0-007 — see [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1 for the full record. The table below reflects this task's original PR column ("none" at original verification time); §6 below has the corrected, current picture.

| Part | Scope | PR (at this task's original verification) | Status |
|---|---|---|---|
| KVKK-HIGH-007 (base) | `PatientCommunicationPreference`/`PatientCommunicationConsentEvent` models, `evaluateCommunicationPermission`/`assertCommunicationPermission` service, enforcement flag (ships disabled) | [#169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169) | `MERGED` (`VERIFIED_GITHUB`), deployed (production HEAD match, `VERIFIED_PRODUCTION_OBSERVED` per F0-002 Stage B) |
| KVKK-HIGH-007 (continuation) — consent reconciliation | Legacy-preference reconciliation/backfill, conflict tracking, audit logging/reporting, WhatsApp purpose mapping, retention/messaging/recall touch-points | none found at original verification time; [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175) found open as of this correction pass | `UNVERIFIED_ACTIVE_WORK` — content never inspected; not merged, not deployed, not production verified. Commit/push status corrected from "uncommitted" — see note above. |

A second corroborating, GitHub-independent signal: `docs/compliance/56-kvkk-communication-preference-and-consent-management.md` and `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` are both committed on `origin/main` and both still describe PR #169 as **not yet merged** / **in progress**. This is a self-reference lag identical in shape to the one F0-002/F0-006 previously found and corrected in the program tracker for PR #172: content committed *by* a PR necessarily describes the state as of authoring time, before that PR's own merge. It is a documentation-drift fact, not a claim that the underlying work is incomplete — GitHub's merge record is authoritative per source hierarchy §2.1 (git/PR evidence outranks tracker/compliance-doc text). This drift is recorded as a risk (§7) rather than corrected in `docs/compliance/` — that directory is out of scope for this documentation-only task (see §9 "Prohibited/out-of-scope" of the accompanying freeze-boundary document).

## 2. Answer to Q1 — completion/test/PR/merge/deploy/production-verification status of KVKK/privacy/security tasks

| Task | Agent completed | Tests reported passed | PR opened | Merged | Deployed | Production verified |
|---|---|---|---|---|---|---|
| KVKK-CRIT-001a — public booking notice evidence | yes (self-reported) | yes (self-reported, PRs #156-159) | yes | `MERGED` (`VERIFIED_GITHUB`) | yes, per `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §6.1.2 (compliance-doc claim, not independently re-run by F0-007) | yes, per same compliance doc (compliance-doc claim, not independently re-run by F0-007) |
| KVKK-ATTACH-IMAGING-001 — attachment/imaging lifecycle | yes (self-reported) | yes (self-reported, PRs #160/162/163) | yes | `MERGED` (`VERIFIED_GITHUB`) | yes, per compliance doc §6.2.1 (not independently re-run by F0-007) | yes, per compliance doc §6.2.1 (not independently re-run by F0-007) |
| KVKK-HIGH-004 — secure clinic bulk export | yes (self-reported) | yes (self-reported) | yes, [#165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) | `MERGED` (`VERIFIED_GITHUB`, `2026-07-17T16:43:35Z`) | `UNVERIFIED` — feature flag ships `false`; compliance doc 54 itself states "awaiting deployment/operational verification" | `UNVERIFIED` |
| KVKK-CRIT-003 — security incident response foundation | yes (self-reported) | yes (self-reported, not independently re-run) | yes, [#167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) | `MERGED` (`VERIFIED_GITHUB`, `2026-07-18T16:10:01Z`) — **corrects a stale `OPEN` claim in the tracker/phase docs as of this task's start; see §6** | `UNVERIFIED` — compliance doc 55/tracker record VPS as inaccessible at time of writing; F0-002/F0-006 production evidence collected 2026-07-19 does not itself assert this PR's feature is exercised | `UNVERIFIED` |
| KVKK-HIGH-007 (base) — communication preference/consent management | yes (self-reported) | yes (self-reported, not independently re-run this task) | yes, [#169](https://github.com/MustafaBasol/DisKlinikCRM/pull/169) | `MERGED` (`VERIFIED_GITHUB`, `2026-07-18T22:05:26Z`) | `VERIFIED_PRODUCTION_OBSERVED` — production HEAD (F0-002 Stage B) equals PR #169's merge commit `7fcf2f8...` | `NOT_ESTABLISHED` as a release-gate `PRODUCTION_VERIFIED` status (tracker §2.2/§11) — enforcement flag ships disabled by design (compliance doc 56), so deployment presence alone does not mean the feature is behaviorally active |
| KVKK-HIGH-007 (continuation) — consent reconciliation | `UNVERIFIED_ACTIVE_WORK` (path metadata only; agent's own completion claim, if any, not accessible to F0-007) | `UNVERIFIED` | no at original verification time; **yes as of this correction pass** — [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175), `OPEN`, opened `2026-07-19T13:19:58Z` | not merged | not deployed | not production verified |
| KVKK-CRIT-002, KVKK-CRIT-005, Processor agreement, VERBİS decision tree | n/a — legal-review items, no code | n/a | n/a | n/a | n/a | n/a |
| KVKK-HIGH-001 (attachment encryption) | `BLOCKED` — waiting for infrastructure evidence per compliance doc §4/§6 | n/a | no | not merged | n/a | n/a |
| KVKK-HIGH-003 (medical-record retention) | `BLOCKED` — waiting for legal review per compliance doc §6 | n/a | no | not merged | n/a | n/a |
| KVKK-HIGH-005 (İYS integration) | `NOT_APPLICABLE` — no active marketing-send path (compliance doc §6) | n/a | no | n/a | n/a | n/a |
| KVKK-HIGH-006 (reclassify 63 `req.user.clinicId` usages) | `TODO` / not started (compliance doc §6) | n/a | no | not merged | n/a | n/a |

## 3. Answer to Q2 — classification of all KVKK work

| Classification | Items |
|---|---|
| Committed and merged | KVKK-CRIT-001a (PRs #156-159), KVKK-ATTACH-IMAGING-001 (PRs #160/162/163), KVKK-HIGH-004 (PR #165), KVKK-CRIT-003 (PR #167), KVKK-HIGH-007 base (PR #169) |
| Committed but open | KVKK-HIGH-007 (continuation) — consent reconciliation: not open at this task's original verification time; **[#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175) found `OPEN` as of this correction pass** (content not inspected). Corrected — see §1 note above and evidence §1.1/§3.1. |
| Uncommitted and active (at this task's original start only) | KVKK-HIGH-007 (continuation), observed only by path metadata in the primary working tree at task start; the primary tree was already clean by task end (see evidence §1.1) |
| Superseded | none identified |
| Stale | the tracker's/phase-docs' "PR #167 `OPEN`" claim (corrected §6); `docs/compliance/56-...md` and `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s "PR #169 not yet merged" claim (self-reference lag, not corrected by this task — out of scope, see §1) |
| Blocked | KVKK-HIGH-001 (infra evidence), KVKK-HIGH-003 (legal review), KVKK-CRIT-002/CRIT-005/processor agreement/VERBİS (legal review) |
| Unverified | KVKK-HIGH-004/CRIT-003 deployment+production-verification status; KVKK-HIGH-007 base's enforcement-flag runtime state; all behavioral claims about the KVKK-HIGH-007 continuation |

## 4. Answer to Q3 — mutable domains/files due to active KVKK work

Observed active-work path groups (path metadata only — implementation content not inspected; behavior and tests unverified; not merged; not deployed; not production verified):

- Prisma schema/migration: `server/prisma/schema.prisma`, `server/prisma/migrations/migration_lock.toml`, new migration directory `server/prisma/migrations/20260719120821_kvkk_high007_consent_reconciliation/`
- Communication consent services: `server/src/services/communicationConsent/communicationConsentPolicy.ts`, `enforcementConfig.ts`, and new untracked `communicationConsentAuditLogging.ts`, `communicationConsentAuditReport.ts`, `communicationConsentConflictTracker.ts`, `legacyReconciliationResolver.ts`
- Communication preference routes: `server/src/routes/communicationPreferences.ts`
- Message routes: `server/src/routes/messages.ts`
- SMS: `server/src/services/sms/smsService.ts`
- WhatsApp: new untracked `server/src/services/whatsapp/whatsappCommunicationPurposeMap.ts`
- Recall: `server/src/services/recallCandidateService.ts`
- Data retention: `server/src/jobs/dataRetentionCleanupJob.ts`, `server/src/services/privacy/dataRetentionPolicy.ts`, `server/src/tests/dataRetentionCleanupJob.test.ts`
- Operational events: `server/src/services/operationalEventService.ts`
- Backfill/reconciliation/audit/reporting scripts and tests: `server/src/scripts/backfillCommunicationPreferences.ts`, and new untracked `server/src/tests/communicationConsentAuditReport.test.ts`, `communicationPreferenceReconciliationReport.test.ts`, `communicationPreferencesRoute.test.ts`, `legacyReconciliationResolver.test.ts`, `messagesConsentGate.test.ts`, `recallConsentGate.test.ts`
- Frontend: `src/components/CommunicationPreferencesPanel.tsx`, `src/components/communicationConsentMatrixHelpers.ts`, `src/components/__tests__/communicationConsentMatrixHelpers.test.ts`, `src/pages/PatientDetail.tsx`, `src/services/api.ts`
- Locales: `src/locales/{de,en,fr,tr}/communicationConsent.json`
- Package manifest: `server/package.json`
- Compliance documentation: `docs/compliance/56-kvkk-communication-preference-and-consent-management.md` (observed as modified via read-only `git status`; content not read)

These are **scope-level observations only**, derived from `git status --short` path names in the primary tree per the task's mandatory protection rules. No file content, diff, or behavior from this list was inspected by F0-007.

## 5. Answer to Q12/Q13 — F0/F1 sequencing relative to KVKK

See [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §6 for the full parallel-safe/blocked breakdown and exit criteria.

## 6. GitHub-status-drift correction (Q1 input)

As of this task's start, `NORAMEDI_MASTER_TRACKER.md` §3, `CURRENT_PHASE.md`, and `phases/F0_BASELINE_AND_VALIDATION.md` described PR #167 (KVKK-CRIT-003) as `OPEN`, "not merged," citing a `gh pr view 167` check dated 2026-07-18. GitHub verification performed by this task (`gh pr view 167`, re-run 2026-07-19) shows PR #167 has been `MERGED` since `2026-07-18T16:10:01Z` — i.e. the tracker's snapshot was taken (or last carried forward) before that same-day merge landed, not after. This is corrected in the tracker/phase-doc updates accompanying this task (§5 update block). It does not change the freeze boundary: PR #167's merge does not touch the KVKK-HIGH-007 continuation's active scope, and KVKK-CRIT-003's own deployment/production-verification status remains `UNVERIFIED` per compliance doc 55 and §2 above.

## 7. Correction-pass findings (external review of PR #174)

External review of this task's own PR #174 identified two defects, corrected throughout this document and its companions:

1. **Time-slicing:** this task's original text described the primary tree and the KVKK-HIGH-007 continuation as being in a single, static state ("unchanged throughout," "uncommitted, no PR") for the whole task duration. In fact the primary tree — under a separate, independent session's control — changed branch and HEAD between this task's start and its own finish, entirely outside this task's knowledge or action. §1, §2, §3, and this section now record three distinct, timestamped observations rather than one. See [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §1.1 for the authoritative record.
2. **PR-sweep methodology:** the original "repository-wide, 61/61 PRs `MERGED`, zero open" claim was generated from `gh pr list --state all --limit 60`, a command that cannot return more than 60 rows and does not scan full PR history. A corrected sweep (this correction pass, `--limit 200`) found 174 total PRs (#1–#175) with 3 currently `OPEN`: a pre-existing, KVKK-unrelated PR (#48, open since 2026-06-16, missed by the original narrow sweep), this task's own PR (#174), and — newly, since this task's original verification — [#175](https://github.com/MustafaBasol/DisKlinikCRM/pull/175), the KVKK-HIGH-007 continuation itself. See [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §3.1.

Neither correction changes the freeze boundary's substance: the continuation's implementation content remains uninspected and `UNVERIFIED`, and the freeze on schema/consent/messaging areas (see [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2) stays in effect until that PR merges and its exit conditions (§5 of that document) are independently evidenced.

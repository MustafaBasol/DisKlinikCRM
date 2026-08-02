# F2-PREP-004 — Modularization Sequencing, Pilot Selection, and Migration Plan

Status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`
Type: READ-ONLY sequencing design + new evidence files only (no code movement, no `server/src/modules` folders, no import rewrite, no schema migration, no framework rewrite)

## 0. Scope, baseline, and independence

- **Phase:** F2 PREPARATION — Modular Monolith Boundary Definition.
- **Baseline:** fresh worktree from `origin/main`, commit `70b1690c1a656c95cead7b42812cc9ae6447bfb7` ("Merge pull request #275 from MustafaBasol/feature/external-calendar-outbound-sync-phase2"), committed 2026-08-01T22:13:44+02:00.
- **Worktree/branch:** fresh isolated worktree; local filesystem path intentionally omitted. Branch `docs/f2-prep-004-modularization-sequence`, tracking `origin/main`. Created via:
  ```
  git fetch origin
  git worktree add -b docs/f2-prep-004-modularization-sequence <local-path-omitted> origin/main
  ```
  Working tree confirmed clean at HEAD `70b1690` before any file was written.
- **Independence rule applied literally:** this task did **not** read any unmerged branch or any evidence file authored by F2-PREP-001, F2-PREP-002, or F2-PREP-003. All ten candidate-domain scoring below was produced by fresh, independent repository research (four parallel research passes: Prisma schema/transaction analysis, cross-domain import coupling, test coverage mapping, change-frequency and tooling audit — see §1).
- **What this task additionally, permissibly read:** already-**merged**, main-branch program documents that are not part of the F2-PREP-00{1,2,3} lineage — `docs/program/MODULE_MAP.md` (F0-003, merged), `docs/program/DEPENDENCY_MAP.md` (F0-004, merged), `docs/program/CURRENT_PHASE.md`, and `docs/program/RISK_REGISTER.md`. These are prior, already-accepted baseline artifacts on `main`, not in-flight F2-PREP-001/002/003 work product, so reading them does not violate the independence rule. They were used only to **cross-validate** this task's own independently-derived findings (see §1.5) and to surface program-level context (active KVKK remediation churn) relevant to pilot selection — never as a substitute for this task's own evidence-gathering.
- **Methodological note on domain taxonomy:** the task brief's 10 candidate buckets (privacy, notifications, inventory, billing, appointments, patients, messaging, integrations, imaging, AI) do not map one-to-one onto the pre-existing, already-merged 37-domain F0-003/F0-004 taxonomy (e.g. this task's "messaging" spans F0-003's `WHA`/`IGM`/`SMS`/`EML`; this task's "integrations" spans parts of `PUB`/`LAB`/`REC` plus an external-calendar surface that, at this task's original baseline, F0-003 did not yet name as its own row/column; this task's "AI" corresponds to F0-003's `AIO` "Messaging AI Orchestration" plus the empty, planned-only `PAI`). As of the F2-PREP-004-R1 reconciliation below, that external-calendar surface **is** now formally named — F2-PREP-001 (merged) identifies it as a 38th domain, "External Calendar Integration" (`EXC`) — see §0.1. Where the two taxonomies overlap, findings are cross-validated explicitly below. Where they diverge, this task's own independent evidence is treated as authoritative for this task's own bucket definitions.

### 0.1 Reconciliation with current main (F2-PREP-004-R1)

This evidence was reconciled against current `origin/main` in a follow-up pass (task F2-PREP-004-R1), continuing the same branch (`docs/f2-prep-004-modularization-sequence`) and PR (#278) rather than opening a new one.

- **Pre-merge HEAD:** `61d54ff37f323ead538408c5164384d7a16bc15` (this task's original evidence commit).
- **Current `origin/main` at reconciliation:** `0de9a04a8c7b4fefe5e7f525f9cab031b55fcb83` — includes merged **F2-PREP-001** (PR #276, same merge commit SHA).
- **Ancestor check before merge:** `git merge-base --is-ancestor origin/main HEAD` → **not** an ancestor (main had advanced).
- **Merge performed:** `git merge --no-ff origin/main` (no rebase, no force push, no reset, no blanket `--ours`/`--theirs`). Result: a clean merge with **zero conflicts** — the merge only added two new files (F2-PREP-001's own evidence MD+JSON); nothing this task authored or touched had been modified by `origin/main` since this task's baseline. No semantic conflict resolution was required.
- **Merge commit:** `1fbd362231359b52dfacf5499a913b96c76e0f0`.
- **Post-merge ancestor check:** `git merge-base --is-ancestor origin/main HEAD` → confirmed ancestor.
- **What was read for reconciliation:** only the two merged F2-PREP-001 evidence files (`docs/program/evidence/F2-PREP-001_DOMAIN_OWNERSHIP_AND_BOUNDARY_INVENTORY.md`, `docs/program/evidence/F2-PREP-001_domain_ownership_inventory.json`) — both already-merged main-branch documents, not unmerged F2-PREP-002/003 branches, so this does not violate the independence rule. At the time of this R1 pass, F2-PREP-002 and F2-PREP-003 remained unmerged and were **not** read. (F2-PREP-003 has since merged — see §0.2 below.)
- **Impact on this task's own findings** is recorded in full in the new §1.6 below; the short version: the Imaging/Billing scores and rationale are **unchanged**, one useful scope nuance is added for Imaging/Bridge, and one new candidate (External Calendar Integration) is added to the set F2-PREP-005 must compare — nothing here overturns this task's original evidence.

### 0.2 Reconciliation with current main (F2-PREP-004-R2)

A second follow-up pass, continuing the same branch and PR (#278), reconciled this evidence against current `origin/main` after **F2-PREP-003** merged.

- **Pre-merge HEAD:** `8aafb137fd1ca6313336289182769a085f0dea20` (this task's R1 evidence commit).
- **Current `origin/main` at this reconciliation:** `e8e05f669f049c4895e0c9a7f95db6f3fbd463fe` — includes merged **F2-PREP-003** (PR #277, same merge commit SHA).
- **Ancestor check before merge:** not an ancestor (main had advanced again).
- **Merge performed:** `git merge --no-ff origin/main` (no rebase, no force push, no reset, no blanket `--ours`/`--theirs`). Result: a clean merge with **zero conflicts** — the merge only added two new files (F2-PREP-003's own evidence MD+JSON); nothing this task authored or touched had been modified by `origin/main` since the R1 reconciliation.
- **Merge commit:** `faa4a725fa5576d98561b38b5248299de342767d`.
- **Post-merge ancestor check:** confirmed ancestor.
- **What was read for this reconciliation:** only the two merged F2-PREP-003 evidence files (`docs/program/evidence/F2-PREP-003_FEATURE_INTAKE_AND_CLICKUP_DOMAIN_MAPPING.md`, `docs/program/evidence/F2-PREP-003_feature_intake_domain_mapping.json`) — both already-merged main-branch documents. F2-PREP-002-R1 remains unmerged/pending and was **not** read.
- **Impact on this task's own findings** is recorded in full in the new §1.7 below; the short version: **no candidate-score change** — Imaging, Billing, the External Calendar Integration comparison requirement, and this document's own M0–M5 wave ordering are all unchanged. Full detail in §1.7.

**Upstream/sibling task status as of this reconciliation (F2-PREP-004-R2):**

| Task | Status |
|---|---|
| F2-PREP-001 | **MERGED** (PR #276) |
| F2-PREP-002-R1 | pending |
| F2-PREP-003 | **MERGED** (PR #277) |
| F1-003-B2 | pending review/remediation status |
| F2-PREP-005 | not started |

## 1. Sources inspected (independent evidence base)

Four research passes were run against the current worktree only:

1. **Prisma schema and transaction analysis** — full read of `server/prisma/schema.prisma` (3,360 lines, 98 models), plus every `prisma.$transaction` call site in `server/src/**` (43 sites found and individually classified).
2. **Cross-domain import coupling** — grep-based fan-in/fan-out analysis of every route/service file in each of the 10 candidate-domain buckets, plus the route-registration file (`server/src/index.ts`).
3. **Test coverage mapping** — enumeration of all 118 `server/src/tests/*.test.ts` files, classified per candidate domain, plus an audit of how tests are actually run (no jest/mocha/vitest backend runner; hand-rolled `node:assert` scripts invoked via `tsx`; `server/package.json`'s `test` script is a 90-entry `&&` chain; only 8 of 118 files use `supertest`; only `dbVerification/*` (9 files) run against a real disposable PostgreSQL).
4. **Change frequency and tooling** — `git log --name-only` over the full repository history (774 total commits; the repository's first commit is dated 2026-05-13, so `--since=120 days` already captures 100% of history), classified per domain; plus an audit of existing static-analysis/boundary-enforcement tooling (ESLint config, `dependency-cruiser`/`madge`, `tsconfig` path aliases, CI workflows, package manager/lockfile).

Cross-validation source (already-merged main documents, read after the four independent passes, not before):

5. `docs/program/MODULE_MAP.md` (F0-003, "Son güncelleme: 2026-07-18") — repository-evidence-verified domain/module ownership map.
6. `docs/program/DEPENDENCY_MAP.md` (F0-004, "Son güncelleme: 2026-07-18") — a 37×37 evidence-backed dependency matrix (833 edges, `R`=direct read, `W`=direct write, `S`=service/import call, `X`=high-risk boundary violation, `P`=accepted platform dependency).
7. `docs/program/CURRENT_PHASE.md` and `docs/program/RISK_REGISTER.md` — for program-state context only (e.g., whether privacy/KVKK work is currently active/in-flight, whether F1's CI/disposable-runtime work is merged yet).

### 1.5 Cross-validation result

This task's independent findings and the already-merged F0-004 matrix agree on every material point checked:

- F0-004: **"En yüksek fan-out: `WHA` (106 edge), `PRV` (97), `RPT` (67), `PAD` (64), `REC` (62)"** ↔ this task independently found messaging (WhatsApp route alone) imports 7+ AI files and 13+ privacy imports across the messaging cluster, and privacy has zero *import-level* fan-out but (see below) real schema-level `R/W` fan-out.
- F0-004: **9 `X` (high-risk boundary violation) edges, all `WHA`/`IGM` → `PAT`/`APT`** (direct `Patient`/`Appointment` writes from WhatsApp/Instagram AI code) ↔ this task independently found the exact same 3 code sites via `prisma.$transaction` analysis: `services/instagram/instagramAiConversationProcessor.ts:793/807`, `services/whatsapp/metaWhatsAppAiProcessor.ts:904/918`, `routes/whatsapp.ts:1427/1440/1454`.
- F0-004: `PAI` (AI Platform, planned) row/column **entirely empty** ↔ this task independently confirmed zero `prisma.*` calls in `googleAiStudio.ts`/`whatsappConversationAgent.ts` and concluded "AI" has no data-layer footprint of its own.
- F0-003: **`Patients` — "en çok referans alınan model (18+ ilişki)"** (most-referenced model) ↔ this task's import-level analysis found `routes/patients.ts` has near-zero *file-import* fan-in, refining (not contradicting) F0-003's finding: patients' centrality is a **schema/FK-level** phenomenon, not a service-import-level one — an important nuance for sequencing (see §2, patients row).
- F0-003/MODULE_MAP: `routes/whatsapp.ts` **"3999 lines... only 7 of the file's routes are actual handlers — the rest is embedded conversation-AI/patient-matching/booking-flow business logic"** ↔ matches this task's finding that messaging and AI are bidirectionally entangled with no clean interface between them today.
- **One important refinement this task adds to the merged evidence:** F0-004's `PRV` row shows real `R/W/S` edges into `PAT`/`APT`/`TRC`/`DEN` (Privacy directly reads/writes Patient, Appointment, TreatmentCase, DentalChart models — e.g. via `server/src/services/communicationConsent/legacyConsentCorrection.ts:302`, which mutates `Patient.smsOptOut`/`smsOptOutAt` directly). This task's own independent **import-level** analysis found privacy has **zero cross-domain file imports** (fan-out = 0 at the code-dependency level). Both are true simultaneously and are not a contradiction: privacy is decoupled at the *service-import* layer but **not** decoupled at the *Prisma schema* layer. This distinction is the central reason privacy is not selected as the pilot (see §3).

No contradiction between this task's independent findings and the already-merged evidence was found anywhere it was checked.

### 1.6 Reconciliation with merged F2-PREP-001 (38-domain ownership inventory)

F2-PREP-001 (merged, PR #276) independently produced a 99-Prisma-model, 38-domain ownership inventory (37 domains inherited from F0-003/F0-004 plus one new domain, External Calendar Integration). Reconciling this task's own findings against it:

- **External Calendar Integration (`EXC`) — new domain, not in this task's original candidate set.** F2-PREP-001 names a formal 38th domain with its own dedicated routes (`externalCalendarWebhook.ts`, `platformExternalCalendar.ts`, `externalCalendarOutboundSyncStatus.ts`), 13 services (including a `digidentis/` provider subdirectory behind a provider-factory port), 2 scheduled jobs, and 4 owned Prisma models, all new since the F0-003/F0-004 baseline. F2-PREP-001 itself records, as a factual observation and explicitly **not** a selection: "of all 38 domains in this inventory, External Calendar Integration is the only one that already exhibits essentially the full target module shape... this is **not** a selected or approved F2 pilot module." This task's own "integrations" bucket (§2) was scored before this domain was named and does not isolate it. Per §0.1, EXC is added to the set F2-PREP-005 must compare — see §3.
- **Privacy ownership deltas.** F2-PREP-001 records +4 Prisma models (`PatientCommunicationPreference`, `PatientCommunicationConsentEvent`, `CommunicationConsentConflictBucket`, `PatientLegacyConsentCorrection`) and +10 services under `server/src/services/communicationConsent/`, all committed since the F0-003/F0-004 baseline and all within the Privacy/Consent/Retention/DSR domain this task already excluded as a first pilot (§3). This **reinforces**, and does not change, that exclusion — the domain is demonstrably still growing.
- **Platform Administration ownership deltas.** F2-PREP-001 records +1 Prisma model (`PlatformAdminAuditEvent`) and +1 service (`platformAdminAudit.ts`). Platform Administration was not part of this task's original 10-domain candidate set; no impact on this task's scoring.
- **Storage ownership deltas.** F2-PREP-001 records +2 Prisma models (`FileBackupRun`, `FileBackupEntry`), +2 services, +1 scheduled job (backup subsystem, closing an ADR-013/F0-011 gap). Storage was not part of this task's original 10-domain candidate set; no impact on this task's scoring.
- **`ContactRequest` ownership ambiguity.** F2-PREP-001 flags `ContactRequest` as `OWNERSHIP_AMBIGUOUS` — unresolved between Appointments and a channel-agnostic intake domain. This **reinforces** (does not newly introduce) this task's existing exclusion of Appointments as a first-pilot candidate (§3): an ownership-ambiguous model on top of Appointments' already-highest fan-out/fan-in profile is one more reason, not a new one.
- **99-model 4-bucket ownership classification (`DOMAIN_OWNED`/`SHARED_KERNEL_CANDIDATE`/`PLATFORM_INFRASTRUCTURE`/`OWNERSHIP_AMBIGUOUS`).** All of Imaging's and Billing's owned models (`ImagingDevice`/`ImagingRequest`/`ImagingStudy`/`ImagingImage`; `Payment`/`PaymentPlan`/`PaymentPlanInstallment`/`PractitionerEarning`/`PractitionerPayout`/`InsuranceProvision`) are classified `DOMAIN_OWNED` with no ambiguity flag — corroborates, does not contradict, this task's own scoring.
- **Imaging/Bridge scope nuance.** F2-PREP-001 splits "imaging" into two domains — `IMG` (Imaging — Server Ingest and Viewer) and `BRG` (Imaging — Device Bridge / Windows Bridge). Its domain-summary table marks **both** `Ownership ambiguity: YES`, but its own per-domain JSON detail clarifies this is not a true ownership dispute: `IMG` = "none significant on the ownership question itself"; `BRG` = "bridge-agent/ and windows-bridge/ internal structure is unverified by this task" — those are separate deployables outside the CODEGRAPH-DISCIPLINE-scoped root set both this task and F2-PREP-001 used, a shared pre-existing scope limit, not a new gap. This task's own "imaging" bucket already spanned both `IMG` and `BRG` (it cites the `ImagingBridgePairingDevice` tenant-scoping gap, a `BRG`-owned model, in §3). **No change to the score or the recommendation** — F2-PREP-005 should simply treat the Device Bridge's external `bridge-agent/`/`windows-bridge/` deployable internals as an explicit due-diligence item before any Stage 1 work on that sub-scope.
- **Billing vs. `PBL` distinction confirmed.** F2-PREP-001 independently confirms `PBL` ("Billing / Subscription Engine") is a **separate, unimplemented** domain (0 Prisma models, 0 routes, 0 services, classification "planned/not implemented") — distinct from this task's "billing" bucket, which is the implemented clinic-facing payments/finance surface (`PAY`/`FIN`/`INS`-equivalent in the 37/38-domain taxonomy). This task's §2 already made this distinction (see the Billing evidence note); F2-PREP-001 corroborates it. No score change.
- **Net effect on this task's conclusions:** Imaging candidate score — unchanged. Billing fallback score — unchanged. Integrations score — potentially understated by this task's original scoring (since `EXC` didn't exist as a named candidate at that time), not retroactively changed here; flagged for F2-PREP-005. Migration wave order — unchanged by this task; `EXC`'s clean-slate shape is flagged as a possible factor for F2-PREP-005 to weigh, since its cross-domain edges are not yet coded into the accepted `DEPENDENCY_MAP.md` matrix. Pilot risk assumptions for the already-excluded domains (Appointments, Privacy) — reinforced, not changed.

### 1.7 Reconciliation with merged F2-PREP-003 (feature intake and ClickUp domain mapping)

F2-PREP-003 (merged, PR #277) classified 17 repository-derived backlog items against the F0-003/F0-004 domain taxonomy, rechecked against F2-PREP-001's merged 38-domain inventory, and built the intake framework a future ClickUp import will populate. Per this task's own §3 instruction, this reconciliation **confirms** the following four points from F2-PREP-003's own text rather than rescoring anything, since nothing in F2-PREP-003 contradicts this document's sequencing evidence:

- **The 17 items are not the full ClickUp backlog.** F2-PREP-003 §3 states this explicitly: "The 17-item repository-derived backlog... is not a substitute for the full ClickUp backlog... must not be presented, cited, or reported anywhere as the full NoraMedi feature backlog total." Confirmed.
- **ClickUp import remains pending.** F2-PREP-003's `clickup_derived_backlog` is an empty array, explicitly marked `PENDING_EXTERNAL_IMPORT` — no ClickUp MCP server was available in that task's execution environment either. Confirmed.
- **No backlog item was assigned to External Calendar Integration.** F2-PREP-003 §5's ownership-counts table states directly: "No item is currently owned by `PRV`, `PAD`, `STG`, or the new `EXC` domain." Confirmed.
- **Final pilot selection remains deferred to F2-PREP-005.** F2-PREP-003 §4.1.C: "No pilot module is selected by this task... F2-PREP-005 makes that call." Confirmed — matches this document's own §3 deferral exactly.

**Effect on this document's conclusions — no scoring change:**

- **Imaging recommendation:** unchanged. F2-PREP-003 does include one item touching this document's "imaging" bucket — `F2P3-005` (Windows Bridge .NET test flakiness), owned by `BRG`, readiness `SAFE_NOW_IN_EXISTING_BOUNDARY`, delivery wave 0. This **corroborates** (does not contradict) this document's low-risk-pilot reasoning: an independent classification pass also found the Device Bridge sub-scope stable enough for a small isolated fix with no new contract required.
- **Billing fallback:** unchanged. None of F2-PREP-003's 17 items are owned by the `PAY`/`FIN`/`INS`-equivalent surface this document calls "billing." The one billing-adjacent item, `F2P3-015` ("Billing / Subscription Engine"), is owned by `PBL` — the separate, unimplemented domain §1.6 above already distinguished from this document's own "billing" bucket. F2-PREP-003 independently corroborates that distinction (`PBL` classified `DISCOVERY_REQUIRED`, `inferred` confidence — not an existing implemented surface).
- **External Calendar Integration comparison requirement:** unchanged, reconfirmed. Zero of F2-PREP-003's 17 items touch `EXC`, and F2-PREP-003 independently confirms pilot selection (including whether `EXC` is accepted) is F2-PREP-005's job. This document's existing requirement — that F2-PREP-005 compare `EXC` alongside Imaging/Billing — stands.
- **Wave ordering:** unchanged. F2-PREP-003 defines its own, differently-scoped "delivery wave" numbering (0–4) for backlog-item readiness/dependency ordering — **a distinct concept from this document's M0–M5 domain-migration waves (§6)**; the two should not be conflated when F2-PREP-005 reconciles them. F2-PREP-003's `F2P3-011` ("CC-04", an Appointment booking/cancellation command contract; delivery wave 2; `SAFE_AFTER_CONTRACT`) is a narrower, contract-level recommendation — not a claim that Appointments should be the first domain-level migration pilot. It does not contradict this document's §3 exclusion of Appointments as a first pilot; it is noted here as a concrete future candidate for this document's Stage 2 (public-contract introduction, §4) once Appointments' own boundary work begins (this document's M3, §6).

**Net result: no candidate-score change** — the expected outcome anticipated by this reconciliation's own task instruction.

## 2. Candidate domain scoring

Scoring uses qualitative Low/Medium/High labels grounded in cited evidence, not a fabricated precision-numeric formula (the underlying repository does not have the kind of longitudinal incident/ticket data that would justify decimal scores). A 1–5 composite "pilot-favorability" score is given per criterion **only where repository evidence directly supports a ranking**; criteria with no available repository evidence (see "number of waiting features") are marked `NO REPOSITORY EVIDENCE` rather than guessed. For every "favorability" score, **5 = most favorable for an early/first pilot** (safe, simple, low blast radius); 1 = least favorable.

| Domain | Boundary clarity | Current coupling | Business criticality (5=safe to pilot) | Tenant risk (5=low) | KVKK risk (5=low) | Transaction complexity (5=simple) | Provider coupling (5=none) | Test coverage (5=strong) | Change frequency (5=stable) | Migration effort (5=small) | Rollback ease (5=easy) | Additive move ability (5=fully additive) | Reusable-pattern value (5=high) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Imaging | 5 | 5 | 4 | 4 | 3 | 5 | 3 | 3 | 5 | 4 | 5 | 5 | 3 |
| Billing | 5 | 5 | 3 | 4 | 3 | 5 | 5 | 3 | 3 | 4 | 5 | 5 | 5 |
| Inventory | 4 | 3 | 3 | 4 | 5 | 2 | 5 | 1 | 5 | 5 | 3 | 3 | 3 |
| Notifications | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 1 | 4 | 5 | 4 | 4 | 3 |
| Integrations | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 4 | 3 | 3 | 3 | 4 | 3 |
| Patients | 2 | 2 | 1 | 4 | 2 | 1 | 5 | 3 | 2 | 1 | 1 | 2 | 2 |
| Privacy/retention/consent | 3 (import layer) / 2 (schema layer) | 4 (import layer) / 2 (schema layer) | 1 | 4 | 1 | 2 | 4 | 5 | 2 | 2 | 2 | 3 | 2 |
| Appointments | 1 | 1 | 1 | 4 | 3 | 1 | 3 | 4 | 2 | 1 | 1 | 2 | 2 |
| Messaging | 1 | 1 | 2 | 3 | 2 | 2 | 1 | 4 | 1 | 1 | 2 | 2 | 2 |
| AI | 1 (no data layer to move) | 1 | 3 | N/A (no models) | 2 | 1 | 2 | 2 | 2 | 1 | 2 | 1 | 2 |

`Number of waiting features` per domain: **`NO REPOSITORY EVIDENCE`** for all 10 domains — this axis would require reading a product backlog/ticket tracker, which either does not exist in-repo in a queryable form or lives in the F2-PREP-001/002/003 lineage this task is explicitly barred from reading. Not fabricated; see §19 (unverified claims).

### Per-domain evidence notes

**Imaging** (`routes/imaging.ts`, `imagingBridgePublic.ts`, `services/imaging/*` (7 files), `jobs/imagingBridgeOfflineJob.ts`)
- Zero cross-domain file-import fan-out and zero fan-in from any other of the 10 domains (only `index.ts` registration and its own tests import it).
- All 5 imaging `prisma.$transaction` sites (`imaging.ts:348,614,1089`; `imagingBridgePublic.ts:301,421`) are domain-internal — `patientId`/`appointmentId`/`treatmentCaseId` values are resolved and validated (`imaging.ts` `validateClinicalLinks`, line 598) **before** the transaction opens, never written to another domain's table inside it. This is the cleanest transactional profile of any FK-heavy domain in the repository.
- One tenant-scoping gap: `ImagingBridgePairingDevice` has no `clinicId`/`organizationId` column (scoped only via `pairingId → ImagingBridgePairing`) — a small, additive fix, not a structural blocker.
- Already has a dedicated, path-filtered CI workflow (`windows-bridge-pr.yml`) that runs `npm run typecheck` and the imaging test suites only when imaging-bridge paths change — i.e. the repository already treats this surface as semi-independent for CI purposes.
- 5 dedicated test files (`imaging.test.ts`, `imagingBridgeOnboarding/Pairing/Update.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts`), all mock/unit-level; no live-DB or live-file-storage verification exists today.
- Lowest change frequency of the FK-heavy domains (30 commit-touches in the repository's full history, 10 distinct files) — low risk of a migration colliding with concurrent feature work.
- KVKK risk is present but bounded and already governed (immutable-image design, documented legal-hold fields on `PatientAttachment`/imaging tables) rather than actively contested; not zero, hence 3/5, not 5/5.

**Billing** (`routes/payments.ts`, `paymentPlans.ts`, `insuranceProvisions.ts`, `compensationRules.ts`, `practitionerEarnings.ts`, `practitionerPayouts.ts`, `financeDashboard.ts`, `services/earningService.ts`)
- Zero cross-domain file-import fan-out; exactly one fan-in edge (`routes/treatmentCases.ts:7` → `server/src/services/earningService.ts`, imported there via ESM/TS import syntax as `../services/earningService.js` — the `.js` extension is the NodeNext-module-resolution import-specifier convention, not the actual file extension; the file on disk is `.ts`).
- No cross-domain `prisma.$transaction` site touches billing models at all — billing's only cross-domain dependency is a two-phase **read-then-write** pattern (`earningService.ts` reads `Payment.treatmentCase.practitionerId`/`appointmentTypeId`, then separately writes `PractitionerEarning`), which is safely splittable without a shared transaction.
- One tenant-scoping gap: `PaymentPlanInstallment` has no `clinicId` (scoped only via `planId → PaymentPlan`) — additive fix.
- No external provider coupling found (no payment-gateway integration exists in the repository; `Payment`/`PaymentPlan` are internally tracked ledgers, consistent with MODULE_MAP's "Billing / Subscription Engine (planned, not implemented)" finding for the separate concept of a *subscription* billing engine — this task's "billing" bucket is the clinic-facing patient billing/finance surface, which does exist and is implemented).
- Test coverage is uneven: payments/overdue/finance-dashboard-shape are covered, but `services/earningService.ts`, `routes/practitionerEarnings.ts`, `practitionerPayouts.ts`, `compensationRules.ts` have **zero** dedicated test files — this is a real gap to close in Stage 1/2 of the migration (see §4), not a reason to disqualify the domain, since the gap is itself easy to close given the domain's low coupling.
- Business criticality is elevated (revenue-facing) — scored 3/5 rather than higher, reflecting real stakes even though technical risk is low.

**Inventory** (`routes/inventory.ts`, `services/inventoryAlerts.ts`, `services/treatmentStockDeduction.ts`)
- Deceptively clean at the **import** level (zero fan-out, one fan-in edge: `routes/treatmentPlanProcedures.ts:12`), but this undersells its real coupling: `treatmentStockDeduction.ts:143,166,184` runs `tx.inventoryItem.updateMany`, `tx.inventoryTransaction.create`, and (via `checkAndNotifyLowStock`) a `Notification` write, **all inside the same Prisma transaction** opened by `routes/treatmentPlanProcedures.ts:151`/`:271` for completing a `TreatmentPlanProcedure` (a **patients**-domain model). This is the single clearest three-domain (patients + inventory + notifications) write-transaction in the repository, independently corroborated by F0-004's `INV` row (`R/W` to `TRC`/`DEN`).
- Consequence: inventory cannot be safely extracted into its own transactional/deployment boundary ahead of patients without either an outbox/eventual-consistency redesign of stock deduction, or accepting a cross-module transaction indefinitely (an explicit "unsuitable to move fully first" signal despite the flattering import-level numbers — scored 2/5 on transaction complexity, dragging the composite down).
- Zero test coverage (`routes/inventory.ts`, `services/inventoryAlerts.ts`, `services/treatmentStockDeduction.ts` have no dedicated test files) — the worst-tested domain in the codebase alongside notifications.
- Lowest change frequency in the whole set (6 commit-touches, 3 files) and no external provider coupling.

**Notifications** (`routes/notifications.ts`, `services/notificationPreferences.ts`, `appointmentRequestNotification.ts`, `taskAssignmentNotifier.ts`, `emailService.ts`, `emailTemplates.ts`)
- `Notification` itself has **zero** Prisma foreign keys to any other model (schema-clean), but is written to directly from inventory-domain code inside inventory's cross-domain transaction (above), and has moderate bidirectional import coupling: fan-out to messaging (`appointmentRequestNotification.ts:12,16`, `taskAssignmentNotifier.ts:3`) and integrations (`routes/notifications.ts:10` → `labOrderStatusTransitions.js`); fan-in from appointments (`noShows.ts:24`) and integrations (`externalCalendarOutboundSync.ts:51`).
- Zero dedicated test files — the only two hits are incidental source-string assertions embedded in unrelated suites, not functional coverage; `taskAssignmentNotifier.ts`/`appointmentRequestNotification.ts` have no test references at all.
- Low change frequency (16 touches, 6 files).

**Integrations** (`routes/externalCalendarWebhook.ts`, `externalCalendarOutboundSyncStatus.ts`, `platformExternalCalendar.ts`, `labOrders.ts`, `laboratories.ts`, `publicBooking.ts`, `services/externalCalendar/*`, `services/labOrders/*`, `jobs/externalCalendar*`)
- Moderate coupling: 3 fan-out domains (notifications, appointments, AI via `publicBooking.ts:9-10`), 2 fan-in domains (appointments, notifications). Internally, the `labOrders/*` subfolder is itself clean (zero external fan-out).
- One cross-domain transactional site: `appointmentRequests.ts:305` writes an `ExternalCalendarAppointmentLink` inside the appointments-conversion transaction.
- One tenant-scoping gap: `LabWorkOrderStatusHistory` has no `clinicId` (scoped only via `labWorkOrderId`).
- Reasonably well tested (~14 files) and includes the single genuine transport-level route E2E test in the whole suite (`externalCalendarWebhookRouteE2E.test.ts`, real HTTP + HMAC-signed webhook headers) plus one real-DB atomicity suite.
- Heavy real external-provider coupling (DigiDentiS lab API, external calendar providers, Meta webhook transport) — scored low (2/5) on provider coupling.

**Patients** (`routes/patients.ts`, `patientsImport.ts`, `dentalChart.ts`, `treatmentCases.ts`, `treatmentPackages.ts`, `treatmentPlanProcedures.ts`, `postTreatment.ts`, `services/postTreatmentMessaging.ts`)
- Near-zero **import-level** fan-in (contrary to the intuitive "patients is imported by everything" assumption), but this is misleading: patients is the FK target of the majority of cross-domain writes in the schema (billing, inventory, messaging, imaging, integrations all carry a `patientId`/`treatmentCaseId` FK) and is a direct participant in 5 of the 9 confirmed cross-domain `prisma.$transaction` sites (appointment-request conversion creating a `Patient`; appointment-completion auto-creating a `TreatmentCase`; treatment-procedure completion driving inventory deduction; the WhatsApp/Instagram AI booking flows creating `Patient`/`AppointmentRequest`; the legacy consent-correction transaction mutating `Patient.smsOptOut` directly).
- MODULE_MAP corroborates: "Patients... en çok referans alınan model (18+ ilişki)" (most-referenced model, 18+ relations).
- Regulatory/tenant-critical criticality (MODULE_MAP classification), core clinical entity — not a safe first pilot regardless of any single metric.

**Privacy/retention/consent** (`services/privacy/*` (10 files, incl. `clinicBulkExport*`), `services/communicationConsent/*`, `routes/patientPrivacy.ts`, `gdprExport.ts`, `publicClinicKvkk.ts`, `jobs/dataRetentionCleanupJob.ts`, `patientPrivacyExportCleanupJob.ts`, `services/channelConsentGate.ts`)
- **Zero cross-domain file-import fan-out** — every import inside this cluster resolves to `db.js`/shared utils or another file inside the same cluster.
- **But real schema-level `R/W` fan-out** (see §1.5): `services/communicationConsent/legacyConsentCorrection.ts:302` runs a transaction that both inserts a `PatientLegacyConsentCorrection` audit row **and** `updateMany`s `Patient.smsOptOut`/`Patient.smsOptOutAt` directly — i.e., patient-level consent state is not encapsulated behind a privacy-owned contract, it lives as plain columns on `Patient` and is mutated directly by privacy-domain code. F0-004 independently confirms this shape (`PRV` row: `R/W/S` into `PAT`; `R/W` into `APT`; `R` into `TRC`/`DEN`).
- **Very high fan-in**: messaging depends heavily and pervasively on privacy (13+ distinct import sites across `messages.ts`, `whatsapp.ts`, `instagramAiConversationProcessor.ts`, `metaWhatsAppAiProcessor.ts`, `whatsappOutboundMessaging.ts`, `communicationPreferences.ts`, `smsService.ts`, etc.), and appointments depends on it too (`recallCandidateService.ts:8`). F0-004 independently confirms `PRV` has the 2nd-highest fan-out (97 edges) of any of its 37 domains and flags a `PRV↔WHA` two-domain cycle.
- **Best-tested domain in the repository** by a wide margin (~30 dedicated test files, the only domain with real-disposable-Postgres coverage via `dbVerification/kvkkHigh006Db*.test.ts`).
- **Program-state context (from `RISK_REGISTER.md`/`CURRENT_PHASE.md`, both already-merged main documents, read for context only):** privacy/consent is under **active, ongoing, high-stakes regulatory remediation** — multiple KVKK-HIGH-006/007/008 workstreams, risk R-061 still `OPEN` (production controlled-activation not yet authorized), R-071 only recently closed after many correction passes, `legacyConsentCorrection` itself the subject of very recent work. DEPENDENCY_MAP's own F0-007 addendum explicitly warns that the matrix's `PRV`/`WHA`/`SMS`/`REC` cells reflect a snapshot that **does not** account for further in-flight KVKK-HIGH-007 work.
- **This is the direct, evidence-based answer to the task's explicit instruction not to default to privacy merely because the current blocker is retention-related:** privacy scores well on *import-layer* boundary clarity and *test coverage*, but poorly on *schema-layer coupling* (direct `Patient` writes), *KVKK/regulatory risk* (1/5 — a defect introduced while re-drawing this boundary is a compliance incident, not just a bug), and *timing* (already mid-churn from unrelated, currently-open regulatory work). The objective composite does not favor it as a first pilot. See §3.

**Appointments** (`routes/appointments.ts`, `appointmentRequests.ts`, `schedules.ts`, `noShows.ts`, `recall.ts`, `services/appointments/appointmentAvailabilityService.ts`, `appointmentRequestSafety.ts`, `recallCandidateService.ts`, `recallSettings.ts`)
- Highest import-level fan-out of any of the 10 domains: 5 distinct target domains (patients, integrations, messaging, notifications, privacy).
- Fan-in from 3 domains (messaging, AI, integrations).
- Participant in the single richest cross-domain transaction in the repository: `routes/appointmentRequests.ts:305` (`POST /:id/convert`) creates a `Patient` (patients), creates the `Appointment` (appointments), and conditionally writes an `ExternalCalendarAppointmentLink` (integrations) — all in one transaction, repeated in near-identical form across the staff, WhatsApp-AI, Instagram-AI, and public-booking conversion paths (5 near-identical call sites total).
- F0-004 independently confirms `APT` has the 2nd-highest fan-in of any of its 37 domains (116 edges), consistent with "core transactional hub."

**Messaging** (WhatsApp/Instagram/SMS/Email routes and services, `communicationPreferences.ts`, `evolutionApi.ts`, `metaTemplateService.ts`, `messagingInboundIdempotency.ts`)
- Highest change frequency by a wide margin: 192 commit-touches across 38 files in the repository's full history — nearly 3× the next-highest domain (privacy, 69).
- Massive import-level fan-out into privacy (13+ sites) and AI (13+ sites across `whatsapp.ts`, `metaWhatsAppAiProcessor.ts`, `instagramAiConversationProcessor.ts`), plus appointments.
- F0-004 independently confirms `WHA` has the highest fan-out of any of its 37 domains (106 edges) and flags it as a "god module" signature consistent with the 3,999-line `routes/whatsapp.ts` hotspot (of which only ~380 lines are actual route handlers per MODULE_MAP).
- Contains all 9 of the repository's confirmed `X` (high-risk boundary violation) edges — direct `Patient`/`Appointment` writes from WhatsApp/Instagram AI flows that bypass the advisory-lock concurrency protection used elsewhere in the same codebase (`publicBooking.ts`, `appointmentRequestSafety.ts`).
- Largest raw test-case count of any domain (`smsModule.test.ts` 77 cases, `instagramProvider.test.ts` 63 cases) but almost entirely mocked/unit-level, not transport E2E.

**AI** (`services/googleAiStudio.ts`, `whatsappConversationAgent.ts`, `whatsappAgentPrompt.ts`, `whatsappAgentSchema.ts`, `whatsappInterpreter.ts`, `whatsappStepAwareNlu.ts`, `whatsappResolvedIntentRouter.ts`, `whatsappClarification.ts`, `whatsappBookingFlow.ts`, `whatsappAvailability.ts`)
- **No Prisma models and zero `prisma.*` calls in the two core files** (`googleAiStudio.ts`, `whatsappConversationAgent.ts`) — confirmed by direct grep. There is no data-layer footprint to extract. F0-004 independently confirms this: its `PAI` ("AI Platform / AI Gateway") row and column are **entirely empty**, consistent with F0-003's "confirmed absent, not merely unverified" classification for a standalone AI domain.
- Deeply, bidirectionally entangled with messaging: `routes/whatsapp.ts` imports 7 of the 10 AI files directly; `metaWhatsAppAiProcessor.ts` and `instagramAiConversationProcessor.ts` (both physically inside messaging's own subfolders) import 6 AI files each; one AI file (`whatsappBookingFlow.ts:20`) imports back into messaging (`./whatsapp/humanHandoffPhrases.js`), confirming this is not one-directional consumption.
- The only tested path is the deterministic rule-based fallback (`whatsappAgentEvaluation.test.ts`, `whatsappStepAwareNlu.test.ts` — the latter explicitly deletes the Google AI Studio API key env vars to force the network-free path) plus a redaction-boundary check (`aiPrivacyBoundary.test.ts`, mocked fetch). The real LLM-driven classification/decision path has no dedicated test.
- **Not extractable as a data-domain module today; only a stateless-service extraction of the prompt/NLU/schema files (which are already DB-free) is realistic without a larger messaging refactor first.**

## 3. Pilot selection

**This section records independently recommended pilot *candidates*, not a selection.** No pilot has been approved or chosen by this task or any task before it. Final pilot selection is deferred to **F2-PREP-005 — Consolidated Modularization Charter**, which must compare Imaging, Billing, External Calendar Integration (§1.6), the CC-04 Appointment booking/cancellation command contract (§1.7, per merged F2-PREP-003 — a contract-level candidate, not a domain-migration-order claim), and any pilot candidate emerging from F2-PREP-002-R1 (still pending) before selecting one. No implementation task — including Imaging Stage 1 — is authorized by this evidence alone.

### Independently recommended primary pilot candidate: **Imaging**

Evidence-based rationale (safest and, given file count, also fast):
1. **Zero cross-domain coupling in both directions** — the only FK-heavy domain in the repository with 0 import fan-out AND 0 import fan-in from the other 9 candidate domains (§2). F0-004 independently corroborates: the `IMG` column has no inbound edges from any domain other than its own `BRG` (bridge) sub-component.
2. **Cleanest transactional profile of any FK-heavy domain** — its 5 `prisma.$transaction` sites are all domain-internal; `patientId`/`appointmentId`/`treatmentCaseId` are validated by a read **before** the transaction, never written inside a cross-domain transaction. This is a materially safer starting point than inventory, appointments, or patients, all of which have genuine in-transaction cross-domain writes.
3. **Lowest business-criticality-weighted blast radius among low-coupling candidates** — a defect degrades an optional imaging feature, not money movement (billing) or patient/appointment continuity (appointments/patients).
4. **Lowest change frequency of the FK-heavy domains** (30 touches/10 files, full history) — low risk of the migration branch colliding with concurrent feature work, and low risk of the migration itself becoming stale mid-flight.
5. **Precedent for isolated CI treatment already exists** (`windows-bridge-pr.yml` is already path-filtered to imaging-bridge surfaces) — the organization has already implicitly treated this surface as separable for build/test purposes.
6. Two small, additive fixes are recommended alongside (not blocking) the pilot: add `clinicId`/`organizationId` to `ImagingBridgePairingDevice`, and add dedicated tests for the currently-unverified live-file-storage/live-DB paths (the domain's existing 5 test files are mock/unit-level only).

**Caveat honestly recorded:** imaging's "reusable pattern value" is scored lower (3/5) than billing's, because its domain content includes a Windows/.NET bridge, DICOM signature validation, and device pairing — idiosyncratic concerns that will not generalize to the next module extracted (e.g. appointments or messaging will not have a hardware bridge). What *is* reusable is the **process** (Stage 1–7 pattern, §4), not the domain-specific content. This is an accepted trade-off, not an oversight.

### Independently recommended fallback pilot candidate: **Billing**

If imaging's hardware/Windows-bridge idiosyncrasies are judged by reviewers to make it a poor template for the *next* modules (which will mostly be pure-TypeScript business domains with no hardware component), billing is the strongest alternative:
1. Equal-lowest coupling by import analysis (0 fan-out, exactly 1 read-only fan-in edge, `treatmentCases.ts:7` → `server/src/services/earningService.ts`).
2. **No cross-domain transaction touches billing models at all** — its only cross-domain dependency is a safely-splittable two-phase read-then-write.
3. **Zero external provider coupling** (no payment gateway integration exists yet) — the cleanest "pure backend module" pattern instance of the 10 candidates, maximizing reusable-pattern value (5/5).
4. One tenant-scoping gap (`PaymentPlanInstallment` missing `clinicId`) is a small additive fix.
5. Real gap to close as part of Stage 1/2, not a disqualifier: `earningService.ts`, `practitionerEarnings.ts`, `practitionerPayouts.ts`, `compensationRules.ts` currently have zero dedicated tests.

Billing scores slightly lower than imaging only on business criticality (revenue-facing, elevated stakes if something breaks) and current test-coverage floor (3/5 vs imaging's 3/5 — comparable, but billing's untested surfaces are larger routes, not just bridge edge cases).

### Domains explicitly unsuitable as the first pilot (with evidence)

1. **Appointments** — highest import fan-out of the 10 domains (5 target domains) and, per F0-004, the 2nd-highest fan-in of any of the 37 pre-existing domains (116 edges). Central participant in the richest cross-domain transaction in the repository (patients + appointments + integrations, repeated across 5 near-identical conversion-flow call sites). Moving this first would produce the largest blast radius of any candidate.
2. **Messaging (WhatsApp/Instagram/SMS/Email)** — highest fan-out of any of the 37 pre-existing domains per F0-004 (`WHA` 106 edges), contains all 9 confirmed high-risk boundary-violation writes into `Patient`/`Appointment`, and has by far the highest change frequency in the repository (192 touches/120d — nearly 3× the next domain). A domain under this much concurrent churn is not a safe first module to re-draw a boundary around.
3. **Patients** — most cross-domain-referenced Prisma model in the schema (18+ relations per MODULE_MAP), direct participant in 5 of the 9 confirmed cross-domain transactions, regulatory/tenant-critical clinical core entity. Extraction risk here is schema-level, not import-level, and therefore not visible to a naive "how many files import this route" check — exactly the kind of hidden coupling a first pilot should avoid.
4. **Privacy/retention/consent** — **the task explicitly warns against defaulting to this domain merely because the current blocker is retention-related; the evidence here independently supports that warning, not merely defers to it.** Real reasons, not merely deference: (a) real schema-level `R/W` coupling into `Patient` (direct `smsOptOut` mutation), not the "fully decoupled" picture the import-layer analysis alone would suggest; (b) very high fan-in from messaging (13+ import sites) and the 2nd-highest fan-out of any of F0-004's 37 domains (97 edges), meaning a boundary change here has a wide blast radius even though privacy's own outbound code imports are zero; (c) KVKK/regulatory risk — a defect introduced while re-drawing this specific boundary is a compliance incident, not merely a bug, and this domain is already under active, high-stakes, in-flight regulatory remediation per `RISK_REGISTER.md`/`CURRENT_PHASE.md` (R-061 `OPEN`, `legacyConsentCorrection` recently and repeatedly touched); (d) DEPENDENCY_MAP's own F0-007 addendum states its `PRV`/`WHA`/`SMS`/`REC` cells do not yet reflect further in-flight KVKK-HIGH-007 changes — i.e., even the existing accepted evidence about this domain is known to be provisional right now.
5. **AI** — has no Prisma models and no data-layer footprint of its own (confirmed independently and by F0-004's empty `PAI` row/column); is bidirectionally entangled with messaging with no existing interface boundary between them. There is structurally nothing to "move" as a data/service module today; attempting to modularize it first would really be a disguised, premature attempt to modularize messaging.

**Domains not scored as primary/fallback but also not flagged unsuitable** (candidates for later waves, §6): notifications, inventory (real transactional coupling with patients makes it a poor *first* pilot despite flattering import-level numbers — see §2), integrations.

**Added by F2-PREP-004-R1 reconciliation (§1.6), not scored by this task, not flagged unsuitable:** External Calendar Integration (`EXC`) — a newly-named domain (merged F2-PREP-001) that this task did not independently research at the same depth as the 10 candidates above. It must be included in F2-PREP-005's comparison set (see the deferral note at the top of this section) rather than defaulted into or out of the pilot role by this document.

## 4. Migration pattern — expand/migrate/contract, 7 stages

All 7 stages are **additive-first** (expand → migrate → contract), matching `DEPENDENCY_MAP.md §1–§9`'s already-defined target dependency rules (public-contract-only cross-module reads, event/outbox for cross-module side effects, no direct cross-module Prisma access, core-dependency-only-inward). No stage below requires deleting or renaming anything until Stage 6, and Stage 6 itself only removes now-provably-unused compatibility shims.

### Stage 1 — Freeze ownership and add dependency rules
- **Entry criteria:** pilot domain selected by F2-PREP-005 (§3) and this evidence document reviewed for that domain; `DEPENDENCY_MAP.md §1–§9` target rules already exist and are reused, not rewritten.
- **Changed-file categories:** documentation only (a per-module `OWNERSHIP.md` or an addition to `MODULE_MAP.md` naming the pilot's file list as frozen/owned; no `.ts` file changes).
- **Tests:** none required (no runtime behavior exists yet to test); a documentation-lint/link-check pass is sufficient.
- **Backward compatibility:** total — nothing runtime changes.
- **Rollback:** revert the documentation commit; zero risk.
- **Stop conditions:** if the pilot's file list cannot be enumerated without touching files outside the pilot domain (i.e., if "freezing ownership" turns out to require editing a file three other domains also edit), stop and re-scope the pilot boundary before proceeding.
- **Production verification:** none required at this stage.

### Stage 2 — Introduce a public contract without moving behavior
- **Entry criteria:** Stage 1 complete; the pilot's actual inbound/outbound edges are known from §2/§3 evidence (for imaging: zero inbound edges today, so the "contract" work here is mostly forward-looking — defining the shape imaging would expose if another domain needed it later — rather than urgent; for billing: the one real inbound edge, `earningService.generateEarningFromTreatmentCase`, gets a named, typed contract function).
- **Changed-file categories:** new `public.ts` (or equivalent) file(s) inside the pilot's existing folder, re-exporting/wrapping existing functions under stable names and types; **zero changes to existing route/service files' internal logic**.
- **Tests:** new unit tests asserting the public contract's input/output shape matches the wrapped internal function 1:1 (a "seam" test, not new business-logic tests).
- **Backward compatibility:** total — old internal import paths still work; the new contract is additive.
- **Rollback:** delete the new `public.ts` file(s); nothing else depends on them yet.
- **Stop conditions:** if defining the contract surfaces an undocumented cross-domain call that the fan-in/fan-out analysis in §2 missed, stop, update this evidence document's affected domain section, and re-run the affected consumer's own tests before continuing.
- **Production verification:** none required (additive, unused-in-production code path).

### Stage 3 — Move the application service behind the contract
- **Entry criteria:** Stage 2 merged; the one known consumer (if any — billing's `treatmentCases.ts`, imaging's none) is ready to be repointed.
- **Changed-file categories:** the consumer's import statement changes from a direct relative import of the internal file to an import of the new `public.ts` contract; the internal service file itself may be physically relocated within the same top-level folder (still not into `server/src/modules/**`, per this task's own prohibition on folder creation) but its exported surface is unchanged.
- **Tests:** existing domain tests re-run unchanged (should be 100% green with no edits, since only the import path moved, not behavior); the consumer's own tests re-run unchanged.
- **Backward compatibility:** total, given exactly one release — the old internal path is still present and still exported during this stage (compatibility re-export), so any missed caller does not break.
- **Rollback:** revert the consumer's import-path change; the internal file's location/exports are unaffected either way.
- **Stop conditions:** if re-running the full existing test suite for the pilot domain and its one known consumer produces any new failure, stop and do not proceed to Stage 4 until root-caused.
- **Production verification:** deploy behind normal release process; confirm no new 5xx/error-rate change on the pilot domain's routes and (for billing) the consumer route for one full business day before Stage 4.

### Stage 4 — Move infrastructure/data access
- **Entry criteria:** Stage 3 stable in production for at least one full day with no new errors attributable to it.
- **Changed-file categories:** the pilot domain's own Prisma-calling code is consolidated behind its own repository/data-access layer (still calling the same shared `PrismaClient` — no schema change, no separate database, per this task's explicit no-schema-migration constraint); for imaging, this mainly formalizes what is already true (no other domain touches imaging's Prisma models); for billing, this formalizes the module's own read/write surface and makes the `PaymentPlanInstallment.clinicId` tenant-scoping gap (§2) an explicit, fixable seam rather than an implicit one.
- **Tests:** existing tests re-run unchanged, plus new tests specifically asserting no other domain's code path calls the pilot's Prisma models directly (a "no cross-module direct Prisma access" regression guard — this is the seed of the Stage 7 CI check, introduced manually/by code review here before it's automated).
- **Backward compatibility:** total — the same database, same tables, same migrations; only the calling convention inside the codebase changes.
- **Rollback:** revert the data-access consolidation commit; no data or schema is touched, so rollback is a pure code revert with no data-migration undo required.
- **Stop conditions:** if consolidating data access reveals a cross-domain direct-Prisma-access site this task's own evidence (§2) did not catch, stop, document it, and decide explicitly whether to fix it in this stage or defer it with a tracked exception.
- **Production verification:** same as Stage 3 — one full business day of stable metrics before Stage 5.

### Stage 5 — Move HTTP routes/jobs
- **Entry criteria:** Stage 4 stable. Per the independent finding in §1 ("Route wiring / central registration point"), `server/src/index.ts` mounts all 60 routers individually and flatly (`app.use('/api', xRoutes)` per file, no shared sub-router, no domain grouping) — so moving a domain's routes only requires touching that domain's own `import` line and its own `app.use` line in `index.ts`, with no ordering dependency on other domains' routes (route order only matters for the public/platform prefixes and the global `authenticate`/`csrfProtection` gate, which sits above all domain routes uniformly).
- **Changed-file categories:** the pilot's route file(s) relocate within their existing top-level folder if desired; `server/src/index.ts`'s corresponding `import`/`app.use` lines update to the new path; for imaging, the associated job (`jobs/imagingBridgeOfflineJob.ts`) and its registration in `jobs/startBackgroundJobs.ts` move together.
- **Tests:** full existing test suite for the pilot domain, plus a smoke test hitting each of the pilot's route paths through the actual Express app (closing the gap noted in §1: only 8 of 118 test files today use `supertest`/real HTTP — this stage is the natural point to add one for the pilot domain if it doesn't already have one).
- **Backward compatibility:** total if route paths (URLs) are unchanged — only the *file location* of the handler moves, not the API surface. No client-facing (frontend) change is required.
- **Rollback:** revert the `index.ts` and file-relocation commit; since URLs are unchanged, rollback is a same-day, low-risk operation.
- **Stop conditions:** if any route path itself needs to change (not just its file location) to fit the new structure, stop — that is a breaking-change decision requiring explicit sign-off, out of scope for an additive migration stage.
- **Production verification:** deploy; verify each moved route's health/error-rate is unchanged for one full business day; verify the moved job still fires on schedule (check `jobs/startBackgroundJobs.ts` logs/`JobLock` rows for the job's key).

### Stage 6 — Remove temporary compatibility imports
- **Entry criteria:** Stage 5 stable for at least one full business day; a full-repository grep confirms zero remaining imports of the pre-Stage-3 internal paths (only possible once Stage 3's compatibility re-export has had at least one full deploy cycle to prove nothing outside the pilot still uses it).
- **Changed-file categories:** deletion of the compatibility re-export(s) added in Stage 3; no other file changes.
- **Tests:** full existing test suite; a build/typecheck pass (`npm run typecheck`) is sufficient to catch any missed caller, since removing a re-export that's still imported anywhere is a compile-time error, not a silent runtime failure — this is the main safety property of doing this in TypeScript rather than plain JS.
- **Backward compatibility:** intentionally broken for the old internal path — but only after Stage 5 proved (via typecheck) that nothing still uses it.
- **Rollback:** revert the deletion commit; trivial.
- **Stop conditions:** if `npm run typecheck` fails after removing the compatibility shim, stop — do not force-delete the caller; either restore the shim or fix the caller as its own reviewed change.
- **Production verification:** deploy; no behavior change is expected (this stage removes dead code paths only), so verification is limited to confirming the deploy itself succeeded and the typecheck/build gates stayed green.

### Stage 7 — Enforce the boundary in CI
- **Entry criteria:** Stage 6 complete for at least the pilot domain; the boundary-enforcement mechanism selected in §5 is installed and passing locally against the current repository state (zero pre-existing violations for the pilot domain specifically; other domains may still have known, tracked violations, e.g. messaging's 9 `X` edges, which are pre-existing and out of this migration's scope to fix).
- **Changed-file categories:** one new devDependency (root `package.json` and, if the mechanism needs to run against `server/src` specifically, `server/package.json` too — see §5's finding that these are two separate npm projects, not an npm workspace), one new config file for the chosen tool, one new/updated CI job.
- **Tests:** the boundary-enforcement check itself, run against the full repository, with an explicit allowlist/baseline for all pre-existing violations outside the pilot domain (so Stage 7 does not silently require fixing unrelated domains' existing coupling as a side effect of protecting the pilot).
- **Backward compatibility:** total for runtime; this stage only affects CI/build-time checks, never production behavior.
- **Rollback:** revert the CI job addition; no application code is touched.
- **Stop conditions:** if the chosen tool produces false positives against the pilot domain's own legitimate platform-dependency imports (e.g. `db.js`, `middleware/*`, shared `utils/*` — see §2's "accepted platform dependency" (`P`) category already defined in `DEPENDENCY_MAP.md §8`), stop and adjust the tool's allowlist before merging the CI gate as blocking; do not merge a gate that would immediately require an unrelated emergency exception.
- **Production verification:** none required (CI-only change); the practical verification is that the next PR touching the pilot domain's files is correctly blocked (or correctly passes) by the new check — this should be exercised once, deliberately, with a throwaway test PR before relying on the gate for real changes.

## 5. Boundary enforcement options

**Current state (independently verified, no prior tooling exists to build on):**
- No ESLint config of any kind exists anywhere in the repository (`.eslintrc*`/`eslint.config.*` both absent); root `package.json`'s `lint` script (`eslint . --ext ts,tsx`) is effectively non-functional today — `eslint` is present in `package-lock.json` only as a transitive **peer** dependency of something else, not a real installed project dependency.
- No `dependency-cruiser`, `madge`, `ts-morph`, or `eslint-plugin-boundaries`/`eslint-plugin-import` anywhere in either lockfile (root or `server`).
- No `tsconfig` `paths` aliases on the server side at all (root frontend has one flat `@/*` alias; `server/tsconfig.json` has no `paths` field).
- CI coverage of the Node/TS code is narrow and path-filtered: the only two workflow files in the repository (`windows-bridge-pr.yml`, `windows-bridge-release.yml`) scope their Node/TS jobs to imaging-bridge paths only, and both those jobs run on `ubuntu-latest` (no Windows-runner cross-check for the JS/TS toolchain exists today, despite local development happening on Windows). **There is currently no CI job that would catch a boundary violation anywhere in the repository, even if rules were written today.**
- Package manager is npm throughout, with root and `server` as two **separate** npm projects (no `workspaces` field) — any new devDependency needs installing (and its lockfile regenerating) in both places if the check needs to run against both frontend and backend code.

**Options assessed (repository-compatible, none pre-selected because it "exists" elsewhere):**

| Option | Maintenance cost | Windows/Linux compat | CI cost | False-positive risk | Public/private contract expressiveness | Lockfile/supply-chain impact |
|---|---|---|---|---|---|---|
| TypeScript `paths` aliases alone | Low (config-only) | Full | None (compile-time only, no new tool) | Cannot actually *forbid* an import, only makes the "right" import shorter/nicer — no enforcement | None — aliases are a convenience, not a boundary check | Zero — no new dependency |
| ESLint + `eslint-plugin-boundaries` (or `no-restricted-imports`) | Medium — needs a working ESLint setup first, which does not exist today (real, non-trivial setup cost given the current broken `lint` script) | Full (pure JS, no native deps) | Low-medium (single `eslint` CI step, fast on incremental changes) | Medium — path-pattern rules can be too strict/loose without care; well-understood ecosystem so tunable | Good — `zones`/`element-types` config can express "module X may only import module Y's `public.ts`" directly | One new devDependency tree (`eslint` + plugin); needs adding to **both** root and `server` `package.json` per the no-workspace finding above |
| `dependency-cruiser` | Medium — one config file (`.dependency-cruiser.js`), runs as a standalone CLI, not tied to ESLint | Full (pure Node, cross-platform, no native deps) | Low (single CLI invocation in CI; can output a graph artifact too) | Low-medium — rule engine is explicit regex/path based, easy to reason about and unit-test the rules themselves | Good — can express "forbidden" (`error`) rules per folder pair directly, plus generate a visual graph for review, without needing ESLint at all | One new devDependency; same dual-install caveat as above |
| `madge` | Low (single-purpose: circular-dependency + graph output) | Full (pure Node) | Low | Low, but narrower — `madge` is primarily a circular-dependency detector/graph visualizer, not a general boundary-rule engine; would need to be paired with a custom script to actually fail CI on a forbidden edge | Weak on its own — no first-class "public/private contract" concept; useful as a *diagnostic* companion, not a primary enforcement mechanism | One new devDependency, same dual-install caveat |
| Custom static import checker (small Node script using TS's own compiler API or a regex/AST walk over `import` statements) | Medium-high upfront (bespoke code to write and maintain), low ongoing once written | Full (plain Node/TS, no native deps) | Low (fast, no external tool startup overhead) | Depends entirely on the quality of the bespoke script — highest risk of the checker itself having bugs, since it isn't a maintained, widely-used package | Fully customizable to this repository's exact taxonomy (e.g. can encode `DEPENDENCY_MAP.md`'s own `P`/`R`/`W`/`S`/`X` vocabulary directly) but that customization is also the maintenance burden | Zero new runtime dependency if built on the TS compiler API already in `devDependencies`; minimal supply-chain footprint |
| CodeGraph-based evidence checks | N/A | N/A | N/A | N/A | N/A | **Not evaluated as a candidate** — `RISK_REGISTER.md`/`CURRENT_PHASE.md` record at least six independent prior tasks in this program finding CodeGraph unavailable in their execution environment (e.g. "CodeGraph confirmed unavailable — `ToolSearch` zero matches, sixth+ independent confirmation this program"); recommending a mechanism already repeatedly confirmed unavailable in this environment would not be a credible recommendation. |

**Recommendation (independently recommended minimal candidate, not an accepted program decision):**

F2-PREP-005 must decide whether to adopt `dependency-cruiser`, a custom import checker, TypeScript path-based restrictions, or a future ESLint boundary-enforcement setup, and must record the resulting package/lockfile/supply-chain implications as an implementation concern at that time — nothing below commits the program to a tool.

- **Minimal first enforcement mechanism: `dependency-cruiser`.** It requires no prior working ESLint setup (avoiding the real cost of first fixing the repository's currently-broken `lint` script before boundary rules could even run), is pure Node with no native/Windows-compatibility risk, and its rule model maps directly onto the `P`/`R`/`W`/`S`/`X` vocabulary `DEPENDENCY_MAP.md` already defines — a `dependency-cruiser` "forbidden" rule per non-`P` cross-domain edge is a natural, low-friction translation of evidence this program has already produced, not a new taxonomy to invent. Ship it scoped to the Stage 7 pilot domain only at first (an allowlist/baseline covering every other domain's existing edges, most importantly messaging's 9 known `X` violations, so Stage 7 does not silently become "fix all of DEPENDENCY_MAP's findings" as an unplanned side effect).
- **Future option once the pilot(s) prove the pattern and appetite exists for a heavier setup: ESLint + `eslint-plugin-boundaries`.** This is the more expressive, more ecosystem-standard long-term choice (better `public.ts`/private-module contract modeling, wider community support, integrates with editor tooling for real-time developer feedback rather than only a CI-time check) — but it requires first fixing the repository's currently-non-functional ESLint setup, a real, separate, currently-unbudgeted piece of work this task does not recommend bundling into Stage 7 of the *first* pilot.
- `madge` is recommended as a lightweight **companion diagnostic** (circular-dependency detection, visual dependency graphs for architecture review) at any point, but not as the primary enforcement mechanism, since it lacks a first-class forbidden-edge/contract concept.
- A bespoke custom checker is not recommended as the *first* mechanism — the upfront authorship/maintenance cost is higher than adopting `dependency-cruiser`, and a hand-rolled checker is itself a new artifact this program would need to test and trust, working against the goal of a low-risk first pilot.

## 6. Target release waves

Waves are defined by measurable entry/exit gates, not calendar dates, per the task instruction.

**M0 — Preparation and boundary rules**
- Entry gate: this evidence document (F2-PREP-004) and its companion JSON exist and are merged; `DEPENDENCY_MAP.md §1–§9` target rules (already merged, F0-004) are the accepted baseline; `dependency-cruiser` is installed and its config exists (even if not yet CI-blocking).
- Exit gate: `dependency-cruiser` runs successfully (non-blocking, report-only) against the whole repository in CI at least once, producing a baseline violation count per domain (expected: 9 `X` edges pre-known from F0-004, plus whatever additional `R/W` edges `dependency-cruiser`'s own scan surfaces that the manual F0-004 pass didn't enumerate).

**M1 — Pilot module (recommended candidate: Imaging; recommended fallback: Billing; final choice made by F2-PREP-005)**
- Entry gate: M0 exit gate met; F2-PREP-005 has selected the pilot domain (from Imaging, Billing, External Calendar Integration, or a candidate from F2-PREP-002-R1 once it lands — §3); Stage 1 (ownership freeze) complete for the selected domain.
- Exit gate: Stages 1–7 (§4) all complete for the selected domain; `dependency-cruiser`'s CI check is **blocking** for that domain's own folder (zero tolerated new violations); the domain's route/service tests include at least one real-HTTP (`supertest` or equivalent) smoke test where none existed before (closing the gap noted in §1); one full business day of stable production metrics post-Stage-5 route move, documented.

**M2 — Low-coupling operational modules (Billing (if not already M1), Notifications, Integrations)**
- Entry gate: M1 exit gate met; the Stage 1–7 pattern has been exercised at least once end-to-end without a Stage-level stop condition being triggered (i.e., the pattern itself is validated, not just the pilot domain's code).
- Exit gate: all three modules pass Stages 1–7; `dependency-cruiser`'s blocking check covers all of M1+M2's folders; the two known tenant-scoping gaps found in this domain group (`PaymentPlanInstallment.clinicId`, `LabWorkOrderStatusHistory.clinicId`) are closed as part of Stage 4 for their respective modules; notifications' and inventory's zero-test-coverage gap (§2) is closed to at least a baseline level for any module in this wave that carries it forward (inventory is **not** included in M2 by default — see below — but if a future revision moves it here, its transactional coupling with patients, §2, must be resolved first, e.g. via an outbox pattern for stock deduction, not merely documented).
- **Explicit note:** Inventory is deliberately **not** placed in M2 despite superficially low import-level coupling, because its real coupling is transactional (§2, §3) and tied to patients, which is not yet modularized at this point in the sequence. It is deferred to M3 or later, contingent on patients' own boundary being addressed first (or on an explicit outbox/eventual-consistency redesign of `treatmentStockDeduction.ts` being done as its own prior step).

**M3 — Patient/appointment core**
- Entry gate: M2 exit gate met; explicit, separately-authorized design work exists for how the 9 cross-domain transactions identified in §2 (patients↔appointments↔integrations conversion flow, patients↔inventory↔notifications stock-deduction flow) will be handled post-modularization (outbox, saga, or an accepted "these two modules share a transaction boundary permanently" decision) — this design work is **not** part of this task's scope and is explicitly flagged as a prerequisite, not assumed solved by Stage 1–7 alone.
- Exit gate: patients and appointments both pass Stages 1–7 (adapted per the above design decision for their shared transactions); inventory (deferred from M2) is included here once its dependency on patients is resolved; `dependency-cruiser`'s blocking check extends to cover this wave's folders; zero new `X`-class (direct cross-module Prisma write bypassing the module's own contract) edges introduced by this wave, verified by the CI gate.

**M4 — Messaging/integrations (remaining)**
- Entry gate: M3 exit gate met; messaging's own KVKK-HIGH-007-class remediation work (tracked separately in `RISK_REGISTER.md`, outside this task's scope) has reached a stable, non-actively-churning state — i.e., this wave should not start while messaging's internals are still being actively rewritten for compliance reasons, per the same reasoning that excluded privacy/messaging from the first pilot (§3).
- Exit gate: messaging's 9 pre-existing `X` edges (§1.5, §3) are resolved or explicitly, individually accepted with a documented compensating control (not silently grandfathered); messaging passes Stages 1–7; the AI service-layer extraction (prompt/NLU/schema files, already DB-free per §2) is completed as a *service* module even though it was excluded from being a *first* pilot — this wave is the natural point for it, once messaging's own boundary is stable enough to define a real interface for AI to sit behind.

**M5 — Imaging (if deferred)/AI (data-adjacent parts)/high-risk providers**
- This wave exists for two possible cases, not both required: (a) if imaging was **not** chosen as M1 (i.e., billing was chosen instead per the fallback), imaging is completed here instead, using the same evidence and stage plan in §2–§4 unchanged; (b) any remaining high-external-provider-coupling surfaces not already covered by M4 (e.g. further hardening of the Meta/WhatsApp/Instagram/DigiDentiS provider-adapter boundaries specifically, as opposed to the messaging *conversation* logic already covered in M4).
- Exit gate: `dependency-cruiser`'s blocking check covers the full `server/src` tree; every one of the 10 candidate domains from this task's brief has a defined, enforced boundary; the ESLint+`eslint-plugin-boundaries` "future option" from §5 is re-evaluated at this point given the pattern's now-proven maturity, not committed to in advance.

## 7. Corrected next task

Await:
- **F2-PREP-002-R1**
- **F1-003-B2** completion/review status

(F2-PREP-001 and F2-PREP-003 have already merged — PR #276 and PR #277 respectively — and are no longer a dependency of this hand-off.)

Then execute: **F2-PREP-005 — Consolidated Modularization Charter**, which must:
- compare all pilot candidates (Imaging, Billing, External Calendar Integration, the CC-04 Appointment booking/cancellation command contract per merged F2-PREP-003, and any pilot candidate emerging from F2-PREP-002-R1);
- select the accepted pilot;
- select the first boundary-enforcement mechanism;
- define M0 entry criteria;
- update authoritative tracker/phase/index documents;
- authorize the first implementation task.

**This task does not authorize Imaging Stage 1 implementation, or any other code, schema, or migration change.**

## 8. Files changed by this task

Only the two evidence files below were created. No tracker/index/phase/code/manifest/schema/workflow file was modified.

- `docs/program/evidence/F2-PREP-004_MODULARIZATION_SEQUENCE_AND_PILOT_SELECTION.md` (this file, new)
- `docs/program/evidence/F2-PREP-004_modularization_sequence.json` (new)

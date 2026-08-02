# F2-PREP-005 — Consolidated Modularization Charter

Task: F2-PREP-005 · Phase: F2 PREPARATION — Modular Monolith Boundary Definition · Type: DOCUMENTATION, ARCHITECTURE CONSOLIDATION, AND DECISION PREPARATION ONLY. No application code, schema change, migration, boundary tooling, lint enforcement, module extraction, or production behavior change is made by this task.

Max status at authoring time: `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified. **F2 remains PREPARATION only — no implementation is authorized by this charter.**

Machine-readable companion: [architecture/evidence/F2-PREP-005_consolidated_modularization_charter.json](evidence/F2-PREP-005_consolidated_modularization_charter.json). Methodology/verification companion: [../evidence/F2-PREP-005_CONSOLIDATION_EVIDENCE.md](../evidence/F2-PREP-005_CONSOLIDATION_EVIDENCE.md).

---

## 1. Executive decision

- **Domain inventory reconciled:** 38 domains (37 inherited from the F0-003/F0-004 baseline + External Calendar Integration [`EXC`], added by F2-PREP-001), confirmed by direct count of F2-PREP-001's `domains[]` array.
- **Pilot decision:** **Imaging (`IMG` + `BRG`) is recommended by this charter as the primary modularization pilot**, subject to external review and explicit approval. This is **not yet an approved decision** — see Section 21 (Status separation).
- **Billing (`TRC`/`PAY`/`FIN`)** remains the fallback candidate but its favorability is **materially downgraded** relative to F2-PREP-004's original framing, because F2-PREP-002's deeper evidence (unavailable to F2-PREP-004 at scoring time) found significant direct-access violations and an unresolved ownership blocker in the same domain slice (see Section 6, contradiction C5).
- **External Calendar Integration (`EXC`)** was explicitly compared, as required, and scores competitively on several axes (cleanest existing provider-port shape, lowest coupling), but is **not selected** — primarily because it was never independently scored by F2-PREP-004, has no sourced test-coverage evidence, and is under unusually high recent development velocity (4 merged PRs touching it in the days immediately preceding this task's baseline), which raises execution risk for freezing a pilot contract right now.
- **CC-04** (Appointment booking/cancellation command) is treated strictly as a **contract-level candidate**, per program instruction and per ADR-015's own framing — it is not evaluated as a fourth domain-pilot candidate.
- **Tooling decision:** approve a narrow, report-only **dependency-cruiser proof-of-concept**, scoped to the Imaging pilot boundary only, once that boundary is formally defined. This is explicitly **not** a program-wide tooling decision and **not** production enforcement.
- **No implementation task is authorized by this charter.** The next task is a separate, explicitly-gated pilot-contract-definition task (Section 20).
- **F2 remains PREPARATION.** G1/G2 remain `NOT_APPROVED`. KVKK physical/architecture freeze remains `ACTIVE`. R-070/R-046 remain `OPEN`; R-071 remains `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`.

---

## 2. Task / phase / baseline

- **Task:** F2-PREP-005 — Consolidated Modularization Charter.
- **Phase:** F2 — Modularization Preparation (per `docs/program/phases/F2_MODULAR_BOUNDARIES.md`; status remains `TODO` for actual boundary *implementation* — this task performs preparation/consolidation only, consistent with that phase document's "Allowed work" / "Prohibited work" split).
- **Frozen execution baseline:** `3bd4014efb949a9a5cd413a8dc54018fa04b824a` — the merge commit of PR #268 (`feature/f1-003-p3-layered-ci-workflows`) into `main`. Verified at task start:
  - `git rev-parse origin/main` → `3bd4014efb949a9a5cd413a8dc54018fa04b824a` (origin/main currently *is* the frozen baseline — no divergence to reconcile).
  - `git cat-file -e 3bd4014efb949a9a5cd413a8dc54018fa04b824a^{commit}` → exit `0`.
- **Post-merge CI prerequisite, independently verified (not merely asserted):** `gh run view 30748646885 --repo MustafaBasol/DisKlinikCRM --json headSha,headBranch,event,conclusion,status,displayTitle` returned `headSha=3bd4014efb949a9a5cd413a8dc54018fa04b824a`, `event=push`, `headBranch=main`, `conclusion=success`, with all 9 `ci-layers` jobs (Layer 1 ×4, Layer 2, Layer 3, Layer 4, Layer 5 ×2) green. This is a genuine, distinct, later run than the pre-merge PR-branch run (`30747523882`) still cited by `CURRENT_PHASE.md`'s last narrative entry — see contradiction C8 in Section 6.
- **Isolated worktree/branch:** isolated worktree; local filesystem path intentionally omitted, branch `docs/f2-prep-005-consolidated-modularization-charter`, created from the frozen SHA above (`git worktree add -b ... 3bd4014e...`).
- **Main reconciliation:** not performed and not required. Per the task's own "Main reconciliation rule," a current-main merge is required only if a real file conflict exists, an accepted ADR changed, runtime/schema behavior changed in a way invalidating the pilot analysis, a tenant/KVKK assumption became invalid, or this task were analyzing the wrong code. None of those conditions apply — `origin/main` at task start *is* the frozen baseline. No reconciliation performed.

---

## 3. Authoritative inputs

**Program sources (read in full or via targeted extraction given file size):**
`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `ARCHITECTURE_DECISIONS.md`, `RISK_REGISTER.md`, `RELEASE_GATES.md`, `LAUNCH_GATES.md`, `evidence/README.md`.

**Preparation evidence (all 8 files, read in full):**
F2-PREP-001 (MD + JSON, domain ownership/boundary inventory), F2-PREP-002 (MD + JSON, cross-domain dependency/direct-access map), F2-PREP-003 (MD + JSON, feature intake/ClickUp mapping), F2-PREP-004 (MD + JSON, modularization sequencing/pilot selection).

**F1 CI prerequisite:** inspected only to establish availability (workflow `ci-main-and-nightly`, run `30748646885`, confirmed via `gh run view` — see Section 2). F1 itself is not redesigned, and F1's own full phase-exit status (including the separate, not-yet-started `F1-003-P4` sub-task) is explicitly **not** evaluated by this charter — see Section 17 (unresolved questions).

**CodeGraph usage:** none. No CodeGraph query was issued by this task. All cross-domain/dependency evidence used here is inherited from F2-PREP-002's own methodology (which itself substituted 7 parallel read-only research passes for CodeGraph, confirmed unavailable in this environment for at least the 7th time). This charter's own additional verification was limited to `git log`/`git cat-file`/`gh run view` (repository and CI metadata, not source-code graph traversal) and did not require expanding scope into new source roots.

---

## 4. Consolidation method

1. Independently verified the frozen baseline and its post-merge CI evidence (Section 2) rather than trusting the task brief's assertion alone.
2. Dispatched five parallel, read-only extraction passes (one per F2-PREP evidence pair, one for program governance docs) with an explicit instruction to quote/reproduce data faithfully and mark absent fields as "not present" rather than infer values — this preserves the "do not invent missing data" requirement at the source-extraction layer, not just at the synthesis layer.
3. Cross-checked each extraction against the others for numeric/factual agreement (domain counts, edge counts, PR/merge-commit facts) and recorded every disagreement found as an explicit, numbered contradiction (Section 6), with a stated resolution and severity rather than silently picking one source.
4. Where F2-PREP-004's original scoring pass was blind to F2-PREP-002 (by explicit task-design instruction, F2-PREP-004's original pass could not read F2-PREP-001/002/003), this charter re-tested F2-PREP-004's conclusions against F2-PREP-002's deeper evidence rather than accepting them at face value — this is what produced contradiction C5 (Billing) and the External Calendar Integration derivation (C6).
5. Built the canonical 38-domain table (Section 7) directly from F2-PREP-001's `domains[]` array (the only source with full per-domain field coverage), annotated with F2-PREP-002/003/004 findings only where those tasks' targeted scope actually covered a given domain — explicitly marked "not evaluated" elsewhere.
6. Scored the 3-way pilot candidate matrix (Section 8) by adopting F2-PREP-004's own 1–5 scale for continuity, explicitly re-deriving Imaging/Billing scores where F2-PREP-002 evidence materially changed the picture, and deriving External Calendar Integration's scores for the first time (clearly flagged lower-confidence).
7. Verified this document's own internal consistency (domain count sums to 38, every score cites a source) before finalizing.

---

## 5. Accepted findings

See `docs/program/architecture/evidence/F2-PREP-005_consolidated_modularization_charter.json` → `acceptedFindings` for the machine-readable list. In summary, all nine "Accepted preparation findings to preserve" listed in this task's own brief were checked against repository evidence and **none were disproven** — all nine stand, several with the additional nuance recorded in Section 6.

---

## 6. Reconciled contradictions

| ID | Title | Severity | Resolution (short) |
|---|---|---|---|
| C1 | "CC-04" naming collision: F0-004/F2-PREP-003/004's CC-04 (Appointment booking/cancellation command) vs. F2-PREP-002's own distinct "F2-CC-04" (ContactRequestCommand.upsert()) | Low | This charter uses "CC-04" only in the F0-004/ADR-015 sense. F2-PREP-002's F2-CC-04 is a different candidate needing renumbering in any future contract catalog. |
| C2 | F2-PREP-003's cached domain-taxonomy array shows 37 domains (EXC referenced only in narrative, not as a row) | Low | F2-PREP-001's own `domains[]` array independently confirmed 38. 38 stands; F2-PREP-003's array is an incomplete cached mirror. |
| C3 | F2-PREP-001's own ownership-ambiguity summary table marks `PAI`/`PIG`/`PCM`/`IMG` as "YES" while each domain's free-text field says ambiguity is "none" | Low | This charter trusts the more specific free-text field. Not corrected in F2-PREP-001 itself (not a proven factual error, just a table/field nuance). |
| C4 | F2-PREP-004 scored candidates using an informal 10-domain grouping, not F2-PREP-001's 38 canonical codes | Medium | This charter performs the first explicit remapping onto domain codes (see Section 8 `domainCodes` per candidate). |
| C5 | **Billing's pilot favorability is materially contradicted** between F2-PREP-004 (boundary clarity/coupling scored 5/5, import-level analysis) and F2-PREP-002 (8 of 18 edges CROSS_DOMAIN_VIOLATION, 3 Critical direct-access sites, the audit's single largest ownership-ambiguity finding) | **High** | Billing's fallback status is preserved but downgraded from unconditional to **conditional on remediating BIL-17 and BIL-08/09/10 first**. This directly satisfies the task instruction not to rubber-stamp F2-PREP-004's ranking. |
| C6 | External Calendar Integration was never scored by F2-PREP-004 | Medium | This charter performs a first-pass, explicitly lower-confidence derivation from F2-PREP-001/002 evidence (Section 8), with several criteria marked "insufficient evidence" rather than invented. |
| C7 | Governance docs stale: `F2_MODULAR_BOUNDARIES.md` still says `TODO` (untouched since 2026-07-17); `NORAMEDI_MASTER_TRACKER.md`/`evidence/README.md` have zero entries for F2-PREP-001..004 despite all four being merged | Medium | This charter adds minimal, additive, git-history-sourced entries to close this gap (Section 20 / deliverables 4–7). |
| C8 | `CURRENT_PHASE.md`'s last entry still narrates "PR #268 open" | Low | Expected self-referential lag (a commit's own docs cannot know its future merge status). Independently confirmed merged via `git cat-file`/`gh run view`. Not a real contradiction. |

None of these required reopening F2-PREP-001 through F2-PREP-004 — none of their substantive evidence was found demonstrably invalid, only in need of reconciliation (which is this task's designated job).

---

## 7. Canonical domain classification (38 domains)

Classification buckets are this charter's synthesis of F2-PREP-001's own `classification` field (which uses a different vocabulary — `core platform` / `core clinical` / `optional operational` / `external adapter/integration` / `planned/not implemented`) into the six buckets required by this task's brief. The mapping itself is recorded here for traceability, not asserted as a silent fact. "Not evaluated" means F2-PREP-002's targeted scope did not cover that domain — this is stated explicitly rather than inventing a dependency/coupling figure.

Legend: **F2P1** = F2-PREP-001 · **F2P2** = F2-PREP-002 (edge/site IDs) · **F2P3** = F2-PREP-003 (backlog item count) · **F2P4** = F2-PREP-004 (only 10 of 38 domains scored).

| Code | Domain | Classification | Owner root(s) (F2P1) | Public surface / Private internals (F2P1) | F2P2 direct-access finding | Tenant/KVKK/Security (F2P1) | ClickUp demand (F2P3) | Modularization readiness / pilot suitability |
|---|---|---|---|---|---|---|---|---|
| IDA | Identity and Access | Shared kernel | `routes/auth.ts`; `middleware/auth.ts`,`csrf.ts` | `AuthenticatedUserContext` (implicit) | Not independently covered as its own edge set (referenced via INF-16, SAME_DOMAIN_ALLOWED) | HIGH/MEDIUM-HIGH/HIGH | 0 | High fan-in root; not a pilot candidate (foundational, not isolable). |
| ORG | Organization/Clinic/User Membership | Shared kernel | `clinicRegistration.ts`,`organizationBranches.ts`,`organizationDashboard.ts`,`users.ts` | `ClinicDirectory`/`OrganizationDirectory` candidate | INF-12: transaction-integrity defect (no `$transaction` across clinic+userClinic create), Medium | HIGH/HIGH/HIGH | 0 | High fan-in root; not a pilot candidate. |
| TSC | Tenant Security and Scope | Shared kernel | `middleware/clinicAccess.ts`,`utils/clinicScope.ts`,`tenantGuard.ts`,`relationGuards.ts` | De-facto contract already; no dedicated routes | Not in F2P2 targeted scope as its own edge set (used throughout as the scoping mechanism) | HIGH/N-A/LOW-INDIRECT | 0 | Cross-cutting utility; not a pilot candidate. |
| PRM | Permissions/Roles | Shared kernel | `utils/roles.ts` | `PermissionCheck` candidate (not formalized — inline role checks today) | Not in F2P2 targeted scope | HIGH/N-A/LOW-INDIRECT | 0 | Cross-cutting utility; not a pilot candidate. |
| AUD | Audit and Activity | Shared kernel | `utils/activity.ts`,`auditLog.ts` | `AuditService.record()` (de-facto contract) | PAT-04/PAT-18 (as target/reader): SAME_DOMAIN_ALLOWED / one duplicated-scoping TEMPORARY_DIRECT_ACCESS (operationalMonitoring.ts) | HIGH/HIGH/LOW | 0 | Cross-cutting utility; not a pilot candidate. |
| PRV | Privacy/Consent/Retention/DSR | Shared kernel | `patientPrivacy.ts`,`gdprExport.ts`,`clinicBulkExport*`,`services/privacy/*`,`communicationConsent/*` | Consent/Privacy evidence service candidate (split today across `channelConsentGate.ts`/`redaction.ts`) | **Heaviest fan-out in the repo.** PAT-08 (patient anonymization, 12+ writes, no `$transaction`, **Critical**), PAT-09 (cross-tenant retention sweep into Messaging tables, **Critical**), PAT-13 (consent fields written by 5 domains, no shared writer, **High**) | HIGH/HIGH/HIGH | 0 | Not a pilot candidate — highest-risk, highest-coupling domain in the program; any pilot boundary must treat it as an accepted cross-cutting exception, not a target. |
| SEC | Security Incident Response/Detection | Infrastructure concern | `platformSecurityIncidents.ts`,`services/security/*` | `SecuritySignalIngest` candidate | PAT-05/06 (as target, correct usage pattern), Low | HIGH/N-A/LOW | 0 | Newest domain (3 commits of history); not a pilot candidate — too immature. |
| CFG | Configuration and Secrets | Infrastructure concern | `routes/settings.ts`,`platformSettings.ts`,`secrets.ts`,`encryption.ts` | none proposed | Not in F2P2 targeted scope | HIGH/HIGH/LOW | 0 | Cross-cutting utility; not a pilot candidate. |
| OBS | Observability/Operational Events | Infrastructure concern | `operationalMonitoring.ts`,`operationalEventService.ts` | `OperationalEvent.emit()` (de-facto contract) | INF-13 (Ops-Monitoring reads Messaging tables directly for health summary), Medium | MEDIUM/MEDIUM-HIGH/LOW | 0 | Cross-cutting utility; not a pilot candidate. |
| EVQ | Shared Events/Queue/Idempotency | Shared kernel | `messagingInboundIdempotency.ts`,`jobLock.ts`,`concurrency.ts` | Provider-agnostic by design (schema comment) | Not in F2P2 targeted scope | HIGH/LOW/LOW | 1 (F2P3-item, wave 2) | Cross-cutting utility; not a pilot candidate. |
| STG | Storage Abstraction | Infrastructure concern | `fileStorage.ts`,`fileBackupService.ts`,`fileSignature.ts` | `StoragePort`/`FileBackupPort` candidates | INF-08/PZ-IMG-03: whole-DB `pg_dump`/`pg_restore` via raw shell, RBAC **unverified**, **Critical** | HIGH/N-A/LOW-INDIRECT | 0 | Shared infrastructure; not a pilot candidate, but PZ-IMG-03 must be triaged before any Imaging pilot proceeds (Section 14). |
| NTF | Notifications | Infrastructure concern | `routes/notifications.ts`,`notificationPreferences.ts`,`taskAssignmentNotifier.ts` | none proposed | INF-14: 4-domain cross-read into own table, PUBLIC_CONTRACT_CANDIDATE, Medium | LOW/HIGH/LOW | 0 | Supporting/cross-cutting; not evaluated as a pilot by any F2-PREP task. |
| PAD | Platform Administration | Infrastructure concern | `platformAdmin.ts`,`backupService.ts`,`platformAuth.ts` | none proposed | PAT-07: ~20 routes with **zero service layer**, direct into Org/Clinic/User/Plan, **High**; PAT-09 (retention sweep orchestrator) | HIGH/LOW/HIGH | 0 | Not a pilot candidate — largest "zero-service-layer" hotspot in the audit; a strangler target for a *future*, not first, pilot. |
| PAT | Patients | Core domain | `patients.ts`,`patientsImport.ts`,`attachments.ts` | `PatientDirectory`/`PatientReferenceQuery` candidate | PAT-01/02/15: divergent tenant-scoping implementation in same file, Medium; MSG-01/02/03: 3 independent patient find-or-create implementations from inbound messaging, **High** | HIGH/HIGH/HIGH | 1 | Explicitly excluded as first pilot by F2P4 (lowest scores of all 10 candidates: BC=2,CC=2). Central, highest-blast-radius domain. |
| APT | Appointments and Availability | Core domain | `appointments.ts`,`appointmentRequests.ts`,`schedules.ts`,`noShows.ts` | `AppointmentReferenceQuery`, `AppointmentCompleted` event | **Highest violation density of any domain**: MSG-06/APT-20/22 double-booking race (**Critical**), MSG-08 tenant-isolation defect via `getDefaultClinic()` (**Critical** — top remediation item in the whole program) | HIGH/HIGH/HIGH | 3 | Explicitly excluded as first pilot by F2P4 (BC=1, CC=1 — lowest of all 10). CC-04 (contract-level) is the recommended first contract *within* this domain, not a domain-pilot claim. |
| TRC | Treatment Cases | Core domain | `treatmentCases.ts`,`treatmentPackages.ts` | `ProcedureCompleted` event (shared with DEN) | BIL-03/04/07: duplicated, non-atomic inventory-deduction logic, **High**; BIL-16: reads TreatmentCase shape from Patients route, Medium | MEDIUM/HIGH/HIGH | 1 | Part of the "Billing" scoring group (Section 8) — conditional fallback, not primary. |
| DEN | Dental Chart/Procedures | Core domain | `dentalChart.ts`,`treatmentPlanProcedures.ts`,`treatmentStockDeduction.ts` | `ProcedureCompleted` event | BIL-05/06: writes directly into Inventory's stock ledger, **High**; atomic only because always caller-tx-wrapped | MEDIUM/HIGH/HIGH | 0 | Not independently scored; tightly coupled to the Billing/Inventory boundary question (BIL-17). |
| PUB | Public Booking | **Unresolved** | `publicBooking.ts` | none proposed | INF-18: wide but tightly-scoped unauthenticated read footprint, Medium | LOW/N-A/LOW-INDIRECT | 0 | F2P1 explicitly flags independent-domain status as unresolved, deferred to ADR-015 — not a pilot candidate until that's settled. |
| PAY | Basic Payments | Core domain | `payments.ts`,`paymentPlans.ts`,`overdueInstallments.ts` | `PaymentReceived` event | BIL-08: installment payoff, 3 sequential writes, no `$transaction`, **Critical/Immediate** | MEDIUM/HIGH/MEDIUM | 0 | Part of the "Billing" scoring group — this is the source of the single most severe finding downgrading Billing (Section 6, C5). |
| TSK | Tasks and Follow-up | Core domain | `routes/tasks.ts` | none proposed | Not in F2P2 targeted scope as its own edge set | LOW/HIGH/LOW | 0 | Not evaluated as a pilot by any F2-PREP task. |
| WHA | Messaging — WhatsApp | External integration | `whatsapp.ts`,`whatsappInbox.ts`,`metaWhatsAppWebhook.ts` | Messaging send/automation command candidate | **Source of 9 of F2P2's `X`-severity (WHA/IGM→PAT/APT) violations** — MSG-01/07/08/09, all High-Critical; explicitly the transitional exception preserved by ADR-015 | MEDIUM/HIGH/HIGH | 0 | F2P4 excludes as unsuitable (BC=1, CC=1, ProvCoupl only 1). Highest fan-out "god module" per DEPENDENCY_MAP.md §10.3 (106 edges). |
| IGM | Messaging — Instagram | External integration | `instagramInbox.ts`,`instagramWebhook.ts` | shares WHA's messaging-command candidate | MSG-03/MSG-05/06 (mirrors WHA's patient-creation and booking-race defects) | MEDIUM/HIGH/HIGH | 0 | Same exclusion rationale as WHA. |
| SMS | Messaging — SMS | External integration | `routes/sms.ts`,`services/sms/*` | none proposed | MSG-04: outbound-only, lower risk than inbound AI paths, Medium | MEDIUM/HIGH/HIGH | 0 | Not independently scored by F2P4; smaller surface than WHA/IGM. |
| EML | Messaging — Email | External integration | `emailService.ts`,`emailTemplates.ts` | none proposed | Not in F2P2 targeted scope | LOW/N-A/LOW-INDIRECT | 0 | Not evaluated; F2P1 flags genuine ambiguity whether this deserves independent-domain status at all. |
| AIO | Messaging AI Orchestration | **Unresolved** | `whatsappConversationAgent.ts`,`whatsappInterpreter.ts`,`googleAiStudio.ts` | `AiProvider`/`AiGateway` candidate (ADR-009, PROPOSED) | Not independently broken out from WHA in F2P2's edge list | MEDIUM/N-A/LOW-INDIRECT | 1 | F2P1 explicitly flags unresolved sub-boundary vs. IGM's own AI processor. Part of F2P4's "AI" group — excluded as unsuitable (BC=1, CC=1). |
| REC | Automations/Reminders/Recall | Supporting domain | `recall.ts`,`postTreatment.ts`,`recallCandidateService.ts` | Consumes `ProcedureCompleted`/`AppointmentCompleted` (once they exist) | APT-15/16: reads cross-domain Treatment/Billing signals + correct centralized consent-gate usage | MEDIUM/HIGH/HIGH | 0 | Not independently scored; "god module" fan-out per DEPENDENCY_MAP.md §10.3. |
| IMG | Imaging — Server Ingest and Viewer | Supporting domain | `routes/imaging.ts`,`services/imaging/{imagingRequestTransitions,imagingUploadValidation,releaseMetadataValidation}.ts` | `ImagingStudyReceived` event candidate | IMG-01..15: **8 SAME_DOMAIN_ALLOWED, 1 Low-risk violation (IMG-09) — cleanest FK-heavy domain profile in the audit** | MEDIUM/HIGH/HIGH | 0 | **Selected primary pilot candidate** (Section 8/9). |
| BRG | Imaging — Device Bridge/Windows Bridge | External integration | `imagingBridgePublic.ts`,`services/imaging/bridge*.ts` | Provider-port/adapter — already anti-corruption-boundary-shaped | IMG-01/PZ-IMG-01: well-hardened public contract, tenant derived server-side only, currently correct | MEDIUM/HIGH/HIGH | 1 (CI flakiness bug, not a feature signal) | Grouped with IMG for the pilot decision (Section 8). Existing isolated-CI precedent (`windows-bridge-pr.yml`). |
| INV | Inventory | Supporting domain | `routes/inventory.ts`,`inventoryAlerts.ts` | Inventory stock-adjustment command/event candidate | IMG-10/PZ-IMG-02: read-modify-write race on stock count, no row lock, Medium; BIL-05 (Treatment writes directly into Inventory's ledger) | LOW/HIGH/LOW | 0 | F2P4 explicitly excludes from Wave M2 by default ("real coupling is transactional and tied to patients"). |
| INS | Insurance | Supporting domain | `routes/insuranceProvisions.ts` | none proposed | Read-only target only (BIL-15/PAT-14 privacy exports); no dedicated edges | LOW/HIGH/HIGH | 0 | Not evaluated as a pilot by any F2-PREP task. |
| FIN | Advanced Finance — Compensation/Payouts | Supporting domain | `financeDashboard.ts`,`compensationRules.ts`,`practitionerPayouts.ts`,`earningService.ts` | none proposed | BIL-09/10/PZ-BIL-02/03: payout create/delete, no `$transaction`, **Critical/Immediate** (both directions) | MEDIUM/HIGH/MEDIUM | 0 | Part of the "Billing" scoring group — source of 2 of the 3 Critical findings driving C5's downgrade. |
| RPT | Reporting/Analytics | Supporting domain | `reports.ts`,`dashboard.ts`,`organizationDashboard.ts` | Reporting read-model/query boundary candidate | INF-09/10/11: widest single-route cross-domain read footprint in the audit (9+ models), High (INF-10) | LOW/N-A/LOW-INDIRECT | 0 | Purely a cross-cutting read surface; no dedicated Prisma models — not a pilot candidate in the conventional sense. |
| LAB | Dental Laboratory/Prosthetics Tracking | Supporting domain | `laboratories.ts`,`labOrders.ts`,`labOrderStatusTransitions.ts` | none proposed | IMG-09: reads `labWorkOrder` directly for overdue digest, Low; IMG-13: one of three attachment-delete paths with no legal-hold gate | LOW/HIGH/HIGH | 0 | Not independently scored by F2P4; clean profile within the IMG evidence slice. |
| PAI | AI Platform/AI Gateway | **Unresolved** (planned/not implemented) | `googleAiStudio.ts` (only generic AI-provider file) | `AiProvider`/`AiGateway` (ADR-009, PROPOSED) | Not applicable — not implemented | LOW/N-A/LOW-INDIRECT | 1 | Not built; classification genuinely undetermined until ADR-009 lands. |
| PIG | Integration Platform (Official/Ministry Adapters) | **Unresolved** (planned/not implemented) | none | Integration connector port (ADR-010, PROPOSED) | Not applicable — not implemented | LOW/N-A/LOW-INDIRECT | 1 | Not built. |
| PBL | Billing/Subscription Engine | **Unresolved** (planned/not implemented) | none | none proposed | Not applicable — not implemented | 1 (`DISCOVERY_REQUIRED`, `inferred` confidence, no ADR ownership) | Not built. F2P3 explicitly flags: no ADR/phase doc claims ownership — a genuine planning gap, not filled by this charter. |
| PCM | Campaign Mgmt/Health Tourism/Invoicing | **Unresolved** (planned/not implemented) | none | none proposed | Not applicable — not implemented | LOW/N-A/LOW-INDIRECT | 1 | Not built. Same ownership gap as PBL. |
| EXC | External Calendar Integration | External integration | `platformExternalCalendar.ts`,`externalCalendarWebhook.ts`,`services/externalCalendar/*` | `ExternalCalendarSync` command/port — already provider-factory-shaped | INF-01..06/APT-11/23: mostly SAME_DOMAIN_ALLOWED or PUBLIC_CONTRACT_CANDIDATE; only INF-04 is a soft violation (calls Messaging directly), Medium | HIGH/HIGH/MEDIUM-HIGH | 0 | **Explicitly compared as a pilot candidate (Section 8/9), not selected** — cleanest existing shape but unscored by F2P4, no test-coverage evidence, high recent change velocity. |

**Count check:** 7 shared kernel (`IDA,ORG,TSC,PRM,AUD,PRV,EVQ`) + 6 infrastructure concern (`SEC,CFG,OBS,STG,NTF,PAD`) + 6 core domain (`PAT,APT,TRC,DEN,PAY,TSK`) + 6 unresolved (`PUB,AIO,PAI,PIG,PBL,PCM`) + 7 supporting domain (`REC,IMG,INV,INS,FIN,RPT,LAB`) + 6 external integration (`WHA,IGM,SMS,EML,BRG,EXC`) = 7+6+6+6+7+6 = **38**. ✓ Verified programmatically against the table, see `F2-PREP-005_CONSOLIDATION_EVIDENCE.md`.

---

## 8. Candidate decision matrix

Scale: 1–5, 5 = most favorable for an early/first pilot (adopting F2-PREP-004's own convention for continuity). Full per-criterion evidence citations are in the JSON companion (`candidateScores`). Summary:

| Criterion | Imaging (`IMG`+`BRG`) | Billing (`TRC`/`PAY`/`FIN`) | External Calendar Integration (`EXC`) |
|---|---|---|---|
| Boundary clarity | 5 | 3 *(revised down from F2P4's 5 — see C5)* | 4 |
| Current coupling | 5 | 3 *(revised down from F2P4's 5 — see C5)* | 5 |
| Direct private access | 4 | 2 | 4 |
| Tenant/KVKK/security risk | 4 | 4 | 3 |
| Production criticality (5=safe to pilot) | 4 | 3 | 4 |
| Data ownership clarity | 5 | 2 *(BIL-17 blocker)* | 4 |
| Migration complexity (5=simple) | 4 | 4 | 5 |
| Rollback feasibility | 5 | 5 | 5 |
| Test coverage | 3 | 3 | **no evidence (null)** |
| CI suitability | 5 *(existing isolated-CI precedent)* | 3 | 3 |
| Independent change cadence (5=stable) | 5 | 3 | 2 *(high recent velocity — see evidence)* |
| External protocol/adaptor pressure | 3 | 5 *(none today)* | 5 *(defining characteristic)* |
| Future deployment independence | 4 | 2 | 4 |
| ClickUp/business demand | 1 | 2 | 1 |
| Boundary demo without distributed monolith | 3 | 4 | 5 |
| **Sum (of 14 scored; test coverage excluded for EXC)** | **59** | **48** | **58** (14 criteria) |

Note on the near-tie between Imaging (59/14≈4.21 avg) and EXC (58/14≈4.14 avg): the sum alone does not decide the pilot — see Section 9 for the qualitative reasoning (evidence depth, change-cadence risk, and test-coverage gap) that breaks the tie in Imaging's favor despite the close numeric score. This is deliberate: a numeric sum is not, by itself, a substitute for judgment about evidence *confidence*, which differs sharply between the two (Imaging's scores are F2-PREP-004-sourced and F2-PREP-002-corroborated; EXC's are a first-pass derivation by this charter alone).

CC-04 (Appointment booking/cancellation command) is **not scored in this matrix** — it is a contract-level candidate within Appointments, not a domain-pilot candidate, per Section 1 and ADR-015.

---

## 9. Pilot decision

**Decision: Imaging (`IMG` + `BRG`) as primary pilot.**

**Decision confidence: MEDIUM-HIGH.** Not maximum, because: (a) Imaging's own test-coverage gap is unresolved and unquantified; (b) F2-PREP-002's V1–V5 security-validation sequence has not been triaged by any task, including this one; (c) External Calendar Integration is a legitimate, evidence-supported close alternative that was simply never scored as deeply — its numeric total is within one point of Imaging's.

**Rejected alternatives:**
- **Billing as primary pilot:** rejected. F2-PREP-002 found 8 of 18 Billing-slice edges are `CROSS_DOMAIN_VIOLATION`, 3 Critical-priority non-atomic financial-write direct-access sites, and the audit's single largest ownership-ambiguity finding (`BIL-17`). Retained only as a *conditional* fallback (Section 6, C5).
- **External Calendar Integration as primary pilot:** rejected, not disqualified. It scores competitively, but this charter declines to promote an unscored, actively-churning, test-coverage-unknown domain over a domain (Imaging) that has two independent, mutually-reinforcing evidence streams (F2-PREP-002 *and* F2-PREP-004) both pointing the same direction.
- **No pilot approved, additional evidence required:** considered and rejected as the decision *of this charter*, because Imaging's evidence base is judged sufficient to *recommend* a pilot — but note carefully: this charter's recommendation is not itself an approval (Section 21). If the external reviewer judges Imaging's test-coverage gap or the untriaged V1–V5 sequence disqualifying, "no pilot approved" remains the correct fallback outcome at the approval gate, not at this charter's recommendation stage.

**Conditions that would reverse this decision:**
- If a future, F2-PREP-004-depth scoring pass on External Calendar Integration shows it materially outperforms Imaging once test coverage and change-cadence stabilize.
- If Imaging's own untested surfaces (F2-PREP-004 §3, point 6) are characterized and found to hide a defect comparable in severity to Billing's `BIL-08`/`BIL-09`/`BIL-10`.
- If PZ-IMG-03 (`backupService.ts` whole-database restore, RBAC unverified, Critical) is investigated and found to implicate Imaging's own boundary rather than Storage/Platform-Admin's.

**Dependencies:** see JSON `pilotDependencies`. Summarized: KVKK baseline-stable declaration status (not re-verified here), triage of PZ-IMG-03, and a separately-authorized pilot-contract task (Section 20) before any code change.

**Blockers:** no test-coverage baseline for Imaging's untested paths; untriaged V1–V5 security validation sequence; boundary-tooling decision is POC-only at this stage (Section 12).

**Measurable success criteria (for a *future*, separately-authorized pilot-contract task, not this charter):**
- Zero new direct-Prisma-access sites into Imaging's owned models from outside the domain, verified via the dependency-cruiser POC in report-only mode.
- All existing Imaging callers (Patients read, Privacy lifecycle exception, Notifications digest) migrated onto a named contract without behavior change, verified by the existing test suite plus new characterization tests.
- No regression in the 9-job `ci-layers` pipeline.

**Non-goals:** this charter does not authorize splitting Imaging into a separate deployment unit; does not authorize removing the Windows bridge agent's existing separate-process architecture (that is pre-existing, not new); does not authorize touching Billing, External Calendar Integration, Messaging, or any other domain's code; does not authorize resolving `BIL-17`, `PZ-IMG-03`, or any top-20 remediation item.

---

## 10. Selected pilot boundary charter (Imaging)

Full detail in JSON `publicContractSummary`. Summary:

- **Owned data/models:** `ImagingStudy`, `ImagingImage`, `ImagingRequest`, `ImagingDevice`, `ImagingBridgeAgent`, `ImagingBridgePairing` (per F2-PREP-001's `ownedPrismaModels`, not independently re-verified against `schema.prisma` line-by-line by this charter).
- **Owned commands:** study/image ingest (`routes/imaging.ts`); bridge pairing/heartbeat/upload (`routes/imagingBridgePublic.ts` — already a well-hardened de-facto public contract per F2P2 `IMG-01`/`PZ-IMG-01`).
- **Owned queries:** study/image listing and retrieval.
- **Owned events:** `ImagingStudyReceived` (proposed, not yet implemented).
- **Allowed inbound callers:** Patients (read-only enrichment), Privacy (KVKK lifecycle fields on `PatientAttachment`/`ImagingImage` — an accepted, documented, to-be-formalized exception, not a violation), Notifications (overdue-lab-adjacent digest, currently a Low-risk violation to be formalized).
- **Allowed outbound dependencies:** Patients/Appointments/TreatmentCase via the existing shared `relationGuards.ts` read-only pattern; the shared Storage abstraction.
- **Forbidden direct access:** no domain outside Imaging (and the documented Privacy exception) may write directly to Imaging's owned Prisma models; the bridge public API must keep deriving `clinicId` only from the server-matched agent record, never client input.
- **Transaction boundary:** all of Imaging's own `$transaction` sites remain domain-internal (a property already true today and must not regress).
- **Tenant context:** `clinicId` always server-derived, never trusted from client input — already true for the bridge's `PZ-IMG-01` site and must be preserved.
- **Authorization:** existing `authorize([...])` role middleware and bridge bearer-token + `status!='revoked'` checks, unchanged.
- **Audit:** any new lifecycle-affecting operation must route through the existing `AUD`-domain audit utility.
- **Error contract, idempotency, backward compatibility, strangler path, rollback boundary, test contract, observability:** see JSON for full detail — none of these are designed to implementation-readiness by this charter; they are named as requirements a future pilot-contract task must satisfy.
- **Deployment boundary decision: remain inside the modular monolith.** No separate-process candidate is proposed for Imaging's server-side code. The Windows bridge agent already runs as a genuinely separate process on clinic-local hardware — a pre-existing, accepted architecture, not a new decision made here.

---

## 11. Cross-domain access policy

No direct cross-domain private access may be accepted as the desired target anywhere in the program — this principle is unchanged and is not weakened by this charter. F2-PREP-002's ranked top-20 remediation list (8 Critical, 7 High, 5 Medium) is carried forward as **unresolved program backlog**, not resolved by this charter. The Critical tier — non-atomic installment payoff and payout create/delete, non-atomic patient anonymization, the cross-tenant retention-sweep coupling into Messaging tables, the legacy WhatsApp `getDefaultClinic()` tenant-resolution defect, and the WhatsApp/Instagram booking-concurrency race (×2) — requires **separate authorization** to remediate. This charter does not authorize any of it. Cross-domain interaction must move toward accepted public contracts via the additive, expand-migrate-contract path (Section 15), never a big-bang cutover (explicitly prohibited by `F2_MODULAR_BOUNDARIES.md`).

---

## 12. Boundary-tooling decision

**Decision: approve a specific tooling POC — `dependency-cruiser`, report-only, scoped initially to the Imaging pilot boundary only, once that boundary is formally defined.** This is explicitly a POC, not production enforcement, and not a program-wide decision.

**Why not the alternatives:** no functional ESLint configuration exists anywhere in this repository today (`eslint-plugin-boundaries` therefore requires first fixing a separately-scoped gap); CodeGraph-based enforcement is confirmed unavailable in this environment (≥7 independent prior confirmations); TypeScript path aliases cannot actually forbid an import; `madge` is recommended only as a companion diagnostic, not primary enforcement; a custom checker carries higher authorship/maintenance cost than adopting an existing tool. `dependency-cruiser` is the only tool evaluated in any depth by any F2-PREP task — it appears nowhere in F2-PREP-001/002/003.

**Acceptance criteria the POC itself must satisfy** (full list in JSON `toolingAcceptanceCriteria`): TypeScript/ESM compatibility with zero source changes; correct behavior across the root/`server/` two-project split (no npm workspaces exist); near-zero false-positive rate against Imaging's already-documented clean boundary; support for an explicit allowlist covering accepted transitional exceptions (e.g. Privacy's lifecycle-field access); no material addition to CI execution time; deterministic output; a reviewable, non-bespoke config format; incremental, domain-by-domain scope widening (never repository-wide at once); report-only before any blocking mode; and a trivial rollback path (delete the config file and CI step — it is a dev-time tool only, never a runtime dependency).

A tooling POC is not production enforcement. Moving from report-only to CI-blocking mode is a **separate, explicitly required approval**, not an automatic consequence of the POC succeeding.

---

## 13. Sequencing and approval gates

Every step below requires separate approval before execution. This charter authorizes none of them past Step 1 (external review of this charter itself).

| # | Step | Approval required |
|---|---|---|
| 1 | External review and approval of this charter | Yes |
| 2 | Pilot contract task: formalize Imaging's public contract (Section 10), no code change | Yes |
| 3 | Characterization tests closing Imaging's test-coverage gap, before any refactor | Yes |
| 4 | `dependency-cruiser` POC, report-only, scoped to Imaging | Yes |
| 5 | Additive facade/public API alongside existing direct-call paths | Yes |
| 6 | Caller migration (Patients, Privacy, Notifications) onto the new contract, one at a time | Yes |
| 7 | Enforcement in warning mode | Yes |
| 8 | Enforcement in blocking mode (only after warning-mode POC shows near-zero false positives over a meaningful period) | Yes |
| 9 | Deprecation/contract cleanup — remove the old direct-access path | Yes |
| 10 | Production verification — confirm no behavior change | Yes |

---

## 14. Tenant/security/KVKK impact

**This charter itself has zero runtime, tenant, security, or KVKK impact** — it is documentation only. It does not close any existing risk. Specifically:

- **Tenant isolation:** unaffected. Existing defects (e.g. `MSG-08`'s legacy WhatsApp `getDefaultClinic()` cross-tenant issue, F2-PREP-002's #1 remediation item) remain `OPEN`, unaddressed here.
- **KVKK physical/architecture freeze:** remains `ACTIVE`, untouched. No physical/schema change proposed.
- **Auth/RBAC:** unaffected; the Imaging boundary charter (Section 10) requires preserving existing checks, not changing them.
- **Audit:** unaffected; any future contract must route through the existing audit utility.
- **Storage:** `PZ-IMG-03` (whole-database restore, RBAC unverified, Critical) remains open and is explicitly named as a pilot dependency, not resolved here.
- **Queues:** `EVQ`/ADR-006/007 (`NEEDS_POC`) unaffected by the pilot decision.
- **AI:** `AIO`/`PAI` out of scope for this pilot decision.
- **Imaging:** selected as pilot domain; selection does **not** close `PZ-IMG-02` (inventory race) or `PZ-IMG-03`.
- **Official integrations:** `PIG` remains planned/not-implemented, unaffected.
- **Transaction integrity:** Billing's non-atomic findings (`BIL-08`/`09`/`10`) remain open, explicitly named as a fallback-candidate blocker.

This charter does not claim to close any implementation risk anywhere in the program.

---

## 15. Migration/backward-compatibility principles

Preserve the modular-monolith direction; no framework rewrite; no microservice split for organizational cleanliness alone; no Kafka/Kubernetes/database-per-tenant/schema-per-tenant; no new independent deployment unit without a measurable, accepted trigger (none exists today for Imaging or any other domain). Prefer additive, expand-migrate-contract evolution: introduce a named contract alongside existing direct-call paths (expand), migrate callers one at a time (migrate), then remove the old path only once every caller has moved (contract) — never a simultaneous cutover. Every future implementation step must be backward-compatible during its own transition window and independently revertible.

---

## 16. Rollback principles

This charter itself is fully revertible — a documentation-only PR against `main`, not merged; reverting removes only the files this task's diff touches. Every future implementation step in Section 13 must independently satisfy: single-commit-revertible where feasible (consistent with this program's established pattern, e.g. F1-003-B2's own stated rollback approach), additive-first so a revert never strands data, and no destructive schema change without a separately approved expand-migrate-contract plan of its own.

---

## 17. Risks and unresolved questions

See JSON `risks` and `unresolvedQuestions` for the full machine-readable list. Key open questions this charter deliberately does **not** resolve:

- Whether External Calendar Integration warrants a full F2-PREP-004-depth scoring pass before being finally set aside as a near-term alternative.
- Whether `BIL-17` (Service/AppointmentType dual identity) must be resolved independent of any pilot decision — it blocks *any* future Billing/Treatment/Scheduling split, not just a Billing pilot.
- Whether F2-PREP-002's V1–V5 security validation sequence is a pre-F2 blocker, a pilot prerequisite, or normal remediation backlog — F2-PREP-002 explicitly deferred this triage to F2-PREP-005, and **this charter does not perform it**, recording it as an open gap rather than silently resolving it.
- `ContactRequest` ownership (Appointments vs. a channel-agnostic intake domain) — flagged `OWNERSHIP_AMBIGUOUS` by both F0-004 and F2-PREP-001/002, unresolved.
- Whether `PBL`/`PCM` are in scope for the program at all — no ADR or phase document claims ownership.
- Whether F1-003-P4's eventual outcome could retroactively affect any assumption in this charter — not evaluated, explicitly out of scope.

---

## 18. ClickUp coverage limitation

**0 of 17 F2-PREP-003 backlog items are ClickUp-derived.** ClickUp access is `UNAVAILABLE_IN_THIS_ENVIRONMENT` / `PENDING_EXTERNAL_IMPORT` (no ClickUp MCP tool is connected). The 17-item set is a repository-evidence-only sample (GitHub issues, phase-document backlog categories, planned-domain epics, one legacy roadmap item) mapped to proposed owning domains — it is a **weak, partial** signal, useful only to note that a given domain has *at least* the cited number of repository-visible items pointing at it.

**Explicitly unsupported by this data:** total feature-backlog size, relative business priority across domains, or true customer/feature-demand volume. The 17-item set — and by extension the "ClickUp/business demand" row in Section 8's matrix — **must never be read as validated demand evidence**. All three pilot candidates score low-to-weak on this axis (Imaging 1, Billing 2, External Calendar Integration 1) precisely because none has real demand evidence behind it yet, not because demand is known to be low.

---

## 19. Explicitly prohibited interpretations

This charter must **not** be read as:

- Authorizing Imaging Stage 1 implementation, or any code/schema/migration change to any domain.
- Installing, configuring, or running `dependency-cruiser` (or any tool) against the actual codebase.
- Approving G1 or G2, or asserting F2 implementation is authorized.
- Closing R-070, R-046, or R-071, or altering the KVKK physical/architecture freeze.
- Resolving `BIL-17`, `PZ-IMG-02`, `PZ-IMG-03`, or any other F2-PREP-002 finding.
- A final, program-approved selection of Imaging as pilot — it is this charter's **recommendation**, subject to external review (Section 21).
- A claim that External Calendar Integration is unsuitable as a future pilot — it is explicitly not selected *now*, for stated, reversible reasons (Section 9).
- A claim that Billing is disqualified as a fallback — it remains eligible, conditional on remediating the findings in Section 6 (C5).
- A recommendation to treat CC-04 as a domain-pilot decision — it remains strictly contract-level.
- A recommendation to split any domain into a separate deployment unit. Domain boundary ≠ deployment boundary throughout this document (Section 10's explicit "remain inside modular monolith" decision).
- Full ClickUp backlog coverage, or a statement of total product demand (Section 18).

---

## 20. Exact next task

**Not yet authorized.** Proposed identifier: **F2-PREP-006 — Imaging Pilot Boundary Contract Definition** (exact numbering to be confirmed by the program owner). Gated on: (1) external review and approval of this charter; (2) explicit approval of the Imaging pilot selection specifically (not merely acknowledgment of this document); (3) no code, schema, or migration change until that gate passes. Explicitly not authorized by this charter: Imaging Stage 1 implementation; installing `dependency-cruiser` in the actual codebase; any CI enforcement job; Billing or External Calendar Integration pilot work; resolution of `BIL-17`, `PZ-IMG-03`, or any other open finding.

---

## 21. Status separation

- **Agent completed:** yes.
- **Validation passed:** yes — see `F2-PREP-005_CONSOLIDATION_EVIDENCE.md` for exact commands and results (JSON parse, domain-count reconciliation, `git diff --check`, link/path spot-check).
- **PR opened:** yes, against `main`, at the end of this task.
- **Merged:** **no.**
- **Deployed:** **no** (not applicable — documentation only).
- **Production verified:** **no** (not applicable).
- **F2 implementation authorized:** **no.**
- **G1 approved:** **no** (`NOT_APPROVED`, unchanged).
- **G2 approved:** **no** (`NOT_APPROVED`, unchanged).
- **Pilot selection status:** **RECOMMENDED by this charter, not yet approved.**

Overall: `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`.

# F2-GUARDRAIL-VAL-001 — Architecture Guardrail Signal-Quality Validation

**Phase:** F2 — Modular Monolith Guardrails, Entitlements and Feature Flags
**Task type:** Read-only validation and evidence. Repository-only. No runtime application behavior changed, no Prisma schema/migration touched, no dependency added, no blocking CI enforcement introduced.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Isolated worktree/branch: `docs/f2-guardrail-val-001-signal-quality` (local path intentionally omitted as non-portable environment metadata, matching this program's established convention).

---

## 1. Baseline verification (independently confirmed, not assumed)

| Fact | Verified value |
|---|---|
| `git fetch origin` | run at task start |
| `origin/main` SHA | `9b10bc9fde0ceaeb58d90860a950143de7123910` |
| PR #323 | `gh pr view 323` → `state: MERGED`, `mergeCommit.oid: 9b10bc9fde0ceaeb58d90860a950143de7123910` (exact match to the assigning brief), `mergedAt: 2026-08-05T11:47:37Z`, base `main`, head `feature/f2-guardrail-impl-001-report-only-exact-edge` |
| PR #323 merge commit == `origin/main` tip | confirmed — `git rev-parse origin/main` returns the identical SHA |
| `git merge-base --is-ancestor 9b10bc9f... origin/main` | exit 0, confirmed ancestor (trivially true — it is the tip) |
| Main CI | `gh run view 31002888303` → `workflowName: ci-main-and-nightly`, `headSha: 9b10bc9fde0ceaeb58d90860a950143de7123910` (exact match), `status: completed`, `conclusion: success` |
| F2-GUARDRAIL-IMPL-001 marked complete in program docs | Confirmed in `NORAMEDI_MASTER_TRACKER.md` (row 21, Change history) and `CURRENT_PHASE.md` (`F2-GUARDRAIL-IMPL-001` entry): implementation description, 56/74 test progression, real-scope scan result, all present |

**Discrepancy note (not a stop condition):** the source evidence file's own header (`F2-GUARDRAIL-IMPL-001_EXACT_EDGE_GUARDRAIL_IMPLEMENTATION.md`) still reads its task-status line as `PR_OPENED (once opened) — NOT_MERGED`, because that document was authored before PR #323 merged. This task independently re-confirmed via `gh pr view 323` that the PR has since merged with passing main CI — the stale status line in that prior evidence file is a normal artifact of authoring-time-vs-current-time drift, not a factual conflict requiring a stop. It is called out here so a future reader does not need to re-discover it.

Worktree created via `git worktree add -b docs/f2-guardrail-val-001-signal-quality origin/main`, HEAD confirmed at `9b10bc9` before any file was written. `npm ci` succeeded (427 packages, matching the prior implementation task's own count).

## 2. Scope discipline

This task is validation-first and read-only with respect to the guardrail tool, scan roots, and any application code. The only files added by this task are: this evidence file, its machine-readable manifest/report companions under `docs/program/evidence/tooling/`, a small reproducible sampling script under `scripts/architecture-guardrail-validation/`, and status-reconciliation edits to the four program-control documents named in the assigning brief. No file under `scripts/architecture-guardrail/{lib,cli.ts,config}` was modified. No file under `server/src/` was modified. No Prisma schema/migration touched. No new npm dependency.

## 3. Exact current guardrail scan command and raw report

```
npm run guardrail:scan -- --repo-sha=9b10bc9fde0ceaeb58d90860a950143de7123910 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json
```

Run unchanged against the current tool exactly as merged by PR #323 — no scanner code was modified before this measurement, per the task's own "measure before touching" instruction.

**Exact current report counts (re-measured on current `origin/main` @ `9b10bc9`):**

| Field | Value |
|---|---|
| Files discovered / parsed / skipped | 247 / 247 / 0 |
| Total findings | 1,031 |
| `NEW` | 1,018 |
| `EXISTING` | 13 |
| Errors | 0 |
| Warnings | 0 |
| Exit code | 0 |

These counts are **identical** to the counts previously documented for `origin/main` @ `da23f6f` (the commit F2-GUARDRAIL-IMPL-001 itself scanned). This is expected: no scan-root, domain-map, or source file under the five authorized roots changed between `da23f6f` and `9b10bc9` (the intervening commits were program-documentation-only). The counts are re-measured here, not assumed, per the task's explicit instruction not to assume they remain identical.

**Determinism check:** two independent `--deterministic` runs over the same commit produced byte-identical JSON (404,173 bytes each, `diff` clean). **Secret scan:** `grep -EiI '(api[_-]?key|secret|password|token|bearer|-----BEGIN)'` against the raw report matches only benign symbol/domain names (`getSecret`, `core-config-secrets`) — no actual secret value present. **Absolute-path scan:** `grep -EiI '([A-Za-z]:[\\/]|/(home|Users|mnt)/)'` against the raw report — zero matches. Raw report checked in at `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_raw_scan_report.json`.

## 4. Sampling methodology

Stratified, rule-based, **fully deterministic** selection — no randomness, no timestamp dependency. The exact rules are implemented in `scripts/architecture-guardrail-validation/buildSample.js` (checked in) and produce a byte-identical manifest on every re-run against the same raw report (independently verified: two runs, `diff` clean).

Strata covered, per the task's required minimum list:
- **`ALL_EXISTING_BASELINE_MATCHED`** — all 13 `EXISTING` findings included (100% coverage of this stratum).
- **`DECLARED_OWNERSHIP_COLLISION:<target>`** — up to 3 findings from each of the 4 F0-003-declared multi-domain files.
- **`HIGH_FREQUENCY_EDGE_FAMILY:<key>`** — first/middle/last member of each of the top 25 `(ownerDomain, targetModelOrSymbol, accessKind)` families by count, which together account for 76.3% of all 1,031 findings (see §7).
- **`LOW_FREQUENCY_HIGH_RISK_EDGE_FAMILY:<key>`** — one member of every family with ≤3 findings touching a high-risk domain (`core-tenant-security`, `core-identity-access`, `core-permissions-roles`, `core-security-incident-detection`, `core-config-secrets`, `core-audit-activity`, `core-privacy-consent-retention-dsr`) or a named sector domain (messaging/imaging/finance/inventory/reporting/privacy).
- **`CALLER_PATH_FAMILY_COVERAGE`** — every one of routes/services/jobs/middleware/utils topped up to ≥8 samples.
- **`OWNER_DOMAIN_COVERAGE`** / **`CALLER_DOMAIN_COVERAGE`** — at least 1 sample per distinct target-owning and caller-owning domain, **including `UNRESOLVED`**.
- **`NAMED_SECTOR_COVERAGE`** — messaging-whatsapp/sms/email/instagram/ai-orchestration/automation, imaging-server-viewer/device-bridge, finance-advanced-compensation, clinical-basic-payments, inventory, reporting-analytics, core-privacy-consent-retention-dsr topped up to ≥4 each.

**Sample size:** 169 findings (required minimum: `max(120, ⌈10% of 1,031⌉) = max(120, 104) = 120`; 169 exceeds this by 41%). Coverage achieved: 28 of the 30 distinct owner (target) domains present in the full population; all 13 `EXISTING` findings; all 4 declared ownership-collision files (10 sample instances total).

**Reproducibility:** `node scripts/architecture-guardrail-validation/buildSample.js` regenerates `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_sample_manifest.json` byte-for-byte from the checked-in raw report — independently re-run twice during this task, confirmed identical. The manifest is checked in with a stable `findingId` (the guardrail's own SHA-256-derived semantic ID) and an explicit `selectionReasons` array per sample recording every stratification rule that selected it.

## 5. Classification methodology

Every one of the 169 sampled findings was classified by directly reading the caller file's actual import statement/line and the target file's actual content and header documentation — never from symbol/file names alone, per the task's explicit instruction. Classification work was split into 5 domain-scoped batches, each independently reading source and cross-referencing existing accepted evidence (`F2-GUARDRAIL-PREP-010-A/B/C` baselines, `F0-003` module-ownership inventory, `F2-PREP-001/002/006-*` imaging/cross-domain inventories) where a finding appeared to already have prior classification history. **CodeGraph was not available in this environment** — consistent with every prior task in this program (F2-GUARDRAIL-PREP-010-A, F2-GUARDRAIL-IMPL-001) — so classification used direct source reads, `grep`, import resolution, and the guardrail's own JSON output; no CodeGraph evidence is claimed anywhere in this document.

All 169 classifications were independently cross-checked against the sample manifest: **0 missing, 0 extra, 0 duplicates** (verified programmatically).

## 6. Classification taxonomy used

The 9-category taxonomy from the assigning brief (A–I), used verbatim. Full per-finding evidence (`findingId`, `callerPath`, `callerSymbol`, `ownerDomain`, `targetModelOrSymbol`, `accessKind`, exact source line/range, target-file summary, classification, rationale, accepted-contract reference, security/tenant impact, recommended disposition, confidence) for all 169 sampled findings is checked in at `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-001_classified_sample.json`.

## 7. Classification counts (n = 169)

| Code | Category | Count | % of sample |
|---|---|---:|---:|
| C | `EXPECTED_PLATFORM_SHARED_EDGE` | 87 | 51.5% |
| B | `EXPECTED_PUBLIC_CONTRACT_EDGE` | 50 | 29.6% |
| F | `DOMAIN_CLASSIFICATION_FALSE_POSITIVE` | 15 | 8.9% |
| H | `LEGACY_TECHNICAL_DEBT` | 9 | 5.3% |
| D | `DATA_OWNERSHIP_REVIEW_REQUIRED` | 7 | 4.1% |
| A | `REAL_BOUNDARY_VIOLATION` | 1 | 0.6% |
| E | `PARSER_FALSE_POSITIVE` | 0 | 0.0% |
| G | `GENERATED_OR_TOOLING_NOISE` | 0 | 0.0% |
| I | `SECURITY_OR_TENANT_HIGH_RISK` (as **primary**) | 0 | 0.0% |

**Secondary-tag high-risk count:** 56/169 (33.1%) carry `SECURITY_OR_TENANT_HIGH_RISK` as a primary-or-secondary tag. This figure is **inflated relative to the full population** by design — the sampling rules deliberately over-weighted high-risk/tenant/security domains (§4) to guarantee coverage of every collision and risk category, not to estimate their true population share. It should be read as "every high-risk family we looked for, we found and classified," not as "33% of all 1,031 findings are high-risk."

## 8. Enforcement-readiness metrics

| Metric | Formula | Value |
|---|---|---:|
| Precision (strict — A only) | A / n | 0.6% |
| Precision (actionable — A+H, i.e. real-or-legacy-debt findings requiring eventual code change) | (A+H) / n | 5.9% |
| False-positive rate (scanner/classification error — E+F+G) | (E+F+G) / n | 8.9% |
| Expected-edge rate (legitimately-designed cross-domain use — B+C) | (B+C) / n | 81.1% |
| Ownership-ambiguity rate | D / n | 4.1% |
| High-risk finding count (primary I or secondary tag) | — | 56 (33.1%, oversampled — see §7) |

**Top 10 noisy (false-positive) target families** (by finding count in sample, all `DOMAIN_CLASSIFICATION_FALSE_POSITIVE`; 0 `PARSER_FALSE_POSITIVE` and 0 `GENERATED_OR_TOOLING_NOISE` were found anywhere in the sample):

1. `services/inventoryUnitConversion.ts` (3) — same-domain (inventory) file simply missing from the domain map; caller is itself in the `inventory` domain.
2. `services/imaging/releaseMetadataValidation.ts` (3) — BRG-internal shared helper mapped to `imaging-server-viewer` by path prefix; both real callers are BRG-owned per `F2-PREP-006-A/E`.
3. `utils/inboundRateLimiter.ts` (1) — purpose-built for the WhatsApp-AI inbound path, co-located with its only caller, missing from the map.
4. `services/reports/revenueByPeriodQuery.ts` (1) — extracted same-domain (`reporting-analytics`) helper, missing from the map.
5. `services/sms/smsCommunicationPurposeMap.ts` (1) — same-domain (`messaging-sms`) helper, missing from the map.
6. `services/whatsapp/humanHandoffPhrases.ts` (1) — same-domain (`messaging-whatsapp`) helper, missing from the map.
7. `services/whatsappAvailability.ts` (1) — generic slot-duration constant now also consumed by the public-booking widget; over-narrow domain assignment.
8. `utils/messageSanitizer.ts` (1) — file's own header states it is channel-agnostic shared infra for all inbound channels; mislabeled `messaging-whatsapp` by directory heuristic.
9. `services/sms/smsTemplating.ts` (1) — same-domain (`messaging-sms`) type import, missing from the map.
10. `utils/webhookVerification.ts` (1) — generic Meta webhook-subscription-verification protocol with no channel-specific coupling; mislabeled `messaging-whatsapp` by directory heuristic.

(11th: `utils/patientName.ts` — generic Turkish name-formatting utility with zero patient-model access, mislabeled `clinical-patients` by filename heuristic; its only real callers are messaging files.)

**Top credible violation/debt families** (`A`/`H`, i.e. real or accepted-legacy findings):

1. `services/earningService.ts` (2 sample instances) — matches already-documented baseline edge `CDA-049` (`LEGACY_ALLOWLISTED_DIRECT_ACCESS`): a fire-and-forget `.catch(console.error)` write of practitioner-compensation data with no retry/reconciliation path.
2. `routes/organizationDashboard.ts` (1, the sole `A`) — `financeDashboard.ts` reaches directly into another domain's *route* module to reuse a generic `getDateRange()` date-math helper that has no dashboard-specific logic — an avoidable structural violation independent of that file's separate declared ownership collision (§9).
3. `services/whatsapp/MetaCloudWhatsAppProvider.ts` (1) — a documented, self-acknowledged simplification: a retry job directly instantiates a concrete provider class instead of going through the provider-factory abstraction used elsewhere.
4. `services/imaging/imagingRequestTransitions.ts` (1) — matches `F2-PREP-006-A`'s own documented finding: a BRG route imports IMG domain logic directly, no facade; Stage 2 imaging work (currently `BLOCKED`) already plans to close this via a shared `ingestImagingStudyCore()`.
5. `services/imaging/bridgeOnboardingConfig.ts` / `services/imaging/bridgeTokens.ts` (1 each) — both are known BRG-owned admin routes physically co-located inside `routes/imaging.ts`, per `F2-PREP-006-A`'s finding F-01, scheduled for Stage 5 physical relocation.
6. `services/inventoryAlerts.ts` (1) — matches baseline edge `CDA-050`: `treatmentStockDeduction.ts` calls into inventory's low-stock alert function inside its own caller-supplied transaction; already folded into the proposed `F2-CC-08` `InventoryStockDeductionPort`.
7. `services/appointmentRequestNotification.ts` (1) — matches baseline edge `CDA-058`, itself noted as "already largely contract-shaped, low actual coupling risk."
8. `routes/attachments.ts` (1) — matches baseline edge `CDA-046`/`IMG-07`: a reversed-layering import (a service pulling a size-limit constant from a route file), already flagged with a recommended fix (extract to a neutral config module).

**All 9 `H`-classified findings in the sample trace to an already-documented, previously-accepted baseline entry or program-evidence finding** (`CDA-049`, `CDA-050`, `CDA-046`, `CDA-058`, or `F2-PREP-006-A/E`'s own BRG-in-`imaging.ts` findings). **Zero genuinely new legacy-debt discoveries** were made by this validation beyond what prior evidence tasks already knew. Only **one** genuinely new, previously-undocumented `REAL_BOUNDARY_VIOLATION` was found in the entire 169-finding sample (`getDateRange`, above).

**Percentage of findings explainable by a small number of repeated patterns:** the top 25 `(ownerDomain, targetModelOrSymbol, accessKind)` families (out of 115 distinct families in the full 1,031-finding population) explain **76.3%** of every finding in the report. The single largest family alone (`core-identity-access` / `middleware/auth.ts`, the universal auth-gate import) is 110 findings (10.7% of the entire report) by itself.

**NEW-vs-EXISTING baseline-match trustworthiness (important limitation, found during this validation):** of the 12 sampled findings that this task's manual review independently confirmed match an already-*accepted* baseline entry (cited by its `CDA-0xx` ID), **all 12 (100%) were flagged `NEW` by the guardrail's own baseline-comparison logic**, not `EXISTING`. This is a direct, measured consequence of the guardrail's own documented match-key limitation (§12 of the implementation evidence: `callerSymbol` is excluded from the match key, and matching otherwise requires an exact or glob `callerPath` match) — it is not a bug, but it means the 1,018/13 `NEW`/`EXISTING` split materially **undercounts** how many findings are already-known-accepted patterns. The true "already accepted, just not machine-matched" share is higher than 13/1,031 — this sample alone independently re-confirms 12 such cases, and they are almost certainly a small fraction of the true total given the 50 `B`-classified (`EXPECTED_PUBLIC_CONTRACT_EDGE`) findings in the sample overall.

## 9. Ownership collision reconciliation

The implementation reported exactly 4 files F0-003 itself lists under more than one domain (`config/domain-map.json`'s own `provenance.ambiguousFilesMappedToUnresolved` field). Each is reconciled below using `F0-003_MODULE_OWNERSHIP_EVIDENCE.md`/`.json`, which already contains authoritative prior analysis for all 4 — none required new investigation from first principles.

| # | Path/symbol | Candidate domains | Nature of the collision | Recommendation |
|---|---|---|---|---|
| 1 | `server/src/utils/encryption.ts` | `core-config-secrets` vs. `core-privacy-consent-retention-dsr` | **Not a genuine dispute.** F0-003's own `shared_utilities_classification` explicitly lists this file as a **"true platform primitive, correctly placed"** (`F0-003_MODULE_OWNERSHIP_EVIDENCE.md:202`; JSON `classification: "cryptography — true platform primitive"`). Every one of the 10 sampled findings targeting it in this task was independently classified `C` (`EXPECTED_PLATFORM_SHARED_EDGE`), reused identically by WhatsApp, Instagram, SMS, and platform-admin callers. | **Shared/platform classification** (map correction) — reclassify from `UNRESOLVED` to a dedicated platform/shared domain (e.g. `core-platform-crypto`), not left dual-owned. |
| 2 | `server/src/utils/secrets.ts` | `core-config-secrets` vs. `core-privacy-consent-retention-dsr` | Identical situation to #1 — same F0-003 "true platform primitive" classification, same generic env-secret-accessor content, same cross-domain reuse pattern confirmed by this task's sample (platform-admin, imaging-bridge, WhatsApp-webhook callers). | **Shared/platform classification** (map correction), same as #1. |
| 3 | `server/src/services/treatmentStockDeduction.ts` | `clinical-dental-chart-procedures` vs. `inventory` | **Not really an ownership dispute either — the file's location is already settled.** F0-003 explicitly documents (`F0-003_module_ownership_inventory.json:409,720`) that this file is **physically located under `clinical-dental-chart-procedures`'s own service list**, and separately, that it **writes `InventoryTransaction` (an Inventory-owned model) directly** — already named a known "transitional... candidate for an Inventory stock-adjustment command." The dual-domain listing in F0-003 reflects "who writes here" (Inventory) vs. "who owns this file" (Dental Chart/Procedures), not genuine uncertainty about either. This task's own sample independently reconfirms the substantive cross-domain write (3 findings classified `D`, secondary content genuinely dual-domain — see below). | **Map correction**: assign `ownerDomain = clinical-dental-chart-procedures` (its settled physical location) instead of `UNRESOLVED`. The underlying cross-domain **write** into `InventoryTransaction` is separately real, already-tracked technical debt (F0-003's own "Inventory stock-adjustment command" candidate) — this reconciliation does not close that debt, only removes the false "ownership is unknown" framing. |
| 4 | `server/src/routes/organizationDashboard.ts` | `core-org-clinic-membership` vs. `reporting-analytics` | **The one genuine, unresolved content-level ambiguity of the four.** F0-003 lists it under `core-org-clinic-membership`'s own `routes` (org-administration route file) **and** under `reporting-analytics`'s own `routes`, whose `maturity` field F0-003 itself records as `"shared/ambiguous"` — this is a mixed-responsibility file serving two genuinely different concerns (org/branch/user administration, and org-wide dashboard/reporting metrics), not a data-access-pattern artifact like #1–#3. | **Deferred ADR decision** — this is the one collision this task recommends an explicit program-owner decision for (either split the file along its two responsibilities, or formally declare a primary domain with the reporting use as a documented secondary responsibility). Not resolved by this task. |

**No code or config change is made by this task for any of the 4** — per the task's own default ("do not implement the recommendation unless it is a trivial evidence-only config correction and clearly within this task"), and because #4 genuinely requires a program-owner ADR decision, applying #1–#3's config corrections alone (skipping #4) would leave the domain-map inconsistent mid-change. All 4 recommendations are handed to a follow-up task (§14).

### A larger, distinct issue found during this validation: domain-map coverage gaps (not declared collisions)

Separately from the 4 declared collisions, this task discovered that **308 of the 1,031 findings (29.9%)** have `ownerDomain = UNRESOLVED` — but only a small minority of those trace to the 4 declared collisions above. The remaining majority (**23 distinct target files, ~250+ of the 308 findings**) are `UNRESOLVED` because those files are **simply absent from the 179-entry `domain-map.json`** — F0-003 never catalogued them at all — which is a completely different failure mode from a declared multi-domain dispute. The scanner's own `classifyDomain()` (`scripts/architecture-guardrail/lib/classification.ts`) intentionally maps *any* file missing from the config to the same `UNRESOLVED` sentinel used for genuine collisions, conflating the two.

The 27 distinct `UNRESOLVED`-target files found in the full 1,031-finding population, by finding count: `db.ts` (100), `utils/helpers.ts` (72), `schemas/index.ts` (46), `utils/encryption.ts` (16, declared collision #1), `utils/prismaSelects.ts` (15), `services/inventoryUnitConversion.ts` (8), `utils/safeError.ts` (6), `utils/secrets.ts` (5, declared collision #2), `services/treatmentStockDeduction.ts` (5, declared collision #3), and 18 further files each contributing 1–4 findings.

This task's sample (46 `UNRESOLVED` findings, spanning all 27 target files) classified the overwhelming majority of these as `C`/`B` (legitimate shared/platform infrastructure or a designed contract, just missing from the map) — e.g. `db.ts` (the single shared Prisma client), `schemas/index.ts` (the shared zod-validation barrel), `utils/prismaSelects.ts` (reusable Prisma `select` shapes), `utils/safeError.ts` / `utils/logRedaction.ts` (generic log-hygiene helpers) are all textbook platform-shared code that happens not to be in the map. A handful (`services/inventoryUnitConversion.ts`, `services/reports/revenueByPeriodQuery.ts`, `services/sms/smsCommunicationPurposeMap.ts`, `services/whatsapp/humanHandoffPhrases.ts`) are same-domain code missing from the map (classified `F`, domain-classification false positives, not real violations). None were classified as new real violations.

**Recommendation (follow-up, not applied by this task):** extend `domain-map.json` to cover these 23 additional files — the large majority (`db.ts`, `utils/helpers.ts`, `schemas/index.ts`, `utils/prismaSelects.ts`, `utils/safeError.ts`, `utils/logRedaction.ts`) as a new explicit platform/shared pseudo-domain, and the same-domain files (`inventoryUnitConversion.ts`, `smsCommunicationPurposeMap.ts`, `humanHandoffPhrases.ts`, etc.) to their obvious owning domain by co-location. This alone would very likely eliminate the majority of the 308 `UNRESOLVED`-target findings without requiring any new ownership judgment calls, since virtually all of them are mechanically derivable from where the file already lives and who already calls it. Separately, `services/communicationConsent/*` (5 files, ~10 sample findings, all classified `B`) has **zero** entries in the domain map at all and needs a new domain entry of its own (it did not exist, or was out of scope, when F0-003 was authored) — its own module documentation already names it clearly (KVKK-HIGH-007 communication-consent), so this is a low-ambiguity addition, not an ADR-level decision.

## 10. Enforcement readiness assessment

Per the assigning brief, blocking enforcement may not be proposed unless **all** of the following are true. Assessed against this task's own evidence:

| Criterion | Status | Basis |
|---|---|---|
| False-positive rate acceptably low and justified | **NOT MET** | 8.9% measured domain-classification-false-positive rate in-sample, but this undercounts the real issue: 29.9% of the *entire population* has an `UNRESOLVED` target domain, overwhelmingly due to a data-completeness gap (§9), not code defects. Until the domain-map coverage gap is closed, a large minority of every future scan will misreport `UNRESOLVED` findings that a corrected map would resolve to `C`/`B`. |
| Ownership collisions resolved | **NOT MET** | All 4 declared collisions remain `UNRESOLVED` in the checked-in config; this task only produces recommendations (§9), none applied. |
| Expected public-contract edges can be encoded reliably | **NOT MET** | 81.1% of the sample is legitimately expected (`B`+`C`), and 12 of those independently trace to already-accepted `CDA-0xx` baseline entries — but the guardrail's own `NEW`/`EXISTING` mechanism failed to recognize any of those 12 as `EXISTING` (§8). No allowlist/encoding mechanism beyond the baseline-JSON comparison currently exists to durably register a reviewed-and-accepted edge so it stops appearing as `NEW` on every future run. |
| Baseline semantics stable | **PARTIALLY MET** | The scan is deterministic and reproducible (§3) and the baseline-comparison algorithm itself is unchanged and well-documented, including its own acknowledged `callerSymbol`-exclusion limitation. The semantics are *stable* but *known to be lossy* in a way that materially affects the `NEW`/`EXISTING` split's trustworthiness (§8). |
| New-vs-existing classification trustworthy | **NOT MET** | Directly measured in §8: 12/12 sampled already-accepted edges were misreported `NEW`. |
| High-risk tenant/security paths have dedicated tests | **NOT INDEPENDENTLY VERIFIED BY THIS TASK** | Out of this task's scope to newly write or audit application-level tests; several high-risk findings in the sample (e.g. `utils/clinicScope.ts`, `middleware/auth.ts`, `services/security/securityDetectionRules.ts` edges) cite existing accepted-contract references with known dedicated test files from prior evidence tasks (`F2-GUARDRAIL-PREP-010-B`), but this task did not itself re-run or audit those tests. |
| Rollback and emergency-disable mechanism exist | **MET** | The guardrail's own CI job (`architecture-guardrail-report-only`) is a standalone Layer 1 job, in no other job's `needs:` list, `continue-on-error` not used only for itself, exit-0-regardless-of-findings by design (F2-GUARDRAIL-IMPL-001 §13/§14/§17) — a tool failure or removal cannot gate application tests, and rollback is a plain file/workflow revert with no runtime/DB component. |
| Program owner explicitly authorizes enforcement | **NOT MET** | Not obtained by this task; this task is validation evidence only, not an authorization request. |

**Enforcement readiness: `NOT_READY`.**

This is consistent with the guidance that a `NOT_READY` conclusion is an acceptable, expected outcome. The signal quality is **substantially better than the raw 1,018-`NEW` headline count suggests** — 81.1% of the reviewed sample is legitimate/expected, and true actionable findings are rare (0.6%–5.9% depending on how "actionable" is scoped) and already known from prior evidence tasks in every case but one. But two concrete, low-ambiguity data-quality gaps (the 23-file domain-map coverage gap, and the `NEW`/`EXISTING` match-key undercount) must close before the report's own `NEW`/`EXISTING`/`UNRESOLVED` fields can be trusted as a promotion signal, and the 4 ownership collisions and program-owner sign-off remain open regardless.

## 11. Scanner change policy — no changes made

Per the default policy ("no scanner changes in this task"), and because none of the findings above meet the bar of "proven by multiple sampled findings, narrow, no runtime-code change, tests demonstrate exact before/after counts" as a **scanner** (code) defect — every issue found in this validation is a **data/config completeness** gap (`domain-map.json` entries), not a logic defect in `scripts/architecture-guardrail/lib/*` — **no scanner or config file was modified by this task.** The two concrete, evidence-backed follow-up recommendations (§9's map corrections/additions) are handed to a dedicated follow-up task, not applied here, consistent with "if a code/config change is proposed, separate it into a follow-up task unless the master tracker explicitly authorizes repair inside this validation task" (it does not).

## 12. Tests re-run (no code changed, so no new tests added)

All commands run from the task worktree root.

| Command | Result | Exit code |
|---|---|---|
| `npm run guardrail:test` | 74 passed, 0 failed | 0 |
| `npm run typecheck:guardrail` (`tsc --noEmit -p scripts/architecture-guardrail/tsconfig.json`) | clean | 0 |
| `npm run guardrail:scan -- --repo-sha=9b10bc9f... --deterministic --out=...` | 247 files, 1,031 findings (1,018 NEW / 13 EXISTING), 0 errors, 0 warnings | 0 |
| `node -e "JSON.parse(...)"` against the generated report | valid | 0 |
| Secret-pattern scan against the generated report | no prohibited pattern | — |
| Absolute-path scan against the generated report | no match | — |
| Determinism: two independent `--deterministic` runs, byte-compared | identical (404,173 bytes each) | 0 |
| `node scripts/architecture-guardrail-validation/buildSample.js`, run twice, byte-compared | identical sample manifest (169 entries) | 0 |
| Sample-vs-manifest cross-check (169 classified findings vs. 169 manifest entries) | 0 missing, 0 extra, 0 duplicates | — |

No `npm ci`/build/typecheck regression check beyond the guardrail's own scope was necessary since no application source file was touched.

## 13. Security and tenant impact

No security-sensitive or tenant-scoping source file was read for the purpose of being modified — all reads were for classification evidence only. No secret, credential, or `.env` value was read or written by this task. Every generated/checked-in report and manifest was independently verified free of absolute local paths and secret-like patterns (§3, §12). This task performed no runtime tenant-isolation testing and makes no tenant-isolation proof claim — consistent with every prior guardrail task's own explicit disclaimer, which the raw report itself still carries verbatim (`tenantScopeDisclaimer` field).

## 14. Migration status / backward compatibility / rollback

No Prisma migration exists, was created, or is required. `server/prisma/migrations/` and `server/prisma/schema.prisma` are unchanged (`git status` scoped to `server/prisma/` confirms no diff). This task is purely additive: new evidence/manifest/report files under `docs/program/evidence/tooling/`, a new small script under `scripts/architecture-guardrail-validation/`, this evidence file, and status-reconciliation edits to 4 existing documentation files. No existing script, workflow job, `needs:` list, or path filter was changed. **Rollback:** revert this task's single PR/commit — no database, runtime, or production-configuration rollback is needed or implied, since none was performed.

## 15. Accepted findings vs. rejected/unverified claims

**Accepted (verified in this document):** baseline preconditions (§1); exact current scan reproduction, byte-identical to the previously-documented counts (§3); determinism, no-absolute-path, no-secret-pattern (§3, §12); stratified sample of 169 (exceeds the 120 minimum) covering all required strata (§4); 169/169 findings classified from direct source reads, 0 manifest mismatches (§5–§7); the 4 declared ownership collisions independently reconciled against already-accepted F0-003 evidence, 3 of 4 resolvable by map correction and 1 genuinely requiring an ADR (§9); a separate, larger 23-file/~250-finding domain-map coverage gap discovered and characterized (§9); a concrete, measured `NEW`/`EXISTING` classification-trustworthiness gap (12/12 known-accepted sampled edges misreported `NEW`) (§8).

**Explicitly not claimed:** that the 81.1% expected-edge rate or 5.9% actionable rate are unbiased statistical estimates of the full 1,031-finding population — the sample is a purposive stratified sample designed for **coverage breadth** (every domain, every collision, every risk family), not proportional random sampling, so these rates are a directional signal, not a precise population estimate (see the explicit sampling-limitation note below). That any of the 4 ownership collisions are resolved (they are not — only recommended). That the domain-map coverage gap is closed (it is not — only characterized and recommended). That any high-risk tenant/security code path has dedicated test coverage (not independently verified by this task). That CI has been re-run on the actual opened PR head (not yet opened as of this document). Merged/deployed/production-verified status (all explicitly `NOT_*`).

**Sampling limitation, stated explicitly:** because strata were selected for coverage rather than proportional representation, a family with 100 real-population findings and a family with 1 real-population finding could each contribute similarly few samples if both fell in a "low-frequency" or "coverage-topped-up" bucket, while the top-25 high-frequency families (76.3% of the true population) were deliberately over-sampled at only 3 draws each rather than proportionally to their true share. The qualitative conclusion (vast majority expected, single-digit-percent actionable, zero parser-level defects, one new real violation) is judged likely directionally accurate for the full population given how large and evenly the qualifying strata are, but no formal confidence interval is computed, and this document does not claim one.

## 16. Exact next task

Per §9, §10, and §11, the concrete next task (not started, not authorized by this task) has two independent, separable parts:

1. **Domain-map completeness correction** (documentation/config-only, no scanner-logic change): add the ~23 missing target files as platform-shared or same-domain entries in `config/domain-map.json`; correct the 3 map-correctable ownership collisions (`utils/encryption.ts`, `utils/secrets.ts`, `services/treatmentStockDeduction.ts`) per §9; add a `services/communicationConsent/*` domain entry. Re-run the scan and measure the before/after `UNRESOLVED`/`NEW`/`EXISTING` count delta as the closing evidence.
2. **Program-owner ADR** for `routes/organizationDashboard.ts`'s genuine mixed-responsibility ambiguity (§9, collision #4) — a decision this validation task cannot and does not make.

Only after both, plus F2-SEC-001/F2-SEC-002 deployment + production verification (independent, tracked by `F2-SEC-003`, still open), may a future task define measurable promotion-to-blocking criteria and **propose** (never silently enable) CI-blocking enforcement.

# F2-GUARDRAIL-VAL-004 — Post-VAL-003 Fresh Stratified False-Positive Re-sample and Signal-Quality Reconciliation

**Task ID:** F2-GUARDRAIL-VAL-004
**Phase:** F2 — Modular Monolith Boundary Remediation / Guardrail Signal Quality
**Type:** Read-only validation, evidence, and reproducible sampling/metrics tooling only. No scanner, domain-map, accepted-baseline, or application code change.
**Baseline SHA:** `81eab4cfb45e115f61d3a151c987d1de97a10cdc` (origin/main at task start; unchanged throughout the task — independently re-verified via `git fetch origin --prune` / `git rev-parse origin/main`)
**Branch / worktree:** `docs/f2-guardrail-val-004-fresh-signal-quality`, isolated worktree at `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f2-guardrail-val-004-fresh-signal-quality`, created from freshly-fetched `origin/main`, confirmed clean (`git status --short` empty) before any edit.
**Task status:** `AGENT_COMPLETED`. `TESTS_PASSED` (locally, see §11) / `PR_OPENED` / `CI_PASSED` / `MERGED` / `DEPLOYED` / `PRODUCTION_VERIFIED` are **not** self-assigned by this document; they require external review/CI/merge/deploy evidence not produced by this task.
**Blocking enforcement:** `NOT_AUTHORIZED` — unchanged. This document does not decide, propose, or imply promotion to blocking enforcement.

---

## 0. Methodology revision notice

Partway through this task, a user-supplied addendum (**`F2-GUARDRAIL-VAL-004-REVIEW-A`**, an "independent read-only methodology audit," verdict `REQUIRES_REVISION`) overrode the sampling-unit, sample-size, stratification, weighting, confidence-interval, and prior-round-comparison instructions in the original task brief. It did **not** change any scope boundary (still docs/evidence/tooling only, no domain-map/baseline/application change, enforcement still `NOT_AUTHORIZED`). This document follows the revised methodology throughout; where the original brief's language differs (e.g. "findings" vs "edges"), the revised, edge-level methodology is authoritative and is what was actually executed.

---

## 1. Repository-state reconciliation performed

Independently verified, not assumed from the assigning brief:

| Claim | Verification command | Result |
|---|---|---|
| `origin/main` SHA | `git fetch origin --prune`; `git rev-parse origin/main` | `81eab4cfb45e115f61d3a151c987d1de97a10cdc` |
| PR #330 state | `gh pr view 330 --json number,title,state,mergedAt,mergeCommit` | `MERGED`, merge commit `81eab4cfb45e115f61d3a151c987d1de97a10cdc`, `mergedAt` 2026-08-07T09:01:11Z |
| PR #331 state | `gh pr view 331 --json number,title,state,mergedAt,mergeCommit` | `MERGED`, merge commit `9196ceb9a8beff561af55ff2d15b13c0a7874bc2`, `mergedAt` 2026-08-07T07:30:25Z |
| Post-merge closure CI | `gh run view 31165704904 --json status,conclusion,headSha,event,jobs` | `workflow_dispatch`, `headSha` exactly `81eab4cfb45e115f61d3a151c987d1de97a10cdc`, `conclusion: success`, all 10 `jobs[].conclusion` = `success` |
| Ancestry | `git merge-base --is-ancestor 9196ceb... 81eab4c...` and `git merge-base --is-ancestor 81eab4c... origin/main` | both `true` |

**Finding:** the repository tracker's own most-current entries (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`) still read PR #330 as `NOT_MERGED` — a stale claim left over from the VAL-003-R2 rebase's own conflict resolution, never reconciled against the actual merge. This is corrected by an **appended** entry in each file (§3), per the program's own established convention of never rewriting historical entries in place.

An earlier post-merge push-triggered CI run had failed / needed `startup_failure` reruns — that history is **not** erased; the manual `workflow_dispatch` run above, on the exact merged head, is the accepted closure signal, matching the assigning brief's own characterization.

---

## 2. Current scanner population (fresh, reproduced 3×, byte-identical)

**Exact command:**
```
npm run guardrail:scan -- --repo-sha=81eab4cfb45e115f61d3a151c987d1de97a10cdc --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_scan_run{1,2,3}.json
```

| Run | Size | SHA-256 |
|---|---|---|
| run1 | 417,264 bytes | `48f6e55c8cfdc7ee2887efd835af8da92af2e622629392d48b67e910b0739cf9` |
| run2 | 417,264 bytes | `48f6e55c8cfdc7ee2887efd835af8da92af2e622629392d48b67e910b0739cf9` |
| run3 | 417,264 bytes | `48f6e55c8cfdc7ee2887efd835af8da92af2e622629392d48b67e910b0739cf9` |

All three byte-identical (`diff` empty). **Determinism confirmed — no non-determinism defect found; classification work proceeded.**

| Metric | Value |
|---|---|
| Total findings | 1,039 |
| `NEW` | 846 |
| `EXISTING` | 193 |
| Files discovered/parsed/skipped | 247 / 247 / 0 |
| Errors / warnings | 0 / 0 |
| `resolvedBaselineEdgeIds` | `["CDA-072"]` |

This is an **exact match** to VAL-003's own final counts — confirming no drift in the scanner population between VAL-003's close and this task's baseline SHA (which is, in fact, the same commit: VAL-003/PR #330's own merge commit is `origin/main`'s current tip).

---

## 3. Program-document reconciliation

Per the program's established convention (append a correction entry, never rewrite history in place):

- **`docs/program/NORAMEDI_MASTER_TRACKER.md`**: new top-of-file "Son güncelleme" entry inserted; the prior entry demoted to "Previous update:" (its text otherwise untouched — including its own stale `NOT_MERGED` claim, preserved as historical record).
- **`docs/program/CURRENT_PHASE.md`**: new top entry inserted above the prior top entry (also untouched).
- **`docs/program/phases/F2_MODULAR_BOUNDARIES.md`**: a new "current status (corrected by F2-GUARDRAIL-VAL-004, ...)" clause appended to the chained "Faz durumu" narrative line (following its own established append convention), plus a new row in the "Change history" table.
- **`docs/program/evidence/README.md`**: a new table row added for this task's evidence file, explicitly noting the merge-status correction for the rows above it (VAL-002/VAL-003/ADR-DASH-002), without editing their own text.

Each new entry records: PR #330/#331 `MERGED` status with merge commits, the independently-verified post-merge CI run, the fresh 3×-reproduced scan population, the revised sampling methodology and headline counts, the organizationDashboard.ts re-confirmation, and the unchanged `NOT_AUTHORIZED` enforcement status. `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED` are preserved where still semantically meaningful — this task is docs/evidence/tooling-only and does not itself require or claim deployment.

---

## 4. Sampling methodology (edge-level, per REVIEW-A addendum)

### 4.1 Population derivation

Script: `scripts/architecture-guardrail-validation/buildVal004EdgePopulation.mjs` (new, checked in).

The sampling/classification unit is the distinct **baseline-matcher edge** `(callerPath, ownerDomain, targetModelOrSymbol, accessKind)` — not the raw scanner finding. `scripts/architecture-guardrail/lib/baseline.ts`'s own `MATCH_KEY_FIELDS` excludes `callerSymbol`, so multiple findings (one per imported symbol) can represent one underlying architectural boundary-crossing decision, exactly as VAL-003 itself demonstrated (88 explicit edges + 90 same-edge sibling findings = 178 total flips).

| Metric | Value |
|---|---|
| `NEW` findings | 846 |
| Distinct `NEW` edges (N) | **552** |
| Finding-count reconciliation | sum of cluster sizes = 846 = `NEW` findings total ✓ |
| Mean cluster size | 1.53 |
| Median cluster size | 1 |
| Max cluster size | 9 |
| Cluster size = 1 | 386 edges |
| Cluster size 2-4 | 150 edges |
| Cluster size ≥5 | 16 edges |

Reproduced identically against all 3 scan runs (byte-for-byte diff on the derived population JSON).

### 4.2 Target sample size

```
n = max(150, ceil(0.20 × N)) = max(150, ceil(0.20 × 552)) = max(150, 111) = 150
```
capped at N (552) — not applicable here since 150 < 552.

### 4.3 Stratification model

Script: `scripts/architecture-guardrail-validation/buildVal004Sample.mjs` (new, checked in). Dimensions computed per edge: `edgeShape` (caller-layer → target-layer family), `highRisk` (+ named categories), `clusterSizeBucket` (1 / 2-4 / 5+), `partialBaselineResidue` (does `callerPath` already have ≥1 `EXISTING` finding for a *different* edge). `accessKind` is a constant (`"import"`) across the entire population — carries no stratification signal, noted and not used as a dimension.

Primary weighting stratum = a strict, priority-ordered partition of all 552 edges (every edge belongs to exactly one), constructed so that every mandatory census criterion aligns with a stratum boundary (required for the weighting formula in §5 to be valid — mixing forced-inclusion and probability-sampled items within one stratum would violate the uniform-inclusion-probability assumption the weighting/variance formulas rely on):

1. **`organizationDashboard.ts` caller census** (VAL-004 brief §9 special check) — 4 edges.
2. **route→route cross-domain census** — 1 edge.
3. **clusterSize ≥5 census** — 16 edges.
4. **High-risk-domain (by `ownerDomain`) census** where the domain's remaining population ≤15 — 15 domains, 81 edges. (High-risk domain set: the brief's named categories — tenancy, auth, privacy/KVKK, audit, storage, messaging, imaging, integrations, finance — plus a transparently-documented extension carried over from VAL-001's own `HIGH_RISK_DOMAINS` set covering `core-platform-crypto`/`core-config-secrets`/`core-security-incident-detection`, three self-evidently security-critical domains the brief's category list did not name individually.)
5. **Small-cell census**: any remaining non-high-risk `ownerDomain` stratum with population ≤5 — 7 edges.
6. **High-risk oversample** (population >15): target = `min(N_h, max(15, round(2 × baseFraction × N_h)))` — 4 domains (`core-audit-activity`, `core-identity-access`, `core-platform-crypto`, `core-tenant-security`), 15 each = 60 edges.
7. **Standard proportional** (non-high-risk, population >5): target = `min(N_h, max(1, round(baseFraction × N_h)))` — 5 domains, 23 edges.

`baseFraction = remainingBudget / remainingPop` computed over the population *not* already claimed by mandatory census, `= 41 / 443 = 0.0926`.

Obsolete VAL-001 strata (ownership-collision coverage, `UNRESOLVED`-domain coverage) were **not** carried forward — both conditions no longer exist in the current population (0 `UNRESOLVED`, 0 open F0-003 collisions).

### 4.4 Deterministic selection

Non-census strata use SHA-256 hash-ranked selection: `stableRank(edgeKey, seed) = sha256("F2-GUARDRAIL-VAL-004|81eab4cfb45e115f61d3a151c987d1de97a10cdc|" + edgeKey).hexdigest()`, ascending sort, lowest-ranked `target` count selected per stratum.

**Seed:** `F2-GUARDRAIL-VAL-004|81eab4cfb45e115f61d3a151c987d1de97a10cdc`
**Hashing algorithm:** SHA-256
**Canonical edge-key serialization:** `callerPath␟ownerDomain␟targetModelOrSymbol␟accessKind` (U+241F SYMBOL FOR UNIT SEPARATOR joiner)

Re-running the sample builder against the same population file produces a byte-identical `sample_manifest.json` (verified).

### 4.5 Sample size / strata / allocation result

| | Value |
|---|---|
| N (population) | 552 |
| n (target) | 150 |
| Mandatory census count | 109 |
| Actual reviewed sample | **192** |
| Number of strata | 30 |
| Sample fraction at edge level | 192/552 = 34.8% |
| Underlying findings represented | 236 (sum of reviewed edges' cluster sizes) |

The actual reviewed sample (192) exceeds the 150 target — this is a **deliberate consequence of the mandatory-census and high-risk-oversample-floor rules**, not a deviation from the design; the "approximately 150" target in the original brief and the formula-derived 150 in the addendum are both explicitly compatible with census/floor protections increasing the total. No stratum's population was under-covered to keep the total near 150.

Full per-stratum population/sample counts, allocation formula detail, and the complete 192-edge sample (with all fields) are in `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_sample_manifest.json`.

---

## 5. Manual classification

Every sampled edge was independently reviewed against **current source** (both caller and target files read directly in the task worktree; sibling findings under a multi-symbol edge spot-checked). Classification was performed by 5 parallel sub-agents, each assigned a disjoint domain-clustered batch (31/47/39/40/35 = 192 edges, no overlap, no gaps — validated by key-set diff against the sample manifest, 0 missing / 0 extra / 0 duplicates).

**Taxonomy** (VAL-001's original 9-category taxonomy, reused verbatim, per REVIEW-A §H):

| Letter | Meaning |
|---|---|
| A | `REAL_BOUNDARY_VIOLATION` |
| B | `EXPECTED_PUBLIC_CONTRACT_EDGE` |
| C | `EXPECTED_PLATFORM_SHARED_EDGE` |
| D | `DATA_OWNERSHIP_REVIEW_REQUIRED` |
| E | `PARSER_FALSE_POSITIVE` |
| F | `DOMAIN_CLASSIFICATION_FALSE_POSITIVE` |
| G | `GENERATED_OR_TOOLING_NOISE` |
| H | `LEGACY_TECHNICAL_DEBT` |
| I | `SECURITY_OR_TENANT_HIGH_RISK` (primary, only if nothing else fits) |

**Lossless mapping to the brief's simplified A-D reporting layer:**

| Brief category | = VAL-001 letters | Rationale |
|---|---|---|
| A `TRUE_POSITIVE_BOUNDARY_VIOLATION` | A + H | H (legacy debt) is still a genuine, unauthorized boundary crossing — just pre-existing rather than newly introduced. Documented methodological choice (VAL-001 made the same choice for its own "precision-actionable (A+H)/n" metric). |
| B `ACCEPTED_EXPECTED_EDGE` | B + C | Both are architecturally legitimate. |
| C `SCANNER_OR_CLASSIFICATION_FALSE_POSITIVE` | E + F + G | All three are scanner/tooling artifacts, not real dependencies. |
| D `AMBIGUOUS_OR_UNVERIFIED` | D + I | Both require a human/architect decision the classifier could not make unilaterally. |

### 5.1 Classification counts (n=192)

| VAL-001 letter | Count | Brief category | Count |
|---|---:|---|---:|
| C | 143 | | |
| B | 39 | **B accepted-expected** | **182** |
| H | 3 | | |
| A | 1 | **A true positive** | **4** |
| D | 4 | **D ambiguous** | **4** |
| F | 2 | **C scanner FP** | **2** |
| E | 0 | | |
| G | 0 | | |
| I | 0 | | |

**192 = 143+39+3+1+4+2 ✓; 4+182+2+4 = 192 ✓.**

### 5.2 The 4 true-positive edges (A + H) — every one independently re-verified by this document's author against current source, not merely trusted from the sub-agent report

1. **`server/src/jobs/inboundEventRetryJob.ts` → `services/whatsapp/MetaCloudWhatsAppProvider.ts`** (classification A). Directly imports and `new`-instantiates the concrete `MetaCloudWhatsAppProvider` class (lines 21, 89) and calls `.parseWebhook()`, bypassing the existing `services/whatsapp/whatsappProviderFactory.ts` factory — independently confirmed to exist and to be the designed abstraction for exactly this case (`meta_cloud_api: () => new MetaCloudWhatsAppProvider()`). Real, if low-severity, abstraction-layering bypass — no security/tenant impact identified.
2. **`server/src/routes/whatsapp.ts` → `routes/contactRequests.ts`** (`upsertContactRequest`, classification H). Independently confirmed: `routes/whatsapp.ts` directly imports a Prisma-backed create/dedup function from another route file (`import { upsertContactRequest } from './contactRequests.js';`, confirmed at `contactRequests.ts`'s `export async function upsertContactRequest`, a real business function performing `prisma.contactRequest.findFirst`). Route-to-route dependency bypassing a service layer — the same anti-pattern already remediated for `getDateRange` under F2-ADR-ORG-DASH-001, not yet remediated here. This is also the sample's sole `routes -> routes` census edge.
3. **`server/src/services/privacy/patientPrivacyExportPackage.ts` → `routes/attachments.ts`** (`ATTACHMENT_MAX_FILE_SIZE_BYTES`, classification H). A privacy-domain service importing a numeric config constant from a route file — real reverse-layering, trivially low-risk payload (no business logic, no PII).
4. **`server/src/routes/imagingBridgePublic.ts` → `services/imaging/imagingRequestTransitions.ts`** (classification H). Confirmed as a genuine cross-owner import (BRG's public device-facing surface reaching into IMG-owned transition logic) with no facade — independently documented as a known, already-tracked gap in `F2-PREP-006-A_IMG_BRG_OWNERSHIP_AND_IMPLEMENTATION_INVENTORY.md`, not new coupling.

None of the 4 touch tenant isolation, authentication, or KVKK/privacy data handling in a way that constitutes a security defect — all are architecture-layering/debt findings.

### 5.3 The 4 ambiguous edges (D)

Three (`server/src/routes/imaging.ts` → `bridgeOnboardingConfig.ts` / `bridgePairing.ts` / `bridgeTokens.ts`) are a **full census of one entire stratum** (`highRiskDomainCensus:imaging-device-bridge`, N=3, all 3 reviewed, all 3 ambiguous). The classifying agent's finding, corroborated by prior program evidence (`F2-PREP-006-A`): `routes/imaging.ts` is domain-mapped wholesale to `imaging-server-viewer`, but 8 of its 27 routes are BRG-owned bridge-admin routes physically living in the same file — the "cross-domain" flag on these 3 edges is a **file-level domain-map granularity artifact**, not necessarily a real crossing, but not confidently resolvable without a domain-map change (out of this task's scope; reported, not fixed).

The 4th (`server/src/services/whatsappBookingFlow.ts` → `utils/whatsappDate.ts`) is a genuine ownership-ambiguity call: the target is domain-mapped to `messaging-whatsapp` but its content (pure Turkish date parsing, an AI-assistant timezone constant) reads as belonging to `messaging-ai-orchestration`. Reasonable engineers could assign it either way.

**Scanner/domain-classification defect note (F, brief-C):** `server/src/services/instagram/instagramAiConversationProcessor.ts → utils/whatsappDate.ts` was independently classified F (not D) by a different reviewing agent on the same target file — the second agent judged the file's genericness decisively (zero WhatsApp-specific coupling, reused from Instagram code) rather than ambiguous. Both agents flagged the same underlying domain-map placement as questionable from two different callers — convergent, independent evidence that `utils/whatsappDate.ts`'s domain-map entry deserves review. The other F: `server/src/routes/usersImport.ts → utils/excelImport.ts` (mapped to `clinical-patients`, but the target serves two unrelated domains via `buildPatientTemplate`/`buildUserTemplate`).

### 5.4 organizationDashboard.ts (VAL-004 brief §9 special check)

`domain-map.json` still assigns `server/src/routes/organizationDashboard.ts` → `core-org-clinic-membership` (unchanged since F2-ADR-ORG-DASH-002; source file not materially changed — ADR not reopened). It appears as **caller** in **4 distinct `NEW` edges** (5 underlying findings; `AuthRequest`+`authorize` collapse into one 2-symbol edge), **0 `EXISTING`**, **0 as target** of any finding. All 4 were included in the sample via mandatory census (§4.3 rule 1) and all 4 were classified **C** (`EXPECTED_PLATFORM_SHARED_EDGE`) — imports of `middleware/auth.ts`, `utils/roles.ts`, `db.ts`, and `utils/helpers.ts` (the `getDateRange` relocation target from F2-ADR-ORG-DASH-001), all standard platform-shared patterns fully consistent with the ADR decision.

### 5.5 Other reported (not fixed) follow-up items

- `routes/contactRequests.ts`'s own domain-map assignment (`clinical-appointments-availability`) looks questionable on inspection — its content (channel/externalSenderId/patient-linking CRUD) reads as lead/contact-intake tracking, not appointment scheduling.
- `checkPractitionerAvailability` (in `utils/helpers.ts`) is genuine appointments-availability business logic embedded in a nominally generic helpers file — candidate for relocation to `services/appointments/appointmentAvailabilityService.ts`.
- `services/whatsappBookingFlow.ts` is a misleadingly-named shared AI booking engine used by both WhatsApp and Instagram — a rename (e.g. `messagingBookingFlow.ts`) would better reflect its scope; its domain-map placement under `messaging-whatsapp` vs. `messaging-ai-orchestration` is the same tension noted in §5.3/§5.4.

None of these require a prohibited change to act on; all are reported for a separate follow-up task per this task's scope limits.

Full per-edge classification records (edgeKey, reasoning, caller/target evidence citations, follow-up flags) are in `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_classifications_merged.json` (192 records) and the 5 per-batch `*_classified.json` files.

---

## 6. Signal-quality metrics

Script: `scripts/architecture-guardrail-validation/buildVal004Metrics.mjs` (new, checked in). Deterministic (re-run produces byte-identical output — verified).

### 6.1 Raw as-sampled metrics (n=192, classified_non_ambiguous=188)

| Metric | Formula | Value |
|---|---|---:|
| True-positive precision | briefA / classified_non_ambiguous | 4/188 = **2.13%** |
| False-positive rate | (briefB+briefC) / classified_non_ambiguous | 184/188 = **97.87%** |
| Accepted-expected rate | briefB / classified_non_ambiguous | 182/188 = **96.81%** |
| Scanner/classification-defect rate | briefC / classified_non_ambiguous | 2/188 = **1.06%** |
| Ambiguity rate | briefD / total_sample | 4/192 = **2.08%** |

These are **unweighted, disproportionate-sample raw rates** — because high-risk strata were deliberately oversampled (up to ~4× their population share) and small strata were censused, this raw rate is **not** a valid population estimate on its own. It is reported per the brief's own §7 requirement, alongside the weighted estimate below (required by REVIEW-A §I).

### 6.2 Weighted population estimate (headline number)

```
p_hat = Σ_h (N_h/N) × (fp_h/n_h)
```
computed over the 29 of 30 strata with ≥1 non-ambiguous classified edge (`n_h_effective` > 0); one stratum (`highRiskDomainCensus:imaging-device-bridge`, N=3, all 3 census-reviewed, all 3 classified D/ambiguous) has **no estimable rate** and is excluded from the weighted sum, its 3-edge population share (0.54% of N) reported separately rather than silently dropped.

| | Value |
|---|---:|
| **Weighted population accepted-edge rate (p_hat)** | **99.27%** |
| **Weighted population violation-rate complement (1 - p_hat)** | **0.73%** |
| Covered population (N_h summed over estimable strata) | 549 / 552 |
| Excluded stratum | `highRiskDomainCensus:imaging-device-bridge`, N=3, 100% ambiguous (see §5.3) |

**WEIGHTED_POPULATION_FP_ESTIMATE = 99.27% (accepted/expected), RAW_AS_SAMPLED_FP_RATE = 97.87%.** The weighted estimate is the headline number per REVIEW-A §I; the raw rate is reported alongside, not presented as the population estimate.

### 6.3 Confidence intervals — and an important, transparently-reported degeneracy

**Analytic (stratified, finite-population-correction):** 95% CI = **[99.27%, 99.27%]** (zero width).
**Bootstrap (2,000 resamples, stratified, seed `F2-GUARDRAIL-VAL-004-BOOTSTRAP-v1`, deterministic mulberry32-from-SHA-256):** 95% CI = **[98.91%, 99.64%]**.

Both methods produce a **near-degenerate, narrow interval**. This is **not a computation defect** — it is a well-known statistical property (Wald/parametric-bootstrap degeneracy) that occurs when a stratum's *observed* sample proportion is exactly 0% or 100%: the plug-in sample variance `n/(n-1) × p × (1-p)` evaluates to exactly 0 when `p=1`. Several of this sample's largest strata (e.g. `highRiskOversample:core-audit-activity`, 15/15 sampled = 100% accepted; `highRiskOversample:core-identity-access`, `core-platform-crypto`, `core-tenant-security`, same pattern; `standardProportional:core-shared-platform-infrastructure`, 19/19) hit exactly this case. Additionally, several `standardProportional` strata were sampled at only `n_h=1` (floor), which provides no internal variance estimate at all.

**Per REVIEW-A §J ("do not overstate statistical certainty... flag the estimate as unstable"), a supplementary conservative bound was computed:** for every non-census, non-ambiguous stratum where **zero** violations were observed (`fp_h == n_h_effective`), the exact Clopper-Pearson one-sided 95% upper bound on the *true* violation rate (`1 - 0.05^(1/n)`) was substituted for the naive "0 observed" plug-in, before recomputing the weighted estimate:

| | Value |
|---|---:|
| Conservative weighted accepted-rate | **78.90%** |
| **Conservative weighted violation-rate ceiling** | **21.10%** |

This ceiling is dominated by the five smallest oversampled/proportional strata (four `standardProportional` strata sampled at `n=1`, contributing a Clopper-Pearson ceiling of 95% each on their own small population share, plus the four `n=15`-of-larger-population high-risk oversample strata at an 18.1% ceiling each). **This is the statistically honest range to communicate:** the point estimate (99.27% accepted) and both computed intervals reflect what was *observed*, but the true population rate could plausibly be materially lower for the specific small-sample strata identified above, purely due to limited sample size in those cells — not because any concrete evidence of additional violations was found. A follow-up validation task increasing sample size specifically in the `n=1` `standardProportional` strata (`clinical-appointments-availability`, `core-observability-ops-events`, `core-org-clinic-membership`, `core-shared-events-queue-idempotency`) would tighten this bound materially. `ciAgreement` is reported as `DEGENERATE_NARROW_BOTH_METHODS_SEE_CONSERVATIVE_BOUND`, not `CONSISTENT`, to avoid implying false precision.

### 6.4 High-risk-only metrics

| | Value |
|---|---:|
| n (high-risk edges in sample) | 173 |
| classified_non_ambiguous | 169 |
| True positives (A+H) | 4 |
| False-positive rate | 165/169 = **97.63%** |
| Ambiguity rate | 4/173 = **2.31%** |

All 4 true positives in the entire sample are high-risk-domain-touching (100% of true positives found were in high-risk strata) — consistent with those strata being deliberately oversampled for safety coverage.

### 6.5 Metrics by edge shape (top families, n≥5)

| Edge shape | n | classified_non_ambiguous | TP count | FP rate |
|---|---:|---:|---:|---:|
| routes → utils | 68 | 68 | 0 | 100% |
| services → services | 31 | 31 | 0 | 100% |
| routes → services | 29 | 26 | 1 | 96.2% |
| routes → middleware | 17 | 17 | 0 | 100% |
| services → utils | 16 | 15 | 0 | 100% |
| routes → root-or-other | 7 | 7 | 0 | 100% |
| services → root-or-other | 6 | 6 | 0 | 100% |
| jobs → services | 5 | 5 | 1 | 80.0% |

(Remaining families each n≤4; full table in `F2-GUARDRAIL-VAL-004_metrics.json`.) The `routes -> routes` (n=1, 0% FP — the sole census member is the whatsapp→contactRequests true positive) and `services -> routes` (n=1, 0% FP — the patientPrivacyExportPackage true positive) shapes are the only 100%-true-positive families, both singleton census strata.

### 6.6 Metrics by caller layer

| Caller layer | n | TP count | FP rate |
|---|---:|---:|---:|
| routes | 123 | 2 | 98.3% |
| services | 54 | 1 | 98.1% |
| jobs | 12 | 1 | 91.7% |
| middleware | 2 | 0 | 100% |
| utils | 1 | 0 | 100% |

### 6.7 Metrics by cluster-size bucket

| Bucket | n | TP count | FP rate |
|---|---:|---:|---:|
| 1 | 124 | 3 | 97.5% |
| 2-4 | 52 | 1 | 98.0% |
| 5+ | 16 | 0 | 100% |

No evidence that larger multi-symbol clusters hide more violations than single-symbol edges — if anything the opposite (0 true positives among the 16 census-reviewed cluster≥5 edges).

---

## 7. Comparison to VAL-001 / VAL-002 / VAL-003

Per REVIEW-A §K, explicit and unambiguous:

**VAL-001_RATE_COMPARISON = NOT_DIRECTLY_COMPARABLE.** Reasons: VAL-001 used a purposive, rule-based (non-probability) sample of raw findings, not edges; it pre-dated the domain-map/baseline reconciliation this task's population reflects; it deliberately oversampled several categories without population weighting; and VAL-001 itself explicitly disclaimed formal statistical inference. **Do not** read "8.9% (VAL-001) → 2.13%/0.73% (VAL-004)" as an improvement trendline — the sampling units, methodologies, and populations are not the same measurement.

**VAL-003_NEW_COUNT_REDUCTION = BASELINE_COVERAGE_CHANGE_NOT_SIGNAL_QUALITY_MEASUREMENT.** VAL-003's `NEW` 1,024 → 846 reduction came entirely from accepted-baseline authoring (88 explicit + 90 sibling flips = 178), independently re-confirmed unchanged by this task's own fresh scan (846/193/1,039, byte-identical population). It reflects accepted-baseline *coverage*, not a change in scanner precision/recall — VAL-004 is the first population-estimating, edge-level signal-quality measurement taken *after* that coverage change, not a before/after comparison of the same measurement.

**VAL-002 comparison:** not attempted — VAL-002 was a domain-map/baseline reconciliation task (config + baseline-authoring), not a false-positive sample; there is no VAL-002 rate to compare against.

**Categories dominating remaining `NEW` findings (this sample):** overwhelmingly `C` (`EXPECTED_PLATFORM_SHARED_EDGE`, 143/192 = 74.5%) — shared/platform utility imports (auth middleware, role checks, db client, encryption/secrets, audit logging, storage abstraction) that are architecturally legitimate under the current pre-modularization structure. This is consistent with, though not statistically comparable to, VAL-001's own observation that `EXPECTED_PLATFORM_SHARED_EDGE` was its largest single category.

**Are remaining false positives concentrated in a small number of patterns?** Yes — the 2 scanner/domain-classification-defect (`F`) edges both trace to the same root cause (a generic utility file domain-mapped to a single narrow business domain despite serving multiple domains: `utils/whatsappDate.ts`, `utils/excelImport.ts`).

**Are remaining true positives concentrated in particular boundaries?** The 4 true positives span 4 distinct caller/target pairs with no single dominant pattern, though 3 of 4 involve route-or-service files reaching directly into another domain's concrete implementation/business function instead of its designed abstraction (factory, service layer) — a recognizable, if not statistically dominant, theme.

---

## 8. Scanner blind-spot note (REVIEW-A §M)

This sampling exercise measures the **precision of the current scanner's detection surface**, which is strictly **import-syntax based** (`scripts/architecture-guardrail/lib/edgeExtraction.ts` parses static `import` statements only — no Prisma-call analysis, no dynamic `require`, no runtime dependency-injection tracing). **This cannot measure architectural violations outside that detection surface** — e.g. a route file reaching another domain's data via a shared service that itself does the cross-domain Prisma access (already flagged as an explicitly-unresolved, pre-existing gap for `organizationDashboard.ts` in F2-ADR-ORG-DASH-002 §"Explicitly NOT resolved"). **Do not infer "high scanner precision (99.27% accepted) = the repository has no boundary violations."** Detector precision (how often a flagged edge is real) and detector recall (how many real violations it flags) are conceptually separate; this task measured precision only.

---

## 9. Determinism evidence

| Artifact | Method | Result |
|---|---|---|
| Raw scan (3×) | sha256 + diff | byte-identical |
| Edge-population derivation (3× against the 3 scan runs) | diff | byte-identical |
| Sample manifest (2× against same population) | diff | byte-identical |
| Metrics computation (2× against same sample+classifications) | diff | byte-identical |

No non-determinism defect found at any stage.

---

## 10. Test / validation results

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck:guardrail` | 0 | clean, no output |
| `npm run guardrail:test` | 0 | **74/74** passed |
| `npm run test:runtime:unit` | 0 | **74/74** passed |
| `node --test scripts/architecture-guardrail-validation/__tests__/*.test.js` | 0 | **44/44** passed (30 pre-existing + 14 new, in `val004Determinism.test.js`) |
| `git diff --check` | 0 | clean, no whitespace errors |

New test file `scripts/architecture-guardrail-validation/__tests__/val004Determinism.test.js` covers: edge-population collapsing/reconciliation, input-order independence, `edgeKey` excludes `callerSymbol`, `targetSampleSize` formula, `edgeShape`/`isHighRisk` classifiers, `stableRank` determinism, full-stratum-assignment invariant, sample-builder byte-identical reruns, the VAL-001→brief taxonomy mapping (exhaustive), the fp-indicator semantics, the Clopper-Pearson bound, census-stratum zero-variance invariant, and an end-to-end rerun of the real checked-in sample+classifications.

Per §11 of the task brief, full application regression was **not** run — this task's scope is docs/program/**, docs/program/evidence/**, and reproducible validation scripts only; no shared/core/tooling change triggers the repo's test-impact escalation rules (verified: no `server/`, `client/`, `prisma/`, or CI-workflow file touched).

`npm ci` was run once in this fresh worktree (no `node_modules` present after `git worktree add`) to materialize the existing lockfile — no dependency version changed, no `package.json`/lockfile edited.

---

## 11. Security / tenant / modularity / compatibility review

- **Tenant impact:** none. No tenant-scoping/`organizationId`/`clinicId` runtime file touched.
- **KVKK/privacy impact:** none. No privacy/consent/retention runtime file touched; `patientPrivacyExportPackage.ts` was only *read* for classification, not modified.
- **Authentication/authorization impact:** none. No auth/middleware runtime file touched.
- **Storage impact:** none.
- **Database/migration impact:** none. No Prisma schema/migration touched.
- **Module-boundary impact:** measurement/evidence only. No new cross-domain runtime dependency introduced; `domain-map.json` and the accepted-baseline JSON are both byte-unchanged from `origin/main`.
- **Backward compatibility:** docs/evidence/tooling only; no runtime API contract changed.
- **Rollback:** revert this task's commit(s)/PR. No DB/data/runtime rollback needed — nothing runtime was changed.

---

## 12. Files changed

**New evidence/tooling (docs/program/evidence/tooling/):**
`F2-GUARDRAIL-VAL-004_scan_run1.json`, `_scan_run2.json`, `_scan_run3.json`, `_edge_population.json`, `_sample_manifest.json`, `_batch{1..5}_*_input.json` (5), `_batch{1..5}_*_classified.json` (5), `_classifications_merged.json`, `_metrics.json`.

**New reproducible scripts (scripts/architecture-guardrail-validation/):**
`buildVal004EdgePopulation.mjs`, `buildVal004Sample.mjs`, `buildVal004Metrics.mjs`, `__tests__/val004Determinism.test.js`.

**New main evidence doc:** `docs/program/evidence/F2-GUARDRAIL-VAL-004_FRESH_STRATIFIED_SIGNAL_QUALITY.md` (this file).

**Modified (append-only corrections):** `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md`.

**Not touched:** `scripts/architecture-guardrail/**` (scanner itself), `scripts/architecture-guardrail/config/domain-map.json`, `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (accepted baseline), any `server/`, `client/`, `prisma/`, or CI workflow file.

---

## 13. Unresolved findings (reported, not fixed — out of this task's authorization)

1. `utils/whatsappDate.ts` domain-map placement (`messaging-whatsapp` vs. `messaging-ai-orchestration`) — independently flagged by two different reviewing agents from two different callers.
2. `utils/excelImport.ts` domain-map placement (`clinical-patients`, serves 2 unrelated domains).
3. `routes/contactRequests.ts` domain-map placement (`clinical-appointments-availability` vs. its actual contact/lead-intake content).
4. `routes/imaging.ts`'s file-level domain-map granularity vs. its embedded BRG-owned sub-routes (3-edge full census, all ambiguous) — a known, prior-documented (`F2-PREP-006-A`) issue, not new.
5. 4 true-positive boundary/layering findings (§5.2) — none security/tenant-critical, all recommended for a separate, future remediation task (in the pattern of F2-ADR-ORG-DASH-001's `getDateRange` fix).
6. `checkPractitionerAvailability` business logic embedded in `utils/helpers.ts`.
7. Follow-up recommendation: increase sample size in the 4 `n=1` `standardProportional` strata and the fully-ambiguous `imaging-device-bridge` stratum in any subsequent validation round, to tighten the conservative bound in §6.3.

None of these require, and none received, a domain-map, baseline, or application-code change under this task.

---

## 14. Blocking enforcement

**BLOCKING_ENFORCEMENT = NOT_AUTHORIZED.** This document does not enable, propose enabling, or imply readiness for CI-blocking/production architecture enforcement. Per the task's own scope limits, the only permitted conclusions are: signal quality measured (this document), remaining issues identified (§13), and — explicitly — that a **separate, future task** would be needed to define promotion-to-blocking criteria using this evidence (plus the still-open F2-SEC-001/F2-SEC-002 deployment + production verification thread). That decision is not made here.

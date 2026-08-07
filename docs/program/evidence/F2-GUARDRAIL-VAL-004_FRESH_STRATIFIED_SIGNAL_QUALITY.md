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

### 0.1 F2-GUARDRAIL-VAL-004-R1 correction notice (external architecture review on PR #332)

An external architecture review of PR #332 (reviewed head `e8e57bd8bb6ce7e3dd950a808cf4f1d31c1a8628`) found this evidence **not merge-safe** on two blocking methodology grounds. Both are corrected in this document/its tooling in place (this is a live, unmerged evidence package under active review, not a closed historical record — the program's append-only convention applies to the chronological tracker files, §3, not to this task's own not-yet-accepted evidence file):

1. **High-risk sampling partition was asymmetric.** `highRiskCategories(e)`/`isHighRisk(e)` (`scripts/architecture-guardrail-validation/buildVal004Sample.mjs`) correctly flag an edge high-risk when **either** `ownerDomain` or `callerDomain` is a high-risk domain, but the census/oversample allocation that actually drove sampling was keyed only by `ownerDomain`. A caller-side-only high-risk edge (high-risk `callerDomain`, non-high-risk `ownerDomain`) could therefore be sampled under an ordinary standard-proportional/small-cell stratum instead of the approved high-risk policy. **Fixed:** the partition is now keyed by a new deterministic, mutually-exclusive `highRiskDomainKey(e)` (owner domain if it is itself high-risk, else caller domain — guaranteed non-null whenever `isHighRisk(e)` is true), so every high-risk edge is routed to the high-risk track regardless of which endpoint triggered it, and a fix-adjacent double-counting defect this rework surfaced (the standard-proportional pool re-querying the full remaining population without excluding already-high-risk-routed edges) was fixed alongside it. Full re-derivation: §4.3/§4.5 below.
2. **The 21.10% figure was mislabeled as a formal `conservative violation-rate ceiling`.** It substituted a one-sided Clopper-Pearson bound only for non-census strata with zero observed violations; strata with ≥1 observed violation kept an unbounded plug-in rate, ambiguous edges were complete-case-omitted, and a weighted sum of independent per-stratum marginal 95% bounds does not itself carry a global/simultaneous 95% coverage guarantee. **Fixed (minimal-relabel path, per the review's own preferred option):** the computation is unchanged in substance but is now named and documented as a **zero-event sensitivity analysis** (`zeroEventSensitivityAnalysis()`, fields `sensitivityAcceptedRate`/`sensitivityViolationRate`/`hasConfidenceCoverage: false`), with an explicit, machine-readable disclaimer that it has no confidence-coverage guarantee and must not be used as merge/promotion/enforcement evidence. See §6.3.

Both fixes changed the actual sampled/reviewed edge set (§4.5, §5) and therefore the headline numbers throughout §6 — this document's numbers are the **corrected, current** numbers, not the pre-review numbers the reviewer saw. `BLOCKING_ENFORCEMENT` remains `NOT_AUTHORIZED`, unchanged by this correction round.

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
4. **High-risk group census** — keyed by `highRiskDomainKey(e)` (owner domain if it is itself high-risk, else caller domain; every edge with `isHighRisk(e)` true, from **either** endpoint, is grouped here exactly once — see §0.1/§4.3.1) where the group's remaining population ≤15 — 13 groups, 117 edges.
5. **Small-cell census**: any remaining `ownerDomain` stratum (guaranteed non-high-risk by construction — every high-risk edge was already claimed by rule 4) with population ≤5 — 4 domains, 6 edges.
6. **High-risk oversample** (group population >15): target = `min(N_h, max(15, round(2 × baseFraction × N_h)))` — 8 groups (`core-audit-activity`, `core-identity-access`, `core-platform-crypto`, `core-privacy-consent-retention-dsr`, `core-storage-abstraction`, `core-tenant-security`, `external-calendar-integration`, `messaging-whatsapp`), 15 each = 120 edges.
7. **Standard proportional** (non-high-risk, population >5): target = `min(N_h, max(1, round(baseFraction × N_h)))` — 2 domains, 2 edges.

`baseFraction = remainingBudget / remainingPop` computed over the population *not* already claimed by mandatory census, `= 6 / 408 = 0.0147`.

Obsolete VAL-001 strata (ownership-collision coverage, `UNRESOLVED`-domain coverage) were **not** carried forward — both conditions no longer exist in the current population (0 `UNRESOLVED`, 0 open F0-003 collisions).

### 4.3.1 R1 fix: the high-risk grouping key (§0.1 finding 1)

Pre-fix, step 4/6 above grouped strictly by `ownerDomain`; a caller-side-only high-risk edge (e.g. a job whose `callerDomain` is `core-privacy-consent-retention-dsr` importing a shared `core-shared-platform-infrastructure`-owned `db.ts`) fell through to the standard-proportional/small-cell path in step 5/7 instead. The fix introduces `highRiskDomainKey(e)`:

```
highRiskDomainKey(e) =
  ownerDomain,  if ownerDomain is itself a documented high-risk domain
  callerDomain, else if callerDomain is a documented high-risk domain
  null,         otherwise (e is not high-risk)
```

This is deterministic (pure function of the edge), total over every `isHighRisk(e)` edge, and mutually exclusive (each edge maps to exactly one key, so a both-endpoints-high-risk edge — e.g. owner `core-tenant-security` and caller `core-audit-activity` — is grouped and counted once, under its `ownerDomain`, not twice). Fixing the grouping key alone surfaced a second, related defect: the standard-proportional population/selection queries re-filtered the *entire* remaining pool by `ownerDomain` alone, without excluding edges already routed to the high-risk track — silently re-absorbing caller-only-high-risk edges and inflating the standard stratum's counted population beyond `N`. Both are fixed together in `buildVal004Sample.mjs`; the partition is verified to sum to exactly `N` (`unassignedCount: 0`, was `-70` transiently during the fix before the second defect was caught) and is covered by 6 new regression tests in `__tests__/val004Determinism.test.js` (§10).

### 4.4 Deterministic selection

Non-census strata use SHA-256 hash-ranked selection: `stableRank(edgeKey, seed) = sha256("F2-GUARDRAIL-VAL-004|81eab4cfb45e115f61d3a151c987d1de97a10cdc|" + edgeKey).hexdigest()`, ascending sort, lowest-ranked `target` count selected per stratum.

**Seed:** `F2-GUARDRAIL-VAL-004|81eab4cfb45e115f61d3a151c987d1de97a10cdc`
**Hashing algorithm:** SHA-256
**Canonical edge-key serialization:** `callerPath␟ownerDomain␟targetModelOrSymbol␟accessKind` (U+241F SYMBOL FOR UNIT SEPARATOR joiner)

Re-running the sample builder against the same population file produces a byte-identical `sample_manifest.json` (verified).

### 4.5 Sample size / strata / allocation result

| | Value (R1, corrected) | Value (pre-R1) |
|---|---:|---:|
| N (population) | 552 | 552 |
| n (target) | 150 | 150 |
| Mandatory census count | **144** | 109 |
| Actual reviewed sample | **266** | 192 |
| Number of strata | 30 | 30 |
| Sample fraction at edge level | 266/552 = 48.2% | 34.8% |
| Underlying findings represented | 436 (sum of reviewed edges' cluster sizes) | 236 |

The actual reviewed sample (266) exceeds the 150 target — this is a **deliberate consequence of the mandatory-census and high-risk-oversample-floor rules**, not a deviation from the design; the "approximately 150" target in the original brief and the formula-derived 150 in the addendum are both explicitly compatible with census/floor protections increasing the total. No stratum's population was under-covered to keep the total near 150. The jump from 192 to 266 versus the pre-R1 sample is entirely attributable to the §0.1/§4.3.1 partition fix: 107 caller-side-only high-risk edges that the pre-fix partition missed are now correctly census/oversample-included, and 33 edges from the pre-fix sample were not re-selected under the corrected partition/stratum boundaries (§4.5.1) — net **+74** (159 edges kept in both samples, unchanged classification reused; §5).

Full per-stratum population/sample counts, allocation formula detail, and the complete 266-edge sample (with all fields) are in `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_sample_manifest.json`.

### 4.5.1 Sample delta (pre-R1 → R1-corrected)

| | Count |
|---|---:|
| Pre-R1 sample size | 192 |
| R1-corrected sample size | 266 |
| Edges kept (same edge selected both times) | 159 |
| Edges removed (selected pre-R1, not selected post-fix) | 33 |
| Edges newly added (selected only post-fix) | 107 |
| Net change | +74 |
| Reused classifications (kept edges, prior classification carried over unchanged) | 159 |
| Newly manually classified (§5, read against current source, not inferred from prior evidence) | 107 |

All 107 newly-added edges are caller-side-only high-risk edges (non-high-risk `ownerDomain`, high-risk `callerDomain`) that the pre-fix `ownerDomain`-only partition missed — independently confirmed by cross-referencing each added edge's `callerDomain` against the documented high-risk domain set. The 33 removed edges include 2 of the pre-R1 sample's 4 true-positive (`A`/`H`) edges (`server/src/jobs/inboundEventRetryJob.ts → services/whatsapp/MetaCloudWhatsAppProvider.ts` and `server/src/services/privacy/patientPrivacyExportPackage.ts → routes/attachments.ts`); both remain part of the N=552 population and are real, previously-confirmed findings (§5.2 of the pre-R1 version of this document, preserved in git history) — they are simply not part of *this* review's random sample under the corrected stratum boundaries. This is expected resampling variance, not evidence the findings were wrong.

---

## 5. Manual classification

Every sampled edge was independently reviewed against **current source** (both caller and target files read directly in the task worktree; sibling findings under a multi-symbol edge spot-checked). Classification was performed in two rounds:

- **Original round (pre-R1):** 5 parallel sub-agents, each assigned a disjoint domain-clustered batch (31/47/39/40/35 = 192 edges). 159 of these 192 classifications carry forward unchanged into the corrected 266-edge sample (§4.5.1) — the same edge, same classification, not re-derived.
- **R1 round (this correction, §0.1 finding 1):** the 107 edges newly added by the sampling-partition fix were classified fresh by 4 parallel sub-agents (27/27/27/26 = 107 edges), each independently reading the current caller and target source for every edge — **not** inferred from the prior round's evidence, per the review's explicit instruction, since none of these edges were part of the prior round.

Combined: **266 edges, 0 overlap, 0 gaps** — validated by key-set diff against the corrected sample manifest (0 missing / 0 extra / 0 duplicates) and by the R1 batches' own per-batch order/key verification against their input files.

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

### 5.1 Classification counts (n=266, R1-corrected)

| VAL-001 letter | Count | Brief category | Count |
|---|---:|---|---:|
| C | 220 | | |
| B | 39 | **B accepted-expected** | **259** |
| H | 2 | | |
| A | 0 | **A true positive** | **2** |
| D | 4 | **D ambiguous** | **4** |
| F | 1 | **C scanner FP** | **1** |
| E | 0 | | |
| G | 0 | | |
| I | 0 | | |

**266 = 220+39+2+0+4+1 ✓; 2+259+1+4 = 266 ✓.**

All 107 newly-classified R1 edges (§4.5.1) are `C` (98) or `B` (9) — 0 new true positives (`A`/`H`), 0 new ambiguous (`D`), 0 new scanner/domain-map defects (`E`/`F`/`G`) were found among them. The count changes versus the pre-R1 192-edge round (§0.1) are fully attributable to §4.5.1's sample delta: 2 of the pre-R1 round's 4 true positives (1 `A`, 1 `H`) and 1 of its 2 scanner-FP (`F`) edges were among the 33 edges not re-selected under the corrected partition — not reclassified, not disputed, simply outside this round's sample (§4.5.1).

### 5.2 The 2 true-positive edges in the R1-corrected sample (both H) — every one independently re-verified by this document's author against current source, not merely trusted from the sub-agent report

Of the pre-R1 round's 4 true positives (§0.1), 2 were not re-selected under the corrected partition (§4.5.1) and are not part of this round's reviewed sample; they remain real findings against the N=552 population, just outside this particular random draw. The 2 still in-sample:

1. **`server/src/routes/whatsapp.ts` → `routes/contactRequests.ts`** (`upsertContactRequest`, classification H). Independently confirmed: `routes/whatsapp.ts` directly imports a Prisma-backed create/dedup function from another route file (`import { upsertContactRequest } from './contactRequests.js';`, confirmed at `contactRequests.ts`'s `export async function upsertContactRequest`, a real business function performing `prisma.contactRequest.findFirst`). Route-to-route dependency bypassing a service layer — the same anti-pattern already remediated for `getDateRange` under F2-ADR-ORG-DASH-001, not yet remediated here. This is also the sample's sole `routes -> routes` census edge (mandatory census rule 2 — always in-sample regardless of the partition fix).
2. **`server/src/routes/imagingBridgePublic.ts` → `services/imaging/imagingRequestTransitions.ts`** (classification H). Confirmed as a genuine cross-owner import (BRG's public device-facing surface reaching into IMG-owned transition logic) with no facade — independently documented as a known, already-tracked gap in `F2-PREP-006-A_IMG_BRG_OWNERSHIP_AND_IMPLEMENTATION_INVENTORY.md`, not new coupling.

**Not re-selected in this round** (removed from sample by the R1 partition fix, §4.5.1 — reported here for continuity, not re-verified this round):

- `server/src/jobs/inboundEventRetryJob.ts` → `services/whatsapp/MetaCloudWhatsAppProvider.ts` (classification A, pre-R1 finding: bypasses `services/whatsapp/whatsappProviderFactory.ts`).
- `server/src/services/privacy/patientPrivacyExportPackage.ts` → `routes/attachments.ts` (`ATTACHMENT_MAX_FILE_SIZE_BYTES`, classification H, pre-R1 finding: privacy-domain service importing a numeric config constant from a route file).

None of the 2 in-sample true positives, nor the 2 not-re-selected ones, touch tenant isolation, authentication, or KVKK/privacy data handling in a way that constitutes a security defect — all are architecture-layering/debt findings.

### 5.3 The 4 ambiguous edges (D) — unchanged by the R1 correction

Three (`server/src/routes/imaging.ts` → `bridgeOnboardingConfig.ts` / `bridgePairing.ts` / `bridgeTokens.ts`) are still all-ambiguous, but the `highRiskDomainCensus:imaging-device-bridge` stratum they belong to grew from N=3 (pre-R1) to **N=8** under the corrected partition — 5 additional edges whose `callerDomain` is `imaging-device-bridge` (e.g. `imagingBridgeOfflineJob.ts`'s imports of shared job/db infrastructure) are now correctly census-included in this stratum by the R1 fix (§0.1/§4.3.1); all 5 are newly classified `C` (§5.1), so the stratum's ambiguity is now 3-of-8 reviewed (`n_h_effective` = 5), not 3-of-3. The classifying agents' original finding, corroborated by prior program evidence (`F2-PREP-006-A`), is unchanged: `routes/imaging.ts` is domain-mapped wholesale to `imaging-server-viewer`, but 8 of its 27 routes are BRG-owned bridge-admin routes physically living in the same file — the "cross-domain" flag on these 3 edges is a **file-level domain-map granularity artifact**, not necessarily a real crossing, but not confidently resolvable without a domain-map change (out of this task's scope; reported, not fixed).

The 4th (`server/src/services/whatsappBookingFlow.ts` → `utils/whatsappDate.ts`) is a genuine ownership-ambiguity call: the target is domain-mapped to `messaging-whatsapp` but its content (pure Turkish date parsing, an AI-assistant timezone constant) reads as belonging to `messaging-ai-orchestration`. Reasonable engineers could assign it either way.

**Scanner/domain-classification defect note (F, brief-C):** the pre-R1 round independently found two `F` edges from two different reviewing agents converging on the same questionable domain-map entry: `server/src/services/instagram/instagramAiConversationProcessor.ts → utils/whatsappDate.ts` (classified F — the agent judged the file's genericness decisively, zero WhatsApp-specific coupling, reused from Instagram code) and `server/src/routes/usersImport.ts → utils/excelImport.ts` (mapped to `clinical-patients`, but the target serves two unrelated domains via `buildPatientTemplate`/`buildUserTemplate`). The `instagramAiConversationProcessor.ts` edge was **not re-selected** under the R1-corrected partition (§4.5.1) and is outside this round's sample; `usersImport.ts → utils/excelImport.ts` remains in-sample and is this round's sole `F`. The convergent domain-map concern about `utils/whatsappDate.ts` (§13 item 1) stands regardless — it was independent evidence from two callers, not dependent on either edge remaining in any one round's sample.

### 5.4 organizationDashboard.ts (VAL-004 brief §9 special check)

`domain-map.json` still assigns `server/src/routes/organizationDashboard.ts` → `core-org-clinic-membership` (unchanged since F2-ADR-ORG-DASH-002; source file not materially changed — ADR not reopened). It appears as **caller** in **4 distinct `NEW` edges** (5 underlying findings; `AuthRequest`+`authorize` collapse into one 2-symbol edge), **0 `EXISTING`**, **0 as target** of any finding. All 4 were included in the sample via mandatory census (§4.3 rule 1) and all 4 were classified **C** (`EXPECTED_PLATFORM_SHARED_EDGE`) — imports of `middleware/auth.ts`, `utils/roles.ts`, `db.ts`, and `utils/helpers.ts` (the `getDateRange` relocation target from F2-ADR-ORG-DASH-001), all standard platform-shared patterns fully consistent with the ADR decision.

### 5.5 Other reported (not fixed) follow-up items

- `routes/contactRequests.ts`'s own domain-map assignment (`clinical-appointments-availability`) looks questionable on inspection — its content (channel/externalSenderId/patient-linking CRUD) reads as lead/contact-intake tracking, not appointment scheduling. *(Independently reconfirmed by an R1-round reviewing agent from a different caller, §0.1.)*
- `checkPractitionerAvailability` (in `utils/helpers.ts`) is genuine appointments-availability business logic embedded in a nominally generic helpers file — candidate for relocation to `services/appointments/appointmentAvailabilityService.ts`. *(Independently reconfirmed by an R1-round reviewing agent, §0.1.)*
- `services/whatsappBookingFlow.ts` is a misleadingly-named shared AI booking engine used by both WhatsApp and Instagram — a rename (e.g. `messagingBookingFlow.ts`) would better reflect its scope; its domain-map placement under `messaging-whatsapp` vs. `messaging-ai-orchestration` is the same tension noted in §5.3/§5.4.
- `schemas/index.ts` is domain-mapped to `core-shared-platform-infrastructure` but is a large, monolithic Zod-schema registry spanning many unrelated business domains (patient, finance, insurance, messaging, ...) — legitimate under the current pre-modularization architecture (classified `C` throughout), but worth reconsidering if/when schemas are ever split per-domain. *(Newly noted by 3 independent R1-round reviewing agents across different batches, §0.1.)*

None of these require a prohibited change to act on; all are reported for a separate follow-up task per this task's scope limits.

Full per-edge classification records (edgeKey, reasoning, caller/target evidence citations, follow-up flags) are in `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-004_classifications_merged.json` (266 records, R1-corrected), the 5 original per-batch `*_classified.json` files (192 records, pre-R1, 159 still reused), and the 4 new `F2-GUARDRAIL-VAL-004-R1_batch{1..4}_classified.json` files (107 records, R1-only).

---

## 6. Signal-quality metrics

Script: `scripts/architecture-guardrail-validation/buildVal004Metrics.mjs` (new, checked in). Deterministic (re-run produces byte-identical output — verified).

All numbers in this section are **R1-corrected** (§0.1) — computed from the 266-edge sample and its merged classifications, not the pre-R1 192-edge round.

### 6.1 Raw as-sampled metrics (n=266, classified_non_ambiguous=262)

| Metric | Formula | Value |
|---|---|---:|
| True-positive precision | briefA / classified_non_ambiguous | 2/262 = **0.76%** |
| False-positive rate | (briefB+briefC) / classified_non_ambiguous | 260/262 = **99.24%** |
| Accepted-expected rate | briefB / classified_non_ambiguous | 259/262 = **98.85%** |
| Scanner/classification-defect rate | briefC / classified_non_ambiguous | 1/262 = **0.38%** |
| Ambiguity rate | briefD / total_sample | 4/266 = **1.50%** |

These are **unweighted, disproportionate-sample raw rates** — because high-risk strata were deliberately oversampled (up to ~4× their population share) and small strata were censused, this raw rate is **not** a valid population estimate on its own. It is reported per the brief's own §7 requirement, alongside the weighted estimate below (required by REVIEW-A §I).

### 6.2 Weighted population estimate (headline number)

```
p_hat = Σ_h (N_h/N) × (fp_h/n_h)
```
computed over **all 30 of 30 strata** — every stratum has ≥1 non-ambiguous classified edge (`n_h_effective` > 0) under the R1-corrected sample. This is a change from the pre-R1 round (§0.1): the `highRiskDomainCensus:imaging-device-bridge` stratum that was previously fully ambiguous (N=3, 3/3 `D`) grew to N=8 under the partition fix (§5.3) and now has 5 non-ambiguous reviewed edges, so no stratum is excluded from the weighted sum this round.

| | Value |
|---|---:|
| **Weighted population accepted-edge rate (p_hat)** | **99.64%** |
| **Weighted population violation-rate complement (1 - p_hat)** | **0.36%** |
| Covered population (N_h summed over estimable strata) | 552 / 552 |
| Excluded strata | none |

**WEIGHTED_POPULATION_FP_ESTIMATE = 99.64% (accepted/expected), RAW_AS_SAMPLED_FP_RATE = 99.24%.** The weighted estimate is the headline number per REVIEW-A §I; the raw rate is reported alongside, not presented as the population estimate.

### 6.3 Confidence intervals, and the zero-event sensitivity analysis (relabeled per §0.1 finding 2 — no confidence-coverage claim)

**Analytic (stratified, finite-population-correction):** 95% CI = **[99.64%, 99.64%]** (zero width).
**Bootstrap (2,000 resamples, stratified, seed `F2-GUARDRAIL-VAL-004-BOOTSTRAP-v1`, deterministic mulberry32-from-SHA-256):** 95% CI = **[99.28%, 99.82%]**.

Both methods produce a **near-degenerate, narrow interval**. This is **not a computation defect** — it is a well-known statistical property (Wald/parametric-bootstrap degeneracy) that occurs when a stratum's *observed* sample proportion is exactly 0% or 100%: the plug-in sample variance `n/(n-1) × p × (1-p)` evaluates to exactly 0 when `p=1`. Several of this sample's largest strata (all 8 `highRiskOversample:*` strata, 15/15 sampled = 100% accepted each; `cluster5PlusCensus`, 16/16) hit exactly this case. Additionally, both `standardProportional` strata were sampled at only `n_h=1` (floor), which provides no internal variance estimate at all.

**This is explicitly NOT a formal confidence-covered population ceiling — see §0.1 finding 2.** The prior round of this document called the corresponding number a "conservative weighted violation-rate ceiling" implying formal 95% population coverage; an external architecture review correctly identified that the underlying computation does not support that claim: strata with ≥1 observed violation keep an *unbounded* plug-in rate (not itself upper-bounded for its own unobserved remainder), ambiguous edges are complete-case-excluded rather than folded in conservatively, and a weighted sum of independent per-stratum marginal one-sided 95% bounds carries **no stated simultaneous/global confidence-coverage guarantee**. Per REVIEW-A §J's own instruction ("do not overstate statistical certainty... flag the estimate as unstable") and the review's preferred minimal-relabel path, the function (`zeroEventSensitivityAnalysis()`, unchanged computation) and its output fields (`sensitivityAcceptedRate` / `sensitivityViolationRate` / `hasConfidenceCoverage: false`) are named to make this explicit. For every non-census, non-ambiguous stratum where **zero** violations were observed (`fp_h == n_h_effective`), the exact Clopper-Pearson one-sided bound on the *true* violation rate (`1 - 0.05^(1/n)`) is substituted for the naive "0 observed" plug-in before recomputing the weighted sum:

| | Value |
|---|---:|
| Sensitivity accepted-rate | **71.98%** |
| **Sensitivity violation rate (NOT a confidence-covered ceiling)** | **28.02%** |
| Has formal confidence coverage? | **No** — see disclaimer below |

> **`confidenceCoverageNote` (verbatim from `F2-GUARDRAIL-VAL-004_metrics.json`):** "NOT a formally covered simultaneous/global confidence bound. Non-zero-event non-census strata keep an unbounded plug-in rate, ambiguous edges are complete-case-excluded, and a sum of independent marginal one-sided bounds carries no stated joint coverage. Sensitivity-only; not valid merge/promotion/enforcement evidence."

This sensitivity value moved from 21.10% (pre-R1) to 28.02% (R1-corrected) — not because uncertainty grew, but because the R1-corrected sample now includes 10 zero-observed-violation non-census strata subject to the substitution (the 8 `highRiskOversample:*` strata + `cluster5PlusCensus` + `highRiskDomainCensus:imaging-device-bridge`, the last newly eligible because it is no longer fully ambiguous, §6.2) versus 5 previously, plus both `n=1` `standardProportional` strata each still contributing a 95% Clopper-Pearson substitution on their own small population share (`core-org-clinic-membership` N=10, `core-shared-platform-infrastructure` N=84). **This is a transparency/robustness disclosure only, per §0.1 finding 2 — it must not be read as a merge-readiness, promotion, or CI-blocking enforcement signal**, and this document makes no such use of it. A follow-up validation task increasing sample size specifically in the two `n=1` `standardProportional` strata would tighten this sensitivity value materially, though even a tighter sensitivity value would still carry no formal confidence-coverage guarantee unless a genuinely simultaneous/global bound were separately derived (§0.1's rejected alternative path). `ciAgreement` is reported as `DEGENERATE_NARROW_BOTH_METHODS_SEE_SENSITIVITY_ANALYSIS`, not `CONSISTENT`, to avoid implying false precision.

### 6.4 High-risk-only metrics

| | Value |
|---|---:|
| n (high-risk edges in sample) | 253 |
| classified_non_ambiguous | 249 |
| True positives (A+H) | 2 |
| False-positive rate | 247/249 = **99.20%** |
| Ambiguity rate | 4/253 = **1.58%** |

Both true positives in the R1-corrected sample are high-risk-domain-touching (100% of true positives found were in high-risk strata) — consistent with those strata being deliberately oversampled for safety coverage. `n` grew from 173 (pre-R1) to 253 — direct evidence the partition fix (§0.1/§4.3.1) materially increased high-risk coverage, as intended.

### 6.5 Metrics by edge shape (top families, n≥5)

| Edge shape | n | classified_non_ambiguous | TP count | FP rate |
|---|---:|---:|---:|---:|
| routes → utils | 83 | 83 | 0 | 100% |
| routes → services | 33 | 30 | 1 | 96.7% |
| routes → root-or-other | 30 | 30 | 0 | 100% |
| services → root-or-other | 27 | 27 | 0 | 100% |
| services → services | 26 | 26 | 0 | 100% |
| services → utils | 23 | 22 | 0 | 100% |
| routes → middleware | 16 | 16 | 0 | 100% |
| jobs → utils | 8 | 8 | 0 | 100% |
| jobs → root-or-other | 6 | 6 | 0 | 100% |

(Remaining families each n≤4; full table in `F2-GUARDRAIL-VAL-004_metrics.json`.) The `routes -> routes` shape (n=1, 0% FP) is still the sole census member and still the whatsapp→contactRequests true positive (§5.2), unaffected by the partition fix (mandatory census rule 2). The pre-R1 round's other 100%-true-positive singleton family, `services -> routes` (the patientPrivacyExportPackage true positive), is no longer in-sample (§4.5.1/§5.2); a different, non-true-positive edge now occupies that shape's n=1 slot.

### 6.6 Metrics by caller layer

| Caller layer | n | TP count | FP rate |
|---|---:|---:|---:|
| routes | 163 | 2 | 98.75% |
| services | 77 | 0 | 100% |
| jobs | 20 | 0 | 100% |
| utils | 4 | 0 | 100% |
| middleware | 2 | 0 | 100% |

### 6.7 Metrics by cluster-size bucket

| Bucket | n | TP count | FP rate |
|---|---:|---:|---:|
| 1 | 192 | 1 | 99.47% |
| 2-4 | 58 | 1 | 98.25% |
| 5+ | 16 | 0 | 100% |

No evidence that larger multi-symbol clusters hide more violations than single-symbol edges — if anything the opposite (0 true positives among the 16 census-reviewed cluster≥5 edges).

---

## 7. Comparison to VAL-001 / VAL-002 / VAL-003

Per REVIEW-A §K, explicit and unambiguous:

**VAL-001_RATE_COMPARISON = NOT_DIRECTLY_COMPARABLE.** Reasons: VAL-001 used a purposive, rule-based (non-probability) sample of raw findings, not edges; it pre-dated the domain-map/baseline reconciliation this task's population reflects; it deliberately oversampled several categories without population weighting; and VAL-001 itself explicitly disclaimed formal statistical inference. **Do not** read "8.9% (VAL-001) → 0.76%/0.36% (VAL-004, R1-corrected; was 2.13%/0.73% pre-R1, §0.1)" as an improvement trendline — the sampling units, methodologies, and populations are not the same measurement, and even the pre-R1 → R1 change within this same task reflects a sampling-partition correction, not a signal-quality change in the codebase.

**VAL-003_NEW_COUNT_REDUCTION = BASELINE_COVERAGE_CHANGE_NOT_SIGNAL_QUALITY_MEASUREMENT.** VAL-003's `NEW` 1,024 → 846 reduction came entirely from accepted-baseline authoring (88 explicit + 90 sibling flips = 178), independently re-confirmed unchanged by this task's own fresh scan (846/193/1,039, byte-identical population). It reflects accepted-baseline *coverage*, not a change in scanner precision/recall — VAL-004 is the first population-estimating, edge-level signal-quality measurement taken *after* that coverage change, not a before/after comparison of the same measurement.

**VAL-002 comparison:** not attempted — VAL-002 was a domain-map/baseline reconciliation task (config + baseline-authoring), not a false-positive sample; there is no VAL-002 rate to compare against.

**Categories dominating remaining `NEW` findings (this sample):** overwhelmingly `C` (`EXPECTED_PLATFORM_SHARED_EDGE`, 220/266 = 82.7%) — shared/platform utility imports (auth middleware, role checks, db client, encryption/secrets, audit logging, storage abstraction) that are architecturally legitimate under the current pre-modularization structure. This is consistent with, though not statistically comparable to, VAL-001's own observation that `EXPECTED_PLATFORM_SHARED_EDGE` was its largest single category.

**Are remaining false positives concentrated in a small number of patterns?** Yes — this round's sole scanner/domain-classification-defect (`F`) edge (`usersImport.ts → utils/excelImport.ts`) and the pre-R1 round's other `F` edge (`instagramAiConversationProcessor.ts → utils/whatsappDate.ts`, not re-selected under the R1-corrected partition, §5.3) both trace to the same root cause: a generic utility file domain-mapped to a single narrow business domain despite serving multiple domains.

**Are remaining true positives concentrated in particular boundaries?** The 2 true positives in the R1-corrected sample (§5.2) both involve route files reaching directly into another domain's concrete implementation/business function instead of its designed abstraction (a service layer) — the same theme the pre-R1 round's other 2 true positives (not re-selected this round, §5.2) also showed, so this observation is unchanged by the partition fix even though the specific in-sample edge set is smaller.

---

## 8. Scanner blind-spot note (REVIEW-A §M)

This sampling exercise measures the **precision of the current scanner's detection surface**, which is strictly **import-syntax based** (`scripts/architecture-guardrail/lib/edgeExtraction.ts` parses static `import` statements only — no Prisma-call analysis, no dynamic `require`, no runtime dependency-injection tracing). **This cannot measure architectural violations outside that detection surface** — e.g. a route file reaching another domain's data via a shared service that itself does the cross-domain Prisma access (already flagged as an explicitly-unresolved, pre-existing gap for `organizationDashboard.ts` in F2-ADR-ORG-DASH-002 §"Explicitly NOT resolved"). **Do not infer "high scanner precision (99.64% accepted) = the repository has no boundary violations."** Detector precision (how often a flagged edge is real) and detector recall (how many real violations it flags) are conceptually separate; this task measured precision only.

---

## 9. Determinism evidence

| Artifact | Method | Result |
|---|---|---|
| Raw scan (3×) | sha256 + diff | byte-identical |
| Edge-population derivation (3× against the 3 scan runs) | diff | byte-identical |
| Sample manifest, pre-R1 partition (2× against same population) | diff | byte-identical |
| Metrics computation, pre-R1 sample (2× against same sample+classifications) | diff | byte-identical |
| **Sample manifest, R1-corrected partition (2×+ against same population, post-fix code)** | diff | byte-identical |
| **Metrics computation, R1-corrected sample (2×+ against same sample+classifications, post-fix code)** | diff | byte-identical |
| **New synthetic-fixture regression test: `buildSample` byte-identical reruns on a mixed caller/owner-high-risk population** (`__tests__/val004Determinism.test.js`, §10) | `node --test` | pass |

No non-determinism defect found at any stage, including after the R1 partition-fix rework.

---

## 10. Test / validation results (R1)

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck:guardrail` | 0 | clean, no output |
| `npm run guardrail:test` | 0 | **74/74** passed |
| `npm run test:runtime:unit` | 0 | **74/74** passed |
| `node --test scripts/architecture-guardrail-validation/__tests__/*.test.js` | 0 | **50/50** passed (30 pre-existing + 14 pre-R1 + **6 new R1 regression tests**, in `val004Determinism.test.js`) |
| `git diff --check` | 0 | clean, no whitespace errors |

New test file `scripts/architecture-guardrail-validation/__tests__/val004Determinism.test.js` (pre-R1 portion, 14 tests) covers: edge-population collapsing/reconciliation, input-order independence, `edgeKey` excludes `callerSymbol`, `targetSampleSize` formula, `edgeShape`/`isHighRisk` classifiers, `stableRank` determinism, full-stratum-assignment invariant, sample-builder byte-identical reruns, the VAL-001→brief taxonomy mapping (exhaustive), the fp-indicator semantics, the Clopper-Pearson bound, census-stratum zero-variance invariant, and an end-to-end rerun of the real checked-in sample+classifications.

**R1 addendum (6 new tests, §0.1):** on a synthetic mixed population containing a caller-side-only high-risk edge, an owner-side-only high-risk edge, a both-endpoints-high-risk edge (two distinct categories), and 20 genuinely standard edges —
1. the caller-side-only high-risk edge cannot enter a `standardProportional`/`smallCellCensus` stratum (must land in a `highRiskDomainCensus`/`highRiskOversample` stratum keyed by its high-risk `callerDomain`);
2. the owner-side-only high-risk edge gets high-risk census/oversample treatment (unchanged pre-fix behavior, still correct post-fix);
3. the both-endpoints-high-risk edge is included **exactly once**, under one deterministic stratum (`highRiskDomainKey` ties-break to `ownerDomain`);
4. the partition accounts for **exactly N** edges with no duplication and no gaps (`unassignedCount === 0`, `Σ strataPopulations === N`) — this is the direct regression test for the double-counting defect the fix surfaced and closed (§4.3.1);
5. `buildSample` reruns remain byte-identical on this mixed population;
6. `zeroEventSensitivityAnalysis()` makes no formal confidence-coverage claim (`hasConfidenceCoverage: false`) and uses non-ceiling field names (`sensitivityAcceptedRate`/`sensitivityViolationRate`, not `p_hat_conservative_*`).

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

**Pre-R1 (unchanged from the original round, retained for history):**
`F2-GUARDRAIL-VAL-004_scan_run1.json`, `_scan_run2.json`, `_scan_run3.json`, `_edge_population.json`, `_batch{1..5}_*_input.json` (5), `_batch{1..5}_*_classified.json` (5) — all in `docs/program/evidence/tooling/`.

**R1-modified (docs/program/evidence/tooling/):**
`F2-GUARDRAIL-VAL-004_sample_manifest.json` (regenerated, R1-corrected partition, 266 edges), `F2-GUARDRAIL-VAL-004_classifications_merged.json` (regenerated, 159 reused + 107 newly classified = 266 records), `F2-GUARDRAIL-VAL-004_metrics.json` (regenerated from the corrected sample+classifications).

**R1-new (docs/program/evidence/tooling/):**
`F2-GUARDRAIL-VAL-004-R1_batch1_classified.json` .. `_batch4_classified.json` (4 files, 107 newly-classified edges, 27/27/27/26).

**R1-modified (scripts/architecture-guardrail-validation/):**
`buildVal004Sample.mjs` (high-risk partition fix — `highRiskDomainKey()`, symmetric census/oversample grouping, double-counting fix, §0.1/§4.3.1), `buildVal004Metrics.mjs` (`conservativeWeightedUpperBound` → `zeroEventSensitivityAnalysis`, `p_hat_conservative_*` → `sensitivityAcceptedRate`/`sensitivityViolationRate` + `hasConfidenceCoverage`/`confidenceCoverageNote`, §0.1/§6.3), `__tests__/val004Determinism.test.js` (+6 R1 regression tests, §10).

**Unchanged from the original round:** `buildVal004EdgePopulation.mjs` (population derivation is unaffected by the sampling-partition fix).

**This main evidence doc:** `docs/program/evidence/F2-GUARDRAIL-VAL-004_FRESH_STRATIFIED_SIGNAL_QUALITY.md` (this file, updated in place — §0.1).

**Modified (append-only corrections, this R1 round added a new top entry to each, prior entries preserved):** `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md`.

**Not touched:** `scripts/architecture-guardrail/**` (scanner itself), `scripts/architecture-guardrail/config/domain-map.json`, `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (accepted baseline), any `server/`, `client/`, `prisma/`, or CI workflow file.

---

## 13. Unresolved findings (reported, not fixed — out of this task's authorization)

1. `utils/whatsappDate.ts` domain-map placement (`messaging-whatsapp` vs. `messaging-ai-orchestration`) — independently flagged by two different reviewing agents from two different callers (§5.3).
2. `utils/excelImport.ts` domain-map placement (`clinical-patients`, serves 2 unrelated domains).
3. `routes/contactRequests.ts` domain-map placement (`clinical-appointments-availability` vs. its actual contact/lead-intake content) — independently reconfirmed by an R1-round reviewing agent (§5.5).
4. `routes/imaging.ts`'s file-level domain-map granularity vs. its embedded BRG-owned sub-routes (now an 8-edge stratum, 3 ambiguous, post-R1, §5.3) — a known, prior-documented (`F2-PREP-006-A`) issue, not new.
5. The 2 true-positive boundary/layering findings in the R1-corrected sample, plus 2 more findings from the pre-R1 sample not re-selected this round but still valid against the population (§5.2) — none security/tenant-critical, all recommended for a separate, future remediation task (in the pattern of F2-ADR-ORG-DASH-001's `getDateRange` fix).
6. `checkPractitionerAvailability` business logic embedded in `utils/helpers.ts` — independently reconfirmed by an R1-round reviewing agent (§5.5).
7. Follow-up recommendation: increase sample size in the two `n=1` `standardProportional` strata (`core-org-clinic-membership`, `core-shared-platform-infrastructure`) in any subsequent validation round, to tighten the §6.3 sensitivity value — noting that even a tighter value would remain a sensitivity disclosure, not a formal confidence bound, unless a genuinely simultaneous/global bound is separately derived (§6.3).
8. `schemas/index.ts` domain-map placement (`core-shared-platform-infrastructure`) — a large multi-domain Zod-schema registry; not currently a violation (all imports classified `C`), but worth reconsidering under future per-domain schema splitting (newly noted by 3 independent R1-round reviewing agents, §5.5).

None of these require, and none received, a domain-map, baseline, or application-code change under this task.

---

## 14. Blocking enforcement

**BLOCKING_ENFORCEMENT = NOT_AUTHORIZED.** This document does not enable, propose enabling, or imply readiness for CI-blocking/production architecture enforcement. Per the task's own scope limits, the only permitted conclusions are: signal quality measured (this document), remaining issues identified (§13), and — explicitly — that a **separate, future task** would be needed to define promotion-to-blocking criteria using this evidence (plus the still-open F2-SEC-001/F2-SEC-002 deployment + production verification thread). That decision is not made here.

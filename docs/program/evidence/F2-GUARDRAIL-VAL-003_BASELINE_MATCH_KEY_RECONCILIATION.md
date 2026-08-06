# F2-GUARDRAIL-VAL-003 — Baseline Match-Key Reconciliation for Previously Classified Expected Edges

**Phase:** F2 — Modular Monolith Guardrails / Accepted Baseline Reconciliation
**Task type:** Baseline-data authoring only (`F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json`, append-only). No scanner/matcher code change was made (see §3 — proven unnecessary, not merely deferred). No runtime application, schema, migration, tenant, or auth behavior changed.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

## 0. Task-ID correction (read this first)

The assigning brief named this task `F2-GUARDRAIL-PREP-010-B`. That ID is **already taken**: `docs/program/evidence/F2-GUARDRAIL-PREP-010-B_TENANT_SCOPE_USAGE_AND_BYPASS_INVENTORY.md` (PR #315, `MERGED`, merge commit `0881d389ade37606a561659409cc27e38857c318`) is a distinct, already-merged, differently-scoped task (tenant-scope usage/bypass inventory, discovers F2-SEC-001/F2-SEC-002). Both `NORAMEDI_MASTER_TRACKER.md` §7 and the evidence directory confirm this — independently checked before any file was written by this task (`git status`/`ls`/`grep` against the freshly-checked-out worktree, not assumed from the brief).

This task's actual content — baseline-authoring the ~88 findings `F2-GUARDRAIL-VAL-002` §9/§15 explicitly named as its own next, separately-scoped follow-up — is adopted under the corrected ID **`F2-GUARDRAIL-VAL-003`**, continuing the existing `VAL-00x` signal-quality/reconciliation sequence (VAL-001 found the issue, VAL-002 diagnosed and explicitly deferred it, VAL-003 is that deferred follow-up). Verified before adoption: no `VAL-003` evidence file, branch, or open/merged PR exists anywhere in this repository (`gh pr list --search`, `git ls-remote --heads origin`, directory grep — all empty). Branch renamed accordingly: `fix/f2-guardrail-val-003-baseline-match-key-reconciliation` (was created as `fix/f2-guardrail-prep-010-b-baseline-match-key` per the brief's suggestion, renamed via `git branch -m` before any commit).

## 1. Baseline verification

```
git fetch origin --prune
git rev-parse origin/main          -> 46acae8415020cb0bd340fbc854c4187c43e3662
git status --short                 -> clean (repo root)
git worktree list --porcelain      -> new worktree added at a fresh path, branch above
```

`46acae8415020cb0bd340fbc854c4187c43e3662` is exactly the SHA the assigning brief cites for PR #328 (F2-ADR-ORG-DASH-001-R2) — independently confirmed as `origin/main`'s current tip, not merely trusted from the brief. `gh run list --branch main --json headSha,conclusion` confirms `ci-main-and-nightly` `success` on this exact SHA, and separately on `99436e5ba0823fcc82d86eb9b731dc5dffd04ccb` (PR #329 / F2-GUARDRAIL-VAL-002's merge commit) and `61ca9d82507b3f24f3c943104cb6aa20ad13faa0` (PR #327). `git merge-base --is-ancestor` confirms both `99436e5...` and `46acae8...` are ancestors of (in `46acae8`'s case, equal to the tip of) `origin/main`.

The isolated worktree was created via `git worktree add <path> -b fix/f2-guardrail-val-003-baseline-match-key-reconciliation origin/main`. The first `worktree add` attempt was interrupted by a 2-minute tool timeout mid-checkout (large repo, ~1,500 files) and left a stale `index.lock`; the broken worktree was removed and recreated cleanly from `origin/main` before any file was written — HEAD independently re-confirmed `46acae8415020cb0bd340fbc854c4187c43e3662` before proceeding. `npm ci` succeeded (matches the ~427-package count prior guardrail tasks recorded).

A pre-existing worktree for the parallel `F2-ADR-ORG-DASH-002` task (organizationDashboard ownership ADR) was observed as `locked` (an active agent process) during `git worktree list` — it was never read from or written to by this task, consistent with the parallel-isolation rule.

## 2. Reproducing the mismatch — before-scan (twice, byte-compared)

```
npm run guardrail:scan -- --repo-sha=46acae8415020cb0bd340fbc854c4187c43e3662 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json
npm run guardrail:scan -- --repo-sha=46acae8415020cb0bd340fbc854c4187c43e3662 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_before_scan_run2.json
diff <run1> <run2>   -> no output (byte-identical, 415,403 bytes each)
```

| Field | Value |
|---|---|
| Files discovered / parsed / skipped | 247 / 247 / 0 |
| Total findings | 1,039 |
| `NEW` | 1,024 |
| `EXISTING` | 15 |
| Errors / Warnings | 0 / 0 |
| `resolvedBaselineEdgeIds` | `["CDA-072"]` |
| Baseline edge count | 71 |

Exactly matches the counts already recorded by `F2-ADR-ORG-DASH-001-R2` for this same `origin/main` tip — re-measured, not assumed.

### Building the exact candidate list (not sampled, not trusted from VAL-002's prose)

A checked-in script (`scripts/architecture-guardrail-validation/buildVal003Candidates.mjs`) cross-references `F2-GUARDRAIL-VAL-001`'s 137 `B`/`C` (expected-edge) classified sample findings against this before-scan by exact finding ID:

| Bucket | Count |
|---|---:|
| VAL-001 `B`/`C` sample size | 137 |
| Same finding ID, still present in current scan | 98 |
| Finding ID changed since VAL-001 (domain relabeling by VAL-002, edge structurally altered, etc. — **excluded**, per the brief's instruction to exclude findings whose source/target changed) | 39 |
| Of the 98 same-ID findings: now `EXISTING` (already resolved, no action needed) | 10 |
| Of the 98 same-ID findings: still `NEW` | **88** |

This **88** is the exact candidate count named by the assigning brief, independently re-derived (not copy-pasted from VAL-002's own "~88" prose estimate) — and it excludes, by construction, every finding whose finding-ID-defining fields (`callerPath`, `callerSymbol`, `ownerDomain`, `targetModelOrSymbol`, `accessKind`) changed since VAL-001, since a changed ID cannot match. `0` of the 88 involve `organizationDashboard.ts` as caller or target (checked explicitly, not assumed).

## 3. Matcher-semantics inspection — the root cause is NOT what the brief's framing assumed

Files read: `scripts/architecture-guardrail/lib/baseline.ts`, `lib/findingId.ts`, `lib/types.ts`, `lib/edgeExtraction.ts`, `lib/globMatch.ts`, `lib/normalization.ts`, `__tests__/baseline.test.ts`.

**Fields present in a `Finding`:** `id`, `callerPath`, `callerSymbol`, `ownerDomain`, `callerDomain`, `targetModelOrSymbol`, `accessKind` (always `'import'` — this scanner's V1 scope is syntactic relative-import extraction only, never raw Prisma/DB access), `baselineStatus`, `baselineEdgeId`.

**Fields accepted in a baseline entry** (`BaselineJsonEdge.proposedEnforcementKey`): `callerPath`, `callerPathGlob`, `callerSymbol`, `ownerDomain`, `targetModelOrSymbol`, `accessKind`.

**Fields used in matching** (`findMatchingBaselineEntry`, `lib/baseline.ts:109-118`): exactly `MATCH_KEY_FIELDS = ['callerPath', 'ownerDomain', 'targetModelOrSymbol', 'accessKind']`. `callerSymbol` is read into `BaselineEntry.callerSymbol` and reported on findings for human review, but **is never compared** during matching.

**Is `callerSymbol` optional or required?** It is present in the schema but structurally inert for matching — `loadBaselineEntries` accepts it (`key.callerSymbol ?? null`) but `findMatchingBaselineEntry` never reads `entry.callerSymbol`. There is no conditional "wildcard only when omitted" behavior (Option A's premise) because there is no behavior gated on its presence at all — it is unconditionally excluded, every time, by design.

**Is this already correct and already tested?** Yes. `__tests__/baseline.test.ts:58-68` (`'callerSymbol differing from the baseline entry still matches (excluded from match key, documented limitation)'`) constructs a tuple with a callerSymbol value that does **not** match the baseline fixture's recorded `callerSymbol`, and asserts a match is still found. This test passes today and passed before this task. **The callerSymbol-exclusion behavior the brief's Option A/B/C treat as a candidate defect is intentional, documented (`lib/baseline.ts:14-27`), and already covered by a passing regression test.**

**Do imports, Prisma access, service calls, and route registration produce different symbol shapes?** Not relevant to this task's findings — `accessKind` is always `'import'` for every finding this scanner emits (it does not extract Prisma/service-call/route-registration edges at all; see `edgeExtraction.ts`'s single `ts.isImportDeclaration` branch). This eliminates one hypothesis the brief asked to check: symbol-shape variance across access kinds cannot be the cause, because there is only one access kind in play.

**Does the existing baseline generator emit fields incompatible with runtime matching?** No — `CDA-067..072` (the "R1" precision-corrected entries) already use exact `callerPath`/`callerSymbol` values in a shape the loader consumes without incident.

### The actual mismatch matrix (real data, not hypothesis)

A second checked-in script (`scripts/architecture-guardrail-validation/verifyVal003Candidates.mjs`) independently re-confirmed, by direct `readFileSync`+regex re-check of the **current** caller file (not trusting VAL-001's prior read), that all 88 candidates' import statements are still present exactly as VAL-001 described them — **88/88 confirmed, 0 stale**.

A third script (embedded in `buildVal003Candidates.mjs`'s `analyze()`) then classified *why* each of the 88 still-`NEW` findings has no baseline match, by directly inspecting `F2-GUARDRAIL-PREP-010-A`'s 71 existing edges:

| Reason | Count | Meaning |
|---|---:|---|
| `NO_RELATED_BASELINE_ENTRY_AT_ALL` | 87 | No baseline edge exists with this finding's exact `callerPath`, nor any edge sharing its `(ownerDomain, targetModelOrSymbol, accessKind)` — the edge was never entered into the baseline file by any prior task. |
| `CALLERPATH_MATCHES_BUT_OWNER_TARGET_ACCESS_DIFFERS` | 1 | `server/src/routes/noShows.ts` already has two baseline entries (`CDA-071`, `CDA-072`) for *other* imports from that same file — but neither covers this specific `services/clinicOperatingPreferences.ts` import. A different, un-baselined edge from an already-partially-baselined file. |

**Both reasons are a data-completeness gap in the baseline file — zero occurrences of a finding that has a real, same-key baseline entry but fails to match it due to a `callerSymbol` (or any other) comparison defect.** The premise embedded in the assigning brief's Options A/B/C — that a matcher defect is blocking otherwise-matchable edges — is empirically false for all 88 candidates. `F2-GUARDRAIL-VAL-002`'s own §9 prose attributed the 88 to "the scanner's baseline match key excludes callerSymbol," explicitly denying it was "a data-completeness gap" — that specific causal claim does not survive re-verification against the actual data and is corrected here, per the assigning brief's own constraint 5 ("do not treat a previously sampled classification as sufficient by itself").

## 4. Decision — Option D selected; Options A/B/C rejected

| Option | Verdict | Why |
|---|---|---|
| A — make `callerSymbol` wildcard only when the baseline schema explicitly omits it | **Rejected** | No defect to fix: matching is already unconditionally `callerSymbol`-agnostic (not conditionally so), and this is already correct/tested (§3). Implementing "Option A" as literally described would be a no-op at best; reframing it as "require exact `callerSymbol` when the baseline entry has one" would be a **behavior change**, not a correction, and would break the 90 already-legitimate symbol-sibling matches documented in §6 — disqualified by the brief's own rejection criterion "weakens ... caller/access-kind/path matching." |
| B — require `callerSymbol` everywhere, update authoring tooling/schema | **Rejected** | Same reasoning — this would newly require exact-symbol baseline entries for every one of the ~90 sibling imports found in §6, multiplying entry count for edges that are already correctly and safely matched today. It would also retroactively invalidate the 6 already-accepted `CDA-067..072` entries' sibling-tolerance and the existing passing test at `baseline.test.ts:58-68`, which the brief explicitly disallows ("reject any option that ... changes finding IDs unnecessarily" / "breaks deterministic output" is adjacent in spirit — a matching-semantics change of this scope is exactly the kind of scanner-code change the brief gates on proof of a real defect, which does not exist). |
| C — normalize `callerSymbol` at finding-creation and baseline-load time | **Rejected** | Normalization presupposes `callerSymbol` participates in matching at all. It does not, so there is nothing to normalize for matching purposes. `callerSymbol` values found during this task's own investigation (plain identifiers like `withJobLock`, `AuthRequest`, `canManageBranches`) show no case/whitespace/quoting inconsistency that would need normalizing even for the human-review display use it does have. |
| **D — do not change the matcher; author exact baseline entries** | **Selected** | Matches the actual, empirically-confirmed root cause (§3): 87/88 candidates have no baseline entry at all for their exact edge; 1/88 has entries for the same file but a different edge. The correct, narrowest fix is to add the missing entries, not to alter working, tested, intentional matcher logic. |

This also resolves the tension the brief itself flagged between constraint 12 ("prefer a narrow match-key correction over duplicating dozens of semantically identical baseline entries") and constraint 3 ("do not create path-wide or domain-wide baseline entries"): constraint 12's premise (a match-key defect exists that a narrow correction could fix) does not hold here, so it does not apply, and constraint 3 governs — each of the 88 new entries is authored with an exact `callerPath` (never a glob), exactly as the existing precision-corrected `CDA-067..072` entries already establish as this baseline's own convention.

No implementation gate in the brief's §E is met (no defect is proven), so **no scanner code was touched.** `scripts/architecture-guardrail/lib/`, `cli.ts`, `config/scan-roots.json`, and `config/domain-map.json` are byte-identical to `origin/main`. Rollback, if ever needed, is therefore a single revert of the additive baseline-JSON commit — no code-level rollback risk exists.

## 5. Baseline authoring — 88 candidates, all individually re-verified, all `ACCEPTED_BASELINE`

Every one of the 88 candidates was independently re-verified against **current** source before being accepted (per constraint 5) — not transcribed mechanically from VAL-001's prior sample (per constraint on "do not mechanically add all ~88 entries"):

1. **Import-presence re-check** (`verifyVal003Candidates.mjs`): regex-confirmed the exact `callerSymbol` is still imported from a specifier resolving to `targetModelOrSymbol` in the **current** `callerPath` file. 88/88 confirmed present; 0 stale.
2. **Target-module nature re-check**: the header/doc-comment of each of the 48 distinct target files was read directly (not from VAL-001's summary alone). Every one is a self-declared generic/shared utility, service, or job module (e.g. `middleware/auth.ts`, `utils/roles.ts`, `utils/clinicScope.ts`, `utils/sessionCookies.ts`, `utils/auditLog.ts`, `services/security/securityDetectionRules.ts`, `services/privacy/redaction.ts`, `services/privacy/dataRetentionPolicy.ts`, `utils/totp.ts`, `utils/jobLock.ts`, `services/sms/*`, `services/whatsapp*`, `jobs/*CleanupJob.ts`) — the same class of platform-shared dependency this program has already repeatedly accepted (e.g. `fileStorage.ts` in VAL-001's own sample, `utils/helpers.ts` in `F2-ADR-ORG-DASH-001`, `CDA-067..072`'s channel-abstraction pattern).
3. **`organizationDashboard.ts` exclusion**: checked explicitly by substring match on both `callerPath` and `targetModelOrSymbol` across all 88 — **0 matches**. No candidate involves that file as caller or target.
4. **Accepted-evidence basis**: 33/88 carry a VAL-001-cited `acceptedContractOrAdrReference` (re-verified, not merely re-cited) as their primary evidence; the remaining 55/88 use the target module's own header self-declaration as a "platform-shared dependency reference" (the brief's explicit alternative to a formal contract/ADR), independently read by this task, with VAL-001's own classification/rationale cited as corroborating, not sole, evidence.

Classification used: **`ACCEPTED_BASELINE`** for all 88 (0 `DUPLICATE_OR_ALREADY_MATCHED`, 0 `STALE`, 0 `ACTIONABLE_DEBT`, 0 `NEEDS_ADR`, 0 `EXCLUDED_PARALLEL_ORG_DASH`, 0 `INSUFFICIENT_EVIDENCE`). No candidate was found to represent hidden actionable debt: `accessKind` is `import` for all 88 by construction (this scanner extracts no other kind), and every target is a generic/shared module reached through its normal public export surface — never a same-domain business file being reached into inappropriately. Full per-finding rationale is in the machine-readable companions (§9).

Added as `CDA-073` .. `CDA-160` in `F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json`, using the exact schema and field set already established by that document's own "R1" precision-corrected entries (`CDA-067..072`) — `proposedEnforcementKey.callerPath` exact (never `callerPathGlob`), `callerSymbol` exact, `classification: "ACCEPTED_PUBLIC_CONTRACT"` (this document's existing vocabulary has no separate "platform-shared" value; `ACCEPTED_PUBLIC_CONTRACT` already covers this category, e.g. the channel-abstraction `CDA-067..072` entries), `risk: "Low"`, `expiryOrRemovalTask: null`.

**All 71 pre-existing edges (`CDA-001..072`) verified byte-identical before/after** — script-checked field-by-field, not eyeballed. Only `edges[]` gained 88 new array members; `correctionHistory[]` gained one new revision entry (documenting this addition, following the file's own established "R1" precedent); `classificationCounts` was updated to include the new total (`159` edges, `100` `ACCEPTED_PUBLIC_CONTRACT`) with its `scopeNote` updated to describe both the historical 71-edge scope and the new total — the file's other 20 top-level keys (`task`, `title`, `phase`, `baseline`, `methodology`, `securityFindings`, `proposedAllowlistSchema`, etc.) are unchanged.

## 6. Before/after evidence (twice, byte-compared)

```
npm run guardrail:scan -- --repo-sha=46acae8415020cb0bd340fbc854c4187c43e3662 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_after_scan_run1.json
npm run guardrail:scan -- --repo-sha=46acae8415020cb0bd340fbc854c4187c43e3662 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_after_scan_run2.json
diff <run1> <run2>   -> no output (byte-identical, 417,184 bytes each)
```

A third confirmatory run was taken after a metadata-only edit (`correctionHistory`/`classificationCounts`, §5) and remains byte-identical to run1/run2, proving that edit had zero effect on scan output (as expected — the scanner reads only `edges[].proposedEnforcementKey`, never the descriptive metadata fields).

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Total findings | 1,039 | 1,039 | 0 |
| `NEW` | 1,024 | 846 | **−178** |
| `EXISTING` | 15 | 193 | **+178** |
| Errors / Warnings | 0 / 0 | 0 / 0 | 0 |
| Files discovered/parsed/skipped | 247/247/0 | 247/247/0 | 0 |
| Baseline edge count | 71 | 159 | +88 |
| `resolvedBaselineEdgeIds` | `["CDA-072"]` | `["CDA-072"]` | unchanged |

### The −178, not −88, is explained and fully verified, not just observed

Because matching intentionally ignores `callerSymbol` (§3), one new baseline entry for a single symbol imported from a target automatically also matches every *other* symbol imported from that **same** target in the same caller file (a `import { a, b, c } from './target'` statement produces 3 separate findings differing only in `callerSymbol`; all 3 share the same `(callerPath, ownerDomain, target, accessKind)` key). A fourth script (`scripts/architecture-guardrail-validation/verifyVal003AfterScan.mjs`) independently verified, not assumed, that this is exactly what happened:

- **178 findings flipped `NEW` → `EXISTING`.**
- **100% (178/178) are attributable** to one of the 88 new entries by exact `(callerPath, ownerDomain, targetModelOrSymbol, accessKind)` key match — 0 unattributed flips (script-asserted, not eyeballed).
- **0/178 involve `organizationDashboard.ts`** as caller or target (checked explicitly).
- **88 are the explicitly-verified candidates** from §5.
- **90 are "swept-in" siblings** — additional named-import symbols from the exact same already-vetted target in the exact same already-verified caller file (full per-group listing in `tooling/F2-GUARDRAIL-VAL-003_swept_in_siblings.json`). Every swept-in group was inspected: e.g. `routes/auth.ts` importing 11 different role-permission-check functions (`canManageUsers`, `canWriteFinancialData`, `normalizeRole`, ...) from `utils/roles.ts` in one statement; `routes/attachments.ts` importing 4 storage functions from `fileStorage.ts`; `routes/platformAdmin.ts` importing session/TOTP/CSRF helpers from `utils/sessionCookies.ts`/`utils/totp.ts`. None represents a structurally different edge — every one shares its group's exact `(callerPath, ownerDomain, target, accessKind)` key, the only key the matcher uses, by design.
- **0 actionable findings changed status** — no finding outside these 178 flipped, and no already-`NEW` finding not in this set was affected (total `NEW`+`EXISTING` = 1,039 both before and after; the 846 remaining `NEW` findings are byte-identical in content to the corresponding 846-member subset of the before-scan's 1,024 `NEW` findings, verified by the same script via `id` set comparison).

### High-risk-domain footprint, explicitly checked (not asserted)

47 of the 88 explicit new entries have a `callerDomain` or `ownerDomain` in the program's seven designated high-risk domains (`core-tenant-security`, `core-identity-access`, `core-permissions-roles`, `core-security-incident-detection`, `core-config-secrets`, `core-audit-activity`, `core-privacy-consent-retention-dsr`). Every one was individually read (§5 point 2/full list in `tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json`): all 47 are routes/services/jobs importing a **named function or type from a centralized security/tenant/audit/privacy utility** — e.g. `middleware/clinicAccess.ts` importing `evaluateCrossTenantDenialSignal` from the dedicated security-detection service; `routes/gdprExport.ts`/`routes/payments.ts` importing `writeAuditLog`; `utils/relationGuards.ts` importing the `CanonicalRole` type from the canonical role-normalization module. This is the architecturally **correct** pattern (centralizing security/tenant logic rather than reimplementing it per-caller) — not a violation, and baselining it as expected does not hide, weaken, or suppress any actual tenant/security control. **No high-risk finding was suppressed or hidden**: these findings simply stop being reported as `NEW` (an unclassified-signal state) and start being reported as `EXISTING` (a classified, human-reviewed, evidenced state) — the underlying import relationship is unchanged and remains fully visible in every future scan's `findings[]` array with its `baselineEdgeId` populated for traceability.

## 7. Security / tenant review

Explicitly confirmed, each independently checked (not merely asserted):

- **No auth change.** No file under `server/src/middleware/`, `server/src/routes/auth.ts`, or any authentication/authorization logic was modified — only `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (data) and `docs/program/**` (documentation) were touched.
- **No tenant-scope change.** No `clinicScope.ts`, `relationGuards.ts`, or any tenant-filtering logic was modified — several of the 88 new entries *reference* such files as import targets, but the files themselves are untouched (`git diff` confirms 0 changes under `server/src/`).
- **No DB query change.** No Prisma call, `where` clause, or query logic changed. This task adds only descriptive metadata about *existing, unchanged* import relationships.
- **No PII/logging change.** No logging, redaction, or audit-write logic changed.
- **No runtime application change.** `git status`/`git diff --stat` confirm the only non-documentation file changed is the baseline JSON (a static config/evidence artifact read only by the guardrail CLI, never by the running application).
- **No migration.** `server/prisma/schema.prisma` and `server/prisma/migrations/` are untouched (`git status` scoped to that path is empty).
- **No official integration/imaging impact.** No file under `services/imaging/`, `routes/imagingBridge*.ts` (beyond one already-vetted `writeAuditLog` import edge, CDA-104, itself unchanged behavior), or Windows Bridge code was modified.
- **No high-risk edge hidden.** §6's high-risk-domain footprint (47/88) is explicitly reported, not omitted; every one is individually justified above.

## 8. Validation — exact commands, exit codes, pass/fail counts

| Command | Result | Exit code |
|---|---|---:|
| `npm ci` | succeeded (backgrounded due to a slow first-time install on this worktree; completed cleanly) | 0 |
| `npm run typecheck:guardrail` | `tsc --noEmit -p scripts/architecture-guardrail/tsconfig.json` — clean | 0 |
| `npm run guardrail:test` | **74 passed, 0 failed** (includes the pre-existing `callerSymbol`-exclusion regression test, §3) | 0 |
| `npm run test:runtime:unit` | **74 passed, 0 failed** | 0 |
| `npm run guardrail:scan` (before, ×2) | 247 files, 1,039 findings (1,024 `NEW`/15 `EXISTING`), 0 errors, byte-identical | 0 |
| `npm run guardrail:scan` (after, ×3 — including the post-metadata-edit confirmatory run) | 247 files, 1,039 findings (846 `NEW`/193 `EXISTING`), 0 errors, byte-identical across all 3 | 0 |
| `git diff --check` | clean (one benign CRLF-normalization notice on the baseline JSON, not an error — same as every prior guardrail task) | 0 |

No new/focused unit tests for baseline matching were added, because no matcher code was changed (§4) — the existing `__tests__/baseline.test.ts` suite (which already includes the exact-match, `callerSymbol`-exclusion, glob-match, no-match/`NEW`, and `RESOLVED` cases the brief's §E lists) continues to pass unmodified and is the correct regression coverage for this task's claim ("the matcher was already correct"). The brief's §E test-authoring requirement is explicitly gated on implementation being authorized ("Implementation is authorized only if ... exact unit tests can demonstrate current failure and corrected behavior") — since no implementation occurred (§4), that gate does not apply; this is not an omission, it is the direct consequence of the evidence-driven decision in §4.

The behavioral acceptance criteria the brief's §E *would* have required of a matcher change are instead independently satisfied by the before/after scan evidence itself (§6): an exact edge with exact `callerSymbol` matches (unchanged, pre-existing behavior); a baseline entry without `callerSymbol` semantics are unchanged (no entry's `callerSymbol` field changed meaning); differing owner/caller domain, target path, access kind, or caller path still fail to match (unchanged matcher code, still governed by the same 4-field key); the one actionable `REAL_BOUNDARY_VIOLATION` from VAL-001 (already closed by `F2-ADR-ORG-DASH-001`) and all other genuinely-`NEW` findings remain `NEW`, unaffected; `organizationDashboard.ts` findings are byte-identically unchanged (0 in both before and after — already 0 since `F2-ADR-ORG-DASH-001-R2` closed the last one targeting it); the pre-existing 71 baseline entries continue matching identically (`resolvedBaselineEdgeIds` unchanged); output remains deterministic (3 byte-identical after-scan runs).

## 9. Machine-readable companions

- [`tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json`](tooling/F2-GUARDRAIL-VAL-003_before_scan_run1.json) / `_run2.json` — before-change deterministic scans
- [`tooling/F2-GUARDRAIL-VAL-003_after_scan_run1.json`](tooling/F2-GUARDRAIL-VAL-003_after_scan_run1.json) / `_run2.json` / `_final.json` — after-change deterministic scans (3 runs, byte-identical)
- [`tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json`](tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json) — the 88 candidates with their `NO_RELATED_BASELINE_ENTRY_AT_ALL` / `CALLERPATH_MATCHES_BUT_OWNER_TARGET_ACCESS_DIFFERS` mismatch-matrix classification (§3)
- [`tooling/F2-GUARDRAIL-VAL-003_verified_candidates.json`](tooling/F2-GUARDRAIL-VAL-003_verified_candidates.json) — per-candidate current-source import re-verification results, plus all 48 distinct target files' header text as read by this task
- [`tooling/F2-GUARDRAIL-VAL-003_accepted_baseline_entries.json`](tooling/F2-GUARDRAIL-VAL-003_accepted_baseline_entries.json) — the 88 new `CDA-073..CDA-160` entries in full (same objects appended to the baseline file)
- [`tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json`](tooling/F2-GUARDRAIL-VAL-003_candidate_classification.json) — required candidate-classification companion: all 88, disposition `ACCEPTED_BASELINE`, with `classificationSource` (`VAL_001_CITED_CONTRACT_REVERIFIED` or `PLATFORM_SHARED_HEADER_REVERIFIED`), `securityTenantImpact`, and `dispositionReason` per entry
- [`tooling/F2-GUARDRAIL-VAL-003_swept_in_siblings.json`](tooling/F2-GUARDRAIL-VAL-003_swept_in_siblings.json) — the 90 additional flipped findings, grouped by shared edge key, with their sibling `callerSymbol` values
- Reproducible scripts (checked in, matching this program's `buildSample.js`/`buildReverseDeps.ts` precedent): `scripts/architecture-guardrail-validation/buildVal003Candidates.mjs`, `verifyVal003Candidates.mjs`, `generateVal003BaselineEntries.mjs`, `verifyVal003AfterScan.mjs`

## 10. Rejected / deferred candidates

None. All 88 candidates independently re-verified and accepted (§5). No candidate was classified `DUPLICATE_OR_ALREADY_MATCHED`, `STALE`, `ACTIONABLE_DEBT`, `NEEDS_ADR`, `EXCLUDED_PARALLEL_ORG_DASH`, or `INSUFFICIENT_EVIDENCE` — the 39 VAL-001 `B`/`C` findings whose finding ID changed since VAL-001 (§2) and the ~39 VAL-001 `A`/`D`-`I` findings never classified as expected in the first place are out of this task's scope by construction (never candidates), not rejected candidates.

## 11. Files changed by this task

- `docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` (append-only: +88 edges, +1 `correctionHistory` entry, `classificationCounts` updated; all 71 pre-existing edges and all other top-level fields byte-verified unchanged)
- `docs/program/evidence/F2-GUARDRAIL-VAL-003_BASELINE_MATCH_KEY_RECONCILIATION.md` (this file, new)
- `docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_*.json` (9 files, new — scan reports and analysis companions, §9)
- `scripts/architecture-guardrail-validation/*.mjs` (4 files, new — reproducible analysis/generation scripts, §9)
- `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md` (status reconciliation, §12)

No file under `server/src/`, `src/`, `scripts/architecture-guardrail/{lib,cli.ts,config}`, or `server/prisma/` was touched.

## 12. Tracker reconciliation

Updated with this task's outcome, following this program's established "append, do not rewrite in place" convention: `NORAMEDI_MASTER_TRACKER.md` (§4 F2 row, §7 completed-tasks table, §13 exact-next-task entry), `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`. The parallel `F2-ADR-ORG-DASH-002` task's own entries were read but not edited or overwritten, per the parallel-isolation rule — if that task merges before this PR, this branch will be rebased and its entries reconciled additively (never deleted), matching the precedent `F2-ADR-ORG-DASH-001-R2` itself set when rebasing onto post-`VAL-002` main.

## 13. Rollback

Single revert of this task's own commit(s)/PR — the only production-artifact change is a purely additive JSON edit to an already-existing evidence/baseline file; no code, schema, or migration rollback applies, since none was performed.

## 14. Accepted findings vs. rejected/unverified claims

**Accepted (independently re-verified in this document):** the task-ID collision and its correction (§0); baseline preconditions (§1); exact before-scan reproduction (§2); the exact 88-candidate set, independently re-derived (§2); the root-cause finding that the callerSymbol-exclusion matcher behavior is intentional, already correct, and already tested — **not** a defect, contradicting `F2-GUARDRAIL-VAL-002`'s own causal prose (§3); Option D selection with Options A/B/C explicitly rejected on evidence, not preference (§4); all 88 baseline entries individually re-verified against current source before acceptance, 0 mechanically transcribed (§5); the exact −178/+178 before/after delta, fully attributed and swept-in-sibling mechanism verified, not merely observed (§6); the 47/88 high-risk-domain footprint, individually reviewed, none hiding a violation (§6); security/tenant impact confirmed none (§7); 74/74 + 74/74 unit tests, typecheck, and 3× byte-identical determinism (§8).

**Explicitly not claimed:** that this task performed a fresh stratified false-positive re-sample (VAL-002 §15 item 3, still open, out of scope here); that `organizationDashboard.ts`'s ownership ADR is resolved (explicitly untouched, per parallel-isolation — `F2-ADR-ORG-DASH-002`'s own scope); that CI-blocking enforcement is now authorized (unchanged — still explicitly `NOT_AUTHORIZED`, not addressed by this task); that the remaining 846 `NEW` findings are false positives (they are simply not this task's candidate set — most were never sampled/classified by VAL-001 at all); that any of the 90 swept-in sibling findings were individually hand-reviewed with their own prose justification the way the 88 explicit candidates were — they were verified programmatically (exact-key attribution + spot-check of every distinct group, §6) as a direct, intended, tested consequence of the accepted matcher design, not given separate per-finding write-ups; merged/deployed/production-verified status (all explicitly `NOT_*`).

---

**Current task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.
**Merge safety:** Not evaluated by this task — requires external review per this program's convention. No self-assessed blocker identified (deterministic, additive-only, 0 code change, all tests green).
**Deployment safety:** N/A — documentation/evidence-data-only change; nothing to deploy.
**Exact next task:** (1) the fresh stratified false-positive re-sample against the now-twice-corrected baseline/domain-map (`F2-GUARDRAIL-VAL-002` §15 item 3, still open); (2) `F2-ADR-ORG-DASH-002` — program-owner ADR for `organizationDashboard.ts` ownership, already in progress in parallel, not decided or touched by this task; (3) after both, a future task may define measurable promotion-to-blocking criteria and **propose** (never silently enable) CI-blocking enforcement — still explicitly `NOT_AUTHORIZED` today.

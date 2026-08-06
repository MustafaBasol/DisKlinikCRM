# F2-GUARDRAIL-VAL-002 — Domain-Map Completeness and Accepted-Baseline Reconciliation

**Phase:** F2 — Modular Monolith Guardrails / Enforcement Readiness
**Task type:** Config-only correction (`scripts/architecture-guardrail/config/domain-map.json`) plus read-only validation and evidence. Repository-only. No runtime application behavior changed, no Prisma schema/migration touched, no dependency added, no blocking CI enforcement introduced.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

Isolated worktree/branch: `chore/f2-guardrail-val-002-domain-map-reconciliation` (local path intentionally omitted as non-portable environment metadata, matching this program's established convention).

**This task does not authorize blocking CI enforcement.**

---

## 1. Baseline verification (independently confirmed, not assumed)

| Fact | Verified value |
|---|---|
| `git fetch origin --prune` | run at task start |
| `origin/main` SHA | `61ca9d82507b3f24f3c943104cb6aa20ad13faa0` |
| `git status --short` | clean before worktree creation |
| PR #327 | `gh pr view 327` → `state: MERGED`, `mergeCommit.oid: 61ca9d82507b3f24f3c943104cb6aa20ad13faa0` (exact match to origin/main tip), `mergedAt: 2026-08-06T08:20:03Z` |
| `git merge-base --is-ancestor 61ca9d8... origin/main` | exit 0 (trivially true — it is the tip) |
| Worktree created via | `git worktree add -b chore/f2-guardrail-val-002-domain-map-reconciliation origin/main`, HEAD confirmed `61ca9d8` before any file was written |
| `npm ci` | succeeded, 427 packages (matches prior guardrail tasks' own count) |

F2-GUARDRAIL-VAL-001 is confirmed complete in `NORAMEDI_MASTER_TRACKER.md` §4 (F2 row) and its own evidence file, which explicitly hands off two follow-up items: (1) domain-map completeness correction — this task; (2) a program-owner ADR for `routes/organizationDashboard.ts` — explicitly **not** performed by this task (see §5.5).

## 2. Scope discipline

This task modifies exactly one production config file: `scripts/architecture-guardrail/config/domain-map.json`. It does not modify `scripts/architecture-guardrail/{lib,cli.ts}` (scanner logic unchanged), does not modify `scripts/architecture-guardrail/config/scan-roots.json` (scan roots unchanged, still the five authorized roots), does not modify `F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json` or any other checked-in baseline file (see §9 for why baseline-entry authoring was explicitly deferred rather than attempted), does not modify any file under `server/src/` besides reading it for evidence, and does not touch Prisma schema/migrations. New files added: this evidence document, its JSON companions under `docs/program/evidence/tooling/`, one new evidence-generation script (`scripts/architecture-guardrail-validation/buildReverseDeps.ts`, checked in for reproducibility, matching the precedent set by VAL-001's `buildSample.js`), and status-reconciliation edits to the program-control documents named in the assigning brief.

## 3. Exact scan command, run twice, byte-compared (before any config change)

```
npm run guardrail:scan -- --repo-sha=61ca9d82507b3f24f3c943104cb6aa20ad13faa0 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-002_before_scan_run1.json
```

| Field | Value |
|---|---|
| Files discovered / parsed / skipped | 247 / 247 / 0 |
| Total findings | 1,031 |
| `NEW` | 1,018 |
| `EXISTING` | 13 |
| Errors / Warnings | 0 / 0 |
| Exit code | 0 |

**Identical** to the counts documented by F2-GUARDRAIL-VAL-001 for `origin/main` @ `9b10bc9f`, re-measured (not assumed) here. **Determinism:** two independent `--deterministic` runs over the unmodified baseline produced byte-identical JSON (404,173 bytes each, `diff` clean) — checked in as `F2-GUARDRAIL-VAL-002_before_scan_run{1,2}.json`.

## 4. Domain-map completeness audit — methodology

Per the assigning brief's explicit instruction ("do not classify ownership from filename alone"; "use targeted CodeGraph queries if CodeGraph available, otherwise direct source inspection, imports, call paths, and existing evidence"): **CodeGraph was not available in this environment** (no `.codegraph/` directory in the repository — consistent with every prior task in this program, including F2-GUARDRAIL-VAL-001, F2-GUARDRAIL-PREP-010-A/B/C, F2-GUARDRAIL-IMPL-001). This task used:

1. **Exhaustive enumeration**, not sampling: a script (ad hoc, not checked in) walked all five authorized scan roots and diffed the resulting file list against `domain-map.json`'s `files` keys, finding **70 discovered-but-unmapped files** (of 247 total) plus 2 further files (`server/src/db.ts`, `server/src/schemas/index.ts`) that are valid import *targets* (any `server/src/**` path can be a target per `edgeExtraction.ts`'s `SERVER_SRC_PREFIX` check) but sit outside the five scan roots as *callers*, so they never appear in that root-walk — 72 total previously-unmapped files.
2. **A reverse-dependency tool** (`scripts/architecture-guardrail-validation/buildReverseDeps.ts`, checked in, reused this task): imports the guardrail's own `isRelativeSpecifier`/`resolveRelativeImport` (`scripts/architecture-guardrail/lib/moduleResolution.ts`) — the exact resolution logic the scanner itself uses — to build a target→callers map across all of `server/src/**/*.ts`, annotated with each caller's current domain-map status. This gives direct, reproducible caller evidence for every unmapped file, rather than inferring ownership from directory name.
3. **Cross-reference against `docs/program/evidence/F2-PREP-001_domain_ownership_inventory.json`** — the program's own more-current, already-accepted 38-domain reconciliation (newer than the `F0-003` snapshot `domain-map.json` was originally generated from; reconciled against `origin/main` @ `70b1690c`). Its `domains[].routes`/`.services`/`.scheduledJobs` arrays were mechanically cross-referenced against the 70 unmapped files: **33 of 70 were already-accepted, verbatim-listed ownership facts in F2-PREP-001**, requiring no new judgment call from this task — only transcription with citation.
4. For the remaining 37 files (newer than F2-PREP-001's own snapshot, or utility files outside its routes/services/jobs enumeration scope), direct source reads (header comments, actual endpoint/import content) plus the reverse-dependency caller evidence from step 2.
5. Every existing map entry flagged as a possible false positive by F2-GUARDRAIL-VAL-001's top-10 noisy-family list was independently re-verified with the same reverse-dependency tool before being changed — not simply copied from VAL-001's prior conclusion.

**Result: 0 of the 247 scan-root files remain unmapped** (independently re-verified after the config change — see §6). The one remaining `UNRESOLVED` file, `server/src/routes/organizationDashboard.ts`, is **intentionally** left unresolved — see §5.5.

## 5. Domain-map changes — evidence summary

Full per-file evidence (source evidence, callers with their own domain, tenant/security impact, explicit reasoning that no violation is hidden) is checked in as machine-readable companions:
- [`tooling/F2-GUARDRAIL-VAL-002_additions_evidence.json`](tooling/F2-GUARDRAIL-VAL-002_additions_evidence.json) — the 72 new entries, grouped by target domain
- [`tooling/F2-GUARDRAIL-VAL-002_reclassifications_and_collisions_evidence.json`](tooling/F2-GUARDRAIL-VAL-002_reclassifications_and_collisions_evidence.json) — the 5 reclassifications + 3 collision resolutions

Summary:

### 5.1 New domain-map entries (72 files, all previously `UNRESOLVED` by omission)

| Target domain | Domain status | File count | Evidence basis |
|---|---|---:|---|
| `core-shared-platform-infrastructure` | **new domain** | 8 | `db.ts`, `schemas/index.ts`, `utils/{helpers,prismaSelects,safeError,logRedaction,redis,counterStore}.ts` — each read directly; genuinely platform-wide (`db.ts` alone has 30 distinct caller domains) |
| `messaging-shared-channel-infrastructure` | **new domain** | 1 | `utils/inboundRateLimiter.ts` — real callers span messaging-whatsapp and messaging-instagram |
| `external-calendar-integration` | **existing, accepted domain** (F2-PREP-001, code `EXC`) | 18 | verbatim match to F2-PREP-001's own `routes`/`services`/`scheduledJobs` arrays for this domain |
| `core-privacy-consent-retention-dsr` | existing domain | 12 | verbatim match to F2-PREP-001's `PRV` domain arrays (communicationConsent/\* + 2 more) |
| `core-storage-abstraction` | existing domain | 3 | verbatim match to F2-PREP-001's `STG` domain arrays |
| `core-platform-administration` | existing domain | 1 | verbatim match to F2-PREP-001's `PAD` domain arrays |
| `clinical-patients` | existing domain | 6 | own investigation (files postdate F2-PREP-001); direct header read, explicit cross-reference to `patients.ts` in each file's own doc comment |
| `inventory` | existing domain | 2 | own investigation; direct source read + sole-caller confirmation |
| `reporting-analytics` | existing domain | 14 | own investigation; `reportExport.ts` header explicitly names `reports/revenueByPeriodQuery.ts` and the existing `reports.ts` route as its own domain siblings |
| `messaging-sms` | existing domain | 1 | own investigation; sole real caller is `smsService.ts` |
| `messaging-whatsapp` | existing domain | 3 | own investigation (1 of 3, `routes/messages.ts`, is a lower-confidence majority-evidence judgment call — flagged explicitly, see JSON companion) |
| `clinical-treatment-cases` | existing domain | 2 | own investigation; sole real caller of each is `treatmentCases.ts` / the first file itself |
| `imaging-server-viewer` | existing domain | 1 | `services/imaging/public.ts` — the already-accepted `ImagingLifecyclePort` facade named in `NORAMEDI_MASTER_TRACKER.md` as `F2-IMPL-001-A` [PR #304] `MERGED` |

**72 files total**, matching exactly the 70 scan-root-discovered unmapped files plus the 2 out-of-root target-only files (`db.ts`, `schemas/index.ts`).

### 5.2 Reclassifications (5 files, existing entries corrected)

| File | Prior | Corrected | Why |
|---|---|---|---|
| `services/imaging/releaseMetadataValidation.ts` | `imaging-server-viewer` | `imaging-device-bridge` | both real callers are BRG files; prior label was a path-prefix guess |
| `utils/messageSanitizer.ts` | `messaging-whatsapp` | `messaging-shared-channel-infrastructure` | header self-declares "Shared... used by all AI-connected inbound channels"; real callers span whatsapp + instagram |
| `utils/webhookVerification.ts` | `messaging-whatsapp` | `messaging-shared-channel-infrastructure` | generic Meta webhook-verification protocol; real callers span whatsapp + instagram |
| `utils/patientName.ts` | `clinical-patients` | `messaging-whatsapp` | zero Prisma/patient-model access; both real callers are whatsapp files |
| `services/whatsappAvailability.ts` | `messaging-ai-orchestration` | `clinical-appointments-availability` | content is real slot/overlap computation, directly imports the appointments-availability domain's own service; real callers span 4 different domains |

### 5.3 Declared-collision resolutions (3 of the 4 F0-003-declared collisions)

| File | Prior | Corrected | Evidence |
|---|---|---|---|
| `utils/encryption.ts` | `UNRESOLVED` (declared collision) | `core-platform-crypto` (**new domain**) | F0-003: "true platform primitive, correctly placed"; VAL-001: 10/10 sampled findings classified `EXPECTED_PLATFORM_SHARED_EDGE` |
| `utils/secrets.ts` | `UNRESOLVED` (declared collision) | `core-platform-crypto` | identical situation, same F0-003/VAL-001 evidence |
| `services/treatmentStockDeduction.ts` | `UNRESOLVED` (declared collision) | `clinical-dental-chart-procedures` | F0-003: file's settled physical location; the separate real cross-domain `InventoryTransaction` write is **not** closed by this change — it remains open, already-tracked technical debt |

### 5.4 Dead-key cleanup (2 keys removed)

Two `domain-map.json` keys carried a parenthetical annotation baked into the literal string (`"...googleAiStudio.ts (only generic AI-provider file found)"`, `"...noShowFollowUp.ts (shared with clinical-appointments-availability)"`) that can never exact-match any real file path — verified by direct filesystem check (0 matches for either literal string). Both real files (`googleAiStudio.ts`, `noShowFollowUp.ts`) already have a separate, correct, matching entry elsewhere in the map. Removing these two non-functional keys changes **zero** scan behavior (they never matched anything); it is pure config hygiene, checked here for completeness since domain-map auditing was explicitly in scope.

### 5.5 `routes/organizationDashboard.ts` — deliberately NOT touched

Per the assigning brief's explicit constraint ("the known route-to-route violation involving `organizationDashboard` must remain actionable unless separately fixed and merged by `F2-ADR-ORG-DASH-001`") and F2-GUARDRAIL-VAL-001's own conclusion (§9, collision #4: "the one genuine, unresolved content-level ambiguity of the four... requires an explicit program-owner ADR decision"), this file's domain-map entry is **left as `UNRESOLVED`**, unchanged by this task. Verified after the config change (§7): the `getDateRange` real boundary violation (`financeDashboard.ts` reaching into `routes/organizationDashboard.ts`) remains present in the after-scan, unchanged, still `NEW`/actionable.

## 6. Domain-map completeness — re-verified after the change

Re-running the same enumeration-and-diff check used in §4 against the corrected `domain-map.json`:

```
discovered total: 247
mapped total (keys): 249
unmapped (discovered but absent from domain-map.json): 0
```

Every one of the 247 scan-root-discovered files now has a domain-map entry. (`fileCount` in the config is 249 — the 247 scan-root files plus `db.ts` and `schemas/index.ts`, which are valid import targets outside the scan roots.)

## 7. After-scan, run twice, byte-compared

```
npm run guardrail:scan -- --repo-sha=61ca9d82507b3f24f3c943104cb6aa20ad13faa0 --deterministic --out=docs/program/evidence/tooling/F2-GUARDRAIL-VAL-002_after_scan_run1.json
```

| Field | Value |
|---|---|
| Files discovered / parsed / skipped | 247 / 247 / 0 (unchanged) |
| Total findings | 1,038 |
| `NEW` | 1,023 |
| `EXISTING` | 15 |
| Errors / Warnings | 0 / 0 |
| Exit code | 0 |

**Determinism:** two independent `--deterministic` runs over the corrected config produced byte-identical JSON (415,009 bytes each, `diff` clean) — checked in as `F2-GUARDRAIL-VAL-002_after_scan_run{1,2}.json`.

## 8. Before/after signal-quality comparison

**Total findings went UP (1,031 → 1,038, +7), not down. This is expected and correct, not a regression** — see explanation below. Per the assigning brief: *"A reduction in count alone is not acceptance"*; the converse also holds — a small increase is not by itself a regression when it is a directly-traced, individually-verified consequence of surfacing previously-hidden true findings.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Total findings | 1,031 | 1,038 | +7 |
| `NEW` | 1,018 | 1,023 | +5 |
| `EXISTING` | 13 | 15 | +2 |
| `ownerDomain = UNRESOLVED` findings | 308 | 1 | **−307** |
| `callerDomain = UNRESOLVED` findings | 75 | 4 | **−71** |
| Distinct owner (target) domains | 28 | 32 | +4 (the 4 new domains) |
| Distinct caller domains | 32 | 35 | +3 |

**Root cause of the net +7, fully traced (not estimated):** comparing findings by `(callerPath, callerSymbol, targetModelOrSymbol)` rather than by finding ID (IDs are a hash of the full tuple *including* domain, so any domain relabeling changes the ID even for an unchanged edge):

- **54 findings truly removed** (edge no longer cross-domain — caller and target now correctly resolve to the *same* real domain). Grouped by owner domain: `UNRESOLVED` 22 (e.g. `reportExport/types.ts` consumed internally by its own now-same-domain siblings), `imaging-server-viewer` 13 (`releaseMetadataValidation.ts` now same-domain as its BRG callers), `messaging-whatsapp` 11 (`patientName.ts` now same-domain as its whatsapp callers), plus 8 smaller individually-verified cases across `clinical-patients`/`core-storage-abstraction`/`core-privacy-consent-retention-dsr`/`messaging-sms`/`clinical-appointments-availability`. **Every one individually checked (§8.1) — none touches a high-risk domain in a way that hides a real issue.**
- **61 findings truly added** (edge newly visible — previously silently excluded because *both* caller and target were `UNRESOLVED`, which the scanner treats as trivially "same domain" and skips). Grouped by owner domain: `core-shared-platform-infrastructure` 42, `clinical-appointments-availability` 8 (the `whatsappAvailability.ts` reclassification), `core-platform-crypto` 3, `core-privacy-consent-retention-dsr` 3, `messaging-shared-channel-infrastructure` 3, `core-platform-administration` 1, `messaging-ai-orchestration` 1. **Every one of these is a genuine, previously-invisible cross-domain edge now correctly surfaced — not a new violation introduced by this task, since no application code changed.**

Net: 61 added − 54 removed = +7, exactly matching the observed total-findings delta. Full lists checked in as [`tooling/F2-GUARDRAIL-VAL-002_edges_newly_surfaced_correct_classification.json`](tooling/F2-GUARDRAIL-VAL-002_edges_newly_surfaced_correct_classification.json) (61 entries) and [`tooling/F2-GUARDRAIL-VAL-002_edges_removed_same_domain_corrected.json`](tooling/F2-GUARDRAIL-VAL-002_edges_removed_same_domain_corrected.json) (54 entries).

### 8.1 High-risk/tenant-security check on the 54 removed findings

Every removed finding whose `ownerDomain` is one of the seven high-risk domains (`core-tenant-security`, `core-identity-access`, `core-permissions-roles`, `core-security-incident-detection`, `core-config-secrets`, `core-audit-activity`, `core-privacy-consent-retention-dsr`) was individually inspected. Exactly **one** such finding was removed: `services/privacy/dataRetentionManualRunAudit.ts` (`DataRetentionConfig`) → `services/privacy/dataRetentionPolicy.ts` — both files are `core-privacy-consent-retention-dsr` per F2-PREP-001's own accepted inventory; this was a false cross-domain finding (privacy code calling privacy code, previously mislabeled only because the caller was unmapped), not a suppressed violation. **No high-risk finding was silently dropped.**

### 8.2 Baseline-match improvement (directly observed, not projected)

One baseline edge, `CDA-031` (`routes/appointmentRequests.ts` → `services/externalCalendar/externalCalendarOutboundSync.ts`, already accepted in `F2-GUARDRAIL-PREP-010-A` as `LEGACY_ALLOWLISTED_DIRECT_ACCESS` citing `F2-PREP-002:APT-11`), changed from `NEW` to `EXISTING` **purely as a side effect of the domain-map fix** — its `ownerDomain` now resolves to `external-calendar-integration`, exactly matching the baseline entry's `proposedEnforcementKey.ownerDomain`. This is direct, measured evidence that closing the domain-map gap also improves `NEW`/`EXISTING` trustworthiness, without any baseline-file edit. `EXISTING` count rose from 13 to 15 (this one edge ID contributing 2 of the 15, since it recurs with 2 distinct `callerSymbol` values, which the baseline match key ignores per its own documented limitation).

## 9. Baseline reconciliation — scope decision (why no `F2-GUARDRAIL-PREP-010-A` edit was made)

F2-GUARDRAIL-VAL-001's own 169-finding classified sample (`tooling/F2-GUARDRAIL-VAL-001_classified_sample.json`) contains 137 findings classified `B`/`C` (expected edges). Cross-referencing those against the after-scan by finding ID: 39 no longer resolve to the same ID (their domain label changed, mostly for the better, see §8), 10 now independently match `EXISTING` (the CDA-031 mechanism above, plus others), and **88 remain formally `NEW`** despite being already-classified-legitimate by VAL-001 — because the scanner's baseline match key excludes `callerSymbol` (a separate, already-documented, VAL-001-identified limitation of `lib/baseline.ts`, not a data-completeness gap, and scanner-code changes are out of this task's policy).

This task **deliberately does not** bulk-transcribe those 88 pre-classified findings into new `F2-GUARDRAIL-PREP-010-A` baseline entries. Reasoning: that file has its own strict per-edge schema (`proposedEnforcementKey`, `justificationEvidenceId`, `expiryOrRemovalTask`, risk rating, etc.) that its own originating task (`F2-GUARDRAIL-PREP-010-A`) populated with the same rigor this task applied to `domain-map.json` — authoring 88 such entries correctly in the time available for this task would not meet that bar, and the assigning brief explicitly warns against "path-wide or domain-wide suppression" and requires "exact semantic edge matching" for every entry. Attempting it hastily risks exactly the failure mode the brief warns against. **This is handed off as an explicit, separately-scoped follow-up** (§16) rather than attempted partially here.

## 10. Enforcement-readiness reassessment

Re-assessed against F2-GUARDRAIL-VAL-001's own 8-criterion checklist (§10 of that document):

| Criterion | VAL-001 status | This task's status | Basis |
|---|---|---|---|
| False-positive rate acceptably low and justified | NOT MET | **IMPROVED, not independently re-measured** | The dominant documented cause (domain-map coverage gap, 308 `UNRESOLVED`-target findings) is closed to 1 (the deliberately-deferred `organizationDashboard.ts`). All 11 of VAL-001's top-10-plus-one noisy families are individually fixed (§5.1–5.2). No new stratified sample was drawn to produce a fresh quantified false-positive percentage — that would be a separate, VAL-001-depth undertaking. |
| Ownership collisions resolved | NOT MET | **PARTIALLY MET** (3 of 4) | `encryption.ts`/`secrets.ts`/`treatmentStockDeduction.ts` resolved with evidence; `organizationDashboard.ts` intentionally deferred to its required ADR. |
| Expected public-contract edges reliably encoded | NOT MET | **UNCHANGED — NOT MET** | The `callerSymbol`-exclusion baseline-match limitation is a scanner-code property, explicitly out of this task's policy to change; see §9. |
| Baseline semantics stable | PARTIALLY MET | **UNCHANGED — PARTIALLY MET** | Same reasoning as VAL-001; this task changed no scanner or comparison logic. |
| New-vs-existing classification trustworthy | NOT MET | **MARGINALLY IMPROVED, still NOT MET as a general property** | One directly-observed correction (CDA-031, §8.2); the underlying match-key limitation remains. |
| High-risk tenant/security paths have dedicated tests | NOT INDEPENDENTLY VERIFIED | **UNCHANGED — NOT INDEPENDENTLY VERIFIED** | Out of this task's scope, as for VAL-001. |
| Rollback / emergency-disable mechanism exists | MET | **UNCHANGED — MET** | Guardrail CI job is still standalone, exit-0-by-design, not in any `needs:` list. |
| Program owner explicitly authorizes enforcement | NOT MET | **UNCHANGED — NOT MET** | Not sought or obtained by this task. |

**Enforcement readiness: `NOT_READY`.**

This is a meaningfully stronger `NOT_READY` than VAL-001's — the single largest, most mechanically-fixable driver of noise (domain-map incompleteness) is closed with full-coverage verification (§6) — but multiple independent criteria remain unmet (baseline match-key limitation, `organizationDashboard.ts` ADR, program-owner sign-off, no fresh quantified false-positive sample), so this task does **not** claim `CONDITIONALLY_READY_FOR_NEW_FINDINGS_ONLY` or `READY_FOR_SEPARATE_AUTHORIZATION_REVIEW`. Per the assigning brief, this task does not and cannot authorize blocking CI enforcement regardless of readiness classification.

**Measurable remaining blockers:**
1. `F2-GUARDRAIL-PREP-010-A` baseline-entry authoring for the ~88 already-classified-but-unmatched expected edges (§9) — separate follow-up task.
2. Program-owner ADR for `routes/organizationDashboard.ts` (`F2-ADR-ORG-DASH-001`) — not performed by this or any task to date.
3. A fresh stratified false-positive sample against the corrected domain-map, to replace VAL-001's now-partially-stale 8.9%/81.1% figures (which were measured against the *uncorrected* map) with a current number.
4. The `callerSymbol`-exclusion baseline-match-key limitation (scanner-code change, requires its own dedicated task and re-test of the 74 existing unit tests).
5. F2-SEC-001/F2-SEC-002 deployment + production verification (tracked separately by F2-SEC-003, independent of this task).

## 11. Tests re-run

All commands run from the task worktree root, config-change committed before running.

| Command | Result | Exit code |
|---|---|---|
| `npm ci` | 427 packages installed | 0 |
| `node -e "JSON.parse(...)"` against corrected `domain-map.json` | valid | 0 |
| `npm run typecheck:guardrail` (`tsc --noEmit -p scripts/architecture-guardrail/tsconfig.json`) | clean | 0 |
| `npm run guardrail:test` | **74 passed, 0 failed** | 0 |
| `npm run test:runtime:unit` | **74 passed, 0 failed** | 0 |
| `git diff --check` | clean (one benign CRLF-normalization notice, not an error) | 0 |
| `npm run guardrail:scan -- --repo-sha=... --deterministic --out=...` (before config change, x2) | 247 files, 1,031 findings (1,018 `NEW`/13 `EXISTING`), 0 errors, byte-identical | 0 |
| `npm run guardrail:scan -- --repo-sha=... --deterministic --out=...` (after config change, x2) | 247 files, 1,038 findings (1,023 `NEW`/15 `EXISTING`), 0 errors, byte-identical | 0 |
| Domain-map completeness re-check (§6) | 0 of 247 scan-root files unmapped | — |

No `guardrail:test` fixture depends on the real `domain-map.json` (its own tests use isolated fixture configs under `__tests__/`), so the config change does not and should not affect that suite's outcome — confirmed 74/74 both before and after.

## 12. Security and tenant impact

No security-sensitive or tenant-scoping *application* source file was modified — every `server/src/**` read in this task was for classification evidence only. No secret, credential, or `.env` value was read or written. The single production file changed (`domain-map.json`) contains only repo-relative file paths and domain-label strings; verified free of absolute local paths and secret-like patterns (same `grep -EiI` checks as VAL-001, re-run against both new scan reports and both new evidence JSON files — zero matches). This task performed no runtime tenant-isolation testing and makes no tenant-isolation proof claim, consistent with every prior guardrail task's explicit disclaimer (the `tenantScopeDisclaimer` field is still carried verbatim in both scan reports).

## 13. Migration status / backward compatibility / rollback

No Prisma migration exists, was created, or is required. `server/prisma/migrations/` and `server/prisma/schema.prisma` are unchanged (`git status` scoped to `server/prisma/` shows no diff). This task is backward compatible by construction: the guardrail CLI's exit-0-regardless-of-findings contract (§13/§14/§17 of `F2-GUARDRAIL-IMPL-001`'s own evidence) is untouched, and the one new standalone `ci-layers.yml` Layer 1 job remains in no other job's `needs:` list. **Rollback:** revert this task's single PR/commit (a one-file production config change plus additive evidence/doc files) — no database, runtime, or production-configuration rollback is needed or implied, since none was performed.

## 14. Accepted findings vs. rejected/unverified claims

**Accepted (verified in this document):** baseline preconditions (§1); exact before-scan reproduction, byte-identical to VAL-001's own prior counts (§3); exhaustive (not sampled) domain-map completeness audit reducing unmapped scan-root files from 70 to 0 (§4, §6); 72 additions + 5 reclassifications + 3 collision resolutions + 2 dead-key removals, each with direct source/caller/import evidence (§5, JSON companions); after-scan determinism (§7); a fully-traced (not estimated) before/after delta explanation — 61 truly-added, 54 truly-removed edges, individually risk-checked (§8, §8.1); one directly-observed baseline-match improvement not requiring any baseline-file edit (§8.2); 74/74 guardrail unit tests and 74/74 runtime-orchestrator unit tests passing both before and after (§11); `organizationDashboard.ts`'s real boundary violation independently re-confirmed still present and unchanged (§5.5).

**Explicitly not claimed:** that enforcement readiness has changed from `NOT_READY` (it has not — §10). That the domain-map is now "complete" in an absolute sense — only that it is complete *relative to the 247 files the scanner currently discovers under its five authorized roots*; a future scan-root broadening (not authorized by this task) could reintroduce gaps. That the `messaging-whatsapp` classification of `routes/messages.ts` is high-confidence — it is explicitly flagged as a majority-evidence judgment call (§5.1, JSON companion). That any new `F2-GUARDRAIL-PREP-010-A` baseline entry was added — none was; see §9 for the explicit scope decision and rationale. That the 88 VAL-001-pre-classified-but-still-`NEW` findings are false positives — they are not; they are already-judged-legitimate findings that a scanner-code (not config) limitation prevents from machine-matching. That CI has been re-run on the actual opened PR head (not yet opened as of this document). That any high-risk tenant/security code path now has newly-verified test coverage (not in scope, unchanged from VAL-001). Merged/deployed/production-verified status (all explicitly `NOT_*`).

## 15. Next-task recommendation

Three independent, separable follow-ups remain (none started, none authorized by this task):

1. **`F2-GUARDRAIL-PREP-010-A` baseline-entry authoring** for the ~88 findings VAL-001 already classified `B`/`C` with a cited contract/ADR reference but which still machine-report `NEW` (§9) — mechanical transcription work, but requires the same per-edge schema rigor as the original PREP-010-A task; each entry needs its own `justificationEvidenceId` and risk rating, not a bulk copy.
2. **Program-owner ADR** for `routes/organizationDashboard.ts` (`F2-ADR-ORG-DASH-001`) — a decision this task, like VAL-001 before it, cannot and does not make.
3. **A fresh stratified false-positive sample** (VAL-001-depth: ≥120 findings, full taxonomy) against the now-corrected domain-map, to produce a current, trustworthy false-positive-rate figure to replace the now-partially-stale 8.9%/81.1% VAL-001 numbers (which were measured against the uncorrected map and are expected to have improved, per the mechanism traced in §8, but have not been re-measured by direct sampling).

Only after all three, plus F2-SEC-001/F2-SEC-002 deployment + production verification (independent, tracked by F2-SEC-003, still open), may a future task define measurable promotion-to-blocking criteria and **propose** (never silently enable) CI-blocking enforcement.

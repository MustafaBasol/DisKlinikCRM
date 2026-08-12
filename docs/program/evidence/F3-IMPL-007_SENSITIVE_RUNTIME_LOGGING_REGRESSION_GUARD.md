# F3-IMPL-007 — Sensitive Runtime Logging Regression Guard

**Task ID:** F3-IMPL-007 · **Phase:** F3 — Production Hardening · **Branch:** `feature/f3-impl-007-sensitive-log-regression-guard` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-007` · **Baseline:** `origin/main` @ `6f7e580d1bab2a0f87baed1cfe5ec0a944a6b711` (Merge PR #396, `feature/f3-sec-002-platform-admin-session-revocation`) — confirmed via `git fetch origin --prune && git rev-parse origin/main`, exact match, clean worktree (`git status --short` empty at task start).

**Updated by F3-IMPL-007-R1 (2026-08-12) — see §16 for the authoritative final state (§15 is preserved as the historical intermediate record; §16.1/§16.2 explicitly supersede §15.2/§15.3).** §1-§14 are preserved verbatim as originally authored; their specific counts (94 grandfathered sites, "29/29"/"28/28" assertion totals) are historical as of the original commit and superseded by §16. R1 fixes two accepted review findings against the scanner's own trust logic (not the application code it scans) and adds the task-brief-required regression tests for both — see §16 for what changed and why.

**Risk relationship:** R-018 — Sensitive runtime logging / PII-message-content regression risk. **This task does not close R-018** — see §7.

**Parallel-safety:** this branch touches only `docs/program/evidence/F3-IMPL-007_SENSITIVE_RUNTIME_LOGGING_REGRESSION_GUARD.md` under `docs/program/`; it does not read or modify `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `RISK_REGISTER.md`, `phases/F3_PRODUCTION_HARDENING.md`, or `evidence/README.md` (F3-PROGRAM-RECON-001-R1/PR #397's surface). It also does not touch `.github/workflows/**` or `server/package.json` (F3-CI-OPT-001's likely surface — see §10).

**Dependency:** F3-IMPL-006 merged as PR #364 (evidence: `docs/program/evidence/F3-IMPL-006_PII_MESSAGE_CONTENT_LOG_HYGIENE_WAVE2.md`), confirmed present on this baseline. Satisfied.

## 1. Scope

Per the task brief, this is a regression-prevention tool, not another remediation wave:

- Does **not** re-review or rewrite the 92 `POTENTIAL_PII_SAFE_AFTER_REVIEW` sites F3-IMPL-006 left alone.
- Does **not** attempt to fix every pre-existing unsafe site this scanner finds on current `main` (see §5 — 94 were found and grandfathered, not fixed).
- Does **not** close R-018.
- Delivers exactly one thing: a deterministic, CI-runnable static scanner that fails when a **new** instance of the exact pattern class F3-IMPL-004/006 fixed is introduced into `server/src/{routes,services,jobs,middleware,utils}`.

## 2. Inventory before writing the guard

Read (not modified): `server/src/utils/logger.ts`, `server/src/utils/safeError.ts`, `server/src/utils/logRedaction.ts`, F3-IMPL-004 and F3-IMPL-006's evidence docs, `scripts/architecture-guardrail/**` (cli.ts + lib/), root `package.json`, `server/package.json`'s script conventions, and one existing log-privacy test (`server/src/tests/jobLockAuditLogSafeErrorPrivacy.test.ts`) for the repo's test-harness style. CodeGraph was not invoked as a separate step — the targeted grep/read set above already scoped to exactly the logging-relevant surface the task brief named, so a graph query would not have reduced the read set further.

**No pre-existing automated regression guard was found.** F3-IMPL-006's own evidence doc §7 states explicitly: *"No lint rule or CI gate exists to prevent a new `console.error(label, err)`/raw-error-logging call site from being introduced going forward."* The 21 `*LogPrivacy.test.ts` files under `server/src/tests/` are all **site-specific regression tests** — each asserts a fixed, named list of already-fixed call sites stays fixed; none scans for *new, unnamed* sites. This confirms the task brief's premise and that this guard does not duplicate an existing mechanism.

`scripts/architecture-guardrail/` (F2-GUARDRAIL-IMPL-001) is a same-*shape* prior art (TypeScript-compiler-API AST scanner, `scan-roots.json`/exclude-pattern config, `__tests__/index.test.ts` harness, `guardrail:scan`/`guardrail:test`/`typecheck:guardrail` root-package.json script naming) but a different *purpose* (cross-domain import drift, report-only, exit 0 always) — its code was read for the conventions it establishes, not imported or extended, per the task brief's "preserve modular boundaries" instruction. `scripts/log-privacy-guard/` is a fully separate module with no dependency on it.

## 3. Scanner design

**Location:** `scripts/log-privacy-guard/` (root-level, mirroring `architecture-guardrail`'s placement and scanning the same class of `server/src` roots from outside `server/`).

**Approach:** single-file AST walk per source file using the `typescript` compiler API (`ts.createSourceFile`), already a repository dependency and already used this way by `architecture-guardrail`. No `ts.Program`/type-checker is built — this is a deliberate perf/complexity trade-off (see below), which means identification is **name-based, not type-based**. Every name list is narrow, documented, and calibrated against a real scan of this repository (§5), per the task brief's "low false-positive risk" requirement.

**Scan roots** (`config/scan-roots.json`): the exact five roots F3-IMPL-004/006 classified — `server/src/{routes,services,jobs,middleware,utils}` — excluding `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts`. Broadening requires an explicit config change (self-documenting in the diff), not a silent scope drift.

**Sink detection:** a call expression is a logging sink if:
- callee is `console.<log|info|warn|error|debug>` (built-in global, always in scope), or
- callee is `<localName>.<log|info|warn|error|debug|fatal|trace>` where `<localName>` is the local binding of a **relative import whose specifier's final path segment is exactly `logger`** (matches `./logger.js`, `../utils/logger.js`, `../../utils/logger`, etc. — see the drift-injection finding in §5 for why this is broader than a naive `utils/logger` substring match).

**Rules** (invariants, derived directly from F3-IMPL-004/006's own accepted fix pattern):

| Rule ID | Trigger | Source |
|---|---|---|
| `RAW_ERROR_OBJECT` | A caught-error-like value (`catch (err)`/`catch (error)`, or a `.catch()`/handler parameter named exactly `err`/`error` — exact match only, confirmed the codebase's universal convention by grep before writing the rule) passed bare (identifier, spread, or object shorthand) into a sink's arguments | F3-IMPL-004/006 §3 fix pattern |
| `ERROR_DANGEROUS_PROPERTY` | `<error-like>.message` / `.stack` / `.cause` reached through a sink's arguments (including via `\|\|`/`??`, ternary branches, template-literal interpolation, array/object literals) | `utils/logger.ts`'s own `safeErrorLog` doc comment; F3-IMPL-004/006 §3 |
| `MESSAGE_CONTENT` | A closed vocabulary of message-content identifiers/properties (`rawMessage`, `rawPayload`, `messageText`, `lastMessageText`, or `<message\|msg\|lastMessage\|inboundMessage\|outboundMessage\|payload>.text`/`.body`) reached through a sink's arguments | F3-IMPL-006 §3's named `MESSAGE_CONTENT_REQUIRES_REMOVAL` sites |
| `DIRECT_PII_FIELD` | A bare `email` or `phone` identifier/property reached through a sink's arguments | The two PII fields this codebase already has an established, single-purpose redaction convention for (`redactPhone`; email has no dedicated helper and is unambiguous) |

`err.name`/`err.code` are explicitly accepted-safe (matches `safeErrorFields()`'s own return shape and the SMTP-bounce sibling `err.name`-only convention) and are a leaf — access stops there, no further descent.

**"Reached through a sink's arguments"** is a bounded, explicitly-scoped recursive descent through value-shaped syntax only: object/array literals, spread, ternary branches, `\|\|`/`??` operands, template-literal interpolations, and parenthesized/`as`/non-null unwraps. It explicitly does **not** descend into `instanceof`/`typeof`/comparison operands (so `err instanceof Error ? err.name : 'Fallback'` never flags the `err` in the test position), function/arrow-function bodies passed as arguments (so a nested `.catch(err => ...)` is walked separately by the general traversal, not misattributed to the outer sink), or the arguments of any call that isn't itself a sink or an allowlisted safe wrapper (calls are opaque by design — this is a bounded value-shape classifier, not a dataflow analysis).

**Safe-wrapper allowlist** (the task's required "narrow, explicit, reviewable" escape hatch for helper functions): a call expression is treated as an opaque, trusted boundary — not descended into — if its callee name is exactly `safeErrorFields`, `safeErrorLog`, `boundedErrorType`, or `senderSuffix` (taken verbatim from F3-IMPL-006 §2's list of already-established helpers), **or** matches the naming convention `/^(redact|summarize)[A-Z]/` this codebase already uses for every other per-file redaction helper (`redactPhone`, `redactSensitiveText`, `summarizeTextForLog`, `summarizeIdentifier` ×4 files, `summarizeProviderId` ×2 files — confirmed by grep before writing the rule). Naming a new function `redactX`/`summarizeX` to dodge the guard is itself an obvious, reviewable signal in a PR diff — the trust boundary is the call site, exactly as instructed ("Prefer exact expression/site annotations or bounded safe helper patterns... difficult to misuse").

**Per-site inline escape hatch:** a same-line or line-above comment `// log-privacy-guard:allow -- <reason>` suppresses that one finding — but only if `<reason>` is at least 10 non-whitespace characters after the `--`, so an empty/copy-pasted marker has no effect. Suppressed findings are not silently dropped: they appear in the report's `suppressed[]` array with file/line/rule/reason, so they stay auditable. **Zero inline suppressions exist in the repository today** — this mechanism is unused by design at ship time; it exists for future narrow, reviewed exceptions, not to grandfather anything now.

## 4. Baseline-exception strategy (Step 5/8)

Running the scanner against baseline `main` (before writing any exception) found **94 findings** (59 `RAW_ERROR_OBJECT` + 35 `ERROR_DANGEROUS_PROPERTY`, 0 `MESSAGE_CONTENT`, 0 `DIRECT_PII_FIELD`), all in `server/src/routes/**`, across 35 files. Every one was manually spot-checked (not blanket-accepted) and confirmed a **true positive** of exactly the class F3-IMPL-004/006 already established as unsafe — e.g. `server/src/routes/whatsappInbox.ts:279` (`console.error('[whatsapp-inbox] list-conversations error', error)`, a bare caught `error`) sits three lines from `whatsappInbox.ts:280`'s already-fixed sibling sites, confirming these are simply sites the two prior waves' named scope (F3-IMPL-006 §3's per-file site *counts*) did not reach — not rule false positives. `server/src/routes/platformAdmin.ts:2081` is inside F3-IMPL-005's documented conflict-surface file, which F3-IMPL-006 explicitly never read for edits — consistent with why it was never fixed.

Per Step 5's instruction ("classify them, then refine the rule **or** create narrow reviewed baseline exceptions... do not silently ignore"): since all 94 are true positives outside this task's fix-scope (not rule defects), each was added as an exact, fingerprinted entry to `scripts/log-privacy-guard/config/baseline-exceptions.json` — **no wildcards, no directory-level exclusion**. Every entry is `{file, line, ruleId, fingerprint, reason, addedDate}`; `fingerprint` is `sha1(file :: ruleId :: trimmed-source-line)[0:16]` (`lib/fingerprint.ts`) — tied to the **exact line content**, not just the line number, so any future edit to a grandfathered line (even an unrelated one on the same line) invalidates its fingerprint and the finding re-surfaces as a fresh, un-grandfathered violation requiring conscious re-review. This is the baseline-drift protection Step 8 asked for.

`lib/baseline.ts` enforces, fail-closed (throws, does not warn-and-continue):
- exact file paths only — `*`/`?` in `file` is rejected;
- `reason` must be ≥15 characters (forces a real explanation, not a placeholder);
- duplicate fingerprints across entries are rejected (a config-authoring error, not a valid double-exception);
- unknown `ruleId` values are rejected.

Stale-exception detection (a baseline entry whose fingerprint no longer matches any current finding — e.g. because the site was independently fixed) is reported as a warning in every run (`staleExceptions[]`) and optionally gates CI via `--strict-baseline`; it does not fail by default, so fixing a grandfathered site is never itself a build break.

## 5. False-positive control — how it was actually calibrated, not just designed

The rule set was validated against the real repository, not only against synthetic fixtures:

- Initial full scan (before any baseline entries existed): 94 true positives, 0 `MESSAGE_CONTENT`, 0 `DIRECT_PII_FIELD` — i.e. the two narrower rules produced **zero** hits on ~262 real files, evidence they are not over-broad.
- **One real detection gap was found and fixed during this task**, not by the baseline scan (which had nothing in `utils/` to reveal it) but by a live drift-injection check: a temporary file was added to `server/src/utils/` importing `logger` via `./logger.js` (the exact pattern `server/src/utils/errorTracking.ts` already uses, since a file *inside* `utils/` imports its sibling without an `utils/` path segment) and calling `logger.error({ err }, ...)` with a raw caught error. The scanner did not flag it — the sink-detection regex required the substring `utils/logger`, which a same-directory `./logger.js` specifier never contains. Fixed by matching on the specifier's final path segment (`(?:^|/)logger(?:\.(js|ts))?$`, relative-only) instead of a fixed prefix (`lib/scanner.ts`'s `LOGGER_MODULE_SPECIFIER_RE`). Re-running the full scan after the fix: same 94 baseline findings (no new false positives from the broadened match), plus the injected drift file now correctly flagged (`RAW_ERROR_OBJECT`, exit 1). The drift file was then deleted; it was never committed.
- `err.name`/`err.code` access, and a same-named-but-unrelated local `logger` object not imported from `utils/logger`, were separately unit-tested to confirm they never flag (see §6).

## 6. Tests

`scripts/log-privacy-guard/__tests__/index.test.ts` — **29 assertions, all passing**, run via `npx tsx scripts/log-privacy-guard/__tests__/index.test.ts` (`npm run test:log-privacy-guard`):

**Negative fixtures (6/6, Step 6's exact required list)** — `__tests__/fixtures/unsafe/*.ts`, each asserted to trigger *exactly* the expected rule and no other:
1. raw caught error spread into `logger.error()` → `RAW_ERROR_OBJECT`
2. `error.message` logged directly → `ERROR_DANGEROUS_PROPERTY`
3. `error.stack` logged directly → `ERROR_DANGEROUS_PROPERTY`
4. `error.cause` logged directly → `ERROR_DANGEROUS_PROPERTY`
5. raw inbound `message.text` logged in a messaging catch → `MESSAGE_CONTENT`
6. raw `phone` logged directly → `DIRECT_PII_FIELD`

**Positive fixtures (6/6 fixture-based + 1 repo-wide, Step 7's exact required list)** — `__tests__/fixtures/safe/*.ts`, each asserted to produce zero findings:
1. `safeErrorFields(err)` wrapper
2. `boundedErrorType(err)` wrapper (bounded error classification)
3. `requestId` metadata
4. `patientId`/`clinicId` entity-id metadata
5. `count`/`status`/`isRetry` metadata
6. `redactPhone()`/`summarizeTextForLog()`-wrapped values (safe redacted/summarized forms)
7. **current accepted `main` baseline**: a full scan of the real `server/src/{routes,services,jobs,middleware,utils}` tree with the real `baseline-exceptions.json` applied asserts `violations.length === 0`, `staleExceptions.length === 0`, `duplicateExceptions.length === 0`, `errors.length === 0`

**Additional coverage beyond the minimum:**
- inline `log-privacy-guard:allow` suppression: a real reason (≥10 chars) suppresses; a too-short/empty marker does not
- sink scoping: an unrelated local `logger`-named object never flags; `err.name`/`err.code` never flag
- fingerprint determinism and drift-sensitivity (identical input → identical hash; changed line text → changed hash)
- `baseline-exceptions.json` schema validation: rejects wildcard paths, short reasons, duplicate fingerprints, unknown rule IDs; accepts well-formed entries
- `applyBaseline()` semantics: grandfathering, staleness, and new-violation classification, unit-tested directly
- the real `config/baseline-exceptions.json` file parses and validates, and contains zero wildcard paths

## 7. Repository scan result (current `main`, baseline SHA above)

```
Files scanned: 262
Duration: ~700-900ms (scanner logic only) / ~2.9s wall-clock (including tsx/node startup)
New violations: 0
Grandfathered (matched a reviewed baseline exception): 94
Suppressed (inline log-privacy-guard:allow): 0
Stale baseline exceptions: 0
Scan errors: 0
Exit code: 0 (--strict-baseline)
```

**R-018 status: still OPEN, unchanged by this task.** This scan result does not reduce the number of unsafe sites in the repository — it grandfathers the 94 pre-existing ones (unchanged code, unchanged risk) and adds a mechanism that stops the count from growing. Combined with F3-IMPL-004's 43 + F3-IMPL-006's 113 already-fixed sites, the **full known unsafe-pattern surface across the codebase's history is 43 + 113 (fixed) + 94 (newly discovered, grandfathered, unfixed) = 250 sites of this exact pattern class ever found**, plus the 92 `POTENTIAL_PII_SAFE_AFTER_REVIEW` sites F3-IMPL-006 judged safe by manual review (still not covered by any automated rule — `email`/`firstName`/`lastName`/`patientName` fields wrapped in redaction helpers are, by design, invisible to this guard once wrapped, which is correct; but a *new*, un-reviewed direct-PII-field site outside the `email`/`phone` closed vocabulary would also not be caught — see §9).

## 8. Performance (Step 11)

Measured 3 consecutive runs of the scanner logic alone (excluding process startup): **678ms, 702ms, 887ms** — all well under the "well below 30 seconds" target and close to the "prefer a few seconds" target. Full wall-clock including `tsx`/Node startup: **~2.9s**. No `ts.Program`/type-checker is constructed (a deliberate design choice — see §3), which is the main reason this is fast: each file is parsed once with `ts.createSourceFile` and walked once, O(files × AST size), no cross-file resolution.

## 9. CI integration status

**Not wired into any CI workflow or aggregate script chain in this task**, per Step 10's explicit instruction: F3-CI-OPT-001 (`chore/f3-ci-opt-001-risk-based-path-aware-ci`, confirmed present as its own worktree/branch on this baseline) may be modifying `.github/workflows/**` and/or CI-invocation scripts concurrently. This task therefore:
- does **not** touch `.github/workflows/**`;
- does **not** touch `server/package.json` (F3-CI-OPT-001's more likely conflict surface, given it already owns the server test-chain aggregate script);
- adds three standalone, already-runnable root-`package.json` scripts (mirroring `architecture-guardrail`'s own naming and the fact that `architecture-guardrail`'s scripts are similarly **not** wired into any aggregate chain there either — this is the established, existing convention for root-level guard tooling in this repo, not a new pattern introduced by this task):
  - `npm run log-privacy-guard:scan` — `tsx scripts/log-privacy-guard/cli.ts` (add `--strict-baseline` for CI; human report to stdout, non-zero exit on any new violation)
  - `npm run test:log-privacy-guard` — `tsx scripts/log-privacy-guard/__tests__/index.test.ts` (the 29-assertion suite in §6)
  - `npm run typecheck:log-privacy-guard` — `tsc --noEmit -p scripts/log-privacy-guard/tsconfig.json`

**Exact plug-in point for F3-CI-OPT-001 reconciliation:** add a step running `npm run log-privacy-guard:scan -- --strict-baseline` (exit code alone is the gate signal; add `--json --out=<path>` if the workflow wants a machine-readable artifact) to whatever job already runs `npm run guardrail:scan`/`guardrail:test` — they are same-shape, same-cost (sub-3s), same-directory-level tools, so co-locating them in CI is the natural join point once F3-CI-OPT-001's path-aware job structure lands.

## 10. Validation run (exact commands)

```
cd "<worktree>" && npx tsc --noEmit -p scripts/log-privacy-guard/tsconfig.json          # exit 0
cd "<worktree>" && npx tsx scripts/log-privacy-guard/__tests__/index.test.ts             # 29 passed, 0 failed, exit 0
cd "<worktree>" && npx tsx scripts/log-privacy-guard/cli.ts --strict-baseline            # 0 new, 94 grandfathered, 0 stale, exit 0
cd "<worktree>" && git diff --check                                                      # clean (CRLF-normalization notices only, no real whitespace errors)
```

No `server/` runtime code, Prisma schema, route, or middleware was changed — this task's diff is entirely new files under `scripts/log-privacy-guard/**`, one new file under `docs/program/evidence/**`, and 4 added lines in the root `package.json`'s `scripts` block. Per Step 12's instruction ("this task should normally not modify application runtime code at all... do not run the entire repository matrix unless actual shared runtime behavior changed"), no server-side test suite (including the 21 existing `*LogPrivacy.test.ts` files) was re-run — none of their inputs changed. `git diff --stat` for the full change: **24 files changed, 2248 insertions(+), 1 deletion(-)** (the 1 deletion is the trailing comma removed/re-added around the new root `package.json` script entries).

## 11. Security / tenant / KVKK review (Step 13)

- **No runtime behavior changed.** Nothing under `server/src/` was modified; the guard is a standalone dev/CI-time static-analysis tool that never runs as part of the application process.
- **No tenant boundary changed.** No query, `where` clause, or authorization logic touched.
- **No auth behavior changed.**
- **No KVKK/PII copied into test fixtures or this evidence doc.** All fixture and evidence-doc examples use synthetic placeholder values (`'operation failed'`, a stub `phone: string` parameter, etc.) — no real patient/user data, connection string, or secret appears anywhere in `scripts/log-privacy-guard/**`.
- **The scanner's own diagnostics do not dump sensitive literal content.** A finding's `snippet` field is the offending **source code line** (e.g. `console.error('[whatsapp-inbox] list-conversations error', error);`) — this is program syntax, not a runtime data value; no actual patient/user data ever flows through the scanner (it never executes or evaluates the scanned code, only parses it as text).
- **No migration/schema change.**
- **No secrets introduced.** `baseline-exceptions.json` contains only file paths, line numbers, rule IDs, hashes of source-line text, and reviewer-written reasoning text.

## 12. Rollback

Every added file is new (`git status` shows only `A` entries plus one `M` on root `package.json`). Rollback is `git revert` of this PR's merge commit, or manually: delete `scripts/log-privacy-guard/`, delete `docs/program/evidence/F3-IMPL-007_SENSITIVE_RUNTIME_LOGGING_REGRESSION_GUARD.md`, and remove the 3 added lines from root `package.json`'s `scripts` block. Since the guard is not wired into any CI gate yet (§9) and never runs as part of the application, rollback carries zero runtime/deployment risk — it only removes an optional, not-yet-enforced dev-time check.

## 13. Residual risks

- **Name-based, not type-based detection.** No `ts.Program`/type checker is used (a deliberate perf/simplicity trade-off — see §3/§8). A caught value not named exactly `err`/`error`, or an error object laundered through an intermediate variable with an unrelated name before reaching a sink, will not be flagged by `RAW_ERROR_OBJECT`/`ERROR_DANGEROUS_PROPERTY`.
- **Closed vocabularies, not general dataflow.** `MESSAGE_CONTENT` and `DIRECT_PII_FIELD` match a small, explicit, documented name list (§3) — a new PII field or message-content variable using a name outside that list will not be caught until the rule's vocabulary is deliberately extended.
- **Sink scope is exactly `console.*` and the `logger` singleton from `utils/logger.ts`** (import-specifier-gated) within the 5 authorized roots. `server/src/index.ts`, `server/src/worker.ts`, and `server/src/scripts/**` are not scanned (same scope boundary F3-IMPL-004/006 and `architecture-guardrail` already use) — a raw-error-logging site introduced there would not be caught by this guard.
- **Opaque calls.** Any call expression that is not itself a sink and not on the safe-wrapper allowlist is not descended into — an unsafe value could theoretically be laundered through a helper function whose name doesn't match `redact*`/`summarize*`/the four exact names, then logged from *inside* that helper (a different call site, which — if it itself calls `console.*`/`logger.*` inside the 5 roots — would still be caught at that inner call site, just not attributed back to the outer call).
- **Not wired into CI yet** (§9) — until F3-CI-OPT-001 reconciliation adds the workflow step, the guard only runs when a developer or a future CI change invokes `npm run log-privacy-guard:scan` manually.
- **94 pre-existing sites remain grandfathered, unfixed.** This was the explicit, instructed scope boundary for this task (§1) — it is a known, documented, and now-tracked (via the baseline-exceptions file, which is itself reviewable and diffable) residual, not a silent gap.
- **The 92 `POTENTIAL_PII_SAFE_AFTER_REVIEW` sites remain outside any automated invariant**, exactly as F3-IMPL-006 §7 already stated — this task does not change that.

## 14. Task status

`AGENT_COMPLETED` / `TESTS_PASSED` (29/29 guard-suite assertions; typecheck clean; real-repository scan clean with 0 new violations, 0 stale exceptions) / `PR_OPENED` — see PR link below — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

**R-018: OPEN.** Regression-prevention control added and validated against the real repository; the pre-existing 94-site + 92-site residual gaps are unchanged and not claimed closed by this task.

## 15. F3-IMPL-007-R1 — accepted review findings, fixed (2026-08-12)

Two review findings accepted against `scripts/log-privacy-guard/lib/scanner.ts`, both fixed on this same branch/PR. Neither touches application code (`server/src/**`) — both are corrections to the scanner's own name-based trust logic.

### 15.1 Finding 1 — catch-clause bindings must be error-like regardless of name

**Before:** `visit()`'s `ts.isCatchClause` branch only tracked the catch binding as error-like if its name was in `ERROR_PARAM_NAMES` (`err`/`error`) — the same exact-name set used for `.catch()`/reject-handler *function parameters*. A binding named anything else (`catch (e)`, `catch (ex)`, `catch (caught)`, or a codebase-specific name like `waErr`) was invisible to `RAW_ERROR_OBJECT`/`ERROR_DANGEROUS_PROPERTY` entirely.

**Fix:** a `catch (x) { ... }` clause's binding is, by JS/TS syntax alone, always the caught value — no name-based allowlist is needed or correct there (unlike a bare function parameter, which needs a name-based signal to distinguish a `.catch(err => ...)` handler from an unrelated callback — that half, `ERROR_PARAM_NAMES` on `isArrowFunction`/`isFunctionExpression`/`isFunctionDeclaration` parameters, is unchanged). Any named catch-clause binding is now tracked unconditionally; a destructured or omitted binding (`catch ({ code })`, `catch {}`) still has nothing to track, which is correct — there is no single caught-value variable to leak in that shape.

**Real-repository impact:** re-running the strict-baseline scan against unchanged `server/src/**` surfaced exactly 4 new, genuine, pre-existing sites in `server/src/routes/patients.ts` (lines 212/231/242/258 — `waErr?.message`, `igErr?.message`, `trErr?.message`, `tcErr?.message`, all `ERROR_DANGEROUS_PROPERTY`) that the exact-name-only rule had never been able to see. These are real, already-shipped log statements, not something this fix introduced — grandfathered into `baseline-exceptions.json` with their own reason strings (distinct from the original 94's `F3-IMPL-007-baseline-import` `addedBy` tag; these use `F3-IMPL-007-R1-catch-binding-fix`) exactly as the tool's own established, documented pattern requires (§4/§13's "94 pre-existing sites remain grandfathered, unfixed" — this fix does not change that scope boundary, it only makes the *count* it grandfathers more accurate). Baseline total: 94 → **98**.

### 15.2 Finding 2 — remove generic `redact*`/`summarize*` prefix trust

**Before:** `isSafeWrapperCall()` treated any call whose callee name matched `SAFE_WRAPPER_EXACT_NAMES` **or** the regex `/^(redact|summarize)[A-Z]/` as an opaque, trusted safe-wrapper boundary. The prefix half was never reviewed per-name — any function merely *named* `redactX`/`summarizeX` was automatically trusted. Concretely, `server/src/services/privacy/patientAnonymization.ts` alone defines `redactPatientAttachments`, `redactPatientImagingImages`, `redactPatientMedicalHistory`, and `redactActivityDescription` — unrelated DB-anonymization functions (returning `Promise<RedactionCounters>`/`void`, not a log-safe string) that the prefix regex would have silently trusted as a log-redaction boundary had any of them ever been passed to a sink.

**Fix:** `SAFE_WRAPPER_PREFIX` and its regex test are removed entirely; `isSafeWrapperCall()` is now `SAFE_WRAPPER_EXACT_NAMES.has(name)` only. The set is expanded from the original 4 exact names to include the 5 additional `redact*`/`summarize*`-named helpers that repo grep confirms are the ones actually used as log-argument wrappers today: `redactPhone`, `redactSensitiveText`, `summarizeTextForLog`, `summarizeIdentifier`, `summarizeProviderId` (exact file list for each in the updated `scanner.ts` comment and in §15.3 below). A future helper named `redactX`/`summarizeX` no longer gains automatic trust — it must be added to this list by name, in a reviewable diff, exactly like any other entry.

**Real-repository impact:** none observable — the strict-baseline scan's new-violation count is unaffected by this half of the fix (0 before, 0 after, isolating for this change alone). This is expected, not a gap: `inspectValue`'s call-expression branch never descends into *any* call's arguments regardless of safe-wrapper status (documented, pre-existing, accepted limitation — §13 "Opaque calls" and §3's module doc), so narrowing which names count as "safe" doesn't change what gets flagged today; it only closes the trust gap for whichever *future* `redactX`/`summarizeX`-named function gets written next.

### 15.3 Full updated safe-wrapper exact allowlist (9 names)

| Name | Source (files using it as a log-sink argument, per repo grep) |
|---|---|
| `safeErrorFields` | F3-IMPL-006 §2 (unchanged from original PR) |
| `safeErrorLog` | F3-IMPL-006 §2 (unchanged from original PR) |
| `boundedErrorType` | F3-IMPL-006 §2 (unchanged from original PR) |
| `senderSuffix` | F3-IMPL-006 §2 (unchanged from original PR) |
| `redactPhone` | `server/src/jobs/reminders.ts`, `server/src/routes/whatsapp.ts`, `server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`, `server/src/utils/logRedaction.ts` |
| `redactSensitiveText` | `server/src/services/privacy/redaction.ts` |
| `summarizeTextForLog` | `server/src/routes/whatsapp.ts`, `server/src/utils/logRedaction.ts` |
| `summarizeIdentifier` | `server/src/routes/whatsapp.ts`, `server/src/routes/instagramInbox.ts`, `server/src/services/instagram/instagramClinicResolver.ts`, `server/src/services/instagram/instagramAiConversationProcessor.ts` |
| `summarizeProviderId` | `server/src/routes/instagramWebhook.ts`, `server/src/routes/metaWhatsAppWebhook.ts` |

Names with the same `redact*`/`summarize*` naming shape that exist in the codebase but are **not** on this list, and are therefore no longer trusted as opaque boundaries if ever passed to a sink: `summarizeConnectionIdentifiers`, `summarizePhone`, `summarizeId`, `redactForAnonymization`, `redactMetaBody`, `redactContentPatterns`, `redactCredentialKeyValues`, `redactPhoneCandidates`, `redactActivityDescription`, `redactPatientAttachments`, `redactPatientImagingImages`, `redactPatientMedicalHistory`. None of these were confirmed (by the same repo grep used to build the reviewed list) to actually be called as a direct log-sink argument today; adding any of them to the allowlist in the future requires the same explicit, reviewable, one-line-per-name diff as every other entry — not a rename to dodge the guard.

### 15.4 Note on worktree state at task start

This worktree (`E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-007`) already contained an uncommitted, untracked exploratory script (`scripts/log-privacy-guard/__scratch_find_wrappers.mjs`, enumerating every `redact*`/`summarize*`-named call site in the scan roots — i.e., the same investigation §15.2 needed) and a debug-instrumented, uncommitted version of `isSafeWrapperCall()` (an env-var-gated `console.error` logging prefix-matched wrapper names) when R1 started, with file modification timestamps roughly 1-2 minutes old. This looks like leftover scaffolding from a concurrent or immediately-prior investigation into this exact same finding (this repository's environment runs multiple parallel agent sessions against shared worktrees) rather than any kind of tampering, but was not something this task introduced or relied on — the debug instrumentation was removed as part of the fix (§15.2's diff), the scratch script was left in place untracked (not committed; permission to delete files was not available in this session), and origin's branch head was re-verified unchanged immediately before this task's own push (§15.5).

### 15.5 Post-fix validation (all commands re-run against the fix, not reused from §10)

```
cd "E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-007"
npm run typecheck:log-privacy-guard        # 0 errors
npm run test:log-privacy-guard             # 29 passed, 0 failed (was 28/29 with 1 failure — fixture 07 — before baseline-exceptions.json was updated)
npx tsx scripts/log-privacy-guard/cli.ts --strict-baseline
                                            # 0 new, 98 grandfathered (94 -> 98, +4 from §15.1), 0 stale, exit 0
git diff --check                           # exit 0, no findings
```

### 15.6 R1 task status (superseded — see §16)

`AGENT_COMPLETED` / `TESTS_PASSED` (29/29 guard-suite assertions; typecheck clean; real-repository strict-baseline scan clean — 0 new, 98 grandfathered, 0 stale) / `PR_OPENED` (existing PR #399, same branch) / `NOT_MERGED` / `NOT_DEPLOYED`.

**R-018: still OPEN, unchanged by R1** — this fix corrects the scanner's own trust logic (fewer false-negatives, no application code changed); it does not remediate the 94 (now 98) grandfathered sites, and does not claim to.

## 16. F3-IMPL-007-R1 completion — required tests added, safe-wrapper trust boundary closed, evidence corrected (2026-08-12, same day)

§15 above was authored against an intermediate state of this same branch/PR (this worktree runs multiple parallel agent sessions against shared state per §15.4 — the file on disk kept changing between §15's own investigation and its commit). Two things in §15 need correction, and the task brief's explicit test requirements (both findings' negative/positive test lists) were not yet added when §15 was committed as `e34377f`. This section is the authoritative, final state; §15.2's "none observable" claim and §15.3's exclusion table are superseded by §16.1-§16.2 below, not by an edit to §15 itself (preserving §15 as the historical record of what that commit's message says versus what its diff actually contains).

### 16.1 Correction to §15.2 — the safe-wrapper distinction was dead code until this fix

`inspectValue`'s `ts.isCallExpression` branch, as it stood before this task, returned unconditionally in **both** branches of `if (isSafeWrapperCall(n)) return; return;` — i.e. every call expression reached as a sink argument (or nested value position) was already an opaque leaf regardless of `isSafeWrapperCall`'s result. This means `isSafeWrapperCall()` — prefix-based or exact-name-based, either way — never actually gated anything: `unknownHelper(err)`, `redactWhatever(err)`, and `safeErrorFields(err)` were all equally invisible to the scanner. §15.2 correctly diagnosed the *naming* problem (prefix trust) but its "Real-repository impact: none observable" line reflects this pre-existing dead-code state, not the code actually committed in `e34377f` — that commit's diff (verified via `git show e34377f -- scripts/log-privacy-guard/lib/scanner.ts`) already contains the fix below, landed on shared disk state before the commit was made.

**Fix (now the shipped behavior):** a call expression NOT on `SAFE_WRAPPER_EXACT_NAMES` is no longer opaque — its own arguments are now inspected via `inspectValue` exactly like any other value position:

```ts
if (ts.isCallExpression(n)) {
  if (isSafeWrapperCall(n)) return; // allowlisted safe boundary — do not descend into its arguments
  for (const arg of n.arguments) inspectValue(arg);
  return;
}
```

This is what makes the review finding's required test 2/3/4 (below, §16.3) meaningful: without this change, `redactWhatever(err)`/`summarizeWhatever(err)`/`totallyLegitHelper(err)` would ALL have continued to pass silently (opaque by the old universal-return behavior), regardless of whether the naming-based allowlist was prefix-based or exact-name-based. The fix is scoped narrowly — it changes only what happens when a call is NOT on the reviewed allowlist; allowlisted calls are unaffected.

**Real-repository impact (corrected):** re-running the strict-baseline scan surfaced exactly 5 new, genuine, pre-existing sites in `server/src/routes/platformSecurityIncidents.ts` (lines 122/155/168/193/260 — the `String(err)` fallback branch of `err instanceof Error ? err.message : String(err)`, all `RAW_ERROR_OBJECT`). `String` is a global built-in, not a redaction helper — it stringifies the full `Error` (message and, depending on engine, more) — so it is correctly NOT added to the safe-wrapper allowlist. These are real, already-shipped log statements predating this task; grandfathered into `baseline-exceptions.json` with `addedBy: "F3-IMPL-007-R1-safe-wrapper-fix"`. Baseline total: 98 (§15.1's count) → **103**.

### 16.2 Correction to §15.3 — 3 additional names actually relied upon

Re-deriving the allowlist by instrumenting a real scan run (temporarily logging every callee name that matched only the now-removed prefix regex while reached from a sink's arguments, across the 5 scan roots) found 3 more currently-relied-upon names that §15.3 had listed as "not on this list": `redactMetaBody` (`server/src/services/instagram/InstagramMessagingProvider.ts`), `summarizeConnectionIdentifiers` (`server/src/routes/instagramWebhook.ts`), `summarizeId` (`server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`). All three are genuine log-argument wrapper calls that were relying on the old prefix rule to stay opaque; omitting them from the exact allowlist would have caused §16.1's call-expression-descent fix to flag them as new violations. They are added to `SAFE_WRAPPER_EXACT_NAMES` (now **12** names total, not 9), reviewed the same way as the other 8.

The remaining names §15.3 listed as excluded — `summarizePhone`, `redactForAnonymization`, `redactContentPatterns`, `redactCredentialKeyValues`, `redactPhoneCandidates`, `redactActivityDescription`, `redactPatientAttachments`, `redactPatientImagingImages`, `redactPatientMedicalHistory`, `redactStudyLegalHoldReason`, `redactLegalHoldReason` — remain excluded: none of them were found reached from a logger/console sink's arguments in the instrumented scan, so none needed adding, and none should be added speculatively.

### 16.3 Required tests added (task brief's explicit list, both findings)

`scripts/log-privacy-guard/__tests__/index.test.ts` gained two new sections, 8 new assertions (29 → **37**):

**"Catch-clause binding tracking" (finding 1, all 4 task-required cases):**
1. `catch (e)` — raw object (`{ e }`) to `console.error` → `RAW_ERROR_OBJECT`
2. `catch (ex)` — `ex.message` to `console.error` → `ERROR_DANGEROUS_PROPERTY`
3. nested `catch (e) { try { ... } catch (ex) { ... } }` — both bindings tracked independently, 2 distinct `RAW_ERROR_OBJECT` findings
4. shadowing — an unrelated `const e = ...` declared *after* the catch block closes, then logged, produces zero additional findings (only the 1 finding from inside the catch scope) — proves `exitErrorScope` correctly un-tracks the name

**"Safe-wrapper exact allowlist" (finding 2, all 4 task-required cases):**
1. a known exact allowlisted helper (`safeErrorFields`) wrapping `err` → zero findings
2. an unknown `redactWhatever(err)` (not on the allowlist) → `RAW_ERROR_OBJECT` (not silently trusted)
3. an unknown `summarizeWhatever(err)` (not on the allowlist) → `RAW_ERROR_OBJECT` (not silently trusted)
4. a deliberately unsafe pass-through helper with an unrelated name (`totallyLegitHelper(err)`) → `RAW_ERROR_OBJECT`, proving naming alone (matching or not matching `redact*`/`summarize*`) cannot bypass detection

### 16.4 Full updated safe-wrapper exact allowlist (12 names, final)

| Name | Source |
|---|---|
| `safeErrorFields` | F3-IMPL-006 §2 |
| `safeErrorLog` | F3-IMPL-006 §2 |
| `boundedErrorType` | F3-IMPL-006 §2 |
| `senderSuffix` | F3-IMPL-006 §2 |
| `redactPhone` | `server/src/jobs/reminders.ts`, `server/src/routes/whatsapp.ts`, `server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`, `server/src/services/whatsappBookingFlow.ts` |
| `redactSensitiveText` | `server/src/services/googleAiStudio.ts`, `server/src/services/privacy/redaction.ts`, `server/src/services/whatsappAgentPrompt.ts`, `server/src/services/whatsappConversationAgent.ts`, `server/src/services/whatsappStepAwareNlu.ts` |
| `redactMetaBody` | `server/src/services/instagram/InstagramMessagingProvider.ts` |
| `summarizeTextForLog` | `server/src/routes/whatsapp.ts`, `server/src/services/whatsappBookingFlow.ts` |
| `summarizeIdentifier` | `server/src/routes/whatsapp.ts`, `server/src/routes/instagramInbox.ts`, `server/src/services/instagram/instagramClinicResolver.ts`, `server/src/services/instagram/instagramAiConversationProcessor.ts` |
| `summarizeProviderId` | `server/src/routes/instagramWebhook.ts`, `server/src/routes/metaWhatsAppWebhook.ts` |
| `summarizeConnectionIdentifiers` | `server/src/routes/instagramWebhook.ts` |
| `summarizeId` | `server/src/services/whatsapp/metaWhatsAppAiProcessor.ts` |

### 16.5 Baseline delta, full accounting

| Stage | Count | Delta |
|---|---|---|
| Original F3-IMPL-007 (§4) | 94 | — |
| §15.1 catch-binding fix (`patients.ts` waErr/igErr/trErr/tcErr) | 98 | +4 |
| §16.1 call-expression-descent fix (`platformSecurityIncidents.ts` `String(err)` ×5) | **103** | +5 |

All 9 newly-grandfathered entries (4 + 5) are exact-fingerprinted, single-file/single-line, non-wildcard, with `reason` ≥15 chars and a distinct `addedBy` tag identifying which R1 sub-fix surfaced them — no path-level or wildcard ignores were added, per the task brief's explicit prohibition.

### 16.6 Final validation run (supersedes §10 and §15.5)

```
cd "E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-007"
npx tsc --noEmit -p scripts/log-privacy-guard/tsconfig.json     # 0 errors
npm run test:log-privacy-guard                                  # 37 passed, 0 failed
npx tsx scripts/log-privacy-guard/cli.ts --strict-baseline
  # Files scanned: 262 · 0 new violations · 103 grandfathered · 0 stale · 0 duplicate · 0 errors
git diff --check                                                 # exit 0 (CRLF-normalization notices only)
```

**Performance:** 3 consecutive scanner-logic-only runs after the fix: 852ms, 736ms, 725ms (was 678-887ms pre-fix, §8) — the added call-expression descent is a bounded per-argument traversal, not a complexity-class change, and stays well within the existing performance envelope.

**No `server/` runtime code, Prisma schema, route, or middleware was changed.** This correction's diff is entirely: `scripts/log-privacy-guard/lib/scanner.ts` (rule-engine logic), `scripts/log-privacy-guard/config/baseline-exceptions.json` (+9 exact, fingerprinted, documented entries), `scripts/log-privacy-guard/__tests__/index.test.ts` (+8 assertions), and this evidence doc. No migration/schema change. No secrets introduced.

### 16.7 R1 final task status

`AGENT_COMPLETED` / `TESTS_PASSED` (37/37 guard-suite assertions, including all 8 task-brief-required negative/positive cases for both findings; typecheck clean; real-repository strict-baseline scan clean — 0 new, 103 grandfathered, 0 stale, 0 duplicate, 0 errors) / `PR_UPDATED` (existing PR #399, same branch — not a new PR) / `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.

**R-018: still OPEN.** This correction fixes the scanner's own trust logic (catch-clause name-independence; a genuine, exact-name-only, non-opaque-by-default safe-wrapper boundary) and adds the task-required regression tests for both. It does not remediate any of the 103 grandfathered sites and does not claim to — R-018 closure remains a separate, future, explicitly-scoped remediation task.

**Merge safe:** NO — awaiting human review of this correction (catch-clause scoping change, safe-wrapper trust-boundary change, and the resulting 9 new baseline grandfather entries all warrant review before merge, consistent with this task's explicit "Do NOT merge" instruction).

**Deployment safe:** NO — this branch is not deployed; the tool is not wired into any CI gate yet (§9), unchanged by this correction.

**Exact next task:** F3-IMPL-007-R1 review / merge decision.

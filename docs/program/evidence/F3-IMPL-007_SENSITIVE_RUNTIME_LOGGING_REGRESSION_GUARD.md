# F3-IMPL-007 — Sensitive Runtime Logging Regression Guard

**Task ID:** F3-IMPL-007 · **Phase:** F3 — Production Hardening · **Branch:** `feature/f3-impl-007-sensitive-log-regression-guard` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-007` · **Baseline:** `origin/main` @ `6f7e580d1bab2a0f87baed1cfe5ec0a944a6b711` (Merge PR #396, `feature/f3-sec-002-platform-admin-session-revocation`) — confirmed via `git fetch origin --prune && git rev-parse origin/main`, exact match, clean worktree (`git status --short` empty at task start).

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

# F1-003-B1 — Overdue Installments Baseline Drift Resolution

**Task ID:** F1-003-B1
**Parent task:** F1-003 (Baseline CI Test Execution and Disposable Runtime Readiness)
**Phase:** F1 — CI and Test Architecture
**Task type:** Narrow test/product behavior reconciliation (a single deterministic drift), authorized to run in parallel with F1-003-R1 (PR #256, disposable-runtime evidence — not touched by this task).
**Generated:** 2026-07-28

---

## 1. Task identity

F1-003-B1 resolves the single deterministic, pre-existing drift documented by F1-003-P1 (merged, PR #257, merge commit `1e983fe7134f9224cdaeb0065d32b1e8ef2d0904`): `server/src/tests/overdueInstallments.test.ts` fails 2 of 9 assertions when run via `npm run test:overdue-installments`, and is the sole known cause of `npm run server:test:non-disposable` returning exit code 1.

---

## 2. Baseline and worktree

- Primary repository `E:\Ek Gelir\Siteler\DisKlinikCRM-git` — `git status --short` clean at task start, on branch `fix/revenue-report-group-by` (untouched by this task).
- `git fetch origin --prune` run; `origin/main` = `1e983fe7134f9224cdaeb0065d32b1e8ef2d0904` — **identical** to the expected F1-003-P1 merge commit named in the task brief.
- `git merge-base --is-ancestor 1e983fe7134f9224cdaeb0065d32b1e8ef2d0904 origin/main` → exit `0`.
- `git log --oneline --decorate -10 origin/main` confirms `1e983fe` (PR #257 merge) is `origin/main`'s current tip; no intervening commits exist between the expected baseline and current `origin/main`.
- `git worktree list` at task start showed active worktrees including `f1-003-p1-test-script-closure` (`44bb496`) and `f1-003-p2a-runtime-design` (`c45b37c`) — **neither was read, entered, or modified by this task.**
- New isolated worktree created: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-b1-overdue-installments`, branch `fix/f1-003-b1-overdue-installments-drift`, created directly from `origin/main` (`git worktree add ... -b fix/f1-003-b1-overdue-installments-drift origin/main`), landing exactly at `1e983fe`.
- No other worktree (R1/P2A/KVKK/unrelated) was touched at any point in this task.

---

## 3. Authoritative sources reviewed

`AGENTS.md` context inherited via task brief; `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`, `docs/program/TEST_OWNERSHIP.md`, `docs/program/evidence/F1-003-P1_TEST_SCRIPT_CLOSURE_AND_EXECUTION_CONTRACT.md`, `docs/program/evidence/F1-003-P1_test_execution_contract.json` (existence/shape confirmed via the MD's own citations), `server/package.json`, `server/src/tests/overdueInstallments.test.ts`, `server/src/utils/overdueInstallments.ts`, `server/src/utils/overdueReceivables.ts`, `server/src/routes/dashboard.ts`, `server/src/routes/financeDashboard.ts`, `server/src/routes/paymentPlans.ts`, `server/prisma/schema.prisma` (`PaymentPlanInstallment` model), `src/pages/PaymentPlans.tsx`, `server/src/tests/overdueReceivables.test.ts`, `server/src/tests/financeDashboard.test.ts`, `server/src/tests/dashboard.test.ts`. `docs/program/RISK_REGISTER.md` was not separately re-read in full; R-070's `OPEN` status is taken as given from F1-003-P1's own evidence (§10 of that document) and is not touched by this task.

---

## 4. CodeGraph commands and findings

`ToolSearch("CodeGraph", 10)` was not available as a tool in this execution environment (no `CodeGraph`-named tool appears among the deferred-tool listing surfaced to this session). This is consistent with every prior F1-00x task's own disclosed CodeGraph unavailability (F1-001, F1-002-P1, F1-002-P2, F1-003-P1 all record the identical finding). No whole-repository scan was performed as a substitute. Instead, narrowly bounded `Grep`/`Glob`/`Read` was used, scoped exactly to the roots named in the task brief:

1. **Which production symbol produces the `overdue` status?** No application code path writes the literal string `'overdue'` to `PaymentPlanInstallment.status` (`Grep "status.{0,5}[:=].{0,5}['"]overdue['"]"` over `server/src/` found no write site — only the test file's own now-corrected assertion text and `overdueReceivables.ts`'s docstring prose). `overdue` is a **legacy/persisted** value per `overdueInstallments.ts`'s own docstring — it exists in the database from before/outside the current write path, not from a currently-running workflow.
2. **Which symbols consume/filter that status?** `overdueInstallmentWhere()` and `isInstallmentOverdue()` in `server/src/utils/overdueInstallments.ts`; consumed by `overdueReceivablesAmount()`/`overdueReceivablesList()` in `server/src/utils/overdueReceivables.ts`, which is consumed by `server/src/routes/dashboard.ts` and `server/src/routes/financeDashboard.ts`; the frontend's parallel `isOverdue()` in `src/pages/PaymentPlans.tsx` reimplements the identical `['pending','overdue'].includes(status) && !paymentId && dueDate < now` logic.
3. **Exact call path to the two failing assertions:** `server/src/tests/overdueInstallments.test.ts` imports `overdueInstallmentWhere`/`isInstallmentOverdue` directly from `../utils/overdueInstallments.js` and calls them with literal fixture arguments — no intermediate call path, no database.
4. **Persisted, derived, or both?** Both: `overdue` can be a **persisted** literal (legacy rows), while the same functions also **derive** overdue status for `status === 'pending'` rows whose `dueDate` has passed. Neither function itself ever *writes* a status.
5. **Idempotent?** N/A to this task — neither function mutates state; both are pure read/filter helpers.
6. **Does the test reflect a prior contract still used elsewhere?** No. `git log --oneline -- server/src/utils/overdueInstallments.ts` shows exactly 2 commits: `9e06f12` (introduced the module, `status === 'pending'` only) and `81323a8` (`fix(finance): include persisted overdue installments in totals` — added `'overdue'` to both functions' accepted-status set and added `paymentId` exclusion). `git blame` confirms every line touched by `81323a8` is still current. No other file in the repository still depends on the pre-`81323a8` (pending-only) contract.
7. **Alternative status literals?** `server/prisma/schema.prisma` line 1041: `status String @default("pending") // pending, paid, overdue` — the schema's own inline comment lists exactly three values, `overdue` being one of them; no `unpaid`/`late`/`partially_paid` literal exists for this model.
8. **Does the API/frontend contract expose `overdue`?** Yes. `src/pages/PaymentPlans.tsx`'s `isOverdue()` (updated in the same commit `81323a8`) treats `'overdue'` identically to the backend; `INSTALLMENT_STATUS_STYLES` in the same file has a dedicated `overdue` style key; `server/src/tests/financeDashboard.test.ts:240` asserts `assert.ok(['pending', 'overdue'].includes(inst.status))` against fixture data.
9. **Could changing the implementation alter financial totals/aging/reminders/collection/tenant queries?** Yes — this is exactly why this task did **not** change the implementation (see §9 below). Reverting `overdueInstallmentWhere`/`isInstallmentOverdue` to pending-only would silently exclude legacy `'overdue'`-status installments from the dashboard "Gecikmiş Tahsilatlar" card, the Finance Dashboard's `overdueAmount`/`overdueInstallments` fields, and the unified `/payment-plans/overdue-collections` view — reintroducing the exact defect commit `81323a8` fixed (its own message: "include persisted overdue installments in totals").
10. **Which tests cover the same behavior and could regress?** `server/src/tests/overdueReceivables.test.ts` (12 assertions, already exercises the `'overdue'`+`paymentId`-exclusion contract directly, added in the same commit `81323a8`), `server/src/tests/financeDashboard.test.ts` (25 assertions, includes the `['pending','overdue']` fixture assertion at line 240), `server/src/tests/dashboard.test.ts` (38 assertions, covers `overdueAmount`/`overdueReceivables` shape handling but does not depend on the specific status-literal set). All three were re-run after the fix (§13) — all pass, unchanged.

---

## 5. Failure reproduction

Command: `npm run test:overdue-installments`
Working directory: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-b1-overdue-installments\server`
Environment: no `DATABASE_URL`, no `MINIO_*`, no live-provider credential set (module under test has no database/network dependency — pure function fixtures only). `npm install` and `npx prisma generate` were run once at worktree start to make `tsx` available.
Exit code (pre-fix): `1`
Result (pre-fix): `Total: 9  Passed: 7  Failed: 2` — **matches the documented F1-003-P1 baseline exactly.**
Duration: ~1–2s (small, dependency-free fixture test; not separately timed in isolation).

---

## 6. Exact failing assertions (pre-fix)

1. **`status her zaman pending — literal "overdue" durumu asla yazılmaz`** (`overdueInstallmentWhere`, §1)
   - Expected (test, pre-fix): `where.status === 'pending'` (strict equality against the string literal)
   - Actual (production): `where.status === { in: ['pending', 'overdue'] }`
   - `assert.equal` fails because the actual value is an object, not the string `'pending'`.

2. **`literal status="overdue" (hiç yazılmayan değer) — pending olmadığı için false döner`** (`isInstallmentOverdue`, §2)
   - Expected (test, pre-fix): `isInstallmentOverdue('2026-07-01T00:00:00Z', 'overdue', now) === false`
   - Actual (production): `true` — `'overdue'` is now in the accepted-status list, `paymentId` is `undefined` (falsy → not excluded), and the due date is in the past.

---

## 7. Historical contract evidence

- `git log --oneline -- server/src/utils/overdueInstallments.ts`:
  - `9e06f123` (2026-07-09 12:10, `fix(dashboard): align no-show and overdue-collections cards with their destination pages`) — original module, `status === 'pending'` only, docstring: *"There is no background job that ever writes PaymentPlanInstallment.status = 'overdue'; the only place 'overdue' is real is status === 'pending' && dueDate < now."*
  - `81323a88` (2026-07-09 15:27, `fix(finance): include persisted overdue installments in totals`) — rewrote the docstring to *"Production contains both representations: pending installments whose dueDate has passed; legacy/persisted installments explicitly marked overdue,"* changed `overdueInstallmentWhere`'s `status` filter from `'pending'` to `{ in: ['pending', 'overdue'] }`, added `paymentId: null` to the where clause, changed `isInstallmentOverdue` to accept a `paymentId` parameter and check `['pending','overdue'].includes(status)`, and made matching changes to `src/pages/PaymentPlans.tsx`'s `isOverdue()`. This same commit **added** `server/src/tests/overdueReceivables.test.ts`'s "Production regression — legacy overdue status" section (4 new assertions, all directly exercising `status='overdue'` as `true`/overdue-counted) — i.e., the commit that changed the contract also added passing regression tests for the new contract, just not in `overdueInstallments.test.ts`, which was left unmodified by that commit.
- `git log --oneline -- server/src/tests/overdueInstallments.test.ts` shows only the original `9e06f123` commit — this file was never touched by `81323a88`, which is the direct, git-history-confirmed root cause of the drift: the test simply was not updated when its own module's contract changed.

---

## 8. Current implementation contract

- `server/src/utils/overdueInstallments.ts` (current, unchanged by this task): an installment counts as overdue if `status` is `'pending'` **or** the legacy/persisted literal `'overdue'`, it has no linked `paymentId`, and its `dueDate` is in the past.
- `server/prisma/schema.prisma:1041`: `status String @default("pending") // pending, paid, overdue` — schema comment confirms `overdue` is a recognized value for `PaymentPlanInstallment.status`, not an accidental/unintended literal.
- Consumers already built on this exact contract: `server/src/utils/overdueReceivables.ts` (`overdueReceivablesAmount`/`overdueReceivablesList`, used by `dashboard.ts` and `financeDashboard.ts`), `src/pages/PaymentPlans.tsx` (`isOverdue`, installment-row styling, and the pay-installment action's enabled/disabled condition).
- No current production code path **writes** the literal `'overdue'` — it is read-only/defensive handling of pre-existing/legacy data, consistent with the module's own docstring.

---

## 9. Root-cause classification

**Case A — Stale test.** All required conditions are satisfied:

- Current implementation is internally consistent (`overdueInstallmentWhere` and `isInstallmentOverdue` agree with each other and with the frontend's parallel `isOverdue`).
- Schema (`schema.prisma:1041` comment), API/route consumers (`dashboard.ts`, `financeDashboard.ts`), and frontend (`PaymentPlans.tsx`) all recognize the literal `overdue`.
- A later, deliberate commit (`81323a88`, with its own descriptive fix message and its own added regression tests in a sibling file) established `overdue`-literal handling as the intended contract — not an accident or unreviewed side effect.
- Reverting production to pending-only would be a regression: it would re-exclude legacy `'overdue'`-status installments from the dashboard/finance totals, exactly the bug `81323a88` fixed.
- The failing test's own docstring text ("nothing ever sets status to the literal string 'overdue'") is demonstrably false against current `origin/main` — contradicted by the schema comment and by `overdueReceivables.test.ts`'s own already-passing assertions of the opposite behavior.

This is not Case B (no evidence the current production behavior is a defect — it is corroborated by four independent sources: schema, two live routes, and the frontend) and not Case C (no ambiguity — every source agrees with each other, only the one stale test file disagreed).

---

## 10. Selected fix and rationale

Updated exactly `server/src/tests/overdueInstallments.test.ts`:

1. Docstring (lines 6–12): removed the false "nothing ever sets status to the literal string 'overdue'" claim; replaced with an accurate description matching the module's own current docstring (legacy/persisted `'overdue'` rows exist in production; cites commit `81323a88`).
2. Assertion 1 (`overdueInstallmentWhere` status shape): changed `assert.equal(where.status, 'pending')` to `assert.deepEqual(where.status, { in: ['pending', 'overdue'] })` — asserts the exact, meaningful current where-clause shape, not a weakened truthy check.
3. Assertion 2 (`isInstallmentOverdue` with legacy status): changed the expected value from `false` to `true` for a past-due, unpaid, legacy `status='overdue'` installment, and renamed the test description to state the actual (now-correct) contract instead of the stale "never-written value" framing.

This is the smallest valid correction: it touches only the 2 failing assertions plus the docstring text that caused the original wrong expectation, changes no production/application code, and each corrected assertion still checks a specific, meaningful value (an exact object shape via `deepEqual`, and an exact boolean derived from real fixture inputs) — not a generic truthy/non-null check. No assertion was removed, skipped, or weakened; the test still has exactly 9 assertions, now all passing for the right reason.

A candidate addition (a new assertion for `where.paymentId === null`) was considered and deliberately **not** added, to keep the change to the minimum necessary to resolve the documented drift — that behavior is already covered by `overdueReceivables.test.ts`'s existing paymentId-exclusion assertions (§4 item 10).

---

## 11. Files changed

- `server/src/tests/overdueInstallments.test.ts` — the only file changed by this task (test-only; no production/application code, no schema, no migration, no CI/workflow, no Docker/Compose file).

---

## 12. Exact test commands and results

All commands run from `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-b1-overdue-installments\server`. Environment: no `DATABASE_URL`/`MINIO_*`/live-provider credentials set anywhere.

| Command | Exit | Result | Notes |
|---|---|---|---|
| `npm run test:overdue-installments` (pre-fix) | 1 | Total: 9, Passed: 7, Failed: 2 | Baseline reproduction, matches F1-003-P1's documented drift exactly |
| `npm run test:overdue-installments` (post-fix) | 0 | Total: 9, Passed: 9, Failed: 0 | Same 9 assertions, 2 corrected, 0 weakened/removed |
| `npm run test:overdue-receivables` | 0 | Results: 12 passed, 0 failed | Direct sibling coverage of the same shared module — unaffected, still green |
| `npm run test:finance` (Finance Dashboard) | 0 | Results: 25 passed, 0 failed | Consumes `overdueReceivablesAmount`; unaffected |
| `npm run test:dashboard` | 0 | Toplam: 38, Geçen: 38, Başarısız: 0 | Consumes `overdueReceivables` shape; unaffected |
| `npm run typecheck` | 0 | `tsc --noEmit` clean | Only a `.ts` test file changed; run for verification even though no production TS changed |
| `git diff --check` | 0 | clean | No whitespace/conflict-marker issues |

---

## 13. Pass/fail/skip counts and durations

- `test:overdue-installments`: 9/9 passed, 0 failed, 0 skipped, ~1–2s.
- `test:overdue-receivables`: 12/12 passed, 0 failed, 0 skipped.
- `test:finance`: 25/25 passed, 0 failed, 0 skipped.
- `test:dashboard`: 38/38 passed, 0 failed, 0 skipped.
- `server:test:non-disposable` (68 members): exit `0`; two independent runs both completed in ~65–66s (66193ms measured on the second, timed run) and produced byte-identical output logs (`diff` confirmed). No `✗`/`Failed: [1-9]`/`Başarısız: [1-9]`-style failure marker appears anywhere in the ~4,089-line combined log (only 2 matches for the failure-marker regex, both `✗ 0` — zero-failure summary lines, not actual failures). A best-effort partial parse of "N passed" style summary lines found no failures among the 44 recognized `"X passed, 0 failed"` lines, 7 `"Total: N Passed: N Failed: N"` lines (all `Failed: 0`), and 9 `"Toplam: ..."` lines — consistent with, not contradicting, the exit-0 result. As in F1-003-P1's own evidence, this repository's hand-rolled test runners do not expose one single exact global total across all 68 members; no total is fabricated here.
- `test:overdue-installments` runs **last** in the `server:test:non-disposable` chain (an ordering decision made by F1-003-P1, unchanged by this task) — its final `Total: 9  Passed: 9  Failed: 0` block is the literal tail of both aggregate log files, directly confirming the fix took effect inside the full chain, not just in isolation.

---

## 14. Non-disposable aggregate result

Command: `npm run server:test:non-disposable --silent`
Working directory: `server/`
Environment: no `DATABASE_URL`/`MINIO_*` set.
**Exit code: 0** (previously 1, sole cause the `overdueInstallments.test.ts` drift). All 68 members ran (chain did not halt early). Re-run twice for determinism confirmation; both runs exit 0 with identical combined output.

This satisfies the task's stated expected outcome after a valid fix: exit code 0, all 68 members execute, zero known failures, no test removed, no assertion weakened, no exit code swallowed (`&&`-chained throughout, unchanged from F1-003-P1).

---

## 15. Typecheck and validation

- `npm run typecheck` (runs `npx prisma generate && tsc --noEmit`) in `server/`: exit `0`, no errors. Run because the changed file is `.ts`, even though it is test-only, not production code.
- `git diff --check`: exit `0`, clean.
- `server/package.json` was not modified by this task — no JSON validation needed.
- No new JSON evidence-companion file was created for this task beyond this Markdown report — none to validate.

---

## 16. Migration status

No Prisma schema change. No migration created. No migration applied. No database migration required or performed. `server/prisma/schema.prisma` was read-only (for the `PaymentPlanInstallment.status` comment, §4/§8) and not modified.

---

## 17. Backward compatibility

- **API response compatibility:** unchanged — no route/handler/DTO changed.
- **Persisted status compatibility:** unchanged — no write path touched; existing `'pending'`/`'overdue'`/`'paid'` rows behave exactly as before this task.
- **Frontend compatibility:** unchanged — `src/pages/PaymentPlans.tsx` was not touched.
- **Report/filter compatibility:** unchanged — `dashboard.ts`/`financeDashboard.ts` were not touched.
- **Existing data compatibility:** unchanged — no data migration, no backfill.
- **Backfill needed:** no.
- **Rollback restores prior interpretation safely:** yes — reverting this task's single commit restores the previous (drifted) test file exactly; production behavior is completely unaffected either way, since production code was never changed.

---

## 18. Financial behavior impact

None. No production/application financial-calculation code was changed. The dashboard "Gecikmiş Tahsilatlar" card, Finance Dashboard `overdueAmount`/`overdueInstallments` fields, and `/payment-plans/overdue-collections` unified view all continue to run the exact same `overdueInstallmentWhere`/`isInstallmentOverdue` logic as before this task — this task only made the test file agree with that already-deployed behavior.

---

## 19. Tenant-isolation impact

No Prisma query was changed by this task. `overdueInstallmentWhere` (unchanged) still nests `plan: { clinicId: ... }` (or `plan: { clinicId: { in: [...] } }`) exactly as before — confirmed unchanged by assertions 3 and 4 in the same test file (`klinik kapsamı nested plan.clinicId altında taşınır`, `birden fazla klinik kapsamı da plan altına doğru şekilde taşınır`), both of which passed before and after this task's edit. No cross-tenant data exposure is possible from this change because no query, route, or middleware was touched — only test-fixture expectations for an already-deployed pure function.

---

## 20. Security impact

None. No authentication, authorization, or route-handler code was touched. No secret, credential, or environment-variable handling was touched.

---

## 21. KVKK/privacy impact

None. No consent/retention/privacy code path was touched. The KVKK physical-architecture freeze boundary was not entered or modified. No personal/financial data shape changes — this task changed test *expectations* only, not any data model, serialization, or export/retention behavior.

---

## 22. Audit/logging impact

None. No `PaymentPlanInstallment` status mutation code exists in this module (it is read/filter-only), so there is no status-change audit trail to affect. No `AuditEvent`/activity-log code path was touched by this task.

---

## 23. Rollback method

A single `git revert` of this task's one commit on branch `fix/f1-003-b1-overdue-installments-drift` fully reverses it — `server/src/tests/overdueInstallments.test.ts` returns to its pre-task (drifted) state, and this evidence file is the only other change to remove (or leave, since it is purely descriptive and inert). No schema rollback, no data rollback, no deployment rollback — none of those categories were touched by this task. No production access occurred at any point.

---

## 24. Remaining risks

- The legacy/persisted `'overdue'` status literal's origin (which historical process or manual action wrote it) was not traced further than "legacy/persisted," per the production code's own docstring — this task did not investigate database history, and that investigation was out of scope.
- F1-003-P1's own broader findings (17 aggregate-chain exclusions, legacy `server:test`'s 23 silently-chained DB-required scripts, disposable-Postgres/MinIO provisioning gaps, R-070 `OPEN`) are entirely unaffected by and unresolved by this task — this task closes exactly the one `overdueInstallments.test.ts` drift and nothing else.
- `server:test:non-disposable` reaching exit 0 does not mean the full legacy `server:test` chain (77 scripts, including 23 DB-required + 1 MinIO-required members) is green or runnable in this environment — that remains F1-003-P2's scope, unchanged.

---

## 25. Explicit non-claims

This task does **not** claim: F1 complete; F1-003 complete; CI ready; disposable runtime ready; G1/G2 approved; KVKK baseline stable; R-070 closed; production deployed; production behavior verified. `server:test:non-disposable` reaching exit 0 is a **non-disposable, local-worktree** result only — it does not constitute CI readiness (no CI workflow was created or modified) and does not substitute for F1-003-P2's disposable-Postgres/MinIO provisioning work.

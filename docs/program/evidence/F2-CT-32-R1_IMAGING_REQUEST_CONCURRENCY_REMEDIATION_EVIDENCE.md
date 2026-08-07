# F2-CT-32-R1 — ImagingRequest PATCH/Cancel Atomic Concurrency Remediation — Evidence

**Phase:** F2 — Modular Boundaries and Public Contracts, Imaging Pilot — Stage 2 (item 2 of 2: `ImagingRequest` PATCH/cancel concurrency hardening only; duplicate manual/bridge ingest convergence, `OVL-01`, is explicitly out of scope for this task).
**Parent findings:** `CT-32`, `CR-03`, `BLK-02`, `FP-06`.
**ClickUp:** https://app.clickup.com/t/869ed1pvv (existing task, not duplicated).
**Type:** APPLICATION CODE + TEST + ADDITIVE EVIDENCE. No Prisma schema/migration change.
**Status:** `AGENT_COMPLETED` / `TESTS_PASSED` / PR to be opened, not merged, not deployed, not production-verified.

---

## 0. Baseline and main-CI gate evidence

```
git fetch origin --prune
git rev-parse origin/main -> 06f832c229b9f5398c7f52def16e0d37b18c6417
```

Matches the task brief's expected SHA exactly (PR #333 / F2-CT-23 merge commit, "fix(imaging): enforce LinkImagingStudy patient/request consistency").

```
gh run view 31204059995 --repo MustafaBasol/DisKlinikCRM --json headSha,status,conclusion,headBranch
-> {"conclusion":"success","headBranch":"main","headSha":"06f832c229b9f5398c7f52def16e0d37b18c6417","status":"completed"}
```

10/10 `ci-layers` jobs green (Layers 1–5, including Layer 3 disposable-PostgreSQL and Layer 4 disposable-PostgreSQL+MinIO). headSha matches origin/main exactly. Gate satisfied — proceeded to code changes only after this was confirmed.

**Worktree/branch:** fresh worktree at `.claude/worktrees/fix+f2-ct-32-imaging-request-concurrency`, branch `fix/f2-ct-32-imaging-request-concurrency`, branched from the verified `origin/main` SHA above. No CT-23 or other sibling worktree reused, read, merged, or rebased onto. F2-DOC-002 and F2-ORG-DASH-METRICS-CONTRACT worktrees were not inspected or edited (parallel-work rule).

---

## 1. Inputs read

- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` §10 (blocker decision), §14 (CT-32 characterization gate), §15 (Stage 2 = ingest convergence + this concurrency guard).
- `docs/program/evidence/F2-PREP-007-D_IMAGING_REQUEST_CONCURRENCY_EVIDENCE.md` — the original CT-32 characterization evidence (Stage 0), confirming the defect's root cause and its 100%-reproduction baseline.
- `server/src/routes/imaging.ts` — `findRequestInScope` (pre-fix: lines 197–206), `PATCH /api/imaging/requests/:id` (pre-fix: 486–527), `PATCH /api/imaging/requests/:id/cancel` (pre-fix: 529–554), `requestInclude` (404–410), the pre-existing sibling CAS guard inside `POST /imaging/studies` (`LinkImagingStudy`, `tx.imagingRequest.updateMany({ where: { id, clinicId, status: { in: ['requested','scheduled'] } }, data: { status: 'received' } })`, lines 644–653 — direct in-repo precedent for this exact fix shape).
- `server/src/services/imaging/imagingRequestTransitions.ts` (full, 47 lines) — `ALLOWED_REQUEST_TRANSITIONS`, `TERMINAL_STATUSES`, `validateRequestTransition`. **Not modified** — transition rules are unchanged; only the write's atomicity changed.
- `server/src/services/security/securityIncidentService.ts`'s `applyLifecycleTransition()` (lines 265–329) and `server/src/routes/platformSecurityIncidents.ts`'s `HTTP_STATUS_BY_LIFECYCLE_ERROR`/`concurrent_transition` (lines 199–213) — the repo's own established compare-and-set pattern and conflict-code convention for an unrelated but structurally identical status-machine race, adopted here rather than inventing a new mechanism or code.
- `server/src/routes/inventory.ts` (`SELECT ... FOR UPDATE` + `updateMany` stock-guard pattern, lines ~265–494) — read and considered, not used (see §6, alternatives rejected).
- `server/prisma/schema.prisma` — `ImagingRequest` model (lines 2770–2795): confirmed `status` is a plain `String` column, no `version`/`lockVersion` column exists. No schema change made or needed.
- `server/src/schemas/index.ts` — `imagingRequestUpdateSchema` (`status` optional), confirming the `data.status !== undefined` discriminator used below is correct.
- `server/src/tests/imagingRequestConcurrencyCharacterization.test.ts` (CT-32, F2-PREP-007-D) and `server/src/tests/dbVerification/dbVerificationHarness.ts` (fixture builders, reused unmodified).
- `docs/program/evidence/F2-PREP-007-D_IMAGING_REQUEST_CONCURRENCY_EVIDENCE.md` for the CT32_ROUNDS default-round-count history.

**Source-scope discipline:** targeted reads only (imaging.ts's PATCH/cancel handlers and direct dependencies, the transitions service, the two structurally-identical CAS precedents). No new source root touched. `imagingRequestTransitions.ts` was read but not modified.

---

## 2. Root cause (confirmed by source read, not assumed)

Pre-fix, both `PATCH /api/imaging/requests/:id` and `PATCH /api/imaging/requests/:id/cancel`:

1. Read the row via a tenant-scoped `findFirst` (`findRequestInScope`, `imaging.ts:197-206`) — an in-memory snapshot.
2. Validate the requested transition against that snapshot (`validateRequestTransition`, synchronous, no DB re-check).
3. Call `prisma.imagingRequest.update({ where: { id }, data })` — the `where` clause is `{ id }` only. No `SELECT ... FOR UPDATE`, no `$transaction`, no `WHERE status = <snapshot>` guard, no version/`updatedAt`-based optimistic-lock column.

Two concurrent requests that both read `status: 'requested'` before either commits its write both pass `validateRequestTransition('requested', X)` (both `'scheduled'` and `'cancelled'` — and, more generally, every non-conflicting pair of targets — are independently reachable from `'requested'` per `ALLOWED_REQUEST_TRANSITIONS`), and both writes land — last-write-wins, silently, no re-validation, no 409. `docs/program/evidence/F2-PREP-007-D_IMAGING_REQUEST_CONCURRENCY_EVIDENCE.md` independently reproduced this on 30/30 rounds across two full runs (152/152 and 153/153 assertions passing on the *characterization*, i.e. the defect reproducing every time).

---

## 3. Chosen atomic design

Compare-and-set (CAS) via `prisma.imagingRequest.updateMany`, with the exact status value read encoded in the write's `WHERE` clause — the same pattern already established in this repo by `securityIncidentService.ts`'s `applyLifecycleTransition()` and by this very file's own pre-existing `LinkImagingStudy` guard. No schema/migration: `status` (a plain `String` column, already present) serves as the natural version proxy for this state machine — every legal transition changes it, and `TERMINAL_STATUSES` are dead ends, so an exact-match precondition is sufficient without a dedicated version/lock column.

`server/src/routes/imaging.ts`:

- `findRequestInScope` (197–206) now returns `{ request, scope }` instead of just `request`, so the CAS write can reuse the exact same tenant-scope filter already validated for the read (`Every read/write used for the decision must remain properly scoped`).
- `PATCH /api/imaging/requests/:id` (487–550): when the payload touches `status` (`data.status !== undefined` — covers both an actual transition and an idempotent same-value resubmission, both of which read/write the `status` column), the write becomes `prisma.imagingRequest.updateMany({ where: { id, status: existing.status, ...scope }, data })`. A payload that does **not** touch `status` (e.g. `priority`-only) keeps the prior unconditioned single `update()` — it isn't part of the state-machine race CT-32 characterizes, and guarding it would be scope creep beyond the narrowest fix. If `cas.count !== 1`, the row's status changed between read and write — respond `409 { error, code: 'concurrent_transition' }` instead of writing. On success, one follow-up scoped `findFirstOrThrow` builds the `include`d response body (`updateMany` doesn't return rows).
- `PATCH /api/imaging/requests/:id/cancel` (552–591): identical CAS guard; the write always touches `status`, so the guard always applies. The pre-existing `validateRequestTransition(existing.status, 'cancelled')` check (already-terminal → `409 already_terminal`) still runs first and is unchanged — it is what preserves cancel's existing **non-idempotent** contract (a second, sequential cancel of an already-cancelled row still gets `already_terminal`, never `200`), before the CAS guard is even reached.

No process-local mutex, no serializable transaction, no `SELECT ... FOR UPDATE`, no sleeps, no hidden-conflict retry loop. Postgres's own row-level locking during the single `UPDATE` statement is what actually serializes the two writers; the `WHERE`-clause precondition is what turns "second writer landed" into "second writer's predicate no longer matches, so it writes nothing."

---

## 4. Alternatives considered and rejected

1. **`SELECT ... FOR UPDATE` inside an interactive `$transaction`** (the pattern `inventory.ts` uses for `InventoryItem`) — rejected as unnecessarily heavier than a single conditional `updateMany` for a two-writer, single-column state-machine race with no multi-step invariant beyond `status` itself; also inconsistent with the simpler precedent already used for this exact model (`LinkImagingStudy`) and for the structurally-identical `SecurityIncident` lifecycle.
2. **Adding a `version`/`lockVersion` integer column** — rejected per the task's explicit instruction not to introduce a migration without proving no migration-free design exists. `status` already serves as an adequate version proxy for this specific state machine (monotonic-enough: every transition changes it, terminal states are dead ends); no evidence a plain-string CAS is insufficient.
3. **Postgres advisory lock (`pg_advisory_xact_lock`) keyed by request id** — rejected: adds blocking/serialization overhead not needed here, and is not this repo's idiom for a one-entity-one-status-machine race (advisory locks here are used for slot-booking — many-candidates-one-slot, a different problem shape).
4. **Automatic retry-on-conflict** (re-read, re-validate, re-attempt the write) — rejected per explicit task instruction; the loser must surface a controlled conflict to the caller, not silently retry and possibly succeed on a revalidated basis, which would hide the conflict rather than report it.
5. **Wrapping the CAS write + follow-up read in an explicit `prisma.$transaction`** — considered (mirrors `securityIncidentService.ts`'s own style) but rejected as unneeded scope: a single `UPDATE` statement already row-locks for its own duration under Postgres regardless of an enclosing transaction, and no second write (e.g. an audit-row insert) needs to roll back together with the status update in this route — audit/activity writes already happen non-transactionally, after the fact, in the pre-fix code, and that is unchanged here.
6. **Guarding every PATCH regardless of whether the payload touches `status`** — considered, rejected as broader than the characterized defect: a `priority`-only or `notes`-only PATCH racing a concurrent status transition never touches the `status` column, so it cannot clobber it; adding a precondition there would reject legitimate, non-conflicting concurrent writes for no correctness benefit.

---

## 5. API conflict semantics (contract impact)

- New failure mode, **only reachable under genuine concurrency**: `409 { error: string, code: 'concurrent_transition' }` on both `PATCH /api/imaging/requests/:id` and `PATCH /api/imaging/requests/:id/cancel`, reusing the exact code name/convention already established by `platformSecurityIncidents.ts`'s `HTTP_STATUS_BY_LIFECYCLE_ERROR` map for the same race shape in a different domain (`SecurityIncident` lifecycle) — not invented for this task.
- Existing `409 { error, code: 'invalid_transition' | 'already_terminal' }` (from `validateRequestTransition`) is **unchanged** in every case that doesn't involve a race — same trigger conditions, same messages, same codes.
- Successful-response shape (`200`, `include: requestInclude`) is **unchanged**.
- Route paths, authorization roles (`IMAGING_CLINICAL_ROLES`), and tenant-scoping semantics are **unchanged**.
- Non-racing callers (the overwhelming majority of real traffic — one client, one in-flight mutation per request) observe **zero behavior change**: same inputs, same outputs, same status codes, same response bodies.

---

## 6. Files changed

- `server/src/routes/imaging.ts` — `findRequestInScope`, PATCH handler, cancel handler (see §3). No new imports.
- `server/src/tests/imagingRequestConcurrencyCharacterization.test.ts` — **revised** (not deleted) per the F2-PREP-006-E contract's own instruction for CT-32: now asserts the corrected, regression-proof behavior. The original defect-reproducing assertions are preserved in the file's own header-comment HISTORY section and in git history.
- `server/src/tests/imagingRequestConcurrencyGuard.test.ts` — **new**. Covers PATCH-vs-PATCH (A), CANCEL-vs-CANCEL (C, both the race and the pre-existing sequential non-idempotent contract), different-rows-same-clinic (D), different-clinics/orgs (E), and tenant-isolation regression checks (unauthorized same-org clinic, cross-org clinic, non-existent id — all 404, indistinguishable).
- `server/package.json` — added `test:imaging-request-concurrency-guard` script; appended the new guard-suite file to the existing `test:imaging-characterization` aggregate (so it runs under `server:test:disposable-db`/CI Layer 3 automatically, same as CT-32 already did).
- This file (additive evidence doc).

No frontend file changed (no evidence the frontend depends on the exact pre-fix conflict shape; the only behavior change is a new, previously-impossible-to-reach `409` under genuine concurrent racing). No Prisma schema/migration file changed.

---

## 7. Tests — exact commands and results

All run from `server/` unless noted, against a real disposable PostgreSQL (Docker, digest-pinned `postgres:16-alpine`, provisioned via this repo's own `scripts/test-runtime/orchestrator.ts` — `npm run test:runtime:postgres` from repo root, same mechanism CI's Layer 3 job uses).

```
npm run typecheck
-> npx prisma generate && tsc --noEmit
-> Prisma Client generated (v7.8.0); tsc --noEmit: 0 errors.
```

```
npm run test:imaging
-> 103 passed, 0 failed
```
(Mock-based source-regression suite; no live DB required — unaffected by this change, run to confirm no regression to the mocked `validateRequestTransition`/schema/route-shape assertions it covers.)

```
npm run test:runtime:postgres -- --summary-file=<summary>.json
```
(from repo root — provisions disposable Postgres, runs `server:test:disposable-db`, tears down.) Orchestrator outcome:
```json
{
  "migration": { "code": 0, "step": "ok" },
  "test": { "scriptName": "server:test:disposable-db", "code": 0 },
  "cleanup": { "success": true, "errors": [] },
  "outcome": { "exitCode": 0, "reasons": ["tests passed", "cleanup succeeded"] }
}
```

Relevant sub-suite results from that run (`server:test:disposable-db` → `test:imaging-characterization` → ...):

```
imagingCharacterizationAuthShape:                                    36 passed, 0 failed
Imaging-Characterization-Tenant-Lifecycle:                           29 passed, 0 failed
imagingCharacterizationIngestStorage:                                13 passed, 0 failed
CT-32 (imagingRequestConcurrencyCharacterization.test.ts, REVISED):  154 passed, 0 failed
  -> 30/30 rounds classified EXACTLY_ONE_WINNER; 0/30 BOTH_SUCCESS_SILENT_CLOBBER; 0/30 UNEXPECTED
  -> all 30 losing responses carried code 'concurrent_transition' (genuine read/write overlap every round,
     consistent with F2-PREP-007-D's own 100%-overlap evidence for this exact harness)
F2-CT-32-R1 guard suite (imagingRequestConcurrencyGuard.test.ts, NEW): 70 passed, 0 failed
  -> A (PATCH vs PATCH, 10 rounds): exactly one winner every round, loser always a known conflict code
  -> C (CANCEL vs CANCEL, 10 rounds + 1 sequential): exactly one winner every round; sequential double-cancel
     still 409 already_terminal (idempotency contract preserved, not silently made idempotent-success)
  -> D (different rows, same clinic): both succeed concurrently, no interference
  -> E (different clinics/orgs): both succeed concurrently, no interference; tenant-isolation regression
     checks (unauthorized same-org clinic / cross-org clinic / non-existent id) all 404, indistinguishable
Imaging-Lifecycle-Facade:                                             34 passed, 0 failed
ImagingStudyRequestPatientConsistency-F2-CT-23:                       12 passed, 0 failed   <- CT-23 regression, preserved
DetectImagingStudyRequestPatientMismatch-F2-CT-23-R1:                  7 passed, 0 failed
```

Every other member of `server:test:disposable-db` (KVKK-HIGH-006 DB suites, appointment-request-conversion-atomicity, patient-emergency-contacts concurrency, patient-medical-history-version-concurrency, medical-condition-catalog-seed-idempotency, external-calendar-outbound-sync-atomicity, platform-admin-password-recovery, meta-whatsapp-post-booking, whatsapp-public-api-explicit-clinic-binding) also passed with 0 failures in the same run — full aggregate exit code 0.

```
git diff --check
-> (clean, exit 0)
```

```
npm run guardrail:scan
```
Report-only, advisory (per its own `tenantScopeDisclaimer`); this task's diff adds **zero new import statements** to `imaging.ts` (confirmed: `git diff -- server/src/routes/imaging.ts | grep import` is empty) and touches no other scanned-root file, so it contributes nothing new to the pre-existing, whole-repo baseline-drift count the scan reports (846 new / 193 existing / 1 resolved against the `F2-GUARDRAIL-PREP-010-A` baseline — unrelated to this change, not introduced or altered by it, not baselined/allowlisted by this task).

---

## 8. Disposable PostgreSQL evidence

```
docker ps --filter name=nmtest
CONTAINER ID   IMAGE          STATUS         PORTS                       NAMES
561ac3408a54   57c72fd2a128   Up (running)   127.0.0.1:51401->5432/tcp   nmtest-pg-postgres-20260807t191407z-5e3efea9-28452
```

Run id `20260807T191407Z-5e3efea9-28452`, profile `postgres`, database `nmtest_postgres_20260807t191407z_5e3efea9_28452`. Provisioned and torn down entirely through the repo's own `scripts/test-runtime/orchestrator.ts` (the same mechanism `.github/workflows/ci-layers.yml`'s Layer 3 job invokes as `npm run test:runtime:postgres`) — no manual container management, no hand-rolled migration step, digest-pinned `postgres:16-alpine` image. `cleanup.success: true`, zero cleanup errors.

---

## 9. Migration status

**None.** `ImagingRequest.status` remains a plain `String` column (confirmed against `schema.prisma`, unchanged by this task). The CAS guard uses the existing column as its own version proxy; no `version`/`lockVersion`/`updatedAt`-based optimistic-lock column was added or is required.

---

## 10. Tenant isolation analysis

- The CAS write's `WHERE` clause includes `...scope` (the identical `ClinicIdScopeWhere` object already validated for the read by `findRequestInScope`) in addition to `id` and `status` — defense-in-depth beyond what's strictly required (the row's `clinicId` never changes), satisfying "every read/write used for the decision must remain properly scoped."
- `findRequestInScope`'s 404-for-not-found-or-out-of-scope behavior is **unchanged** — still a single tenant-scoped `findFirst`, still no unscoped find-by-id anywhere in either handler.
- New test coverage (`imagingRequestConcurrencyGuard.test.ts`, §7/§3): same-clinic valid mutation (200, control case), unauthorized same-org clinic (404), cross-org clinic (404), non-existent request id (404) — and an explicit assertion that all three negative cases produce **identical** status code and response body, preserving "cross-tenant and non-existent behavior must remain indistinguishable."
- Concurrent mutations on different rows in the same clinic, and on rows in different clinics/organizations, do not block or interfere with each other (scenarios D/E) — the CAS guard is per-row and per-connection; no cross-row or cross-tenant lock is taken.

---

## 11. KVKK/security impact

None. No new PII/PHI field is read, written, or logged. `auditImaging`'s metadata (`fromStatus`/`toStatus`/`modality`) is unchanged in shape and content. The new `409 concurrent_transition` response body contains no patient-identifying information — same shape discipline as the existing `invalid_transition`/`already_terminal` responses it sits alongside.

---

## 12. Cross-domain impact

Zero new imports added to `imaging.ts` or any other file (confirmed, §7). No new cross-domain edge introduced. Architecture guardrail run (report-only per its own contract); pre-existing whole-repo baseline drift is unrelated to and unaffected by this change (§7).

---

## 13. Rollback method

Plain commit/PR revert — no migration, no data backfill, no forward-only step. Reverting restores the pre-fix unconditioned `update()` calls in both handlers, `findRequestInScope`'s prior return shape, and the pre-fix (defect-characterizing) version of `imagingRequestConcurrencyCharacterization.test.ts` (recoverable from git history even without a revert, since the revision preserves the original assertions' intent in its header comment). `imagingRequestConcurrencyGuard.test.ts` and the `server/package.json` script additions would simply be removed by the same revert.

---

## 14. Status matrix

| Field | Status |
|---|---|
| AGENT_COMPLETED | yes |
| TESTS_PASSED | yes — see §7 |
| PR_OPENED | pending (opened immediately after this doc, not merged) |
| PR_CI_PASSED | pending — not yet observed |
| MERGED | no |
| DEPLOYED | no |
| PRODUCTION_VERIFIED | no |

---

## 15. Next Stage-2 task

Per `F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` §15 (Stage 2), the remaining Stage-2 item is **`OVL-01`** — duplicate manual/bridge study-ingest convergence (`ingestImagingStudyCore()`, §8 of the contract). Explicitly **not** performed by this task (materially overlaps `imaging.ts`; scheduled as a separate PR to reduce parallel-merge/conflict risk, per this task's own brief). Not started, not authorized to start by this document.

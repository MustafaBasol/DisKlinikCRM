# F2-ORG-DASH-METRICS-CONTRACT — Organization Dashboard Metrics Public Read Contracts

Task: F2-ORG-DASH-METRICS-CONTRACT — Organization Dashboard Metrics Public Read Contracts
Phase: F2 — Modular Boundaries and Public Contracts
ClickUp: https://app.clickup.com/t/869efhdyb
Type: modular-monolith refactoring (new domain-owned service modules + route composition change). No microservice extraction, no schema/migration change, no API response redesign.

## 1. Baseline

| Fact | Value |
|---|---|
| `git fetch origin --prune` | run at task start; no new commits (`origin/main` unchanged across the session) |
| `git rev-parse origin/main` | `06f832c229b9f5398c7f52def16e0d37b18c6417` |
| Worktree | `E:\Ek Gelir\Siteler\DisKlinikCRM-f2-org-dash-metrics-contract` |
| Branch | `refactor/f2-org-dashboard-metrics-public-contracts` |
| CodeGraph | Not used for this session — no `.codegraph/` MCP tool available; targeted `Read`/`git show`/`grep` against the exact base SHA was used instead, scoped to `organizationDashboard.ts` and its direct dependency graph. |

**Note on session provenance:** this worktree and branch already contained complete, uncommitted work (route diff + 4 new service files + 1 DB-verification test file + a `domain-map.json` update) when this session began, matching this exact task's branch name and scope. That work was reviewed in full against this brief before being trusted, verified by running every required test suite and both guardrail scans from a clean stash of the base SHA, and is the basis of this evidence document and the commit/PR produced by this session.

## 2. Accepted ADR decision (reconfirmed, not relitigated)

`ADR-F2-ORG-DASH-OWNERSHIP` (`docs/architecture/f2/ADR-F2-ORG-DASH-OWNERSHIP.md`) is **accepted**. `server/src/routes/organizationDashboard.ts` is owned by `core-org-clinic-membership` (Option A, already implemented by PR #331 / `F2-ADR-ORG-DASH-002`). The ADR's §9 follow-up 1 names this exact task, `F2-ORG-DASH-METRICS-CONTRACT`, as the mechanism to reach the ADR's declared target end-state (Option D): the route becomes a composition shell over accepted public read contracts for the four cross-domain metric families it previously read directly. This task does not reopen or modify the ownership decision — `organizationDashboard.ts`'s domain-map entry remains `core-org-clinic-membership`, and the file is not physically relocated.

## 3. Baseline direct-access inventory (exact count, not assumed)

Read in full from `git show 06f832c:server/src/routes/organizationDashboard.ts`. The handler contained **13 Prisma operations** inside the per-clinic `Promise.all`, plus 2 `prisma.clinic.findMany` calls outside it. Of the 13, **11 are foreign-domain** (Appointment ×5, Patient ×2, TreatmentCase ×2, Payment ×2); the remaining 2 (`prisma.userClinic.count` ×2) and both `prisma.clinic.findMany` calls are **in-domain** (`Clinic` and `UserClinic` are both owned by `core-org-clinic-membership`, the route's own domain) and are correctly left untouched.

| # | Model | Operation | Purpose / metric | Tenant/org/clinic predicate | Date predicate | Return shape | Target owner | Existing contract before this task |
|---|---|---|---|---|---|---|---|---|
| 1 | `Appointment` | `count` | `todayAppointments` | `clinicId: clinic.id` | `startTime` in `[today, tomorrow)`, `status != cancelled` | `number` | `clinical-appointments-availability` | none |
| 2 | `Appointment` | `count` | `appointments` (period total, non-cancelled) | `clinicId: clinic.id` | `startTime` in `[dateRange.from, dateRange.to]`, `status != cancelled` | `number` | `clinical-appointments-availability` | none |
| 3 | `Appointment` | `count` | `completedAppointments` | `clinicId: clinic.id` | `startTime` in range, `status = completed` | `number` | `clinical-appointments-availability` | none |
| 4 | `Appointment` | `count` | `cancelledAppointments` | `clinicId: clinic.id` | `startTime` in range, `status = cancelled` | `number` | `clinical-appointments-availability` | none |
| 5 | `Appointment` | `count` | `noShowCount` (used to derive `noShowRate`) | `clinicId: clinic.id` | `startTime` in range, `status = no_show` | `number` | `clinical-appointments-availability` | none |
| 6 | `Patient` | `count` | `newPatients` | `primaryClinicId: clinic.id`, `deletedAt: null` | `createdAt` in range | `number` | `clinical-patients` | none |
| 7 | `Patient` | `count` | `totalPatients` (all-time) | `primaryClinicId: clinic.id`, `deletedAt: null` | none (all-time) | `number` | `clinical-patients` | none |
| 8 | `TreatmentCase` | `count` | `activeTreatmentPlans` (all-time) | `clinicId: clinic.id` | none (all-time) | `number` | `clinical-treatment-cases` | none |
| 9 | `TreatmentCase` | `count` | `completedTreatments` | `clinicId: clinic.id`, `stage: completed` | `closedAt` in range | `number` | `clinical-treatment-cases` | none |
| 10 | `Payment` | `aggregate` (`_sum.amount`) | `revenue` / `collectedPayments` | `clinicId: clinic.id`, `paymentStatus in [paid, partial]` | `paidAt` in range | `number` (via `Number(_sum.amount) \|\| 0`) | `clinical-basic-payments` | none |
| 11 | `Payment` | `aggregate` (`_sum.amount`) | `outstandingBalance` (all-time pending) | `clinicId: clinic.id`, `paymentStatus: pending` | none (all-time) | `number` (via `Number(_sum.amount) \|\| 0`) | `clinical-basic-payments` | none |
| — | `UserClinic` | `count` | `staffCount` | `clinicId: clinic.id`, `isActive: true` | n/a | `number` | `core-org-clinic-membership` (in-domain, unchanged) | n/a |
| — | `UserClinic` | `count` | `doctorCount` | `clinicId: clinic.id`, `isActive: true`, `role: DENTIST` (case-insensitive) | n/a | `number` | `core-org-clinic-membership` (in-domain, unchanged) | n/a |
| — | `Clinic` | `findMany` (×2) | scope resolution + clinic listing | `organizationId: orgId` (+ `id: {in: scopeClinicIds}` for the second call) | n/a | `{id,name,slug,status,address}[]` | `core-org-clinic-membership` (in-domain, unchanged) | n/a |

No existing suitable public contract existed for any of the 11 foreign-domain operations prior to this task (confirmed by the ADR itself, §9: "The required contracts do not exist today").

## 4. Public contracts created

Four new same-process, purpose-built read contracts, one per foreign domain, each named for its domain and consumed only by `organizationDashboard.ts` today:

| Contract module | Owner domain (domain-map) | Export | Input | Output DTO |
|---|---|---|---|---|
| `server/src/services/appointments/organizationAppointmentMetrics.ts` | `clinical-appointments-availability` | `getOrganizationAppointmentMetrics(clinicId, range)` | `clinicId: string`, `range: {from,to}` | `OrganizationAppointmentMetrics { todayAppointments, appointments, completedAppointments, cancelledAppointments, noShowRate }` |
| `server/src/services/patientOrganizationMetrics.ts` | `clinical-patients` | `getOrganizationPatientMetrics(clinicId, range)` | `clinicId: string`, `range: {from,to}` | `OrganizationPatientMetrics { newPatients, totalPatients }` |
| `server/src/services/treatmentCaseOrganizationMetrics.ts` | `clinical-treatment-cases` | `getOrganizationTreatmentCaseMetrics(clinicId, range)` | `clinicId: string`, `range: {from,to}` | `OrganizationTreatmentCaseMetrics { activeTreatmentPlans, completedTreatments }` |
| `server/src/services/paymentOrganizationMetrics.ts` | `clinical-basic-payments` | `getOrganizationPaymentMetrics(clinicId, range)` | `clinicId: string`, `range: {from,to}` | `OrganizationPaymentMetrics { revenue, outstandingBalance }` |

Design properties, uniform across all four:
- **No generic dashboard/reporting module.** Each contract lives inside its owning domain's existing service area (`services/appointments/`, or `services/` for the three domains that keep flat service files today, matching existing repository placement conventions for those domains), named for its own subject matter — not a shared "dashboard service."
- **Purpose-built DTOs only.** Every export returns a small named interface; no Prisma entity, `select` result, or raw aggregate object crosses the boundary. `Payment.aggregate` results are reduced to `Number(...) || 0` before being returned, exactly as the pre-refactor inline code did.
- **No re-authorization inside the contract.** Each function takes an already-resolved `clinicId` as its first parameter and performs no role/tenant check of its own — the caller (the route) is solely responsible for producing an authorized `clinicId`. No contract accepts a raw request body/query clinic id.
- **Byte-for-byte query logic.** Every `where` predicate, `select`/`_sum` shape, and post-processing formula (the `noShowRate` rounding formula, the `Number(...) || 0` coercions) is copied unchanged from the pre-refactor handler — confirmed by direct diff (§3 above vs. §6 below).
- **No new dependency, no schema/migration change.** Each module imports only `prisma` from the existing `db.ts` (an already-accepted `core-shared-platform-infrastructure` dependency used throughout the codebase) and defines its own two small interfaces.

`domain-map.json` was updated additively (a new `provenance.corrections[]` entry plus 4 new `files` keys mapping the new service files to their owner domains); `fileCount` 249 → 253. `organizationDashboard.ts`'s own domain-map entry is unchanged (`core-org-clinic-membership`).

## 5. `organizationDashboard.ts` orchestration after refactor

The route still performs its own authorization (`authorize(['OWNER','ORG_ADMIN'])` + `canAccessOrganizationDashboard()`), its own scope resolution (`canAccessAllClinics` → all org clinics via `prisma.clinic.findMany`, else `req.user!.allowedClinicIds`), and its own clinic listing (`prisma.clinic.findMany({ where: { id: { in: scopeClinicIds }, organizationId: orgId } })`) — all in-domain, all unchanged. For each clinic in scope, it now calls the four contracts (plus its own two in-domain `UserClinic` counts) inside the same `Promise.all`, and maps their returned DTOs onto the same per-clinic response shape the pre-refactor handler produced inline. Summary aggregation (`reduce` over `clinicMetrics`) and insight selection (top/lowest revenue, top appointments, etc.) are unchanged — they operate on the composed `clinicMetrics` array exactly as before, since that array's field names and values are unchanged.

## 6. Tenant-scope propagation design

- `organizationId` boundary: unchanged — `orgId = req.user!.organizationId`, used to resolve `scopeClinicIds` and to filter the `clinics` listing query. Never passed into any contract (the contracts are clinic-scoped, not org-scoped, matching the original per-clinic query shape).
- Authorized clinic resolution: unchanged — `canAccessAllClinics` ? all active org clinics : `req.user!.allowedClinicIds`. This resolved, authorized `clinic.id` (one per iteration of the `clinics.map(...)` loop) is the *only* clinic identifier passed into any of the four contracts. No contract receives `req.query`/`req.body` directly.
- No source domain re-derives authorization from a raw JWT/default clinic — each contract is a pure `clinicId`-scoped read with no auth logic of its own, confirmed by direct read of all four files (§4).
- Inactive/unauthorized clinic handling and no-cross-org-existence-leakage: unchanged — the `clinics` listing query still filters by `organizationId: orgId`, so a spoofed `allowedClinicIds` entry from another org is filtered out before any clinic-level loop iteration exists, and therefore before any contract is ever called for it. Verified directly by the new DB-verification test's "no cross-org leakage" case (§9).

## 7. API response compatibility

No response field was renamed, removed, or added. The per-clinic row shape (`clinicId, clinicName, clinicSlug, status, address, todayAppointments, appointments, completedAppointments, cancelledAppointments, noShowRate, totalPatients, newPatients, revenue, collectedPayments, outstandingBalance, activeTreatmentPlans, completedTreatments, staffCount, doctorCount`), the `summary` object's 14 fields, and the `insights` object's 6 named clinic references are all byte-identical to the pre-refactor handler — confirmed by the unchanged `test:orgdash` unit suite (35/35, assertions untouched) and by the new DB-verification test's field-by-field assertions against a real Postgres-backed response (§9).

## 8. Direct-Prisma before/after proof

**A. Import-level (guardrail scanner).** The guardrail (`lib/edgeExtraction.ts`) is import-syntax-based and cannot see raw Prisma model access — it only sees `import` statements. Before/after scan (clean base SHA vs. this branch, both scans run from the same worktree, base state produced via `git stash`):

| Metric | Before | After | Delta |
|---|---|---|---|
| `totalFindings` | 1,039 | 1,047 | +8 |
| `newFindings` | 846 | 854 | +8 |
| `existingFindings` | 193 | 193 | 0 |
| `errorCount` / `warningCount` | 0 / 0 | 0 / 0 | 0 |
| `filesDiscovered` | 247 | 251 | +4 (the 4 new service files) |
| Findings removed | — | — | **0** |
| Findings added | — | — | **8** |

All 8 new findings are explainable and expected, not violations:
- 4 are `organizationDashboard.ts` → each new contract module, exactly the explicit, purpose-built public-contract import this task's design rules require (e.g. `organizationDashboard.ts` importing `getOrganizationAppointmentMetrics` from `services/appointments/organizationAppointmentMetrics.ts`, `ownerDomain: clinical-appointments-availability`).
- 4 are each new contract module → `db.ts` (`ownerDomain: core-shared-platform-infrastructure`), the same universal Prisma-client import every other service file in the repository already has.

No baseline or allowlist entry was added or edited to suppress these 8 findings — they remain `baselineStatus: NEW`, correctly, since they are new edges. No existing baseline edge was removed or reclassified.

**B. Source-level (direct proof the scanner cannot provide).** `organizationDashboard.ts` was read in full after the refactor (§5, and see the diff in `git diff` for this branch) — it contains zero occurrences of `prisma.appointment.`, `prisma.patient.`, `prisma.treatmentCase.`, or `prisma.payment.`. This is additionally asserted as an executable regression test: `organizationDashboardMetricsContracts.test.ts`'s `"organizationDashboard.ts contains no direct foreign-domain Prisma model access"` case reads the file's source at test time and asserts none of those four substrings appear (passing, §9).

## 9. Tests

All runs performed in this worktree (`E:\Ek Gelir\Siteler\DisKlinikCRM-f2-org-dash-metrics-contract\server`), against this branch's working tree.

| Command | Result |
|---|---|
| `npm run typecheck` (server) | clean — `tsc --noEmit` exit 0 |
| `npm run test:orgdash` | **35/35 passed** |
| `npm run test:finance` | **25/25 passed** |
| `npm run test:dashboard` | **38/38 passed** |
| `npm run test:roles` | **142/142 passed** |
| `npm run guardrail:test` (root) | **74/74 passed** |
| `npm run guardrail:scan` (root) | before/after diff — see §8A |
| `git diff --check` | clean, exit 0 |
| `npx tsx src/tests/dbVerification/organizationDashboardMetricsContracts.test.ts` (real disposable PostgreSQL, see §10) | **13/13 passed** |

Focused-test coverage inside the new DB-verification file (13 cases) explicitly covers: each contract's exact DTO key set and values under clinic scoping and date-range filtering (including the two all-time, non-date-filtered fields, `totalPatients` and `outstandingBalance`, matching the original handler's "tüm zamanlar" behavior byte-for-byte); sibling-clinic isolation; a zero-data clinic (all four contracts return all-zero DTOs); OWNER/`canAccessAllClinics=true` seeing every clinic in-org and none cross-org; ORG_ADMIN restricted to one allowed clinic; a multi-clinic restricted user; a spoofed `allowedClinicIds` entry naming a cross-org clinic (excluded); a zero-clinic organization (`EMPTY_SUMMARY` shape); aggregation equivalence between summary totals and the sum of the composed per-clinic rows in the same response; and the source-level direct-Prisma-access proof (§8B).

`server:test:disposable-db` (root aggregate script) was not run as-is because it is a fixed, named list of 19 pre-existing scripts that does not include this new test file (it predates this task); running its member scripts would exercise unrelated code paths with no value to this task, so instead the new test file was run directly against the same class of real disposable PostgreSQL instance the aggregate targets (§10), consistent with the aggregate's own purpose.

## 10. Disposable PostgreSQL evidence

A disposable PostgreSQL 16.14 (Alpine) Docker container (`orgdash-metrics-pg`, `POSTGRES_DB=orgdash_test`, mapped to `localhost:55432`) was already running in this environment, provisioned by the same session that produced the uncommitted work this task reviewed and verified (§1 note). `npx prisma migrate status` against it showed all 72 migrations unapplied; `npx prisma migrate deploy` applied all 72 successfully (exit 0, "All migrations have been successfully applied"). `organizationDashboardMetricsContracts.test.ts` was then run directly against this instance: **13/13 passed** (§9), including the OWNER/ORG_ADMIN/multi-clinic/cross-org/zero-data/aggregation-equivalence/direct-Prisma-isolation cases enumerated above, using real `prisma.appointment.createMany` / `prisma.treatmentCase.createMany` / `prisma.payment.createMany` fixture rows and the real route handler (`getHandlerOnly(organizationDashboardRouter, 'get', '/organization/dashboard')`), not mocks.

## 11. Migration status

**None.** No `prisma/schema.prisma` change, no new migration file. Confirmed by `git status`/`git diff` scope (§12) and by `npm run typecheck` (server) passing cleanly against the existing generated Prisma client.

## 12. Security / KVKK impact

No new patient-level PII is exposed. Every contract returns only aggregate counts/sums (`number`), never a Prisma entity or per-record field — confirmed by each contract's DTO interface (§4) and by direct read of all four files' `return` statements. The patient contract in particular (`patientOrganizationMetrics.ts`) returns only `{ newPatients, totalPatients }`; no patient name, contact info, or other KVKK-governed field is read past what the original `prisma.patient.count(...)` calls already touched (a `count`, not a `select`, never materializes row data). No log statement in any of the four new files references a patient, appointment, treatment case, or payment identifier — each file's only side effect is its `prisma.*.count`/`aggregate` calls and their return.

## 13. Files changed

- `server/src/routes/organizationDashboard.ts` (modified — 4 new imports, per-clinic query block replaced with contract composition, response shape unchanged)
- `server/src/services/appointments/organizationAppointmentMetrics.ts` (new)
- `server/src/services/patientOrganizationMetrics.ts` (new)
- `server/src/services/treatmentCaseOrganizationMetrics.ts` (new)
- `server/src/services/paymentOrganizationMetrics.ts` (new)
- `server/src/tests/dbVerification/organizationDashboardMetricsContracts.test.ts` (new)
- `scripts/architecture-guardrail/config/domain-map.json` (modified — additive `provenance.corrections[]` entry + 4 new `files` keys; `fileCount` 249 → 253)
- `docs/program/evidence/F2-ORG-DASH-METRICS-CONTRACT_PUBLIC_READ_CONTRACTS.md` (this file, new)

No unrelated route/service file was touched.

## 14. Rollback

Simple PR/commit revert — no migration to roll back. Reverting restores `organizationDashboard.ts` to its inline-Prisma form and removes the 4 new service files and the domain-map entries; no other file depends on the new contracts today (each has exactly one caller, `organizationDashboard.ts`).

## 15. Status

`AGENT_COMPLETED` / `TESTS_PASSED` — PR to be opened against `main`, **not merged**.

## 16. Remaining cross-domain debt

None for this route's four ADR-named metric families — all four are now closed. Not addressed by this task, and out of scope: the pre-existing route-level test gaps noted by `F2-ADR-ORG-DASH-002`'s evidence (no HTTP-level `403`/`400`/`500` assertions in the pre-existing `test:orgdash` unit suite; this task's new DB-verification file does add real route-level HTTP-shaped coverage for the 200-path scenarios listed in §9, but does not add 403/400/500 coverage, which was not in this task's scope). Guardrail blocking enforcement remains unauthorized and unchanged.

## 17. Exact next task

None named by this task's authorizing brief. The ADR's own remaining follow-ups (`ARCHITECTURE_DECISIONS.md` registry-number assignment; the ~88 pre-classified-but-formally-`NEW` guardrail findings; the `callerSymbol` baseline match-key limitation) are unaffected by this task and remain owned by their originating program-control threads.

# F2-GUARDRAIL-PREP-010-C — Reference Public-Contract Pattern Inventory

**Phase:** F2 — Modular Monolith Guardrails.
**Type:** Evidence-only. No application/schema/migration/CI/package/shared-program-control file touched by this task.
**Parallel wave:** runs alongside F2-IMPL-001-A-R2, PREP-010-A, PREP-010-B. This task creates only the two files listed under Deliverables; it does not edit `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, any `F2-phase` file, or `docs/program/evidence/README.md`.
**Status:** `AGENT_COMPLETED` / `EVIDENCE_VALIDATED` / `REVIEW_THREADS_RESOLVED` / `PR_CI_PASSED` / `PR_OPENED_AWAITING_PARALLEL_WAVE_CONSOLIDATION`.
**Merge safe:** No — until this correction pass, final-head CI, and parallel-wave consolidation review are all complete.
**Deployment safe:** N/A — documentation-only; no deployable artifact.
**Revision:** R1 (precision-correction pass — see the "Correction (R1)" callouts throughout, plus §4, §10, and §11, which are new in this revision).

---

## 1. Pre-edit gate

- Root `AGENTS.md` read: MVP-scoped clinic CRM; explicitly *not* a full EHR; security rules require RBAC, audit logs, data minimization, GDPR-friendly export/deletion.
- F0 module/domain map read: `docs/program/MODULE_MAP.md` (repository-evidence-verified domain ownership map, F0-003). Relevant rows used below: Treatment Cases (`elevated`/`partially bounded`), Privacy/Consent/Retention (`regulatory/tenant-critical`/`mixed`), Reporting/Analytics (`normal`/`shared/ambiguous`), Imaging — Server Ingest and Viewer (`elevated`/`mixed`). MODULE_MAP.md explicitly states `server/src/modules`/`server/src/platform`/`public.ts` contract implementation was **not** performed by F0 and remains target structure only.
- Accepted F2 boundary documents read: `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (§9: `F2-CC-14`/`ImagingLifecyclePort` **accepted and revised**, 4-method slice).
- Merged `F2-PREP-009` read: `docs/program/architecture/F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md`. **Correction to this task's own briefing:** this document's own header records its status as `PROPOSED`, and `docs/program/NORAMEDI_MASTER_TRACKER.md`'s most recent entries confirm **`F2-PREP-009` remains `PROPOSED`, not merged/accepted** — it is a merged *documentation file* (the `.md`/`.json` pair landed on `main` via PR #307), but the *contract it proposes* has not received program-owner acceptance. This distinction matters for §7/§9 below and is carried into the JSON as `f2Prep009Status: "PROPOSED_DOCUMENT_MERGED_CONTRACT_NOT_ACCEPTED"`.
- Relevant ADRs read: `docs/architecture/adr-foundation-review.md`, `docs/program/ARCHITECTURE_DECISIONS.md` (ADR-001/ADR-015 context for domain boundaries; no ADR specifically governs a `public.ts` contract shape yet).
- Current tracker read: `docs/program/NORAMEDI_MASTER_TRACKER.md` (latest entries on F2-PREP-009/PR #304/PR #307 reconciliation history).

## 2. Baseline and isolation

- Fetched `origin/main`; baseline commit: **`6f539b237019945443afe6156f9fc2a9fe32ffa4`** (merge commit for PR #312, "Merge pull request #312 from MustafaBasol/feature/us-01-1-p1-medical-history-foundation").
- Fresh isolated worktree created directly from `origin/main` at that SHA, new branch `docs/f2-guardrail-prep-010-c-reference-contracts`. Working tree confirmed clean (`git status --porcelain=v1` empty) immediately after creation. The repository's primary working tree (a separate, unrelated in-progress branch) was never read from or written to for any evidence in this document — every candidate below was re-verified directly against this task's own isolated worktree at the baseline SHA (or, for the Imaging candidate, against PR #304's own remote head, fetched read-only into the same local object store and inspected via `git show`, never checked out/merged).
- Task-ID uniqueness confirmed: `grep -rl "F2-GUARDRAIL-PREP-010-C" docs/` returned no matches before this task's own files were created; `git ls-remote --heads origin | grep -i guardrail-prep-010` returned no existing branch.

## 3. Targeted candidates — inventory

Seven candidates were inspected. Three are marked **`SELECTED_REFERENCE_BASE`** — reference-template *bases*, each additionally carrying **`HARDENING_REQUIRED_BEFORE_CANONICAL_ADOPTION`** and **`NOT_APPROVED_AS_CANONICAL_CONTRACT`** — not ready-to-copy canonical reference contracts (§7). The remainder are recorded as evidence of gaps or explicit anti-patterns, per the task's instruction to record absence/rejection rather than assume validity.

### CAND-01 — Billing financial-select restricted selector

- **File/symbol:** `server/src/routes/treatmentCases.ts:65-105`, inline handler for `GET /api/treatment-cases/financial-select` (no exported function name — router-registered anonymous handler).
- **Owner domain:** Treatment Cases (data owner). **Consumer domain:** Billing/Payments UI (`src/services/api.ts:253`, `treatmentCaseService.getFinancialSelect`, used by the payment-creation form) — a genuine cross-domain read (Billing reading Treatment Case data through a purpose-narrowed shape rather than the full authorized-for-clinical-roles `GET /treatment-cases` payload).
- **Contract visibility:** Inline route handler; not exported from a dedicated module. No shared constant/type is reused by the sibling narrow-selects in `payments.ts`/`practitionerEarnings.ts`.
- **Explicit tenant context:** Yes — `clinicId` resolved via `validateAndGetClinicIdScope(req.user!, selectedClinicId, res)` (`treatmentCases.ts:74`), never a raw `req.user.clinicId` read.
- **Authorization placement:** Route middleware, `authorize([...])` (`treatmentCases.ts:69`), before the handler body.
- **DB predicate scope:** `...scope` (the validated clinic predicate) spread into the sole `where` clause (`treatmentCases.ts:78`) alongside `patientId`/`deletedAt: null`. No unscoped query.
- **DTO definition:** No named `interface`/`type`; shape is an inferred `select` projection plus two computed fields (`totalPaid`, `remainingBalance`).
- **Raw Prisma leakage:** No — explicit `select` (not `include`) narrows `TreatmentCase` to 10 named fields, deliberately excluding clinical fields (`description`, `lostReason`, procedures, activity logs, attachments) present on the full `GET /treatment-cases` route.
- **Typed/sanitized errors:** No — generic `catch { res.status(500).json({ error: 'Failed to fetch treatment cases' }) }` (`treatmentCases.ts:102-104`).
- **Audit ownership:** None (pure read; no audit expected for a read-only selector).
- **Transaction ownership:** None (`$transaction` not used).
- **Test ownership:** `server/src/tests/billingFinancialTreatmentCaseSelect.test.ts` and `billingPatientAccess.test.ts` — both **simulated** (hand-rolled mock arrays/role checks, do not invoke the real route or Prisma). The one **real DB + real route-middleware-chain** test in this area, `paymentsListFieldScope.test.ts`, covers the sibling narrow-select embedded in `GET /payments`, not this endpoint directly.
- **Cross-tenant tests:** Present, but only in the simulated test (`billingFinancialTreatmentCaseSelect.test.ts:153-165,180-193` — clinic-B and cross-org rejection scenarios against the mock, not the real handler).
- **Backward compatibility / rollback:** Not documented in-file.
- **Classification: `PARTIAL_PATTERN_NEEDS_HARDENING`.**
- **Suitability:** Selected as a **`SELECTED_REFERENCE_BASE`** for the restricted-read-selector category (§7) — **`HARDENING_REQUIRED_BEFORE_CANONICAL_ADOPTION`**, **`NOT_APPROVED_AS_CANONICAL_CONTRACT`**.

### CAND-02 — Treatment-case scoped relation/ownership guard (`findTreatmentCaseInClinic`)

**Correction (R1):** the original draft of this document described this function as a "scoped mutation/service boundary." That overstates it. `findTreatmentCaseInClinic` performs a scoped **existence/ownership lookup** only — it never itself performs a mutation, never reapplies a tenant predicate at mutation time, and is never the thing under test as a mutation boundary. It is reclassified below as **`SCOPED_RELATION_OR_OWNERSHIP_GUARD`**, not a mutation boundary.

**What this pattern does NOT guarantee** (each caller's own mutation must supply these independently — none is provided by the guard function itself):
- **No transaction ownership** — the guard's lookup and each caller's subsequent write are two separate statements; nothing wraps them in a shared `$transaction`.
- **No mutation predicate reapplication** — none of the 7 call sites re-applies `clinicId` (or any tenant predicate) on the mutation statement itself; the guard's lookup result is trusted for the write that follows, rather than the write repeating `where: { id, clinicId }` on its own `update`/`updateMany` call.
- **No TOCTOU (time-of-check-to-time-of-use) protection** — the guard reads once; if the row's clinic/ownership could change between the guard's `findFirst` and the caller's later write (e.g. concurrent clinic reassignment, soft-delete), nothing in this pattern detects or prevents acting on stale ownership data.
- **No atomic side-effect boundary** — the guard has no knowledge of, and provides no ordering/rollback guarantee over, whatever side effects (further writes, audit entries, external calls) the caller performs after it returns.

- **File/symbol:** `server/src/utils/relationGuards.ts:26-36`, exported function `findTreatmentCaseInClinic(treatmentCaseId, clinicId, patientId?)`.
- **Owner domain (nominal):** Shared utils — **not** owned by the Treatment Case domain's own files (`treatmentCases.ts`/`treatmentPackages.ts`/`treatmentPlanProcedures.ts`/`dentalChart.ts` export nothing but `export default router` — grep-confirmed, no other export exists in any of the four files). **Consumer domains:** Payments (`payments.ts:11,91,174`), Appointments (`appointments.ts:26,340,480,671`), Imaging (`imaging.ts:34,243`), Lab Orders (`labOrders.ts:12,128,171`) — four independent cross-domain call sites, confirmed by direct grep against this task's own baseline worktree.
- **Contract visibility:** Exported module function — genuinely importable/imported cross-domain, unlike CAND-01. Architecturally misplaced: it re-implements Treatment Case's own tenant predicate (`clinicId`, `deletedAt: null`) rather than delegating to a Treatment-Case-owned function.
- **Explicit tenant context:** `clinicId` is a required parameter in every one of the 7 call sites; callers resolve it upstream via `resolveEffectiveClinicId`/`getAccessibleClinicIds`/`validateAndGetClinicIdScope` before calling this guard.
- **Authorization placement:** Entirely in each caller's own route middleware (`authorize([...])`); the guard function itself performs zero authorization, only tenant-membership/existence validation.
- **DB predicate scope:** `clinicId` present in the sole `where` clause (`relationGuards.ts:27-32`) plus optional `patientId` narrowing.
- **DTO definition:** Ad hoc — Prisma-inferred `{ id, patientId, practitionerId, title } | null`, no named type.
- **Raw Prisma leakage:** No (narrow `select`), but the return shape is unnamed/undocumented as a contract.
- **Typed/sanitized errors:** None — every caller does `if (!tc) return res.status(400).json({ error: 'Invalid treatment case' })` inline; no shared error class.
- **Audit ownership:** None at the guard level (pure lookup); audit ownership stays with each caller's own mutation.
- **Transaction ownership:** None — never called inside `$transaction` at any of its 7 call sites.
- **Test ownership:** No dedicated test file for `relationGuards.ts` itself. `server/src/tests/treatmentCaseClinicScope.test.ts` exercises a hand-rolled mock of the same logic, not the real imported function.
- **Cross-tenant tests:** Only via the mocked reimplementation above — no true integration test hits the real `findTreatmentCaseInClinic` cross-tenant.
- **Backward compatibility / rollback:** Not documented.
- **Classification: `SCOPED_RELATION_OR_OWNERSHIP_GUARD` / `PARTIAL_PATTERN_NEEDS_HARDENING`.**
- **Suitability:** Selected as a **`SELECTED_REFERENCE_BASE`** for the scoped-relation/ownership-guard category (§7) — **`HARDENING_REQUIRED_BEFORE_CANONICAL_ADOPTION`**, **`NOT_APPROVED_AS_CANONICAL_CONTRACT`** — conditional on relocating ownership into the Treatment Case domain, adding a named DTO/direct tests, and (if it is ever asked to guarantee anything about a mutation) adding the transaction/predicate-reapplication/TOCTOU properties listed above, which it does not have today. See §4a for the separate, still-unfilled canonical scoped-mutation-contract gap.

### CAND-03 — Patient privacy scoped parent-resolution pattern (`resolvePatient`)

- **File/symbol:** `server/src/routes/patientPrivacy.ts:64-81`. Re-verified directly against this task's own baseline worktree (line numbers corrected from an earlier draft citation of 62-81/334 et al. — the authoritative numbers below are from direct `grep -n` against baseline `6f539b2`):

  ```ts
  async function resolvePatient(
    patientId: string,
    user: NonNullable<AuthRequest['user']>,
  ): Promise<{ id: string; clinicId: string; isAnonymized: boolean } | null> {
    const where: any = { id: patientId, organizationId: user.organizationId, deletedAt: null };
    if (!user.canAccessAllClinics) where.clinicId = { in: user.allowedClinicIds };
    return prisma.patient.findFirst({ where, select: { id: true, clinicId: true, isAnonymized: true } });
  }
  ```

  Call sites (8 total, all within the same file): `patientPrivacy.ts:382,450,506,586,714,749,771,806`.
- **Owner domain:** Privacy / Consent / Retention / Data Subject Rights (core platform, `regulatory/tenant-critical`). **Consumer domains:** none outside this file — `resolvePatient` itself has no `export` keyword and `patientPrivacy.ts` exports only `export default router;` (line 916). The task's premise that `patientAnonymization.ts`/`orphanFileInspection.ts`/`deletionReviewInventory.ts` call `resolvePatient` directly does **not** hold: those services receive `patient.clinicId` as an already-resolved plain argument from the route **after** the route calls `resolvePatient` — they do not import or call the helper themselves, and each re-derives/trusts the passed `clinicId` independently rather than re-validating it.
- **Contract visibility:** Module-private (no `export`). Not importable by any other file today.
- **Explicit tenant context:** Yes, inline — `organizationId` equality + `deletedAt: null` + conditional `clinicId IN allowedClinicIds`. This exact pattern is independently cited and endorsed as a legitimate "equivalent record-derived validation" tenant-context source in `F2-PREP-009` §3 and verified per-caller in §8a of that document.
- **Authorization placement:** Two-layer — role gating via route middleware (`authorize(PRIVACY_MANAGE_ROLES)` and variants), tenant gating inline inside `resolvePatient`.
- **DB predicate scope:** `id + organizationId + deletedAt: null` always; `clinicId IN allowedClinicIds` conditionally (skipped only for `canAccessAllClinics`).
- **DTO definition:** Narrow inline `select: { id, clinicId, isAnonymized }`; explicit return type annotation, not a named/shared DTO.
- **Raw Prisma leakage:** None — result is never serialized directly to a response; used only to derive `clinicId` for subsequent scoped calls.
- **Typed/sanitized errors:** Callers do a generic, non-leaky `if (!patient) return res.status(404).json({ error: 'Patient not found' })`.
- **Audit ownership:** None inside `resolvePatient` itself (pure lookup); each route handler using it separately calls `writeAuditLog` after success.
- **Transaction ownership:** None (`resolvePatient` is a single `findFirst`).
- **Test ownership:** `server/src/tests/patientPrivacy.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts`. Neither imports the real `resolvePatient` (impossible — it is not exported); both are characterization tests that reimplement equivalent logic locally with injected dependencies.
- **Cross-tenant tests:** No direct integration test hits the real endpoint with a cross-tenant patient against the real `resolvePatient`. `kvkkAttachmentImagingLifecycle.test.ts` does test tenant isolation for an adjacent module (`validateExportDownloadToken`), not this helper.
- **Backward compatibility / rollback:** Not documented for this helper specifically.
- **Classification: `INTERNAL_ONLY_NOT_A_CONTRACT`** (as it exists today — module-private, zero cross-domain consumers). Recorded here, not discarded, because it is the single cleanest, already-endorsed (by F2-PREP-009 §3/§8a) tenant-context-resolution pattern in the repository and is the strongest available basis for the privacy/lifecycle-oriented reference slot once exported and hardened.
- **Suitability:** Selected as a **`SELECTED_REFERENCE_BASE`** for the privacy/lifecycle-oriented category (§7) — **`HARDENING_REQUIRED_BEFORE_CANONICAL_ADOPTION`**, **`NOT_APPROVED_AS_CANONICAL_CONTRACT`** — conditional on exporting it, giving downstream services (`patientAnonymization.ts` et al.) a re-validation call instead of a trust-the-caller `clinicId` parameter, and adding direct + cross-tenant tests against the real function.

### CAND-04 — Appointment statistics or summary services

- **Result: absent as a shared/cross-domain contract.** `server/src/routes/appointments.ts` exports only `export default router;` (no other file imports from it). `dashboard.ts`'s `GET /dashboard/stats` computes appointment counts entirely inline (e.g. `dashboard.ts:53-60`, `prisma.appointment.count` with ad hoc `where`); `reports.ts` independently re-implements its own, unrelated appointment counting inline (`reports.ts` — separate `prisma.appointment.count`/raw-SQL blocks). No exported function is shared between the two, and neither imports from `appointments.ts` or any `*appointment*` service. The only two `*appointment*` service files (`appointmentRequestNotification.ts`, `appointmentRequestSafety.ts`, plus `services/appointments/appointmentAvailabilityService.ts`) contain availability/conflict-checking logic only, no statistics/summary exports.
- **Contrast example (not itself a targeted candidate, noted for context only):** `server/src/services/labOrders/labOrderSummary.ts` exports a real `buildDashboardSummary(...)` cross-file-consumable summary builder for the Lab Orders domain, underscoring that Appointments has no equivalent today.
- **Classification: `INTERNAL_ONLY_NOT_A_CONTRACT`** for each of the two independent inline implementations; recorded as a live architectural gap (duplicated, undocumented statistic logic), not a `DOCUMENTED_NOT_IMPLEMENTED` case — no document or comment anywhere expresses intent to unify these two call sites.
- **Suitability:** Not selected as a reference (nothing to select — no exported contract exists).

### CAND-05 — Reporting DTO aggregation pattern

- **File/symbol:** `server/src/routes/reports.ts` (four inline route handlers plus one module-private helper, `clinicScopeSql`, not exported), `server/src/routes/dashboard.ts` (one exported non-route function, `buildSafeStats`, a null-safety normalizer — not a DTO-aggregation service; and one module-private `buildChartData`).
- **Owner domain:** None — confirmed `shared/ambiguous` per `MODULE_MAP.md`; Reporting owns zero Prisma models and reads Payments, Appointments, Treatment Cases, Patients, Users directly.
- **DB predicate scope:** Sound — `validateAndGetClinicIdScope`/`validateAndGetScope` used consistently; the raw-SQL path uses a parameterized `clinicScopeSql()` helper (`reports.ts:16-24`), confirmed array-aware for org-wide multi-clinic scope, with a regression test (`reportsClinicScope.test.ts`) locking in a documented historical fix for a prior raw-SQL clinic-scope leak.
- **DTO definition:** Effectively none — untyped object-literal responses; `dashboard.ts`'s `buildSafeStats` has only an inline parameter shape, not a named type.
- **Raw Prisma leakage:** Partial — `dashboard.ts`'s `agenda`/`doctorExtras.upcomingWeek`/`recentPatients`/`activities` sections use `include` on `Appointment`/`ActivityLog`, passing through full model scalars (internal timestamps, soft-delete fields) rather than a narrowed DTO.
- **Typed/sanitized errors:** None — generic `catch { console.error(...); res.status(500).json({ error: '<string>' }) }` throughout both files.
- **Audit/transaction ownership:** None in either file (read-only; no `$transaction` usage).
- **Test ownership:** `reportsClinicScope.test.ts`, `reportsRevenueByPeriod.test.ts`, `dashboard.test.ts` — all are either hand-mirrored reimplementations of the real logic plus source-text regex assertions against the route file, or (for `dashboard.test.ts`) a genuine unit test of the one exported `buildSafeStats` function only. **No test exercises the real Express route + real database for either file.**
- **Cross-tenant tests:** Present, but only at the mirrored-logic level (`reportsClinicScope.test.ts:167-204,258-262`; `dashboard.test.ts:513-563`), not against the real imported route/helper code.
- **Backward compatibility:** Explicitly documented and tested for the reports clinic-scope fix (`reportsClinicScope.test.ts:22-23,206-211` — "an omitted clinicId selector resolves to the same accessible-clinic scope... previously seen").
- **Classification: `ANTI_PATTERN_DIRECT_ACCESS`**, bordering `PARTIAL_PATTERN_NEEDS_HARDENING` for the tenant-scoping mechanics specifically (which are sound). As a "DTO aggregation service" candidate it fails the core ask — there is no exported service/module that aggregates data into a DTO shape; everything is inlined directly in the route file, exactly as `MODULE_MAP.md` already characterizes it.
- **Suitability:** Not selected as a positive reference; retained as the negative reference point ("what route-inlined-without-a-DTO-layer looks like").

### CAND-06 — Existing domain `public.ts`/barrel conventions

- **Result: absent, repo-wide, on this task's own baseline worktree.** No file named exactly `public.ts` exists anywhere under `server/src` at baseline `6f539b2`. The only two `index.ts`-class files are `server/src/index.ts` (app bootstrap, not a domain barrel) and `server/src/schemas/index.ts` (a flat, cross-cutting Zod validation-schema module imported by ~19 route files across nearly every domain — a shared input-validation utility, not a domain-owned facade, and explicitly excluded by this task's own scope).
- `MODULE_MAP.md:10` explicitly states the target `server/src/modules`/`server/src/platform` structure and `public.ts` contract implementation were **not** built by F0. `F2-PREP-004`'s modularization-sequence document (`docs/program/evidence/F2-PREP-004_MODULARIZATION_SEQUENCE_AND_PILOT_SELECTION.md:256-261`) treats "introduce a `public.ts` without moving behavior" as a *future* Stage 2 step, not an existing pattern.
- **Classification: `DOCUMENTED_NOT_IMPLEMENTED`** — the convention is named and planned in accepted F2 planning documents but has zero implementations merged to `main` as of this task's baseline. (The one `public.ts` file that exists anywhere in this repository's git history is PR #304's unmerged Imaging facade — see CAND-07; it is not on `main` and is not counted as an implementation of this convention.)
- **Suitability:** Not selected as a reference (nothing merged to select); recorded as the reason a fourth, "barrel convention" reference category was not attempted — no repository-native, merged example exists to evaluate.

### CAND-07 — ImagingLifecyclePort implementation (PR #304), separate from its accepted/proposed contract documents

This candidate is deliberately split into **document** and **implementation**, per this task's own instruction, because they are in different states.

**Contract documents (accepted/proposed, both merged to `main`):**
- `F2-CC-14`/`ImagingLifecyclePort`, 4-method slice: **accepted and revised** in `F2-PREP-006-E` §9 (merged).
- Tenant-context amendment (Option A — explicit `clinicId` leading parameter on all 4 methods): proposed in `F2-PREP-009` (merged as a *document*; the *contract it proposes* remains `PROPOSED`, not accepted — see §1 correction above).

**Implementation (PR #304, `feature/f2-impl-001-a-unused-imaging-lifecycle-facade`, NOT merged, NOT on `main`, NOT present in this task's baseline worktree):**
Live re-verification performed by this task (`gh pr view 304`, 2026-08-03):

```
baseRefName: main
headRefOid: abac5e361abd0913dadbce1e124c2ca113600fb7
mergeStateStatus: DIRTY
mergeable: CONFLICTING
state: OPEN
```

This is a **new observation this task is recording, not previously reflected in the tracker's last entry** (which recorded `mergeable: MERGEABLE` at the same head SHA on a prior check). Direct inspection of `server/src/services/imaging/public.ts` at this exact head (`git show abac5e36...:server/src/services/imaging/public.ts`) confirms:

- `findOwnedImage(imageId: string)` (line 151) still takes **no `clinicId`/tenant parameter** and re-derives ownership only via `image.study.clinicId !== image.clinicId` (a data-integrity check, not authorization) — **Finding 1 (tenant-authorization gap) remains open**, unchanged from `F2-PREP-009`'s own re-verification.
- `markStorageMissing(imageId: string)` (line 177), `redactForAnonymization(imageId, reason)` (line 196), `checkImageStorageExists(imageId: string)` (line 277) are all still **`imageId`-only mutations/queries** with no caller-supplied tenant scope in their signature — the exact "unscoped ID-only mutation" anti-pattern category named in this task's own rejected-patterns list (§8).
- `__setImagingStorageExistenceCheckerForTest` (line 264) is a **separately exported, production-reachable function** whose sole purpose is to mutate module-private test state — the exact "public export of test seams" anti-pattern category named in §8.
- The module's own header comment (lines ~1-46) is unusually explicit about its own gap: *"⚠ KNOWN GAP — TENANT AUTHORIZATION IS NOT ENFORCED... A caller holding a valid imageId belonging to another tenant can read/mutate that image today..."* — i.e. the file is a **documented, self-admitted "service wrapper with no actual boundary enforcement"**, the exact fourth rejected-pattern category named in §8.
- Zero production callers exist (`patientAnonymization.ts`/`orphanFileInspection.ts`/`deletionReviewInventory.ts` all still use direct Prisma access unchanged — confirmed in CAND-03's own investigation).

**Classification: `DOCUMENTED_NOT_IMPLEMENTED`** for the accepted/proposed contract documents; **`REJECTED_AS_REFERENCE`** for the current PR #304 implementation itself, which must not be cited as a working example of any of the four reference categories in §7 until Finding 1 is closed and the PR's now-`CONFLICTING` merge state is independently reconciled (out of scope for this task).

**Suitability:** Not selected as a positive reference. The *contract document* (`F2-PREP-009`'s Option A design — typed errors, explicit tenant-context parameter, fail-closed predicates, documented audit/rollback ownership) is, on paper, the most rigorous single artifact found in this inventory, and is cited as design input for the proposed common template in §7 — but the template recommendation explicitly does not point at the PR #304 source as a working reference, per this task's own instruction to re-check direct source for every selected reference.

## 4. Canonical scoped-mutation contract gap (explicit)

**No inspected candidate qualifies as a canonical scoped mutation contract.** CAND-02 (`findTreatmentCaseInClinic`) is the closest structural match among the seven candidates inspected, but per the Correction (R1) above it is a relation/ownership guard, not a mutation boundary, and none of the other six candidates performs or owns a mutation either. This inventory found **zero** candidates possessing all of the following properties, which a canonical scoped mutation contract requires:

- An owner-domain **mutation service** (a function, owned by the domain that owns the underlying model, whose job is specifically to perform the write — not a lookup that merely precedes a caller's own inline write).
- An **explicit, authorization-validated tenant context** parameter carried through to the mutation statement itself (not merely to an earlier lookup).
- A **full mutation predicate** — the write's own `where`/`updateMany` clause repeats the tenant scope directly, rather than trusting a prior read.
- **Transaction ownership** — an explicit statement (and, where needed, an actual `$transaction`) of what is atomic with what.
- **Typed, sanitized errors** specific to the mutation's failure modes (not a generic 400/500).
- **Audit ownership** — an explicit statement of whether the mutation function or its caller writes the audit entry.
- **Real, DB-backed, cross-tenant tests** that assert both the rejection of a cross-tenant mutation attempt and the actual side effect of an accepted one (not a mirrored/simulated reimplementation).
- **Rollback behavior** — an explicit statement of how the mutation's effects are reversed if a caller-side error occurs afterward.

This gap is recorded, not filled, by this task. A later hardening/reference-implementation task is recommended to design and build a canonical scoped-mutation contract (most plausibly by promoting a hardened version of CAND-02 into the Treatment Case domain's own module, or by building a new example elsewhere) — **no such implementation is authorized or attempted here.**

## 5. Cross-domain anti-pattern instances found (supporting §9)

Beyond CAND-05/CAND-07 above, direct cross-domain Prisma access to Treatment Case data was found and is recorded as evidence, not corrected by this task:

- `server/src/routes/dashboard.ts:85,91,191` — `prisma.treatmentCase.count`/`.aggregate`/`.groupBy`, tenant-scoped (`...clinicIdWhere` present) but bypassing any Treatment-Case-owned function.
- `server/src/routes/reports.ts:245,271,274` — `prisma.treatmentCase.findMany`/`.count`, same pattern.
- `server/src/routes/postTreatment.ts:85,139` — `prisma.treatmentPackage.findFirst({ where: { id: treatmentPackageId, clinicId } })`, duplicated verbatim between its POST and PUT handlers rather than factored into a shared function.
- `server/src/services/earningService.ts:157` — `prisma.treatmentCase.findFirst({ where: { id: treatmentCaseId, clinicId } })` — the coupling between Treatment Cases and Earnings/Payments is bidirectional and ad hoc in both directions.
- `server/src/routes/dentalChart.ts:33-38` — `prisma.toothRecord.findMany(...)` result serialized directly via `res.json(records)` with zero DTO mapping — the "raw model return" anti-pattern category, found within the Treatment Case domain's own dental-chart sub-area (not cross-domain, but a same-domain instance of the category worth recording).

All instances above apply `clinicId` correctly in their own `where` clause (none is a live tenant-isolation bug); they are recorded because they bypass any service boundary entirely, which is the architectural pattern this task was asked to inventory.

## 6. Tenant context findings (summary — scoped to the seven inspected candidates)

**Correction (R1):** the statement below is a candidate-scoped conclusion, not a repository-wide tenant-scope conclusion. **This task does not, and does not attempt to, establish a repository-wide finding about `req.user.clinicId` usage. `F2-GUARDRAIL-PREP-010-B` owns the repository-level tenant-scope inventory; this document does not duplicate or pre-empt that authority.**

No raw `req.user.clinicId`-only authorization predicate was found within the seven targeted candidates inspected by this task. Every selected reference base (CAND-01/02/03) and every anti-pattern instance found in §4/§5 applies an explicit, non-optional `clinicId` predicate at the database layer, within the code this task actually read. The two raw `req.user!.clinicId` reads found in `reports.ts`/`dashboard.ts` (within CAND-05's own files) are non-scoping locale/timezone-preference lookups, not data predicates, and are recorded for completeness, not as a violation. The one confirmed instance of an unscoped, tenant-context-free signature at this task's original observation time was PR #304's then-head implementation of `ImagingLifecyclePort` (CAND-07) — not present on `main`; see §11 for the current, superseding observation on that PR.

## 7. DTO / raw-Prisma-leakage findings (summary)

No candidate examined defines a named, shared TypeScript DTO type. All "DTOs" found are either Prisma-inferred `select` projections (CAND-01, CAND-02, CAND-03 — narrow, no leakage) or, in `dashboard.ts`'s `agenda`/`activities` sections, `include`-based passthroughs of full `Appointment`/`ActivityLog` scalars (CAND-05 — leakage). `dentalChart.ts` (§5) returns a raw Prisma model directly with no `select` narrowing at all.

## 8. Proposed reference template (documentation only — not implemented by this task)

A common contract template, synthesized from the strongest elements found across CAND-01/02/03 and the F2-PREP-009 design (CAND-07's documents), covering the 15 elements this task was asked to address:

1. **Owner domain** — the domain that owns the underlying Prisma model(s), matching `MODULE_MAP.md`'s ownership row exactly (CAND-02's current misplacement — a Treatment-Case guard living in shared `utils/` — is the negative example to avoid).
2. **Exported entry path** — a single exported function (or small named set) from a file inside the owning domain's own route/service directory — not a neutral shared-utils module, not an inline route handler.
3. **Explicit authorization-validated context** — a required, leading `clinicId` (and `organizationId` where relevant) parameter, sourced only from `resolveEffectiveClinicId`/`validateAndGetClinicIdScope`/`getAccessibleClinicIds` or an equivalent already-access-scoped record lookup (CAND-03's `resolvePatient` predicate shape, endorsed by `F2-PREP-009` §3, is the concrete model) — never a raw `req.user.clinicId`/JWT-default.
4. **Input DTO** — a named `interface`/`type` for parameters beyond the tenant context (none of CAND-01/02/03 has one today; this is a hardening requirement, not something to copy as-is).
5. **Output DTO** — a named `interface`/`type` for the return shape (CAND-07's `ImagingLifecycleImageDto` is the one named-DTO example found anywhere in this inventory, even though its implementation is rejected for other reasons — the DTO-naming practice itself is worth keeping).
6. **No raw Prisma model** — enforced via explicit `select` (never bare `include` of an entire model), per CAND-01/02/03's narrow-select practice and contrasted against CAND-05/§4's `include`/raw-return leaks.
7. **Fail-closed tenant predicates** — `clinicId` (and any secondary scope column) present as a top-level, non-optional predicate on every read *and* every write, re-applied identically on the write path (per `F2-PREP-009` §5's explicit read/write-parity requirement) — a zero-row result is indistinguishable from "does not exist."
8. **Sanitized typed errors** — a small, closed set of exported `Error` subclasses (e.g. `NotFoundError`, `ValidationError`) with stable `.code` values, replacing every candidate examined's current generic `catch { res.status(500).json({ error: '<string>' }) }` pattern (none of CAND-01/02/03 has this today — CAND-07's document proposes it, and its typed-error *design* — a single undifferentiated not-found error across all not-found causes — is the concrete pattern to copy).
9. **Audit ownership** — explicitly documented as either "this function writes its own audit entry" or "the caller owns the audit entry" (CAND-01/02/03 all currently leave audit ownership with the caller — a valid choice, but it must be stated, not implicit).
10. **Transaction ownership** — explicitly documented as either "this function is single-statement, no transaction" or "this function opens its own `$transaction` and callers must not double-wrap." All three selected candidates are currently single-statement (no transaction needed) — the template requires this be stated even when the answer is "none."
11. **Version/backward compatibility** — an explicit statement of what changes are additive vs. breaking, per `F2-PREP-009` §9's model ("no backward compatibility to preserve" is itself a valid, explicit statement when there are zero production callers).
12. **Test ownership** — a real, DB-backed test importing the actual exported function/route (not a hand-mirrored reimplementation) — `paymentsListFieldScope.test.ts` is the one example found in this inventory that meets this bar; every other candidate's test suite mirrors logic locally instead of exercising the real code path. This is the single most common gap across every candidate examined.
13. **Migration impact** — explicit statement of whether adopting the contract requires a caller migration (CAND-02/CAND-03 both would, since existing callers currently duplicate the logic inline rather than calling an exported function).
14. **Rollback** — "delete/revert the new exported function and its call sites" when zero-caller/additive, matching `F2-PREP-009` §10's and `F2-PREP-004`'s stated rollback shape for a Stage-2 `public.ts` introduction.
15. **Production caller inventory** — an explicit, enumerated list of every current call site (as this document itself provides for CAND-02's 7 call sites and CAND-03's 8 call sites), re-verified at the time of each future migration, not assumed to remain accurate indefinitely (per `F2-PREP-009` §8a's own "Stage 3 precondition, not a standing guarantee" language).

**This template is a documentation proposal only. No file implementing it is created by this task.**

## 9. Rejected patterns (explicit)

| Rejected pattern | Concrete instance found | Evidence |
|---|---|---|
| Direct Prisma cross-domain reads | `dashboard.ts`/`reports.ts` querying `prisma.treatmentCase` directly; `postTreatment.ts` querying `prisma.treatmentPackage` directly; `earningService.ts` querying `prisma.treatmentCase` directly | §5 |
| Raw model return | `dentalChart.ts:38`, `res.json(records)` on an unmapped `prisma.toothRecord.findMany` result; `dashboard.ts`'s `include`-based `Appointment`/`ActivityLog` passthroughs | §5, CAND-05 |
| Implicit/default clinic authorization | Not found as a security-critical instance in any currently-merged production predicate, **within the seven candidates inspected by this task** (see §6 correction). The class itself is documented and explicitly rejected as insufficient by `F2-PREP-009` §3 (a raw `req.user.clinicId`/JWT-default is "not, by itself, sufficient authorization"); the two raw `req.user!.clinicId` reads found in this inventory (`reports.ts`, `dashboard.ts`) are non-scoping locale/timezone-preference lookups, recorded for completeness, not as violations. | §6, F2-PREP-009 §3 |
| Unscoped ID-only mutation | PR #304's implementation **as it stood at this task's original head, `abac5e36`** — `markStorageMissing(imageId)`/`redactForAnonymization(imageId, reason)`/`checkImageStorageExists(imageId)` — no `clinicId` parameter. See §11 for the superseding head observation. | CAND-07 |
| Public export of test seams | PR #304's `__setImagingStorageExistenceCheckerForTest`, a production-reachable exported function whose only purpose is mutating module-private test state — present at both `abac5e36` and the superseding head `7bcd1c8` (see §11) | CAND-07 |
| Service wrappers with no actual boundary enforcement | PR #304's `services/imaging/public.ts` as a whole, **as it stood at `abac5e36`** — self-documented in its own header as enforcing data-integrity consistency, not caller authorization. See §11: the superseding head changes this file's tenant-parameter shape. | CAND-07 |

## 10. Per-candidate test evidence and exact totals

For each of the seven candidates, this section records: the exact production file/symbol; the exact test file(s), if any; whether the production symbol is actually imported/invoked by that test; whether the test runs against real Postgres/Prisma or mocked/mirrored logic; whether the test is route-level (exercises the real HTTP route) or helper-level (exercises the real exported function directly, without the route); whether a cross-tenant case is asserted; whether a mutation side effect is asserted; and the resulting test classification. Test classifications used: **REAL_DB_BACKED_DIRECT** (imports/invokes the real symbol, real database), **MOCKED_DIRECT** (imports/invokes the real symbol, but against a mock/stub datastore), **MIRRORED_SIMULATION** (reimplements the logic locally instead of importing the real symbol), **NO_DIRECT_TEST** (no test exercises this symbol at all, directly or indirectly).

| ID | Production file/symbol | Test file(s) | Real symbol imported/invoked? | Real DB/Postgres vs. mocked/mirrored | Route-level vs. helper-level | Cross-tenant assertion? | Mutation side-effect assertion? | Test classification |
|---|---|---|---|---|---|---|---|---|
| CAND-01 | `treatmentCases.ts:65-105` (inline handler) | `billingFinancialTreatmentCaseSelect.test.ts`, `billingPatientAccess.test.ts` | No — both reimplement the selection/authorization logic against a mock array, never importing the router or calling the live route | Mirrored | Neither (no HTTP call, no helper call) | Yes, but only against the mock | N/A (read-only) | **MIRRORED_SIMULATION** |
| CAND-02 | `relationGuards.ts:26-36` `findTreatmentCaseInClinic` | `treatmentCaseClinicScope.test.ts` | No — hand-rolled reimplementation of the same `where` shape, never imports `relationGuards.ts` | Mirrored | Helper-level in intent, but not the real helper | Yes, but only against the mock | N/A (lookup only, no mutation) | **MIRRORED_SIMULATION** |
| CAND-03 | `patientPrivacy.ts:64-81` `resolvePatient` | `patientPrivacy.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts` | No — cannot import it (not exported); both reimplement equivalent logic or test an adjacent function (`validateExportDownloadToken`) | Mirrored | Route-level for the reimplemented logic; helper-level (real) for the adjacent, different function only | Yes, but only against the mirrored/adjacent logic, not this helper | N/A (lookup only, no mutation) | **MIRRORED_SIMULATION** |
| CAND-04 | absent (no shared symbol exists) | none | N/A | N/A | N/A | N/A | N/A | **NO_DIRECT_TEST** |
| CAND-05 | `reports.ts` (4 inline handlers, `clinicScopeSql`), `dashboard.ts` (`buildSafeStats` exported, rest inline) | `reportsClinicScope.test.ts`, `reportsRevenueByPeriod.test.ts`, `dashboard.test.ts` | Partial — `dashboard.test.ts` imports and directly invokes the real, exported `buildSafeStats` (a normalizer, not the aggregation itself); every other assertion in all three files mirrors route logic locally instead of calling the real route/handler | Mixed: `buildSafeStats` portion is a real unit test (no DB needed, pure function); all other portions are mirrored, no live DB | `buildSafeStats`: helper-level (real). Everything else: neither (mirrored) | Yes, but only against the mirrored logic | N/A (read-only) | **Mixed — MOCKED_DIRECT for `buildSafeStats` only; MIRRORED_SIMULATION for everything else in this candidate.** Counted once below under its dominant (mirrored) classification since the aggregation/DTO behavior itself — the thing this candidate is about — is never tested directly. |
| CAND-06 | absent (no `public.ts` exists on `main`) | none | N/A | N/A | N/A | N/A | N/A | **NO_DIRECT_TEST** |
| CAND-07 | `server/src/services/imaging/public.ts` (PR #304, unmerged) | `imagingLifecycleFacade.test.ts` (on the PR #304 branch, not on `main`) | Yes, on that branch — the test file directly imports and invokes the real exported facade functions | Real Postgres/Prisma (per the PR branch's own disposable-DB test infrastructure, not verified against `main` since the file does not exist there) | Helper-level (direct function calls, no HTTP route — the facade has zero production callers/routes) | Per the PR #304 branch's own commit messages, yes (cross-tenant-denial assertions) — not independently re-verified line-by-line by this task | Per the PR #304 branch's own commit messages, yes (write-predicate assertions) — not independently re-verified line-by-line by this task | **Not applicable to `main`** — this test file and the facade it tests do not exist on `main`/this task's baseline; recorded for completeness only, not counted in the totals below (which are scoped to code present at this task's baseline SHA `6f539b2`). |

**Exact totals across the candidates present at this task's baseline (`main` @ `6f539b2`) — CAND-01, CAND-02, CAND-03, CAND-05 (4 candidates with any test coverage) plus CAND-04/CAND-06 (2 candidates with no code to test) plus CAND-07 (present only on an unmerged branch, excluded from the baseline totals below):**

- **Real DB-backed direct tests:** 0
- **Mocked direct tests:** 0 (CAND-05's `buildSafeStats` unit test is a real-function unit test of a pure normalizer, not a mocked-datastore test — it requires no datastore at all, so it is not counted in this bucket; it is noted separately above)
- **Mirrored simulations:** 4 (CAND-01, CAND-02, CAND-03, CAND-05)
- **No direct tests:** 2 (CAND-04, CAND-06 — no code exists to test)
- **Excluded from totals (code not present on `main`):** 1 (CAND-07 — its test file exists only on PR #304's own branch)

No candidate in this inventory has a real-DB-backed direct test of the exact production symbol/route being evaluated as a reference candidate. This is recorded as the single most significant, quantified gap across the inventory, superseding the earlier draft's unquantified "nearly every" wording.

## 11. PR #304 — substantive findings vs. timestamped mergeability observation (Correction 6)

Per this correction task's instruction, this section explicitly separates (A) substantive contract/implementation findings, which are a property of a specific commit and do not change on their own, from (B) GitHub's mergeability computation, which is transient and can change from moment to moment without any code change (rebases of `main`, other PRs merging, etc.). **PR #304's reconciliation — including whatever code state it ultimately merges — belongs to `F2-IMPL-001-A-R2`, not to this task.** This task neither performs nor authorizes that reconciliation; it only records what was directly observed.

**(A) Substantive findings, by commit — both immutable, both already recorded in git history:**

- At head `abac5e361abd0913dadbce1e124c2ca113600fb7` (this task's original observation): `findOwnedImage`/`markStorageMissing`/`redactForAnonymization`/`checkImageStorageExists` took no `clinicId` parameter; ownership was re-derived via a same-row `image.study.clinicId !== image.clinicId` self-consistency check, not caller-supplied tenant context. This is Finding 1, and is the basis for CAND-07's `REJECTED_AS_REFERENCE` implementation classification as originally recorded in §3.
- **New observation, made during this correction task:** PR #304's branch head has since moved to `7bcd1c8658da95119ab725f454955d57f89f8e4f` (commit `feat(imaging): F2-IMPL-001-A-R2 re-implement ImagingLifecyclePort against accepted explicit-tenant contract`, authored 2026-08-03T18:38:33+02:00, message body explicitly labeled `F2-IMPL-001-A-R2`). Direct `git diff abac5e36..7bcd1c8 -- server/src/services/imaging/public.ts` confirms: every one of the four `ImagingLifecyclePort` methods now takes an explicit, caller-supplied `clinicId` as a leading parameter, applied as a top-level, non-optional predicate on both the read (`findOwnedImage`) and every write (`markStorageMissing`/`redactForAnonymization`'s own `updateMany` `where` clause) — the commit message states this "Closes the tenant-authorization gap found by F2-IMPL-001-A-R1." The `__setImagingStorageExistenceCheckerForTest` test-seam export is unchanged and still present at this new head.
- **This task explicitly does NOT reclassify CAND-07 based on the new head.** Re-deriving a full codegraph/reference-suitability judgment of the new implementation (test-evidence depth, error-handling continuity, production-caller status, etc.) is substantive design/architecture review work belonging to `F2-IMPL-001-A-R2`, which — per the commit's own changed-files list — has already updated its own evidence pair (`docs/program/evidence/F2-IMPL-001-A_ADDITIVE_UNUSED_INTERNAL_IMAGING_FACADE_SKELETON.{md,json}`). Duplicating that judgment here would itself be exactly the kind of overstatement this correction task exists to remove. **Recommended follow-up (not performed here):** a subsequent review — either a PREP-010-C-R2 correction or a program-owner decision — should determine whether CAND-07's implementation classification should be revisited now that Finding 1 appears closed at the new head, informed by `F2-IMPL-001-A-R2`'s own evidence trail.
- §3's CAND-07 narrative and §9's "Unscoped ID-only mutation"/"Service wrappers with no actual boundary enforcement" rows are left as originally recorded (accurate as-of `abac5e36`, explicitly timestamped and scoped to that head) rather than silently rewritten, so this document's own history remains auditable.

**(B) Timestamped GitHub mergeability observation (transient, not an architectural finding):**

```
Queried: 2026-08-03 (this correction task's own gh pr view 304 check)
headRefOid: 7bcd1c8658da95119ab725f454955d57f89f8e4f
baseRefName: main
mergeable: MERGEABLE
mergeStateStatus: BLOCKED
state: OPEN
updatedAt: 2026-08-03T16:39:23Z
```

This supersedes this task's original observation (`headRefOid: abac5e36...`, `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`) purely because the branch has moved to a new commit in the interim — it is not evidence of anything having been "fixed" or "broken" about mergeability specifically, and it is not used to determine any classification in this document.

## 12. Unresolved decisions (not decided by this document)

1. Whether `findTreatmentCaseInClinic` (CAND-02) should be relocated from `utils/relationGuards.ts` into a Treatment-Case-owned module, and whether its 7 existing call sites should be migrated in one pass or incrementally.
2. Whether `resolvePatient` (CAND-03) should be exported and given a stable named type, and whether its three logical downstream consumers (`patientAnonymization.ts`, `orphanFileInspection.ts`, `deletionReviewInventory.ts`) should be required to re-call it (re-validating `clinicId`) rather than trusting a passed-in value.
3. Whether the Billing `financial-select` selector (CAND-01) should be consolidated with the structurally identical narrow-selects already embedded in `payments.ts`/`practitionerEarnings.ts` into one shared, named, tested function.
4. Whether program ownership accepts `F2-PREP-009`'s Option A design as the canonical shape for the proposed template's tenant-context element (§8.3), independent of whether PR #304 itself is ever reconciled/merged.
5. Whether a fourth reference category ("barrel/facade convention") should be added once any `public.ts` implementation actually merges to `main` — none exists today (CAND-06).
6. Whether CAND-07's implementation classification should be revisited now that PR #304's head (`7bcd1c8`) appears to close Finding 1 — explicitly flagged in §11 as not decided by this document.
7. Whether a follow-up hardening/reference-implementation task should be chartered to fill the canonical scoped-mutation-contract gap identified in §4 — recommended, not authorized, by this document.

## 13. Validation performed

All commands below were run from the task-local isolated worktree repository root. Each command's expected success output and non-zero-exit failure behavior is stated inline.

1. **JSON parse.**
   ```
   node -e "JSON.parse(require('fs').readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); console.log('JSON_OK')"
   ```
   Expected success output: `JSON_OK`. Failure behavior: non-zero exit with a `SyntaxError` message identifying the invalid position.

2. **Candidate-ID uniqueness.**
   ```
   node -e "const j=JSON.parse(require('fs').readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); const ids=j.candidates.map(c=>c.id); const dupes=ids.filter((v,i)=>ids.indexOf(v)!==i); if(dupes.length) {console.error('DUPES:',dupes); process.exit(1);} console.log('UNIQUE_OK', ids.length)"
   ```
   Expected success output: `UNIQUE_OK 7`. Failure behavior: non-zero exit, prints the duplicated ID(s).

3. **Candidate count parity (Markdown headings vs. JSON array length).**
   ```
   node -e "const fs=require('fs'); const md=fs.readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_REFERENCE_PUBLIC_CONTRACT_PATTERN_INVENTORY.md','utf8'); const j=JSON.parse(fs.readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); const mdCount=(md.match(/^### CAND-\d\d/gm)||[]).length; if(mdCount!==j.candidates.length){console.error('MISMATCH', mdCount, j.candidates.length); process.exit(1);} console.log('COUNT_OK', mdCount)"
   ```
   Expected success output: `COUNT_OK 7`. Failure behavior: non-zero exit, prints both counts.

4. **Classification parity (every candidate has a non-empty classification in both files).**
   ```
   node -e "const j=JSON.parse(require('fs').readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); const missing=j.candidates.filter(c=>!c.classification||(typeof c.classification==='object'&&Object.keys(c.classification).length===0)); if(missing.length){console.error('MISSING_CLASSIFICATION', missing.map(c=>c.id)); process.exit(1);} console.log('CLASSIFICATION_OK', j.candidates.length)"
   ```
   Expected success output: `CLASSIFICATION_OK 7`. Failure behavior: non-zero exit, prints the candidate ID(s) missing a classification.

5. **Markdown/JSON candidate-ID parity.**
   ```
   node -e "const fs=require('fs'); const md=fs.readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_REFERENCE_PUBLIC_CONTRACT_PATTERN_INVENTORY.md','utf8'); const j=JSON.parse(fs.readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); const mdIds=[...md.matchAll(/^### (CAND-\d\d)/gm)].map(m=>m[1]).sort(); const jIds=j.candidates.map(c=>c.id).sort(); if(JSON.stringify(mdIds)!==JSON.stringify(jIds)){console.error('MISMATCH', mdIds, jIds); process.exit(1);} console.log('PARITY_OK', mdIds.join(','))"
   ```
   Expected success output: `PARITY_OK CAND-01,CAND-02,CAND-03,CAND-04,CAND-05,CAND-06,CAND-07`. Failure behavior: non-zero exit, prints both ID lists.

6. **Selected-reference-base parity (exactly 3, same 3 IDs, in both files, all flagged correctly).**
   ```
   node -e "const j=JSON.parse(require('fs').readFileSync('docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json','utf8')); const sel=j.selectedReferences||[]; if(sel.length!==3){console.error('COUNT', sel.length); process.exit(1);} const bad=sel.filter(s=>s.status!=='SELECTED_REFERENCE_BASE'||!s.hardeningRequiredBeforeCanonicalAdoption||!s.notApprovedAsCanonicalContract); if(bad.length){console.error('FLAG_MISSING', bad.map(b=>b.candidateId)); process.exit(1);} console.log('SELECTED_REFERENCE_BASE_OK', sel.map(s=>s.candidateId).join(','))"
   ```
   Expected success output: `SELECTED_REFERENCE_BASE_OK CAND-01,CAND-02,CAND-03`. Failure behavior: non-zero exit, either a count mismatch or a list of entries missing a required flag.

7. **Forbidden canonical-ready wording check (neither file may claim a candidate is a ready/canonical reference contract).**
   ```
   grep -inE "ready reference contract|canonical (scoped )?mutation contract exists|approved as canonical" docs/program/evidence/F2-GUARDRAIL-PREP-010-C_REFERENCE_PUBLIC_CONTRACT_PATTERN_INVENTORY.md docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json | grep -v "grep -inE"
   ```
   Expected success output: no output, exit code 1 (grep's own "no match" exit code — this is the PASSING result for this specific check). The trailing `| grep -v "grep -inE"` excludes this check's own documented command text (which necessarily contains the pattern being searched for, since this section quotes the command verbatim) from counting as a match — run during this correction pass, the raw command (without the exclusion) matches exactly 2 lines, both being that self-referencing documented-command text, confirmed by manual inspection to be the check's own command listing, not an actual claim. Failure behavior: any other matching line printed, exit code 0, indicates forbidden wording is present and must be removed.

8. **Changed-file scope (only the two evidence files differ from `origin/main`).**
   ```
   git diff --stat origin/main...HEAD
   ```
   Expected success output: exactly two files listed, both under `docs/program/evidence/F2-GUARDRAIL-PREP-010-C_*`. Failure behavior: any other path listed indicates an out-of-scope change and must be investigated before commit/push.

9. **Local absolute path check (no machine-local absolute path leaked into a deliverable).**
   ```
   grep -inE "E:\\\\Ek Gelir|C:\\\\Users\\\\Mustafa" docs/program/evidence/F2-GUARDRAIL-PREP-010-C_REFERENCE_PUBLIC_CONTRACT_PATTERN_INVENTORY.md docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json
   ```
   Expected success output: no output, exit code 1 (grep's "no match" — the PASSING result). Failure behavior: any matching line printed, exit code 0, indicates a local path leaked into the deliverable and must be removed/genericized.

Results of running all nine commands during this correction pass are recorded in §17 (Validation) of the delivery report.

## 14. Deliverables

- `docs/program/evidence/F2-GUARDRAIL-PREP-010-C_REFERENCE_PUBLIC_CONTRACT_PATTERN_INVENTORY.md` (this file).
- `docs/program/evidence/F2-GUARDRAIL-PREP-010-C_reference_public_contract_pattern_inventory.json` (structured companion).

No other file is created or modified by this task.

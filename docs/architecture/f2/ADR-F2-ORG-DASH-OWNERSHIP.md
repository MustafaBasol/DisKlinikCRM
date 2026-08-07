# ADR-F2-ORG-DASH-OWNERSHIP — Domain ownership of `server/src/routes/organizationDashboard.ts`

- **Task:** F2-ADR-ORG-DASH-002 — Resolve organizationDashboard Domain Ownership Ambiguity
- **Phase:** F2 — Modular Monolith Boundary Remediation / Guardrail Signal Quality
- **Status:** `ACCEPTED (agent-level record, pending external review)` — same convention as the ADR statuses recorded by F0-008 in [`docs/program/ARCHITECTURE_DECISIONS.md`](../../program/ARCHITECTURE_DECISIONS.md): an agent may not declare an ADR binding program policy before external review.
- **Date:** 2026-08-06
- **Baseline:** `origin/main` @ `46acae8415020cb0bd340fbc854c4187c43e3662` (merge commit of PR #328)
- **Branch:** `docs/f2-adr-org-dashboard-002-ownership`
- **Evidence document:** [`docs/program/evidence/F2-ADR-ORG-DASH-002_ORGANIZATION_DASHBOARD_OWNERSHIP.md`](../../program/evidence/F2-ADR-ORG-DASH-002_ORGANIZATION_DASHBOARD_OWNERSHIP.md)

### Location and numbering note

The assigning brief suggested `docs/program/adr/ADR-F2-ORG-DASH-OWNERSHIP.md`. **No `docs/program/adr/` directory exists in this repository.** The established convention is: the numbered ADR *index* lives at `docs/program/ARCHITECTURE_DECISIONS.md` (ADR-001…ADR-017, all assigned by the authorized F0-008 review), and full ADR *content* lives under `docs/architecture/` — including an existing F2 subdirectory (`docs/architecture/f2/F2-SEC-002-PROD-PREP-001.md`). This document therefore follows the repository convention rather than the brief's literal path.

**No registry number (e.g. `ADR-018`) is claimed by this task.** Assigning a new number in `ARCHITECTURE_DECISIONS.md` extends a program-owner-controlled sequence created by a specifically authorized review task; that is deliberately left as a program-owner action and recorded as an open follow-up, not performed here. `ARCHITECTURE_DECISIONS.md` is **not** modified by this task.

---

## 1. Context

`server/src/routes/organizationDashboard.ts` (250 lines at the baseline SHA) is the last file in the architecture-guardrail domain map (`scripts/architecture-guardrail/config/domain-map.json`) carrying the value `UNRESOLVED`, and the last of four ownership collisions declared by the F0-003 module-ownership inventory to remain open.

The collision originates in F0-003 itself, which lists the same file under the backend `routes` array of **two** domains:

- `core-org-clinic-membership` (`docs/program/evidence/F0-003_module_ownership_inventory.json:47`)
- `reporting-analytics` (`docs/program/evidence/F0-003_module_ownership_inventory.json:776`)

`F2-PREP-001` (`F2-PREP-001_domain_ownership_inventory.json:130,141,2186,2192`) reproduced the same dual listing rather than adjudicating it. F2-GUARDRAIL-VAL-001 §9 classified it as "collision #4 — the one genuine, unresolved content-level ambiguity of the four", requiring a program-owner ADR. F2-GUARDRAIL-VAL-002 resolved the other three collisions and closed the domain-map coverage gap to 0/247 unmapped, but §5.5 of its evidence deliberately left this entry `UNRESOLVED`. F2-ADR-ORG-DASH-001 (PR #328, merged) removed the `financeDashboard.ts → routes/organizationDashboard.ts` route-to-route import by relocating `getDateRange` to `utils/helpers.ts` (`core-shared-platform-infrastructure`), and explicitly recorded that it did **not** resolve this ownership question.

This ADR adjudicates it.

## 2. Current ambiguity — precisely stated

The ambiguity is **not** a data gap; both candidate answers are individually defensible from a different slice of the file:

| Slice of the file | Points to |
|---|---|
| Route path, authorization gate, tenant-scope derivation, response row identity, sole frontend consumer | `core-org-clinic-membership` |
| Body content: ~145 of 250 lines of counting/aggregation/ranking over Appointment, Patient, TreatmentCase, Payment | `reporting-analytics` |

The question is therefore *which slice determines ownership* — a policy question, which is why it required an ADR rather than a map correction.

## 3. Decision drivers

Ordered by weight, each independently verified against source at the baseline SHA (full evidence in the companion evidence document §3–§7):

**D1 — Authorization semantics (decisive).** The route is gated by `authorize(['OWNER', 'ORG_ADMIN'])` plus `canAccessOrganizationDashboard()`, which is a one-line alias of `isOrganizationAdmin()` (`utils/roles.ts:118-133`). `utils/roles.ts` defines a *separate* `canAccessReports()` returning `OWNER | ORG_ADMIN | CLINIC_MANAGER | BILLING` (`:200-208`), and every single endpoint in `routes/reports.ts` — the anchor file of `reporting-analytics` — uses exactly `authorize(['OWNER','ORG_ADMIN','CLINIC_MANAGER','BILLING'])` (`:11, :155, :221, :323, :394`). `organizationDashboard.ts`'s gate is strictly narrower and is **byte-identical to the organization-administration gate** used by `routes/organizationBranches.ts` (`:186, :333, :425`), the uncontested anchor file of `core-org-clinic-membership`. The file's authorization signature is organization-administration, not reporting.

**D2 — Security-scope derivation from `core-org-clinic-membership`-owned state (decisive).** Lines 72–85 derive the request's own clinic scope from `req.user.canAccessAllClinics`, `req.user.allowedClinicIds`, and `prisma.clinic.findMany({ where: { organizationId, status: { not: 'cancelled' } } })`. `Clinic` and `UserClinic` are `core-org-clinic-membership`-owned models (F0-003, F2-PREP-001); `reporting-analytics` owns **zero** Prisma models. Assigning the file to `reporting-analytics` would declare that a reporting module reads the organization domain's tenant-critical membership tables *to compute its own security boundary* — a strictly worse boundary posture that would create a new tracked cross-domain access into the program's most tenant-sensitive model family. Scope derivation belongs to the domain that owns the membership model.

**D3 — Accepted ownership of the sole consumer.** `src/pages/OrganizationDashboard.tsx` — the only frontend consumer of `GET /api/organization/dashboard` — is already listed under `core-org-clinic-membership`'s `ownedFrontend` in **both** F0-003 and F2-PREP-001. `reporting-analytics`'s `ownedFrontend` contains only `Reports.tsx` and `Dashboard.tsx`. This is pre-accepted evidence requiring no new judgment: the endpoint's consumer is already organization-owned, and splitting a page from its own endpoint across domains would create a boundary with no compensating benefit.

**D4 — Response identity is a branch directory.** Each row carries `clinicId`, `clinicName`, `clinicSlug`, `status`, `address` alongside its metrics. `clinicSlug`, `status`, and `address` have no analytic meaning; the file's own header comment (`:20`) states `clinicSlug` exists "frontend navigasyon için" (for frontend navigation) into the branch pages. The response is the organization's branch directory, enriched with metrics — not a report.

**D5 — Existing repository precedent for "dashboard" routes.** The accepted domain map does not treat "dashboard" as implying reporting ownership: `routes/financeDashboard.ts` → `finance-advanced-compensation`, while `routes/dashboard.ts` → `reporting-analytics`. Dashboard routes are already owned by their subject domain. Classifying by filename was explicitly forbidden by this task's brief and is also inconsistent with the map as it stands.

**D6 — `reporting-analytics` is a known aggregation risk.** F2-PREP-001 describes it as `maturity: shared/ambiguous`, `couplingLevel: HIGH (high fan-out — "god module" signature)`, owning no models and being "purely a cross-cutting read surface". Adding a route there is close in spirit to the brief's explicit prohibition on creating a broad "dashboard" dumping-ground domain.

**D7 (counter-driver, honestly weighted) — body content is reporting-shaped.** Lines 95–240 are genuinely metric aggregation and insight ranking. However, this computation is: not exported, has zero importers, is not reused by any other module, and is not contract-mediated. It is an internal read concern of one handler, not a shared reporting capability. Under the same test, `financeDashboard.ts` is equally aggregation-heavy and is nonetheless finance-owned.

## 4. Options considered

**Option A — Fundamentally organization-owned, reporting queries as internal read concerns. → SELECTED.**
Owner: `core-org-clinic-membership`. Supported by D1–D6; only D7 argues against, and D7 describes implementation shape rather than responsibility.

**Option B — Fundamentally reporting-owned, organization scope merely a filter. → REJECTED.**
This mischaracterizes the code. The organization scope is not a filter applied to a report; it *is* the security boundary, derived from membership state the reporting domain does not own (D2), gated by a permission the reporting domain does not use (D1), rendering a branch directory the organization domain already owns the page for (D3, D4). Accepting B would also route four new cross-domain reads *into* `Clinic`/`UserClinic`, worsening the very boundary posture F2 exists to improve.

**Option C — True mixed-responsibility route requiring a physical split into separately owned route/service modules. → REJECTED FOR NOW (not rejected in principle).**
The file contains exactly **one** handler producing **one** composed response, in which `summary` and `insights` are both derived from the same `clinicMetrics` array (`:197–240`). A split would require: (a) a new reporting-owned service receiving a pre-authorized clinic-id scope; (b) that service still reading `Appointment`, `Patient`, `TreatmentCase`, and `Payment` directly — relocating the cross-domain reads rather than removing them; (c) at least four new public read contracts to do it properly; (d) recomposition of `summary`/`insights` across the boundary, which is exactly where response-shape drift would be introduced. That is a multi-contract change with response-shape risk, which this task's implementation-authorization boundary (§E of the brief) requires be stopped and reported rather than performed. Splitting is also premature: the file has zero importers, so no consumer is currently harmed by its monolithic shape.

**Option D — Composition/API-shell owned by one domain, consuming accepted public contracts from another. → ACCEPTED AS TARGET END-STATE, NOT ACHIEVABLE NOW.**
D is where this file should ultimately land: `core-org-clinic-membership` owns the shell, authorization, and clinic-scope derivation; the appointment / patient / treatment-case / payment metric reads become accepted public read contracts owned by their respective domains. **The required contracts do not exist today** (`reporting-analytics` owns no models and exposes no contract; no `AppointmentMetrics`/`PaymentAggregate`/`PatientCounts`/`TreatmentCaseCounts` contract exists anywhere in the repository). D is therefore recorded as the migration target and named as a follow-up task, not implemented here. Note that Option A is the *correct first step toward* D — D presupposes that the shell has a single owner, which is exactly what A establishes.

## 5. Decision

**`server/src/routes/organizationDashboard.ts` is owned by `core-org-clinic-membership`.**

- Final owning domain: `core-org-clinic-membership`. **Confidence: HIGH.**
- **No code split is a prerequisite** for assigning this ownership. The file has zero importers and exports only `export default router`; ownership assignment has no blast radius on the import graph.
- The declared **target end-state remains Option D**; reaching it requires public read contracts that do not yet exist, tracked as follow-up `F2-ORG-DASH-METRICS-CONTRACT` (proposed ID, not yet scheduled).

### 5.1 What this decision explicitly does NOT resolve

The handler's **direct cross-domain Prisma reads of `Appointment`, `Patient`, `TreatmentCase`, and `Payment`** remain open technical debt. This ADR *increases* the visibility of that debt rather than reducing it: under `reporting-analytics` those reads would be domain-normal (that domain is defined as a cross-cutting read surface), whereas under `core-org-clinic-membership` they are explicit, non-normalized cross-domain accesses requiring a contract. This is stated deliberately — the decision was not chosen to minimize recorded debt, and it does not.

These reads are **not detectable by the current guardrail** in either case: `lib/edgeExtraction.ts` is "deliberately syntactic only… detectable symbol imports, not semantic Prisma-model access" (file header, `:8-10`). No finding is created or suppressed by this change on that axis.

## 6. Consequences

**Positive**
- The domain map reaches 0 `UNRESOLVED` entries (247/247 scan-root files mapped to a real domain); the last F0-003 ownership collision closes.
- Guardrail signal quality improves: 5 findings previously labelled `callerDomain: UNRESOLVED` now carry a real caller domain, making them reviewable as genuine cross-domain edges rather than "unknown owner" noise.
- Security-scope derivation and membership-model access are same-domain, which is the correct posture.
- Frontend page and backend endpoint are owned by the same domain.

**Negative / accepted cost**
- Four cross-domain model-read families become explicit, non-normalized debt (§5.1) and must be tracked.
- `core-org-clinic-membership`'s recorded responsibility surface grows to include an aggregation-heavy read endpoint until Option D is executed.

**Enforcement impact**
- **None.** Blocking guardrail enforcement remains unauthorized and is not enabled by this task. The guardrail remains report-only (`cli.ts` exit-code contract: findings still exit 0). Resolving this entry removes one documented blocker from F2-GUARDRAIL-VAL-001's enforcement-readiness checklist (the `UNRESOLVED`-target false-positive family) but does not by itself make enforcement ready — the 88 pre-classified-but-formally-`NEW` findings and the `callerSymbol` baseline match-key limitation both remain open, per F2-GUARDRAIL-VAL-002 §9/§10.

## 7. Tenant and security impact

**Zero.** No application source file is modified by this task. `server/src/routes/organizationDashboard.ts`, `server/src/utils/roles.ts`, `server/src/middleware/auth.ts`, and `server/src/index.ts` are byte-identical to the baseline. Organization filter (`organizationId`), clinic filter (`scopeClinicIds`), role gate, `canAccessOrganizationDashboard()` check, `deletedAt: null` patient filters, and route registration are all unchanged. The changed artifacts are one static-analysis config value and documentation. See the evidence document §9 for the itemized security review.

## 8. Migration impact, backward compatibility, rollback

- **Migration:** none. No Prisma schema or migration file is touched.
- **Backward compatibility:** total. No API response shape, route path, HTTP method, status code, query parameter, or authorization rule changes. `GET /api/organization/dashboard` is behaviourally identical.
- **Rollback:** `git revert <commit-sha>` of this task's single implementation commit restores `"server/src/routes/organizationDashboard.ts": "UNRESOLVED"` and removes the provenance note. No data, schema, or deployment rollback is implied because none is performed.

## 9. Follow-up tasks

1. **`F2-ORG-DASH-METRICS-CONTRACT` (proposed, not scheduled)** — execute Option D: define accepted public read contracts for the appointment / patient / treatment-case / payment metric reads currently performed directly by this handler, so it becomes a true composition shell. Prerequisite for closing §5.1's debt.
2. **ADR registry numbering (program owner)** — decide whether this ADR receives a number in `docs/program/ARCHITECTURE_DECISIONS.md`. Not claimed by this task.
3. **Baseline-entry authoring for the 88 pre-classified findings** — unchanged, still open from F2-GUARDRAIL-VAL-002 §9/§16; not affected by this ADR.
4. **Enforcement-readiness re-measurement** — a fresh stratified false-positive sample after this and VAL-002's corrections; still open from F2-GUARDRAIL-VAL-001 §10.

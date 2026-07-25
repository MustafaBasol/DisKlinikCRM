# KVKK H-4 — BILLING Payment Response Field Exposure: Independent Validation

Status: **Evidence / characterization only.** No application code, tests, schema, migrations, frontend, configuration, trackers, or production systems were modified. This document does not close, does not reopen, and does not itself reclassify any tracker entry — it supplies evidence for a later reconciliation step.

## 1. Task and scope

Validate whether H-4 ("`/api/payments` may over-expose `treatmentCase.description`, `treatmentCase.lostReason`, or other clinical/free-text fields to the `BILLING` role through an unrestricted Prisma `include`") describes a real, currently reachable, HTTP-response-level over-exposure, and if so, exactly which endpoint(s), fields, and roles are affected.

Explicitly out of scope (not inspected, not commented on): the `reports.ts` GROUP BY bug, other KVKK findings (G-1, H-1, H-2, H-6 batches, etc.), reporting/accounting/invoice modules, messaging modules, patient clinical/treatment workflow pages beyond what's needed to judge `/api/payments` reachability, and any production system or production data.

## 2. Baseline

- `origin/main` fetched and confirmed. Current `origin/main` HEAD at validation time: `821578f2e08f6d8715144e1643a725d704c79b96` ("docs(kvkk): validate H-2 messaging connection authorization (#227)").
- `git merge-base --is-ancestor 821578f2e08f6d8715144e1643a725d704c79b96 origin/main` → **true** (it is in fact the current tip of `origin/main`, not merely an ancestor).
- Audit worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-h4-billing-payments-audit`, created fresh from `origin/main` (HEAD `821578f`), on branch `audit/kvkk-h4-billing-payments-field-exposure`. No existing worktree was reused or deleted; the primary working tree (`docs/kvkk-20260720-production-reconciliation`) was not touched.

## 3. Files inspected

- `server/src/routes/payments.ts` (full file, 269 lines — all 5 routes)
- `server/src/routes/treatmentCases.ts` (lines 1–110 — the sibling full-list and `financial-select` routes, used as the in-repo reference pattern)
- `server/src/utils/clinicScope.ts` (`buildClinicIdScope`/`validateAndGetClinicIdScope`, `getAccessibleClinicIds`, `resolveEffectiveClinicId` — the shared org/clinic scoping helper)
- `server/src/utils/roles.ts` (`normalizeRole`, `canViewFinancialData`, `canViewFinanceDashboard`, etc.)
- `server/src/utils/prismaSelects.ts` (`patientContactSelect` and other shared narrow selects)
- `server/prisma/schema.prisma` — `Payment` (L701–726) and `TreatmentCase` (L476–515) models, to enumerate every scalar field that a bare `include` would pull in
- `server/src/tests/paymentBillingEdit.test.ts`, `server/src/tests/paymentValidation.test.ts`, `server/src/tests/billingFinancialTreatmentCaseSelect.test.ts` (the only test files touching BILLING + payments/treatment-case field scope)
- `src/services/api.ts` (`paymentService` — frontend call sites for `/api/payments`)
- `src/pages/Payments.tsx`, `src/pages/PaymentPlans.tsx`, `src/pages/PatientDetail.tsx`, `src/pages/TreatmentCaseDetail.tsx`, `src/components/PaymentForm.tsx`, `src/components/ReceiptModal.tsx` (every frontend consumer of `paymentService.getAll`/`getReceipt`, for reachability/UI-usage context only)
- `git log --oneline -- server/src/routes/payments.ts` (history skim, no content changes reviewed beyond confirming the `include` shape is long-standing, not a recent regression)

Not inspected (out of scope per task instructions): `server/src/routes/reports.ts`, `server/src/routes/paymentPlans.ts` (not imported by `payments.ts`), messaging/WhatsApp/Instagram routes, patient clinical-record routes beyond the treatment-case model definition.

## 4. Endpoint inventory (`server/src/routes/payments.ts`)

All routes are mounted under `/api` behind the global `authenticate` middleware (populates `req.user.organizationId`, `allowedClinicIds`, `canAccessAllClinics`, `normalizedRole`).

| Method | Route | `authorize()` roles | Line | BILLING reachable |
|---|---|---|---|---|
| GET | `/payments` | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING, DENTIST, RECEPTIONIST | L17 | Yes |
| POST | `/payments` | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING, RECEPTIONIST | L64 | Yes |
| PUT | `/payments/:id` | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING | L129 | Yes |
| PATCH | `/payments/:id/cancel` | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING | L204 | Yes |
| GET | `/payments/:id/receipt` | OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING, RECEPTIONIST | L246 | Yes |

Only `GET /payments` (the list endpoint) returns a `treatmentCase` object shaped by a bare Prisma `include` (L49–53). The other four routes either return the flat `Payment` row only (POST/PUT/PATCH — no `treatmentCase` relation loaded) or use an explicit narrow `select` (the receipt endpoint, L253–260). **H-4 is specific to `GET /api/payments`.**

## 5. Exact response fields

`GET /payments` query (L45–56):

```ts
const payments = await prisma.payment.findMany({
  where,
  include: {
    patient: { select: patientContactSelect },       // id, firstName, lastName, email, phone
    treatmentCase: {
      include: {                                      // <-- no `select` on treatmentCase itself
        practitioner: { select: { firstName: true, lastName: true } },
      },
    },
  },
  orderBy: { createdAt: 'desc' },
});
res.json(payments);                                   // L57 — no post-processing, no field stripping
```

Because `treatmentCase` uses a nested `include` (not `select`), Prisma returns **every scalar column of `TreatmentCase`** plus the explicitly included `practitioner`. Per `schema.prisma` L476–515, that scalar set is:

`id, clinicId, patientId, practitionerId, appointmentTypeId, title, description, stage, estimatedAmount, acceptedAmount, currency, expectedStartDate, closedAt, lostReason, createdById, createdAt, updatedAt, deletedAt`

`res.json(payments)` at L57 serializes this object graph directly with no filtering step. There is no DTO/mapper layer between the Prisma result and the HTTP response for this route.

Base `Payment` row fields (schema L701–726, all returned, all financial/operational — `amount, currency, paymentMethod, paymentStatus, paidAt, notes, createdById, createdAt, updatedAt`) are appropriate for BILLING and not at issue here. `Payment.notes` is a payment-specific free-text field (e.g. reconciliation remarks) and is in scope for BILLING by design (confirmed billable/editable by BILLING in `paymentBillingEdit.test.ts`).

## 6. Confirmed excessive fields

Reached and serialized in the `GET /api/payments` HTTP response, for every role authorized on that route (including BILLING):

- `treatmentCase.description` — free-text treatment description entered by clinical/reception staff. **Confirmed exposed** (not merely Prisma-loaded — it is present in the JSON returned by `res.json(payments)`).
- `treatmentCase.lostReason` — free-text reason a case was marked lost (`stage: 'lost'`). **Confirmed exposed.**
- `treatmentCase.stage` — case pipeline stage (`new/quote_sent/in_progress/completed/lost`). Confirmed exposed; operational rather than clinical, lower sensitivity but still unnecessary for a billing list view.
- `treatmentCase.expectedStartDate`, `closedAt`, `appointmentTypeId`, `practitionerId`, `createdById`, `deletedAt` — internal/operational fields, confirmed exposed, not clinical free text but not needed for billing display either.

No dedicated "treatment-plan notes", "patient clinical notes", "procedure description", "diagnosis" field, "internal staff notes" field, or "attachment metadata" field exists on `TreatmentCase` or is reachable through this `include` — `TreatmentCase.description` and `TreatmentCase.lostReason` are the only free-text fields on the included model, and they are the two the finding names directly.

## 7. Fields initially suspicious but not exposed

- **Patient clinical notes / diagnosis text**: the `patient` relation uses `patientContactSelect` (`id, firstName, lastName, email, phone` only — `server/src/utils/prismaSelects.ts` L30–36). No patient clinical field of any kind reaches this response.
- **Procedure descriptions**: `TreatmentPlanProcedure` is a separate model, not included by this query at all.
- **Attachment metadata**: no attachment/document relation is included by this query.
- **Internal staff notes distinct from `description`/`lostReason`**: `TreatmentCase` has no separate "internal notes" field; only `description` and `lostReason` are free text.
- **Diagnosis-like text on the practitioner**: `practitioner` is explicitly narrowed to `{ firstName, lastName }` (L51) — already correctly scoped, no leak there.

A field is "loaded" the moment Prisma resolves the query; the fields listed in §6 are the ones actually confirmed present in the serialized `res.json(payments)` payload, per direct reading of L45–57 (no intermediate mapping exists that could strip them before serialization).

## 8. Frontend reachability context

Every frontend consumer of `paymentService.getAll` (`src/services/api.ts:273`, which calls `GET /payments`) was checked for `treatmentCase` field usage:

| File | Fields read from `treatmentCase` |
|---|---|
| `src/pages/Payments.tsx` (L236, L243) | `.title`, `.practitioner.{firstName,lastName}` |
| `src/pages/PaymentPlans.tsx` (L184, L454) | `.title` |
| `src/pages/PatientDetail.tsx` (L874) | `.treatmentCaseId` only (via `p.treatmentCaseId`, not the nested object) |
| `src/pages/TreatmentCaseDetail.tsx` | uses `paymentService.getAll` for its own payments-by-case list; does not read `.description`/`.lostReason` from the payment response (it already has the full treatment case loaded separately) |

No frontend code reads `.description`, `.lostReason`, `.stage`, `.expectedStartDate`, `.closedAt`, or any other of the fields in §6 from a payments-list response. The frontend **receives but silently ignores** the excess fields — it does not display them. This means:

- Normal UI use (BILLING staff using the Payments screen) never surfaces the free text on screen.
- A direct API call (browser dev-tools Network tab, a saved auth token used with `curl`/Postman, or any script consuming the JSON) **does** expose `description` and `lostReason` in the raw response body, regardless of what the UI renders.

Note (out-of-scope observation, recorded for completeness only, not part of this finding): `paymentService.getById` (`src/services/api.ts:274`) calls `GET /payments/:id`, but no such route exists in `payments.ts` — this appears to be dead/unused frontend code (no call site found). Not investigated further; unrelated to H-4.

## 9. Clinic / organization scope

`GET /payments` builds its `where` via `validateAndGetClinicIdScope(req.user!, selectedClinicId, res)` (L22), which delegates to `buildClinicIdScope` in `clinicScope.ts`. That helper:

- Always requires the target clinic to belong to `req.user.organizationId` (DB-verified, `clinicScope.ts` clinic-lookup pattern shared with `buildClinicScopeWhere`).
- Restricts to `user.allowedClinicIds` unless `canAccessAllClinics` is true, in which case it resolves to all clinics **within that same organization** (never cross-organization).
- Returns `false`/403 (via `validateAndGetClinicIdScope`) if the requested clinic isn't in the user's organization or isn't in their assigned set.

DENTIST additionally gets a row-level `OR` filter restricting to their own patients/cases (L27–32); BILLING gets no such extra row filter, only the clinic/org scope common to all roles on this route.

**Conclusion: the over-exposure is a same-organization, same-assigned-clinic issue only.** It is not a cross-tenant or cross-organization gap — a BILLING user cannot use this endpoint to see another organization's or another (unassigned) clinic's data. The excess fields are only visible for payments/treatment cases the user's role+clinic assignment already legitimately covers at the row level; the defect is column-level (too many fields), not row-level (wrong tenant/clinic).

## 10. Role matrix — are OWNER/ORG_ADMIN/CLINIC_MANAGER/DENTIST/RECEPTIONIST/BILLING intentionally different?

| Role | Authorized on `GET /payments`? | Authorized on `GET /treatment-cases` (full, clinical) | Authorized on `GET /treatment-cases/financial-select` (narrow) | Marginal exposure from the `/payments` gap |
|---|---|---|---|---|
| OWNER | Yes | Yes | Yes | None — already sees full treatment-case data elsewhere |
| ORG_ADMIN | Yes | Yes | Yes | None |
| CLINIC_MANAGER | Yes | Yes | Yes | None |
| DENTIST | Yes | Yes (own cases via `practitionerId` filter) | Yes | None — already sees full treatment-case data for their own cases |
| RECEPTIONIST | Yes | Yes | Yes | None — already sees full treatment-case data elsewhere |
| BILLING | Yes | **No** (`treatmentCases.ts` L30 authorize list excludes BILLING) | Yes | **Full** — `/payments` is the only route where BILLING can see `treatmentCase.description`/`lostReason`; it is not reachable to BILLING anywhere else, and a narrow alternative (`financial-select`) already exists specifically to avoid this |

This confirms the roles are intentionally differentiated elsewhere in the codebase (`treatmentCases.ts` explicitly excludes BILLING from the clinical full-list route, and a dedicated `financial-select` narrow route was built for BILLING — see §11), but `payments.ts`'s own `GET /payments` query was not updated to match that pattern when `treatmentCase` was added to its `include`.

## 11. Existing narrow-select / receipt pattern that should be reused

Two precedents already exist in this codebase for exactly this problem, both un-applied to `GET /payments`:

1. **`GET /payments/:id/receipt`** (`payments.ts` L253–260, same file) already uses an explicit narrow `select` for `treatmentCase`:
   ```ts
   treatmentCase: { select: { title: true, estimatedAmount: true, acceptedAmount: true, currency: true } },
   ```
2. **`GET /treatment-cases/financial-select`** (`treatmentCases.ts` L58–98) was built specifically so BILLING (which is *not* authorized on the full `/treatment-cases` list, L30) can resolve a patient's treatment cases "without exposing clinical data (procedures, notes, dental chart, attachments, activity logs)" (comment at L59–61), returning only `id, title, patientId, clinicId, stage, estimatedAmount, acceptedAmount, currency, createdAt, updatedAt, totalPaid, remainingBalance`. This pattern is directly asserted by `server/src/tests/billingFinancialTreatmentCaseSelect.test.ts`.

`GET /payments` should reuse this same field set rather than inventing a third shape.

## 12. Test coverage

- `server/src/tests/paymentBillingEdit.test.ts` (25 tests, all passing) — covers only PUT/PATCH mutation guards (BILLING cannot repoint `patientId`/`treatmentCaseId`). No assertions on GET response shape.
- `server/src/tests/paymentValidation.test.ts` (9 tests, all passing) — covers `paymentSchema` input validation only.
- `server/src/tests/billingFinancialTreatmentCaseSelect.test.ts` (13 tests, all passing) — asserts the narrow field set for `/treatment-cases/financial-select`, **not** for `/payments`.

**No existing test asserts the field shape of the `GET /api/payments` HTTP response for any role, BILLING included.** This is the coverage gap that let the `include`-vs-`select` inconsistency between `payments.ts` and `treatmentCases.ts` go unnoticed.

All three suites were run in the isolated audit worktree (`npx tsx src/tests/....test.ts`, after `npm install` + `npx prisma generate` — dependencies were absent in the fresh worktree, none of which touches the primary working tree) and pass unmodified. `npm run typecheck` (`prisma generate && tsc --noEmit`) also passes with no errors.

## 13. Severity assessment

- **Data sensitivity**: `treatmentCase.description` and `lostReason` are free text written by clinical/reception staff about a patient's treatment case. They plausibly contain health-adjacent content (e.g., why a proposed treatment was declined, clinical rationale) even though the field is not a dedicated "diagnosis" column. Treated as potentially sensitive personal health data under KVKK for this assessment.
- **Role least-privilege**: violated — the codebase's own established pattern (§11) treats BILLING as needing only financial fields from treatment cases; this route contradicts that pattern for itself alone.
- **Tenant/clinic boundary**: intact (§9) — same-org, same-assigned-clinic only. Not a cross-tenant bug.
- **Direct API reachability**: confirmed — no exploit or privilege escalation needed; any authenticated BILLING session's normal list call returns the fields in the JSON body today.
- **Free-text health-data risk**: plausible, not certain — content is user-entered and variable.
- **Volume**: every payment record with a non-null `treatmentCaseId`, across every clinic/organization using the product — routine, not edge-case, since it's the main payments list view.
- **Remediation complexity**: low — replace the nested `include` with a `select` mirroring the existing receipt/`financial-select` field set (§11); no schema, migration, or client-visible contract change beyond removing unused JSON keys the frontend never reads (§8).
- **Regression risk**: low — confirmed no frontend code (§8) reads any of the fields that would be removed; existing passing tests (§12) do not assert on them either.

## 14. Final classification

**`CODE_REMEDIATION_RECOMMENDED`**

Rationale: this is a real, directly reachable, HTTP-response-level over-exposure of free-text fields to a role the codebase's own design intends to keep on a narrow financial field set — but it is properly clinic/org-scoped (no cross-tenant gap), affects only column selection (not row-level access), has a low-complexity fix with an already-established in-repo pattern to copy, and carries low regression risk. It does not rise to a cross-tenant authorization gap or an onboarding blocker.

## 15. Smallest remediation recommendation

In `server/src/routes/payments.ts`, `GET /payments` (L45–56), replace:

```ts
treatmentCase: {
  include: {
    practitioner: { select: { firstName: true, lastName: true } },
  },
},
```

with a `select` mirroring the existing `financial-select`/receipt field set, e.g.:

```ts
treatmentCase: {
  select: {
    id: true,
    title: true,
    stage: true,
    estimatedAmount: true,
    acceptedAmount: true,
    currency: true,
    practitioner: { select: { firstName: true, lastName: true } },
  },
},
```

No other route in `payments.ts` needs a change (POST/PUT/PATCH don't include `treatmentCase`; the receipt route already uses a narrow `select`).

## 16. Exact proposed code files (not modified in this audit)

- `server/src/routes/payments.ts` — narrow the `treatmentCase` include on `GET /payments` as shown in §15.
- Optionally, `server/src/utils/prismaSelects.ts` — extract a shared `treatmentCaseFinancialSelect` constant (matching the field set already used by `treatmentCases.ts`'s `financial-select` route and the receipt route) so all three call sites (`payments.ts` GET list, `payments.ts` receipt, `treatmentCases.ts` financial-select) share one definition instead of three independently-maintained field lists.

## 17. Exact proposed tests (not added in this audit)

- A route-level test for `GET /api/payments` (new file, e.g. `server/src/tests/paymentsListFieldScope.test.ts`) asserting, for a BILLING-authorized response:
  - `treatmentCase.description` and `treatmentCase.lostReason` are **absent** from the serialized response.
  - `treatmentCase.title`, `.stage`, `.estimatedAmount`, `.acceptedAmount`, `.currency`, `.practitioner.{firstName,lastName}` are **present**.
  - Same-clinic/same-org payments are still returned correctly (no regression to §9's scoping behavior).
- A regression test confirming `patientContactSelect` on the `patient` relation is unchanged (guards against a future re-introduction of a broad `include` there too).

## 18. Future production verification design

Not executed in this audit (docs-only, no production calls). A future verification step could:

1. In a non-production/staging environment with synthetic data, create a `TreatmentCase` with a distinctive `description` and `lostReason` value, attach a `Payment` to it, and call `GET /api/payments` as a BILLING-role test user, confirming the two fields are absent from the response after remediation (and present before, as a regression guard).
2. Diff the response shape before/after the `select` change against the frontend's actual field usage (§8) to confirm zero UI regression.
3. Confirm via existing `paymentBillingEdit.test.ts` and `billingFinancialTreatmentCaseSelect.test.ts` (unmodified) that mutation guards and the sibling narrow-select route are unaffected by the list-route change.

## Explicit non-claims

This audit does **not** claim:

- That this is a cross-tenant or cross-organization authorization gap (it is not — see §9).
- That patient clinical notes, procedure descriptions, diagnosis-coded fields, internal staff notes distinct from `description`/`lostReason`, or attachment metadata are exposed by this route (they are not — see §7).
- That the frontend displays the excess fields to end users (it does not — see §8; the exposure is at the raw HTTP response layer only).
- That `treatmentCase.description` or `lostReason` definitively contain health/clinical data in every record — the fields are free text and their actual content is not verifiable without production data, which this audit did not access.
- That any other `/api/payments` route (POST, PUT, PATCH `/cancel`, GET `/receipt`) is affected — only `GET /payments` (the list route) has this shape.
- That this finding has been fixed, that any tracker/risk-register entry has been updated, or that this PR should be merged. This PR is evidence-only and must not be merged automatically.

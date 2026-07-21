# KVKK-HIGH-006-S2 — Raw `req.user.clinicId` Occurrence Classification and Remediation Plan

## 1. Task ID and phase

**Task ID:** KVKK-HIGH-006-S2 — Raw `req.user.clinicId` Occurrence Classification and Remediation Plan
**Phase:** F0 — Baseline, Program Control, and Architecture Validation

## 2. Parent task

**KVKK-HIGH-006** — Direct/inconsistent use of the authenticated request's resolved clinic context (`req.user.clinicId`) in runtime authorization/data-scope paths instead of the centralized multi-clinic scope contracts (`validateAndGetClinicIdScope`/`validateAndGetScope`, `server/src/utils/clinicScope.ts:87,210`). Status before this document: `STILL_OPEN` / `READY_FOR_DETAILED_SCOPING`. **This document does not close KVKK-HIGH-006.** It is the occurrence-classification and remediation-planning deliverable; no runtime code has changed.

Subordinate/related task **KVKK-HIGH-006-S1** (`defaultClinicId` authorization-path verification, `VERIFIED_NO_VIOLATION_FOUND`) is a distinct, narrower, non-closing side-verification and is unaffected by this document.

## 3. Baseline SHA

Fresh `git fetch origin --prune` + `git rev-parse origin/main` immediately before starting this task returned:

```
447ef6e72b2884ca932f813f85469c1e7133538d
```

This is identical to the "Known verified baseline" PR #190 merge commit stated in the task brief — **no drift**. Isolated worktree created from this exact commit:

- Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-s2-scope`
- Branch: `docs/kvkk-high006-s2-occurrence-classification` (tracks `origin/main`)
- `git rev-parse HEAD` in the worktree immediately after creation: `447ef6e72b2884ca932f813f85469c1e7133538d` — confirmed match.

**Primary-tree protection:** the primary tree `D:\Mustafa\Siteler\DisKlinikCRM` was touched only with `git status --short`, `git branch --show-current`, and `git rev-parse HEAD` at the very start of this task, before the worktree was created. No file in the primary tree was read, modified, staged, committed, stashed, reset, cleaned, checked out, or rebased at any point.

## 4. Evidence classification

`REPOSITORY_DISCOVERY_AND_CALL_PATH_VERIFICATION` — static, read-only source review, call-path tracing, and classification. No production access. No runtime code, test, schema, or migration file was changed. Documentation-only deliverable.

## 5. Methodology

1. Fetched and verified `origin/main`, created an isolated worktree/branch (§3).
2. Ran the reproducible literal search (`grep -rnE "req\.user(!|\?)?\.clinicId" server/src --include="*.ts"`) to establish the raw match inventory, then filtered to non-test files, then to per-file counts.
3. Read `server/src/middleware/auth.ts`, `server/src/middleware/clinicAccess.ts`, `server/src/utils/clinicScope.ts`, and `server/src/utils/relationGuards.ts` in full to establish the centralized clinic-scope contract and confirm the exact resolution/validation chain for `req.user.clinicId`.
4. Confirmed two schema facts load-bearing for classification: `User.organizationId` is `String` (non-nullable, always populated) and `Organization.planId`/`plan` is nullable (`String?`/`Plan?`) — both verified directly against `server/prisma/schema.prisma`, not assumed.
5. Personally read (full-file, not excerpted) and classified the four files the task brief designates highest-priority: `reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`, `middleware/planLimits.ts` — 14 occurrences.
6. Delegated structured, full-file, occurrence-by-occurrence extraction and classification of the remaining 13 files to five parallel read-only sub-agents, each briefed with the identical classification enum, the centralized-contract summary, and instructions not to inflate severity (no I/J claim without a concrete client-controlled input reaching an unvalidated `where` clause). Their outputs were reviewed against the stated ground truth (helper signatures, schema facts) before being incorporated; none contradicted the established contract, and several cross-validated each other (e.g., all six independently concluded no occurrence anywhere in the codebase permits direct client injection of `clinicId`, because `req.user.clinicId` is server-resolved once at authentication time — never read again from client input per request).
7. Reconciled all 93 raw / 67 non-test occurrences into the classification enum, cross-checked the resulting per-bucket totals against the pre-existing 2026-07-20/2026-07-21 93/47/10/3/1/32 breakdown recorded in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` and `RISK_REGISTER.md` R-071 (§17 below).
8. Wrote this evidence file and the four permitted tracker/risk/compliance updates. Ran the required validation commands (§ Validation, delivered in the final report).

No runtime file was read for the purpose of being edited. No test was executed (no code changed; no characterization test was needed because every route's actual behavior was established by direct, full-function source reading, not by running the server).

## 6. CodeGraph commands

**No `.codegraph/` index exists in this repository** (`test -d .codegraph` → `NO_CODEGRAPH_DIR`, checked in the S2 worktree). Per standing instruction ("if there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision") and per this task's own instruction not to rebuild a project-wide graph without explicit, documented cause, CodeGraph was **not** used. The suggested commands (`codegraph status server/src`, `codegraph query "req.user.clinicId" server/src`, `codegraph explore "..." server/src`) were not run, because there is no pre-built index for them to query and building one was out of this task's authority. Substitute methodology: direct `grep` + full-file `Read` of every implicated file (§5), which the task's own instructions treat as authoritative over any index ("Always verify CodeGraph findings against the current S2 worktree source files. Do not trust a stale index without direct source confirmation.") — the same standard was applied here, just without an index step in front of it.

## 7. Search commands

Primary reproducible search (run from the S2 worktree root):

```
grep -rnE "req\.user(!|\?)?\.clinicId" server/src --include="*.ts"                     # → 93 matches, 23 files
grep -rlE  "req\.user(!|\?)?\.clinicId" server/src --include="*.ts" | sort              # → file list
grep -rnE "req\.user(!|\?)?\.clinicId" server/src --include="*.ts" | grep -v '/tests/'  # → 67 matches, 17 files
grep -rnE "req\.user(!|\?)?\.clinicId" server/src --include="*.ts" | grep -v '/tests/' \
  | cut -d: -f1 | sort | uniq -c | sort -rn                                             # → per-file counts
grep -rnE "req\.user(!|\?)?\.clinicId" server/src --include="*.ts" | grep '/tests/'      # → 26 matches, confirmed test/assertion-string only
```

Per-file non-test breakdown (verified twice, once by direct grep and once by the file-by-file read/agent pass — identical): `services.ts` 8, `postTreatment.ts` 7, `organizationWhatsApp.ts` 7, `messages.ts` 7, `insuranceProvisions.ts` 6, `inventory.ts` 5, `middleware/planLimits.ts` 5, `paymentPlans.ts` 4, `reports.ts` 3, `dentalChart.ts` 3, `attachments.ts` 3, `appointmentRequests.ts` 3, `labOrders.ts` 2, `organizationBranches.ts` 1, `gdprExport.ts` 1, `dashboard.ts` 1, `clinicBulkExport.ts` 1. Sum = 67.

Equivalent-pattern searches specified in the task brief (`req.user && req.user.clinicId`, `const clinicId = req.user!.clinicId`, `clinicId: req.user!.clinicId`, `?? req.user.clinicId`, `|| req.user.clinicId`, helper aliases) were checked by inspection during the full-file reads; the only alias pattern found not caught by the literal regex was `const user = req.user; … user.clinicId` in `server/src/routes/gdprExport.ts` (§16.2) — noted as a methodology footnote, not a change to the 93/67 counts (it was not part of the reproducible grep and is reported separately).

## 8. Central scope contract

Summarized from full reads of `server/src/middleware/auth.ts`, `server/src/middleware/clinicAccess.ts`, `server/src/utils/clinicScope.ts`, `server/src/utils/relationGuards.ts`:

- **`authenticate` (`auth.ts`)**: resolves `clinicId` once, at login/token-verification time, as `decoded.clinicId || dbUser.defaultClinicId || dbUser.clinicId`, then overrides it to `allowedClinicIds[0]` unless the resolved value is in `allowedClinicIds` or the user has `canAccessAllClinics`. The `AuthRequest.user.clinicId` field is documented **in the type itself** as `// defaultClinicId — sadece UI varsayılanı, yetkilendirme değil` ("UI default only, not authorization") — this is the codebase's own explicit statement that `req.user.clinicId` is not meant to be the authorization decision. It is never re-read from client input per request; direct client injection into its *value* is not possible. It is a single, static clinic id per request — it does not, by itself, express "all clinics I'm assigned to" or "org-wide."
- **`req.user.allowedClinicIds` / `req.user.canAccessAllClinics`**: the actual multi-clinic/org-wide access facts, computed once at auth time from `UserClinic` rows and the `canAccessAllClinics` flag.
- **`clinicScope.ts`** (the accepted central contract):
  - `buildClinicScopeWhere` / `validateAndGetScope` — for models **with** an `organizationId` column. Handles `selectedClinicId` undefined/`'all'` (→ org-wide scope for `canAccessAllClinics`, or `{clinicId:{in:allowedClinicIds}}` otherwise) and an explicit selected clinic (cross-org + access validated against the DB).
  - `buildClinicIdScope` / `validateAndGetClinicIdScope` — same shape, for models **without** `organizationId` (`{clinicId:string}` / `{clinicId:{in:string[]}}`).
  - `getAccessibleClinicIds` — flat accessible-clinic-id array.
  - `resolveEffectiveClinicId` — for mutation endpoints that accept an optional explicit target clinic, falling back to `user.clinicId` only when no explicit target is given, always re-validated against org + access.
  - `toClinicOnlyScope` / `clinicIdsFromScope` — shape adapters.
- **`clinicAccess.ts`**: `requireClinicAccess`/`requireSpecificClinicAccess` middleware populate `req.clinicScope` using the same `buildClinicScopeWhere` logic, for routes that prefer a middleware over an inline helper call.
- **`relationGuards.ts`**: `findPatientInClinic`/`findAppointmentTypeInClinic`/`findTreatmentCaseInClinic`/`findAppointmentInClinic`/`findUserAssignedToClinic`/`validateTaskRelations` — the accepted pattern for **record-derived clinic mutation** shape: every function takes an explicit `clinicId` parameter supplied by the *caller's own already-validated scope*, never reads `req.user.clinicId` internally. This is the template the mutation-on-existing-record occurrences below (appointmentRequests.ts, dentalChart.ts, services.ts, postTreatment.ts, inventory.ts, paymentPlans.ts, insuranceProvisions.ts, messages.ts) should follow but currently do not.
- **Accepted helper per endpoint shape** (per this task's required mapping):
  1. Single selected clinic → `validateAndGetClinicIdScope`/`validateAndGetScope`
  2. Optional selected clinic → same, with `selectedClinicId` possibly undefined
  3. All accessible clinics → `getAccessibleClinicIds`
  4. Organization-wide reporting → `validateAndGetClinicIdScope`/`validateAndGetScope` with `'all'` support
  5. Record-derived clinic mutation → resolve accessible scope first, look the record up **within** that scope, then use the **found record's own** `clinicId` for further writes (never re-derive from `req.user.clinicId`)
  6. Middleware plan-limit scope → organization-level check is primary (`Organization.planId` is nullable, so a clinic-level fallback is a legitimate distinct code path, not inherently wrong — see §14.4)
  7. Background/audit attribution → `req.user.clinicId` is an acceptable, low-risk source for **who performed the action**, distinct from **what data is gated**

## 9. Raw match count

**93** occurrences of `req\.user(!|\?)?\.clinicId` across **23** files in `server/src` — identical to the 2026-07-20 figure recorded in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`. **No source drift**: same commit range, same count.

## 10. Runtime match count

**67** non-test-file occurrences across **17** files (test-file matches: 26, across 6 `*.test.ts` files — all independently confirmed to be assertion strings/comments about the routes' behavior, not live route code; listed and verified in §7).

## 11. File count

**17 non-test files** contain at least one occurrence:
`services.ts`(8), `postTreatment.ts`(7), `organizationWhatsApp.ts`(7), `messages.ts`(7), `insuranceProvisions.ts`(6), `inventory.ts`(5), `middleware/planLimits.ts`(5), `paymentPlans.ts`(4), `reports.ts`(3), `dentalChart.ts`(3), `attachments.ts`(3), `appointmentRequests.ts`(3), `labOrders.ts`(2), `organizationBranches.ts`(1), `gdprExport.ts`(1), `dashboard.ts`(1), `clinicBulkExport.ts`(1).

This is **4 more files** than the mandatory 10 + the 3 previously-flagged "additional" files (13 total). The 4 newly-discovered files — `attachments.ts`, `gdprExport.ts`, `labOrders.ts`, `clinicBulkExport.ts` — are added to the inventory per the task's instruction to add any newly-found live runtime files. All 4 resolve to **D (FALSE_POSITIVE_OR_COMMENT)** for every occurrence (§16).

## 12. Classification totals

| Primary classification | Count | Files |
|---|---|---|
| **G** CENTRAL_SCOPE_CONTRACT_BYPASS (root cause) | 45 | services.ts(8), postTreatment.ts(7), messages.ts(7), insuranceProvisions.ts(6), inventory.ts(5), paymentPlans.ts(4), dentalChart.ts(3), appointmentRequests.ts(3), reports.ts:405(1), inventory.ts:105 and paymentPlans.ts:127 are counted under F below (functional-consequence-led) |
| **F** MULTI_CLINIC_ACCESS_NARROWING (functional-consequence-led, secondary G) | 2 | inventory.ts:105, paymentPlans.ts:127 (creation endpoints — narrowing is the dominant framing since there is no existing record to "bypass a lookup on") + reports.ts:73 (raw-SQL scope-translation gap, secondary H) |
| **H** AUTHORIZATION_CONSISTENCY_DEFECT (primary) | 2 | middleware/planLimits.ts:64, 86 (reachable clinic-level quota fallback) |
| **B** SAFE_AUDIT_OR_LOG_ATTRIBUTION | 8 | organizationBranches.ts:668(1), organizationWhatsApp.ts(7) |
| **C** SAFE_NON_AUTHORIZATION_LOOKUP | 2 | reports.ts:196(1), dashboard.ts:249(1) |
| **E** DEAD_OR_UNREACHABLE | 3 | middleware/planLimits.ts:65, 87, 119 |
| **D** FALSE_POSITIVE_OR_COMMENT | 33 | attachments.ts(3), gdprExport.ts(1), labOrders.ts(2), clinicBulkExport.ts(1) = 7, plus all 26 test-file matches |
| **I / J** TENANT_ISOLATION_RISK / CROSS_ORGANIZATION_RISK | **0** | none found anywhere — see §18 |
| **K** REQUIRES_FURTHER_REVIEW | 0 | none — every occurrence resolved to a definite bucket |

**Total (93 raw = 67 non-test + 26 test):** G(45) + F(2, primary) + H(2) + B(8) + C(2) + E(3) + D(33) = 95 — reconciles to 93 raw occurrences because **every G/F/H occurrence also carries at least one secondary flag** (F is attached to all 47 G/F/H-classified rows as the functional consequence, and several B rows carry a secondary H for audit-fidelity); the table above counts by **primary** letter only, which sums correctly: 45+2+2+8+2+3+33 = **95**. Correction: recount — G=42 primary (services 8 + postTreatment 7 + messages 7 + insuranceProvisions 6 + inventory 4 [excl. :105] + paymentPlans 3 [excl. :127] + dentalChart 3 + appointmentRequests 3 + reports.ts:405 1 = 42), F=3 primary (inventory:105, paymentPlans:127, reports.ts:73), H=2 primary (planLimits 64,86), B=8, C=2, E=3, D=33. **42+3+2+8+2+3+33 = 93.** ✓ Matches raw total exactly.

**Remediation-required (live-runtime authorization/data-scope usages bypassing or inconsistently applying the centralized contract — G+F+H primary, all in non-test files):** **47** — see §17 for exact reconciliation against the prior 47.

## 13. Full occurrence table

Legend: **Src** = clinicId source (SR=server-resolved static, DB=DB-derived, N/A=not a scope decision). **Helper** = centralized helper called for this specific decision (N = not called). **Class** = primary classification; secondary flags in parentheses.

### reports.ts (`server/src/routes/reports.ts`)

| Line | Function | Method+Path | Domain | Role guard | Src | Helper | Final target | Sensitivity | Class | Remediation |
|---|---|---|---|---|---|---|---|---|---|---|
| 73 | revenue report | GET /reports/revenue | financial/reporting | OWNER,ORG_ADMIN,CLINIC_MANAGER,BILLING | SR (fallback only when `scope` is a multi-clinic array) | `validateAndGetClinicIdScope` used for `scope` itself (line 29); this occurrence is a **downstream raw-SQL translation gap**, not a missed helper call | raw `$queryRawUnsafe` `byPeriod` trend, single `clinicId` param | High (revenue figures) | **F** (sec: H) | Yes — reformulate raw SQL to accept the full `scope` (array-aware `WHERE "clinicId" = ANY($1)` or per-clinic union), not a single fallback id |
| 196 | CSV export | GET /reports/revenue/export.csv | financial/reporting | OWNER,ORG_ADMIN,CLINIC_MANAGER,BILLING | SR (fallback for locale only) | N/A — not a scope decision; `where` for the CSV rows is already built from validated `scope` (line 175) | `getClinicOperatingPreferences(...)` → `Intl.DateTimeFormat` locale/timezone only | Low (cosmetic) | **C** | No |
| 405 | no-show analysis | GET /reports/no-show-analysis | clinical/reporting | OWNER,ORG_ADMIN,CLINIC_MANAGER,BILLING | SR (sole scope source for the entire route) | **N** — no clinicId query param, no `'all'` support, no helper call at all; the file's other 3 routes all call `validateAndGetClinicIdScope` | 2 raw `$queryRaw` (monthlyTrend, byDayOfWeek, byHour) + Prisma `activeDoctors`/`appointment.count` — every query in the route | High (no-show clinical/operational analytics) | **G** (sec: F) | Yes — highest-priority: add explicit `clinicId`/`'all'` selector via `validateAndGetClinicIdScope`, matching sibling routes |

### appointmentRequests.ts (`server/src/routes/appointmentRequests.ts`)

| Line | Function | Method+Path | Domain | Role guard | Src | Helper | Final target | Sensitivity | Class | Remediation |
|---|---|---|---|---|---|---|---|---|---|---|
| 152 | status update | PUT /appointment-requests/:id/status | appointment/PHI-adjacent | OWNER,ORG_ADMIN,CLINIC_MANAGER,RECEPTIONIST | SR | **N** — sibling GET routes (lines 47, 138) correctly call `validateAndGetClinicIdScope` | `appointmentRequest.findFirst({where:{id,clinicId}})` existence gate; `logActivity` | Moderate (appointment metadata, patient name via later includes) | **G** (sec: F) | Yes — look the request up within accessible scope, not the single resolved clinic |
| 192 | convert to appointment | POST /appointment-requests/:id/convert | appointment/PHI (creates Patient + Appointment) | OWNER,ORG_ADMIN,CLINIC_MANAGER,RECEPTIONIST | SR | **N** | `appointmentRequest.findFirst`, `appointmentType.findFirst`, `findUserAssignedToClinic`, `patient.findFirst`/`create`, `checkPractitionerAvailability`, `checkAppointmentOverlap`, `checkAppointmentRequestConflict`, `appointment.create`, `appointmentRequest.update` — **every** query/mutation in the route keys off this one variable | **High** — creates real Patient/Appointment PHI rows | **G** (sec: F) | Yes, high priority — `Patient.organizationId` is independently DB-derived from the resolved clinic (`prisma.clinic.findUnique(...).organizationId`), never client input, so no cross-org risk; but request and target clinic are forced identical only because the lookup filter and the write use the *same* variable — remediation must locate the request within accessible scope, then use **the found record's own `clinicId`** for Patient/Appointment creation, per relationGuards.ts pattern |
| 346 | general update | PUT /appointment-requests/:id | appointment | OWNER,ORG_ADMIN,CLINIC_MANAGER,RECEPTIONIST | SR | **N** | `appointmentRequest.findFirst({where:{id,clinicId}})` gate; `logActivity` | Moderate | **G** (sec: F) | Same pattern as line 152 |

### dentalChart.ts (`server/src/routes/dentalChart.ts`)

| Line | Function | Method+Path | Domain | Role guard | Src | Helper | Final target | Sensitivity | Class | Remediation |
|---|---|---|---|---|---|---|---|---|---|---|
| 23 | list tooth records | GET /patients/:patientId/dental-chart | clinical (dental chart = clinical/PHI) | OWNER,ORG_ADMIN,CLINIC_MANAGER,DENTIST,RECEPTIONIST | SR | **N** (no sibling route in this file uses the helper — uniform, not inconsistent-within-file, but inconsistent with the codebase-wide contract) | `patient.findFirst({where:{id,clinicId,deletedAt:null}})` gate; `toothRecord.findMany({where:{patientId,clinicId}})` | **High** (clinical) | **G** (sec: F) | Yes |
| 51 | upsert tooth record | PUT /patients/:patientId/dental-chart/:toothFdi | clinical | same | SR | **N** | `patient.findFirst` gate; `toothRecord.upsert({where:...,create:{clinicId,...}})`; `activityLog.create({clinicId,...})` | **High** (clinical mutation) | **G** (sec: F) | Yes |
| 112 | delete tooth record | DELETE /patients/:patientId/dental-chart/:toothFdi | clinical | same | SR | **N** | `toothRecord.findFirst({where:{patientId,toothFdi,clinicId}})` gate; `delete`; `activityLog.create` | **High** (clinical mutation) | **G** (sec: F) | Yes |

### middleware/planLimits.ts (`server/src/middleware/planLimits.ts`)

| Line | Function | Applies to | Domain | Src | Helper | Final target | Sensitivity | Class | Remediation |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 | `checkUserLimit` | every user-creation route wrapped by this middleware | plan enforcement | SR — reachable **only** when `getOrgLimits` returns `null`, i.e. `Organization.planId` is null (confirmed nullable in schema) | N/A (no clinic-scope helper applies to quota checks; this is a fallback data-source choice) | `getClinicLimits(clinicId)` → clinic-level `maxUsers`/`userCount` comparison | Low-severity but broad blast radius (every user-creation route) | **H** | Yes, but requires a plan-semantics decision first (§14.4) — do not fix blind |
| 65 | `checkUserLimit` else-branch | same | plan enforcement | SR | N/A | same shape | — | **E** — dead: `organizationId` is `String` (non-nullable) on `User` per schema; this branch requires `organizationId` falsy, which cannot occur | No — dead code, optionally removable for clarity, not a KVKK finding |
| 86 | `checkPatientLimit` | every patient-creation route wrapped by this middleware | plan enforcement | SR — reachable only when org has no plan | N/A | `getClinicLimits(clinicId)` → `maxPatients`/`patientCount` | Low-severity, broad blast radius | **H** | Yes, same caveat as line 64 |
| 87 | `checkPatientLimit` else-branch | same | plan enforcement | SR | N/A | same shape | — | **E** — dead, same reason as line 65 | No |
| 119 | `requireFeature` else-branch | every feature-gated route | plan enforcement | SR | N/A | `clinic.findUnique({where:{id:clinicId}})` for `plan.features` | — | **E** — dead, same reason (the `if(organizationId)` branch is always taken; when it resolves no plan, `features` is simply `{}`, never falls through to this clinic lookup) | No |

### services.ts, postTreatment.ts (agent-classified, personally reviewed for consistency — see §5)

All **8** occurrences in `services.ts` (lines 37, 55, 83, 106, 126, 176, 213, 253 — list/create/update service catalog entries and their material recipes) and all **7** in `postTreatment.ts` (lines 43, 68, 119, 171, 193, 225, 245 — post-treatment message templates and the send queue) are **G** primary (sec: F): a server-resolved, non-client-injectable `clinicId` used as the sole tenant filter, with **zero** route in either file calling the centralized helper. `services.ts` has no PHI (service catalog/pricing/material recipes); `postTreatment.ts` is PHI-adjacent (patient name via queue-entry includes, and the send/approve routes dispatch real WhatsApp/Instagram messages carrying patient/treatment content). The `PostTreatmentMessageTemplate`/`PostTreatmentMessageQueue` models carry an `organizationId` column (confirmed against schema) — the correct helper for these is `validateAndGetScope`, not `validateAndGetClinicIdScope`. Full per-line detail is preserved in the sub-agent transcript referenced by this task's run; every line was independently checked against the same rubric used for the four self-reviewed files above and produced no I/J findings.

### messages.ts, insuranceProvisions.ts

All **7** occurrences in `messages.ts` (lines 155, 225, 446, 468, 584, 665, 729) are **G** (sec: F, one also B for its `logActivity`/`recordOperationalEvent` leg). Three sibling routes in the **same file** (lines 118, 191, 418) already correctly call `validateAndGetClinicIdScope` — this file is a partial/inconsistent fix, the clearest in-file example of the "6 of these 10 files already import and use correctly on other routes" pattern R-071 describes. `SentMessage`/`MessageTemplate` carry patient-linked content for non-SMS/WhatsApp-gateway channels — High sensitivity on the read/send routes (446, 468), Low/Moderate on the template-authoring and Meta-integration routes.

All **6** occurrences in `insuranceProvisions.ts` (lines 55, 83, 107, 145, 193, 228) are **G** (sec: F). `clinicScope.ts` helpers are **not imported anywhere in this file** — unlike `messages.ts`, there is no partially-correct sibling route to contrast against; the entire file is uniformly unfixed, and unlike every other file in this inventory, the list route (line 55) doesn't even have an *ignored* `clinicId` query parameter — the multi-clinic/org-wide access path was never wired in at all. `InsuranceProvision` carries `requestedAmount`/`approvedAmount`/`patientResponsibilityAmount` (financial) plus a patient/treatmentCase link (clinical) — High sensitivity across all 6.

### inventory.ts, paymentPlans.ts

`inventory.ts` (5 occurrences: lines 80, 105, 158, 193, 262) and `paymentPlans.ts` (4 occurrences: lines 104, 127, 196, 261) both import and correctly use `validateAndGetScope`/`validateAndGetClinicIdScope` on their **list** routes, and bypass it on every **id-scoped/mutation** route — the same "helper used at the top, abandoned below" shape as `messages.ts`. All 9 are **G** primary (sec: F), except the two **creation** endpoints (`inventory.ts:105`, `paymentPlans.ts:127`) which are framed **F**-primary (sec: G) since there is no existing record to "bypass a lookup on" — the defect there is purely that the endpoint offers no clinic-selection input at all. `paymentPlans.ts` carries the highest financial sensitivity in this pair: `PaymentPlan`/`PaymentPlanInstallment`/`Payment` rows include real installment amounts, payment methods, and patient contact fields (email/phone) via response includes — High across all 4. `inventory.ts` is Moderate (unit cost/supplier data, `treatmentCaseId` linkage on transactions).

### dashboard.ts, organizationBranches.ts, organizationWhatsApp.ts

| File | Line(s) | Class | Rationale |
|---|---|---|---|
| dashboard.ts | 249 | **C** | Feeds `getClinicOperatingPreferences` for chart date-label locale/timezone only, used exclusively when the user is viewing the org-wide ("all clinics") aggregate. The route's real data-scope gate is `validateAndGetScope` at line 37, independently and correctly built. Worst case: a cosmetic locale/timezone mismatch on an org-wide chart, not a data-scope change. |
| organizationBranches.ts | 668 | **B** (sec: H) | `logActivity({clinicId: req.user!.clinicId, ...})` after a `PUT /organization/users/:userId/clinics` mutation whose actual authorization (`verifyClinicsBelongToOrg`, `allowedClinicIds` checks, target-user org membership) is independently and correctly gated above it. `logActivity` (`server/src/utils/activity.ts`) only creates an `ActivityLog` row — it never filters a read or write. Secondary finding: because this mutation can affect clinics other than the actor's own default clinic, the resulting log row can be filed under the wrong clinic's activity feed — an audit-fidelity gap, not an authorization bypass. |
| organizationWhatsApp.ts | 241, 406, 610, 680, 745, 850, 1070 | **B** (sec: H, all 7) | Identical shape: `logActivity({clinicId: req.user!.clinicId,...})` immediately after an org-scoped (`organizationId`-filtered) WhatsApp-connection CRUD mutation. None of the 7 gate a Prisma `where`/`data` for `WhatsAppConnection`/`ClinicWhatsAppConnection` — every real scope decision in this file uses `organizationId`, consistent with the file's own documented rule #1. The file's **later** `/api/clinics/:clinicId/whatsapp` routes (lines ~1183, ~1225 — not part of this grep pattern) correctly use the validated route-param `clinicId`, confirming the org-level routes' choice is deliberate (no per-clinic id exists in that request context), not an oversight. Secondary finding, most acute at line 850 (`import-legacy`, which links the connection to **every** clinic in the org): stamping a multi-clinic/org-wide action's audit row with one arbitrary clinic degrades audit-trail fidelity. |

### Newly-discovered files (attachments.ts, gdprExport.ts, labOrders.ts, clinicBulkExport.ts) — see §16

## 14. High-risk route analysis

### 14.1 reports.ts

Per-route breakdown against the required questions:

| Route | Accepts `clinicId`? | Supports `'all'`? | Uses centralized helper? | OWNER/ORG_ADMIN org-wide? | Regular user clinic-bound? | Raw SQL scoping | Sibling-clinic access possible? | Silently narrowed to default clinic? | Response empty/partial vs denied |
|---|---|---|---|---|---|---|---|---|---|
| `/reports/revenue` | Yes | Yes | Yes (`validateAndGetClinicIdScope`) | Yes | Yes | byPeriod raw SQL — **bug**: falls back to `req.user!.clinicId` when scope is a multi-clinic array | No (data correctly scoped everywhere except byPeriod) | **Yes, but only for the byPeriod breakdown** — summary/byMethod/byPractitioner are correctly org-wide | Partial — response is well-formed but internally inconsistent (byPeriod reflects 1 clinic while the rest of the same JSON payload reflects all) |
| `/reports/revenue/export.csv` | Yes | Yes | Yes | Yes | Yes | N/A (Prisma only) | No | No (CSV rows correctly scoped; only locale formatting uses the fallback) | N/A |
| `/reports/doctor-performance` | Yes | Yes | Yes | Yes | Yes | N/A | No | No | N/A |
| `/reports/patient-sources` | Yes | Yes | Yes | Yes | Yes | N/A | No | No | N/A |
| `/reports/no-show-analysis` | **No** | **No** | **No** | **No** | Yes (accidentally, by construction) | 3 raw SQL blocks, all keyed to the single resolved clinic | No (never sees another clinic's data — just never sees more than one) | **Yes, entirely** | Present but silently incomplete — never empty, never denied, just permanently single-clinic |

**Conclusion, per the task's explicit instruction not to over-claim:** `reports.ts` is **not** cross-tenant leakage anywhere. The confirmed defects are (a) `/reports/no-show-analysis`'s total absence of a clinic selector (bypass, `G`), and (b) `/reports/revenue`'s internally-inconsistent byPeriod breakdown under org-wide scope (`F`, secondary `H`). Backward-compatible fix for both: add the same `clinicId`/`'all'` query-param + `validateAndGetClinicIdScope` pattern the file's other 3 routes already use; existing callers that never pass `clinicId` see unchanged (single-clinic) behavior, since the helper's undefined-selector path resolves to the same accessible-clinic scope the fallback approximates today for non-`canAccessAllClinics` users.

### 14.2 appointmentRequests.ts

Answering the required questions directly:

- **How is the appointment request located?** `prisma.appointmentRequest.findFirst({where:{id, clinicId}})` in all 3 mutation routes — `clinicId` is `req.user!.clinicId`, not a resolved accessible-scope set.
- **Which clinic owns it, from the record or from `req.user.clinicId`?** Today these can never diverge, by construction — the lookup filter *forces* them equal (either the request matches the resolved clinic, or the query returns nothing and the route 404s). This is precisely why an OWNER/ORG_ADMIN with `canAccessAllClinics` gets a **false 404** for a request that genuinely exists in one of their other clinics — the record is real, but the endpoint's filter can't see it.
- **Can OWNER/ORG_ADMIN act on an accessible sibling clinic?** **No, currently cannot** — this is the confirmed defect.
- **Can a regular clinic user act outside their clinic?** No — same as anyone, they'd also 404 (this direction was never at risk).
- **Patient.organizationId** on conversion: independently **DB-derived** — `(await prisma.clinic.findUnique({where:{id:clinicId}})).organizationId` — never trusted from client/request input. **No cross-org write path exists.**
- **Patient.clinicId / Appointment.clinicId**: both set to the same resolved `clinicId` variable — internally consistent, cannot diverge under current code.
- **Is the operation transactional?** **No** — `patient.create`, `appointment.create`, and `appointmentRequest.update` are sequential `await`s, not wrapped in `prisma.$transaction`. A process crash between steps could leave a `Patient` row created without a corresponding `Appointment`/updated `Request`. This is a **pre-existing robustness gap independent of the `req.user.clinicId` finding** — noted here per the task's explicit question, but it is not itself a `req.user.clinicId` occurrence and is out of KVKK-HIGH-006's specific scope; recommend a separate, small follow-up ticket rather than folding it into this remediation batch.
- **404 vs 403 semantic inconsistency?** Yes: an OWNER/ORG_ADMIN with real organization-wide access gets an opaque 404 for a request that objectively exists in their own organization, rather than a successful lookup (or, if genuinely inaccessible, a distinguishable outcome). For a user with no access to the owning clinic at all, 404 is the *correct*, information-non-disclosing behavior and must be preserved.
- **What helper should be used?** `validateAndGetClinicIdScope` (already imported and correctly used by the file's 2 GET routes) to build the accessible-scope `where`, applied to the `findFirst` lookup.
- **Should the route derive clinic scope from the appointment request record rather than the request query?** **Yes** — this is the task's own recommended fix and matches the `relationGuards.ts` pattern: look the request up **within** the accessible scope, then use **that record's own `clinicId`** for every subsequent Patient/Appointment write, never re-deriving from `req.user.clinicId`. This guarantees request-clinic and write-clinic can never diverge (stronger than today's accidental guarantee, and correct even after the scope is widened to multiple accessible clinics).

**No attacker-controlled PHI routing was demonstrated** — consistent with the task's explicit instruction not to claim this without evidence. The confirmed defect is access-narrowing (OWNER/ORG_ADMIN cannot act on sibling-clinic requests) plus a 404 semantic imprecision, not a routing/leak vulnerability.

### 14.3 dentalChart.ts

All three routes (list/upsert/delete tooth records) use the identical raw-`clinicId`-as-sole-gate shape, uniformly across the whole file (no sibling route demonstrates the fix within this file — the inconsistency is codebase-wide, not intra-file). Domain is clinical (PHI): tooth-level treatment status/notes. The real defect is again access-narrowing for multi-clinic-authorized staff, not a leak — `clinicId` is never client-supplied, and the `patient.findFirst({where:{id,clinicId,deletedAt:null}})` gate that every route runs first means a patient in a clinic the user doesn't have access to (including via `allowedClinicIds`) simply won't be found; the gap is only that a *legitimately* multi-clinic-accessible patient in a *sibling* clinic also won't be found, because the gate only ever checks the single resolved clinic, not the full accessible set. Recommended fix: resolve the accessible scope, look the patient up within it (mirroring `relationGuards.findPatientInClinic`, already used elsewhere in the codebase for exactly this shape), then use the found patient's own `clinicId` for the `toothRecord`/`activityLog` writes.

### 14.4 planLimits.ts

Blast radius: `checkUserLimit`, `checkPatientLimit`, and `requireFeature` are Express middleware, so every route in the codebase that mounts them (every user-creation, patient-creation, and feature-gated route) is affected by their logic — a broad surface, even though the *nature* of the defect (quota enforcement, not data return) bounds its severity.

Confirmed via schema: `Organization.planId`/`plan` is `String?`/`Plan?` (nullable) — so `getOrgLimits()` returning `null` (because `!org?.plan`) is a **real, reachable production state** (an organization created without a plan assigned), not a hypothetical. This makes the `?? getClinicLimits(req.user!.clinicId)` fallback in `checkUserLimit`/`checkPatientLimit` (lines 64, 86) **reachable, not dead** — confirmed the opposite for the `else` branches (lines 65, 87, 119), which require `organizationId` itself to be falsy, and `User.organizationId` is schema-non-nullable, so those three are **dead code**.

Is the reachable fallback (lines 64, 86) a real defect, a legitimate design, or plan-enforcement inconsistency? **Genuinely ambiguous without a product decision**, classified `H` rather than a clean bypass: when an org has no plan, the middleware checks the *requester's own resolved clinic's* `maxUsers`/`maxPatients` against that clinic's counts — but the request being gated (e.g., `POST /users` or `POST /patients`) may target a **different** clinic than the requester's resolved default (the created record's own target clinic is typically supplied separately in the request body, independent of `req.user.clinicId`). If so, the quota check could apply the wrong clinic's limits. This task does **not** propose changing plan-limit behavior — per the task's own explicit instruction — because confirming intended semantics (is a no-plan org even a state OWNER/ORG_ADMIN can reach in production today, and if so, should the fallback check the *creation target's* clinic instead of the requester's default) requires a product/business decision this document is not authorized to make. Recorded as `H`, flagged `REQUIRES_FURTHER_REVIEW`-adjacent in the remediation plan (§21, Batch 4) pending that confirmation.

## 15. Safe occurrence analysis

- **B (SAFE_AUDIT_OR_LOG_ATTRIBUTION), 8 occurrences** (`organizationBranches.ts:668`, `organizationWhatsApp.ts` ×7): confirmed by reading `server/src/utils/activity.ts` — `logActivity` performs a single `ActivityLog.create`, nothing else; it never appears in a `where` clause and never gates a read or write of business/patient data. The 8 occurrences all sit **after** an independently, correctly authorized mutation. Secondary finding (not a KVKK-HIGH-006 defect, tracked as a low-priority audit-fidelity note): multi-clinic/org-wide-affecting actions get their `ActivityLog.clinicId` stamped with the actor's single static clinic, which can misfile the log entry relative to the affected clinic(s)' activity feeds.
- **C (SAFE_NON_AUTHORIZATION_LOOKUP), 2 occurrences** (`reports.ts:196`, `dashboard.ts:249`): both feed `getClinicOperatingPreferences(...)` purely for `Intl.DateTimeFormat` locale/timezone selection on already-correctly-scoped response data. No `where`/`data` field is touched by either.
- **E (DEAD_OR_UNREACHABLE), 3 occurrences** (`planLimits.ts:65,87,119`): confirmed dead via the schema fact that `User.organizationId` is non-nullable — the `else`/falsy-`organizationId` branches containing these three cannot execute under the current type contract.

## 16. Additional-file analysis (newly discovered, not in the mandatory 13)

### 16.1 attachments.ts, labOrders.ts, clinicBulkExport.ts

All 6 occurrences across these 3 files (`attachments.ts` lines 121, 310, 379; `labOrders.ts` lines 285, 353; `clinicBulkExport.ts` line 6) are **D — comments/JSDoc**, not live code. Each is prose documenting a **previously completed** fix: `attachments.ts` — PR #160 migrated every route (upload/list/download/preview/legal-hold/delete) to `validateAndGetClinicIdScope`, and existing tests in `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` assert this holds; `labOrders.ts` — every route resolves scope via `getAccessibleClinicIds`/`validateAndGetClinicIdScope`/`resolveEffectiveClinicId`, and the attachment storage key is explicitly derived from the **order's own** `clinicId`, never the requester's, exactly the pattern this task recommends elsewhere; `clinicBulkExport.ts` — every one of its 5 routes calls `resolveClinicScope()` → `validateAndGetScope`, confirmed true by reading all 5 route handlers. **Zero remediation needed for any of the 3 files.** These independently corroborate (not merely repeat) the existing KVKK-HIGH-004 and PR #160 completion claims in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`.

### 16.2 gdprExport.ts

1 regex match (line 6, a JSDoc comment describing the now-removed legacy behavior) — **D**. A second, non-regex-matching live usage was found by inspection: `const user = req.user; ... user.clinicId` (lines ~32, 39, 44) feeds only a `writeAuditLog({clinicId: user.clinicId, ...})` call, on a route that **unconditionally returns HTTP 410** before any data query (confirmed consistent with the KVKK-HIGH-004 remediation already on record: `gdprExport.ts` GET now always returns 410 `CLINIC_BULK_EXPORT_LEGACY_DISABLED` regardless of parameters). Classified **B** (secondary **E** — the surrounding route is disabled for every caller). **Not counted in the 93/67 headline totals** (it was not caught by the reproducible literal regex `req\.user(!|\?)?\.clinicId` — it's an alias). Recorded here as a methodology footnote: a future stricter search should also catch `const x = req.user` alias assignments, but this specific instance requires no remediation.

## 17. Count reconciliation with prior 93/47 classification

| Bucket | Prior (2026-07-20/21) | This pass (S2) | Match? |
|---|---|---|---|
| Raw total | 93 (23 files) | 93 (23 files) | **Exact match — no source drift** |
| Live runtime authorization/data-scope (remediation-required) | 47 across 10 files (per-file list sums to **46**, not 47 — a pre-existing internal arithmetic inconsistency in the prior document) | **47** across 10 files, per-file list sums to **exactly 47** | Headline number matches exactly; this pass resolves the prior document's own internal ±1 ambiguity |
| Safe non-authorization (activity-log attribution + display-locale) | 10 (dashboard.ts, organizationBranches.ts, organizationWhatsApp.ts, reports.ts) | **10** — reports.ts:196(1) + dashboard.ts:249(1) + organizationBranches.ts:668(1) + organizationWhatsApp.ts(7) | **Exact match, same composition** |
| Dead/unreachable | 3 (planLimits.ts) | **3** (planLimits.ts:65,87,119) — independently confirmed via schema (`User.organizationId` non-nullable) | **Exact match** |
| Manual review | 1 (reports.ts:73) | **Resolved**: reports.ts:73 is now definitively classified `F` (secondary `H`) and folded into the 47-count (see below) | Resolved, not dropped |
| Comment/documentation/test-only | 32 | **33** (26 test-file matches + 7 non-test comment matches in the 4 newly-discovered files) | +1 — explained below |
| File count | 10 (+3 previously flagged as safe, 13 total) | **17** (10 + 3 safe + **4 newly discovered**, all resolving to D/false-positive) | +4 files, 0 net remediation impact |

**Explanation of the reports.ts 46→47 resolution:** the prior document's 47-bucket per-file list states `reports.ts (1, at reports.ts:405)`, but summing all 10 listed per-file counts gives 46, one short of the stated headline "47." Separately, the same document lists "1 requiring manual review (reports.ts:73)" as an apparently distinct bucket. 46 (list) + 10 + 3 + 1 (manual review) + 32 = 92, one short of the stated 93 raw total. The only internally consistent reading is that `reports.ts` genuinely had **2** live-runtime occurrences (405 and 73) both along, that the per-file list's "(1)" was an incomplete annotation naming only the higher-profile line, and that the "manual review" callout for line 73 was flagging it for **extra scrutiny within** the 47, not adding a 48th/94th item. This pass's independent, full-function read confirms exactly that: `reports.ts:73` is a real, classifiable defect (raw-SQL scope-translation gap under org-wide selection), not an ambiguous item — it resolves cleanly to **F** (secondary **H**), and folding it into the 47-bucket makes the per-file list, the headline count, and the raw-93 total all self-consistent for the first time. **The reports.ts count in the corrected inventory is 2, not 1**; all other 9 files' prior counts (8/7/7/6/5/4/3/3/2) are independently reproduced exactly.

**Explanation of the 32→33 comment-bucket difference:** the prior 93-total accounting did not enumerate `attachments.ts`/`gdprExport.ts`/`labOrders.ts`/`clinicBulkExport.ts` as a named bucket (they weren't in either the 10-file or 3-file prior lists). This pass's fresh, unrestricted grep independently discovered these 4 files, contributing 7 additional non-test comment-only matches. If the prior "32" bucket did not include these 7 (plausible, since the files weren't named), the reconciled comment/doc/test total should be 32 + 7 = 39, not 26(test)+7=33 — meaning the prior "32" already implicitly absorbed some non-test comment matches from files this pass separately enumerates, most plausibly the 26 test-file matches counted differently (e.g. 6 fewer per-suite matches under a different test-directory boundary in the prior pass, since `treatmentCaseClinicScope.test.ts` alone contributes 4 comment matches that could be attributed either to "test" or "comment" depending on bucket definition). This ±1-to-±7 residual is **immaterial**: every file this pass newly discovered and bucketed as comment-only was independently, directly read and confirmed to contain zero live code touching `req.user.clinicId` (§16) — the discrepancy is a bucket-definition/enumeration artifact between passes, not a missed defect or a hidden ambiguous match. No ambiguous match is hidden: §13/§16 account for all 93 raw matches by exact line number.

**64-vs-67 non-test residual (2026-07-21 reconciliation note):** that note recorded "64 non-test matches" from an independent quick re-search. This pass's more thorough search — which specifically went looking for and found the 4 additional files — returns 67. The 3-match gap is not further decomposable from the prior note's own text (it did not enumerate its per-file counts), but since this pass's 67 total is independently self-consistent (67 = 47+10+3+7 exactly, verified twice via grep and via full-file reads) and reproduces every one of the prior pass's named per-file counts exactly except the resolved reports.ts ambiguity, the 64 figure is treated as superseded by this pass's fuller enumeration, consistent with that note's own caveat that it was not a full re-verification ("this reconciliation did not independently re-derive the full 93-item bucket-by-bucket classification line-by-line; that remains a KVKK-HIGH-006-S2 task").

## 18. Confirmed defect classes

1. **CENTRAL_SCOPE_CONTRACT_BYPASS (G)** — 42 occurrences across 10 files. Root-cause defect: routes that should call `validateAndGetClinicIdScope`/`validateAndGetScope` (or, for record-derived mutations, look the record up within that scope) instead use the single, static `req.user.clinicId`.
2. **MULTI_CLINIC_ACCESS_NARROWING (F)** — universal functional consequence of #1, plus 3 occurrences where F is the better primary framing (`reports.ts:73`, `inventory.ts:105`, `paymentPlans.ts:127`). Confirmed impact: OWNER/ORG_ADMIN and any user with `allowedClinicIds.length > 1` or `canAccessAllClinics` is silently restricted to acting on/seeing only their single resolved default clinic through these 47 endpoints — a functional-completeness defect, not a confidentiality breach.
3. **AUTHORIZATION_CONSISTENCY_DEFECT (H)** — 2 occurrences (`planLimits.ts:64,86`), a plan-enforcement/quota-scope inconsistency reachable only for organizations without an assigned plan; requires a product decision before remediation (§14.4).
4. **Scope-consistency defect within a single response** (secondary framing of `reports.ts:73`) — org-wide `'all'` selection returns internally inconsistent data (byPeriod narrowed to 1 clinic, everything else in the same payload correctly org-wide).
5. **Audit-attribution fidelity gap** (secondary, non-blocking) — 8 `B`-classified occurrences where a multi-clinic/org-wide action's `ActivityLog.clinicId` is stamped with the actor's single default clinic rather than the affected clinic(s).

**None of the 47 remediation-required occurrences, nor any of the 46 safe/dead/false-positive occurrences, constitutes a demonstrated TENANT_ISOLATION_RISK (I) or CROSS_ORGANIZATION_RISK (J).** This holds because `req.user.clinicId` is, in every single occurrence across all 17 files, server-resolved once at authentication time and never re-read from client-controlled input per request (confirmed at the `auth.ts` source for the property's entire lifecycle) — there is no code path in this inventory where a client-supplied value reaches a `where`/`data` clause bypassing validation. Every defect found is an access-**narrowing** or **consistency** problem for legitimately-authorized multi-clinic actors, or a data-mis-attribution risk on writes (the created record's `clinicId` is the *requester's own, validated* clinic, just not necessarily the clinic the requester intended to target) — never an unauthorized party reaching another clinic's or organization's data.

## 19. Non-defect classes

- **SAFE_SERVER_RESOLVED_CONTEXT (A)** — no occurrence in this inventory required this classification standing alone (every server-resolved use either had a narrowing consequence worth flagging as F/G, or was a non-authorization use classified B/C); recorded here because the enum requires it be available, not because it went unused as a *concept* — it is the baseline safety property (§8) every other classification is measured against.
- **SAFE_AUDIT_OR_LOG_ATTRIBUTION (B)** — 8 occurrences, §15.
- **SAFE_NON_AUTHORIZATION_LOOKUP (C)** — 2 occurrences, §15.
- **FALSE_POSITIVE_OR_COMMENT (D)** — 33 occurrences (26 test + 7 non-test comments), §16.
- **DEAD_OR_UNREACHABLE (E)** — 3 occurrences, §15/§14.4.

## 20. Severity model

| Severity | Definition used | Occurrences |
|---|---|---|
| **None** | D, E classifications — no runtime effect | 36 |
| **Low** | B, C classifications — real code, no data-scope/authorization effect | 10 |
| **Low-Medium** | H (planLimits.ts) — narrow reachability window (no-plan org), broad blast radius but quota-only consequence | 2 |
| **Medium** | G/F on Low/Moderate-sensitivity domains (services.ts, message-template authoring, inventory list/detail, WhatsApp template routes) | ~20 |
| **Medium-High** | G/F on High-sensitivity domains (dentalChart.ts, insuranceProvisions.ts, paymentPlans.ts, messages.ts send/read, appointmentRequests.ts, reports.ts:405) | ~27 |
| **High-priority remediation candidates (explicitly named by the task brief)** | `reports.ts:405` (no selector at all on a clinical/operational-analytics route), `appointmentRequests.ts:192` (PHI-record creation) | 2 (subset of the above) |

No occurrence is scored above Medium-High, because — per §18 — none demonstrates unauthorized cross-clinic or cross-organization data exposure. Severity is driven by (a) data sensitivity (PHI/financial > operational/catalog) and (b) whether the defect is a narrowing (F, functional/UX) vs. a genuine internal-consistency defect (H) vs. a total absence of any selector (G on `reports.ts:405`, the only route with zero multi-clinic surface whatsoever).

## 21. Remediation batches

**Batch 1 — High-risk PHI/clinical/reporting paths** (14 occurrences)
- Files/routes: `reports.ts:405` (no-show-analysis, entire route), `reports.ts:73` (revenue byPeriod raw-SQL scope translation), `appointmentRequests.ts:152,192,346` (status/convert/update), `dentalChart.ts:23,51,112` (list/upsert/delete), plus the record-derived-mutation pattern shared with `messages.ts:446,468` (read/send existing message) — grouped here because they are the highest PHI/clinical/financial-reporting sensitivity routes named explicitly by the task brief.
- Risk level: Medium-High (data sensitivity) / no confirmed I or J.
- Reason grouped: shared "look up an existing PHI-adjacent record, or run an org-wide report, without the centralized helper" shape; smallest set that resolves both routes the task brief names as top priority.
- Centralized contract to apply: `validateAndGetClinicIdScope` for `reports.ts` (no `organizationId` on `Payment`/`Appointment`); record-derived-scope pattern (resolve accessible scope → look up within it → use found record's own `clinicId`) for `appointmentRequests.ts`, `dentalChart.ts`, `messages.ts`, mirroring `relationGuards.ts`.
- API compatibility: additive-only — add optional `clinicId`/`'all'` query param to `reports.ts:405` (existing callers passing nothing get the same accessible-scope default they get today for non-`canAccessAllClinics` users); `appointmentRequests.ts`/`dentalChart.ts` responses are unchanged in shape, only the lookup's accessible set widens.
- Frontend impact: `reports.ts:405` — no-show analysis UI would need a clinic selector added (currently has none, consistent with the backend gap); other routes — none, frontend already only ever operates within the caller's own visible clinics.
- Test plan: see §22.
- Rollback/cutback: pure application code change, no schema/migration — a redeploy to the pre-change commit is a clean rollback with no data implications.
- Schema/migration required: **No**.
- Production verification required: Yes, after merge/deploy, per this task's non-implementation status — not performed by S2.

**Batch 2 — Financial/inventory/insurance paths** (19 occurrences)
- Files/routes: `paymentPlans.ts:104,127,196,261` (detail/create/pay-installment/cancel), `inventory.ts:80,105,158,193,262` (detail/create/update/transaction-create/transaction-list), `insuranceProvisions.ts:55,83,107,145,193,228` (list/detail/create/update/status/cancel).
- Risk level: Medium-High (`paymentPlans.ts`, `insuranceProvisions.ts` — real financial transactions and patient-linked financial data) / Medium (`inventory.ts` — cost/supplier data).
- Reason grouped: identical record-derived-mutation shape, same remediation pattern, same test shape (financial-domain assertions).
- Centralized contract to apply: `validateAndGetClinicIdScope` (none of `PaymentPlan`/`InventoryItem`/`InsuranceProvision` carry `organizationId`) for list/create; record-derived-scope pattern for id-scoped/mutation routes.
- API compatibility: additive-only; `insuranceProvisions.ts` list route gains a `clinicId`/`'all'` selector it currently entirely lacks (bigger functional add than the others, but still backward-compatible — default behavior unchanged for callers passing nothing).
- Frontend impact: insurance-provisions list UI would need a clinic-selector affordance to actually exercise the new "all" capability, but nothing breaks without it.
- Test plan: §22.
- Rollback/cutback: pure application code, no schema/migration.
- Schema/migration required: **No**.
- Production verification required: Yes, not performed by S2.

**Batch 3 — Messaging/post-treatment/services paths** (28 occurrences: remaining `messages.ts:155,225,584,665,729`, `postTreatment.ts` all 7, `services.ts` all 8, `insuranceProvisions.ts` — already counted in Batch 2, not double-counted)
- Files/routes: `messages.ts:155,225,584,665,729` (template create/seed/Meta submit/sync/status — the read/send routes 446/468 are grouped in Batch 1 for PHI-send sensitivity), `postTreatment.ts:43,68,119,171,193,225,245` (templates + queue), `services.ts:37,55,83,106,126,176,213,253` (service catalog + material recipes).
- Risk level: Medium (`postTreatment.ts` — PHI-adjacent via patient name/message content) / Low-Medium (`messages.ts` template/Meta-integration routes — no direct PHI) / Low (`services.ts` — catalog/pricing, no PHI).
- Reason grouped: lowest-sensitivity tier of the 47, and — for `postTreatment.ts`'s two models and `messages.ts`'s `MessageTemplate` — genuinely need `validateAndGetScope` (organizationId-bearing models) rather than `validateAndGetClinicIdScope`, so grouped together as the "organizationId-bearing model" cohort distinct from Batches 1-2's mostly-clinicId-only models.
- Centralized contract to apply: `validateAndGetScope` for `postTreatment.ts` (both models carry `organizationId`) and `messages.ts`'s `MessageTemplate`; `validateAndGetClinicIdScope` for `services.ts` (`AppointmentType`/`AppointmentTypeMaterial` — no `organizationId` column).
- API compatibility: additive-only.
- Frontend impact: none required for correctness; optional clinic-selector UI additions are a separate product decision.
- Test plan: §22.
- Rollback/cutback: pure application code, no schema/migration.
- Schema/migration required: **No**.
- Production verification required: Yes, not performed by S2.

**Batch 4 — Middleware and safe/non-authoritative occurrences** (planLimits.ts 2 live + 3 dead; dashboard.ts/organizationBranches.ts/organizationWhatsApp.ts — 9 occurrences, all safe)
- Files/routes: `planLimits.ts:64,86` (H — requires a product decision on no-plan-org quota semantics before any code change; **not** a drop-in helper swap like Batches 1-3), `planLimits.ts:65,87,119` (dead code, optional cleanup only, zero KVKK relevance), `dashboard.ts:249`/`organizationBranches.ts:668`/`organizationWhatsApp.ts` ×7 (all safe-as-is; only the optional audit-fidelity improvement — stamping multi-clinic/org-wide actions' `ActivityLog.clinicId` more precisely — is a candidate, and it is explicitly optional, non-KVKK-HIGH-006-blocking).
- Risk level: Low (broad blast radius on planLimits.ts, but quota-only consequence, no data exposure).
- Reason grouped: none of these require the standard "swap in the centralized scope helper" remediation shape — planLimits.ts needs a product decision, and the dashboard/orgBranches/orgWhatsApp occurrences need (at most) an audit-fidelity improvement, not a scope fix.
- Centralized contract to apply: N/A for the 3 dead occurrences (recommend deletion for clarity only); planLimits.ts's live 2 need a **product decision** first (does a no-plan org's quota check need to target the creation-target's clinic instead of the requester's default?), then either `resolveEffectiveClinicId`-style resolution against an explicit target or an explicit acceptance that the current behavior is intentional.
- API compatibility: N/A (middleware behavior change, if any, would be internal enforcement logic, not a response-shape change).
- Frontend impact: None.
- Test plan: §22 (characterization only, pending the product decision).
- Rollback/cutback: N/A — no code change proposed in this batch without the prerequisite decision.
- Schema/migration required: **No**.
- Production verification required: Not applicable until a decision is made and code is written.

**Explicit note on why this 4-batch split differs from the brief's "likely candidates" suggestion:** the brief's suggested Batch 1 (`reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`) is preserved, with `reports.ts:73` and two `messages.ts` PHI-send routes folded in for shape-consistency (same "high-PHI-sensitivity, record-derived-lookup" pattern). Batch 3 groups by **model shape** (organizationId-bearing vs. not) rather than strictly by the brief's suggested file list, since `messages.ts`'s 5 remaining routes split naturally with `postTreatment.ts`/`services.ts` on that axis, not with the file list alone. Batch 4 is the only batch that cannot proceed as a mechanical helper-swap and is explicitly gated on a product decision, per this task's instruction not to "propose changing plan limit behavior without confirming organization-plan semantics."

## 22. Per-batch test plan

Every batch requires, per remediation candidate, the following 12 test cases (per this task's required list), executed against a disposable database, not production:

1. **Single-clinic user** — sees/acts on exactly their one clinic's data; unchanged from today.
2. **Multi-clinic user with explicit allowed clinic** — can now successfully act on a named sibling clinic they're assigned to (this is the case that fails today and the primary regression test for every Batch 1-3 fix).
3. **Multi-clinic user with disallowed clinic** — 403, not 404, when they explicitly request a clinic they are not assigned to and lack `canAccessAllClinics`.
4. **OWNER/ORG_ADMIN all-clinic behavior** — `'all'`/no-selector requests return organization-wide data (list/report routes) or succeed against any clinic in the org (mutation routes).
5. **Cross-organization denial** — a clinic id belonging to a different organization is always rejected with 403, never a silent empty/narrowed result (this must **remain** true post-fix; it is already true today via `buildClinicScopeWhere`'s DB-verified org-match check).
6. **Missing clinic selector** — omitted `clinicId` param preserves today's default behavior for existing callers (backward compatibility).
7. **Invalid clinic selector** — a well-formed but nonexistent clinic id returns 403, not a 500 or an empty-but-200 response.
8. **Inactive/archived clinic** — where applicable (routes touching `Clinic.status`), confirm suspended/cancelled clinics are excluded, matching `auth.ts`'s own `clinicInfo.status` checks.
9. **Record-owned clinic mismatch** — for record-derived-mutation routes (`appointmentRequests.ts`, `dentalChart.ts`, `services.ts`, `postTreatment.ts`, `inventory.ts`, `paymentPlans.ts`, `insuranceProvisions.ts`, `messages.ts`): a record genuinely owned by a clinic outside the caller's accessible set is never found/writable, even after the fix widens the lookup from "single clinic" to "accessible set."
10. **PHI/financial/clinical mutation scope** — for Batch 1/2 routes specifically: the created/updated record's `clinicId` matches the **looked-up record's own** clinic (post-fix) or the explicitly validated target clinic (create routes), never a value that bypassed validation.
11. **Backward compatibility for existing single-clinic clients** — the overwhelming majority of production users (single-clinic staff) see byte-identical behavior before/after each fix; this is the primary regression-safety net given no schema change and additive-only API surface.
12. **403 vs 404 behavior where security-sensitive** — `appointmentRequests.ts` mutation routes specifically need the 404-preserved-for-truly-nonexistent-or-inaccessible / widened-success-for-accessible-sibling-clinic distinction verified explicitly (§14.2).

**`reports.ts:73` additionally requires:** a dedicated test asserting the byPeriod breakdown for an org-wide (`'all'`) revenue-report request reflects **all** the organization's clinics' payments, not just the requester's own — this is the specific, previously-"manual review" defect this document resolves.

**Batch 4 (`planLimits.ts`)** requires only **characterization tests** confirming current behavior (no code change proposed without the prerequisite product decision) — specifically: reproduce the no-plan-organization state on a disposable database and record today's actual quota-check behavior, so the eventual fix (once authorized) has a documented "before" baseline. **No characterization test was executed as part of S2** — this document does not claim any test was run; §"Status separation" in the delivery report records `tests run: no`.

## 23. Backward compatibility

All 4 batches are additive-only at the API-contract level: every proposed fix either (a) adds an optional `clinicId`/`'all'` query parameter where none existed (defaulting to today's effective single-clinic behavior for callers who don't pass it), or (b) widens an internal lookup's `where` clause from a single clinic to an accessible-clinic set without changing the response shape. No existing endpoint's request or response schema changes. No endpoint that currently returns data stops doing so for any caller who could already reach it. The only behavior that becomes newly possible is exactly the previously-blocked case (a legitimately multi-clinic-authorized user now succeeding where they previously got a false 404/narrowed result) — this is a widening, not a narrowing or breaking change, for every existing legitimate caller.

## 24. Schema/migration impact

**None required for any of the 47 remediation-required occurrences.** Every fix is a pure application-code change (swap a raw `req.user.clinicId` read for a call to an already-existing, already-imported-elsewhere-in-most-files centralized helper, or add an optional query parameter). No new Prisma model, field, or migration is implicated by anything found in this inventory. If, during actual implementation (a separate, not-yet-authorized task), an unexpected schema need is discovered, the expand/migrate/contract pattern already established in this program's other KVKK work (e.g., KVKK-HIGH-007/008's additive-migration approach) should be followed, and explicit authorization requested before any migration is written — consistent with this document's own stop condition never being triggered, since no such need was found.

## 25. Rollback/cutback

Because no schema/migration is involved, rollback for every batch is a standard application redeploy to the pre-change commit — no data-loss risk, no `_prisma_migrations` interaction, no coordination with the R-070 migration-rollback tooling gap. Each batch should still be its own isolated PR (per the task's "smallest safe implementation batches" requirement) so a targeted redeploy is possible per-batch rather than an all-or-nothing rollback of all 47 occurrences at once.

## 26. Security/KVKK impact

- **Tenant-isolation vulnerability:** none confirmed (§18).
- **Cross-organization vulnerability:** none confirmed (§18).
- **Cross-clinic authorization issue:** none confirmed as an unauthorized-access issue; the confirmed issues are the *inverse* — legitimately-authorized multi-clinic access being incorrectly *denied* (access-narrowing).
- **Legitimate-access denial:** **confirmed, 45 of the 47 occurrences** (all G/F) — OWNER/ORG_ADMIN/multi-branch staff are denied legitimate cross-clinic/org-wide access through these specific endpoints.
- **Scope-consistency defect:** confirmed, `reports.ts:73` (internally inconsistent org-wide report response) and `planLimits.ts:64,86` (potential quota-check-target mismatch, pending product decision).
- **Audit attribution issue:** confirmed, non-blocking, 8 occurrences (§15/§18 item 5).
- **Functional completeness issue:** all 47 remediation-required occurrences, by definition (this is the umbrella the above more specific categories sit under).

No PHI/financial/clinical scope inconsistency is minimized here: `appointmentRequests.ts:192` (PHI-record creation), `dentalChart.ts` (clinical mutation), `paymentPlans.ts`/`insuranceProvisions.ts` (financial mutation), and `reports.ts:73/405` (clinical/financial reporting) are explicitly named as the highest-priority remediation candidates in §21 Batch 1, consistent with the task's instruction not to downgrade genuine PHI/financial inconsistencies to mere UX issues even though none rise to a confidentiality breach.

## 27. R-071 acceptance criteria

R-071 (`RISK_REGISTER.md`) remains **OPEN** after this document. Evidence required to change its status:

- **To keep OPEN (current state, unchanged by this document):** the classification and remediation plan are complete, but **zero** of the 47 occurrences have been fixed. R-071's "Eksik kontrol" (missing control) — migration of the flagged routes to the centralized helper — is entirely unaddressed by S2, which is a planning deliverable only.
- **To move to MITIGATED:** at minimum, Batch 1 (the task brief's explicitly-named highest-priority routes: `reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`, plus `reports.ts:73`) must be implemented, tested per §22, merged, and independently re-verified (not author-only) against a disposable database — mirroring the evidentiary standard already established for KVKK-HIGH-007/008 in this program. Partial-batch completion (e.g., only `reports.ts` fixed) should keep R-071 OPEN with an updated "remaining scope" note, not move it to MITIGATED, since the brief names both `reports.ts` and `appointmentRequests.ts` as equally high-priority.
- **To move to CLOSED:** all 4 batches implemented (or Batch 4's `planLimits.ts` component explicitly accepted as out-of-scope/no-action-needed via a recorded product decision), all merged, all independently test-verified, **and** production-deployed and behaviorally verified (not just deployed) — consistent with the production-verification standard this program has applied to every other KVKK-HIGH item (007/008) before treating them as complete.
- Independent of R-071 itself: this document's classification work should also be reflected as the new evidence pointer for R-071's "Kanıt" (evidence) column, replacing/supplementing the current pointer to the KVKK-HIGH-006 row and the S1 evidence file.

## 28. Residual ambiguities

1. **`planLimits.ts:64,86` (Batch 4)** — genuinely ambiguous pending a product decision on no-plan-organization quota semantics (§14.4). Not resolved by this document by design (task instruction: do not propose changing plan-limit behavior without confirming organization-plan semantics).
2. **`appointmentRequests.ts:192`'s transactionality gap** — a real robustness observation (sequential, non-transactional Patient/Appointment/Request writes) surfaced while tracing this occurrence, but it is not itself a `req.user.clinicId` finding and is recorded as an adjacent, separately-ticketable observation (§14.2), not folded into KVKK-HIGH-006's scope or its remediation-required count.
3. **Audit-attribution fidelity (8 `B` occurrences)** — a real, low-severity, non-blocking finding; whether it warrants its own remediation ticket or is accepted as-is is a product/compliance-team call, not resolved here.
4. **Exact source of the 32-vs-33 and 64-vs-67 count differences from prior passes (§17)** — attributed to bucket-definition/enumeration differences between passes (this pass discovered 4 files the priors did not name), not to a hidden or dropped finding; every one of the 93 raw matches in this pass is accounted for by exact file and line number in §13/§16, so no ambiguity remains **within this document's own count**, only in fully reconstructing exactly how the prior documents arrived at their slightly different intermediate figures.

## 29. Status separation

**KVKK-HIGH-006-S2:**
- Discovery completed: **yes** (full classification of all 93 raw / 67 non-test occurrences across 17 files).
- Occurrence classification completed: **yes**.
- Remediation plan completed: **yes** (4 batches, §21-22).
- Code changed: **no**.
- Tests run: **no** (no characterization test was executed; no code changed, so none was required).
- Docs written: **yes** (this file + the 4 permitted tracker/risk/compliance updates).
- Committed: **no**.
- PR opened: **no**.
- Merged: **no**.
- Deployed: not applicable.
- Production verified: not applicable.

**Parent KVKK-HIGH-006:**
- Remains **OPEN**.
- Implementation not started.
- Deployment not authorized.
- Production verification not started.
- **KVKK baseline is not stable** — unrelated OPEN items (R-046, R-061, R-070, and now R-071 with this document's evidence) remain outstanding; this document does not change that.

## 30. Exact next task

**KVKK-HIGH-006-S3 (or equivalent next task ID)** — implement **Batch 1** (`reports.ts:73,405`, `appointmentRequests.ts:152,192,346`, `dentalChart.ts:23,51,112`) as an isolated, reviewable PR: swap the flagged raw `req.user.clinicId` reads for `validateAndGetClinicIdScope` (list/report shape) or the record-derived-scope pattern (mutation shape), add the 12 required test cases per §22 against a disposable database, and independently (not author-only) re-verify before merge — mirroring this program's established evidentiary standard for prior KVKK-HIGH items. Batches 2-3 follow as separate, equally-isolated PRs once Batch 1's pattern is validated in review. Batch 4's `planLimits.ts` component requires a prerequisite product decision (§14.4/§28.1) before any implementation task can be scoped for it.

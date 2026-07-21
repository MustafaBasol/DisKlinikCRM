# KVKK-HIGH-006-S1 — Direct `defaultClinicId` Authorization-Path Verification

## 1. Task ID and parent task

**Task ID:** KVKK-HIGH-006-S1
**Title:** Direct `defaultClinicId` Authorization-Path Verification
**Parent task:** KVKK-HIGH-006 — Direct/Inconsistent Use of the Authenticated Request's Resolved Clinic Context in Runtime Authorization/Data-Scope Paths (`req.user.clinicId`), status `STILL_OPEN` / `READY_FOR_DETAILED_SCOPING` (see `NORAMEDI_MASTER_TRACKER.md` §12/§13, `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s KVKK-HIGH-006 row).

**This is a narrow side-verification of a distinct, subordinate question. It does not replace, satisfy, supersede, close, mitigate, or reduce the required scope of KVKK-HIGH-006.** KVKK-HIGH-006 remains open after this document is recorded.

## 2. Baseline SHA

Isolated worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-default-clinic-scope`, branch `fix/kvkk-high006-default-clinic-scope`, base `origin/main` @ `7174f3bb3518bca6b2640694ee2f9264c293318f`. Re-confirmed via fresh `git fetch origin main` immediately before this document was written: `git rev-parse HEAD` and `git rev-parse origin/main` both return `7174f3bb3518bca6b2640694ee2f9264c293318f` — no drift.

## 3. Evidence classification

`REPOSITORY_DISCOVERY_AND_CALL_PATH_VERIFICATION` — static, read-only source review and call-path tracing. No production access, no test execution beyond what already existed, no runtime code change.

## 4. Exact distinction between `defaultClinicId` and `req.user.clinicId`

- **`defaultClinicId`** — a nullable column on the `User` model. Per the Prisma schema's own documentation comment, it is "UI default only — NOT used for authorization." It exists to pre-select a clinic in navigation/dropdown UI for users who belong to more than one clinic. This document's scope is: does any runtime code path use this field, directly or indirectly, as the actual authorization or tenant-scope decision, bypassing validated-scope checks?
- **`req.user.clinicId`** — a property set on the Express request object by the `authenticate` middleware (`server/src/middleware/auth.ts`), resolved server-side from `decoded.clinicId || dbUser.defaultClinicId || dbUser.clinicId`, then validated against the user's `allowedClinicIds`/`canAccessAllClinics`/clinic-existence/organization-match before being attached to `req.user`. It is never client-supplied per individual request. `defaultClinicId` is one of several *inputs* to how this value is resolved once, at authentication time — it is not read again per-request as a raw, unvalidated value. Direct, inconsistent runtime use of `req.user.clinicId` itself (bypassing the codebase's centralized `validateAndGetClinicIdScope`/`validateAndGetScope` helpers) is the separate, broader, still-open subject of parent task KVKK-HIGH-006 — **not** the subject of this S1 verification.

## 5. Files reviewed

`server/src/routes/usersImport.ts`, `server/src/routes/instagramInbox.ts`, `server/src/routes/whatsappInbox.ts`, `server/src/services/instagram/instagramClinicResolver.ts`, `server/src/utils/relationGuards.ts`, `server/src/jobs/reminders.ts` (function `getSystemUserForClinic`), `server/src/services/taskAssignmentNotifier.ts`. `server/src/middleware/auth.ts` (`authenticate`) was traced as part of establishing the `req.user.clinicId` resolution chain referenced in §4.

## 6. Central clinic-scope contract

`server/src/utils/clinicScope.ts` — `buildClinicScopeWhere`, `validateAndGetScope`, `resolveEffectiveClinicId`, `buildClinicIdScope`, `validateAndGetClinicIdScope` (`clinicScope.ts:87,210`), `getAccessibleClinicIds` — plus `server/src/middleware/clinicAccess.ts` (`requireClinicAccess`, `requireSpecificClinicAccess`). None of the seven reviewed files' `defaultClinicId` usages call these helpers, because none of them perform a per-request client-facing authorization decision from `defaultClinicId` — see per-file findings below.

## 7. Initial inventory

A repository-wide search for `defaultClinicId` across `server/src` (excluding tests/fixtures/generated Prisma client) found usages in: the seven files listed in §5, plus the `User` Prisma model definition, `auth.ts`'s login/token-resolution chain, and assorted UI-preference read/write routes (profile update, user list) that only ever read or write the field as a display preference. The seven files in §5 were selected because they were the ones where `defaultClinicId` appeared adjacent to a clinic-resolution or clinic-attribution decision, making them the candidates where a direct-authorization misuse was most plausible.

## 8. Closure-review inventory

Each of the seven files was read in full (not excerpted) and its `defaultClinicId`-adjacent logic traced to its final effect (a Prisma query/mutation scope, a notification recipient lookup, or a resolved `clinicId` return value), per the three-way decision rule (A: confirmed no violation: `defaultClinicId` plays no authorization role; B: confirmed violation: `defaultClinicId` is the actual authorization/scope decision; C: ambiguous, needs further tracing). All seven resolved to decision A.

## 9. `usersImport.ts` validation

The bulk user-import route resolves a target `clinicId` for each imported row from explicit import-payload/query context (the clinic the import is being run against, itself validated via `requireClinicAccess`/`validateAndGetClinicIdScope` upstream in the route), not from any imported or existing user's `defaultClinicId`. Where `defaultClinicId` is written (for newly created users), it is set *to* the already-validated target `clinicId` — an output of the authorization decision, not an input to it. No violation.

## 10. Instagram inbox validation

`server/src/routes/instagramInbox.ts` reads/lists inbox entries scoped by `clinicId`/`organizationId` obtained via the route's own `validateAndGetClinicIdScope`/`getAccessibleClinicIds`-style access checks (consistent with the file's other routes). Where a user's `defaultClinicId` appears, it is used only to pre-select which clinic tab a staff member's UI should default to when they have no explicit clinic filter selected in the request — the underlying data query is still scoped by the validated accessible-clinic set, not by `defaultClinicId` directly. No violation.

## 11. WhatsApp inbox validation

`server/src/routes/whatsappInbox.ts` mirrors the Instagram inbox pattern: inbox-entry visibility and mutation are scoped through the route's validated clinic-access checks; `defaultClinicId` is consulted only as a UI-default fallback for which clinic's inbox view loads first when the requester has access to more than one clinic and supplied no explicit clinic selector. It is never substituted for the validated scope value in a Prisma `where` clause. No violation.

## 12. Instagram resolver validation

`server/src/services/instagram/instagramClinicResolver.ts` (`resolveClinicForInstagramMessage`/`resolveInstagramClinicFromKnownContext`) resolves the clinic for an *inbound* DM using a documented priority order: (A) existing open inbox conversation → same clinic; (B) single-clinic connection → auto-assign; (C) multi-clinic connection with exactly one `isDefault` link → use that link's clinic; (D) no connection links and exactly one active organization clinic → auto-assign; (E) otherwise → `needsClinicResolution: true`, resolved by staff, never guessed. The `isDefault` flag consulted here belongs to the `InstagramConnection`-to-clinic link table (`connection.clinics[].isDefault`) — a per-integration-connection default, **not** the `User.defaultClinicId` field — and is used only to pick among clinics the connection is already known to be linked to within the same organization; it never crosses an organization boundary and never substitutes for a validated per-request authorization check (there is no authenticated end-user request being authorized here — this is inbound-webhook clinic *attribution*, not access control). No violation, and no conflation with `User.defaultClinicId` exists in this file.

## 13. `relationGuards.ts` validation

`server/src/utils/relationGuards.ts` (`findPatientInClinic`, `findAppointmentTypeInClinic`, `findTreatmentCaseInClinic`, `findAppointmentInClinic`, `findUserAssignedToClinic`, `validateTaskRelations`) takes an explicit `clinicId` parameter in every exported function — supplied by each caller's own already-validated scope — and never reads `req.user.defaultClinicId`/`user.defaultClinicId` internally. `findUserAssignedToClinic` determines assignment via `user.clinicId === clinicId || user.canAccessAllClinics || user.userClinics.length > 0` (line 73) — `defaultClinicId` plays no role in this check at all. No violation.

## 14. `reminders.ts` attribution finding

`server/src/jobs/reminders.ts#getSystemUserForClinic` (background job context, no authenticated end-user request) looks up a system/attribution user for a clinic to attribute automated reminder-related records to. This lookup is not a tenant-scope or authorization decision — it does not gate access to any patient data or determine which clinic's data is queried (the job's clinic loop already supplies the clinic being processed independently). Where `defaultClinicId`/`clinicId` fields are matched to identify a candidate system user, this is an audit/attribution completeness question (which user record gets named as the sender), not an authorization boundary. No violation of the narrow question this document scopes; a separate, non-security completeness observation is recorded in §19 backlog note.

## 15. `taskAssignmentNotifier.ts` finding

`server/src/services/taskAssignmentNotifier.ts#sendTaskAssignmentNotification(clinicId, task)` receives `clinicId` as an explicit parameter from its caller (the task-creation/update route, itself already clinic-scoped). It looks up the assignee via `prisma.user.findFirst({ where: { id: task.assignedToId, isActive: true, OR: [{ defaultClinicId: clinicId }, { userClinics: { some: { clinicId } } }] } })` (lines 15–23) — this is a *lookup filter to find a WhatsApp-reachable user record matching the already-known, already-validated `clinicId`*, used only to decide whether/how to send a notification message. It is not an authorization decision: it does not grant or withhold access to patient/clinical data, and a canAccessAllClinics user whose `defaultClinicId` differs from `clinicId` and who lacks a matching `userClinics` row simply does not receive this specific WhatsApp notification — a notification-completeness gap, not a security violation. No violation of the narrow question this document scopes; recorded as the same separate backlog item as §14.

## 16. Ambiguous paths

**0.** Every one of the seven files' `defaultClinicId`-adjacent code paths resolved cleanly to decision A (no violation) upon full-function reading; none required escalation to decision C (ambiguous).

## 17. Violations

**0.** No file in scope uses `defaultClinicId` as a sole or primary authorization/tenant-scope source. Every access-control decision found in these seven files is made via an explicit, already-validated `clinicId` parameter, a centralized scope helper, or an equivalent authenticated-context value (`req.user.clinicId`, itself resolved and validated once at authentication time, not re-read as a raw per-request value) — never by dereferencing `defaultClinicId` directly as the access decision.

## 18. No-code-change conclusion

No runtime code was modified to produce this conclusion, and none is required by this document's own scope: the nullable `defaultClinicId` preference field was not found to be used as a sole authorization or tenant-scope source anywhere in the seven files reviewed. No tests were added or run because no code changed.

## 19. Limitations

- This review is scoped to the seven files named in §5, selected because they were the files where `defaultClinicId` appeared adjacent to a clinic-resolution or notification-attribution decision. It is **not** a repository-wide claim about every reference to `defaultClinicId` (e.g., plain UI-preference read/write routes were not individually re-traced in full, since their effect is display-only by inspection).
- This review does **not** evaluate the separate, broader question of whether `req.user.clinicId` itself is used directly (bypassing `validateAndGetClinicIdScope`/`validateAndGetScope`) in authorization/data-scope decisions elsewhere in the codebase — that is the explicit, distinct, still-open subject of parent task KVKK-HIGH-006, tracked separately, and is **not resolved, narrowed, or closed by this document**.
- The `reminders.ts`/`taskAssignmentNotifier.ts` notification/audit-attribution completeness observation (§14/§15) is recorded here as a non-security, low-priority, separate backlog item — it is not part of KVKK-HIGH-006 and is not implemented by this document.
- Production behavior was not verified; this is a static repository review only.

## 20. Explicit statement

**This evidence does not close or satisfy KVKK-HIGH-006.** KVKK-HIGH-006 (the broader `req.user.clinicId` direct-use/inconsistent-centralized-scope-helper remediation, currently `STILL_OPEN` / `READY_FOR_DETAILED_SCOPING`) is untouched by this document and remains open, unresolved, and unimplemented.

## 21. Exact parent-task next step

Parent task KVKK-HIGH-006's next step is **KVKK-HIGH-006-S2 — Raw `req.user.clinicId` Occurrence Classification and Remediation Plan** (see `NORAMEDI_MASTER_TRACKER.md` §13 and `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s KVKK-HIGH-006 row for the exact scope). This document (KVKK-HIGH-006-S1) does not begin, narrow, or substitute for that work.

---

**Status: `VERIFIED_NO_VIOLATION_FOUND`.** Ambiguous runtime paths: 0. Violations in S1 scope: 0. Runtime code change required for S1: no. Tests: not applicable — no code changed. Production verification: not performed. **KVKK-HIGH-006 remains open.**

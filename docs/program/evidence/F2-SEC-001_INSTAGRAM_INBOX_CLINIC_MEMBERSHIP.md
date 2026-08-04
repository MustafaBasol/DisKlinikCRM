# F2-SEC-001 — Enforce Clinic Membership on Instagram Inbox Status Mutation

**Phase:** F2 — Modular Boundaries, Guardrails, Entitlements, and Feature Flags (tenant-safety hardening)
**Type:** Narrowly scoped tenant-authorization security fix. No CI guardrail, no schema migration, no runtime module restructuring, no generalized authorization framework.
**Task status:** `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.
**Parallel wave:** Runs in parallel with F2-SEC-002 (WhatsApp legacy public API default-clinic removal). F2-SEC-002 files were not read, opened, or modified by this task. Both tasks use separate task-local branches/worktrees.

## 1. Baseline

- `git fetch origin --prune` + `git rev-parse origin/main` at task start → `e9c1765fa191223cb036ebfdb9c72b898e2fc52e` (PR #314's own merge commit into `main`).
- `git merge-base --is-ancestor ed533853568093054b217669b2c91eba538c2459 origin/main` → confirmed ancestor (PR #317's merge commit is present on this baseline).
- Task executed in a fresh, task-local isolated worktree at a path outside the primary working tree, branch `fix/f2-sec-001-instagram-inbox-clinic-membership`, created directly from freshly-fetched `origin/main` @ `e9c1765fa191223cb036ebfdb9c72b898e2fc52e` via `git worktree add ... -b fix/f2-sec-001-instagram-inbox-clinic-membership origin/main`.
- Primary working tree (`main`, HEAD `e9c1765`) was clean at task start (`git status --short` empty) and was never read, modified, staged, stashed, reset, or cleaned by this task.
- The pre-existing F2-SEC-002 worktree/branch was never opened, read, or modified by this task.
- CodeGraph was not invoked — scope was limited to the paths explicitly listed in the assigning prompt (`server/src/routes/instagramInbox.ts`, `server/src/utils/clinicScope.ts`, `server/src/middleware/auth.ts`, `server/src/utils/roles.ts`, `server/prisma/schema.prisma` model definition, existing Instagram tests), located via direct `Read`/`Grep`, not a repository-wide scan.

## 2. Exact endpoint and root cause

**Endpoint:** `PATCH /api/instagram/inbox/:id/status` — `server/src/routes/instagramInbox.ts`, route defined at (pre-fix) lines 769–794.

**Authentication chain:** `authenticate` (`server/src/middleware/auth.ts`) — verifies the session JWT, loads the user from a 15s-TTL cache, and populates `req.user.allowedClinicIds` from real `UserClinic` membership rows (not client-supplied), plus `req.user.organizationId`, `req.user.canAccessAllClinics`, `req.user.clinicId` (session/default clinic — UI convenience only, **not** an authorization signal).

**Role authorization chain:** `authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DOCTOR'])` — role gate only (canonical + legacy raw-role match). Unlike every other handler in this file, the pre-fix handler called none of `canViewInstagramInbox` / `canResolveInstagramConversation` / `canReplyInstagramMessages` — this is pre-existing, intentional (this endpoint's own role list already differs slightly from its siblings, e.g. it additionally allows the legacy raw role `"doctor"`) and was left untouched.

**Pre-fix record lookup:**
```ts
const entry = await prisma.instagramInboxEntry.findFirst({
  where: { id, organizationId: req.user!.organizationId },
});
```
Scoped only by `organizationId` — no clinic-membership predicate.

**Pre-fix mutation predicate:**
```ts
const updated = await prisma.instagramInboxEntry.update({
  where: { id },
  data: { status },
});
```
Scoped only by primary key `id` — no `organizationId`/`clinicId` in the write predicate at all; relied entirely on the (already-insufficient) prior `findFirst` app-level check.

**Root cause:** Every other mutating handler in this exact file (`/resolve`, `/link-patient`, `/assign-clinic`, `/conversations/:id/reply`, `/create-appointment-request`, `/create-appointment`) calls the file-local `getAllowedClinicIds(user)` helper (lines 55–60) and rejects when `entry.clinicId` is outside the caller's `allowedClinicIds`. The `PATCH /:id/status` handler was the sole exception — it never called this helper.

**Exact tenant-boundary bypass:** Any authenticated user holding one of the five authorized roles, anywhere in the same organization, could mutate the status of — and receive back the full unredacted contents (`lastMessageText`, `senderUsername`, `externalSenderId`, `patientId`, `rawPayload`, etc. — no `select` narrowing) of — any `InstagramInboxEntry` row in that organization, regardless of which clinic(s) the caller is actually a member of via `UserClinic`. `req.user.clinicId` (the session-default clinic) was never consulted, and `req.user.allowedClinicIds` (the real membership list) was never consulted either — the check was simply absent.

**Same-org/different-clinic scenario:** User U1 (role `CLINIC_MANAGER` or `RECEPTIONIST`, `allowedClinicIds=[clinicA1]`, `canAccessAllClinics=false`) in Organization A calls `PATCH /api/instagram/inbox/{entryOwnedByClinicA2}/status`. Pre-fix: `findFirst` succeeds (organization matches), `update` succeeds (id matches) → `200` with the full Clinic A2 entry returned to a user with zero legitimate access to Clinic A2. Reproduced and confirmed on this baseline before the fix (test scenario 3 in §5, run against the pre-fix handler during root-cause verification).

**Cross-org scenario:** A user in Organization B calls `PATCH` on an entry belonging to Organization A. The `organizationId` filter in the `findFirst` already excluded this case pre-fix (→ `404`) — cross-organization access was **not** the vulnerable path; the defect was specifically the missing intra-organization clinic-membership check.

## 3. Accepted authorization primitive reused

This file's own local `getAllowedClinicIds(user)` helper (`instagramInbox.ts:55–60`) — semantically equivalent to `clinicScope.ts`'s `getAccessibleClinicIds`/`buildClinicIdScope` (returns `null` for OWNER/ORG_ADMIN/`canAccessAllClinics` = unrestricted-within-org; returns the real `allowedClinicIds` array otherwise) — was reused unchanged. It is already the accepted, consistently-applied primitive for every other mutating handler in this file. No second/competing authorization model was introduced; `clinicScope.ts` was read for cross-reference but not imported, since the file-local helper is the established convention within this exact route file.

## 4. Final implementation

```ts
const entry = await prisma.instagramInboxEntry.findFirst({
  where: { id, organizationId: user.organizationId },
  select: { id: true, clinicId: true },
});
if (!entry) return res.status(404).json({ error: 'Entry not found' });

const allowedClinicIds = entry.clinicId ? await getAllowedClinicIds(user) : null;

const result = await prisma.instagramInboxEntry.updateMany({
  where: {
    id,
    organizationId: user.organizationId,
    ...(allowedClinicIds ? { clinicId: { in: allowedClinicIds } } : {}),
  },
  data: { status },
});
if (result.count === 0) return res.status(404).json({ error: 'Entry not found' });

const updated = await prisma.instagramInboxEntry.findUnique({ where: { id } });
return res.json({ entry: updated });
```

**Final tenant-scoped lookup/write predicate:** the clinic-membership scope is embedded directly in the `updateMany` write predicate (`clinicId: { in: allowedClinicIds }`), not applied as a separate app-level branch after an unscoped write. A same-org/wrong-clinic entry and a genuinely nonexistent one both produce `result.count === 0`, classified without any further unscoped lookup, and return the byte-identical `404 { error: 'Entry not found' }`.

**Fail-closed / non-enumeration:** nonexistent id, cross-organization id, and same-organization/wrong-clinic id all return the identical `404 { error: 'Entry not found' }` — status code and body are indistinguishable in all three cases (verified by `assert.deepEqual` across all three response bodies in the added test, §5 scenario 5). This is a deliberate hardening beyond the *sibling* handlers in this same file (which use a distinguishable `403` for the same-org/wrong-clinic case) — the assigning task's explicit test requirement ("nonexistent and inaccessible records return the same external status/body shape") takes precedence for this endpoint; the sibling handlers were not touched and are unaffected.

**Client-supplied `clinicId` / session-default `clinicId`:** the endpoint's request body only ever consumed `status`; it never read a `clinicId` field, so there was nothing to strip. The fix additionally proves (test scenarios 6–7) that a `clinicId` value present in the body, and a session-default `req.user.clinicId` pointing at an inaccessible clinic, both have zero effect on the authorization outcome — only `req.user.allowedClinicIds` (real DB membership) and `req.user.canAccessAllClinics` are consulted.

**No default-clinic / wildcard / system-bypass path** was introduced or exists.

## 5. Role and audit preservation

- `authorize([...])` allow-list is byte-for-byte unchanged. OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST, and the legacy raw role `"doctor"` continue to succeed on their own accessible clinics (test scenario 9); BILLING (already excluded) remains denied, rejected by `authorize()` itself before any clinic-scope logic runs.
- The pre-fix handler emitted **no** audit/activity event for this endpoint (unlike its siblings `/resolve`, `/reply`, `/create-appointment-request`, `/create-appointment`, which do call `writeAuditLog`). This is preserved as-is — no audit call was added, per "preserve existing behavior, do not introduce a new audit architecture."

## 6. Tests

**File:** `server/src/tests/instagramInboxStatusClinicScope.test.ts` (new). Follows the repository's established direct-chain-invocation convention (see `paymentsListFieldScope.test.ts`, `communicationPreferencesRoute.test.ts`): the route's own `router.stack` is walked to extract its middleware chain; the real `authenticate` middleware is excluded from the extracted chain (no supertest/live-JWT harness exists anywhere in this repo — same documented exclusion as `organizationMessagingConnectionScope.test.ts`), while `authorize()` and the handler are run for real against a constructed `AuthRequest`/mock `Response`, over the real (disposable) PostgreSQL database. No membership, ownership, or write-predicate logic is mocked.

**Fixture topology:** Organization A (Clinic A1, Clinic A2), Organization B (Clinic B1); three `InstagramInboxEntry` rows, one owned by each clinic. Actors are constructed `AuthRequest.user` objects (matching the established fixture convention in this repo, which does not create real `User` rows for route-level actor identity), covering U1 (`allowedClinicIds=[A1]`), U2 (`allowedClinicIds=[A1,A2]`), OWNER (`canAccessAllClinics=true`), legacy `"doctor"`, and BILLING.

**13 test cases, all passing** — mapped 1:1 to the assigning task's 13 minimum scenarios: same-clinic success; multi-clinic success (both clinics); same-org/different-clinic denial (two role variants); cross-org denial; three-way non-enumeration (`assert.deepEqual` on response bodies); body-supplied `clinicId` ignored; session-default `clinicId` ignored; unrelated-record integrity (rejected mutation leaves other records' `status` unchanged); role preservation (OWNER, legacy doctor, BILLING-denied). No audit-behavior test was added (§5 — nothing to preserve, none existed pre-fix).

`package.json` wiring: added `"test:instagram-inbox-status-clinic-scope": "tsx src/tests/instagramInboxStatusClinicScope.test.ts"`, appended to the root `test` aggregate and to `server:test:legacy-db-required` immediately after `test:instagram`, matching the existing placement convention for `test:payments-list-field-scope`.

## 7. Exact test commands and results

Run against a disposable PostgreSQL container provisioned by this repository's own test-runtime orchestrator (`scripts/test-runtime/orchestrator.ts postgres-compat`, which runs `server:test:legacy-db-required`):

- `npx tsx scripts/test-runtime/orchestrator.ts postgres-compat`
  - Disposable run ID: `20260804T065010Z-59d9f8e5-46116`
  - Container: `nmtest-pg-postgres-compat-20260804t065010z-59d9f8e5-46116`
  - Database: `nmtest_postgres_compat_20260804t065010z_59d9f8e5_46116`
  - Migration: `code: 0, step: "ok"`
  - `test:auth` — 55/55 passed
  - `test:instagram` (instagramProvider + instagramConversion + instagramAssistantParity) — 28/28 passed
  - **`test:instagram-inbox-status-clinic-scope` (this task's focused test) — 13/13 passed**
  - Remaining `server:test:legacy-db-required` members ran to completion; one pre-existing, unrelated failure observed (see below); cleanup: `success: true, errors: []` — container/network fully torn down, no residual Docker resources.
- `npx tsx src/tests/multiBranchAccess.test.ts` (tenant/multi-branch isolation suite, `test:roles`) — 142/142 passed. Pure logic suite, no DB dependency (confirmed by source inspection and by running it standalone with no `DATABASE_URL` set).
- `npx tsc --noEmit` (backend TypeScript validation, from `server/`, after `npx prisma generate`) — clean, zero errors.
- `git diff --check` — clean, no whitespace-conflict markers.

**Pre-existing, unrelated failure (not caused by this change):** `test:clinic-bulk-export` reported `116 passed, 1 failed` — `✗ status DTO never serializes sensitive fields` (`expected the explicit status DTO block to be present`), a structural/source-text assertion inside the unrelated KVKK clinic-bulk-export subsystem (`server/src/routes/clinicBulkExport.ts` / its DTO). This task's diff touches exactly three files — `server/src/routes/instagramInbox.ts`, `server/package.json`, `server/src/tests/instagramInboxStatusClinicScope.test.ts` — none of which the clinic-bulk-export DTO test reads or exercises; it cannot be caused by this change. Not investigated further — out of this task's scope (no clinic-bulk-export file was opened or modified).

**Full-suite escalation:** not triggered. No shared clinic/auth helper (`clinicScope.ts`, `roles.ts`, `middleware/auth.ts`) was modified; the focused test, the existing Instagram suite, and the multi-branch isolation suite all pass; no broader regression was exposed.

## 8. Migration

No Prisma schema change. No migration. No data backfill. Confirmed unnecessary: `InstagramInboxEntry.clinicId` already exists as a nullable field on the model; the fix is a query/predicate change only.

## 9. Rollback

Revert this task's single commit/PR. No migration rollback, no data rollback, no infrastructure rollback, no queue rollback, no provider-configuration rollback applies — none was performed or is implied.

## 10. Tenant / security / KVKK impact

- **Tenant isolation:** closes the intra-organization cross-clinic mutation path on `PATCH /instagram/inbox/:id/status`. Cross-organization access was already closed pre-fix and remains closed. Access is not broadened for any role or clinic.
- **Security:** fail-closed authorization; no record-existence or clinic-ownership leak (three-way non-enumeration proven by test); no default-clinic shortcut; no wildcard/system bypass.
- **KVKK:** prevents unauthorized alteration of a tenant-owned communication record's status by staff outside the owning clinic. No retention/deletion behavior change, no physical-storage impact, no consent-flow change. KVKK physical architecture freeze remains active and is unaffected by this query-level fix.
- **Runtime:** one additional `findUnique` in the success path (replacing the previous single `update`'s implicit read-back) plus the existing `findFirst`; negligible latency impact on a low-volume staff-facing endpoint. No new service, no queue impact, no worker impact, no provider API impact.

## 11. Program-control status (unchanged by this task)

- Shared program-control files (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`) were **not** modified by this task; reconciliation of this fix into those documents remains pending, to be done by a later, non-parallel consolidation task (as with F2-GUARDRAIL-PREP-010-D for the prior wave).
- F2-SEC-002 (WhatsApp legacy public API default-clinic removal) remains a fully separate, parallel, untouched task.
- Guardrail CI implementation remains unauthorized and was not attempted.
- Stage 2 Imaging remains blocked and was not touched.
- Runtime modularization and G1/G2 remain unapproved and were not touched.

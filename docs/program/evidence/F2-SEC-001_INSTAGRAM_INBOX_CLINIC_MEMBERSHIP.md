# F2-SEC-001 — Enforce Clinic Membership on Instagram Inbox Status Mutation

**Phase:** F2 — Modular Boundaries, Guardrails, Entitlements, and Feature Flags (tenant-safety hardening)
**Type:** Narrowly scoped tenant-authorization security fix. No CI guardrail, no schema migration, no runtime module restructuring, no generalized authorization framework.
**Task status:** `AGENT_COMPLETED` / `TARGETED_TESTS_PASSED` / `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`. Includes the F2-SEC-001-R1 follow-up (§12) pushed as a second commit to the same PR #318 / branch — no new branch/PR was created.
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

**`LOCAL_WIN32_ONLY_NON_REPRODUCING_IN_AUTHORITATIVE_CI` / `PR_CAUSATION_NOT_EVIDENCED`:** `test:clinic-bulk-export` reported `116 passed, 1 failed` — `✗ status DTO never serializes sensitive fields`, inside the unrelated KVKK clinic-bulk-export subsystem. Corrected classification (see §12.6 for the full root-cause trace and re-confirmation under R1): this task's diff never touches `clinicBulkExport.ts` or its test, and the failing assertion (`server/src/tests/clinicBulkExport.test.ts`, "status DTO never serializes sensitive fields") does a literal-`\n` substring search (`source.indexOf('res.json({\n      jobId: row.id,')`) against the raw bytes of `server/src/routes/clinicBulkExport.ts` read straight off disk. That source file is checked out with CRLF line endings on this Windows machine (confirmed directly: 548 `\r\n`, 0 bare `\n`), so the LF-only search string never matches — a Windows-checkout line-ending artifact, not a code defect. This exact same run's PR CI (Layer 5 backend, Linux runner, LF checkout) passed this bucket 9/9 on head `190b0f9`. Not merely asserted as "pre-existing" — reproduced with an identified mechanism, on unmodified code, independent of this PR's content.

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

## 12. F2-SEC-001-R1 — Eliminate Post-Mutation Unscoped Read and Close Response-Scope TOCTOU

Follow-up finding on this same PR/branch (no new branch/PR/migration): the §4 implementation paired a tenant-scoped `updateMany` write with a **separate, unscoped** `findUnique({ where: { id } })` read to build the response body. The write predicate was tenant-scoped; the read was not. If clinic ownership changed after the write committed and before the read executed, the endpoint could return the full post-reassignment row — a tenant-data-disclosure window, independent of the §2 defect this PR originally closed.

### 12.1 Mandatory analysis

- **Prisma version:** `7.8.0` (`server/package.json`, both `prisma` and `@prisma/client`).
- **Capability confirmed by direct inspection of the generated client** (`server/node_modules/.prisma/client/index.d.ts`): `InstagramInboxEntryDelegate` exposes `updateManyAndReturn<T extends InstagramInboxEntryUpdateManyAndReturnArgs>(...)`, generated for every model in this schema (no preview flag required — stable in this Prisma major). On PostgreSQL this compiles to a single `UPDATE ... WHERE ... RETURNING *` statement — one round trip, one atomic operation, no follow-up read.
- Inspected only the paths the task scoped: `server/src/routes/instagramInbox.ts`, `server/src/tests/instagramInboxStatusClinicScope.test.ts`, `server/package.json`, `server/prisma/schema.prisma` (generator/provider block + the `InstagramInboxEntry` model), and the generated Prisma client's own `.d.ts` for the exact delegate signature. No CodeGraph, no repo-wide scan.

### 12.2 Blocking root cause (confirmed, not assumed)

```ts
// pre-R1 (already tenant-scoped write, but...)
const result = await prisma.instagramInboxEntry.updateMany({
  where: { id, organizationId: user.organizationId, ...(allowedClinicIds ? { clinicId: { in: allowedClinicIds } } : {}) },
  data: { status },
});
if (result.count === 0) return res.status(404).json({ error: 'Entry not found' });

// ...the response was built from a SEPARATE, unscoped read:
const updated = await prisma.instagramInboxEntry.findUnique({ where: { id } });
return res.json({ entry: updated });
```
The `findUnique` carries no `organizationId`/`clinicId` predicate at all — it trusts that whatever the write just touched is still the row the caller is authorized to see, which is not guaranteed once the write and the read are two separate statements.

### 12.3 Chosen atomic mutation-and-return mechanism

`updateManyAndReturn`, with the identical tenant-scoped `where` the prior `updateMany` used:

```ts
const updatedRows = await prisma.instagramInboxEntry.updateManyAndReturn({
  where: {
    id,
    organizationId: user.organizationId,
    ...(allowedClinicIds ? { clinicId: { in: allowedClinicIds } } : {}),
  },
  data: { status },
});
if (updatedRows.length === 0) return res.status(404).json({ error: 'Entry not found' });
if (updatedRows.length > 1) {
  // Impossible under the current schema (id is the primary key) — fail
  // closed instead of silently returning an arbitrary row.
  return res.status(500).json({ error: 'Failed to update status' });
}
return res.json({ entry: updatedRows[0] });
```
`id` is `InstagramInboxEntry`'s `@id` column, so the predicate can only ever match 0 or 1 rows; the `>1` branch is an explicit, tested (not merely assumed) fail-closed guard rather than a silent `[0]` pick.

**Response-scope guarantee:** the row returned to the caller is, by construction, the exact row the single atomic `UPDATE ... RETURNING` statement matched under the tenant-scoped `WHERE` at the moment of that statement — not a value observed by any later, separately-scoped query. There is no second Prisma call, and no `prisma.instagramInboxEntry.findUnique` call anywhere in this handler post-fix (proven by test, §12.5).

**No `select`** was added — omitting `select` returns the same full-scalar-field shape `findUnique` used to return (no relations either way), so the response body shape is unchanged from pre-R1.

### 12.4 Null-clinic (`clinicId == null`) semantics — unchanged, evidenced

Inspected every sibling handler in this same file: `GET /instagram/inbox/:id/messages` and `POST /instagram/conversations/:id/reply` both use the identical pattern — `if (entry.clinicId) { /* apply allowedClinicIds check */ }` — meaning an entry with no clinic assigned yet is treated as **org-level and unrestricted** (any role permitted by that endpoint's own `authorize()` list may act on it, regardless of `allowedClinicIds`). The `PATCH /:id/status` handler already followed this exact convention pre-R1 (`entry.clinicId ? await getAllowedClinicIds(user) : null`) and R1 does not change it — no new policy was invented. A focused test (§12.5, section 12 of the test file) now documents this explicitly for this endpoint, where previously it was only implied by the conditional.

### 12.5 Tests added (all under `server/src/tests/instagramInboxStatusClinicScope.test.ts`, sections 10-12; original 13 scenarios in sections 1-9 unchanged)

1. **No post-mutation unscoped read** — a bound-original method spy on `prisma.instagramInboxEntry.findUnique` (try/finally-restored, matching the established spy pattern in `imagingLifecycleFacade.test.ts`) proves the handler invokes it **zero times** during a successful PATCH.
2. **Response is the atomic write's own row** — a spy on `prisma.instagramInboxEntry.updateManyAndReturn` captures both the call's `where` (asserted tenant-scoped: `id`, `organizationId`, `clinicId: { in: [...] }`) and its return value, then asserts the HTTP response body's `entry` is `deepEqual` to `capturedResult[0]` — proving the response is sourced directly from the scoped write, not reconstructed from any other read.
3. **Deterministic concurrency regression** — a bound-original spy on `prisma.instagramInboxEntry.findFirst` (the handler's only DB call before its atomic write) synchronously performs a real, committed clinic reassignment (`clinicA1` → `clinicA2`) inside the spy's own continuation, guaranteed by plain `await` sequencing (no sleep, no poll, no artificial gate) to land after the handler's initial lookup and before its `updateManyAndReturn` call evaluates its `WHERE`. Asserts: the A1-only caller receives `404 { error: 'Entry not found' }` (never a body containing any entry data), and the row's `status` remains unmodified (`'open'`) — the stale-scope write never applied, while a direct DB read confirms the reassignment itself did commit (`clinicId === clinicA2`). This is a stronger proof than a raw `Promise.all` race (used elsewhere in this repo, e.g. `imagingRequestConcurrencyCharacterization.test.ts`, for a gap that is *not* closed): it targets the exact application-level boundary the fix eliminates, deterministically, every run.
4. **Null-clinic accepted behavior** — a clinic-restricted user (`allowedClinicIds=[A1]`, `canAccessAllClinics=false`) successfully mutates a freshly created `clinicId: null` entry in their own org; response `entry.clinicId` is `null`.
5. **Original 13 non-enumeration/scope/role tests** — unchanged, all still passing (sections 1-9).

### 12.6 Exact test commands and results (R1)

- `npx tsc --noEmit` (from `server/`) — clean, exit 0.
- `git diff --check` — clean, exit 0; diff still touches exactly the same two source files as §7 plus this evidence doc (`server/src/routes/instagramInbox.ts`, `server/src/tests/instagramInboxStatusClinicScope.test.ts`, `docs/program/evidence/F2-SEC-001_INSTAGRAM_INBOX_CLINIC_MEMBERSHIP.md`) — no `server/package.json` change was needed this round (no new npm script; the existing `test:instagram-inbox-status-clinic-scope` entry already runs this file).
- `npx tsx src/tests/multiBranchAccess.test.ts` (`test:roles`, from `server/`) — **142/142 passed** (pure logic, no DB dependency).
- `npx tsx scripts/test-runtime/orchestrator.ts postgres-compat` (disposable PostgreSQL; runs `server:test:legacy-db-required`):
  - Disposable run ID: `20260804T072413Z-0e5916ba-40652`
  - Container: `nmtest-pg-postgres-compat-20260804t072413z-0e5916ba-40652`
  - Database: `nmtest_postgres_compat_20260804t072413z_0e5916ba_40652`
  - Migration: `code: 0, step: "ok"`
  - `test:auth` — 55/55 passed
  - `test:instagram` (instagramProvider + instagramConversion + instagramAssistantParity) — 28/28 passed
  - **`test:instagram-inbox-status-clinic-scope` (this task's focused test, now 17 scenarios: original 13 + 4 new) — 17/17 passed**
  - Remaining `server:test:legacy-db-required` members ran to completion; the single failure is the CRLF-checkout artifact in §7 (`LOCAL_WIN32_ONLY_NON_REPRODUCING_IN_AUTHORITATIVE_CI`), not caused by this change.
  - `cleanup`: `{"success": true, "errors": []}` — container + network fully torn down; **zero residual Docker resources**.
  - Orchestrator's own process exit code was `1` **solely** because of that one unrelated CRLF-artifact test (`"test": {"code": 1}` in the orchestrator's JSON summary above), not because of any F2-SEC-001-R1 test.

### 12.7 Migration / compatibility / rollback

No schema change, no migration (unchanged from §8). Response body shape is unchanged (same scalar fields, no `select`/relations added or removed) — fully backward compatible. Rollback: revert the R1 commit on top of the already-open PR #318; no data/infra/migration rollback applies.

### 12.8 Tenant isolation / security / KVKK / runtime impact

- **Tenant isolation:** closes a second, narrower disclosure window (post-write TOCTOU) layered on top of the §10 tenant-isolation fix. No access is broadened for any role or clinic.
- **Security:** the response is now provably sourced from the same atomic, tenant-scoped statement as the write — no interval in which a concurrent reassignment can be observed by this endpoint's response.
- **KVKK:** no retention/deletion/consent-flow change; this is a query-atomicity correction only.
- **Runtime/query impact:** **one fewer** round trip than the §4 implementation (`updateManyAndReturn` replaces `updateMany` + `findUnique` with a single statement) — a small, unambiguous improvement, not a regression.

### 12.9 PR / review status (R1)

Pushed as a second commit (`fix(instagram): return status mutation result within clinic scope`) to the existing PR #318 / branch `fix/f2-sec-001-instagram-inbox-clinic-membership` — no new branch, no new PR. New head SHA, CI result, and review-thread status are recorded in the delivery report accompanying this task; not merged, not deployed.

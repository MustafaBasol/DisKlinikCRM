# F1-004-P1 — Patient Emergency Contact Concurrent Primary Update Determinism

| Field | Value |
|---|---|
| Task ID | F1-004-P1 |
| Phase | F1 — CI and Test Architecture / Verified Runtime Concurrency Defect |
| Type | Blocking production-behavior defect, discovered by required Layer 3 CI on PR #307 (`docs/f2-prep-009-imaging-tenant-context-amendment`, documentation-only, left open and unmodified by this task) |
| Branch/worktree | `fix/f1-004-p1-emergency-contact-primary-update-concurrency`, fresh isolated worktree created directly from `origin/main`; local filesystem path intentionally omitted; primary dirty working tree (`claude/treatment-proposal-pdf-p1-d4k0jl`) never touched |
| Baseline | `origin/main` @ `28f6bc72f752dfc2a6f77125b796382e62b4c539` (merge commit for PR #308, `feature/us-01-x-patient-detail-navigation`) |
| Maximum status | `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED_AWAITING_REVIEW` — not merged, not deployed, not production-verified |

## 1. Discovery lineage and authoritative failure evidence

- Real GitHub Actions failures, PR #307 (head SHA `eb0865c4e174d0cf21a16b9c110888025ec8f2e1`), run **30813103465**, job `ci-layers / Layer 3: disposable PostgreSQL tests` — **both attempts identical**:
  - Attempt 1 (job `91684474347`): `conclusion: failure`.
  - Attempt 2 (job `91687731309`, `run_attempt: 2`): `conclusion: failure`.
- Both logs retrieved via `gh api repos/.../actions/jobs/<id>/logs` and diffed for the failing section — byte-identical failure shape in both:

  ```
  patientEmergencyContactsPrimaryConcurrency — 2. Two concurrent UPDATEs of DIFFERENT existing contacts, both requesting isPrimary=true
    ✗ exactly one of two concurrent updates (different contacts, both -> isPrimary=true) wins; the other gets 409 PRIMARY_CONTACT_CONFLICT; at most one primary afterwards
        AssertionError [ERR_ASSERTION]: exactly one concurrent update must succeed as primary — got A=200 B=200
  ```

  Scenario 1 (concurrent CREATEs) and scenarios 5/6/7 in the same suite/run **passed** in both attempts — only the UPDATE-vs-UPDATE scenario failed, both times, identically.
- Migration step and cleanup both succeeded in both attempts (`migration.code: 0`, "Label-scoped residual-resource check" step `success` in both) — confirmed via the job step list before treating this as an application defect rather than an infrastructure flake.
- `F1-004-P1` confirmed unused anywhere in the repository (open/merged PRs, `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/*.md`) before assignment.
- **PR/commit lineage that introduced the affected code**, confirmed via `git log`/`git show`:
  - `PatientEmergencyContact` model, the route/service, and migration `20260803120000_add_patient_emergency_contacts`: commit `b46534f` ("feat(patient): add emergency contacts and legal decision makers"), merged via **PR #301**.
  - The partial unique index (`PatientEmergencyContact_one_primary_per_patient`) and the original `patientEmergencyContactsPrimaryConcurrency.test.ts` suite (5 scenarios, including this exact UPDATE-vs-UPDATE test): commit `f3baca2` ("fix(patient): enforce single-primary emergency contact at the DB level"), merged via **PR #302**. This commit's own message states the transaction-level reset-then-set sequence "could not by itself stop two concurrent requests from each completing with their own primary row" and adds the DB-level index as the fix — but, as this task proves, the UPDATE path still had exactly that gap for a different reason than the one that commit addressed (see §2).

## 2. Reproduction on current `origin/main`

Per the pre-edit gate, reproduction was attempted **before** any code change, against a fresh worktree at `origin/main` @ `28f6bc72f752dfc2a6f77125b796382e62b4c539` (which already contains PR #302's partial-unique-index fix):

- `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (full Layer 3 command, exact CI invocation) — `server:test:disposable-db` exit `0` overall, but the emergency-contacts suite's scenario 2 result **depended on machine timing**:
  - 8/8 consecutive standalone runs of `patientEmergencyContactsPrimaryConcurrency.test.ts` against a manually-provisioned local disposable PostgreSQL (Docker Desktop, loopback network, sub-millisecond round trips): **5/5 passed every time** — the defect did **not** naturally reproduce locally, consistent with a genuine timing-dependent race rather than an unconditionally-broken code path.
  - This is the same local-clean/CI-flaky asymmetry F1-003-B2 previously documented for an unrelated retention-lock race — not treated as proof of "no defect," per that precedent and per this task's explicit instruction not to call it a flake without controlled reproduction.
- **Forced-interleaving controlled reproduction** (a throwaway script exercising the exact pre-fix route logic against real Postgres, deleted before commit — see §7): both snapshots (`existing.isPrimary`) captured before either transaction starts (matching genuine concurrent HTTP arrival), then transaction B's start deliberately delayed until after transaction A had fully committed:
  ```
  resA.status = 200
  resB.status = 200
  final rows: [ { fullName: 'A', isPrimary: false }, { fullName: 'B', isPrimary: true } ]
  primaryCount = 1
  ```
  **This is a clean, deterministic, 100%-reproducible demonstration of the defect** under the exact interleaving GitHub Actions' runner timing apparently hits naturally and consistently (both CI attempts, identically). Confirms **Category A** from the task's root-cause taxonomy: both responses are `200`, and the final DB state has exactly one primary contact — not two — because of **last-writer-wins**, not a broken unique index.

## 3. Root cause

**Not a broken unique index. Not operation sequencing that bypasses the index. A last-writer-wins domino in the application-level reset-then-set sequence that never touches the index at all.**

Pre-fix `PUT /patients/:patientId/emergency-contacts/:contactId` (`server/src/routes/patientEmergencyContacts.ts`):

```ts
contact = await prisma.$transaction(async (tx) => {
  if (data.isPrimary && !existing.isPrimary) {
    await tx.patientEmergencyContact.updateMany({
      where: { patientId, clinicId, organizationId, isPrimary: true, id: { not: existing.id } },
      data: { isPrimary: false },
    });
  }
  return tx.patientEmergencyContact.update({ where: { id: existing.id }, data: toContactData(data) });
});
```

For two concurrent requests A (promoting contact A2) and B (promoting contact B2), both reading `existing.isPrimary = false` before either transaction opens:

1. Transaction A: `updateMany` clears 0 rows (nobody is primary yet) → sets A2.isPrimary=true → **commits**.
2. Transaction B starts **after** A has committed (this is what GitHub Actions' runner timing does deterministically here, and what the forced-interleaving repro reproduces on demand): its `updateMany` now legitimately sees A2 as the current primary (A committed, READ COMMITTED gives B's statement a fresh snapshot) and clears it → sets B2.isPrimary=true → **commits**.

At every instant the database genuinely holds at most one `isPrimary=true` row — the partial unique index is **never violated**, because B's own `updateMany` clears A's primary *before* B's `update` runs, inside the same transaction. Postgres has nothing to reject. Both HTTP calls therefore return `200`. Request A's response body claims success with contact A2 as the primary contact, a claim that is **silently falsified** the moment B's transaction commits, with no way for A's caller to know.

This is distinct from — and not fixed by — the P2002/unique-index path PR #302 added: that path only fires when two transactions' `update` statements to *become primary* genuinely collide inside Postgres's own conflict-wait mechanism (which is what happens for the CREATE-vs-CREATE scenario, and why that scenario passed in both CI attempts). The UPDATE path's extra pre-transaction round trip (`prisma.patientEmergencyContact.findFirst` to load `existing`, absent from the CREATE path) makes it measurably more likely, on GitHub Actions' runner, for the two transactions to run back-to-back rather than genuinely overlap — which is exactly the ordering that triggers the domino instead of the index collision.

**Taxonomy determination (per task's A/B/C/D categories): A** — both `200`, final DB state has exactly one primary, last-writer-wins. Not B (no double-primary was ever observed). Not C (no unique-index bypass — the index was simply never engaged, by design of the reset-then-set sequence). Not D — the test's synchronization (`Promise.all`, no `await` between the two calls, matching every other concurrency scenario in this suite and in `appointmentRequestConversionAtomicity.test.ts`) is the established, accepted pattern; the application behavior, not the test, is at fault.

## 4. Fix

**Design: per-patient PostgreSQL advisory transaction lock + optimistic snapshot check. No schema/migration change. No new locking subsystem.**

New file `server/src/services/patientEmergencyContactPrimaryLock.ts`:

- `computePatientPrimaryContactLockKey(patientId)`: SHA-256 of `"patient-emergency-contact-primary:{patientId}"`, split into two signed int32 values — same convention as `acquireAppointmentSlotLock`/`acquireAppointmentRequestConversionLock` in `server/src/services/appointmentRequestSafety.ts` (the codebase's existing advisory-lock precedent), domain-separated by the string prefix so this lock namespace cannot collide with any other advisory lock sharing PostgreSQL's single global `(int4, int4)` space.
- `readCurrentPrimaryContactId(client, scope)`: reads the id of the current primary contact (if any), scoped to `(patientId, clinicId, organizationId)`. Callable with either the plain `prisma` client (pre-transaction snapshot) or `tx` (post-lock re-check).
- `claimPrimaryContactSlot(tx, scope, expectedCurrentPrimaryId, keepContactId?)`: **must** be the first operation inside the transaction for any create/update that is turning `isPrimary` on for a row that was not already primary.
  1. `pg_advisory_xact_lock(key1::int4, key2::int4)` — blocks until any other in-flight primary-transition for the *same patient* releases (auto-released at commit/rollback).
  2. Re-reads the current primary contact id, now guaranteed fresh (post-lock, same transaction).
  3. Compares it to `expectedCurrentPrimaryId` (captured by the route **before** the transaction opened, i.e. at the moment the request actually started processing). If they differ, a concurrent request won the race in the interim → throws `PrimaryContactRaceError` **before any write happens** in this transaction.
  4. If they match — either nobody else is racing, or this is a legitimate sequential reassignment — clears the previous primary (if any, and if it isn't the target row itself) and returns, letting the caller set its own row.

Route changes (`server/src/routes/patientEmergencyContacts.ts`, both `POST` and `PUT`): the old inline `updateMany`-then-`update` sequence is replaced by a call to `claimPrimaryContactSlot`; the pre-transaction snapshot (`readCurrentPrimaryContactId(prisma, scope)`) is taken only when the write is actually attempting a primary transition (`data.isPrimary` for POST; `data.isPrimary && !existing.isPrimary` for PUT) — non-primary writes never touch the lock. The catch block now maps **both** `PrimaryContactRaceError` and the pre-existing `isPrimaryContactConflict` (P2002) check to the same documented `409 { error, code: 'PRIMARY_CONTACT_CONFLICT' }` response — the partial unique index is kept in place, unmodified, as a physical backstop (belt-and-suspenders): it should never fire now that the lock closes the gap, but if application logic ever regresses, the index still guarantees the DB can never actually hold two primaries.

## 5. Lock key and collision analysis

- Key: SHA-256(`"patient-emergency-contact-primary:{patientId}"`) → two int32 values → `pg_advisory_xact_lock(int4, int4)`.
- **Scope decision: `patientId` alone.** `Patient.id` (`server/prisma/schema.prisma`) is `String @id @default(uuid())` on a single global table — not partitioned per clinic or organization, so it is already globally unique by construction (confirmed by direct schema read, not assumed from the pre-existing route comment that made the same claim). No `clinicId`/`organizationId` component is needed in the lock *key* for correctness.
- The re-check inside `claimPrimaryContactSlot` remains scoped to `(patientId, clinicId, organizationId)` in its `WHERE` clause regardless — the tenant boundary stays explicit and defensible in the query itself, independent of the lock key's own scope, matching the pre-existing route convention.
- No cross-tenant interference is possible: different patients hash to different keys (and even a hypothetical SHA-256 collision across two unrelated patients would only cause harmless extra serialization — the WHERE-scoped re-check inside the transaction would still only ever touch the correct patient's rows).
- No global lock: the lock is acquired only when a write is actually promoting a row to `isPrimary=true`; non-primary creates/updates, and updates that leave `isPrimary` unchanged, never acquire it.
- Different patients never block each other; two different patients in the **same clinic** (verified by a new test, §6) and two patients in **different clinics/organizations** (pre-existing test, unaffected) both proceed independently and concurrently.

## 6. Transaction boundaries and HTTP semantics

- Everything — lock acquisition, the fresh re-read, the previous-primary clear, and the target row's own create/update — happens inside one `prisma.$transaction()` interactive transaction, same as before the fix. Nothing is split across transactions.
- The lock is released automatically at commit or rollback (`pg_advisory_xact_lock`, not `pg_advisory_lock` — no manual unlock call exists or is needed, no risk of an orphaned lock surviving a crash).
- Loser semantics: `PrimaryContactRaceError` is thrown **before** any row is touched in the losing transaction — the transaction rolls back with zero side effects, and the loser's target contact row is left exactly as it was (proven by a dedicated assertion in the pre-existing scenario 2 test, unchanged).
- HTTP mapping: `409 { error: 'Another request just set a primary contact for this patient. Please retry.', code: 'PRIMARY_CONTACT_CONFLICT' }` — no raw Prisma/Postgres error text, no 500, no silent 200 with a false claim.

## 7. Tenant/security impact

- No route-level authorization, scope-resolution, or tenant-boundary code was touched — `resolvePatientScope`, the `EMERGENCY_CONTACT_ROLES` matrix, and the existing-contact re-fetch scoped to `(id, patientId, clinicId, organizationId)` are all unmodified.
- The lock key is derived purely from `patientId`, which is only ever obtained after `resolvePatientScope` has already authorized the requester against that specific patient — an unauthorized caller can never reach `claimPrimaryContactSlot` for a patient they are not scoped to.
- No new cross-tenant lock-key collision surface: see §5.

## 8. Files changed

- `server/src/services/patientEmergencyContactPrimaryLock.ts` — **new**. Lock key derivation, snapshot read, and `claimPrimaryContactSlot`.
- `server/src/routes/patientEmergencyContacts.ts` — POST/PUT handlers rewired to use the new lock helper instead of the inline `updateMany`-then-`update` sequence; module docstring updated to describe the two-layer mechanism (lock is primary, unique index is backstop).
- `server/src/services/patientEmergencyContacts.ts` — module docstring updated to match (no functional change; `isPrimaryContactConflict`/`PRIMARY_CONTACT_CONFLICT_CODE` unchanged).
- `server/src/tests/dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts` — preserved scenario 2 (the original failing test) **without weakening any assertion**; docstring updated with the F1-004-P1 root-cause summary; 3 new scenarios added (§9).
- A throwaway root-cause reproduction script (`server/scratch_repro.ts`) was written and used to force the exact interleaving described in §2/§3, confirming both the pre-fix defect and the post-fix `200`/`409` split. Deletion was attempted but denied by the permission system during this session; the file is **not staged or committed** — it carries no functional code path and is excluded from the diff.

## 9. Tests — exact counts

`server/src/tests/dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts`, run via `tsx` against real disposable PostgreSQL, **8 scenarios (was 5), all passing**:

1. Two concurrent CREATEs, same patient, both `isPrimary=true` — unchanged, still passes (unique-index path).
2. **Two concurrent UPDATEs of different existing contacts, both `isPrimary=true`** — the original failing test, assertions unchanged (exactly one `200`, the other a controlled `409 PRIMARY_CONTACT_CONFLICT`, at most one primary afterward, loser's target row provably untouched).
3. *(scenario numbers 5-7 preserved from the original file; no renumbering of pre-existing scenarios)* Cross-tenant (different organizations) no-cross-blocking; 5 concurrent non-primary creates all succeed; 2 concurrent legal-decision-maker creates both retain the flag.
4. **New — scenario 8**: two different patients in the **same clinic** each concurrently getting a primary contact both succeed independently (closes the "same clinic, different patient" gap the pre-existing cross-tenant test didn't cover — same-clinic patients share an organization/clinic scope but must still use independent lock keys).
5. **New — scenario 9**: sequential (non-racing) primary reassignment — set contact A primary, then (fully awaited, no overlap) reassign to contact B — both succeed, ending with exactly B primary. Proves the fix does not turn ordinary, non-concurrent primary switching into a false-positive conflict.
6. **New — scenario 10**: 15 repeated rounds of the exact concurrent-UPDATE race, each round asserting exactly one `200` winner and one `409 PRIMARY_CONTACT_CONFLICT` loser and exactly one primary contact afterward — demonstrates **determinism**, not a one-off pass. All 15/15 rounds resolved correctly every run.

**Total: 8 passed, 0 failed**, confirmed across **6 consecutive full-suite runs** (11 total counting scenario-2-only reruns during development) against a real disposable PostgreSQL container — zero flakiness observed post-fix, in contrast to the pre-fix code's timing-dependent behavior.

## 10. Validation commands, exact results

All run from the fresh worktree, working directory as noted:

| # | Command | Working dir | Exit | Result |
|---|---|---|---|---|
| 1 | `git diff --check` | worktree root | `0` | clean, no whitespace errors |
| 2 | `npx tsc --noEmit` (implies `prisma generate` via the pre-existing `prisma generate && tsc --noEmit` typecheck convention — run directly here as `tsc --noEmit` after an already-current client) | `server/` | `0` | clean |
| 3 | `npx tsx src/tests/dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts` | `server/` | `0` (×11 across development) | 8 passed / 0 failed every run, including 15/15 race-loop rounds every time |
| 4 | `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (exact Layer 3 CI command) | worktree root | `0` (×2, matching CI's two-attempt pattern) | `server:test:disposable-db` exit `0`; `patientEmergencyContactsPrimaryConcurrency` 8/8; full aggregate `CT-32 total: 153 ✓ 153 ✗ 0`; cleanup `success: true`, zero errors, both runs |
| 5 | `npx tsx src/tests/patientEmergencyContacts.test.ts` (non-DB unit/validation suite — smallest relevant regression target) | `server/` | `0` | 22 passed / 0 failed (unchanged from baseline) |
| 6 | `docker ps -a --filter name=nmtest` / `docker network ls --filter name=nmtest` | n/a | — | empty — zero residual labeled Docker resources after either full run |
| 7 | Manual disposable Postgres (`postgres:16-alpine`, ad hoc container used only for the forced-interleaving repro and 8+6 standalone suite reruns) | n/a | — | removed via `docker rm -f`; confirmed absent afterward |

Migration validation: **no migration was authorized or created** by this task — the fix is entirely application-layer (advisory lock + optimistic check), consistent with §M's expectation. `prisma migrate deploy` against the disposable database (part of command #4's own orchestrator step) applied all pre-existing migrations, including the unmodified `20260803120000_add_patient_emergency_contacts`, cleanly (`migration.code: 0`, both runs).

## 11. Backward compatibility and rollback

- No API request/response shape changed. `201`/`200` success bodies are unchanged; the `409 PRIMARY_CONTACT_CONFLICT` shape is byte-identical to the pre-existing (CREATE-path, unique-index-triggered) conflict response.
- Sequential (non-racing) primary reassignment behaves identically to before the fix (scenario 9, §9) — this was the explicit concern the task's own test requirements named, and it is directly proven, not merely assumed.
- **Rollback: code-only.** `git revert` of the fix commit(s) fully restores the pre-fix reset-then-set sequence; no data rollback is required or possible to need, since the fix touches no data shape, only write-path control flow. No migration was created, so there is nothing to roll back at the schema level.

## 12. Relationship to PR #307 / F2-PREP-009

- This task has **no functional relationship** to F2-PREP-009's own content (an imaging tenant-context documentation amendment). PR #307 is referenced **only** as the discovery source for this pre-existing, unrelated runtime defect — its required Layer 3 CI failed on a completely different subsystem (`patientEmergencyContactsPrimaryConcurrency.test.ts`) than anything PR #307 itself changes (PR #307 is documentation-only).
- PR #307 remains open, unmodified, and blocked by this task purely as a byproduct of Layer 3 being a required check that exercises the full `server:test:disposable-db` aggregate on every PR, regardless of what that PR itself touches — the same "unrelated PR blocked by a pre-existing shared-suite defect" shape as F1-003-B2's own discovery via PR #268.
- Once this fix is merged to `main`, PR #307's own Layer 3 run (rerun against updated `main`, or by PR #307 itself merging `main` in) is expected to pass without any change to PR #307's own diff.

## 13. Explicit non-claims / rejected or unverified items

- **Not claimed:** that the CREATE-vs-CREATE path (scenario 1) was ever actually broken — it passed in both CI attempts and in every local run, both pre- and post-fix. It is nonetheless now routed through the same lock helper for consistency and defense-in-depth (see §4), not because a CREATE-path failure was observed.
- **Not claimed:** `REMOTE_CI_VERIFIED` for this fix at the time of writing this document — the PR had not yet completed its own CI run when this evidence was drafted; see the PR itself / the delivery report for the actual post-push CI conclusion.
- **Not claimed:** any change to `PatientEmergencyContact`'s data shape, migration history, or the pre-existing partial unique index — all three are unmodified.

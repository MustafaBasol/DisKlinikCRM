# F2-IMG-AUDIT-001-FIX — Bridge Sequential Duplicate Ingest Audit Parity — Evidence

**Phase:** F2 — Modular Boundaries and Public Contracts
**Task ID:** F2-IMG-AUDIT-001-FIX
**Date:** 2026-08-08
**Branch:** `fix/f2-img-audit-001-bridge-duplicate-audit-parity`
**Worktree:** `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f2-img-audit-001-bridge-duplicate-audit-parity`
**Baseline:** `origin/main` @ `5eedf8ff5e8285a4c5b623119ab173ffa8d8ed23` (merge commit of PR #339, `docs/f2-doc-004-stage2-exit-gate-reconciliation`) — re-fetched and re-verified at task start; the task brief's previously-recorded baseline (`5eedf8f...`) was current, no drift.
**Runs in parallel with:** F2-STAGE3-AUTH-001 (Imaging Stage-3 Privacy/KVKK caller migration authorization review) — isolated worktree/branch, disjoint files, no shared state.

This document is the delivery evidence for F2-IMG-AUDIT-001-FIX. It closes the single accepted finding
characterized (not implemented) by `F2-IMG-AUDIT-PREP-001_IMAGING_INGEST_AUDIT_ASYMMETRY_CHARACTERIZATION.md`
— an analysis-only document produced in a separate, prior session and, at the time of this task, still
uncommitted in a different worktree (`docs/f2-doc-004-stage2-exit-gate-reconciliation`), outside this
task's isolated branch/worktree and out of scope to move or commit from here — and originally surfaced
(also not implemented) during
[F2-OVL-01_IMAGING_INGEST_CONVERGENCE_EVIDENCE.md](F2-OVL-01_IMAGING_INGEST_CONVERGENCE_EVIDENCE.md) §2.
Its findings were independently re-verified against current `main` in §1-§2 below rather than trusted
blindly, per this task's explicit instruction.

## 1. Root cause

`server/src/routes/imagingBridgePublic.ts`'s bridge study-upload handler has two code paths that both
resolve to "this ingestKey already exists for this clinic — return the pre-existing study,
`duplicate:true`":

- **Sequential pre-check** (`existingByIngestKey`, findFirst before any storage/DB write): on current
  `main`, this branch updated the agent's heartbeat state and returned `200 {ok:true, studyId,
  duplicate:true}` **without ever calling `writeAuditLog`** — it returned before reaching the shared
  audit-write block further down the handler.
- **Concurrent P2002 race recovery** (unique-constraint conflict caught after the shared
  `ingestImagingStudyCore()` call): this branch does **not** `return` early — it falls through to the
  same shared block that the successful-ingest path uses, which **does** call `writeAuditLog` with
  `metadata.duplicate: true`.

Both branches represent the *same logical event* — a caller-visible, successfully-served
duplicate-detection response for the same `(clinicId, ingestKey)` pair — but only one of the two left a
trace in `AuditLog`, the codebase's authoritative compliance/evidence record (see the PREP-001 doc §6 for
the supporting cross-reference). Which branch fired depended entirely on request timing (a race the
caller cannot observe or control), not on anything meaningfully different about the request.

## 2. Exact previous (defective) behavior

`server/src/routes/imagingBridgePublic.ts:257-268` (pre-fix):

```ts
const existingByIngestKey = await prisma.imagingStudy.findFirst({
  where: { clinicId, ingestKey: v.ingestKey },
  select: { id: true },
});
if (existingByIngestKey) {
  await prisma.imagingBridgeAgent.update({
    where: { id: agent.id },
    data: { status: 'online', lastSeenAt: new Date() },
  });
  return res.status(200).json({ ok: true, studyId: existingByIngestKey.id, duplicate: true });
}
```

No `writeAuditLog` call anywhere in this branch.

## 3. Exact P2002 duplicate behavior (unchanged by this fix — the shape the fix mirrors)

`server/src/routes/imagingBridgePublic.ts:316-354` (unchanged):

```ts
} catch (txErr: any) {
  if (txErr?.code === 'P2002') {
    const existing = await prisma.imagingStudy.findFirst({
      where: { clinicId, ingestKey: v.ingestKey },
      select: { id: true },
    });
    if (!existing) throw txErr;
    studyId = existing.id;
    duplicate = true;
    effectiveMime = normalizeDeclaredMime(req.file.mimetype, req.file.originalname);
  } else {
    throw txErr;
  }
}

await prisma.imagingBridgeAgent.update({ where: { id: agent.id }, data: { status: 'online', lastSeenAt: new Date() } });

await writeAuditLog({
  organizationId: agent.clinic.organizationId,
  clinicId,
  action: 'imaging_bridge_study_ingested',
  entityType: 'imaging_study',
  entityId: studyId,
  metadata: { deviceId: v.deviceId ?? null, modality: v.modality ?? 'OTHER', fileSize: req.file.size, mimeType: effectiveMime, duplicate },
});

res.status(duplicate ? 200 : 201).json({ ok: true, studyId, duplicate });
```

This block is untouched by the fix — it is the reference shape the sequential-duplicate branch now
mirrors, and CT-11's extended assertions (§9) prove it still produces exactly this output.

## 4. Implementation change

Added one `writeAuditLog` call, with the exact same action/entityType/metadata shape as §3, inside the
existing sequential pre-check branch — before its `return` — using `existingByIngestKey.id` as the
`entityId` and the file already present on `req` (validated earlier in the same handler) to compute
`fileSize`/`mimeType`, matching what the P2002 path computes for the same fields. No new imports were
required (`writeAuditLog` and `normalizeDeclaredMime` were already imported in this file for the P2002
path). `ingestImagingStudyCore.ts` was not touched — audit logging remains entirely route-owned, per the
core's own explicitly-scoped-out audit boundary (proven by the standing
`imagingIngestCoreConvergence.test.ts` assertions that the core never imports `writeAuditLog`/`auditLog`).

## 5. Files changed

| File | Change |
|---|---|
| `server/src/routes/imagingBridgePublic.ts` | +19 lines inside the existing `existingByIngestKey` branch: one `writeAuditLog` call before the existing `return`. No other line changed. |
| `server/src/tests/imagingCharacterizationIngestStorage.test.ts` | CT-10 extended with `AuditLog` row-count/action/metadata assertions (before/after the first ingest, the sequential duplicate, and a third repeated-duplicate call); CT-11 (`ct11Rep`) extended with the same for the P2002 race path; new `ct10CrossTenant` test added and wired into `main()`. Header comment updated to document the addition. |
| `docs/program/evidence/F2-IMG-AUDIT-001_BRIDGE_DUPLICATE_AUDIT_PARITY.md` | New — this document. |

No other file changed. This task's hard scope boundary excludes any file under `server/src/services/imaging/imagingIngestCore.ts`, `server/src/services/privacy/**`, `server/src/routes/patientPrivacy.ts`, `prisma/**`, `package.json`/`package-lock.json`, and `.github/workflows/**` — none were read or modified.

## 6. Audit event/action used

`action: 'imaging_bridge_study_ingested'` — the **same, pre-existing** action name already used by both
the successful-ingest and P2002-duplicate paths (§3). No new audit action was invented; this reuses the
established contract exactly, as required by the task's audit-semantics constraint.

## 7. Audit metadata fields (identical shape to the P2002 path)

```ts
{
  deviceId: v.deviceId ?? null,
  modality: v.modality ?? 'OTHER',
  fileSize: req.file.size,
  mimeType: normalizeDeclaredMime(req.file.mimetype, req.file.originalname),
  duplicate: true,
}
```

`organizationId` = `agent.clinic.organizationId`, `clinicId` = `agent.clinicId` (both resolved by
`authenticateBridgeAgent`, identical source to every other write in this route). `entityType` =
`'imaging_study'`, `entityId` = `existingByIngestKey.id`. No filename, no PHI, no bridge token/hash, no
storage key/path — verified by the new CT-10 assertion that checks the written row's `metadata` JSON text
does not contain the uploaded filenames, the raw bridge token, or patient-identifying field names, plus
the pre-existing regex-based `imaging.test.ts` guard ("no filename, token, tokenHash, or PHI enters the
bridge audit metadata"), which still passes against the two-call-site file post-fix.

## 8. Tenant-scope proof

The new `writeAuditLog` call uses `agent.clinic.organizationId`/`agent.clinicId` — the same
authenticated-agent-derived values every other write in this route already uses; no new tenant-derivation
path was introduced. The duplicate *lookup* itself (`existingByIngestKey`) was already, and remains,
scoped by `where: { clinicId, ingestKey: v.ingestKey }` — unchanged by this fix. New test
`ct10CrossTenant` (`imagingCharacterizationIngestStorage.test.ts`) proves end-to-end, against real
Postgres: an identical `ingestKey` seeded in a *different* clinic does not short-circuit as a duplicate in
the caller's own clinic (a fresh `201` study is created instead, `duplicate:false`), and the caller
clinic's own `AuditLog` row references only its own `studyId` — never the other clinic's.

## 9. Idempotency / duplicate-safety behavior (per request path, all proven against real Postgres)

| Path | AuditLog rows written | Proof |
|---|---|---|
| New (first) ingest | 1 (`duplicate:false`) — unchanged | CT-10, assertion added before the first ingest is exercised |
| Sequential duplicate (pre-check) | 1 per call — **was 0, now 1** (the fix) | CT-10, extended |
| Repeated sequential duplicate (3rd call, same ingestKey) | 1 more per call (no dedup) — matches the pre-existing P2002-path policy of one row per detection event, not one row per `(clinicId, ingestKey)` | CT-10, extended (3rd call assertion) |
| Concurrent P2002 duplicate (race) | 2 total for the pair (1 winner `duplicate:false` + 1 loser `duplicate:true`) — unchanged | CT-11 (`ct11Rep`), extended, run 3× |
| Failed auth (401) | 0 — unchanged (auth check runs before the duplicate pre-check is ever reached) | Unaffected code path; not modified |
| Failed validation (400) | 0 — unchanged (schema/hash validation runs before the duplicate pre-check) | Unaffected code path; not modified |

The response shape, HTTP status codes (`200`/`201`), and `duplicate` semantics are byte-identical to
before the fix — proven by the untouched original CT-10/CT-11 assertions, which all still pass.

## 10. Tests added

All in `server/src/tests/imagingCharacterizationIngestStorage.test.ts` (real disposable PostgreSQL, real
local-disk storage — no Prisma/storage mocking):

1. CT-10 extension — asserts exactly 1 `AuditLog` row (`duplicate:false`) after the first ingest.
2. CT-10 extension — asserts exactly 2 `AuditLog` rows after the sequential duplicate call; the new row's
   `organizationId`, `entityType`, `metadata.duplicate`, `metadata.modality`, `metadata.fileSize` are
   checked.
3. CT-10 extension — asserts the new row's `metadata` JSON contains none of: the two uploaded filenames,
   the raw bridge token, `firstName`/`lastName`/`patientId` (PHI/token/filename guard).
4. CT-10 extension — a third, repeated sequential-duplicate call asserts a third `AuditLog` row is
   written (pins the existing no-dedup policy rather than inventing a new one).
5. New `ct10CrossTenant` — proves the pre-check (and its audit write) stays `clinicId`-scoped; a same
   `ingestKey` seeded in another clinic never resolves as a duplicate, and the caller's `AuditLog` never
   references the other clinic's `studyId`.
6. CT-11 (`ct11Rep`) extension — asserts exactly 2 `AuditLog` rows survive the real concurrent P2002 race
   (1 winner `duplicate:false`, 1 loser `duplicate:true`), run 3× (`rep1`/`rep2`/`rep3`) — proves the
   P2002 path's pre-existing audit behavior is unchanged by this fix.

Items 7 ("failed auth") and 8 ("failed validation" from the task's numbering) required no new test: both
checks run before the modified branch is ever reached, and are already covered by existing, unmodified
tests in `imaging.test.ts` / CT-27 (`imagingCharacterizationIngestStorage.test.ts`), which still pass
unchanged.

## 11. Exact test commands and pass/fail counts

Non-DB suites (`server/`):

```
npm run typecheck                        # npx prisma generate && tsc --noEmit → exit 0, zero errors
npm run test:imaging                     # 103 passed, 0 failed
npm run test:imaging-bridge-pairing      # 50 passed, 0 failed
npm run test:imaging-bridge-onboarding   # 14 passed, 0 failed
npm run test:imaging-bridge-update       # 44 passed, 0 failed
```

Real disposable PostgreSQL suite (repo root — `npm run test:imaging-characterization`, which chains
`imagingCharacterizationAuthShape.test.ts`, `imagingCharacterizationTenantLifecycle.test.ts`,
`imagingCharacterizationIngestStorage.test.ts` (the file this fix extends),
`imagingRequestConcurrencyCharacterization.test.ts`, `imagingRequestConcurrencyGuard.test.ts`, and
`imagingIngestCoreConvergence.test.ts`):

```
imagingCharacterizationAuthShape:        36 passed, 0 failed
Imaging-Characterization-Tenant-Lifecycle: 29 passed, 0 failed
imagingCharacterizationIngestStorage:    14 passed, 0 failed   (CT-07, CT-08, CT-10[extended],
                                                                 ct10CrossTenant[new], CT-11[extended,
                                                                 3 reps], CT-12, CT-13, CT-14, CT-27)
CT-32 (imagingRequestConcurrencyCharacterization): 154 passed, 0 failed
F2-CT-32-R1 guard suite (imagingRequestConcurrencyGuard):  73 passed, 0 failed
imagingIngestCoreConvergence:             9 passed, 0 failed
```

Exit code of the full `test:imaging-characterization` chain: `0`.

Architecture guardrail (repo root):

```
npm run guardrail:test    # architecture-guardrail unit tests: 74 passed, 0 failed
npm run guardrail:scan    # report-only; exitCode 0 (report-only mode always exits 0 per its own
                           # contract test); this change adds zero new cross-domain imports
                           # (writeAuditLog/normalizeDeclaredMime were already imported in this
                           # file for the pre-existing P2002 path) — no new guardrail findings
                           # attributable to this diff.
```

```
git diff --check    # exit 0, no whitespace errors
```

## 12. PostgreSQL/runtime test result

Provisioned a disposable, one-off `postgres:16-alpine` Docker container (`docker run ... -p
55432:5432`), applied all pending migrations with `npx prisma migrate deploy` (all succeeded, "All
migrations have been successfully applied"), pointed `DATABASE_URL` at it, ran the full
`test:imaging-characterization` chain (§11) — all green, exit 0 — then tore the container down
(`docker rm -f`). No persistent volume; no data survives the run.

## 13. Typecheck result

`npm run typecheck` (`server/`): `npx prisma generate` succeeded, `tsc --noEmit` exit 0, zero type
errors.

## 14. Guardrail result

`npm run guardrail:test`: 74/74 passed. `npm run guardrail:scan`: report-only (never blocking per its own
CLI contract), ran cleanly against the changed route file; this diff introduces no new cross-domain
imports.

## 15. `git diff --check`

Exit 0 — no whitespace errors introduced.

## 16. Migration status

**None.** No `prisma/schema.prisma` change, no new migration file. Confirmed by `git status`/`git diff`
scoped to `prisma/`: no changes.

## 17. API compatibility

Unchanged: endpoint URL (`POST /api/public/imaging/bridge/studies`), request shape, response shape
(`{ok, studyId, duplicate}`), HTTP status codes (`200` for duplicate, `201` for new), `ingestKey`
behavior, `duplicate:true` semantics, study-creation behavior, storage behavior, CAS behavior, P2002
recovery, rate limiting, bridge authentication. Proven by the original (unmodified) status/body
assertions in CT-10/CT-11/CT-14/CT-27, all still passing.

## 18. Security/tenant/KVKK impact

No tenant predicate was weakened — the duplicate lookup's `where: { clinicId, ingestKey }` clause is
byte-identical to before this fix. No cross-tenant existence leakage: proven by the new
`ct10CrossTenant` test (§8, §10). No authorization/authentication behavior changed — the new
`writeAuditLog` call sits entirely after the existing `authenticateBridgeAgent` gate. No new PHI, bridge
token, filename, or storage key enters any log — proven by the new metadata-content assertion (§10 item
3) and the pre-existing regex guard in `imaging.test.ts`. No API response change, no rate-limit behavior
change (unaffected code paths). This is audit **parity**, not an authorization change, exactly as scoped.

## 19. Rollback

`git revert <fix commit SHA>` (see §25 in the accompanying delivery report for the exact SHA). Safe
because: no schema change, no data migration, no route-contract change. `AuditLog` rows written by the
newly-added call between deployment and any rollback are immutable historical records and are **not**
deleted by a revert — they remain valid evidence of duplicate-detection events that genuinely occurred;
only the *code path that writes future rows* reverts to its pre-fix (audit-silent) behavior.

## 20. Explicit exclusions (unchanged / not touched by this task)

- **F2-IMG-AUDIT-002** (bridge never calls `logActivity`) — explicitly NOT addressed. No `ActivityLog`
  schema change, no nullable `userId`, no synthetic/system actor introduced. Remains a separate
  product/compliance decision task per the PREP-001 doc's recommendation.
- **Stage-3 Privacy/KVKK caller migration** (`F2-STAGE3-AUTH-001`, running in parallel in an isolated
  worktree) — `server/src/services/privacy/**` and `server/src/routes/patientPrivacy.ts` were not read or
  touched by this task.
- **`ImagingLifecyclePort`** — not touched; this fix never leaves `imagingBridgePublic.ts`.
- **`ingestImagingStudyCore.ts`** — not touched; audit logging remains entirely route-owned, matching its
  documented, test-enforced boundary.
- **Blocking guardrail enforcement** — not authorized or enabled by this task; `guardrail:scan` remains
  report-only.
- **`prisma/schema.prisma`, migrations, `package.json`/`package-lock.json`, `.github/workflows/**`,
  guardrail baseline/config, `ActivityLog` schema, `User` schema, authorization model** — none touched.

## 21. Lifecycle state

`agent completed` · `tests passed` · PR: see the accompanying delivery report for the exact PR
number/URL/head SHA and CI status at time of writing. **Not** `MERGED`, **not** `DEPLOYED`, **not**
`PRODUCTION_VERIFIED` unless independently confirmed via `gh pr view`/`gh run view` in a later
reconciliation pass (matching this program's established convention — see §14/§16 not modified by this
task).

## 22. Merge safety recommendation

Safe to merge once CI is green: route-only, additive, zero schema/migration/contract change, all
pre-existing tests pass unmodified, new tests are narrowly scoped and pass against real Postgres.

## 23. Deployment safety recommendation

Backend rebuild/restart only, whenever this PR is eventually merged and deployed. No frontend deployment,
no database migration, no downtime requirement beyond the normal backend restart.

## 24. Exact next task

**F2-IMG-AUDIT-002-DECIDE** — a product/compliance decision task (not a code task) on whether
bridge-originated studies must appear in the clinic `ActivityLog` feed, per the PREP-001 characterization
doc's recommendation (§8/§9 there). Default recommendation carried forward unchanged: document the
asymmetry as intentional (bridge = machine actor, no `User` row to attribute to; `AuditLog` already
carries the authoritative record) rather than forcing a schema change onto a 133-caller shared utility
for an imaging-specific need.

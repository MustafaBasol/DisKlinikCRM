# F4-IMAGING-001-R6 — Per-object storage placement discriminator (R5 Finding B)

**Task:** `F4-IMAGING-001-R6-STORAGE-PLACEMENT-DISCRIMINATOR`
**Phase:** F4 — Object storage, backup, PITR and restore evidence
**ClickUp:** EPIC F4 `869ed1jn7` · F4-IMAGING-001 `869em3zqg`
**Branched from:** `origin/main` @ `85943c2421601585a4cc25a2d926cdd3e3d9f7ed` (the PR #459 merge commit)
**Rebased onto:** `origin/main` @ `881cfbc811aea0d79341b597c42d8b764c2ab8e4` — PR #463 (F3-DATA-MIG-TODAY-001-R10) merged mid-task; see §1.1
**Branch:** `feature/f4-imaging-001-r6-storage-placement-discriminator`
**PR:** #464 — **DRAFT**, not merged, not deployed, not production-verified
**Date:** 2026-08-20.

Continues `F4-IMAGING-001-R5_BACKUP_SOURCE_READ_AND_VPS2_STAGING_EVIDENCE.md`, whose §2
recorded Finding B as an accepted, still-open production-activation blocker and named this
task as the place to close it. The master tracker's R5 entry lists it as "exact next task"
item (1).

**No VPS1/production access was used, requested, or required. No real patient/DICOM/CBCT
data, no production DB dump, and no production backup was touched. `IMAGING_STORAGE_BACKEND`
was not changed anywhere outside disposable test processes. Nothing was merged, deployed, or
activated.** Every byte written in this session was synthetic random data.

---

## 1. Migration-slot verification (done before any schema edit)

Migration R10 is progressing in a separate session, so this was checked first and is recorded
with exact references rather than asserted.

| Check | Result |
|---|---|
| `origin/main` after fetch | `85943c2421601585a4cc25a2d926cdd3e3d9f7ed` — the PR #459 merge, exactly as expected |
| R5 head `17212a9b24c4f4bbb7b14c63fd2198786000ac95` | exists; is an ancestor of `origin/main` |
| Newest migration on `origin/main` | `server/prisma/migrations/20260819130000_add_patient_blood_group` |
| Migrations dated `2026082*` on **any** local or `origin` ref | **none** (scanned every `refs/heads` and `refs/remotes/origin` ref) |
| R10 branch `feature/f3-data-mig-r10-final-coverage` | HEAD == `85943c2` == `origin/main`; **zero** commits ahead; working tree clean; no untracked migration |
| R10 worktree | `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/f3-data-mig-r10`, clean |
| Reservation/ledger mechanism in the repository | **none exists** — no reservation file, no ledger file, no numbering registry, and no CI check asserting migration-chain ordering. Searched `docs/`, `scripts/`, `.github/workflows/`, `server/package.json`, `AGENTS.md`. Ordering is enforced only by the `YYYYMMDDHHMMSS` convention plus per-feature pinning tests. |

**`MIGRATION_SLOT = FREE` at the time of the pre-implementation check.** R10 did not own it,
and nothing in R6 touches, renames, reorders or combines with any R10 artifact.

### 1.1 The slot was re-checked before opening the PR, and it had changed

Because no reservation mechanism exists, the check was repeated immediately before committing —
and by then the R10 lane **had** committed a migration, at **exactly the timestamp R6 had
chosen**:

| | |
|---|---|
| R10 branch | `feature/f3-data-mig-r10-final-coverage` @ `8de0febcc5757930b7e9424b15ab80bb55f596b0` (was `85943c2` at first check) |
| R10 migration | `20260820120000_add_patient_district_contact_points_and_preserved_source_values` |
| R6 migration, originally | `20260820120000_add_imaging_image_storage_backend` — **same instant** |

The two are semantically **disjoint**: R10's adds `Patient.district` plus two new tables
(`PatientContactPoint`, `MigrationPreservedSourceValue`) and contains zero occurrences of
`ImagingImage`. So there was no functional conflict — directory names differ, Prisma orders by
directory name, and both are additive. But two directories claiming the same instant is a
chain-hygiene problem an operator reading the chain has to untangle.

**R6 moved; R10's migration was not touched.** R6's migration is now
`20260820130000_add_imaging_image_storage_backend`. R10's migration was read only far enough to
confirm disjointness, and was **not** edited, renamed, reordered, or combined with. No timestamp
was manipulated to claim priority — R6 moved *later*, not earlier.

**That lane then merged, and this branch was rebased onto it.** PR #463
(`feature/f3-data-mig-r10-final-coverage`) landed on `origin/main` as `881cfbc` while the final
test runs were in progress. This branch was rebased onto it before the PR was opened. Three
files overlapped and were resolved deliberately, none of them source:

| File | Resolution |
|---|---|
| `server/prisma/schema.prisma` | auto-merged; both changes verified present (`ImagingImage.storageBackend` and R10's `PatientContactPoint` / `Patient.district`) |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | auto-merged; both entries present. R10's own entry states `TRACKER_RECONCILIATION_REQUIRED = NO` and leaves ordering to the program controller — R6's entry is appended after the F4 chain, where it belongs. |
| `server/package.json` | the only real conflict, in three test aggregates. Resolved by taking **upstream's** line for each and re-applying only R6's own additions on top, so nothing R10 added was dropped: `server:test:non-disposable` keeps R10's members plus R6's `test:imaging-storage-placement-call-sites`; `server:test:disposable-db` is upstream verbatim (R6 never touched it, and R10's new `test:migration-r10-write-path-db` is preserved); `server:test:storage-integration` is R6's, which R10 did not touch. |

Every test result quoted below was produced on the rebased tree unless the row says otherwise.

The pinning test was rewritten to match: it no longer asserts R6's migration is the *last*
directory in the chain (which would fail for reasons unrelated to R6 as soon as any other lane
lands one). It asserts that R6's migration sorts strictly after `20260819130000`, the newest
migration on R6's own merge base — so it can never be inserted before an already-applied
migration — and that **no other migration shares its timestamp**.

---

## 2. The defect, restated from the code

R5 §2 recorded it; this session re-verified it at the exact base commit.

`model ImagingImage` had `id, clinicId, studyId, fileName, originalName, fileSize, mimeType,
filePath, sopInstanceUid, createdAt, storageVerifiedMissingAt` — and **nothing recording which
backend holds the object**. `filePath` stores a storage key, and that key is deliberately
backend-independent: `buildObjectStorageKey({kind:'imaging-image', …})` emits
`<clinicId>/<opaqueId><ext>`, and the identical string is used for local disk, legacy S3 and
VPS2.

So placement was inferred at read time from process-global configuration. All four routing
decisions in `fileStorage.ts` were the same expression:

```ts
if (isImagingRemoteStorageEnabled() && isSafeStorageKey(ref)) { …VPS2… }
```

`isImagingRemoteStorageEnabled()` reads `process.env.IMAGING_STORAGE_BACKEND` per call. Global
runtime configuration was therefore standing in for a historical, per-object physical fact.

The failure it produced:

1. `IMAGING_STORAGE_BACKEND=vps2`
2. a new image is written **only** to VPS2 (`saveImagingFile` never mirrors — by design)
3. the object key is persisted, and nothing else
4. the flag is later unset or rolled back
5. the read path now treats the object as legacy
6. the VPS2-only object is unreadable, and the backup sweep records it as `missing_source` —
   the one status an operator acts on as data loss

`POST_FIRST_REMOTE_WRITE_SIMPLE_FLAG_ROLLBACK_SAFE = NO` was the accepted consequence.

---

## 3. What R6 changes

**One sentence: configuration decides where NEW objects are WRITTEN; the row decides where an
EXISTING object is READ from.** Those are different responsibilities and they no longer share
a mechanism.

### 3.1 Data model

`server/prisma/schema.prisma` — `model ImagingImage` gains one field:

```prisma
storageBackend String?
```

- **`String?`, not a Prisma enum.** The schema contains exactly one enum
  (`PatientLegacyConsentField`), introduced only alongside a brand-new table, and never applied
  to an existing table. Both of the two most recent closed vocabularies explicitly rejected
  enums — see the `Patient.bloodGroup` doc comment and
  `20260819130000_add_patient_blood_group/migration.sql` lines 13-18. The structural analogue
  already in the schema is `SmsMessage.provider String?` ("which provider handled this").
- **Values `'legacy' | 'vps2'`, reused verbatim** from the pre-existing
  `ImagingStorageBackend` type in `imagingRemoteStorage.ts`, aliased rather than redeclared, so
  there is one vocabulary for "which imaging backend" and not two that can drift.
- **Nullable, no `@default`, no backfill, no new index.**
- It is a **logical placement label only** — never an endpoint, bucket, region, URL or
  credential. Those stay in environment configuration.

### 3.2 The single authoritative interpreter

`server/src/services/imagingRemoteStorage.ts`:

```ts
export type ImagingStoragePlacement = ImagingStorageBackend;   // 'legacy' | 'vps2'
export function resolveImagingStoragePlacement(persisted: string | null | undefined): ImagingStoragePlacement
```

| Persisted value | Resolves to |
|---|---|
| `null` / `undefined` / empty / whitespace-only | `'legacy'` — the **pre-R6** row |
| `'legacy'` (trimmed) | `'legacy'` |
| `'vps2'` (trimmed, case-sensitive) | `'vps2'` |
| anything else | **THROWS** |

Every path that starts from a database row funnels through this one function, so no two paths
can disagree about where an object lives. It is a pure function of its argument — it never
reads `process.env`, which is asserted directly by a test that flips the flag around it.

The throw is the same fail-closed discipline as `getImagingStorageBackend()`, and it matters
more here rather than less: an unrecognized persisted value means this process does not know
where the bytes are. Guessing would either serve the wrong object or report a healthy one as
missing. Failing one row's request is recoverable; silently reading the wrong backend is not.
In the backup sweep this surfaces as that row's `failed` entry — never `missing_source` — and
never aborts the run, which is why the sweep interprets the column at the point of use rather
than during enumeration (see §6).

### 3.3 Read/exists/delete contract

`server/src/services/fileStorage.ts`:

```ts
saveImagingFile(key, body, contentType): Promise<ImagingStoragePlacement>
openImagingFileStream(ref, placement?): Promise<Readable | null>
imagingFileExists(ref, placement?): Promise<boolean>
deleteImagingFile(key, placement?): Promise<void>
```

| Placement | Read / exists behavior |
|---|---|
| `'vps2'` | VPS2 **only**. Confirmed-absent (404 / `NoSuchKey`) resolves `null` / `false` — a real "gone". Any other provider error (network, auth, TLS, outage) **propagates**. |
| `'legacy'` | Legacy **only**, even while the global write backend is `vps2`. |
| omitted | The exact pre-R6 flag-driven behavior, retained for callers with genuinely no row context. **There are none in production code** — proven structurally, see §5. |

`isSafeStorageKey(ref)` still gates the remote path, so a pre-key-era absolute `filePath` is
never sent to an object store as a key, whatever the row records.

**No legacy fallback for an explicit VPS2 object, deliberately, including on a confirmed 404.**
R6 neither mirrors nor moves bytes, so an object recorded as VPS2 has no legitimate legacy
twin. Serving whatever happens to sit at the same key on local disk would return unverified
bytes and hide real data loss behind a success. `missing_source` for such a row is now an
*accurate* statement rather than the misclassification R5 fixed. This choice is explicit and
directly tested in both directions (cases R6-7 and R6-9).

### 3.4 Write contract

`saveImagingFile()` now returns the backend that actually accepted the bytes, produced on the
same branch that performed the write. `imagingIngestCore.ts` captures that value and persists
it on the row it creates.

**Ordering (pre-existing, unchanged by R6, stated explicitly because it was asked for):**

1. `buildObjectStorageKey(...)`
2. `saveImagingFile(...)` — the object store write, **before** any DB write
3. `prisma.$transaction(...)` — `ImagingStudy` create, `ImagingImage` create, optional
   `ImagingRequest` CAS transition
4. on any throw from (3): `deleteImagingFile(storageKey, storagePlacement)` — best-effort
   compensation, failures swallowed

Storage and Postgres are not atomic here. There is no outbox and no saga; that gap (BLK-01) is
pre-existing and out of scope. **R6 does not widen it.** The only two outcomes remain (a) bytes
plus a row that agree on placement, or (b) bytes with no row, compensated best-effort exactly
as before. There is no state in which a row records a backend that did not accept the bytes,
because the persisted value is produced by the completed write rather than by a second read of
the flag. Retry/idempotency behavior is unchanged: ingest is not idempotent today, a retry
produces a new key and a new row, and R6 adds nothing to that.

The compensation is now strictly **safer** than R5's: it targets the backend the paired write
actually used, instead of re-reading the global flag. Under R5, a flag change between the write
and the failed transaction would have deleted from the wrong backend and stranded the
just-written object as an untracked orphan.

---

## 4. Changed files

| File | Why |
|---|---|
| `server/prisma/schema.prisma` | `ImagingImage.storageBackend String?` + the contract doc comment |
| `server/prisma/migrations/20260820130000_add_imaging_image_storage_backend/migration.sql` | one `ALTER TABLE … ADD COLUMN` |
| `server/src/services/imagingRemoteStorage.ts` | `ImagingStoragePlacement` + `resolveImagingStoragePlacement()` |
| `server/src/services/fileStorage.ts` | placement-authoritative read/exists/delete; write returns the placement |
| `server/src/services/imaging/imagingIngestCore.ts` | captures and persists the placement; compensation targets it |
| `server/src/services/imaging/ops.ts` | backup DTO carries the resolved placement |
| `server/src/services/imaging/public.ts` | `findOwnedImage` selects the column; `checkImageStorageExists` uses it |
| `server/src/routes/imaging.ts` | preview/download stream from the row's placement |
| `server/src/services/fileBackupService.ts` | `openSource` takes the row, not just the key |
| `server/.env.example` | supersedes the now-false "rollback is one-way" paragraph; repairs a stale, spliced R3 timing note |
| `scripts/ci-classify/classify.ts` | classifies `imagingRemoteStorage.ts` as storage/imaging (see §9) |
| tests (5 files changed, 2 added) | see §5 |

---

## 5. Tests

Everything below was executed locally in this session against real disposable PostgreSQL and
real disposable MinIO. Nothing is inferred from CI configuration.

### 5.1 Results

| Command | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|
| `server/ npm run typecheck` (`prisma generate && tsc --noEmit`) | — | 0 | — | exit 0; Prisma client regenerated against the new schema |
| `server/ npm run server:test:non-disposable` (CI **Layer 2**, whole aggregate) | **3181** | **0** | 0 | exit 0 on the rebased tree. The aggregate's member suites print several different summary formats, so this is a count of individual case-pass / case-fail markers in the run log, not a single reported total. (It was 3105 before the rebase; the delta is R10's own suites, which this branch now also runs.) |
| ↳ `test:imaging-remote-storage` (Layer 2 arm, MinIO absent) | 39 | 0 | 6 sections self-skip | baseline was 29 with MinIO absent |
| ↳ `test:imaging-storage-placement-call-sites` (**new**) | 13 | 0 | 0 | structural guard, no DB/network |
| ↳ `test:imaging` | 104 | 0 | 0 | baseline 104; one pinned assertion updated (§5.3) |
| ↳ `test:file-backup-imaging-ops-migration` | 12 | 0 | 0 | baseline 11; DTO allow-list widened by one field + one new case |
| `npm run test:runtime:storage` (CI **Layer 4**, disposable PostgreSQL + MinIO) | — | 0 | — | exit 0; `migration.step = ok`; execution proof satisfied, 42 cases |
| ↳ `fileBackupDbIntegration` | **42** | **0** | 0 | baseline 37 |
| ↳ `imagingRemoteStorage` (with MinIO live) | **45** | **0** | 0 | baseline 35 |
| ↳ `imagingStoragePlacement` (**new**) | **13** | **0** | 0 | the R6 workhorse |
| `npm run test:runtime:postgres` (CI **Layer 3**, disposable PostgreSQL) | **753** | **0** | 0 | exit 0; `migration.step = ok` on a clean database. Same marker-counting caveat as Layer 2. One run of this layer failed on the **known-flaky** `platformAdminLoginTotpGate` case — see §5.6. |
| `npm run build` (Layer 1 frontend) | — | 0 | — | exit 0 |
| `npm run typecheck:runtime` / `typecheck:ci-classify` / `typecheck:guardrail` / `typecheck:log-privacy-guard` | — | 0 | — | all four exit 0 |
| `npm run test:ci-classify` | 28 | 0 | 0 | includes the falsifiable "every suite is in an aggregate" coverage assertion |
| `npm run test:log-privacy-guard` | 38 | 0 | 0 | |
| `npm run guardrail:test` | 74 | 0 | 0 | |
| `npm run log-privacy-guard:scan -- --strict-baseline` (blocking gate) | — | 0 | — | exit 0, **no new violations**, 103 grandfathered, no stale exception |

Layer 4's MinIO ran in `loopback-fallback` address mode (Docker Desktop on Windows), so
`verify:storage-run --require-offhost-destination` was deliberately **not** passed — that flag
fails closed on loopback mode by design and is a CI-runner concern, not a test result.

### 5.2 The 17 required regression cases

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | legacy/null row reads legacy | `imagingStoragePlacement` R6-1; `fileBackupDbIntegration` case 5 | PASS |
| 2 | explicit legacy row reads legacy while global write backend = vps2 | R6-2 (with **different** decoy bytes at the same key in VPS2, so it cannot pass vacuously); backup R6-2b | PASS |
| 3 | explicit VPS2 row reads VPS2 while global backend = vps2 | R6-3 | PASS |
| 4 | explicit VPS2 row still reads VPS2 after global backend unset | **R6-4** (activate → read → unset → re-init client → re-read; SHA-256 equal in both) | PASS |
| 5 | VPS2 write persists VPS2 placement | R6-5, via the **real** `ingestImagingStudyCore` | PASS |
| 6 | legacy write persists the expected legacy contract | R6-6, real ingest; asserts `'legacy'` explicitly, not "either legacy or null" | PASS |
| 7 | known VPS2 404 semantics explicit | R6-7 (`null` / `false`, not a throw) | PASS |
| 8 | known VPS2 provider error propagates | R6-8 (real 403 `InvalidAccessKeyId` against live MinIO) | PASS |
| 9 | provider error cannot silently fall back to a same-key legacy object | R6-9 (absent + legacy twin) and **R6-9b** (403 + legacy twin, write flag OFF) | PASS |
| 10 | backup of an explicit VPS2 image succeeds | `fileBackupDbIntegration` case 2 and **R6-10** (the flag-unset arm) | PASS |
| 11 | backup provider error becomes `failed`, not `missing_source` | case 6 and **R6-11** (the flag-unset arm) | PASS |
| 12 | `PatientAttachment` unchanged | case 7 and R6-12 | PASS |
| 13 | `LabOrderAttachment` unchanged | case 8 and R6-13 | PASS |
| 14 | cross-tenant access remains denied | R6-14, for **both** placement values, with the endpoint pointed at an unreachable address so a `NotFound` (rather than an unavailable error) proves the tenant predicate ran *before* any storage lookup | PASS |
| 15 | storage-key contract unchanged | `imagingRemoteStorage` §9 — key shape independent of placement; no placement token in any key | PASS |
| 16 | no secret/provider endpoint persisted in DB | R6-5 serializes the created row and asserts the endpoint, access key, secret, bucket, `http://`, `https://` and `s3://` all absent; plus a schema-level scan | PASS |
| 17 | feature flag OFF by default | `imagingRemoteStorage` §9 — no uncommented `IMAGING_STORAGE_BACKEND=` in `.env.example`, unset still means legacy | PASS |

Plus, beyond the required list: an unrecognized persisted `storageBackend` fails closed and is
converted to the domain's sanitized `ImagingStorageUnavailableError` at the boundary; and
`checkImageStorageExists` reports a healthy VPS2 object as **present** after the flag is rolled
back (without which the orphan inspection would stamp `storageVerifiedMissingAt` on healthy
rows).

### 5.3 Existing pinned contracts that legitimately changed

Four assertions in existing suites pinned contracts that R6 deliberately alters. Each was
updated with its rationale in-source rather than deleted or loosened:

1. **`imagingRemoteStorage.test.ts` §7 wrapper arity** — `openImagingFileStream` /
   `imagingFileExists` / `deleteImagingFile` moved from `.length === 1` to `2`. TypeScript emits
   an optional parameter as a plain one, so this genuinely moved rather than passing silently. A
   new case pins the added parameter **by signature and by behavior** and proves it is the
   closed two-token placement union, structurally incapable of carrying a tenant id.
2. **`imagingBackupOpsPort.test.ts`** and **`fileBackupImagingOpsPortMigration.test.ts`** — the
   `ImagingBackupRow` DTO allow-list widens by exactly one field, `storageBackend`. The list
   stays closed; the "no study metadata / modality / patientId / originalName" assertion is
   unchanged, and new cases assert the column crosses verbatim (a pre-R6 NULL arrives as NULL
   rather than being silently defaulted), that no connection data crosses with it, and that the
   interpretation happens in `fileBackupService` rather than during enumeration.
3. **`imaging.test.ts`** — the ingest compensation assertion moves from
   `deleteImagingFile(storageKey)` to `deleteImagingFile(storageKey, storagePlacement)`, and now
   also asserts the placement-less form cannot come back.
4. **`fileBackupDbIntegration.test.ts`** — `createImagingRow` takes an explicit placement. The
   VPS2-only fixtures now carry `'vps2'`, which is exactly what the production write path
   persists; the pre-R6 fixture carries `null`. **Every assertion is unchanged.** Case 5 was
   renamed because its mechanism changed (a NULL row now reads legacy directly instead of
   probing VPS2 and falling back on a 404) while its observable outcome did not.

### 5.4 Negative controls — evidence the tests detect the R5 behavior

Two single-line reverts, each run against the full Layer 4 stack, then restored and
re-verified. **Neither is committed.**

**Control 1 — the read path reverted to R5's flag-only branch** (`fileStorage.ts`, the
`placement === 'vps2'` branch replaced by `isImagingRemoteStorageEnabled() && …` with the
confirmed-404 legacy fallback):

| Suite | With R6 | Under control 1 |
|---|---|---|
| `fileBackupDbIntegration` | 42 passed, 0 failed | **40 passed, 2 failed** |
| `imagingStoragePlacement` | 13 passed, 0 failed | **8 passed, 5 failed** |

Failing cases: R6-2, R6-4, R6-8, R6-9, R6-9b, and backup R6-10 and R6-11 — **7 detections**,
including the Finding B case itself.

**Control 2 — a provider error laundered into a legacy fallback**
(`getImagingObjectStream(ref)` → `getImagingObjectStream(ref).catch(() => openFileStream(ref))`):

| Suite | With R6 | Under control 2 |
|---|---|---|
| `imagingStoragePlacement` | 13 passed, 0 failed | **11 passed, 2 failed** |

Failing cases: R6-8 and R6-9b. Control 2 is necessary because control 1 cannot reach this
direction — R5 already propagated provider throws, so a single revert cannot exercise both
failure modes. That R6-7 (confirmed-absent) stays green under control 2 while R6-8/R6-9b fail is
the point: the cases discriminate different failure modes rather than restating each other.

Both controls were reverted and the suite re-run green before anything was committed.

### 5.6b A defect in R6's own tests, found by the rebase and fixed

The rebase onto `881cfbc` re-materialized `schema.prisma` from Git, and on this Windows checkout
that means **CRLF**. Two of R6's new assertions extracted the `model ImagingImage` block with an
`indexOf` anchor containing a bare LF-brace-LF sequence, which never matches under CRLF:
`indexOf` returns `-1`, `slice(start, -1)` hands back almost the entire file, and the
consequences differed by assertion — the "index set is exactly `[clinicId, studyId]`" check
failed loudly, listing every index in the schema, while the "this model declares
`storageBackend String?` and no credential-shaped field" checks had been **passing vacuously**
against the whole file.

Both now use a line-ending-tolerant extractor (a `\r?\n\}\r?\n` search rather than a bare-LF
`indexOf`) plus an explicit `block.length < 3000` guard, so the block really is one model and a
future regression to whole-file matching fails loudly instead of silently.

Worth stating plainly rather than burying: **CI runs on Linux with LF, so CI would never have
caught this.** Under LF the anchor matches, so the loud half would have been green and the
vacuous half would have stayed green forever. It surfaced only because this task happened to
rebase onto a fresh checkout mid-session. The same bare-LF `indexOf` idiom exists in the
pre-existing `kvkkAttachmentImagingLifecycle.test.ts` schema assertions and carries the same
latent weakness; that is reported here, not changed.

### 5.6 One Layer 3 failure, proven to be a known flake rather than asserted to be unrelated

One `test:runtime:postgres` run failed with `Toplam: 27  ok 26  FAIL 1` on exactly one
assertion — `CHARACTERIZATION: a numeric valid OTP is accepted via String() coercion` in
`server/src/tests/platformAdminLoginTotpGate.test.ts`, with `401 !== 200`. That test does
`totpCode: Number(generateTotp(secret))`; when the generated TOTP happens to begin with `0`,
`Number()` strips the digit, the route's `String(req.body.totpCode ?? '')` sees a five-digit
code, and the login is refused. It is time-dependent by construction and fails roughly one run
in ten. It has nothing to do with imaging, storage or this migration.

Per the program's evidence rules this was **proven by rerun on the same working tree, not
asserted**: the immediately following run reported that exact assertion as `ok` and
`Toplam: 27  ok 27  FAIL 0`, with the orchestrator exiting 0.

It fired **twice** in this session — once before the rebase and once after — and was cleared by
rerun both times, on the identical tree each time:

| Run | Result |
|---|---|
| pre-rebase, first attempt | `Toplam: 27  ok 26  FAIL 1`, orchestrator exit 1 |
| pre-rebase, rerun | `Toplam: 27  ok 27  FAIL 0`, exit 0, **753 passed / 0 failed** |
| post-rebase, first attempt | `Toplam: 27  ok 26  FAIL 1`, exit 1 (752 passed / 1 failed) |
| post-rebase, rerun | `Toplam: 27  ok 27  FAIL 0`, exit 0, **753 passed / 0 failed** |

Two sightings in one session is consistent with the ~1-in-10 rate already recorded against this
test, and the failing assertion is identical in all of them.

Worth flagging for its own task rather than fixed here: `server:test:disposable-db` is an `&&`
chain and this suite sits **before** the migration suites in it, so when the flake fires it also
silently prevents later members of the chain from running at all. A Layer 3 red is therefore not
merely noise — it can hide whether a new suite ran. The real fix is to pass the code as a string
(or assert the leading-zero case explicitly); out of scope here.

### 5.5 Migration verification

- **Clean-database migration chain:** both Layer 3 and Layer 4 provision a fresh disposable
  PostgreSQL and run `npx prisma migrate deploy` over the entire chain before any test executes.
  Both reported `migration: { code: 0, step: "ok" }`, so the chain including
  `20260820130000` applies cleanly from empty.
- **Upgrade from the previous release:** the same runs are also the upgrade proof in the
  direction that matters — every migration up to `20260819130000` (which is what `origin/main`
  deploys today) is applied first, and `20260820130000` is applied on top of it. It is a single
  `ADD COLUMN` against an existing `"ImagingImage"` table.
- **Statement pinning:** `imagingStoragePlacementCallSites.test.ts` §4 pins the migration
  directory by literal path and asserts, after stripping comments, that the non-comment
  statement list is exactly
  `['ALTER TABLE "ImagingImage" ADD COLUMN "storageBackend" TEXT;']`, with no `DROP`, `DELETE`,
  `TRUNCATE`, `UPDATE`, `INSERT`, `SET`, `NOT NULL`, `DEFAULT`, `CREATE TYPE` or `CREATE INDEX`
  anywhere — following the `patientBloodGroup.test.ts` precedent. It also asserts the directory
  sorts last in the chain, and that `ImagingImage`'s index set is still exactly
  `@@index([clinicId, studyId])`.
- **Lock / table-rewrite assessment:** on PostgreSQL 11+ a nullable `ADD COLUMN` with **no**
  default is catalog-only — a brief `ACCESS EXCLUSIVE` lock, no table rewrite, and a duration
  independent of row count. Production-size risk is therefore not a function of how many
  imaging rows exist. No index is created, which matters because Prisma runs each migration
  inside a transaction and `CREATE INDEX CONCURRENTLY` is consequently unavailable; a
  table-scanning `CREATE INDEX` here would have held a real lock. If a future classification
  sweep needs an index, it belongs in its own migration.
- **`NOT NULL DEFAULT 'legacy'` was considered and rejected**, with the reasoning written into
  the migration header: it is also catalog-only on PG 11+, so this is not a lock argument. It is
  rejected because it collapses "recorded as legacy" and "never recorded" into one
  indistinguishable value, and because it would be **fail-open** during the expand window — the
  currently deployed release does not write this column, so every row it inserts would be
  stamped `'legacy'` by the database default even if an operator had activated VPS2. NULL makes
  that same window produce an honest "unrecorded" value.

---

## 6. Backup contract after R6

`imaging/ops.ts`'s `listImagesForBackup` selects `storageBackend` and carries it on
`ImagingBackupRow` as the **raw persisted value** (`string | null`), exactly as
`storageKeyOrFilePath` carries `filePath` verbatim. `fileBackupService.ts`'s
`SOURCE_MODELS.openSource` now takes the row rather than a bare key; the `ImagingImage` entry
calls `resolveImagingStoragePlacement(row.storageBackend)` and passes the result into
`openImagingFileStream`, and the two attachment classes keep calling the generic
`openFileStream` unchanged.

**Why the interpretation happens at the point of use rather than during enumeration — a
blast-radius decision, not a stylistic one.** `resolveImagingStoragePlacement()` fails closed on
an unrecognized value, and `fileBackupService`'s per-row `try`/`catch` begins *after* the
`for await (const row of cfg.rows(...))` step. Resolving inside the enumeration generator would
therefore let one unclassifiable row throw *out of* the loop, abort the whole sweep, and
silently stop backing up every imaging row after it. Resolving at the point of use puts the
throw inside the per-row catch, so it becomes that single row's `failed` entry — never
`missing_source` — while every other file is still backed up and the run is still marked
`failed` overall. Consumers must not re-implement the NULL rule; both the DTO comment and a
structural test say so, and the test asserts the interpreter does **not** appear inside the
enumeration generator.

| Situation | Behavior | Recorded as |
|---|---|---|
| NULL / pre-R6 row | reads legacy, deterministically, whatever the flag says | `verified` (unchanged) |
| explicit legacy row | reads legacy | `verified` (unchanged) |
| explicit VPS2 row, object present | reads VPS2 — **including after the flag is unset** | `verified` |
| explicit VPS2 row, confirmed absent | `null` | `missing_source` — now an accurate statement |
| explicit VPS2 row, provider error | the call throws | `failed` — never `missing_source`, never a silent legacy substitution |
| unrecognized persisted placement | the call throws | `failed` for that row; the run continues |
| `PatientAttachment` / `LabOrderAttachment` | generic `openFileStream`, untouched | unchanged |

R5's Finding A fix is preserved: enumeration still goes through `imaging/ops.ts`, bytes still
open through the Imaging-owned reader, no remote-client logic is duplicated into the backup
service, and no direct Prisma access to `ImagingImage` was reintroduced (pinned by
`fileBackupImagingOpsPortMigration.test.ts`).

The destination key shape is unchanged: `file-backups/imaging/<clinicId>/<recordId>.bin`.

---

## 7. Every object path, and where each stands

| Path | File | R6 |
|---|---|---|
| write | `imagingIngestCore.ts:127` | persists the placement the write returned |
| compensation delete | `imagingIngestCore.ts:187` | targets that same placement |
| stream / preview / download | `routes/imaging.ts` `streamStudyImage` | reads from the row's placement |
| exists / orphan reconciliation | `imaging/public.ts` `checkImageStorageExists` ← `privacy/orphanFileInspection.ts` | reads from the row's placement |
| backup source read | `fileBackupService.ts` | reads from the row's placement |
| backup enumeration | `imaging/ops.ts` | supplies the raw placement column |

**Deliberately out of scope, with the reason each cannot misroute storage:**

- **KVKK patient export / clinic bulk export** — both explicitly exclude physical imaging
  files and read only metadata (`patientPrivacyExportPackage.ts`, `clinicBulkExportPackage.ts`).
  No imaging byte read exists to misroute.
- **Deletion-review inventory** — counts and `fileSize` sums only, dry-run.
- **Anonymization** — redacts `originalName`; never touches storage. Imaging binaries are
  never hard-deleted by any path (docs/compliance/53 §5), so there is no general-purpose
  imaging delete to fix.
- **Backup restore / restore CLI / restore rehearsal** — read from the **backup destination**,
  not from imaging primary storage. Placement is irrelevant there.
- **`uploadImagingObjectStream`** — exported for a future large-DICOM streaming path, zero
  call sites, unchanged.

**Every mutation of `ImagingImage` in production code, and why none of them can invalidate a
placement.** There is exactly one `create` — `imagingIngestCore.ts:155`, the row this task now
stamps — and exactly two writes of any other kind, both `updateMany` in `imaging/public.ts`:
`markStorageMissing` (sets `storageVerifiedMissingAt`) and `redactForAnonymization` (sets
`originalName` to the anonymization placeholder). Neither touches `filePath` or
`storageBackend`, so a recorded placement can never drift from the bytes after the row is
created. There is no `update`, `upsert`, `createMany`, `delete` or `deleteMany` on the model,
and no raw SQL touches the table. Two pre-existing tests in `imaging.test.ts` already assert the
route source contains no `imagingImage.update`/`imagingImage.delete`.

---

## 8. Security / tenant / KVKK

**Tenant isolation — unchanged in mechanism, and now positively tested against the new column.**
Storage placement is not authorization and is never used as one. Every object access still goes
through the same authenticated, tenant-scoped lookup it did before: the byte route resolves
`validateAndGetClinicIdScope` and applies `study: {...scope}` **before** loading the row, and
`imaging/public.ts` applies `{ id, clinicId, study: { clinicId } }` on both reads and writes.
Placement is read *from the already-scoped row*, so it cannot widen access. R6-14 proves the
ordering empirically rather than by inspection: with the endpoint pointed at an unreachable
address, a cross-tenant request returns `ImagingNotFoundError` and never an unavailable error,
which is only possible if the tenant predicate ran first — and it is asserted for both a
`'vps2'` row and a NULL row.

**Placement is server-derived and never client-supplied.** It is written once, at ingest, from
the completed write. No route reads `storageBackend`, `filePath`, `backend`, `placement` or a
key from `req.body`/`req.query`/`req.params`; a structural test pins that for both the tenant
route and the bridge route.

**Placement never reaches a client.** `storageBackend` is absent from `studyImageSelect` and
from the cross-domain `ImagingLifecycleImageDto`, both asserted — publishing infrastructure
placement to clinical callers would breach docs/compliance/53 §10, which already bans
serializing `filePath`/`storageKey`.

**KVKK / data residency — unchanged, and nothing was relaxed.** R6 sends no data anywhere: it
adds a label to a row. Every R3/R5 fail-closed rule stands untouched — `IMAGING_S3_ENDPOINT`
required in every environment when the backend is `vps2`, `endpoint:` passed unconditionally so
the SDK's default public AWS endpoint is unreachable, absolute-URL and scheme validation,
production HTTPS, production SSE, and the fail-closed unknown-backend enum. **No public AWS
fallback was introduced.** No new logging was added; the resolved placement is not logged
anywhere, and no storage key is logged. The log-privacy guard's baseline lines were not
reworded.

**Secrets.** No credential value appears in source, tests, this document, the tracker, or the
PR body — only variable names. The new column is a two-token logical label; a test serializes a
real ingested row and asserts the endpoint, access key, secret, bucket and every URL scheme are
absent from it. The test suites source MinIO credentials from `MINIO_*` env vars with the same
disposable-container defaults the existing suites already use; no real endpoint or bucket is
written into any fixture.

**One caveat worth stating plainly:** `storageBackend = 'vps2'` records *where* bytes live. It
is **not** a claim about encryption at rest, SSE, residency evidence or provider approval — all
of which remain open (§10).

---

## 9. Boundary findings

R6 added no new cross-domain dependency edge, and deliberately avoided the one it was most
tempted into. `routes/imaging.ts` and `fileBackupService.ts` need to interpret a persisted
placement value, and the obvious way to do that is to import
`resolveImagingStoragePlacement` from `imagingRemoteStorage.ts` — which would have created a
route→provider-internals edge and a Core→provider-internals edge, both onto a module the
guardrail cannot even attribute an owner to. Instead, `fileStorage.ts` **re-exports** the
resolver, and both modules import it from there: their accepted dependency is on the
storage-abstraction contract (`CDA-009`), which they already had. It is a re-export, not a
second implementation — the interpreter stays singular. A structural test asserts that the only
importers of `imagingRemoteStorage.js` are `fileStorage.ts` and the imaging domain itself, and
that neither the route nor the backup sweep references any provider primitive or the global
flag.

Two pre-existing items are reported rather than fixed, per the instruction not to broaden this
task:

1. **`server/src/services/imagingRemoteStorage.ts` is absent from
   `scripts/architecture-guardrail/config/domain-map.json`**, so the guardrail classifies its
   inbound edges as `UNRESOLVED` rather than accepted. Introduced by the F4-IMAGING-001 lane,
   not by R6. The guardrail is advisory/report-only, so this gates nothing today. **Not changed
   here** — it needs a deliberate ownership decision, not a drive-by line.
2. **`routes/imaging.ts`'s byte-path `findFirst` scopes on `study.clinicId` only**, not on
   `ImagingImage.clinicId` as well — unlike `imaging/public.ts`, which requires both. A
   denormalization mismatch between the two columns would go undetected there and mis-attribute
   the audit entry. It is **not** exploitable through the API (no path can create such a
   mismatch), and R6 does not make it worse. Recommended fix, for its own task: tighten the
   predicate to `{ id, studyId, ...scope, study: { ...scope } }`.

One CI-classification correction **was** made, because it concerns the file R6 modifies:
`scripts/ci-classify/classify.ts` did not list `imagingRemoteStorage.ts` among the storage
service files, so a PR touching only that file fell through to `BACKEND_GENERAL` and would have
**skipped the Postgres and storage-integration layers that actually exercise it**. R6 itself was
never at risk (it touches `schema.prisma`, which forces the full gate); the fix prevents a
future storage-only change from being under-tested. It only widens coverage.

Also corrected in `server/.env.example`: a stale R3 "TIMING CAVEAT" paragraph asserted that no
boot-time `validateImagingS3Config()` call existed, which R5's Finding C made false, and whose
text had been spliced into the middle of an unrelated sentence.

---

## 10. Infrastructure blockers still open — none closed by R6

| Blocker | Status |
|---|---|
| Encrypted imaging data volume on VPS2 | `BLOCKED_PROVIDER_VOLUME_NOT_PRESENT` — unchanged |
| SSE / KMS / KES production capability | `NOT_AVAILABLE` — unchanged; `imagingRemoteStorage.ts` still refuses to start in production without it |
| Client private-CA trust | `NOT_SATISFIED` — unchanged |
| VPS1 → VPS2 production network path | `NOT_ESTABLISHED` — unchanged |
| Runtime corruption detection | `NOT_IMPLEMENTED` — unchanged, not in scope |
| Production checksum integrity gate | `OPEN` — unchanged |
| Independent imaging backup failure domain | `OPEN` — unchanged |
| IHS provider evidence E1/E2/E4/E5 + I1–I5, special-category DPA | `UNMET` — unchanged; still the gate on any real health data reaching VPS2 |
| `STORAGE_MODE` | `SYNTHETIC_STAGING_ONLY` — unchanged |

R6 closes exactly one thing: Finding B. `PRODUCTION_ACTIVATION_SAFE` stays `NO` on every other
blocker's account.

---

## 11. Backward compatibility

- **Pre-R6 rows** keep `NULL` and are read as legacy, deterministically and without consulting
  the flag. That is a fact rather than a guess for every row that exists at migration time: VPS2
  imaging storage has never been activated in production.
- **Old local objects** with an absolute `filePath` are unaffected — `isSafeStorageKey` still
  routes them to local disk before placement is ever consulted.
- **The previously deployed release** never references the column, and because it is nullable
  with no default every INSERT that release performs stays valid.
- **Storage-key contract:** unchanged, `<clinicId>/<opaqueId><ext>`, still built by
  `buildObjectStorageKey`. No key was rewritten and no byte was moved.
- **`PatientAttachment` / `LabOrderAttachment` / export archives:** untouched.

**One deliberate behavior change, stated rather than buried.** Under R5, a row with no
placement was probed against VPS2 first whenever the flag was on. Under R6 it reads legacy
directly. For production this is a no-op — the flag has never been on there, so no such row can
have VPS2 bytes. For a **non-production environment that activated VPS2 before R6 and still
holds rows written during that window**, those rows now read as legacy and their objects become
unreachable until their `storageBackend` is set to `'vps2'`. That is a one-line `UPDATE` on a
staging database, and it is the necessary price of §7C's determinism requirement: a rule that
still depended on the flag would not survive a config rollback, which is the entire defect R6
exists to remove.

---

## 12. Rollback

### Pre-activation rollback — safe

While `IMAGING_STORAGE_BACKEND` has never been set to `vps2`, every row's `storageBackend` is
`NULL` or `'legacy'` and every object is on legacy storage. The application can be reverted
freely; the added column is inert to code that never reads it, and nullable-with-no-default
keeps the old release's INSERTs valid. **Do not drop the column as part of this rollback** —
there is no need, and see below.

### Post-first-VPS2-write rollback

Once any row records `'vps2'`, **that column is the only record of where those bytes are.**

1. **Rolling back the write flag is now safe** — that is the point of R6. Unset
   `IMAGING_STORAGE_BACKEND` and new objects go to legacy again while VPS2-placed objects keep
   being read from VPS2.
2. **The `IMAGING_S3_*` connection settings must stay configured.** Reads of VPS2-placed objects
   still need them. Removing them does not silently fall back to legacy: those reads fail closed
   with an explicit configuration error. That is deliberate — serving whatever sits at the same
   key on legacy storage would be worse than failing.
3. **Do not drop the column.** A destructive schema rollback destroys the placement evidence and
   makes those objects unreadable — precisely the failure R6 exists to prevent. Roll back
   *application activation*, not the schema. If the column must ever genuinely be retired, that
   is a separate later migration, and only after proving no row holds `'vps2'`.
4. **Do not revert to a release that ignores placement** unless the operator can also guarantee
   every VPS2-placed object is reachable under the old global configuration — which, for a
   VPS2-only object, means it is not.
5. **Physically decommissioning VPS2** is still a data migration: copy the objects back
   out-of-band and re-record their placement first.

---

## 13. Status

| Gate | Value |
|---|---|
| `FINDING_B` | **`CLOSED`** |
| `POST_FIRST_REMOTE_WRITE_SIMPLE_FLAG_ROLLBACK_SAFE` | **`YES`**, conditional on the `IMAGING_S3_*` settings remaining configured (§12) |
| `MIGRATION_SLOT` | de-conflicted — R10 took `20260820120000` between the first check and the PR, so R6 moved to `20260820130000`; nothing of R10's was touched (see §1.1) |
| `MIGRATION_STATE` | created; applied to **disposable test databases only**; **not applied to production** |
| `RUNTIME_CORRUPTION_DETECTION` | `NOT_IMPLEMENTED` (unchanged, not in scope) |
| `PRODUCTION_CHECKSUM_INTEGRITY_GATE` | `OPEN` (unchanged, not in scope) |
| `IMAGING_VOLUME` | `BLOCKED_PROVIDER_VOLUME_NOT_PRESENT` (unchanged) |
| `STORAGE_MODE` | `SYNTHETIC_STAGING_ONLY` (unchanged) |
| `AGENT_COMPLETED` | `YES` |
| `TESTS_PASSED` | `YES` (counts in §5) |
| `PR_OPENED` | `YES` — #464, **DRAFT** |
| `MERGED` | `NO` |
| `DEPLOYED` | `NO` |
| `PRODUCTION_VERIFIED` | `NO` |
| `MERGE_SAFE` | `YES` — conditional on exact-head CI staying green and on architecture review of the migration |
| `DEPLOY_SAFE` | **`NO`** — not authorized by this task; requires architecture review |
| `PRODUCTION_ACTIVATION_SAFE` | **`NO`** — every §10 blocker is still open |

The provider/DPA gate is unchanged: E1/E2/E4/E5 and I1–I5 remain unmet. No real health data may
reach VPS2 before they land, and none did.

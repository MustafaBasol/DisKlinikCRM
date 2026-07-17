# 54 — KVKK-HIGH-004: Secure clinic bulk/structured-data export

Status: **Implemented — awaiting deployment/operational verification.**
Branch: `feature/kvkk-high-004-secure-clinic-bulk-export` (based on `main`
after PR #164 merged). Not merged, not deployed, feature flag ships `false`.

This document is not a legal compliance certificate. It records the
technical control only. Legal conclusions (retention periods, lawful basis,
what "regulatory request" purposes actually require) are explicitly out of
scope and are not made by this document or this PR.

## 1. Legacy endpoint disabled

`GET /api/clinic/export-data` (`server/src/routes/gdprExport.ts`) now always
responds `410 { error: 'CLINIC_BULK_EXPORT_LEGACY_DISABLED' }`, regardless of
any query/body parameter. It runs no Prisma query, generates no file, and
`authorize` has been removed entirely (every authenticated role gets the
identical disabled response). A regression test
(`server/src/tests/clinicBulkExport.test.ts`) asserts no data-layer call
occurs and that no parameter can change the outcome.

## 2. Feature flags

| Variable | Default | Fail mode | Purpose |
|---|---|---|---|
| `CLINIC_BULK_EXPORT_ENABLED` | unset = disabled | **fail-closed** (`=== 'true'` only) | Gates creation of new export jobs AND generation of already-queued ones (fifth-pass remediation — see Section 20). Checked (together with the allowlist below, via `isClinicBulkExportEnabledForOrganization`) before password/confirmation parsing on the create route, and separately re-checked by the worker before claiming a queued row and three more times inside `generateClinicBulkExport` itself (generation start, before the planned-key persist/upload, before the ready transition) — a job that becomes disabled while still `queued` or `generating` is moved atomically to `failed`/`FEATURE_DISABLED`, never silently generated to completion. |
| `CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS` | unset/empty = no allowlist (every organization in scope) | **fail-closed when set** (comma-separated list; an org not listed is treated exactly like the flag being off) | Server-enforced tenant rollout control — see Section 14. |
| `CLINIC_BULK_EXPORT_CLEANUP_ENABLED` | unset = **enabled** (`!== 'false'`) | fail-open (cleanup keeps running) | Independent of the creation flag — expired artifacts/rows and abandoned jobs keep being swept even while creation is off. |
| `CLINIC_BULK_EXPORT_IP_HASH_SECRET` | **required when `CLINIC_BULK_EXPORT_ENABLED=true`** | fail-closed | Dedicated HMAC key for hashing client IPs in the brute-force lockout table. Never reused from `JWT_SECRET`/`ENCRYPTION_KEY`/webhook secrets. |
| `CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS` | 1 hour | fail-open to the default on garbage input | Deadline for a `queued` row that no worker has claimed yet. Deliberately separate from, and much longer than, the generating lease — see Section 7. |
| `CLINIC_BULK_EXPORT_GENERATION_LEASE_MS` | 10 minutes | fail-open to the default on garbage input | Deadline for a `generating` row between heartbeat renewals. Claiming a queued row replaces its queue-timeout deadline with this (shorter) value. |
| `CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS` | 1 minute | fail-open to the default on garbage input | Background renewal tick interval during generation — well under the generation lease so multiple renewals happen before it could expire. |

**Emergency disable**: set `CLINIC_BULK_EXPORT_ENABLED=false` (or unset it)
and redeploy/restart. No runtime Platform Admin toggle exists in this PR —
disabling requires a config change and restart, deliberately, so an audited
deployment step is always involved.

**`CLINIC_BULK_EXPORT_IP_HASH_SECRET` rotation consequence**: rotating this
secret makes every existing `ClinicBulkExportPasswordAttempt.ipHash` value
un-matchable against newly computed hashes for the same IP. This is safe —
it simply resets lockout state per IP — but it means any IP that was
mid-lockout loses that lockout on rotation. Operators wanting a clean slate
can additionally truncate the `ClinicBulkExportPasswordAttempt` table, which
is optional.

## 3. Authorization and multi-branch model

Every route in `server/src/routes/clinicBulkExport.ts` — config, create,
status, download-token issuance, download — requires `authorize(['OWNER',
'ORG_ADMIN'])`. `CLINIC_MANAGER` is no longer permitted (the legacy endpoint
allowed it; this was a deliberate tightening).

The route's `:clinicId` is validated via `clinicScope.ts`'s
`validateAndGetScope(user, clinicId, res)` — **never** `req.user.clinicId`
(which is only a UI default, not an authorization scope, per
`middleware/auth.ts`'s own documentation). This both confirms the clinic
belongs to the caller's `organizationId` (cross-org rejection) and that the
caller is allowed to access it (inaccessible-clinic rejection). Both
failure modes return the same generic `403 CLINIC_BULK_EXPORT_FORBIDDEN` —
the response never reveals whether a clinic exists in a different
organization. The resolved `clinicId` and the clinic's own `organizationId`
(read from the validated DB row, never a client-supplied field) are what
gets stored on the archive row and in every audit entry.

## 4. Step-up authentication

`server/src/utils/passwordStepUp.ts` extracts the exact re-verification
pattern already used by `POST /api/auth/change-password`: re-fetch the user
by id, require the account to still exist and be active, `bcrypt.compare`,
reject empty/oversized (>200 char) input before hitting bcrypt, never
log/echo the password.

Job creation requires: current password, `confirm: true`, and a `purpose`
enum (`regulatory_request | clinic_migration | contract_termination |
legal_request | other`). An optional `restrictedNote` is stored only on the
archive row — never copied into `AuditLog`, `OperationalEvent`, or any log
line.

**Brute-force lockout is PostgreSQL-authoritative, with no Redis involvement
at all**
(`server/src/services/privacy/clinicBulkExportPasswordAttempts.ts`). Every
check-and-increment for a given `(userId, clinicId, ipHash)` key is
serialized with `pg_advisory_xact_lock` (same key-derivation shape as
`appointmentRequestSafety.ts`), acquired **before** reading or creating the
`ClinicBulkExportPasswordAttempt` row — this is what makes the
"row-doesn't-exist-yet" race safe. `bcrypt.compare` always runs unless the
PostgreSQL row itself currently has an unexpired `lockedUntil`; there is no
non-authoritative pre-check (Redis or otherwise) on this path that could
reject a correct password (an earlier draft had one — see Section 17,
remediation item 3 — it was removed entirely, not merely made
non-authoritative). IPs are stored only as an HMAC-SHA256 hash. Rows
untouched for >30 days are deleted by the cleanup job.

**Fresh step-up window, bound to the actor who verified it**: the archive
row's `stepUpVerifiedAt` AND `stepUpVerifiedByUserId` are set together, both
at creation (binding the requester) and whenever a caller supplies and
verifies a fresh password at download-token-issuance time (rebinding to
that verifier). Issuing the download token accepts either a freshly
supplied password (re-verified, which atomically rebinds both fields to the
verifying user in the same guarded update that issues the token) or, if
`now - stepUpVerifiedAt < 5 minutes` (server-clock only, never a
client-supplied timestamp) **and** the requesting user is exactly
`stepUpVerifiedByUserId`, no password. A different OWNER/ORG_ADMIN on the
same archive can never passwordlessly reuse another user's recent
verification — they must supply their own password, which then becomes the
new window owner (`utils/passwordStepUp.ts`'s `isStepUpWindowReusableBy()`).
A null `stepUpVerifiedByUserId` (e.g. the original verifier was later
deactivated/deleted, per the model's `onDelete: SetNull`) can never satisfy
passwordless reuse for anyone — it fails closed. The frontend always prompts
for a password before download regardless, but the backend implements and
tests both paths.

## 5. Rate limiting and concurrency

- **Creation cooldown** (per user+clinic) and **daily cap** (per clinic) are
  enforced in PostgreSQL, from `ClinicBulkExportArchive` history, inside the
  same advisory-locked reservation transaction described next. Redis is not
  used for these, nor for the step-up brute-force lockout — PostgreSQL is
  the sole authority for every rate/lockout decision on this feature; there
  is no Redis pre-check anywhere on the password-verification path (see
  Section 4 and Section 17, remediation item 3 — an earlier draft had one,
  and it was removed entirely, not merely demoted to non-authoritative).
- **Exactly one queued/generating job per clinic**, enforced twice:
  1. An advisory lock (`pg_advisory_xact_lock`, keyed by
     `clinic-bulk-export-slot:<clinicId>`) inside one `prisma.$transaction`
     — sweep stale rows past their lease to `failed`, check cooldown/daily
     cap, check for a remaining active row, insert.
  2. A hand-written **partial unique index**, the final database-level
     invariant:
     ```sql
     CREATE UNIQUE INDEX "ClinicBulkExportArchive_one_active_per_clinic"
     ON "ClinicBulkExportArchive" ("clinicId")
     WHERE status IN ('queued', 'generating');
     ```
     (`server/prisma/migrations/20260716120000_add_clinic_bulk_export/migration.sql`).
     This is deliberately raw SQL — Prisma schema syntax has no first-class
     way to declare a partial (`WHERE`-qualified) unique index without an
     unstable preview feature. **Validation performed this session**:
     applied via `prisma migrate deploy` to a completely fresh, disposable
     Postgres database (Docker container, no prior state), followed by
     `prisma migrate status` (reported "Database schema is up to date!", no
     drift) and again after `prisma generate` (still no drift). A direct
     raw-SQL insert test confirmed the index itself — not just the
     application-level check — rejects a second `queued`/`generating` row
     for the same clinic (`duplicate key value violates unique constraint`)
     while allowing a `failed` row for the same clinic (outside the partial
     predicate). Because this index isn't representable in `schema.prisma`,
     a `prisma format`/`generate` cycle can never "helpfully" regenerate or
     drop it — this is the entire point of keeping it as hand-authored raw
     SQL, and is documented directly in both the migration file and a
     doc-comment on the `ClinicBulkExportArchive` model.
- **Worker claim** uses a guarded `updateMany({where:{id, status:'queued'},
  ...})` — correctness comes from the WHERE-guarded update itself (only one
  of N concurrent worker replicas polling the same row can win), so multiple
  replicas claim different clinics' jobs concurrently without any
  cross-replica lock at claim time.

## 6. Database model / migration

New models in `server/prisma/schema.prisma` (migration
`20260716120000_add_clinic_bulk_export`):

- **`ClinicBulkExportArchive`** — `id, organizationId, clinicId,
  requestedByUserId` (nullable, `onDelete: SetNull` — archive/audit history
  survives user deactivation/deletion), `stepUpVerifiedByUserId` (nullable,
  `onDelete: SetNull` — the user whose password most recently satisfied
  step-up for this archive; binds the passwordless step-up reuse window to a
  specific actor, see Section 4), `status` (`queued | generating | ready |
  failed | expired`, default `queued`), `purpose, restrictedNote,
  exportSchemaVersion, storageKey, manifestJson, downloadTokenHash` (unique),
  `stepUpVerifiedAt, expiresAt, downloadedAt, artifactDeletedAt,
  cleanupFailureCode, heartbeatAt, leaseExpiresAt, failureCode, createdAt,
  updatedAt`. Indexes on `[organizationId, clinicId]`, `[clinicId, status]`,
  `[requestedByUserId, createdAt]`, `[stepUpVerifiedByUserId]`,
  `[expiresAt]`, `[leaseExpiresAt]`, `[clinicId, status, leaseExpiresAt]`,
  plus the raw-SQL partial unique index above.
- **`ClinicBulkExportPasswordAttempt`** — `id, userId, clinicId, ipHash,
  attemptCount, windowStartedAt, lockedUntil, updatedAt`, unique on
  `[userId, clinicId, ipHash]`.
- **`OperationalEvent.dedupeKey`** — additive nullable unique column, used
  for atomic duplicate-alert suppression (see Section 12).

No raw passwords, raw download tokens, encryption keys, internal exception
messages, or local filesystem paths are stored in any of these tables —
`storageKey` is an object-storage key (e.g. `exports/<clinicId>/<uuid>.zip`),
never a local path.

## 7. Worker generation lifecycle

`server/src/jobs/clinicBulkExportWorker.ts` + `server/src/services/privacy/clinicBulkExportPackage.ts`.

**Non-overlap is process-local**, not a database-wide lock: a module-level
`isTickRunning` flag skips a tick if the previous one in the *same process*
is still running. Using the DB-backed `withJobLock` here (a constant lock
name) would have serialized ticks across every replica, so only one
replica's worker could ever run at a time — directly contradicting the
requirement that multiple worker replicas process different clinics
concurrently. `withJobLock` is reserved for the cleanup cron only, where
singleton cluster-wide execution actually is the intent.

Each tick claims up to `CLINIC_BULK_EXPORT_WORKER_CONCURRENCY` (env, default
2) queued rows via the guarded per-row update and processes them with
bounded concurrency (`Promise.all` over at most that many claimed jobs —
never unbounded). Abandoned rows (lease expired, i.e. a worker crashed or
never claimed a queued row in time) are swept to `failed`
(`LEASE_EXPIRED`) at the start of every tick, so a crashed worker never
permanently blocks a clinic. A winning claim also records exactly one
`clinic_bulk_export_generation_started` audit event — a replica that loses
the guarded per-row claim race never writes it (Section 12).

**Queue timeout vs. generation lease are two separate, differently-sized
deadlines (P0 remediation)** — sharing one 10-minute lease between "queued,
waiting for a worker" and "actively generating" meant ordinary backlog under
bounded worker concurrency could be mistaken for an abandoned job. Now:

- A newly `reserveClinicBulkExport`'d row's `leaseExpiresAt` is set to
  `createdAt + CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS` (default 1 hour) and is
  never renewed while queued — nothing "heartbeats" a row no worker has
  claimed yet.
- `claimQueuedClinicBulkExportJobs` REPLACES that deadline with
  `now + CLINIC_BULK_EXPORT_GENERATION_LEASE_MS` (default 10 minutes) the
  moment a worker claims the row into `generating`.
- The same sweep query (rows in `queued` or `generating` whose
  `leaseExpiresAt` has passed → `failed`/`LEASE_EXPIRED`) runs unchanged in
  three places (reservation, claim, cleanup cron) — it is correct for both
  states because each state's row always carries the *right* deadline for
  whatever state it is currently in, never the other state's value.
- Verified against a real, disposable Postgres database: a queued row
  artificially aged past the (short, test-configured) generation lease but
  still within the (long) queue timeout remains claimable and is not
  incorrectly failed (`scripts/verify-clinic-bulk-export-lifecycle.ts`).

**Generation** streams a ZIP (`archiver`, piped to a temp file — never a
Buffer) containing `manifest.json`, `clinic.json`, and one `*.ndjson` file
per entity (`users`, `patients`, `appointments`, `treatment-cases`,
`payments`, `tasks`, `sent-messages`, `activity-logs`,
`insurance-provisions`, `inventory-items`), each written via Prisma
cursor pagination (batch size 500) as a lazily-pulled Node `Readable`, so no
table and no whole archive is ever fully materialized in memory.

**Full-lifecycle heartbeat (P0 remediation)** — the previous design only
renewed the lease once per cursor-paginated DB batch, so a large export
could exceed the generation lease during `archive.finalize()`, the
write-stream flush, or the storage upload, none of which are batch-shaped.
`generateClinicBulkExport` now starts a background heartbeat
(`startClinicBulkExportLeaseHeartbeat`, ticking every
`CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS`, default 1 minute) the moment
generation begins and stops it in a `finally` block only after the final
ready/failed transition — covering DB pagination, `archive.finalize()`, the
write-stream close, and the storage upload uniformly. The per-batch awaited
renewal remains as an additional checkpoint (`renewCheckpoint()`), sharing
the heartbeat's own in-flight guard so at most one renewal query for a job
is ever outstanding — the checkpoint and the background tick can never
overlap. A failed renewal sets an in-memory `leaseLost` flag; immediately
after the storage upload completes and before the row is ever flipped to
`ready`, `leaseLost` is checked one final time — if set, the just-uploaded
artifact is deleted, no `ready` transition ever happens, and the job fails
with the stable `LEASE_LOST` code, identical to a lease lost mid-streaming.
Verified against a real, disposable Postgres database: an artificially
delayed upload proves the heartbeat keeps the lease alive well past what
the old per-batch-only design would have survived, and a lease stolen
mid-upload proves the artifact is deleted and the row never reaches
`ready` (`scripts/verify-clinic-bulk-export-lifecycle.ts`).

`CLINIC_BULK_EXPORT_MAX_RECORDS` (default 500,000) and
`CLINIC_BULK_EXPORT_MAX_BYTES` (default 2 GB) are enforced while streaming.
On breach, generation stops immediately, the failure code
`SIZE_LIMIT_EXCEEDED` is recorded, and — critically — **`manifestJson` is
never persisted for a failed job**: temp/partial files are always deleted
(in every failure path, including S3 multipart abort via
`leavePartsOnError: false`), so there is never a misleading "complete"
artifact reachable from a failed job. `storageKey` can legitimately be
present on a `failed` row (see the planned-storageKey lifecycle
immediately below) — its presence never implies a downloadable artifact,
since every download path gates strictly on `status === 'ready'`, never on
`storageKey` alone.

### 7a. Planned-storageKey lifecycle — no post-upload orphan artifacts (P0 remediation)

The original design computed the ZIP's storage key and uploaded it in one
step, only writing that key to the database as part of the final
`ready`-transition update. This left a real gap: if the upload succeeded but
the subsequent `ready` update then threw, lost the lease, or matched zero
rows (a concurrent sweep), a full, sensitive clinic ZIP could be sitting in
object storage with **no durable database reference to it at all** — the
cleanup cron can only find and delete what a row's `storageKey` points to,
so an artifact with no such reference could never be found and would remain
in storage indefinitely.

`storageKey` is deterministic from `clinicId` + `jobId` alone
(`buildExportStorageKey`, unchanged) — the fix is *when* it is durably
written, not what it is. `generateClinicBulkExport` now:

1. Computes the deterministic key and, **before calling the storage upload
   at all**, persists it to the row via a guarded update
   (`id` matches, `status = 'generating'`, lease still valid). The row is
   still `generating` at this point, so download stays impossible
   regardless — every download path gates on `status === 'ready'`, never on
   `storageKey` being non-null.
2. If that guarded update itself loses the race (count `0`), generation
   fails immediately with the stable `LEASE_LOST` code and the upload is
   never attempted — nothing was ever written to storage under this key, so
   there is nothing to clean up.
3. From that point forward, **every** failure path — the upload itself
   throwing, the post-upload heartbeat lease-loss check, the final
   `ready`-transition update throwing, or that update losing the race
   (count `0`) — is funneled through the same `catch` block, which
   immediately (awaited, never fire-and-forget) attempts storage deletion
   for whatever `storageKey` is already on the row via
   `attemptArtifactDeletion`:
   - On successful deletion: `storageKey` is cleared, `artifactDeletedAt`
     is set, `cleanupFailureCode` is cleared.
   - On failed deletion (e.g. a transient S3 error): `storageKey` is
     **preserved** (never nulled) and `cleanupFailureCode:
     'STORAGE_DELETE_FAILED'` is set, so a later cleanup pass retries using
     the still-present key. The row's `status` is already a
     non-downloadable terminal value (`failed`) throughout.
4. A missing storage object (already deleted, or never actually written —
   e.g. the planned-key-persist-lost-the-race case) is treated as an
   **idempotent success**, not a failure to retry forever:
   `deleteStorageObjectIdempotent` re-checks existence via `fileExists`
   after a delete error and reports success if the object is confirmed
   gone.
5. A worker **process crash** between step 1 (planned key persisted) and a
   real upload landing is not something any in-process `catch` block can
   ever run for. This is closed by two mechanisms composing correctly: the
   abandoned-lease sweep flips the orphaned `generating` row to `failed`
   once its lease expires, and the cleanup cron's *expanded* retry-deletion
   sweep (Section 11) covers `failed` rows with a non-null `storageKey`, not
   only `expired` ones — so the row is found and its (possibly-nonexistent,
   idempotently-handled) artifact is cleaned up with no manual intervention.
   **Fifth-pass remediation (Section 20)**: the cleanup cron now runs these
   two steps — the abandoned-lease sweep, then the artifact-deletion
   retry — strictly in that order within **one** call, so a row needing
   both is fully cleaned up in the SAME cleanup run rather than requiring a
   second 15-minute tick as in the fourth-pass version of this document.

The planned `storageKey` is never exposed through any API/status response
(the status DTO explicitly excludes it, unchanged) or logged — it is purely
an internal database bookkeeping field, identical in shape and visibility to
how `storageKey` already behaved on a `ready` row.

Verified against a real, disposable Postgres database + real local-file
storage (`scripts/verify-clinic-bulk-export-lifecycle.ts`): all five
production failure paths (planned-key persist itself losing the race before
any upload; the final ready-transition losing the race after a real upload;
a real upload succeeding but a subsequent step throwing; a simulated
process-crash-after-planned-key-persist recovered purely by the sweep +
expanded cleanup sweep across two cleanup ticks; and an immediate delete
failure that is preserved with `cleanupFailureCode` and successfully
retried, and actually removed from disk, on a later run) — proving no
scenario leaves a reachable, untracked artifact.

### 7b. Crash-safe private temp lifecycle and post-finalize byte/integrity ceiling (fifth-pass, P0 remediation)

Two gaps found by a fifth review round, both closed on the same branch (see
Section 20):

**Private temp directory, exclusive-create, 0600 permissions.** The ZIP was
previously built at a fixed, predictable path directly under `os.tmpdir()`
(`clinic-bulk-export-<jobId>.zip`) — a shared, world-readable-by-convention
location. A hard process kill between the write stream opening and the final
`ready`/`failed` transition could leave a complete, unencrypted clinic ZIP
sitting there indefinitely with no DB-based cleanup able to discover it (the
database has no column recording a local scratch path — by design, since
that path is meaningless on every host except the one that crashed).
`server/src/services/fileStorage.ts` now provides a dedicated subdirectory
(`ensureExportTempDir`/`getExportTempDir`, `os.tmpdir()/diskliniks-export-tmp`,
created and `chmod`'d to `0700`, fully server-derived path with no client
input) and a deterministic-but-unpredictable naming scheme
(`buildExportTempFilePath`: `export-<jobId>-<16 hex random>.zip`) that a
stale-file sweep can recognize without a DB lookup by path. The temp ZIP's
write stream is opened with `{ mode: 0o600, flags: 'wx' }` (exclusive
create — never silently overwrites/truncates an existing path). Local-mode
final and `.partial-*` artifacts produced by `saveFileFromPath` are 0600 too
(the same-filesystem rename path preserves the temp file's own mode; the
cross-device `EXDEV` streamed-copy fallback opens its destination with an
explicit `{ mode: 0o600, flags: 'wx' }` and the partial file is re-`chmod`'d
to 0600 immediately before promotion regardless of which path produced it).

**Process-local stale-temp sweep**, independent of the singleton, DB-locked
cleanup cron (which cannot see any individual host's local filesystem at
all): `sweepStaleClinicBulkExportTempFiles` runs at worker startup and again
on every worker tick (`clinicBulkExportWorker.ts`). It only ever considers
files matching the recognized naming pattern, and deletes one only when
**both** it is older than a configurable threshold (default twice the
generation lease) **and** the job id encoded in its filename does not
currently belong to a `generating` row with a still-valid lease — a DB
lookup failure is treated as "cannot confirm inactive" and never authorizes
deletion by itself. This is what actually recovers a hard-killed process's
temp file: verified with a **real child process**
(`server/scripts/_clinicBulkExportCrashChild.ts`, spawned via `node --import
tsx`), `SIGKILL`ed the instant its real temp ZIP is observed on disk (no
`catch`/`finally` in that process ever runs), with the sweep — run in the
parent verify-script process, i.e. a genuinely separate OS process — proving
the file is found and deleted afterward, and that no final/partial artifact
was ever created (`scripts/verify-clinic-bulk-export-lifecycle.ts`).

Local-mode `exports/<clinicId>/*.partial-<uuid>` artifacts (the narrow
window `saveFileFromPath`'s cross-device fallback can leave behind if killed
mid-copy) get a matching sweep,
`cleanupStaleLocalExportPartialFiles` (`fileStorage.ts`), wired into the
existing DB-locked cleanup cron (age-gated, 30 minutes) — a no-op under S3
storage, since remote uploads have no local partial state; see the
production-checklist requirement for a bucket `AbortIncompleteMultipartUpload`
lifecycle rule in Section 14, which is the S3-mode equivalent (a hard kill
cannot execute the SDK's own `leavePartsOnError: false` client-side cleanup).

**Post-finalize byte-ceiling and ZIP structural-integrity re-check.** The
existing `CLINIC_BULK_EXPORT_MAX_BYTES` streaming check (unchanged, still
aborts generation early on egregious overage) runs on the `archive.on('data')`
accumulator **before** `manifest.json` is appended and **before**
`archive.finalize()` writes the ZIP's own central directory/EOCD record —
both add real bytes on top of whatever the entity streams alone produced, so
a payload that looked within budget mid-stream could still finish over the
ceiling. `generateClinicBulkExport` now re-checks, strictly after
`finalize()`/the write-stream close and strictly before the planned-key
persist: the **real on-disk size** of the completed temp file (ground
truth, not the async event accumulator) against `CLINIC_BULK_EXPORT_MAX_BYTES`,
failing with the same stable `SIZE_LIMIT_EXCEEDED` code on overage; and a
structural-integrity check (`validateZipStructuralIntegrity`, exported for
unit testing) that locates the EOCD record, reads only the central-directory
region it points to (never the whole file, preserving this module's
never-buffer-the-whole-archive design even for the validation step), and
confirms the resulting entry-name set exactly matches what was actually
written — failing with the stable `ZIP_INTEGRITY_FAILED` code otherwise.
Both failures funnel through the ordinary catch-block cleanup (temp file
unlinked; no `storageKey` ever persisted; nothing uploaded). Verified with a
self-calibrating test (generates once unconstrained to measure the real
final size for the exact payload/environment, then caps the limit to one
byte under that measured size for a second run) proving the entity payload
alone stays under budget while the real completed file — manifest.json and
ZIP overhead included — still gets rejected.

## 8. Versioned export data contract

`exportSchemaVersion: 1` on both the DB row and inside `manifest.json`.
`server/src/services/privacy/clinicBulkExportFieldAllowlists.ts` defines an
explicit Prisma `select` per exported entity — never a bare `findMany`.
These allowlists exclude every secret field named in the task spec
(`passwordHash`, session/reset/verification tokens, encrypted provider
credentials, API keys, OAuth tokens, webhook secrets, provider credentials,
platform-admin secrets, storage credentials) by construction, since only
explicitly-listed columns are ever selected. `manifest.json` includes
`generatedAt, organizationId, clinicId, requestedByUserId, purpose,
schemaVersion, entityCounts, fileNames, sha256PerFile` (computed while
streaming, no second read pass), and `scopeDescription`.

## 9. Physical-file scope decision

**This export contains structured clinic records only.** It does not
include, and this PR does not add, physical attachment or DICOM/imaging file
bytes. The manifest's `scopeDescription`, the API, and the frontend UI all
state this explicitly: *"This export contains structured clinic records
only. It does not include physical attachment or imaging files and must not
be treated as a complete backup."* This mirrors the option the task spec
explicitly allows (preserve the existing structured-data-only scope) rather
than adding a properly-bounded/legally-reviewed physical-file export, which
is out of scope for this PR.

## 10. One-time download token lifecycle

- **Issuance is atomic**: `POST .../download-token` requires fresh-or-
  windowed step-up, then a guarded `updateMany({where:{id, status:'ready',
  downloadTokenHash: null, expiresAt: {gt: now}}, ...})`. Only the request
  that flips `downloadTokenHash` from `null` wins; a concurrent second
  request gets `409 CLINIC_BULK_EXPORT_TOKEN_ALREADY_ISSUED`. The raw token
  (32 random bytes, base64url) is returned exactly once; only its SHA-256
  hash is ever persisted.
- **Synchronous expiry, not cron-dependent**: both this route and the
  download route call a single shared function,
  `expireArchiveIfPastTtl(row, now)`, before doing anything else. If a
  `ready` row's `expiresAt` has already passed — even if the 15-minute
  cleanup cron hasn't run yet — this function atomically flips it to
  `expired` right there and the request is rejected with
  `CLINIC_BULK_EXPORT_EXPIRED`. Cleanup-cron timing is never part of the
  security decision.
- **Download** (`GET .../download`): token supplied only via a dedicated
  header (`X-Clinic-Export-Download-Token`), never a query parameter.
  Validates org/clinic/job/role/status/expiry/`downloadedAt`, opens the
  storage stream **before** claiming, then atomically claims `downloadedAt`
  in the same transaction as a `download_started` audit write (fail-closed —
  see Section 12). If the claim's guarded update loses the race, or the
  transaction (including the audit insert) fails for any reason, the
  already-opened storage stream is explicitly `.destroy()`'d — never piped
  after a failed/lost claim, never left open. Replay of an already-claimed
  download returns `409 CLINIC_BULK_EXPORT_ALREADY_DOWNLOADED`.
  `download_completed`/`download_failed` are decided exclusively by the HTTP
  **response**'s own events, never the source storage stream's `'end'`
  event (which can fire while the response is still flushing bytes to a
  slow/disconnecting client): `res` `'finish'` → completed; `res` `'close'`
  fired before `'finish'` → failed (`interrupted`); the storage stream's own
  `'error'` → failed (`stream_error`). A single in-closure flag
  (`attachDownloadOutcomeListeners()`) guarantees exactly one outcome is
  ever recorded regardless of event ordering. Response headers:
  `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options:
  nosniff`.

## 11. Cleanup lifecycle

`server/src/jobs/clinicBulkExportCleanupJob.ts`, gated by
`CLINIC_BULK_EXPORT_CLEANUP_ENABLED` (default on), `withJobLock`-guarded
singleton cron every 15 minutes. Each run, **in this order** (fifth-pass
remediation — see Section 20; the order matters, see step 2/3 below):

1. Calls `expireArchiveIfPastTtl` across all `ready` rows past `expiresAt` —
   the exact same function request-time routes use, so there is one
   definition of "expired," not two.
2. Sweeps abandoned `queued`/`generating` rows past their lease to `failed`
   — a backstop; the worker's own per-tick sweep normally does this first.
   Deliberately runs **before** step 3 below (previously ran after it) so a
   row this very sweep just terminated is already eligible for artifact
   deletion in the same call, rather than requiring a second 15-minute tick.
3. For every `expired` **or `failed`** row still holding a non-null
   `storageKey` (a `failed` row can legitimately carry a `storageKey` too,
   see Section 7a's planned-storageKey lifecycle — including one this same
   call's step 2 just produced), attempts storage deletion via the same
   `attemptArtifactDeletion` function generation's own failure path uses.
   **This is a separate, non-atomic, retryable step** — a Postgres
   transaction cannot span an S3/local filesystem delete. On success,
   `storageKey` is cleared and `artifactDeletedAt` is set. On failure,
   `storageKey` is **preserved** (never nulled) and `cleanupFailureCode:
   'STORAGE_DELETE_FAILED'` is set so the next run retries — deletion is
   never silently abandoned, and the row's `status` stays whatever
   non-downloadable terminal value it already was throughout (only the
   storage-related fields change across retries). A missing storage object
   is treated as an idempotent success, never retried forever (Section 7a,
   point 4).
4. Sweeps stale local-mode `exports/<clinicId>/*.partial-<uuid>` artifacts
   older than 30 minutes (`cleanupStaleLocalExportPartialFiles`, Section 7b)
   — a no-op under S3 storage.
5. Deletes `ClinicBulkExportPasswordAttempt` rows untouched for >30 days.
6. Continues past individual row failures; logs only stable
   identifiers/codes, never raw paths or payloads.

Separately, and NOT part of this DB-locked singleton job: each worker
replica also sweeps its OWN host's local OS temp directory for orphaned
in-progress ZIPs (`sweepStaleClinicBulkExportTempFiles`, Section 7b) — a
temp file a crashed process left behind is invisible to any other host and
invisible to `storageKey`-based cleanup entirely, so it needs a
process-local mechanism, not a cluster-wide one.

## 12. Audit and alerting

**Fail-closed for three critical events** — export request creation,
download-token issuance, download claim/start: the archive-row mutation and
its audit-log insert happen inside the **same** `prisma.$transaction`, using
a new `writeAuditLogInTx(tx, input)` whose signature *requires* a
`Prisma.TransactionClient` (no optional/default fallback to the global
`prisma` instance — it structurally cannot write outside the caller's
transaction). If the audit insert throws, the whole transaction rolls back:
the archive row is never created/updated and the API never reports success.
All other events (`step_up_failed`, `rate_limited`,
`generation_started/completed/failed`, `download_completed/failed`,
`legacy_endpoint_attempted`, `feature_disabled_attempt`) use the regular
fire-and-forget-safe `writeAuditLog` (still always `await`ed, unlike the
legacy route) — **except `generation_started`**, which is fail-closed like
the three critical events above (P1 remediation). The original design
performed the guarded claim update, a separate `findUnique` job read, and a
separate fire-and-forget `writeAuditLog` call as three independent steps —
a crash between them, or a failing (non-fail-closed) audit insert, could
leave a row durably claimed into `generating` with no
`generation_started` audit trail at all, which is not exactly-once. Fixed:
`claimSingleQueuedJobWithAudit` now wraps the guarded claim update, the
stable-job-identifier read, and the `writeAuditLogInTx`-based audit write in
a single `prisma.$transaction` per candidate row. If the guarded claim loses
the race (count `0`), the function returns immediately with no audit write
and no side effects. If the audit insert itself throws for any reason, the
**entire transaction rolls back, including the claim** — the row is left
exactly as it was (`queued`), available for another replica or a later tick
of the same replica to claim; the job is never silently claimed with no
audit trail. One candidate's transaction failure is caught per-candidate in
`claimQueuedClinicBulkExportJobs`'s own loop so it can never abort claiming
other, healthy candidates in the same tick. Metadata is limited to `jobId`
and `schemaVersion`, the same stable-identifiers-only rule as every other
event below. Verified against a real, disposable Postgres database: two
concurrent claim calls racing for the same queued job produce exactly one
claim and exactly one `generation_started` audit row; a forced audit-write
failure rolls back the claim entirely, leaves the job `queued` (its
`heartbeatAt`/`leaseExpiresAt` unchanged from reservation time) with zero
audit rows, and the job remains normally claimable afterward
(`scripts/verify-clinic-bulk-export-lifecycle.ts`).

Audit metadata is limited to `clinicId, jobId, purpose, schemaVersion,
counts, resultCode, ip/userAgent` — never `restrictedNote`, the password,
the raw token, patient data, message bodies, `storageKey`, local paths,
manifest content, or raw exception text.

**Alerting** reuses the existing `OperationalEvent` table (surfaced on the
Operations page) — no second/parallel alerting framework was built. A
`severity: 'critical'` event is recorded on `export_requested`, with
duplicate suppression made atomic via a new nullable, unique
`OperationalEvent.dedupeKey` column and an `upsert` (never
check-then-insert).

## 13. Frontend flow

`src/pages/Settings.tsx` gained a new `'bulkExport'` tab, visible only when
`canExportClinicBulkData(user)` (OWNER/ORG_ADMIN, `src/utils/permissions.ts`)
is true, delegating to `src/components/settings/ClinicBulkExportSection.tsx`.

**Explicit clinic selection (P0 remediation)**: the page passes the
component the user's full `availableClinics` list and the global clinic
switcher's raw `selectedClinicId` ("all" or a specific id) — never a
pre-resolved single clinic (the old code silently fell back to the user's
default/first clinic whenever the global switcher was "all", which could
export the wrong clinic's data without the user ever explicitly choosing
it). The component owns its own explicit selection (`clinicId` state,
resolved via `src/components/settings/clinicBulkExportSelectionHelpers.ts`'s
pure `resolveExplicitClinicId`): it is seeded from the global switcher only
when the switcher already names one specific, currently-accessible clinic;
when the switcher is "all", the section starts with no selection and shows
its own dropdown (populated only from `availableClinics`) plus a notice
that one specific clinic must be chosen. The selected clinic's name is
shown prominently above the form and interpolated into the confirmation
sentence (`confirmLabel` with `{{clinicName}}`). Submission is impossible
without a selected clinic — the purpose/password/confirm form itself does
not render until one is chosen, and the create handler additionally guards
and surfaces `errors.clinicRequired` defensively. Changing the clinic — via
the in-section dropdown or the global switcher changing to a different
specific clinic — resets every piece of transient/sensitive state in one
place (`initialClinicBulkExportState()`/`resetForClinicChange`): the active
job id, polled job state, both password fields, download/token state, the
confirmation checkbox, and any submit/download errors.

**Stale cross-clinic async-response guard (P0 remediation)**: the clinic
selector can change while a create/token/download request is still in
flight, and a response for the clinic the user has since navigated away
from must never be applied. A monotonically increasing
`selectionEpochRef`, bumped on every explicit clinic change (via
`handleClinicChange`) or the selection becoming invalid (the
global-switcher-sync effect), is captured together with the request's
`clinicId` at the moment each async operation starts. After **every**
`await` — the create response, the download-token response, and the blob
download response — both captured values are re-checked against the live
ones (`isRequestStillCurrent`, `src/components/settings/
clinicBulkExportSelectionHelpers.ts`, pure and independently unit-tested)
before `setActiveJobId` is called, before an error/status update is
applied, before the follow-up download request is even issued, and before
an object URL is created or a browser download is triggered. A mismatch
silently discards the response. **Fifth-pass remediation (Section 20)**: the
same guard now also gates each handler's own `finally` block —
`setSubmitting(false)`/`setDownloading(false)` fire only when the captured
`{clinicId, epoch}` still match live, so a stale clinic-A request settling
after the user has already switched to (and started a new request for)
clinic B can never clear B's own in-flight loading indicator. The
global-switcher-sync effect itself was
also fixed to stop nesting `resetForClinicChange`'s multiple `setState`
calls inside a `setClinicId` functional updater (state updates must stay
side-effect free) — it now reads the previous selection via a ref and
performs the reset as a plain top-level effect body call. AbortController
request cancellation was considered as an additional layer but not added in
this round (it would require extending `clinicBulkExportService`'s method
signatures in `src/services/api.ts`, out of this round's scope); the epoch
guard alone is sufficient for correctness and is what the tests actually
prove.

**"Start new export" (P0 remediation)**: previously only cleared the active
job id and the purpose/note fields, leaving stale password, confirmation,
download-error, and object-URL state behind. `handleStartNew` now clears
every password/confirmation/download/error field (mirroring
`resetForClinicChange`'s list, minus the clinic-identity fields) while
deliberately **retaining** the currently selected clinic and its current
`enabled`/`configError` state, and also bumps the selection epoch so a
download/create request still in flight for the abandoned export can never
repopulate state this action just cleared.

When the backend reports the feature disabled (via a dedicated,
OWNER/ORG_ADMIN-authorized `GET .../bulk-export/config` endpoint that
returns only `{enabled}`, now driven by
`isClinicBulkExportEnabledForOrganization` — see Section 14), no active
button is shown — only a localized explanation. When enabled: purpose
selection → password → explicit confirmation checkbox → submit (disabled
while pending or while no clinic is selected, preventing duplicate
submissions) → `202` creates the job → a dedicated bounded-backoff polling
hook (`src/hooks/useClinicBulkExportStatus.ts`, **not** built on
`src/components/imaging/pairingPoller.ts` — deliberately not coupling the
privacy/export domain to the imaging-bridge domain) polls status at 2s → 4s
→ 8s → capped 15s intervals, giving up after 30 minutes → on `ready`, a
fresh password prompt precedes requesting the download token → the token is
used once, in a header, for an authenticated blob download → the object URL
is revoked immediately after the synthetic-anchor download. Password and
token are never written to `localStorage`/`sessionStorage`. Locale keys
exist in `tr`, `en`, `fr`, `de` (`src/locales/{lng}/clinicBulkExport.json`,
registered in `src/i18n/config.ts`).

## 14. Production enablement checklist

Do **not** enable this in production until all of the following are true:

- [ ] `CLINIC_BULK_EXPORT_IP_HASH_SECRET` generated and set (dedicated,
      ≥32 chars, never reused from another secret) in every API/worker
      replica's environment.
- [ ] `CLINIC_BULK_EXPORT_CLEANUP_ENABLED` confirmed running (default on;
      confirm cron logs) *before* flipping the creation flag on, so nothing
      accumulates unbounded from the first moment creation is allowed.
- [ ] `CLINIC_BULK_EXPORT_WORKER_CONCURRENCY`,
      `CLINIC_BULK_EXPORT_MAX_RECORDS`, `CLINIC_BULK_EXPORT_MAX_BYTES`,
      `CLINIC_BULK_EXPORT_TOKEN_TTL_MS` reviewed against production data
      volumes.
- [ ] `CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS` (default 1 hour — queued-backlog
      deadline before an unclaimed job is swept to `failed`/`LEASE_EXPIRED`),
      `CLINIC_BULK_EXPORT_GENERATION_LEASE_MS` (default 10 minutes — how long
      an actively-`generating` row may go without a heartbeat renewal before
      it is considered abandoned), and
      `CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS` (default 1 minute —
      background renewal tick interval during generation) reviewed against
      production export sizes/durations. **The heartbeat interval must
      remain safely below the generation lease** — it exists specifically so
      multiple renewals happen before the lease could expire; setting it
      close to or above the lease value defeats the whole mechanism and
      risks a large, legitimately-still-generating export being swept as
      abandoned mid-upload. The unit test suite asserts the *defaults*
      satisfy `heartbeat < lease < queueTimeout`
      (`server/src/tests/clinicBulkExport.test.ts`, section 18) — this is
      not re-validated for custom overrides, so any operator-supplied values
      must preserve that same ordering.
- [ ] Migration `20260716120000_add_clinic_bulk_export` applied to
      production; `prisma migrate status` shows no drift; the partial
      unique index confirmed present via `\d "ClinicBulkExportArchive"` (or
      equivalent) in production.
- [ ] On every worker/API host, confirm the process can create and `chmod`
      `os.tmpdir()/diskliniks-export-tmp` (Section 7b) — a host with a
      read-only or non-standard `TMPDIR` would otherwise fail generation
      loudly (caught, `GENERATION_ERROR`), not silently.
- [ ] If `S3_BUCKET` is configured (remote storage mode): the bucket has an
      **`AbortIncompleteMultipartUpload`** lifecycle rule configured (a short
      window, e.g. 1–7 days, is sufficient). This is the S3-mode equivalent
      of the local-mode stale-partial-file sweep (Section 7b/11) — a hard
      process kill mid-upload cannot execute the SDK's own
      `leavePartsOnError: false` client-side abort, so without a
      bucket-level rule, incomplete multipart parts would accumulate
      (billed, never cleaned up) indefinitely.
- [ ] At least one end-to-end production run performed: create → poll →
      ready → download → cleanup, with the resulting archive row and
      storage object inspected directly.
- [ ] Only then: flip `CLINIC_BULK_EXPORT_ENABLED=true`. This flag is
      **global** — every authorized (correct role, correct clinic scope)
      organization is enabled the moment it is set, EXCEPT organizations
      deliberately excluded via the server-enforced
      `CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS` rollout allowlist
      (comma-separated organization ids; unset/empty = no allowlist = every
      organization). For a controlled pilot rollout, set
      `CLINIC_BULK_EXPORT_ENABLED=true` together with
      `CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS` populated with only the
      pilot organization's id(s); every other organization gets the
      identical `CLINIC_BULK_EXPORT_DISABLED` response an org gets when the
      flag itself is off — the allowlist is never a distinguishable error
      class from "feature off". Widen or clear the allowlist to progress the
      rollout; clearing it entirely (or leaving it unset) is what makes the
      flag truly global. Both the config endpoint (`GET .../bulk-export/config`)
      and the create route consult the same combined decision
      (`isClinicBulkExportEnabledForOrganization`), so the frontend's
      disabled notice and the server's actual enforcement can never drift
      apart.
- [ ] Legal/compliance sign-off on the `purpose` codes and the
      structured-data-only scope statement, independent of this PR.

Until every box above is checked, this control remains **Implemented —
awaiting deployment/operational verification**, not Completed, per Section 7
of `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`.

## 15. Rollback strategy

- **Flag rollback (no deploy needed for a stuck-open flag)**: set
  `CLINIC_BULK_EXPORT_ENABLED=false` and restart — immediately blocks new
  job creation. **Corrected (fifth-pass remediation, Section 20)**: prior
  versions of this document claimed in-flight `queued`/`generating` jobs
  "simply age out via the existing lease-expiry sweep" while the worker
  keeps running — that was never accurate once the worker is still
  configured and polling, since nothing in the pre-fifth-pass code ever
  stopped it from claiming/continuing those jobs regardless of the flag. As
  of this remediation the flag is a genuine kill switch: the worker will not
  claim a still-`queued` job once the flag is off (it is moved atomically to
  `failed`/`FEATURE_DISABLED` on the very next tick, well before any queue
  timeout), and `generateClinicBulkExport` re-checks the flag at three
  points during an already-`generating` job and stops it the same way,
  deleting any artifact already uploaded. No manual intervention is needed
  for either case; a manual `failed` update remains available only for an
  operator who wants to bypass waiting for the next worker tick entirely.
  **Extended (sixth-pass remediation, Section 21)**: a PM2 rolling
  reload/restart is a distinct scenario from an env-only flag flip — the OLD
  worker process keeps its OLD in-memory `process.env` snapshot until it
  actually exits, so the flag-recheck behavior above only helps once that old
  process is gone. `stopClinicBulkExportWorker()` (bound to
  `process.once('SIGTERM'/'SIGINT', ...)`) now atomically cancels every job
  the old process is still actively generating the moment it receives the
  reload's shutdown signal, rather than leaving it to keep running until its
  own next flag re-check or lease expiry.
- **Code rollback**: revert to the pre-merge commit. The legacy
  `gdprExport.ts` route stays permanently disabled either way (it is not
  restored by a rollback of this PR — reverting only removes the new secure
  path, it does not resurrect the old vulnerable one, since the legacy
  route's disable is part of this same PR and would revert together;
  operators who roll back must re-apply the legacy-disable fix separately
  if they roll back past this commit).
- **Migration rollback**: `prisma migrate resolve --rolled-back
  20260716120000_add_clinic_bulk_export` is bookkeeping-only (marks the
  migration as not-applied in Prisma's tracking table) — it does **not**
  drop the new tables/columns. An actual schema rollback requires a
  hand-written down-migration (`DROP TABLE "ClinicBulkExportArchive"`, `DROP
  TABLE "ClinicBulkExportPasswordAttempt"`, `ALTER TABLE "OperationalEvent"
  DROP COLUMN "dedupeKey"`) — not created in this PR since no rollback is
  planned or expected. Any already-generated export ZIP objects in storage
  are unaffected by a schema rollback and must be cleaned up separately if
  desired.

## 16. Remaining risks (not blocking, tracked here)

- No production/browser verification has been performed yet (this document
  reflects code-review-time state only).
- The single-active-job invariant, atomic token issuance, and password-
  attempt concurrency have automated tests but have not been load-tested at
  realistic multi-replica production scale.
- `archiver`'s TypeScript definitions omit `.abort()` even though it exists
  at runtime; a type-only workaround (documented inline in
  `clinicBulkExportPackage.ts`) is used — a future `archiver` upgrade should
  re-check whether this is still necessary.
- The `purpose` codes and structured-data-only scope statement are stated as
  technical facts here, not validated against any specific legal
  requirement — that remains a legal-review dependency, consistent with how
  this tracker treats every other legal question.

## 17. Remediation round (2026-07-16, second pass — PR #165 review)

A follow-up security review of the initial implementation found six issues,
all fixed on the same branch before requesting further review. Status
remains **Implemented — awaiting deployment/operational verification**; the
feature flag remains `false`.

1. **Step-up reuse was not bound to an actor.** The download-token route
   only checked the archive's `stepUpVerifiedAt` timestamp, so any
   OWNER/ORG_ADMIN on the same archive could reuse a DIFFERENT user's recent
   step-up window. Fixed by adding `stepUpVerifiedByUserId` (nullable,
   `onDelete: SetNull`) to `ClinicBulkExportArchive`: creation binds the
   requester, a fresh password re-verification at token-issuance time
   rebinds the actor atomically in the same guarded update that issues the
   token, and passwordless window reuse now requires
   `stepUpVerifiedByUserId === current user` via the new pure helper
   `isStepUpWindowReusableBy()` (`utils/passwordStepUp.ts`). A null verifier
   (e.g. the original verifier was deleted) can never satisfy passwordless
   reuse for anyone.
2. **The download claim was under-guarded.** It previously matched only
   `id + downloadedAt: null`, leaving a gap between the earlier
   `validateClinicBulkExportDownloadToken` read and the claim itself.
   `claimClinicBulkExportDownload` now guards
   `id/clinicId/organizationId/status='ready'/expiresAt>now/downloadedAt=null/downloadTokenHash=<exact hash>`
   in one `updateMany`, and on a miss re-reads to return a precise reason
   (`not_found`/`wrong_scope`/`expired`/`not_ready`/`already_downloaded`/`invalid_token`)
   instead of a generic one. Proven against a real database: an archive that
   expires strictly between validation and claim can never be claimed, even
   with an otherwise-valid token.
3. **Redis could reject a correct password.** The step-up lockout path had a
   Redis fast-pre-check that could skip `bcrypt.compare` — and record a
   failed attempt — purely because Redis *suggested* the key was over
   threshold, even when PostgreSQL had no active `lockedUntil`. Removed
   entirely; PostgreSQL (already advisory-lock-serialized) is now the sole
   authority. Proven against a real database: after failed attempts below
   the lockout threshold, the correct password still succeeds and resets
   the attempt counter.
4. **Lease renewal amplified with record count.** Renewal was fired
   fire-and-forget from the entity stream's per-record `'data'` event
   (batched every 25 records but still unbounded in principle for a large
   export). Replaced with one *awaited* renewal per cursor-paginated DB
   batch (proportional to batch count, never record count); a failed
   renewal now throws `ClinicBulkExportLeaseLostError`, mapped to the stable
   `LEASE_LOST` failure code, and generation stops immediately. Because the
   renewal is awaited inline in the generator's own pull loop, calls for the
   same job can never overlap. Proven against a real database with a
   1,250-row fixture (3 batches).
5. **Download completion was decided by the wrong event.** The old code
   marked a download "completed" on the *source* stream's `'end'` event,
   which can fire while the response is still flushing to a
   slow/disconnecting client. Replaced with an exactly-once outcome decided
   only by the response: `res` `'finish'` → completed, `res` `'close'`
   before `'finish'` → failed (interrupted), `stream` `'error'` → failed.
   Extracted into a standalone, unit-tested helper,
   `attachDownloadOutcomeListeners()`.
6. **Manifest checksums were incomplete; some audit writes were
   fire-and-forget.** `clinic.json` now gets a real computed SHA-256 entry
   in `sha256PerFile` (manifest.json remains deliberately excluded — hashing
   itself would be circular — and this is documented on the type). Every
   non-critical, request-path `writeAuditLog` call (feature-disabled
   attempt, rate-limited, step-up-failed ×2, the legacy endpoint attempt) is
   now `await`ed rather than `void`-fired, so the response can never precede
   the audit attempt (the calls still swallow insert failures — they are
   not part of the fail-closed critical-event set).

A real bug was also found and fixed while extending the disposable-Postgres
verification script to exercise a genuine end-to-end ZIP lifecycle
(reserve → claim → generate a real ZIP → inspect its entries and checksums →
issue a token → download → replay-reject → expire → cleanup deletes the real
file → a dedicated `SIZE_LIMIT_EXCEEDED` run with a tiny configured limit):
`generateClinicBulkExport`'s `writeFinished` promise (resolved by the
archiver/write-stream pipeline) was created early but only ever `await`ed on
the happy path. When generation failed before reaching that `await` (e.g. a
size-limit abort), the promise could still reject later and crash the
process as an unhandled rejection. Fixed by attaching a no-op `.catch()`
immediately after creation — the later `await writeFinished` on the happy
path is unaffected.

See `server/src/tests/clinicBulkExport.test.ts` sections 11–17 (34 new
tests) and `server/scripts/verify-clinic-bulk-export-lifecycle.ts` (10 new
disposable-Postgres tests, including the full real-ZIP lifecycle) for the
verification coverage.

## 18. Remediation round (2026-07-16, third pass — PR #165 further review)

A further review found six issues in the second-pass remediation itself,
all fixed on the same branch. Status remains **Implemented — awaiting
deployment/operational verification**; the feature flag remains `false`.

1. **The disabled-feature check ran BEFORE clinic-scope validation.** The
   create route checked `CLINIC_BULK_EXPORT_ENABLED` first, using the raw,
   unvalidated route `:clinicId` for the disabled-feature audit write — a
   cross-org or otherwise inaccessible clinicId could reach `AuditLog`
   before `validateAndGetScope` ever ran. Fixed by moving scope
   resolution+validation to happen first; the disabled-feature audit now
   only ever uses the DB-validated `clinicId`/`organizationId`, and
   password/purpose/confirmation are still not parsed on the disabled path.
   Proven with a real Express-handler-level test against a real Postgres
   database (not just source inspection): a cross-org and an inaccessible
   same-org clinicId both get the generic forbidden response with **zero**
   matching `AuditLog` rows, while a validated clinic still gets the
   disabled-feature audit event using only the validated fields
   (`scripts/verify-clinic-bulk-export-lifecycle.ts`).
2. **The frontend could silently export the wrong clinic.** `Settings.tsx`
   resolved a single "selected clinic" that fell back to the user's
   default/first clinic whenever the global clinic switcher was "all",
   and the export section never displayed which clinic would be exported.
   Fixed with an explicit, dedicated in-section clinic selector (Section
   13) that never auto-selects on "all", shows the chosen clinic's name
   prominently and in the confirmation sentence, blocks submission until
   one specific accessible clinic is chosen, and resets every
   transient/sensitive piece of state on any clinic change.
3. **The lease was not covered for the entire generation lifecycle.**
   The awaited per-batch renewal (from the second-pass remediation) only
   ran during DB pagination — `archive.finalize()`, the write-stream
   flush, and the storage upload had no renewal at all, so a large export
   could lose its lease during exactly those phases. Fixed with a
   non-overlapping background heartbeat covering the whole generation
   lifecycle, checked one final time (with artifact deletion on loss)
   immediately before the `ready` transition (Section 7).
4. **Queued backlog shared the same short lease as active generation.**
   Normal backlog under bounded worker concurrency could be swept to
   `LEASE_EXPIRED` merely for waiting a few cron ticks. Fixed by splitting
   queue timeout and generation lease into separate, independently
   configurable durations, with claiming a queued row explicitly replacing
   the longer queue deadline with the shorter generation lease (Section 7).
5. **No audit trail for generation actually starting.** Only
   `requested`/`completed`/`failed` were recorded; there was no signal that
   a claimed job had actually begun generating. Fixed: exactly one
   `clinic_bulk_export_generation_started` event per successfully claimed
   job (Section 12).
6. **Documentation had drifted from the actual second-pass code.** The
   main Step-up section still described Redis as an optional
   non-authoritative pre-check (Redis was in fact removed entirely, not
   merely demoted — the accurate description only appeared in this
   section's own remediation-round-2 appendix) and did not describe
   actor-bound step-up reuse in its main body; the production checklist
   said "pilot organization first" while the flag was, and remained,
   global with no server-enforced way to actually restrict a rollout.
   Fixed: Section 4 now documents actor-bound step-up and the Redis-free
   design directly; a new server-enforced
   `CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS` rollout allowlist was
   added (Section 2, Section 14) so "pilot first" is now a true statement
   backed by code, not aspirational prose; and the download-completion
   wording (Section 10) now describes the actual `res`
   `'finish'`/`'close'` semantics instead of "whether the stream finished".

See `server/src/tests/clinicBulkExport.test.ts` section 18 (new tests for
the queue-timeout/generation-lease/heartbeat config functions and the
tenant allowlist) and `server/scripts/verify-clinic-bulk-export-lifecycle.ts`
(new real-Postgres, real-handler tests for scope-before-flag ordering, the
queue-timeout-vs-generation-lease claim race, the full-lifecycle heartbeat
under a delayed upload, lease-loss-during-upload artifact deletion, and the
tenant allowlist) for the verification coverage. The frontend's explicit
clinic-selection logic is covered by
`src/components/settings/__tests__/clinicBulkExportSelectionHelpers.test.ts`
(pure-logic tests — this repo has no DOM/React Testing Library harness).

## 19. Remediation round (2026-07-17, fourth pass — PR #165 further review)

A further review found two P0 gaps and one P1 durability gap in the
third-pass remediation, plus documentation drift. All fixed on the same
branch. Status remains **Implemented — awaiting deployment/operational
verification**; the feature flag remains `false`.

1. **Post-upload orphan artifacts.** The generation flow uploaded the ZIP
   before the guarded `ready` transition, writing `storageKey` to the
   database only as part of that final update. A DB update throw, a lost
   lease, or the final update losing its race left a real, sensitive ZIP in
   object storage with no durable reference any cleanup pass could ever
   find. Fixed with a durable planned-artifact lifecycle: the deterministic
   `storageKey` is persisted to the row via its own guarded update BEFORE
   upload begins (while still `generating` — download stays impossible
   regardless, since it gates on `status`, not on `storageKey`), and every
   failure from that point on is funneled through one `catch` block that
   immediately (awaited) attempts idempotent storage deletion, clearing
   `storageKey`/setting `artifactDeletedAt` on success or preserving
   `storageKey`/setting `cleanupFailureCode` on failure. The cleanup cron's
   retry-deletion sweep was expanded from `expired`-only to `expired OR
   failed` rows carrying a `storageKey`, closing the one remaining gap (a
   worker process crash between the planned-key persist and a real upload)
   via the pre-existing abandoned-lease sweep plus this expanded retry.
   Full detail and the real-database proof for all five distinct failure
   paths: Section 7a.
2. **Stale cross-clinic async UI results.** The clinic selector could change
   while a create/token/download request was in flight, letting a response
   for clinic A apply itself after the UI had already moved to clinic B —
   up to and including triggering a browser download for the wrong,
   already-abandoned clinic's export. Fixed with a selection-epoch guard
   (`selectionEpochRef`, bumped on every explicit clinic change or the
   selection becoming invalid) checked, together with the request's
   captured `clinicId`, after every `await` before any state mutation or
   download trigger. A latent state-purity bug was fixed alongside it: the
   global-switcher-sync effect previously nested `resetForClinicChange`'s
   several `setState` calls inside a `setClinicId` functional updater
   (React state updates must stay side-effect free) — it now performs the
   reset as a plain top-level effect body call. "Start new export" was also
   found to leave stale password/confirmation/download-error state behind;
   it now clears every sensitive field while retaining only the selected
   clinic and its current enabled config. Full detail: Section 13.
3. **`generation_started` was not exactly-once or durable (P1).** The claim
   update, the job-identifier read, and the audit write were three
   independent steps (a guarded `updateMany`, a separate `findUnique`, a
   separate fire-and-forget `writeAuditLog`) — a crash or a failing insert
   between them could leave a row durably claimed with no audit trail.
   Fixed by wrapping the claim, the read, and a `writeAuditLogInTx`-based
   audit write in a single `prisma.$transaction` per candidate row; a
   failing audit insert now rolls back the claim itself, leaving the job
   `queued` for another replica or a later tick. Full detail: Section 12.
4. **Documentation drift.** Section 5 still stated a Redis password-attempt
   pre-check existed as a "non-authoritative optimization" — Redis was in
   fact removed entirely in the second-pass remediation (Section 17, item
   3); PostgreSQL has been the sole lockout authority since then, and
   Section 5 now says so consistently with Section 4. The
   `ClinicBulkExportArchive` field summary (Section 6) omitted
   `stepUpVerifiedByUserId`, added in the second-pass remediation — added.
   The production checklist (Section 14) did not list
   `CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS`,
   `CLINIC_BULK_EXPORT_GENERATION_LEASE_MS`, or
   `CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS`, and nowhere stated that the
   heartbeat interval must remain safely below the generation lease —
   added, along with an explicit note that the unit suite only validates
   this ordering for the *defaults*, not for operator-supplied overrides.

See `server/src/tests/clinicBulkExport.test.ts` sections 19–20 (12 new
tests: the planned-key persist-before-upload ordering, every post-planned-
key failure path throwing into the unified catch-block cleanup,
`attemptArtifactDeletion`'s widened `status !== 'ready'` gate, the
idempotent-missing-object delete helper, the expanded `expired`+`failed`
cleanup sweep, the test-only `deleteForTest`/`beforePlannedKeyPersistForTest`
override seams, and the transactional claim+audit wrapping) and
`server/scripts/verify-clinic-bulk-export-lifecycle.ts` (7 new real-Postgres
+ real-local-storage tests: all five distinct orphan-artifact failure paths
with real uploaded/deleted files on disk, a concurrent claim race proving
exactly-one-claim and exactly-one-audit, and a forced audit-write failure
proving the claim rolls back and the job remains queued) for the
verification coverage. The frontend epoch guard and start-new reset are
covered by 14 new pure-logic + source-inspection tests in
`src/components/settings/__tests__/clinicBulkExportSelectionHelpers.test.ts`
sections 6–9 (still no DOM/React Testing Library harness in this repo).

## 20. Remediation round (2026-07-17, fifth pass — PR #165 further review)

A fifth review found two further P0 gaps and two P1 gaps, all fixed on this
same branch. Status remains **Implemented — awaiting deployment/operational
verification**; the feature flag remains `false`, not merged, not deployed.

1. **Crash-safe private temp lifecycle (P0).** The generation ZIP was built
   at a predictable, shared `os.tmpdir()` path with default (loose) file
   permissions, and nothing on any worker host ever swept it — a hard
   process kill could leave a complete, unencrypted clinic ZIP there
   indefinitely. Fixed with a dedicated private (`0700`) temp directory,
   exclusive-create (`wx`) `0600` temp/partial/final local files, and a new
   process-local sweep (`sweepStaleClinicBulkExportTempFiles`, run at worker
   startup and on every tick) that recognizes only this feature's own temp
   files and deletes one only when it is both old enough AND its job is
   provably no longer actively generating. Proved with a **real child
   process**, `SIGKILL`ed the instant its real temp file is observed on
   disk (no `catch`/`finally` in that process ever runs), recovered by the
   sweep running in a genuinely separate process. Full detail: Section 7b.
2. **Post-finalize byte-ceiling and ZIP-integrity check (P0).** The existing
   `CLINIC_BULK_EXPORT_MAX_BYTES` check ran on the streaming byte
   accumulator *before* `manifest.json` and the ZIP's own central
   directory/EOCD were written — a payload within budget mid-stream could
   still finish over the ceiling. Fixed with a second, authoritative check
   on the real completed file's on-disk size, plus a structural-integrity
   validator, both strictly after `finalize()`/write-stream close and
   strictly before the planned-key persist. **A genuine pre-existing latent
   bug was found and fixed while building this check's own test**:
   `archiver`'s `abort()` (called from the byte-limit 'data' listener) can
   be invoked while `archive.finalize()` is still flushing the central
   directory — in that interleaving, the awaited `archive.finalize()`
   promise can hang **forever**, even though the underlying write stream
   still closes normally. Since nothing before this round ever exercised a
   byte-limit breach that lands during/after `finalize()` (the only
   pre-existing byte-limit-adjacent test breaches via record count, not
   bytes, and trips synchronously inside the streaming loop, well before
   `finalize()` is ever reached), this hang was previously unreachable by
   any test or, apparently, any real export — but it was a real risk for
   any future export whose overage is dominated by ZIP/manifest overhead
   rather than entity data. Fixed by no longer awaiting `archive.finalize()`
   directly — `writeFinished` (the write stream's own `'close'` event,
   which already listens to the same `'error'` source) is the authoritative
   completion signal and reliably resolves/rejects regardless of when
   `abort()` fires. Full detail: Section 7b.
3. **The feature flag did not stop generation, only creation (P0).** The
   worker kept claiming and generating already-`queued` jobs even with
   `CLINIC_BULK_EXPORT_ENABLED=false` — the flag was a genuine creation gate
   but not a generation kill switch, and the rollback documentation
   (Section 15) incorrectly implied flipping it off was sufficient on its
   own to stop in-flight jobs "aging out" harmlessly. Fixed: the worker's
   claim function now re-checks `isClinicBulkExportEnabledForOrganization`
   per candidate before claiming, atomically failing an ineligible `queued`
   row as `FEATURE_DISABLED` instead; `generateClinicBulkExport` re-checks
   the same decision three more times (generation start, before the
   planned-key persist/upload, before the ready transition), funneling a
   mid-flight disable through the ordinary catch-block cleanup exactly like
   a lost lease — deleting any artifact already uploaded and never allowing
   the `ready` transition. A `failed`/`FEATURE_DISABLED` row is never
   resurrected merely by re-enabling the flag (the claim query only ever
   selects `status: 'queued'`). Decision, stated explicitly: disabling does
   **not** revoke an already-`ready` artifact or its download — the flag
   stops new artifact *creation*, consistent with how a kill switch is
   expected to behave; an existing download remains available until its
   normal TTL expiry either way. Full detail: Section 2, Section 15.
4. **Two P1 gaps.** (a) The epoch guard protecting async create/download
   responses (fourth-pass remediation, Section 13) did not extend to each
   handler's own `finally` block — a stale clinic-A request's `finally`
   could unconditionally clear `submitting`/`downloading` state that
   actually belonged to a newer, still-in-flight clinic-B request. Fixed by
   gating both `finally` blocks behind the same `isStillCurrentSelection`
   check; no additional per-operation request id was needed since the
   existing `{clinicId, epoch}` pair, combined with the pre-existing
   same-clinic double-submit guards (`if (submitting) return`/`if
   (downloading) return`), already fully covers the required invariant. (b)
   The cleanup cron ran its artifact-deletion retry query *before* its
   abandoned-lease sweep, so a process-crashed `generating` row (already
   carrying a planned `storageKey`) needed a full extra 15-minute cron tick
   before it was even eligible for deletion. Fixed by reordering to
   expire → sweep-abandoned → delete-artifacts within one call. Full
   detail: Section 11, Section 13.

### Updated test plan

- [x] `npx prisma validate` clean (no schema changes this round)
- [x] `npx prisma generate` clean
- [x] `npm run typecheck` (server) clean
- [x] Frontend `npx tsc -b` clean
- [x] Frontend `npm run build` clean
- [x] Focused suite: **93/93** (`npm run test:clinic-bulk-export`, +20 new
      tests: the private temp-dir/naming-pattern helpers, the temp/partial/
      final-file 0600 permission enforcement (real fs, POSIX-strict
      assertions skipped on win32 with an explicit note), the local stale-
      partial-file sweep (real fs), the ZIP structural-integrity validator
      against a real generated ZIP (accept/reject-mismatch/reject-truncated),
      the post-finalize check's source-level ordering, all three flag/
      allowlist generation-kill-switch re-check sites plus the queued-job
      fail-fast path, the cleanup reordering, the finally-block epoch guard,
      and the stale-temp-sweep's worker wiring)
- [x] `npm run test:roles` 142/142
- [x] `npm run test:kvkk-lifecycle` 110/110
- [x] `npm run test:patient-privacy` 38/38
- [x] `npm run test:msg-safety` 36/36
- [x] Full `npm test` (server, 40+ suites) — all green, exit 0
- [x] Frontend pure-logic suite: **24/24** (`npm run test:clinic-bulk-export-selection`,
      unchanged this round — the finally-block fix does not alter any
      pre-existing observable behavior these tests assert on)
- [x] Fresh disposable Postgres (Docker, throwaway container/DB): `prisma
      migrate deploy` (all 60 migrations applied cleanly) + `prisma migrate
      status` ("Database schema is up to date!", no drift)
- [x] `scripts/verify-clinic-bulk-export-lifecycle.ts` against that real
      disposable Postgres + real local file storage, **run twice** (once
      against a freshly-migrated DB, once again against the same DB with
      accumulated state from the first run) — **46/46 both times**,
      including new tests this round covering the real child-process
      hard-crash recovery, the
      process-local stale-temp sweep's age/status/lease gating (including a
      recognized-vs-unrecognized-filename regression guard), the
      self-calibrating post-finalize byte-ceiling proof, all five feature-
      flag generation-kill-switch scenarios, and the reordered one-pass
      cleanup proof (rewritten in place from the fourth-pass version, which
      required two cleanup ticks).
- [ ] CI checks (pending — no general CI workflow exists for this repo/branch)
- [ ] Production deployment + operational verification (still explicitly out
      of scope)

### Remaining risks

- No production/browser verification has been performed (unchanged from
  every prior round).
- The exact-`0600`-mode filesystem assertions are skipped on Windows in this
  round's test run (this development environment) — Windows synthesizes a
  file's reported `mode` from its read-only attribute only, so a strict
  `0600` assertion would be either meaningless or flaky there. The
  mode-setting code itself (`{ mode: 0o600, flags: 'wx' }` at every relevant
  `createWriteStream`/`chmod` call site) is unconditional and correct for
  the POSIX hosts this server actually deploys to; the skip is a test-
  verification limitation of this session's environment, not a gap in the
  production code path. A POSIX CI run or a manual Linux smoke test would
  close this gap.
- `sweepStaleClinicBulkExportTempFiles`'s default staleness threshold (twice
  the generation lease) is a judgment call, not something this remediation
  round load-tested against realistic worst-case generation durations —
  operators with very large exports should confirm this default comfortably
  exceeds their real generation time before relying on it.
- The `_clinicBulkExportCrashChild.ts` script added this round is test-only
  infrastructure (spawned exclusively by the verify script), not part of
  the 9 originally-targeted files — it exists because "add a real
  child-process crash test" structurally requires a real, separate,
  killable OS process running real generation code; it is documented here
  for full transparency about the file list this round actually touched.
- As in every prior round: this PR has now been through five remediation
  rounds, each finding real issues — including, this round, a genuine
  latent hang bug in code that predates this PR's own review history. Treat
  any "done" status as provisional until a human/security review signs off.

## 21. Remediation round (2026-07-17, sixth pass / final review)

A sixth review found two P0 gaps and two P1 gaps in the fifth-pass
remediation. All fixed on this same branch. Status remains **Implemented —
awaiting deployment/operational verification**; the feature flag remains
`false`, not merged, not deployed.

1. **Fail-closed private temp-directory verification (P0).** `ensureExportTempDir`
   called `mkdir` then swallowed `chmod` errors (`.catch(() => {})`) and never
   verified the fixed path was actually a real, safely-owned directory rather
   than a symlink or some other filesystem object — a symlink placed at
   `os.tmpdir()/diskliniks-export-tmp` (by another local process/user, or a
   stale leftover from a prior, differently-configured deployment) would have
   been silently `chmod`'d *through* to whatever it pointed at, and a failed
   `chmod` would have been ignored entirely, leaving generation to proceed
   against an unverified directory. Fixed with a fail-closed verification
   lifecycle in `fileStorage.ts`: `lstat` (never `stat`, so a symlink is
   inspected as itself, never silently followed) both BEFORE any
   `chmod`/`mkdir` and again on the final state; a symlink, any non-directory
   object, or (on POSIX, where `process.getuid()` exists) a directory owned by
   a different user is rejected outright — never "corrected" by chmod'ing
   through it; the `chmod` call is no longer swallowed (a failure now throws);
   and a new stable, internal-only `ExportTempStorageUnsafeError` (`code:
   'TEMP_STORAGE_UNSAFE'`) is thrown on any verification failure, logged only
   as the stable code (never the raw path or OS error), letting the failure
   funnel through `generateClinicBulkExport`'s existing catch-block cleanup —
   since the throw happens strictly before `tempFilePath` is ever assigned, no
   ZIP is created, no `storageKey` is ever persisted, and no upload is ever
   attempted. Proved with real `fs` operations (POSIX-strict where the
   assertion is platform-meaningful, explicitly skipped with a note on
   Windows): a freshly-created directory is mode `0700`; an existing safe
   directory is accepted unchanged; an existing `0777` directory is corrected
   back to `0700`; a test-only injected `chmod` failure (via a new
   `chmodForTest` DI seam, mirroring every other test-only override in this
   feature — never passed by any production call site) fails closed with
   `ExportTempStorageUnsafeError`; a pre-existing symbolic link at the fixed
   path is rejected; a pre-existing regular file at the fixed path is
   rejected. **Run for real inside a Linux Docker container** this round (see
   the updated test plan below) — the Windows skip in every prior round's
   test run was never treated as production evidence.
2. **Reload/shutdown did not stop in-flight generation (P0).** The feature
   flag is read from `process.env`, and during a PM2 rolling reload an OLD
   worker process retains its OLD in-memory environment — nothing before this
   round stopped that old process from finishing (or even resurrecting) an
   in-flight export well after a NEW process had already started with
   `CLINIC_BULK_EXPORT_ENABLED=false`. Fixed with worker-shutdown
   cancellation: `clinicBulkExportWorker.ts` now tracks every job id this
   process has actually claimed and is actively running
   `generateClinicBulkExport` for (`activeGenerationJobIds`, populated
   synchronously the instant a claim succeeds, before any further `await`, so
   there is no window a shutdown snapshot could miss). `stopClinicBulkExportWorker`
   — the exact function `process.once('SIGTERM'/'SIGINT', ...)` is bound to —
   now sets `shuttingDown`, stops the worker's own cron task (unchanged), and
   atomically fails every currently-tracked job id via a new
   `failActiveGenerationForWorkerShutdown(jobId)` (`clinicBulkExportPackage.ts`):
   a guarded `updateMany({ where: { id, status: 'generating' }, data: {
   status: 'failed', failureCode: 'WORKER_SHUTDOWN' } })`, followed by a
   durable audit event (`clinic_bulk_export_generation_failed`, metadata
   limited to `jobId`/`failureCode` — no patient data, no `storageKey`, no
   exception text). Guarded on `status: 'generating'` makes this naturally
   idempotent and safe across multiple worker replicas: a second call, a
   second replica, or the job's own in-flight failure handling racing to
   write a terminal status all affect zero rows once any one of them has
   already won — no double-write, no clobbering a different terminal code.
   `runTick` additionally re-checks `shuttingDown` immediately after
   `claimQueuedClinicBulkExportJobs` returns: if shutdown began while a claim
   was in flight, the newly-claimed (already-`generating`) rows are failed the
   identical way instead of ever being handed to `generateClinicBulkExport`.
   Deliberately does NOT duplicate artifact cleanup itself — the already-owned
   single cleanup path stays exactly where it already was: the in-flight
   `generateClinicBulkExport` call for a cancelled job observes the guarded
   status transition on its very next heartbeat/per-batch lease-renewal
   checkpoint (both already guarded on `status: 'generating'`, so they
   naturally start failing once shutdown wins the race), throws
   `ClinicBulkExportLeaseLostError`, and its own existing `catch` block deletes
   the temp file and any already-uploaded artifact exactly as it already did
   for every other lease-loss scenario. No runtime Platform Admin toggle was
   added (unchanged design decision, consistent with Section 2/14). Proved
   against a real disposable Postgres database with real generation: a job
   tracked via a new test-only `trackActiveGenerationJobForTest(jobId)` hook
   (bypasses only `node-cron`'s real minute-granularity schedule — everything
   else is production code) is started with the real `generateClinicBulkExport`,
   deterministically PAUSED at the existing `beforePlannedKeyPersistForTest`
   hook (fired strictly after the real temp ZIP is fully written/closed,
   strictly before the planned-key persist) until the test's own
   `stopClinicBulkExportWorker()` call — the same function bound to
   SIGTERM/SIGINT — has fully resolved, and only then released. This
   eliminates any timing ambiguity about which of two independently-guarded
   writers reaches Postgres first (an earlier draft of this test polled for
   the temp file to appear in real time and then raced a plain call to
   `stopClinicBulkExportWorker()` against the small fixture's own natural
   per-batch lease-renewal checkpoints — genuinely nondeterministic, since a
   small/fast fixture could let generation's own next checkpoint reach
   Postgres before the shutdown call did on some runs, is a fair race either
   way, and was corrected before this round's verification results below).
   Proves: the row ends `failed`/`WORKER_SHUTDOWN`, never `ready`; the real
   temp ZIP is actually gone from disk; no final artifact exists; a durable
   audit event with the `WORKER_SHUTDOWN` code was recorded (a second,
   pre-existing-pattern audit event with the in-flight generation's own
   locally-observed `LEASE_LOST` code is also expected and is not itself a
   bug — see the note below); and a subsequent re-claim attempt with the
   flag off (simulating exactly what a fresh process started after the
   reload would see) never resurrects the job, since the claim query only
   ever selects `status: 'queued'`.

   **Pre-existing, unchanged cosmetic note observed while building this
   test**: `generateClinicBulkExport`'s catch block always logs and audits
   its own LOCALLY-COMPUTED failure code, even when its own guarded DB
   update actually lost the race to a different writer (this predates this
   round — the same thing already happened for e.g. a lease genuinely stolen
   by another replica). The ARCHIVE ROW itself is never affected (the losing
   writer's guarded update is a real no-op), only an extra, harmless
   `AuditLog` row with a locally-accurate-but-not-what-actually-persisted
   `failureCode` can appear alongside the winning writer's own audit event.
   Not treated as a gap in this round (out of the narrow scope given), but
   worth a follow-up if audit-trail precision here ever matters operationally.
3. **A slow cross-device partial-file copy could be deleted mid-write (P1).**
   `cleanupStaleLocalExportPartialFiles` gated deletion on file age alone — a
   legitimately slow `EXDEV` cross-device copy (`saveFileFromPath`'s fallback
   path) could still be genuinely in progress past the fixed 30-minute
   threshold, and nothing stopped it from being deleted out from under the
   write. Fixed: the recognized `<jobId>.zip.partial-<uuid>` filename pattern
   (`EXPORT_PARTIAL_FILE_PATTERN`) now derives the job id, and before deleting
   any old candidate the function looks up the corresponding
   `ClinicBulkExportArchive` row — never deleting when `status === 'generating'`
   and `leaseExpiresAt > now`; treating a `clinicId`/directory mismatch as
   unconfirmed (skip); and, critically, treating a DB lookup failure as "cannot
   confirm inactive" and failing closed (skips deletion this run, never
   deletes on an unconfirmed guess) — mirroring the exact same DB-gated
   contract `sweepStaleClinicBulkExportTempFiles` already used for in-progress
   temp ZIPs (Section 7b). A new `findArchiveForTest` DI seam (never passed by
   the production cleanup job) lets the unit-test suite exercise every branch
   of this contract deterministically without a live database; a real
   disposable-Postgres test proves the same protect/allow behavior against an
   actual `ClinicBulkExportArchive` row.
4. **Cleanup observability could overstate what was actually deleted (P1).**
   Both `sweepStaleClinicBulkExportTempFiles` and (now)
   `cleanupStaleLocalExportPartialFiles` previously called
   `fs.promises.unlink(filePath).catch(() => {})` and incremented their
   `deleted` counter unconditionally, immediately after — a failed unlink
   (permissions, a concurrent process, a transient FS error) was silently
   swallowed AND counted as a successful deletion, so an operator reading the
   sweep's logged count could believe a file was gone when it was still on
   disk. Fixed in both functions: `unlink` is no longer swallowed at the point
   of counting — the counter is incremented only inside the same `try` block,
   strictly after `unlink` has itself resolved without throwing; a failure
   logs a stable message (`"...unlink failed"`, plus `safeErrorFields(err)` —
   never the raw path or full exception) and is NOT counted. The stale
   `clinicBulkExportWorker.ts` module-comment claiming
   `CLINIC_BULK_EXPORT_ENABLED` "only gates whether new jobs can be CREATED,
   not whether existing queued jobs get processed" — accurate when originally
   written, but contradicted by the fifth-pass remediation's generation
   kill-switch (Section 20, item 3) — was also corrected to describe the
   actual current per-candidate flag re-check and worker-shutdown cancellation
   behavior.

The two untracked local scratch files used to reproduce the `archiver`
`finalize()`/`abort()` hang investigated in the fifth-pass remediation
(`server/archiver_abort_repro.mjs`, `server/archiver_abort_repro2.mjs`) were
deleted — they were never tracked by git and were not part of any commit.

### Updated test plan

- [x] `npx prisma validate` clean (no schema changes this round)
- [x] `npx prisma generate` clean
- [x] `npm run typecheck` (server) clean
- [x] Frontend `npx tsc -b` clean
- [x] Frontend `npm run build` clean
- [x] Focused suite: **117/117** (`npm run test:clinic-bulk-export`, +24 new
      tests this round: fail-closed temp-directory verification (fresh
      dir/existing-safe/0777-correction/chmod-failure/symlink-rejection/
      regular-file-rejection/lstat-only-usage/funnels-through-existing-
      cleanup), DB-gated partial-file protection (fresh-file-never-touches-DB/
      old-file-deleted-once-confirmed-inactive/live-generating-protected/
      DB-failure-fails-closed/clinicId-mismatch-skipped/unrecognized-filename-
      never-touched/production-never-passes-the-DI-seam/counts-only-on-real-
      unlink), and worker-shutdown cancellation (guarded-status-transition-
      with-audit/no-duplicate-artifact-cleanup/idempotent-no-op-on-repeat/
      synchronous-tracking-before-generation/post-claim-shuttingDown-guard/
      idempotent-stopClinicBulkExportWorker/test-only-tracking-hook-never-
      used-by-production/sweep-observability-source-checks)
- [x] `npm run test:roles` 142/142
- [x] `npm run test:kvkk-lifecycle` 110/110
- [x] `npm run test:patient-privacy` 38/38
- [x] `npm run test:msg-safety` 36/36
- [x] Full `npm test` (server, 40+ suites) — all green, exit 0
- [x] Frontend pure-logic suite: **24/24** (`npm run test:clinic-bulk-export-selection`,
      unchanged this round — no frontend files touched)
- [x] **Linux Docker container** (not Windows): fresh `node:20` container
      (network-isolated from the host, a throwaway copy of the working tree,
      `npm ci` against Linux-native dependencies — never the Windows-installed
      `node_modules`), confirming the `0700`/`0600` permission assertions this
      round adds/relies on for real POSIX semantics rather than the
      Windows-skipped assertions every prior round's session recorded:
      **117/117** (`npm run test:clinic-bulk-export`), with every
      previously-Windows-skipped assertion (fresh-dir mode, 0777-correction,
      symlink-rejection, regular-file-rejection, 0600 temp/partial/final
      files) actually exercised and passing for real, not skipped.
- [x] Fresh disposable Postgres (Docker, throwaway container/DB, reached from
      inside the same Linux container over a dedicated Docker network):
      `prisma migrate deploy` (all 60 migrations applied cleanly to a
      brand-new, empty database) + `prisma migrate status` ("Database schema
      is up to date!", no drift)
- [x] `scripts/verify-clinic-bulk-export-lifecycle.ts` against that real
      disposable Postgres, **run twice** (once against the freshly-migrated
      DB, once again against the same DB with accumulated state from the
      first run) — **48/48 both times**, including 2 tests new this round:
      the real worker-shutdown cancellation proof (real generation,
      deterministically paused via the existing `beforePlannedKeyPersistForTest`
      hook so the real `stopClinicBulkExportWorker()` call is guaranteed to
      be the only writer that can ever change the row's status before
      generation is released to observe it, real cleanup, real
      re-claim-does-not-resurrect proof) and the real DB-gated
      active-partial-file-protection proof (a real `generating` row with an
      unexpired lease protects its old partial file; the same file is deleted
      once the row is no longer active). An earlier, real-time-polling
      version of the shutdown test was found to be genuinely racy against a
      small fixture's own natural per-batch lease-renewal checkpoint (a fair,
      two-sided DB race with no ordering guarantee) and was replaced with the
      deterministic pause described above before these numbers were recorded.
- [ ] CI checks (pending — no general CI workflow exists for this repo/branch)
- [ ] Production deployment + operational verification (still explicitly out
      of scope)

### Remaining risks

- No production/browser verification has been performed (unchanged from every
  prior round).
- Worker-shutdown cancellation relies on `stopClinicBulkExportWorker()` (bound
  to `process.once('SIGTERM'/'SIGINT', ...)` inside `clinicBulkExportWorker.ts`)
  actually being allowed to run to completion before the process exits. Both
  `server/src/index.ts` (single-process mode) and `server/src/worker.ts`
  (dedicated worker process) register their OWN, independent `SIGTERM`/`SIGINT`
  listeners that call `prisma.$disconnect()` and `process.exit(0)` — neither
  currently `await`s this feature's own shutdown listener before doing so. In
  practice Node runs all listeners for the same signal and the existing 10-second
  forced-exit timeout in both files gives real, if not formally guaranteed,
  headroom for a small number of in-flight cancellations to complete
  concurrently; this was not restructured into a single, explicitly sequenced
  shutdown chain in this round, since `index.ts`/`worker.ts` were outside this
  round's inspect-only file list. Operators relying on this cancellation for
  strict correctness during a rolling reload should confirm in their own
  deployment that shutdown-time DB writes reliably complete before the process
  actually exits, or file a follow-up to sequence the two shutdown paths
  explicitly.
- `cleanupStaleLocalExportPartialFiles`'s DB-gated protection (this round) uses
  the same "job id not found in the archive table = provably inactive" logic
  `sweepStaleClinicBulkExportTempFiles` already established (Section 7b/20) —
  intentional consistency, but worth a one-line note in code review since a
  row deleted from the table for any OTHER reason (there is currently no such
  code path, but none is structurally prevented either) would also be treated
  as safe-to-delete.
- As in every prior round: this PR has now been through six remediation
  rounds, each finding real issues. Treat any "done" status as provisional
  until a human/security review signs off.

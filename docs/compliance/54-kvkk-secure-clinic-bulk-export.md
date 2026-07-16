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
| `CLINIC_BULK_EXPORT_ENABLED` | unset = disabled | **fail-closed** (`=== 'true'` only) | Gates creation of new export jobs. Checked before password/confirmation parsing. |
| `CLINIC_BULK_EXPORT_CLEANUP_ENABLED` | unset = **enabled** (`!== 'false'`) | fail-open (cleanup keeps running) | Independent of the creation flag — expired artifacts/rows and abandoned jobs keep being swept even while creation is off. |
| `CLINIC_BULK_EXPORT_IP_HASH_SECRET` | **required when `CLINIC_BULK_EXPORT_ENABLED=true`** | fail-closed | Dedicated HMAC key for hashing client IPs in the brute-force lockout table. Never reused from `JWT_SECRET`/`ENCRYPTION_KEY`/webhook secrets. |

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

**Brute-force lockout is PostgreSQL-authoritative**
(`server/src/services/privacy/clinicBulkExportPasswordAttempts.ts`), not
Redis. Every check-and-increment for a given `(userId, clinicId, ipHash)` key
is serialized with `pg_advisory_xact_lock` (same key-derivation shape as
`appointmentRequestSafety.ts`), acquired **before** reading or creating the
`ClinicBulkExportPasswordAttempt` row — this is what makes the
"row-doesn't-exist-yet" race safe. Redis (`createRateLimiter`) is used only
as an optional fast pre-check that can skip a redundant `bcrypt.compare`
call; it never changes the outcome and Postgres is always the final
arbiter. IPs are stored only as an HMAC-SHA256 hash. Rows untouched for >30
days are deleted by the cleanup job.

**Fresh step-up window**: the archive row's `stepUpVerifiedAt` is set at
creation. Issuing the download token accepts either a freshly supplied
password (re-verified) or, if `now - stepUpVerifiedAt < 5 minutes`
(server-clock only, never a client-supplied timestamp), no password. The
frontend always prompts for a password before download regardless, but the
backend implements and tests both paths.

## 5. Rate limiting and concurrency

- **Creation cooldown** (per user+clinic) and **daily cap** (per clinic) are
  enforced in PostgreSQL, from `ClinicBulkExportArchive` history, inside the
  same advisory-locked reservation transaction described next. Redis is not
  used for these — only the password-attempt pre-check uses Redis, and only
  as a non-authoritative optimization.
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
  survives user deactivation/deletion), `status` (`queued | generating |
  ready | failed | expired`, default `queued`), `purpose, restrictedNote,
  exportSchemaVersion, storageKey, manifestJson, downloadTokenHash` (unique),
  `stepUpVerifiedAt, expiresAt, downloadedAt, artifactDeletedAt,
  cleanupFailureCode, heartbeatAt, leaseExpiresAt, failureCode, createdAt,
  updatedAt`. Indexes on `[organizationId, clinicId]`, `[clinicId, status]`,
  `[requestedByUserId, createdAt]`, `[expiresAt]`, `[leaseExpiresAt]`,
  `[clinicId, status, leaseExpiresAt]`, plus the raw-SQL partial unique index
  above.
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
permanently blocks a clinic.

**Graceful shutdown**: the specific `ScheduledTask` handle for *this*
worker's cron is retained and only that task is stopped on
`SIGTERM`/`SIGINT` — not every cron task in the process (which would also
kill unrelated jobs like reminders/meta-sync). In-flight claimed jobs are
left to finish within the process's normal shutdown grace period; if that
deadline is hit anyway, the lease-expiry sweep on the next surviving
replica's tick picks the row back up.

**Generation** streams a ZIP (`archiver`, piped to a temp file — never a
Buffer) containing `manifest.json`, `clinic.json`, and one `*.ndjson` file
per entity (`users`, `patients`, `appointments`, `treatment-cases`,
`payments`, `tasks`, `sent-messages`, `activity-logs`,
`insurance-provisions`, `inventory-items`), each written via Prisma
cursor pagination (batch size 500) as a lazily-pulled Node `Readable`, so no
table and no whole archive is ever fully materialized in memory. Lease
heartbeat is renewed periodically during generation.

`CLINIC_BULK_EXPORT_MAX_RECORDS` (default 500,000) and
`CLINIC_BULK_EXPORT_MAX_BYTES` (default 2 GB) are enforced while streaming.
On breach, generation stops immediately, the failure code
`SIZE_LIMIT_EXCEEDED` is recorded, and — critically — **no manifest or
storageKey is ever persisted for a failed job**: temp/partial files are
always deleted (in every failure path, including S3 multipart abort via
`leavePartsOnError: false`), so there is never a misleading "complete"
artifact reachable from a failed job.

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
  `download_completed`/`download_failed` are recorded separately depending
  on whether the stream finished, errored, or the client disconnected before
  the stream ended. Response headers: `Cache-Control: no-store`, `Pragma:
  no-cache`, `X-Content-Type-Options: nosniff`.

## 11. Cleanup lifecycle

`server/src/jobs/clinicBulkExportCleanupJob.ts`, gated by
`CLINIC_BULK_EXPORT_CLEANUP_ENABLED` (default on), `withJobLock`-guarded
singleton cron every 15 minutes. Each run:

1. Calls `expireArchiveIfPastTtl` across all `ready` rows past `expiresAt` —
   the exact same function request-time routes use, so there is one
   definition of "expired," not two.
2. For every `expired` row still holding a non-null `storageKey`, attempts
   storage deletion. **This is a separate, non-atomic, retryable step** —
   a Postgres transaction cannot span an S3/local filesystem delete. On
   success, `storageKey` is cleared and `artifactDeletedAt` is set. On
   failure, `storageKey` is **preserved** (never nulled) and
   `cleanupFailureCode: 'STORAGE_DELETE_FAILED'` is set so the next run
   retries — deletion is never silently abandoned, and the row's `status`
   stays `expired` throughout (only the storage-related fields change across
   retries).
3. Sweeps abandoned `queued`/`generating` rows past their lease to `failed`
   — a backstop; the worker's own per-tick sweep normally does this first.
4. Deletes `ClinicBulkExportPasswordAttempt` rows untouched for >30 days.
5. Continues past individual row failures; logs only stable
   identifiers/codes, never raw paths or payloads.

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
legacy route).

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
When the backend reports the feature disabled (via a dedicated,
OWNER/ORG_ADMIN-authorized `GET .../bulk-export/config` endpoint that
returns only `{enabled}`), no active button is shown — only a localized
explanation. When enabled: purpose selection → password → explicit
confirmation checkbox → submit (disabled while pending, preventing duplicate
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
- [ ] Migration `20260716120000_add_clinic_bulk_export` applied to
      production; `prisma migrate status` shows no drift; the partial
      unique index confirmed present via `\d "ClinicBulkExportArchive"` (or
      equivalent) in production.
- [ ] At least one end-to-end production run performed: create → poll →
      ready → download → cleanup, with the resulting archive row and
      storage object inspected directly.
- [ ] Only then: flip `CLINIC_BULK_EXPORT_ENABLED=true` for a pilot
      organization first, not globally.
- [ ] Legal/compliance sign-off on the `purpose` codes and the
      structured-data-only scope statement, independent of this PR.

Until every box above is checked, this control remains **Implemented —
awaiting deployment/operational verification**, not Completed, per Section 7
of `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`.

## 15. Rollback strategy

- **Flag rollback (no deploy needed for a stuck-open flag)**: set
  `CLINIC_BULK_EXPORT_ENABLED=false` and restart — immediately blocks new
  job creation. In-flight `queued`/`generating` jobs simply age out via the
  existing lease-expiry sweep (no manual intervention needed) or can be
  manually set to `failed` if immediate halt is required.
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

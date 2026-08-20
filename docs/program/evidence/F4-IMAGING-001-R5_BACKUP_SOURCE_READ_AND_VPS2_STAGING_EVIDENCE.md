# F4-IMAGING-001-R5 — Backup source-read correction (Finding A) + real VPS2 staging evidence

**Task:** `F4-IMAGING-001-R5-VPS2-REAL-HOST-CONTINUATION`
**Phase:** F4 — Object storage / backup / imaging storage foundation
**ClickUp:** EPIC F4 `869ed1jn7` · F4-IMAGING-001 `869em3zqg` · GlitchTip/provider `869ej62mf`
**PR:** #459 (`feature/f4-imaging-001-vps2-storage-foundation`), still `DRAFT`, still not merged, not deployed, not production-verified.
**Date:** 2026-08-20.

This record continues the R3 entry in `docs/program/NORAMEDI_MASTER_TRACKER.md`. It does not
supersede or reopen any other lane. No VPS1/production access was used, requested, or
required. No real patient/DICOM/CBCT data, no production DB dump, and no production backup
was touched at any point. Every byte written to VPS2 in this session was synthetic random
data.

---

## 1. Finding A — ACCEPTED MERGE BLOCKER — now CLOSED

### The defect, restated from the code

`server/src/services/fileBackupService.ts` enumerates three source content classes
(`PatientAttachment`, `LabOrderAttachment`, `ImagingImage`) and, for every one of them,
opened the source bytes through the single generic primitive:

```ts
const sourceStream = await openFileStream(row.filePath);
if (!sourceStream) {
  filesMissing++;
  // ... FileBackupEntry { status: 'missing_source' }
}
```

`ImagingImage` enumeration was already correctly routed through the Imaging domain's own
platform contract (`imaging/ops.ts`'s `listImagesForBackup`) — the enumeration side was
never the problem. The **read** side was. Once an operator sets
`IMAGING_STORAGE_BACKEND=vps2`, newly ingested imaging objects are written *only* to VPS2
object storage (`fileStorage.ts`'s `saveImagingFile`, which deliberately never mirrors to
legacy). A generic `openFileStream()` on such a key resolves `null`, so the sweep recorded a
perfectly healthy remote object as `missing_source` and never backed it up.

Two things made this worse than a simple miss:

1. `missing_source` is not a neutral label. It asserts *"this file does not exist"*, and it is
   the status an operator would act on during a recovery investigation.
2. It applies to imaging — the content class with by far the largest objects, and the one
   this entire F4 lane exists to move to VPS2.

### The correction

The source reader is now selected per content class, on the existing `SOURCE_MODELS` table:

```ts
const SOURCE_MODELS: Array<{
  name: SourceModelName;
  domain: SourceDomain;
  rows: (batchSize: number) => AsyncGenerator<SourceRow>;
  openSource: (ref: string) => Promise<Readable | null>;
}> = [
  { name: 'PatientAttachment',  domain: 'attachments',     rows: …, openSource: openFileStream },
  { name: 'LabOrderAttachment', domain: 'lab-attachments', rows: …, openSource: openFileStream },
  { name: 'ImagingImage',       domain: 'imaging',         rows: …, openSource: openImagingFileStream },
];
```

and the single call site became `await cfg.openSource(row.filePath)`.

This is deliberately a **re-use, not a re-implementation**:

- `openImagingFileStream()` is the same VPS2-aware imaging read contract that
  `routes/imaging.ts` already serves imaging bytes from — no remote-client logic is
  duplicated into the backup service.
- The Imaging domain boundary is not bypassed: enumeration still goes through
  `imaging/ops.ts`, and no direct Prisma access was added.
- No new dependency edge was created — `fileBackupService.ts` already imported
  `openFileStream` from `fileStorage.js`; `openImagingFileStream` is the neighbouring
  export in that same module.

Inheriting that one contract gives the sweep all three required semantics with **no branch of
its own**:

| Situation | Behavior | Recorded as |
|---|---|---|
| Remote object exists | backup reads the remote bytes | `verified` |
| Remote **confirmed absent** (404/`NoSuchKey`) + legacy object present | controlled fallback to legacy | `verified` (legacy bytes) |
| Remote **error** (outage / auth / network — "can't tell") | the call throws | `failed` — never `missing_source`, never a silent legacy substitution |
| `IMAGING_STORAGE_BACKEND` unset (production default today) | delegates straight to `openFileStream` | byte-identical to before this change |

### Evidence that the tests actually detect the defect

A negative control was run: the call site alone was reverted to the pre-fix
`openFileStream(row.filePath)`, leaving the new tests untouched, and the Layer 4 suite was
re-run against real disposable PostgreSQL + MinIO.

| Run | Result |
|---|---|
| With the fix | `fileBackupDbIntegration: 37 passed, 0 failed` |
| Pre-fix call site restored (negative control) | `fileBackupDbIntegration: 30 passed, 7 failed` |

7 of the 12 added cases fail without the fix, and the suite is green with it. The fix was
then restored and re-verified. Tests that pass in *both* states are the deliberate
unchanged-behavior guards (legacy mode, legacy fallback, and the two attachment classes) —
they are supposed to hold before and after.

### The 12 added cases

All live in `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` (CI Layer 4 —
disposable PostgreSQL + disposable MinIO). The VPS2 side is simulated by the same disposable
MinIO the suite already uses, in a **separate bucket** with separate credentials, because an
imaging-primary store and a backup destination are different concerns that must not share
either. All payloads are `crypto.randomBytes(...)`.

| # | Case | Result |
|---|---|---|
| — | MinIO imaging bucket creation (separate from the backup destination bucket) | PASS |
| 1 | Legacy-mode `ImagingImage` still backs up and verifies (flag unset) | PASS |
| 2 | **VPS2-only object** (bytes exist only in remote storage) backs up successfully | PASS |
| 3 | Destination checksum verifies; both source and destination sha256 equal the synthetic bytes | PASS |
| 4 | Never recorded as `missing_source` (the exact pre-fix defect) | PASS |
| 5 | Remote confirmed absent + legacy present → controlled legacy fallback, legacy bytes backed up | PASS |
| 6 | Remote **error** → `failed`, **not** `missing_source`, and **not** silently satisfied from the legacy object that does exist at that key | PASS |
| 7 | `PatientAttachment` unaffected (succeeds while the imaging backend is broken) | PASS |
| 8 | `LabOrderAttachment` unaffected (succeeds while the imaging backend is broken) | PASS |
| 9 | Already-backed skip unchanged — second VPS2-mode run creates no duplicate entry | PASS |
| 10 | Destination key shape unchanged: `file-backups/imaging/<clinicId>/<recordId>.bin` | PASS |
| 11 | Tenant/clinic scope unchanged — a VPS2-only object in a different org/clinic backs up under its own clinic scope, with that tenant's own bytes | PASS |

Case 6 is constructed so that a legacy object **does** exist at the key. A `verified` result
there would prove a silent legacy fallback on an unavailable remote, which the contract
forbids; the test asserts against `verified` and `missing_source` explicitly, not just for
`failed`.

Cases 7 and 8 run inside the same broken-remote window, so they simultaneously prove the two
attachment classes are unaffected *and* that neither was accidentally routed through the
imaging reader.

**Storage-key contract: UNCHANGED.** `<clinicId>/<opaqueId><ext>`, still built by
`buildObjectStorageKey({kind: 'imaging-image', …})`. No new key template, no rewrite of
persisted keys, no migration.

**`FINDING_A = CLOSED`.**

---

## 2. Finding B — ACCEPTED PRODUCTION ACTIVATION BLOCKER — still OPEN, by design

Re-verified against the schema this session. `model ImagingImage`
(`server/prisma/schema.prisma`) has: `id, clinicId, studyId, fileName, originalName,
fileSize, mimeType, filePath, sopInstanceUid, createdAt, storageVerifiedMissingAt`.

**There is no per-object storage placement discriminator.** `filePath` records the key, not
which backend holds it.

Consequence, unchanged: after the first VPS2-only write, flipping
`IMAGING_STORAGE_BACKEND=vps2` back to unset makes those objects unreadable, because nothing
records that they live remotely. This was deliberately **not** papered over with a silent
legacy fallback — a fallback that guessed would create untracked split-brain placement.

**Minimal solution designed, deliberately NOT implemented in #459.** The smallest correct
shape is a nullable placement column on `ImagingImage` (e.g. `storageBackend String?`, unset
= legacy, `'vps2'` = written to VPS2), populated on the write path at ingest and consulted on
the read path in place of the current flag-only branch. That is a **schema migration plus a
write-path and read-path change**, which is not the "small additive, fully tested" change the
task authorized bolting onto this PR. Expanding #459 to carry a migration would also make the
merge decision materially riskier for no gain, since the flag is off.

`POST_FIRST_REMOTE_WRITE_SIMPLE_FLAG_ROLLBACK_SAFE = NO`.
`PRODUCTION_ACTIVATION_SAFE = NO` — and it must stay `NO` until Finding B is resolved in its
own accepted task.

---

## 3. Findings C / D / E — all three fixed, all three tested

Each was small, isolated, clearly correct, and testable, so each was fixed rather than
deferred. None required touching the accepted R3 behavior.

### Finding C — configuration validated lazily instead of at boot

`validateImagingS3Config()` was reachable only from `getImagingS3()`, i.e. on the first
imaging request that actually constructed a client. An operator who activated
`IMAGING_STORAGE_BACKEND=vps2` with a missing bucket or endpoint therefore got a process that
started up looking healthy and only failed hours later, at request time, with imaging
silently unavailable in between.

Now also called from the existing **"Startup validation"** block in `server/src/index.ts`,
following that file's own `ENCRYPTION_KEY` precedent verbatim: fatal in production
(`process.exit(1)`), warn otherwise so local/dev work is not blocked. It returns immediately
unless the flag is explicitly set to `vps2`, so with the flag unset — today's production
default — **this is a no-op and startup behavior is unchanged**.

Tests (`imagingRemoteStorage.test.ts` §8): the import and call exist; the call precedes
`listen()`; and the block distinguishes production (exit) from non-production (warn).

### Finding D — a bare catch destroyed the imaging outage signal

`imaging/public.ts`'s `checkImageStorageExists()` used `} catch { throw new
ImagingStorageUnavailableError(); }`. The bare `catch` never bound the provider error at all,
so a VPS2 timeout, DNS failure, 403, or TLS error was destroyed at the boundary. Nothing
downstream — including error tracking — could tell a VPS2 outage apart from any other
unavailability.

The sanitized error type is correct and stays. The provider error is now preserved as
`cause`. Error trackers walk `cause` chains, so the outage becomes visible **without** adding
logging to a domain module that deliberately has none, and without widening what crosses the
boundary: the raw error is reachable only via the standard `cause` link, never the message,
never the storage key.

Test (`imagingLifecycleFacade.test.ts`, CI Layer 3): asserts `err.cause` is the original
provider error, while `name`, `code`, and `message` stay sanitized and the storage key is
still absent from the message. The pre-existing sanitization test was left in place, not
weakened.

### Finding E — the opened stream leaked when the audit write rejected

`routes/imaging.ts`'s `streamStudyImage()` opens the imaging stream, then `await`s
`auditImaging(...)` before piping. If that await rejected, the handler's outer `catch`
returned 500 and **nothing ever consumed or destroyed the already-open stream**. Under legacy
storage that leaked a file handle; under VPS2 mode it leaks a live S3 response socket from
the SDK's connection pool, so a failing audit path could progressively exhaust sockets and
take imaging reads down entirely.

The audit await is now wrapped so a rejection destroys the stream before propagating. The
audit failure itself is **not** swallowed — imaging bytes stay audited-or-refused, never
served unaudited.

Test (`imaging.test.ts`): structural assertion consistent with that suite's other
route-source checks — it verifies the stream is opened before the audit (the precondition for
the finding), that a `catch (auditErr)` destroys the stream, and that `auditErr` still
propagates. Exercising the reject path for real needs an HTTP request against a live DB with
a failing audit backend, which that DB-free suite cannot do; this is stated rather than
overclaimed.

---

## 4. Wave 7 — R3 configuration security re-verified, not weakened

Re-read at the exact PR head (`243fa88`), not at the stale primary worktree:

- `IMAGING_S3_ENDPOINT` is **required** whenever the backend is `vps2`, in **every**
  environment — `validateImagingS3Config()` calls `resolveImagingS3Endpoint()`
  unconditionally, before the production-only branch.
- The client is constructed with `endpoint:` passed **unconditionally**. The previous
  conditional spread was the exact mechanism by which a missing endpoint silently became the
  SDK's default public AWS endpoint. That path no longer exists.
- Absolute-URL and `http`/`https`-only scheme validation, production HTTPS requirement,
  `IMAGING_S3_ALLOW_INSECURE_ENDPOINT` override semantics, missing bucket, missing/typo'd
  backend name (fail closed in every environment), and SSE/KMS behavior all still hold.

All 23 of the backend-selection and fail-closed-validation cases in
`imagingRemoteStorage.test.ts` (sections 1, 2, 2b) pass. Nothing in R3's accepted behavior was
relaxed.

**Runtime corruption detection remains `NOT_IMPLEMENTED`. The production checksum integrity
gate remains `OPEN`.** Neither was in scope here and neither is claimed.

---

## 5. Real VPS2 host inventory (read-only, this session)

| | |
|---|---|
| Hostname | `vps-1281461-23217` |
| OS / kernel | Ubuntu 24.04.4 LTS · `6.8.0-138-generic` |
| CPU / RAM / swap | 4 vCPU · 7.8 GiB · 1.9 GiB (`/swap.img`, unused) |
| Time | `Europe/Istanbul (+03)`, NTP active, clock synchronized |
| Failed systemd units | 0 |
| Docker | Server 29.7.2 · Compose v5.5.0 |
| Docker state at intake | **zero** containers, **zero** volumes, **zero** custom networks |
| UFW at intake | `active`, default **deny incoming**, `22/tcp` only (v4+v6) |
| Listeners at intake | `sshd` on `0.0.0.0:22`; `systemd-resolved` and `chronyd` on loopback only. Nothing else. |
| Service accounts | `pgbackrest` (111), `noramedi-imaging` (112), `noramedi-glitchtip` (999) — all present |

### Block devices — the decisive finding

```
NAME    SIZE TYPE FSTYPE  MOUNTPOINTS
sda     150G disk
├─sda1    1M part
└─sda2  150G part ext4    /            (148G, 8.5G used, 133G avail)
```

`/etc/crypttab` is empty. `/etc/fstab` references only `/dev/sda2` and the swap file.
`cryptsetup 2.7.0` is installed, but **there is nothing safe to encrypt**.

**`IMAGING_VOLUME = BLOCKED_PROVIDER_VOLUME_NOT_PRESENT`.** IHS has not attached an
additional block device. Per the task's explicit instruction, the root partition was **not**
repartitioned or shrunk, and **no loopback file was created and dressed up as a "production
encrypted volume"**. This blocker was recorded and every other lane continued.

Consequence: everything staged on VPS2 this session sits on an **unencrypted** root ext4
partition. That is why the object store is classified
`STORAGE_MODE = SYNTHETIC_STAGING_ONLY` and its data path is explicitly labelled.

---

## 6. Lane results

Detailed per-lane evidence (image digests, exact command output, permission modes, and
complete rollback procedures) is recorded in the R5 tracker entry. Summary:

- **Object storage (MinIO):** running, pinned image + digest, dedicated compose project and
  bridge network, dedicated credentials, healthcheck, `restart: unless-stopped`, native TLS
  1.3 from an internal private CA, API and console published to **loopback only**. Bucket
  `noramedi-imaging` with a least-privilege bucket-scoped service credential and a
  prefix-scoped per-tenant credential. **All 11 required synthetic tests pass**, including
  sha256 round-trip equality, invalid-key/invalid-secret rejection, out-of-policy denial, and
  a cross-tenant negative case verified in both directions (denied for the other tenant,
  still permitted for its own prefix, with the target object proven to have survived).
  Honest caveats: no encryption at rest (no separate device), no SSE (no KMS/KES on this
  host — so `imagingRemoteStorage.ts` would refuse to start in production mode regardless),
  and the private CA is **not trusted by any client yet**.

- **pgBackRest repo2 + synthetic PostgreSQL:** **`pgBackRest 2.50`** installed on VPS2
  (`2.50-1build2`, Ubuntu noble). **`VERSION_SKEW = NONE`** — Ubuntu 24.04 ships exactly the
  2.50 that production VPS1 runs, so the `--repo=2` behavior that previously blocked
  `R-030-DB` work is identical on both hosts and no PGDG pin is needed. Recommend
  `apt-mark hold pgbackrest` on VPS2 so a routine `apt upgrade` cannot silently desync it
  (not applied — package policy is outside that lane's mandate).

  repo2 delivered at `/var/lib/pgbackrest/repo2` (`0750 pgbackrest:pgbackrest`), config at
  `/etc/pgbackrest/pgbackrest.conf` (`0640 root:pgbackrest`), `repo2-cipher-type=aes-256-cbc`,
  `REPO2_CIPHER_PASS = CONFIGURED` (rotated after the rehearsal, against an emptied repo, so
  the delivered key never protected synthetic data). Retention `repo2-retention-full=2` /
  `repo2-retention-diff=6`, count-based deliberately — time-based retention on a shared disk
  lets an archiving stall grow the repo silently.

  Synthetic rehearsal on a disposable `postgres:16.14-bookworm` (5,000 synthetic rows,
  loopback-only ports): `stanza-create`, `check`, full `backup`, and `info` all exit 0;
  restore into a **separate** disposable cluster started cleanly and its content hash was
  **byte-identical** (`8d7ff14c6155d3614ab4845d43481511` before and after, an ORDER BY-stable
  md5 over every column of all 5,000 rows). PITR also passed against a live control: restoring
  to a sub-second target left the marker row present, the 1,000 later rows absent, and the
  untouched primary still holding them — proving divergence at the target rather than a failed
  replay. Repository encryption was proven four independent ways, including that a wrong
  cipher pass cannot read the repo (`ERROR [075]`) and that `grep` finds **zero** occurrences
  of the synthetic row labels anywhere in the repository.

  `SYNTHETIC_BACKUP = PASS`, `SYNTHETIC_RESTORE = PASS`, `SYNTHETIC_PITR = PASS`. **None of
  this is production PITR verification** and it is not described as such. The rehearsal used a
  local `posix` repo2, so it crossed no network — the pinned-fingerprint SFTP transport shape
  remains unexercised on 2.50, exactly as it was before.

  Production integration is documented but **not executed** — `PRODUCTION_ACCESS_REQUIRED`.
  Three findings that will bite that activation and are recorded now rather than discovered
  later: (1) `archive_command` must **not** carry `--repo` — `archive-push` writes to all
  repos and rejects the flag on 2.50 (`ERROR [031]`); (2) consequently, **adding repo2 makes
  production WAL archiving depend on repo2 availability** — a repo2 outage fails
  `archive_command` on VPS1 and grows `pg_wal` until PGDATA fills, and
  `archive-push-queue-max` is currently **unset** in production, so it must be sized from
  `df -B1 $PGDATA` before activation; (3) never derive a `recovery_target_time` from a
  second-truncated timestamp — PostgreSQL stops before the first commit *after* the target, so
  a marker committed mid-second is itself excluded.

- **GlitchTip:** stack healthy on pinned images, loopback-only web, PostgreSQL and Redis/Valkey
  **not published at all**, synthetic event proven ingested in both the database and the API.
  `PRODUCTION_INGESTION = NOT_CONNECTED`.

  **Upstream finding worth the program owner's attention:** in GlitchTip 6.2.6, registration
  and organization creation are open *regardless* of `ENABLE_USER_REGISTRATION` /
  `ENABLE_ORGANIZATION_CREATION` while the instance has **zero users** — the code reads
  `settings.ENABLE_USER_REGISTRATION or not await User.objects.aexists()`. This was proven at
  runtime: on the freshly-migrated instance an unauthenticated signup succeeded and that
  account then created an admin organization, with both switches off. Once a user exists,
  signup returns 403 and organization creation returns 403, verified by state (user count
  unchanged), and it survives a full restart. **This cannot be closed by configuration.** The
  mitigation is procedural: the first superuser must exist before the port is reachable by
  anyone.

  Also found: `scrubIPAddresses` does not do what its name implies — it anonymizes only the
  server-observed connection IP, and only when routable, so an SDK-supplied
  `user.ip_address` is stored verbatim behind a proxy. PII scrubbing is **off by default**;
  a probe confirmed that with defaults, authorization headers, session cookies, and
  synthetic special-category health fields landed verbatim in PostgreSQL. Explicit scrub
  configuration was applied and re-proven.

- **Two pre-existing host risks surfaced but deliberately NOT changed** (they sit inside the
  SSH/human-access boundary this task was instructed not to touch, so they are reported for a
  program-owner decision): (1) global sshd is `PermitRootLogin yes` **and**
  `PasswordAuthentication yes` from `50-cloud-init.conf`, with port 22 open to the world —
  the largest residual risk on this host; (2) `/var/lib/pgbackrest/.ssh` is `0755 root:root`
  rather than `0700 pgbackrest:pgbackrest`, which will make repo2 key installation fragile.
  Neither was modified. `sshd -t` validates and the config checksums are recorded in the
  tracker entry.

- **Firewall / listeners:** UFW was **not modified by any lane** and is byte-identical to its
  intake state — `active`, default deny incoming, `22/tcp` only. Every service staged this
  session binds to `127.0.0.1` or is docker-internal. No PostgreSQL, Redis/Valkey, MinIO
  console, or admin surface is publicly reachable. Because everything is loopback-only, **no
  firewall change was needed and none was made** — SSH access was never put at risk.

---

## 7. What this session explicitly did NOT do

- No merge, no deploy, no production configuration change.
- `IMAGING_STORAGE_BACKEND` was not changed anywhere outside disposable test processes.
- No VPS1 access; no production DB, PM2, nginx, Redis, or production backup was touched.
- No real patient data, DICOM, CBCT, attachments, or production dumps — synthetic only.
- No SSH policy change: root SSH, password authentication, and user `faruk`'s access all
  remain exactly as they were, by instruction.
- No LUKS, no repartitioning, no fake "production volume".

---

## 8. Status

| Gate | Value |
|---|---|
| `FINDING_A` | `CLOSED` |
| `FINDING_B` | `OPEN` — production activation blocker, minimal solution designed, deliberately not implemented here |
| `FINDINGS_C_D_E` | `FIXED` and tested |
| `RUNTIME_CORRUPTION_DETECTION` | `NOT_IMPLEMENTED` (unchanged, not in scope) |
| `PRODUCTION_CHECKSUM_INTEGRITY_GATE` | `OPEN` (unchanged, not in scope) |
| `IMAGING_VOLUME` | `BLOCKED_PROVIDER_VOLUME_NOT_PRESENT` |
| `STORAGE_MODE` | `SYNTHETIC_STAGING_ONLY` |
| `PRODUCTION_INGESTION` (GlitchTip) | `NOT_CONNECTED` |
| `PRODUCTION_REPO2_STATUS` | `PRODUCTION_ACCESS_REQUIRED` |
| `MERGE_SAFE` | `YES` — conditional on exact-head CI staying green; the flag remains off |
| `DEPLOY_SAFE` | `NO` — not authorized by this task |
| `PRODUCTION_ACTIVATION_SAFE` | **`NO`** — Finding B, plus no encryption at rest, no SSE, no client CA trust, and no network path from the app host |

The provider/DPA gate is **unchanged**: E1/E2/E4/E5 and I1–I5 remain unmet and are not
technically obtainable from the VPS. No real health data may reach VPS2 before they land.

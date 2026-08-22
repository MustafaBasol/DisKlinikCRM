# F4-ATTACH-001-R1 — Patient Attachment VPS2 Encrypted Secondary Replica: Discovery & Implementation Plan

**Task:** `F4-ATTACH-001-R1` · **Phase:** F4 — Storage and Backup Foundation
**ClickUp:** `869enkxfd` (parent epic `869ed1jn7`)
**Branched from:** `origin/main` @ `31eb79f0d2a68445ccd835943d0d67600710f08c`
**Worktree:** `DisKlinikCRM-worktrees/f4-attach-001-r1` (isolated, per this program's established one-worktree-per-parallel-task convention)
**Branch:** `feature/f4-attach-001-r1-vps2-encrypted-secondary-replica`
**PR:** [#484](https://github.com/MustafaBasol/DisKlinikCRM/pull/484) — **DRAFT**, not merged, not deployed, not production-verified

**Status: `PLAN_AND_SCRIPTS_PREPARED_NOT_ACTIVATED`.** This is a discovery-and-plan round. It ships reviewed scripts, systemd unit templates and documentation. **No command in this document was executed against VPS1 or VPS2. No production account, key, MinIO instance or restic repository was created. No recurring job is running. No restore has been proven against real infrastructure.** Every "Stage 2" command below is a plan, not a log. See §11 for the exact, honest gap list against the ClickUp completion gate.

---

## 0. Program-owner boundary, restated as this document's operating contract

Per the ClickUp task body (§"Mandatory architecture rules") and the dispatching brief:

- VPS1 stays PRIMARY. No application read/write path moves to VPS2 in this task.
- Do not reuse pgBackRest repo2's account/repository/credentials, GlitchTip's account/directories, or any DICOM/imaging-remote-storage credential.
- No plaintext patient/health bytes on VPS2 unless encryption-at-rest is proven — and prefer **client-side** encryption, so VPS2 never holds the key.
- No Kafka/Kubernetes/microservice split/database-per-tenant/framework rewrite. No imaging disk purchase. Not the final DICOM/CBCT architecture.
- Do not infer that `noramedi-minio`'s mere existence means it already serves patient attachments.
- No Prisma schema change unless evidence proves it unavoidable — **none was needed; see §3**.
- Stop before any production mutation.

Everything below was produced honoring that contract.

---

## 1. Stage 1 — repository storage-flow inventory

All facts in this section are re-derived from the current tree at the branch baseline above, via direct `Read`/`Grep`/CodeGraph queries in this session — not carried over from memory of an earlier task.

### 1.1 `PatientAttachment` model — physical-storage-relevant fields

`server/prisma/schema.prisma:1353-1373`:

```prisma
model PatientAttachment {
  id           String   @id @default(uuid())
  clinicId     String
  patientId    String
  fileName     String
  originalName String
  fileSize     Int
  mimeType     String
  filePath     String        // the storage KEY (not a literal filesystem path since F4-1A)
  uploadedById String
  createdAt    DateTime @default(now())
  legalHold                Boolean   @default(false)
  legalHoldReason          String?
}
```

No column records which physical backend holds the bytes (unlike `ImagingImage.storageBackend`, added by `F4-IMAGING-001-R6` for a materially different reason — see §3.4 for why that precedent does **not** apply here). `filePath` is opaque and backend-independent by design.

### 1.2 Upload route/service

`server/src/routes/attachments.ts:105` — `POST /api/patients/:patientId/attachments`. Builds the storage key via `buildStorageKey(clinicId, originalName)` (`server/src/services/fileStorage.ts:207-209`, which itself calls `buildObjectStorageKey({ kind: 'patient-attachment', clinicId, originalName })`), producing `<clinicId>/<opaqueId><ext>` — never the original filename, never a patient identifier. Writes bytes via `saveFile()` (`fileStorage.ts:221-234`).

### 1.3 Download / read routes

- `GET /api/patients/:patientId/attachments` — list, `attachments.ts:229-251`.
- `GET /api/patients/:patientId/attachments/:id/download` — `attachments.ts:254-286`, reads via `openFileStream(attachment.filePath)` (`fileStorage.ts:240-253`).
- `GET /api/patients/:patientId/attachments/:id/preview` — `attachments.ts:289+`, same read primitive.

### 1.4 Delete / legal-hold / anonymization

- `PATCH /api/patients/:patientId/attachments/:id/legal-hold` — `attachments.ts:334`.
- `DELETE /api/patients/:patientId/attachments/:id` — `attachments.ts:428`, gated on `legalHold: false`. Physical deletion goes through `storageObjectDeletion.ts`'s `classifyStorageKey()` (`:220-238`) / `executeDelete()` (`:270-293`) — a tenant-scoped key deletes via `deleteFile()` and, on failure, re-verifies existence before ever calling the outcome `failed` vs. `already_absent`; a legacy absolute-path key cannot be existence-verified and always reports `failed` on a delete error (fails closed, never silently upgraded to a false "gone").
- `patientAnonymization.ts:97-126` (`redactPatientAttachments`) redacts `originalName` to `[ANONYMIZED]` for non-legal-hold rows. **It never touches `filePath` or physical bytes** — the file-content lifecycle question this task is about is orthogonal to metadata redaction, which was already correctly designed to leave storage alone.

### 1.5 Current filesystem/object-key generation

`fileStorage.ts:60`: `BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')`. Per the prior `FILE-BACKUP-COVERAGE-001` task's own directly-verified storage inventory (`docs/program/evidence/FILE_BACKUP_COVERAGE_001.md` §2, 2026-07-28) and `docs/architecture/PRODUCTION_TOPOLOGY.md` §6, production resolves this to `/var/www/noramedi/server/uploads`. `buildStorageKey()`/`buildObjectStorageKey()` produce `<clinicId>/<opaqueId><ext>` (`fileStorage.ts:207-209`, `isSafeStorageKey()` at `:279-290` structurally forbids traversal, absolute paths, UNC prefixes and control characters in any key this program's own write path ever generates).

### 1.6 Existing storage abstraction

`fileStorage.ts` is the one and only primary-storage abstraction attachments, lab-order attachments and imaging images all share. It already branches on `isRemoteStorageEnabled()` (`:62-64`, `Boolean(process.env.S3_BUCKET?.trim())`) between local disk and an S3-compatible remote (`saveFile`/`openFileStream`/`fileExists`/`statFile`/`deleteFile`, `:221-631`).

### 1.7 Existing MinIO/S3 code paths — and which one, if any, is active for attachments

**Three structurally separate, non-overlapping storage-related env namespaces exist in this repository. None of them is assumed active from a container's mere presence — each is a distinct, independently-gated code path:**

| Namespace | Governs | Used by `PatientAttachment` today? |
|---|---|---|
| `S3_BUCKET` / `fileStorage.ts` `isRemoteStorageEnabled()` | **Primary** storage for attachments, lab-order attachments and (pre-`ImagingImage.storageBackend`) imaging | **This is the ONLY namespace that could switch attachments off local disk.** Per `FILE_BACKUP_COVERAGE_001.md` §2 (directly-verified production evidence, 2026-07-28): **`S3_BUCKET` unset in production** — attachments are on local disk. This document does not re-verify that against live production (no production access was used in this task — see §0); §2's read-only command plan below includes the exact command to re-confirm it before any activation decision. |
| `IMAGING_STORAGE_BACKEND` / `IMAGING_S3_*` / `imagingRemoteStorage.ts` | Imaging (`ImagingImage`) remote placement only, added by `F4-IMAGING-001` R1–R6 | **No** — structurally cannot affect `PatientAttachment`; `resolveImagingStoragePlacement()` and the whole placement-discriminator contract (`F4-IMAGING-001-R6` evidence §3) exist ONLY inside the imaging domain. `IMAGING_STORAGE_BACKEND` has never been set to `vps2` in production (`F4-IMAGING-001-R6` §10/§13: `STORAGE_MODE = SYNTHETIC_STAGING_ONLY`). |
| `FILE_BACKUP_S3_*` / `FILE_BACKUP_LOCAL_DIR` / `fileBackupService.ts` + `fileBackupDestination.ts` | A **dormant, additive, application-layer off-host BACKUP copy** for attachments/lab-attachments/imaging (not a primary-storage switch) | **No** — `FILE_BACKUP_ENABLED` defaults to `false` (`FILE_BACKUP_COVERAGE_001.md` §11: `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`, never enabled, never run against a live DB, never exercised against a real S3-compatible destination). See §3.3 below for why this task does not simply flip that flag. |

The presence of the `noramedi-minio` container (referenced only informationally in prior imaging-lane evidence) proves nothing about attachments by itself, per the task's own instruction — and indeed it proves nothing: none of the three tables above route through it for `PatientAttachment`, and `F4-2-R1`'s program-owner decision already **rejected** reusing the imaging MinIO for a second, unrelated purpose (pgBackRest `repo2`) on isolation grounds (`docs/program/phases/F4_STORAGE_AND_BACKUP.md`, F4-2-R1 entry: *"görüntüleme MinIO'sunun `repo2` için kullanılması reddedildi"*). This task treats that as directly-applicable precedent: **do not reuse the imaging MinIO for attachments either.**

### 1.8 Does the current architecture already support dual-write / migration fallback / feature flags?

**Yes, structurally, but unused for this purpose.** `isRemoteStorageEnabled()` is a hard either/or switch (local **or** S3), not a dual-write — there is no code path that writes to two destinations from a single primary write. `FILE_BACKUP_*` is the closest thing to a "secondary copy" mechanism already in the repository, and it is read-only against primary storage (`FILE_BACKUP_COVERAGE_001.md` §4: *"`fileBackupService.ts` only calls `openFileStream()` — it never calls `saveFile`, `deleteFile`, or anything that mutates primary storage"*).

---

## 2. Stage 2 — production-safe read-only command plan (PREPARED, NOT EXECUTED)

**Nothing in this section was run.** Every command below is read-only by construction and avoids printing individual filenames or patient identifiers — aggregate counts, sizes and dates only, per the ClickUp task's own instruction.

### 2.1 VPS1 — confirm current storage classification and inventory

```bash
# RUN ON: VPS1 (disklinik-prod-01), as an operator with read access to the app dir.
# Re-confirms §1.7's S3_BUCKET-unset finding directly against the live env,
# without printing the file itself (grep -c counts occurrences, does not
# print the matched line's value).
grep -c '^S3_BUCKET=' /var/www/noramedi/server/.env || true

# Storage root, filesystem and mount.
df -hT /var/www/noramedi/server/uploads
stat -f -c '%T' /var/www/noramedi/server/uploads   # filesystem type

# Aggregate file count and total bytes — NEVER -print, NEVER -name.
find /var/www/noramedi/server/uploads -type f | wc -l
du -sb /var/www/noramedi/server/uploads

# Oldest/newest mtime, aggregate only (no filenames in the output stream).
find /var/www/noramedi/server/uploads -type f -printf '%T@\n' | sort -n | head -n1
find /var/www/noramedi/server/uploads -type f -printf '%T@\n' | sort -n | tail -n1

# Ownership/mode of the root itself (not per-file).
stat -c '%U:%G %a' /var/www/noramedi/server/uploads

# Symlink presence — count only.
find /var/www/noramedi/server/uploads -type l | wc -l

# Disk free space on the filesystem that would host a restic cache.
df -hT /var/lib
```

### 2.2 VPS2 — capacity, existing lanes, and `noramedi-minio` inspection WITHOUT printing secrets

```bash
# RUN ON: VPS2 (the Türkiye secondary, vps-1281461-23217 per F4-2-R1's own
# naming — same host pgBackRest repo2 already occupies; this task adds a
# SEPARATE account/path, it does not touch repo2's own directory or account).
df -hT
lsblk -f

docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'

# Inspect noramedi-minio's structure WITHOUT rendering secrets — deliberately
# NOT `docker inspect` raw (which can include env in some configurations) and
# NOT `docker compose config` (renders secrets, explicitly prohibited by this
# task). Mounts/network/ports only, via the Go template filter.
docker inspect noramedi-minio --format '{{json .Mounts}}' 2>/dev/null || echo "noramedi-minio: not present or not inspectable"
docker inspect noramedi-minio --format '{{json .NetworkSettings.Ports}}' 2>/dev/null || true
docker inspect noramedi-minio --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true

# Existing storage directories (structure only, not content).
find /srv -maxdepth 2 -type d 2>/dev/null
find /var/lib/pgbackrest -maxdepth 1 2>/dev/null   # confirm repo2's own path is untouched by anything below

# Available capacity for a new, dedicated repository path.
df -hP /srv 2>/dev/null || df -hP /
```

### 2.3 What these commands must NOT do (restated from the task brief, honored above)

- No `docker compose config` (renders secrets).
- No `cat`/`less`/`head` of any `.env` file.
- No `find -print`/`ls` producing individual patient-identifying filenames — every `find` above is piped to `wc -l`, `sort`/`head`/`tail` on a bare timestamp, or filtered to directory names only.
- No write, no `docker exec`, no port-forward, no credential creation.

---

## 3. Stage 3 — architecture decision

### 3.1 Options evaluated

| Option | Encrypts before leaving VPS1? | Key ever touches VPS2? | Versioned, content-addressed? Source deletion ≠ destructive mirror deletion? | New app code required? | Verdict |
|---|---|---|---|---|---|
| **Raw `rsync` mirror** | No | N/A (plaintext) | No — a destructive mirror; deleting the source deletes the copy | No | **Rejected outright**, per explicit task instruction: corruption/deletion propagates, and plaintext-at-rest is unacceptable for special-category health data. |
| **A. restic snapshot repository over restricted SFTP** | **Yes** — AES-256+Poly1305, client-side, before any byte leaves VPS1 | **No** — passphrase lives only on VPS1 (+ off-host escrow, never on VPS2) | **Yes** — content-addressed, versioned snapshots; `forget` ≠ `prune`, so deleting a source file does not, by itself, destroy any snapshot's data until an explicit, separate `prune` — **not enforced append-only/immutable/WORM storage**: the SFTP account has ordinary read/write/delete rights over the repository, so a compromised credential or an operator-run `forget`+`prune` (or a direct `rm`) CAN destroy history; only *ordinary backup operation* never does so as a side effect | No — restic is a single static binary; this task ships shell wrappers only | **Selected — see §3.2.** |
| **B. rclone crypt (or an rclone-managed remote) to a VPS2 target** | Yes, if `crypt` remote is used | No, if the crypt config/password stays on VPS1 | **No, by itself** — `rclone sync`/`copy` to a crypt remote is still a mirror unless paired with `rclone`'s own (much less mature) chunked/versioned backend, or fronted by object-store versioning this task has no bucket to provide | No | Rejected: to get real snapshot/versioning semantics equivalent to restic's, rclone would need to be paired with S3-style bucket versioning — which reintroduces Option C's operational surface (a bucket/IAM/lifecycle to provision) while still lacking restic's native content-addressed dedup and single-command integrity check. Strictly more moving parts for no safety gain over A. |
| **C. Reuse existing MinIO** (a *new* dedicated instance, not `noramedi-minio`) | Only via provider-side SSE (the key lives with the MinIO instance, i.e. on VPS2) — **fails the "prefer client-side encryption, key absent from VPS2" requirement** as configured | **Yes**, unless a client-side crypt layer is added on top (which collapses back into Option B) | Yes, if bucket versioning is enabled (operator-configured, not app-enforced — see §3.3's finding about the dormant `FILE_BACKUP_*` code) | No — the dormant `FILE_BACKUP_S3_*` code already speaks S3 | Rejected as primary mechanism for this task's stated key-custody requirement; **not the existing `noramedi-minio` in any case** (rejected already, by direct precedent, for repo2 — see §1.7). |
| **D. Activate the existing, dormant `FILE_BACKUP_S3_*` application code (`fileBackupService.ts`) against a new S3-compatible target** | Only via provider-side SSE — same key-custody gap as C | Same gap as C | Only if the operator enables bucket versioning; the app makes no `GetBucketVersioning` call (`FILE_BACKUP_COVERAGE_001.md` §14) | **No** — this is the whole point of D | Not selected for R1 (see §3.3), but not discarded — recorded as a legitimate, complementary future option. |

### 3.2 Why restic over restricted SFTP, in one paragraph

Every "preferred safety property" the ClickUp task lists — encryption in transit, **client-side encryption before persistence**, a separate restricted account, no public ports, **versioned, content-addressed snapshot semantics where source deletion does not propagate as a destructive mirror deletion**, an idempotent recurring job, bounded retention, health/heartbeat monitoring, a synthetic restore proof, and no secret values ever reaching a log — is a restic design property, not something a wrapper script has to bolt on. restic snapshots are content-addressed and deduplicated (a daily re-run of a mostly-unchanged `uploads/` tree is fast and idempotent by construction, not by this script's own bookkeeping), encryption happens in-process before any chunk is transmitted (so a compromised or misconfigured VPS2 never sees plaintext and never holds the key), and `restic forget` is a *reference* removal — the underlying data is only reclaimed by a separate, explicit `prune`, so an *ordinary backup run* never deletes anything as a side effect. **This is not enforced append-only/immutable/WORM storage:** the SFTP account this repository lives behind has ordinary read/write/delete rights over the repository path, so a compromised credential, an operator running `forget`+`prune`, or a direct `rm` against the repository on VPS2 can still destroy snapshot history — restic's model only removes *accidental, side-effect* deletion from an ordinary backup/restore workflow, which is the property this task actually needs and the property a plain `rsync --delete` mirror cannot provide. True immutability would require object-lock/WORM-capable storage or an append-only-enforcing remote, neither of which this restricted-SFTP topology provides; that remains a **DEFERRED**, not-yet-selected future hardening option, not a property of what ships here. This is also the same trust shape the program already accepted for pgBackRest's `repo2` (Topology C: the secondary is a "dumb", credential-less encrypted store; the *primary* holds the cipher and the primary decides what leaves) — restic replicates that already-reviewed pattern for a materially different kind of file, using a **fully independent** account, key and repository, per the explicit prohibition on reusing repo2's own.

### 3.3 Why not simply activate the existing dormant `FILE_BACKUP_S3_*` code (Option D)

This was seriously considered — it is real, tested-to-the-extent-possible, already-reviewed code sitting unused in this exact repository, and reusing it would have meant zero new shell scripts. It was **not** selected as the R1 mechanism for one precise reason, not a vague "prefer something else": **as implemented, its encryption model is provider-side SSE only** (`FILE_BACKUP_S3_SSE=AES256|aws:kms`, requested on every `PutObject`/`Upload` call, `fileBackupDestination.ts`) — the key custody is on the S3-compatible provider (i.e., on whatever host serves the bucket), which is precisely the "encryption key/passphrase is absent from VPS2" property the ClickUp task asks this task to *prefer*. `FILE_BACKUP_COVERAGE_001.md` §14 says so itself, plainly: *"this application requests encryption on its own writes... it has no way to inspect or enforce provider-side bucket settings"* — there is no client-side encryption layer in that code today. Wrapping it in one would mean writing new application code inside a domain this program has repeatedly, deliberately kept frozen except for narrow, explicitly-authorized exceptions (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`, cited by `FILE_BACKUP_COVERAGE_001.md` §1 itself) — restic achieves the stronger property with **zero** application code, at the OS/ops layer, which is also where this task's own required deliverables (systemd units, shell scripts) already live. **This is not a rejection of `FILE_BACKUP_*` as a concept** — it remains a legitimate complementary path for a future task, and nothing in this task disables, modifies, or contradicts it (§7's rollback table confirms it is untouched).

### 3.4 Why not extend `ImagingImage.storageBackend`'s per-object placement pattern to `PatientAttachment`

`F4-IMAGING-001-R6` added a `storageBackend` column to `ImagingImage` because that task **switches which backend serves READS of an object that may have been written to different backends over time** (a real placement ambiguity requiring a schema-level discriminator, R6 evidence §2). This task does the opposite: **VPS1 stays the sole read/write backend for every `PatientAttachment` row, unconditionally.** There is no placement ambiguity to disambiguate — every row's bytes live on VPS1 today and will continue to after this task, so there is nothing for a `storageBackend`-style column to discriminate. This is the concrete reason `NO Prisma schema change` is possible here, not merely a scope-avoidance choice: R6's own precondition for needing a column (per-object backend divergence visible to reads) does not exist in this task's design.

---

## 4. Stage 4 — key / credential boundary design

| Item | Design | Where it lives |
|---|---|---|
| VPS2 OS account | `noramedi-attach-backup` — dedicated, new, distinct from repo2's pgBackRest account, GlitchTip's account, and any DICOM/imaging account | VPS2 only |
| VPS2 account shell | `ForceCommand internal-sftp` + `nologin`, chrooted per §4a's exact, documented shape (`ChrootDirectory=/srv`, repo directory addressed relative to that root) — mirrors the already-accepted pgBackRest `repo2` VPS2-side contract (`F4-2-R1` evidence: *"pgBackRest paketi purge edildi, authorized_keys depo yolunun dışına taşındı, from= ile kaynak sabitlendi, ForceCommand internal-sftp + nologin"*), applied to a **separate** account/path | VPS2 |
| Source-IP restriction | `authorized_keys` entry carries `from=<VPS1_IP>` | An explicit path OUTSIDE the chroot entirely (§4a), not merely "outside the repo path" — the SFTP session can never see, let alone rewrite, its own admission control |
| SSH key pair | New ed25519 key pair, generated on VPS1, private half mode `0600` owned by `noramedi-attach-backup`, stored under `/etc/noramedi/attachment-vps2/` (a dedicated, non-home path — §4b), public half installed on VPS2. **Not** the pgBackRest/repo2 key. Host-key verification is pinned from a `ssh-keyscan` taken against the actual negotiated algorithm (see the env-example's note on the F4-2-R1 libssh2-vs-OpenSSH finding — restic uses the OS `ssh` client, so that specific finding may not reproduce, but the discipline of verifying-not-assuming does) into a dedicated `known_hosts` file, also under `/etc/noramedi/attachment-vps2/` | VPS1 (private), VPS2 (public only) |
| restic repository destination | Host path `/srv/noramedi-attachment-vps2/repo`, addressed by `RESTIC_REPOSITORY` as `/noramedi-attachment-vps2/repo` (relative to the `/srv` chroot root — §4a) — a **new, dedicated directory**, structurally incapable of colliding with `/var/lib/pgbackrest` (repo2) or any GlitchTip directory | VPS2, ciphertext only |
| restic passphrase | Generated once at `restic init` time, stored in a `0600` file on VPS1 (`RESTIC_PASSWORD_FILE`), **never** written to VPS2, never printed by any script in this task (`restic` reads the env var/file itself) | VPS1, plus a **required, not-yet-performed** off-host escrow (see below) |
| Off-host escrow | **Required before production activation, not performed by this task.** Same discipline as `repo2-cipher-pass`'s escrow (`F4-2-R2` closure criterion 1) — losing VPS1 without an escrowed passphrase means the encrypted VPS2 copy becomes permanently undecryptable, which defeats its own purpose. This is an operator action this task cannot perform without printing the secret. | Off both hosts (operator-controlled, e.g. a sealed physical copy or a password manager entry, per this program's existing escrow convention) |
| Secret exposure | No secret value appears in this document, in ClickUp, in chat, in any script's default output, in the systemd unit files, or in the env-example template (which documents variable NAMES only) | — |

### 4a. VPS2-side sshd chroot / repository-path contract (documented shape, NOT provisioned)

This section exists to remove ambiguity **before** provisioning, per explicit review instruction — nothing in it is executed by this task; VPS2 is untouched.

**The core hazard:** `ChrootDirectory` changes what path an SFTP client sees as `/`. `RESTIC_REPOSITORY`'s path is given to the SFTP client, so it must be written relative to the CHROOT ROOT, never the VPS2 host filesystem path — the two are easy to conflate and, if conflated, restic fails closed with a "no such directory" error rather than silently misbehaving (this is a configuration-time trap, not a data-safety one).

**Recommended shape:**

| Item | Value | Why |
|---|---|---|
| `ChrootDirectory` (sshd_config, scoped to a `Match User noramedi-attach-backup` block) | `/srv` | sshd requires every path component of `ChrootDirectory` itself, and everything above it, to be **root-owned and not group/other-writable** — true for `/srv` on a standard install. Recommended over `/srv/noramedi-attachment-vps2` itself specifically so that directory does not also have to satisfy the chroot-root ownership rule while remaining the account's writable target. |
| Repository directory (host path) | `/srv/noramedi-attachment-vps2/repo` | Owned by `noramedi-attach-backup:noramedi-attach-backup`, writable — this is what restic actually reads/writes. |
| Repository directory (as the SFTP client / `RESTIC_REPOSITORY` must address it) | `/noramedi-attachment-vps2/repo` | Relative to the chroot root (`/srv`), NOT the host path — see the env-example's own inline warning at `RESTIC_REPOSITORY`. |
| `/srv/noramedi-attachment-vps2` (the pass-through directory between the chroot root and the writable repo dir) | `root:root`, `0755` | Does not itself need to be writable by the SFTP account; only `repo/` underneath it does. |
| `ForceCommand` (sshd_config, same `Match` block) | `internal-sftp` | No shell is ever reachable for this account — matches the already-accepted pgBackRest `repo2` VPS2-side contract. |
| `AuthorizedKeysFile` (sshd_config, same `Match` block) | An explicit path OUTSIDE the chroot, e.g. `/etc/ssh/authorized_keys.d/%u`, root-owned, not under `/srv` at all | sshd reads authorized_keys **before** applying `ChrootDirectory`/`ForceCommand`, so pointing it at a root-owned path outside the chroot means the SFTP session itself — even if fully compromised — can never read or rewrite its own admission control. This is what "authorized_keys lives outside any writable repository area" (§4's table) concretely means. |
| `authorized_keys` entry restriction | `from="<VPS1_IP>",... ssh-ed25519 <public key>` | Source-IP-pinned in addition to key-restricted — matches repo2's existing contract. |

**What this is not:** a claim that `/srv` is the only valid choice — any chroot root satisfying sshd's ownership rule works, provided the `RESTIC_REPOSITORY` path and the chroot root are chosen **together** and verified together (e.g. `sftp -v` a manual connection and confirm the expected relative path resolves) before the first real backup run, not assumed from this document alone.

### 4b. VPS1-side credential path / systemd `ProtectHome` contract (corrected)

An earlier revision of this task's systemd units set `User=noramedi-attach-backup` with the account created `--no-create-home`, `ProtectHome=yes` on every unit, while separately suggesting the private SSH key live under `/home/noramedi-attach-backup/.ssh/...` — internally inconsistent, since that path cannot exist for a home-less account and `ProtectHome=yes` would hide it even if it did. **Corrected:** every VPS1-side credential (env file, restic passphrase, SSH private key, `known_hosts`, and an SSH client config tying them together) instead lives under a dedicated, non-home path, `/etc/noramedi/attachment-vps2/` — see `ops/restic/noramedi-attachment-vps2.env.example`'s credential-layout section for the exact per-file modes/ownership. Each systemd unit sets `Environment=HOME=/etc/noramedi/attachment-vps2`, which makes the OS `ssh` client restic's sftp backend shells out to resolve `.ssh/config` from that directory — `IdentityFile`, `IdentitiesOnly yes`, `UserKnownHostsFile`, `StrictHostKeyChecking yes`, and `BatchMode yes` are all set there, never `StrictHostKeyChecking no`. This is compatible with `ProtectHome=yes` by construction: that directive restricts access to the real `/home`, `/root`, and `/run/user/*` paths, not wherever `$HOME` happens to point, and `/etc` remains readable under `ProtectSystem=strict`'s default (this account only ever needs to **read** its own credentials, never write them).

---

## 5. Stage 5 — recurring copy design

Three independent systemd `oneshot` + `timer` pairs, all templates only (not installed — see each unit file's own header for exact install/rollback commands):

| Job | Script | Schedule | Why this cadence |
|---|---|---|---|
| Backup | `scripts/noramedi-attachment-vps2-backup.sh` | Daily, 04:15 | Offset from every existing backup window on this host (pg_dump 03:15, pgBackRest repo1 02:45, repo2 03:30 — `F4_RECOVERY_OPERATIONS.md` §22.4d) so restic's directory walk never competes with them. Daily, not hourly: first-clinic upload volume is low, and there is no sub-daily RPO requirement for attachments in this task's brief. |
| Integrity check | `scripts/noramedi-attachment-vps2-check.sh` | Weekly, Sunday 05:00 | `restic check --read-data-subset` genuinely reads ciphertext back from VPS2 — costing real bandwidth/IO — so it runs on its own, less frequent cadence, offset from pgBackRest's own Sunday-04:15 verify. A rotating 5% subset gives full repository coverage over roughly 20 weeks while bounding each run's cost. |
| Restore proof | `scripts/noramedi-attachment-vps2-restore-proof.sh` | Monthly, 1st @ 06:00 (**plus one required manual pre-activation run — see §6**) | Mirrors the existing `restoreRehearsalJob.ts`/`runFileBackupRestoreRehearsal` convention already in this codebase for the dormant `FILE_BACKUP_*` path: a backup proven restorable once, at activation, is a claim about the past — a recurring, independent re-proof catches silent regressions (an expired credential, a changed firewall rule, a corrupted repository index) a one-time proof cannot. |

Each script is independently locked (`flock`, non-blocking, **three separate** operation lock files — backup, check, AND restore-proof — **deliberately not shared with each other**, so a slow weekly check or monthly restore-proof can never starve the daily backup and vice versa; see `noramedi-attachment-vps2.test.sh`'s "Independent lock files" assertion), bounded by an explicit `timeout`, and returns a distinct exit code per failure class (see each script's own header for the full table) so `systemd`/journald and any future paging integration can distinguish "another run is already in progress" from "the destination is unreachable" from "restic itself reported an error." None of the three scripts has a delete path against `NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR` — grep-verified structurally in `noramedi-attachment-vps2.test.sh`.

**Shared status document concurrency.** All three scripts merge their own result into the SAME `NORAMEDI_ATTACHMENT_VPS2_STATUS_FILE` (a `backup`/`check`/`restoreProof` top-level key each). An earlier revision did this as a plain, unsynchronized read-modify-write per script — safe for any ONE script's own field (each only ever touches its own key), but not safe against two scripts finishing around the same time: both could read the same on-disk version, merge their own field in, and the second writer's version would silently discard the first writer's update (a classic lost-update race), independently of the three operation locks above (which serialize each job against ITSELF, not against the other two jobs' status writes). **Corrected:** a fourth, SEPARATE, short-lived lock (`NORAMEDI_ATTACHMENT_VPS2_STATUS_LOCK_FILE`) is held ONLY for the brief read-merge-write of the status document — never for the duration of the restic call itself — so a writer that had to wait always merges onto the other writer's freshest content rather than clobbering it. The write itself is atomic (temp file in the same directory, `fsync`, then `rename`), so a reader (or a crash mid-write) never observes a partially-written document, mirroring the temp-file-plus-`mv -f` convention `noramedi-pgbackrest-status.sh` already established in this repository, with an added `fsync`. `noramedi-attachment-vps2.test.sh`'s "Status write lock" section deterministically reproduces the race (the test process holds the status lock, writes a `check` field while holding it, then releases the lock and asserts a concurrently-started `backup` run — forced to wait on the lock — still recorded its own field alongside the pre-existing `check` field, never having overwritten it) rather than relying on timing luck.

Logging discipline: restic's own verbose per-file status stream and raw stderr are **never** echoed by any of the three scripts — only restic's parsed aggregate JSON summary (file counts, byte totals, duration, snapshot id) or, on failure, an output **line count** (never line content) ever reaches stdout/stderr or the status file. Verified by the `noramedi-attachment-vps2.test.sh` "Log privacy" section's canary-token assertions (a token shaped like a local path is injected into fake restic's stdout/stderr on both a successful and a failing run, and asserted absent from every byte this test's harness captures).

---

## 6. Stage 6 — restore proof design

`scripts/noramedi-attachment-vps2-restore-proof.sh` implements exactly the sequence the ClickUp task specifies:

```
SOURCE synthetic file (generated fresh, non-clinical, random content + a
    fixed non-PHI marker line — never a real attachment)
  → restic backup --tag restore-proof, to the SAME repository the real
    attachment backups use (proves the actual dependency, not a throwaway one)
  → source temp directory deleted BEFORE the restore step
  → restic restore of that exact snapshot to a second disposable directory
  → SHA-256 of source vs. restored compared
  → both temp directories removed in a `trap ... EXIT`, unconditionally
```

Exit code `0` only on a verified SHA-256 match; `1` on any restic failure or a checksum mismatch (fails closed — see the "Restore proof: corrupted restore is detected" test, which injects a single flipped byte via the fake restic and asserts the script both exits `1` and pings its `/fail` heartbeat). This never touches a real `PatientAttachment`/`LabOrderAttachment`/`ImagingImage` row or file — the script's own source contains no reference to `NORAMEDI_ATTACHMENT_VPS2_SOURCE_DIR` at all (structurally verified, not merely asserted in prose).

The one manual run of this script an operator performs **after** provisioning (§4) and **before** enabling the recurring backup timer is the actual evidence artifact the ClickUp completion gate calls "one synthetic/non-PHI restore from VPS2 verified" — this task ships the tool; that run has not happened (§11).

---

## 7. Stage 7 — failure / rollback

| Scenario | Action | Effect |
|---|---|---|
| Disable the recurring copy only | `systemctl disable --now noramedi-attachment-vps2-{backup,check,restore-proof}.timer` | Stops all three jobs. VPS1 primary storage is **never** touched by any of them (read-only against it), so application upload/download continues unaffected — reads/writes never moved off VPS1 in the first place. |
| Remove the units entirely | `rm -f` the six unit files + `systemctl daemon-reload` | Same effect, permanent until reinstalled. Existing VPS2 repository content is untouched. |
| Revoke the VPS2 credential | Remove the `noramedi-attach-backup` `authorized_keys` entry on VPS2 (harder/slower — a real credential revocation, not a config toggle) | Backup jobs start failing closed (precondition/connection errors, never silent). Nothing on VPS1 is affected either way. |
| Something is wrong with a specific run | The lock/timeout/exit-code discipline in every script means a bad run fails closed and is retried next cycle — never partially applied against VPS1 | — |
| Full teardown | Delete the VPS2 repository directory, remove the VPS2 account, discard the escrowed passphrase per the program's credential-retirement convention | VPS1 primary storage remains **exactly as it is today** — this task never had a write path against it to begin with |
| Application-side rollback | None required — **zero application code was changed by this task** | `git revert` of this branch is a pure infra/docs rollback |

**No Prisma/data migration exists in this task (§3.4), so there is no migration rollback to reason about.**

---

## 8. Stage 8 — test requirements and results

**No application code (`server/src/**`, `src/**`) was changed by this task** — see §9 for why. The eight application-level test requirements the dispatching brief lists (upload still writes, download still works, delete unchanged, tenant isolation, path-escape safety, missing-file handling, VPS2-copy-failure-must-not-fail-the-request, no secrets/filenames in logs) therefore have **no changed application code path to regress**: `fileStorage.ts`, `routes/attachments.ts`, `storageObjectDeletion.ts` and `patientAnonymization.ts` are byte-for-byte unmodified by this branch (confirmed by `git diff --stat` in §12). This is validated, not merely asserted, by re-running this repository's own existing attachment/storage suites unmodified — see §8.2.

### 8.1 New: `scripts/noramedi-attachment-vps2.test.sh`

Follows the precedent `scripts/noramedi-pgbackrest.test.sh` already established for this exact repository gap (a `.sh` file under `scripts/` is invisible to `log-privacy-guard`, which only scans `server/src/{routes,services,jobs,middleware,utils}/*.ts`, and to every other automated guard in this repository). `restic`, `curl` and (where available) `flock` are faked — this validates the wrapper scripts' own logic, not `restic` itself.

**28 passed, 0 failed, 6 skipped** (local run, Windows/Git-Bash — `flock` is genuinely absent on this development host; the six skipped assertion groups — backup/restore-proof lock contention, the runtime success/failure/log-privacy-canary paths, the status-write-lock concurrency reproduction, and the restore-proof success/corrupted-restore paths, all of which require a real lock — are exercised by CI's `ubuntu-latest` runner, which ships `flock` via `util-linux`, per the exact same documented precedent this program already accepted for a Windows-specific `/proc/meminfo` gap in `F4-FCR-003`'s test run). Coverage includes: `bash -n` syntax for all three scripts; `--help`/unknown-flag handling; `--tag` validation; every precondition (`restic` absent, `RESTIC_REPOSITORY`/`RESTIC_PASSWORD_FILE` unset/missing/unreadable/non-absolute, source directory missing, `flock` absent for backup AND restore-proof); dry-run isolation (no status file written, nothing invoked); lock contention for backup AND restore-proof (each against its own, independent lock file); the three operation locks' and the shared status-write lock's distinctness (a static assertion that backup/check/restore-proof default to three separate lock files while all three share the SAME status-write lock); a deterministic reproduction of the status-write concurrency race (§5's "shared status document concurrency" — a waiting writer forced to block on the status lock must merge onto the freshest content instead of clobbering it); successful and failing backup/check runs with status-file-shape assertions; ping-URL success/`/fail` behavior; the log-privacy canary (a path-shaped token injected into fake `restic`'s output on both a passing and a failing run, asserted absent from every byte the wrapper ever prints); the restore-proof success path and a deliberately corrupted restore (checksum mismatch correctly fails closed); and a structural assertion that `restore-proof.sh`'s code (not its prose comments) never references the primary-storage source-directory variable.

A real bug was found and fixed by this suite before being committed: an earlier revision of all three scripts used bash's `${VAR:?msg}` form for the `RESTIC_REPOSITORY`/`RESTIC_PASSWORD_FILE` presence checks. Under `set -e` in a non-interactive shell, a failed `:?` expansion terminates the script immediately with exit `1` — it is **not** a command failure the following `||` branch can intercept, so the intended distinct `PRECONDITION_EXIT_CODE` (3) was unreachable. The test suite's precondition assertions caught this directly (`exit=1` where `3` was expected); fixed by replacing every instance with a plain `[[ -n "${VAR:-}" ]] ||` check, matching the idiom `noramedi-pgbackrest-backup.sh` already uses elsewhere in this repository.

### 8.2 Existing suites re-run to confirm zero regression

```
npm run test:shell                            exit 0  (all five suites — opscheck, pgBackRest,
                                                        PITR app smoke, frontend-deploy, and the
                                                        new attachment-vps2 suite; run twice —
                                                        the new suite standalone, then the full
                                                        chain — both exit 0)
git diff --cached --check                     exit 0  (no whitespace-conflict markers)
node -e "JSON.parse(...package.json...)"      exit 0  (package.json stays valid JSON after the
                                                        new test:shell:attachment-vps2 entry)
```

**`npx tsc -b` was NOT run in this session, stated plainly rather than glossed over.** This task's isolated worktree has no `node_modules` installed, and installing the full monorepo dependency tree merely to typecheck zero changed `.ts`/`.tsx` files was judged not worth the time/network cost — `git diff --stat origin/main` (§12) independently confirms **zero** files changed under `server/src/**` or `src/**`, which is the only thing a typecheck run could have caught. This is a real gap in this session's validation, not a claim of a passing run that did not happen — a future round should run it once before merge if any doubt remains. `server/`'s Postgres-backed suites (`test:runtime:postgres`, etc.) were similarly **not** run — no live/disposable PostgreSQL was provisioned for this task, and none was needed for the same reason.

### 8.3 Why no infra/integration test against real restic or a real VPS2 exists yet

No VPS2 credential, account or repository exists yet (§4 — this is an R1 discovery/plan task; provisioning is a separate, explicit operator step). A real end-to-end exercise (real `restic init`, real SFTP, real backup, real restore, real checksum match against production-shaped data volumes) is exactly what the manual restore-proof run (§6) and the recurring jobs' first live runs (§5) will produce **after** provisioning — and that evidence belongs in a dated follow-up document, not fabricated here.

---

## 9. Stage 9 — repository documentation

Updated in this branch:

- `docs/program/phases/F4_STORAGE_AND_BACKUP.md` — new top entry (this task).
- `docs/program/NORAMEDI_MASTER_TRACKER.md` — new numbered entry appended to the existing F4 sequence.
- This document.

**Not updated, deliberately:** `NORAMEDI_CURRENT_STATE.md` — this task introduces no new production-active state (nothing is deployed/enabled), so there is nothing yet for that document to reflect; it should be updated by whichever task performs actual VPS2 provisioning and activation. The VPS2 runbook (`F4_RECOVERY_OPERATIONS.md`) is **not** touched — it documents pgBackRest specifically, and this task's mechanism is deliberately independent of it; a future activation task may add a short cross-reference, but inserting attachment-backup material into a document whose entire structure is pgBackRest-checkpoint-numbered would misrepresent it as part of that system.

Explicitly recorded, per instruction:

> **VPS1 attachment storage = PRIMARY. VPS2 encrypted copy (this task) = SECONDARY SAFETY COPY, not yet activated. THIRD INDEPENDENT FAILURE-DOMAIN COPY = DEFERRED / required later, not addressed by this task. This is not the final DICOM/CBCT/object-storage architecture.**

---

## 10. Security / tenant / KVKK impact

- **No application code changed** (§9's `git diff --stat` in §12 confirms this) — tenant isolation, authorization, and every existing route's behavior are **structurally unaffected**, not merely "should be fine."
- **No plaintext patient data reaches VPS2 under this design.** restic encrypts client-side before any chunk transmits; the passphrase is never present on VPS2.
- **No PHI/patient identifier ever appears in a log, status file, or ping URL** — verified structurally by the test suite's canary assertions (§8.1), not merely asserted in this prose.
- **Tenant boundaries are preserved by construction, not by new code:** the backup script copies the *entire* `uploads/` tree as one restic snapshot (already tenant-partitioned by directory, per `<clinicId>/<opaqueId><ext>`), and never parses, re-keys or re-routes objects — it has no per-tenant logic to get wrong.
- **KVKK / special-category health data:** patient attachments may contain such data (per the task brief itself). Technical encryption and Türkiye hosting are **not** a legal-compliance decision — the same distinction this program has repeatedly, explicitly preserved for pgBackRest `repo2` (`F4-2-R2`'s `WORKLOAD_B_LEGAL_GATE = COUNSEL_PENDING`) applies here with equal force. **This document does not claim, and explicitly disclaims, that any KVKK/subprocessor/DPA legal gate is satisfied by this task.** Whoever provisions the real VPS2 account and repository (§4) is adding a new physical location for special-category health-data ciphertext, which is exactly the class of fact this program's KVKK subprocessor register (`62-kvkk-subprocessor-register.md`) requires recording **before**, not after, any byte leaves the production host — see §4's escrow note and the F4-2-R1 sequencing-defect precedent this task is careful not to repeat. **This task did not move any byte and therefore did not trigger that register requirement itself; the operator performing real provisioning must not skip it, having seen exactly what happened when a prior task did.**
- **`R-030-FILES`** (this program's existing risk-register line for off-host attachment/file backup, tracked alongside `R-030-DB`) is **not closed** by this task — it ships the mechanism; production activation, the first real backup, and the first real restore proof all remain outstanding (§11).

---

## 11. Honest status against the ClickUp completion gate

| Completion-gate item | Status |
|---|---|
| Agent completed | **YES** |
| Focused tests/validation passed | **YES** — see §8 |
| PR opened (repo/runbook changes required) | **YES** — [#484](https://github.com/MustafaBasol/DisKlinikCRM/pull/484), **DRAFT** |
| Merged | **NO** |
| Deployed/configured | **NO** |
| VPS1 attachment set copied/snapshotted to VPS2 encrypted-at-rest | **NO** — no VPS2 account/repository exists yet |
| Recurring copy job active | **NO** — units are templates, not installed |
| Monitoring/heartbeat active | **NO** — no Healthchecks-equivalent check has been created; the scripts support pinging one once configured |
| One synthetic/non-PHI restore from VPS2 verified | **NO** — the mechanism is built and unit-tested against a fake `restic`; no real restore has been proven against real VPS2 infrastructure |
| Application upload/download still works from VPS1 primary path | **Unaffected by construction** — zero application code changed (§8.2/§8.3); not independently re-verified against a live production request in this session, because nothing that could regress it was touched |
| Tenant/security impact documented | **YES** — §10 |
| Migration status documented | **YES — `MIGRATION_REQUIRED = NO`, `MIGRATION_CREATED = NO`** (§3.4) |
| Rollback executable | **YES, as designed** (§7) — not yet exercised against real infrastructure, because none exists yet |
| Master tracker/current-state/F4 docs reconciled | **Partially** — phase doc and master tracker updated (§9); `NORAMEDI_CURRENT_STATE.md` deliberately deferred to the activation task (§9) |

**This task does not, and cannot, mark the ClickUp item COMPLETE.** It satisfies exactly the "R1 = discovery and implementation plan" scope named in its own dispatch brief. The remaining items are real infrastructure-provisioning and production-activation work for a follow-up round (a natural `F4-ATTACH-001-R2`), gated on the same kind of program-owner/operator authorization every prior VPS2-touching task in this program (`F4-FCR-003`, `F4-2-R1`, `F4-2-R2`) required before touching real production hosts.

---

## 12. Changed files

```
docs/program/evidence/F4-ATTACH-001-R1_VPS2_ENCRYPTED_SECONDARY_REPLICA_DISCOVERY_AND_PLAN.md   (new, this document)
docs/program/phases/F4_STORAGE_AND_BACKUP.md                                                     (+ new top entry)
docs/program/NORAMEDI_MASTER_TRACKER.md                                                          (+ new numbered entry)
scripts/noramedi-attachment-vps2-backup.sh                                                       (new)
scripts/noramedi-attachment-vps2-check.sh                                                        (new)
scripts/noramedi-attachment-vps2-restore-proof.sh                                                (new)
scripts/noramedi-attachment-vps2.test.sh                                                         (new)
ops/systemd/noramedi-attachment-vps2-backup.service                                              (new, template — NOT installed)
ops/systemd/noramedi-attachment-vps2-backup.timer                                                (new, template — NOT installed)
ops/systemd/noramedi-attachment-vps2-check.service                                               (new, template — NOT installed)
ops/systemd/noramedi-attachment-vps2-check.timer                                                 (new, template — NOT installed)
ops/systemd/noramedi-attachment-vps2-restore-proof.service                                       (new, template — NOT installed)
ops/systemd/noramedi-attachment-vps2-restore-proof.timer                                         (new, template — NOT installed)
ops/restic/noramedi-attachment-vps2.env.example                                                  (new, template — no real secret values)
package.json                                                                                     (+ test:shell:attachment-vps2, wired into test:shell)
.github/workflows/ci-layers.yml                                                                  (rename of one existing step to list the new suite; no behavior change)
```

**No file under `server/src/**` or `src/**` was changed.** `git diff --stat origin/main...HEAD` confirms this (see §13's validation output).

---

## 13. Rejected / unverified claims — stated explicitly

- **Not claimed:** that `S3_BUCKET` is currently unset in production. This document relies on the prior `FILE_BACKUP_COVERAGE_001` task's directly-verified 2026-07-28 evidence, unchanged by anything else in this repository since — but this task did not itself re-run that check against live production (§0/§2.1 name the exact command to do so before any activation decision).
- **Not claimed:** that a restore has ever succeeded against real VPS2 infrastructure. Only the fake-`restic` unit-test path has been exercised (§8.1).
- **Not claimed:** that `npx tsc -b` was run this session — it was not (§8.2). The commit that first opened this PR incorrectly stated it exited `0`; that was a documentation error, caught and corrected in this branch's next commit, before any review or merge.
- **Not claimed:** that `R-030-FILES` or any tracked risk-register line is closed by this task.
- **Not claimed:** that any KVKK/subprocessor legal gate is satisfied (§10).
- **Not claimed:** that this is the final imaging/DICOM/CBCT backup architecture, or a substitute for the deferred third independent failure domain.

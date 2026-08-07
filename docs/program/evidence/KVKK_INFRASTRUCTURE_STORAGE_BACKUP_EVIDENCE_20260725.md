# KVKK Infrastructure, Storage, and Backup Evidence — Production (Final)

Task: KVKK infrastructure/storage/backup evidence — VPS/disk encryption, application-file encryption, DB storage posture, backup encryption/retention/destination, restore evidence, attachment/imaging storage, credential/key storage, access controls, and the application-level-encryption decision.

Stage A (repository evidence + command runbook): [KVKK_INFRASTRUCTURE_STORAGE_BACKUP_EVIDENCE_REQUEST_20260725.md](KVKK_INFRASTRUCTURE_STORAGE_BACKUP_EVIDENCE_REQUEST_20260725.md). This document is **Stage B — the final classified evidence**, built from sanitized production command output pasted back by the user on 2026-07-25. No production command was executed by the agent; no production system was modified.

Evidence timestamp: `2026-07-25T12:06:40+03:00`, host `disklinik-prod-01`, single interactive root shell session (`whoami` → `root`).

**Caveat on the raw transcript:** the pasted terminal output is heavily interleaved — commands were typed ahead while earlier commands were still echoing/printing, so command text and output lines are visually shuffled. Every fact below was reconstructed by matching each `echo "===== ... ====="` section banner (which survived intact) to its corresponding output block, and cross-checking file paths/constants against this repository's `server/src/services/backupService.ts`. Where the shuffling makes a specific check ambiguous or where a planned check did not actually run, that is recorded as `EVIDENCE_MISSING` below rather than inferred.

This document records **observed operational state**. It does not by itself constitute a general KVKK-compliance determination — see the closing note.

---

## A. Local disk/VM encryption visibility (LUKS/dm-crypt)

| Check | Result | Classification |
|---|---|---|
| `lsblk` block/device tree | Single disk `sda` (80G): `sda1` vfat `/boot/efi`, `sda2` ext4 `/boot`, `sda3` LVM2_member → `ubuntu--vg-ubuntu--lv` ext4 76.9G mounted at `/`. No `crypt`-type device anywhere. | `EVIDENCE_CONFIRMED` (as `NO_LOCAL_LUKS_EVIDENCE`) |
| `/dev/mapper` contents | Only `control` and `ubuntu--vg-ubuntu--lv` (→ `../dm-0`). No `*-crypt` mapper entry. | same |
| `dmsetup ls --tree` | `ubuntu--vg-ubuntu--lv (252:0)` → `(8:3)` — a plain LVM logical-volume-over-partition mapping, no `crypt` target in the chain. | same |
| `blkid` (UUIDs masked) | `sda1`=vfat, `sda2`=ext4, `sda3`=LVM2_member. No `crypto_LUKS` type on any partition. | same |

**Classification: `EVIDENCE_CONFIRMED`** that there is **no guest-visible LUKS/dm-crypt layer** — the root volume is plain LVM-on-partition with no encryption mapping in between. Per the Stage A interpretation guidance, this is recorded strictly as `NO_LOCAL_LUKS_EVIDENCE`, **not** as "the disk is unencrypted": most VPS providers implement disk/hypervisor-level encryption transparently to the guest OS, which `lsblk`/`dmsetup`/`blkid` cannot see from inside the VM. Whether that is the case here is `PROVIDER_CONFIRMATION_REQUIRED` (§L).

---

## B. Provider-side disk encryption

No command run inside the guest can answer this — it requires a statement from the hosting provider. **`PROVIDER_CONFIRMATION_REQUIRED`.** Not attempted, not assumed. See §L for the exact confirmations still needed.

---

## C. Local disk vs. S3 object storage

| Check | Result |
|---|---|
| `server/.env`: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | All `NOT_CONFIGURED_OR_EMPTY` |
| `server/.env`: `UPLOAD_DIR`, `STORAGE_PATH`, `BACKUP_DIR` | All `NOT_CONFIGURED_OR_EMPTY` (app uses its compiled-in defaults, e.g. `BACKUP_DIR = '/root/noramedi-backups'` from `backupService.ts:9`, not an env override) |
| Uploads directory presence | `/var/www/noramedi/server/uploads` exists, `drwxr-xr-x root:root` |

**Classification: `EVIDENCE_CONFIRMED`.** Storage is **local VPS disk**, not S3 — matches the repository's storage-abstraction fallback behavior (`fileStorage.ts:1-22`, local mode when `S3_BUCKET` is unset) and reconfirms F0-002's 2026-07-19 finding. This means every downstream storage question (encryption at rest, backup residency, exposure) is about the single VPS disk, not a cloud-object-storage provider's own controls.

---

## D. Application-level file encryption (attachment/imaging bytes)

Not re-derived from production — this is a repository-code fact, unchanged since Stage A: `fileStorage.ts:86-99` (`saveFile`) and `:404-464` (`saveFileFromPath`) write the validated buffer straight to disk or S3 with no cipher call. Production confirms the storage backend in use (local disk, §C above) but application code does not branch on backend for encryption — neither backend gets one.

**Classification: `CONTROL_MISSING`.** This is not unverified — it is confirmed absent by design. File bytes are protected only by (a) OS filesystem permissions and (b) whatever the underlying disk encryption turns out to be (§A/§B), with **no defense-in-depth layer in the application** if either of those is bypassed or the disk/backup is copied off-host.

---

## E. Credential-only field encryption

Repository fact, unchanged since Stage A: `encryption.ts:1-12` and its call sites (`platformAdmin.ts`, `organizationWhatsApp.ts`, `organizationInstagram.ts`, `platformSmsProviders.ts`, `backfill-whatsapp-connections.ts`) encrypt only third-party integration credentials (WhatsApp/Instagram/SMS tokens) before persisting to the DB. No patient/clinical field goes through this path.

**Classification: `EVIDENCE_CONFIRMED`** for scope (credentials only, not patient data). **`EVIDENCE_MISSING`** for whether the encryption key is actually configured in production: `ENCRYPTION_KEY` presence was not part of the executed command set (§C above checked S3/upload/backup env vars only; the credential-env-var check from the Stage A runbook, §H, did not run in this session). This does not change the scope finding — even a correctly-configured key only ever covers integration credentials, never patient/clinical/attachment data.

---

## F. Database storage posture

| Check | Result |
|---|---|
| Process | `postgres` 16, `-D /var/lib/postgresql/16/main`, running as `postgres` user |
| Listening socket | `127.0.0.1:5432` only — loopback, not exposed externally |
| `findmnt \| grep postgres/noramedi/docker` | No separate mount found |

**Classification: `PARTIALLY_CONFIRMED`.** Loopback-only listening is confirmed (`EVIDENCE_CONFIRMED` for "not network-exposed"; TLS is therefore `NOT_APPLICABLE` — a local Unix/loopback connection has no meaningful TLS posture, and no TLS finding is fabricated here per the Stage A guidance). The data directory's own filesystem mount was not explicitly queried this session (`SHOW data_directory` / `findmnt -T <data_dir>` from Stage A §D did not run) — but since `findmnt` in §A shows only `/`, `/boot`, and `/boot/efi` as mounted filesystems on this host, `/var/lib/postgresql/16/main` is necessarily on the same single root LVM volume as everything else, i.e. subject to the same §A finding (no guest-visible LUKS). This inference is sound but not a direct command result, hence `PARTIALLY_CONFIRMED` rather than `EVIDENCE_CONFIRMED`.

---

## G. Backup encryption

| Check | Result |
|---|---|
| Backup script content inspected for `gpg`/`openssl enc`/`age`/`7z`/encrypt keywords | **Did not run this session** — the Stage A §E content-grep of `/usr/local/sbin/noramedi-db-backup.sh` was not among the executed commands |
| `file <latest dump>` magic-byte check | **Did not run this session** |
| Indirect signal: file extensions of all discovered backup artifacts | Every DB backup is `*.dump` (raw `pg_dump` custom format); every file backup is `*.tar.gz` (+ matching `*.tar.gz.sha256` checksum sidecars). **No `.gpg`, `.enc`, `.age`, or password-protected-zip extension appears anywhere** across ~90 backup-like files found in `/var/backups`, `/root`, and their subdirectories. |
| Checksum sidecars | `uploads_backup_*.tar.gz.sha256` exist for every file backup — this proves **integrity checksumming**, not encryption |

**Classification: `EVIDENCE_MISSING`, leaning toward `CONTROL_MISSING`.** The one command that would give a direct answer (grepping the backup script for an encryption tool invocation, or checking a dump's magic bytes) was not executed this session, so this cannot be marked `EVIDENCE_CONFIRMED` either way. However, the circumstantial evidence is one-directional and fairly strong: a GPG-wrapped or `openssl enc`-wrapped dump would almost certainly carry a `.gpg`/`.enc`/`.asc` suffix by convention (and `pg_dump | gpg >file.dump` without renaming would be unusual practice), and **zero** of the ~90 backup files sampled show one. Do not treat this as confirmed — re-run Stage A §E's script-content grep to close this out definitively. Until then, **treat backups as unencrypted for risk-planning purposes**, matching the `CONTROL_MISSING` finding in §D (no defense-in-depth if the disk itself turns out not to be encrypted).

---

## H. Backup retention

Two independent backup mechanisms exist in production, with **different, inconsistent retention behavior**:

**H.1 — Automated DB dumps (`/root/noramedi-backups/`, cron `/etc/cron.d/noramedi-db-backup`, 03:15 daily)**

This is the app-recognized path: `backupService.ts:9` sets `BACKUP_DIR = '/root/noramedi-backups'` and `BACKUP_SCRIPT = '/usr/local/sbin/noramedi-db-backup.sh'` — both match production exactly. Files observed: `noramedi_crm-20260719-031501.dump` through `noramedi_crm-20260725-031501.dump` — **exactly 7 consecutive daily files, no gaps, nothing older**.

**Classification: `PARTIALLY_CONFIRMED`.** This is *empirically consistent* with the `RETENTION_DAYS = 7` constant (`backupService.ts:13`) actually being enforced in production — but the repository already established (Stage A, unchanged) that `RETENTION_DAYS` is a **display-only value used solely by `getBackupStatus()`**; no deletion/pruning code exists anywhere in this repository. The observed 7-file rolling window must therefore be enforced by `/usr/local/sbin/noramedi-db-backup.sh` itself (e.g. a `find -mtime +7 -delete`), which is **outside this repository and was not directly inspected this session** (the Stage A §E retention-keyword grep did not run). Treat as "retention appears to be working, by observation, but the enforcing code has not been read" — not as confirmed policy.

**H.2 — File/upload backups (`/root/noramedi-file-backups/`, root crontab `noramedi-uploads-backup.sh`, 02:30 daily)**

Files observed span **16 consecutive days without a gap**: `uploads_backup_20260710-023002.tar.gz` through `uploads_backup_20260725-023001.tar.gz` (every date 07-10 through 07-25 present, each with a `.sha256` sidecar).

**Classification: `CONTROL_MISSING`.** No pruning is occurring for this backup stream — files are accumulating unbounded (16 days observed at evidence time, growing). This is a **distinct control gap from H.1**: the DB-dump retention story does not extend to the file/upload backup mechanism, which is a separate script entirely and is not referenced anywhere in this repository's `backupService.ts`.

**H.3 — Ad hoc / manual pre-deployment dumps**

Numerous manually-named dumps (`pre-kvkk-high008-*`, `pre-kvkk-crit003-*`, `noramedi_crm_before_phase3_activation_*`, `noramedi-clean-production-start-*`, etc.) exist across `/var/backups/noramedi/`, `/root/`, `/root/noramedi-db-backups/`, `/root/backups/`, dated from as early as 2026-06-29 (**26 days old at evidence time**) with no observed cleanup. Several `.env` backups (`/root/noramedi-env-backups/.env.backup.*`, `/root/backups/noramedi_server_env_2026-07-02_1829.bak`, `/root/.env.backup.20260716-004559`) — i.e. **credential-bearing files** — are among these, similarly un-pruned.

**Classification: `CONTROL_MISSING`.** These are a normal and reasonable operational habit (snapshot before a risky migration/deploy) but have no retention policy at all. Full patient-data dumps and `.env`/credential backups persisting indefinitely on the same host is a storage-limitation-principle gap (KVKK data-minimization expectation), independent of the encryption question in §G. This is noted for completeness; it is adjacent to, not one of, the 12 core classification areas, but it is direct production evidence and should not be dropped.

---

## I. Restore evidence

Not addressed by any command executed this session — no `systemctl list-timers | grep restore`, no cron/log grep for "restore" was run. Per Stage A §F (unchanged): absence of a named automated restore-test job would not prove a manual restore never happened, and this session produced no evidence either way.

**Classification: `EVIDENCE_MISSING` — remains `UNVERIFIED`,** exactly as it stood after F0-002. No claim of "restore tested" or "restore untested" can be made from what was collected.

---

## J. Attachment/imaging authorization (application layer)

Repository fact, unchanged since Stage A: every attachment route (`attachments.ts:101-245`) is gated by `authorize([...])` before any file is opened/streamed — there is no route that serves a file without an authorization check.

**Classification: `EVIDENCE_CONFIRMED`** (repository fact — this is how the deployed code behaves, and F0-002 already established production `HEAD` traces to a known point on `main`).

---

## K. Public static-file exposure (Nginx)

`nginx -T` on the **real production host config** (not this repository's container-reference `nginx.conf`) was searched for `alias|root|upload|attachment|imaging|dicom|autoindex`. Result:

- `root /var/www/noramedi/dist;` (×2) — the frontend SPA build only.
- `alias /var/www/noramedi-downloads/windows-bridge/;` with `Content-Disposition: attachment` and `autoindex off` — this is a **Windows-bridge installer download directory**, unrelated to patient attachments/imaging, and not auto-indexed.
- **No match for `uploads`, `attachment`, `imaging`, or `dicom` as a static alias/location anywhere in the live Nginx config.**

**Classification: `EVIDENCE_CONFIRMED`.** The production Nginx config does **not** expose `server/uploads` (or any attachment/imaging path) as a static file route. This directly closes the one gap Stage A flagged as unprovable from the repository alone (§0 of the request doc noted this repo's own `nginx.conf` is a container-internal reference, not proof about the real host config) — attachments/imaging are served exclusively through the authorized Express routes confirmed in §J, never as a static file.

---

## L. Provider-side confirmations still required

Nothing executed this session or in Stage A can answer these from inside the guest OS. Unchanged from the Stage A runbook — **do not treat any of the following as confirmed**:

1. A storage/disk encryption-at-rest statement for the specific Hostinger (or actual provider) plan/data-center in use, covering the LVM volume backing `/`.
2. Whether provider-level VM/disk snapshots (if the plan includes any, separate from the application's own `pg_dump`/`tar` backups) exist, and if so whether they are encrypted and where stored.
3. The physical data-center location (Türkiye residency confirmation for KVKK purposes).
4. A subprocessor/data-location list, if the provider uses any third-party storage backend.
5. The provider's physical-security certification (ISO 27001 or equivalent), if claimed.
6. The provider's data-deletion/decommissioning policy for a terminated VPS instance.

---

## Summary table

| Area | Classification |
|---|---|
| A. Local LUKS/dm-crypt visibility | `EVIDENCE_CONFIRMED` (as `NO_LOCAL_LUKS_EVIDENCE`, not "unencrypted") |
| B. Provider-side disk encryption | `PROVIDER_CONFIRMATION_REQUIRED` |
| C. Local disk vs. S3 storage | `EVIDENCE_CONFIRMED` — local VPS disk |
| D. Application-level file encryption (attachments/imaging) | `CONTROL_MISSING` |
| E. Credential-only field encryption (scope) | `EVIDENCE_CONFIRMED`; key-configured-in-prod is `EVIDENCE_MISSING` |
| F. DB storage posture / TLS | `PARTIALLY_CONFIRMED` (loopback-only confirmed; data-dir mount inferred, not directly queried; TLS `NOT_APPLICABLE`) |
| G. Backup encryption | `EVIDENCE_MISSING`, leaning `CONTROL_MISSING` on circumstantial evidence |
| H.1 DB backup retention | `PARTIALLY_CONFIRMED` (observed 7-day window; enforcing script not inspected) |
| H.2 File/upload backup retention | `CONTROL_MISSING` (unbounded accumulation observed) |
| H.3 Ad hoc/manual dump + `.env` backup retention | `CONTROL_MISSING` |
| I. Restore evidence | `EVIDENCE_MISSING` / `UNVERIFIED` |
| J. Attachment/imaging authorization (app layer) | `EVIDENCE_CONFIRMED` |
| K. Public static-file exposure (Nginx) | `EVIDENCE_CONFIRMED` — not exposed |
| L. Provider confirmations (6 items) | `PROVIDER_CONFIRMATION_REQUIRED`, none obtained |

---

## Application-level encryption: is this now a code task?

**Yes — application-level file encryption for attachment/imaging bytes, and backup encryption, should both be opened as code/ops tasks.** This conclusion does **not** wait on §B/§L (provider disk-encryption confirmation), for two independent reasons:

1. **§D is already `CONTROL_MISSING` on repository evidence alone**, regardless of what the disk turns out to be — there is no application-layer defense-in-depth today. If the provider later confirms full-disk encryption, that mitigates the "physical disk theft" scenario but not process-level or misconfiguration-level exposure of the plaintext files on a running host.
2. **Backup files are portable artifacts** (§G, §H) — they get copied off the host (or should be, for real disaster recovery — see §L.2, no offsite/S3 destination was found in this evidence at all, which is itself worth a follow-up question). Whatever the primary disk's encryption status, an unencrypted `.dump`/`.tar.gz` copied anywhere else (another host, a laptop, cloud storage) carries full patient data in the clear. Backup-file encryption is warranted independent of the provider disk-encryption answer.

Recommended scope for the follow-up code task (not implemented here — this document is evidence only):
- Encrypt `pg_dump` output in `noramedi-db-backup.sh` (server-side ops script, outside this repository) and/or encrypt at rest via the app before/after `fileStorage.ts` writes for attachment/imaging bytes.
- Add actual pruning to the file/upload backup script (§H.2) and to ad hoc manual dumps (§H.3), including `.env` backup files.
- Confirm `ENCRYPTION_KEY` is set in production (§E) as a prerequisite for any of the above.

This is a recommendation to open follow-up work, not a claim that the gap has been remediated.

---

## What this document does not claim

This is infrastructure/storage/backup evidence for the twelve areas above. It is **not** a general KVKK-compliance determination, does not cover consent management, DPA/data-subject-request handling, breach-notification procedures, staff training, or any control outside storage/backup/encryption scope, and must not be cited as such.

No secret, token, password, connection string, UUID, patient name, phone number, email address, clinical data, or private file/object path is recorded in this document — only directory-level paths, file-count/date patterns, permission bits, and command-presence/absence facts, consistent with the sanitization the user already applied before pasting output back.

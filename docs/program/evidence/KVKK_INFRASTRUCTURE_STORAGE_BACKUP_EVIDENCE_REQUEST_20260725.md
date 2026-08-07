# KVKK Infrastructure, Storage, and Backup Evidence — Production Request (Stage A: repository evidence + command runbook)

**Status: STAGE A ONLY — repository-level evidence and a command runbook. No production command in this file has been executed by the agent or the user yet.** This is not the final evidence artifact. Once the user runs Section B–L below against production (read-only, in one interactive shell session) and pastes back sanitized output, a follow-up pass will produce `KVKK_INFRASTRUCTURE_STORAGE_BACKUP_EVIDENCE_20260725.md` — the actual classified evidence document — from that output.

**For the user to run, read-only, on the production VPS.** Per this repository's established convention (see [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) — *"the agent does not have and must not be given production credentials"*), this task does not connect to production directly, even though a working SSH key/alias for the production host exists on the local development machine. Nothing in this file is run by the agent.

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, private key, patient name, phone number, email address, clinical data, or private object path/filename before pasting the results back into this conversation.

Baseline: repository worktree at `origin/main` @ `821578f2e08f6d8715144e1643a725d704c79b96` (fetched 2026-07-25). Branch: `audit/kvkk-infrastructure-storage-backup-evidence`.

---

## 0. What repository evidence already establishes (no production access needed)

Read directly from this repository, cited by file:line. These answer several of the task's questions **without any server command** and are carried into Stage B's later classification rather than re-derived from scratch.

| Finding | Evidence | Classification |
|---|---|---|
| Field-level encryption exists, but **only for third-party integration credentials** (WhatsApp/Instagram/SMS provider API keys and access tokens), not for patient/clinical data | `server/src/utils/encryption.ts:1-12` (doc comment: *"Used to encrypt WhatsApp API keys and access tokens before persisting to DB"*); call sites confirmed narrowly in `server/src/routes/platformAdmin.ts`, `server/src/routes/organizationWhatsApp.ts`, `server/src/routes/organizationInstagram.ts`, `server/src/services/sms/platformSmsProviders.ts`, `server/src/scripts/backfill-whatsapp-connections.ts` — **no call site in any patient/clinical/attachment/imaging model** | `EVIDENCE_CONFIRMED` (repository fact) |
| No application-level encryption of attachment/imaging **file bytes** before storage, in either local-disk or S3 mode | `server/src/services/fileStorage.ts:86-99` (`saveFile`) and `:404-464` (`saveFileFromPath`) write/stream the validated buffer directly to disk (`fs.promises.writeFile`) or to S3 (`PutObjectCommand`/`Upload`) — no `encryptSecret`/cipher call anywhere in this file | `EVIDENCE_CONFIRMED` (repository fact) — application-level file encryption is **absent by design**, not merely unverified |
| Storage abstraction: local disk by default, S3-compatible only if `S3_BUCKET` is set | `server/src/services/fileStorage.ts:1-22, 43-45` | `EVIDENCE_CONFIRMED`; cross-references [F0-002_PRODUCTION_BASELINE_EVIDENCE.md §B.9](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) which already found `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` all `MISSING` in production as of 2026-07-19 → `LOCAL_VPS_STORAGE` |
| Attachment access requires application-level authorization on every route, not raw static-file serving | `server/src/routes/attachments.ts:101-245` — POST/GET list/GET download/GET preview all gated by `authorize([...])` before ever calling `openFileStream` | `EVIDENCE_CONFIRMED` (repository fact) — **this repository's own `nginx.conf`** (container-internal reference config only, per F0-006) has **no** `uploads` location block at all (`grep uploads nginx.conf` → no match), consistent with attachments being served only through the authenticated Express route, never as a static file. This does **not** prove the real host-level Nginx config (which F0-006 already established is a *different*, bare-VPS config not tracked in this repository) has no such block — that is a Stage B server-side check (§J below). |
| Backup mechanism is a raw `pg_dump` custom-format file (`noramedi_crm-????????-??????.dump`); this repository contains no encryption step for the dump | `server/src/services/backupService.ts:9-14` declares `BACKUP_DIR`/`BACKUP_SCRIPT`/`BACKUP_LOG`/filename pattern, but the actual backup-creation logic lives in `/usr/local/sbin/noramedi-db-backup.sh` on the VPS, which is **not part of this repository** (confirmed: `git grep` for this filename returns nothing) | `EVIDENCE_MISSING` — whether the backup file itself is encrypted cannot be determined from the repository; the actual script is server-only and must be inspected there (§I below, read-only, without printing its full content) |
| `RETENTION_DAYS = 7` is a **display constant only** | `server/src/services/backupService.ts:13,98` — used solely to populate the `getBackupStatus()` API response; no code in this repository actually deletes/prunes backup files older than 7 days (no `unlink`/`rm`/`find -mtime` call anywhere near this constant) | `EVIDENCE_CONFIRMED` — the "7-day retention" claim is **unenforced by any application code**; actual retention (if any) must come from the server-side backup script/cron, which is outside this repository — the real enforced retention (or its absence — backups accumulating forever, or being pruned by an undocumented mechanism) is `EVIDENCE_MISSING` pending §I |
| Restore-test capability exists in application code (`runRestoreTest()`), but produces no durable ledger | `server/src/services/backupService.ts:167-277` — creates a disposable temp DB, `pg_restore`s into it, runs 3-4 sanity queries, drops the temp DB; return value is only ever an in-memory API response, never written to a table or file | `EVIDENCE_CONFIRMED` (repository fact, matches [F0-002_PRODUCTION_EVIDENCE_REQUEST.md §I](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) note) — the function's *existence* is not evidence it has ever been invoked; whether it has actually been run in production is `EVIDENCE_MISSING`, addressed narrowly in §K below |
| Imaging/DICOM handling exists as an "imaging bridge" concept (pairing/onboarding/upload-validation/request-transitions), reusing the same `fileStorage.ts` abstraction | `server/src/services/imaging/*.ts`, `server/src/routes/imaging.ts`, `server/src/routes/imagingBridgePublic.ts` | `EVIDENCE_CONFIRMED` (code exists); whether imaging files are **currently active** (non-trivial volume) in production is `EVIDENCE_MISSING` — F0-002 measured the *entire* `uploads/` directory at 3.1 MB total (2026-07-19), suggestive of little-to-no real imaging volume yet, but this was not broken out by subdirectory and must not be treated as a precise imaging-only figure |

None of the above required production access — they are static-analysis facts about the code actually running (production `HEAD` was confirmed by F0-002 to match a known point on `main`'s history, so this reasoning applies to the deployed code, not just this checkout).

---

## How to use Sections B–L

1. SSH into the production VPS yourself (`ssh noramedi-vps` or equivalent — the agent does not have and must not be given this credential).
2. Open **one interactive shell session** and run the sections in order — later sections reuse variables (`APP_DIR`, `DB_NAME`, `BACKUP_DIR`) confirmed in earlier ones, same convention as `F0-002_PRODUCTION_EVIDENCE_REQUEST.md`.
3. Where a section asks you to confirm a discovered value, do not let the script guess — set the variable to what you actually confirmed.
4. Paste the output of Section L (final summary) back into this conversation, after reviewing it against the warning banner above.

---

## B. Host, filesystem, and disk-encryption evidence

```bash
uname -a
lsblk -o NAME,TYPE,FSTYPE,SIZE,MOUNTPOINTS
findmnt
df -hT

# Mask anything that looks like a credential embedded in a mount option
mount | sed -E 's/(password|token|secret|key)=[^, ]+/\1=***MASKED***/gi'

# Local LUKS/dm-crypt visibility (read-only listing, does not open/close/modify any mapping)
lsblk -o NAME,TYPE,FSTYPE | grep -i crypt || echo "no crypto_LUKS/dm-crypt block device visible locally"
dmsetup ls --target crypt 2>/dev/null || echo "dmsetup not available or no crypt targets (dmsetup ls is read-only)"

# Filesystem permissions on the two directories that matter for this task
stat -c '%A %U:%G %n' /var/www/noramedi/server/uploads 2>/dev/null || echo "uploads dir not found at expected path"
stat -c '%A %U:%G %n' /root/noramedi-backups 2>/dev/null || echo "backup dir not found at expected path"
```

**Interpretation guidance (do not skip):** the absence of a visible LUKS/dm-crypt block device above does **not** mean the underlying disk is unencrypted — many VPS/cloud providers encrypt at the hypervisor or storage layer, invisible to an in-guest `lsblk`. Record the raw finding as `NO_LOCAL_LUKS_EVIDENCE`, not `UNENCRYPTED`. Provider-side confirmation is required either way (§M).

---

## C. Application storage configuration (masked, presence only)

```bash
: "${APP_DIR:?Set APP_DIR — confirm the real app directory, expected /var/www/noramedi}"
ENV_FILE="$APP_DIR/server/.env"

for var in S3_BUCKET S3_REGION S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_FORCE_PATH_STYLE ENCRYPTION_KEY; do
  if [ ! -f "$ENV_FILE" ]; then echo "$var: CANNOT_CHECK (env file not found)"; continue; fi
  count=$(grep -cE "^${var}=" "$ENV_FILE")
  if [ "$count" -eq 0 ]; then echo "$var: MISSING";
  elif [ "$count" -gt 1 ]; then echo "$var: DUPLICATE";
  else
    line=$(grep -E "^${var}=" "$ENV_FILE"); value="${line#*=}"
    if [ -z "$value" ]; then echo "$var: EMPTY"; else echo "$var: SET"; fi
  fi
done

# Local upload directory breakdown by top-level subdirectory (sizes only, no filenames)
du -sh "$APP_DIR"/server/uploads/*/ 2>/dev/null | sed -E "s#$APP_DIR/server/uploads/##"
```

Do not print the full `.env`. `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` presence/absence only — never the value.

---

## D. Database storage and TLS posture

```bash
: "${DB_NAME:?Confirm DB_NAME, expected noramedi_crm}"

# Confirm local vs remote Postgres
sudo -u postgres psql -c "SHOW listen_addresses;"
ss -tlnp 2>/dev/null | grep 5432 || echo "cannot inspect listening sockets (permission or ss unavailable)"

# Data directory location and its mount/filesystem (does not read any file inside it)
sudo -u postgres psql -c "SHOW data_directory;"
DATA_DIR=$(sudo -u postgres psql -X -A -t -c "SHOW data_directory;")
findmnt -T "$DATA_DIR" 2>/dev/null

# TLS — only relevant if a remote connection is ever used; on a local/loopback
# Postgres this is not applicable, do not fabricate a TLS finding either way
sudo -u postgres psql -c "SHOW ssl;"
```

Do not query any clinical/business table. `SHOW data_directory` reveals a filesystem path, not data — safe to record.

---

## E. Backup encryption, retention enforcement, and destination

```bash
BACKUP_DIR="/root/noramedi-backups"
BACKUP_SCRIPT="/usr/local/sbin/noramedi-db-backup.sh"
export BACKUP_DIR

# Does the backup SCRIPT itself contain an encryption step? Check for tool
# names only — do NOT print the full script (it may reference a key path).
grep -oE 'gpg|openssl enc|age -|7z |zip -e|encrypt' "$BACKUP_SCRIPT" 2>/dev/null \
  || echo "no gpg/openssl/age/7z/encrypt keyword found in backup script"

# Does the script prune/rotate old backups, and does it push anywhere offsite?
grep -oE '\-mtime|find .*(-delete|-exec rm)|rclone|rsync|aws s3|s3cmd|scp |sftp' "$BACKUP_SCRIPT" 2>/dev/null \
  || echo "no retention-prune or offsite-transfer command found in backup script"

# File type of the most recent backup (magic-byte check only, not decompressed/opened)
LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'noramedi_crm-????????-??????.dump' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
if [ -n "$LATEST" ]; then
  file "$LATEST"
else
  echo "no matching backup file found"
fi

# Confirm the backup directory is on the SAME filesystem as the app/DB (offsite check)
findmnt -T "$BACKUP_DIR" 2>/dev/null
findmnt -T /var/www/noramedi 2>/dev/null

# Any additional off-VPS destination configured anywhere as a cron/systemd job?
grep -lRE 'rclone|rsync.*(@|::)|aws s3|s3cmd|borg |restic ' /etc/cron.d/ /etc/cron.daily/ /etc/systemd/system/ 2>/dev/null \
  || echo "no offsite-backup-transfer job found in cron.d/cron.daily/systemd"
```

**Interpretation guidance:** `file <dump>` on an un-encrypted `pg_dump` custom-format file reports `PostgreSQL custom database dump`; a GPG-encrypted file reports `GPG symmetrically/publicly encrypted data`; an OpenSSL-`enc`'d file reports `data` (no distinguishing magic). Report whichever the command actually returns — do not infer encryption from the filename pattern alone.

---

## F. Restore evidence (explicit limitation, unchanged from F0-002)

```bash
systemctl list-timers 2>/dev/null | grep -Ei 'noramedi.*restore|restore.*noramedi'
grep -lEi 'noramedi.*restore|restore.*noramedi' /etc/cron.d/* 2>/dev/null
grep -c 'restore' /var/log/noramedi-db-backup.log 2>/dev/null || echo "0"
```

Per [F0-002_PRODUCTION_EVIDENCE_REQUEST.md §I](F0-002_PRODUCTION_EVIDENCE_REQUEST.md): this can only detect a *named* automated restore-test job or a log line mentioning "restore" — it cannot prove a manual restore test happened, and its absence does not prove one never did. Unless the user separately supplies a dated operational record outside of what these commands produce, `Last restore test` remains `UNVERIFIED` regardless of this output.

---

## G. Attachment and imaging access control

```bash
: "${APP_DIR:?Set APP_DIR}"

# Ownership/permissions on the uploads tree (aggregate, no filenames)
find "$APP_DIR/server/uploads" -maxdepth 2 -printf '%m %u:%g %p\n' 2>/dev/null | sed -E "s#$APP_DIR/server/uploads#uploads#"

# Does the REAL production Nginx config expose /uploads or any attachment
# path as a static alias/try_files (would bypass the app's own auth checks)?
grep -rn 'uploads' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
  || echo "no 'uploads' reference found in active nginx config — attachments are not statically served"
```

Do not `ls`/`find` file-level entries inside `uploads/` beyond directory-level `-maxdepth 2`, and do not print any filename.

---

## H. Credential and key storage

```bash
: "${APP_DIR:?Set APP_DIR}"
ENV_FILE="$APP_DIR/server/.env"

for var in JWT_SECRET PLATFORM_JWT_SECRET CSRF_SECRET ENCRYPTION_KEY DATABASE_URL REDIS_URL; do
  if [ ! -f "$ENV_FILE" ]; then echo "$var: CANNOT_CHECK"; continue; fi
  count=$(grep -cE "^${var}=" "$ENV_FILE")
  if [ "$count" -eq 0 ]; then echo "$var: MISSING";
  elif [ "$count" -gt 1 ]; then echo "$var: DUPLICATE";
  else
    line=$(grep -E "^${var}=" "$ENV_FILE"); value="${line#*=}"
    if [ -z "$value" ]; then echo "$var: EMPTY"; else echo "$var: SET"; fi
  fi
done

# .env file permissions (should not be world-readable)
stat -c '%A %U:%G' "$ENV_FILE" 2>/dev/null

# Does the app log ever accidentally print a secret-looking value? Check
# LOG FILE NAMES/rotation only — do not grep log CONTENT for this task.
ls -la /var/log/ 2>/dev/null | grep -i noramedi || echo "no noramedi-named log file found under /var/log"
```

Do not `cat`, `grep -A`, or otherwise print `.env` content. Do not grep application log *content* for secret patterns as part of this task (that would require opening logs that may contain PII).

---

## I. Final evidence summary

Run last, in the same shell session as B–H (reuses `APP_DIR`, `DB_NAME`, `BACKUP_DIR`):

```bash
: "${APP_DIR:?Set APP_DIR}"
: "${DB_NAME:?Set DB_NAME}"

echo "=== KVKK infrastructure evidence summary — $(date -Is) ==="
echo "--- Disk/LUKS ---"
lsblk -o NAME,TYPE,FSTYPE,SIZE,MOUNTPOINTS
lsblk -o NAME,TYPE,FSTYPE | grep -i crypt || echo "no crypto_LUKS visible locally"
echo "--- DB location/TLS ---"
sudo -u postgres psql -c "SHOW listen_addresses;" 2>/dev/null
sudo -u postgres psql -c "SHOW ssl;" 2>/dev/null
echo "--- Backup encryption/retention/offsite ---"
grep -oE 'gpg|openssl enc|age -|encrypt' /usr/local/sbin/noramedi-db-backup.sh 2>/dev/null || echo "none found"
grep -oE '\-mtime|rclone|rsync|aws s3' /usr/local/sbin/noramedi-db-backup.sh 2>/dev/null || echo "none found"
echo "--- Restore evidence ---"
systemctl list-timers 2>/dev/null | grep -Ei 'restore' || echo "none found"
echo "--- Uploads permissions ---"
find "$APP_DIR/server/uploads" -maxdepth 1 -printf '%m %u:%g %p\n' 2>/dev/null
echo "--- Nginx uploads exposure ---"
grep -rn 'uploads' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null || echo "not statically exposed"
echo "--- Config presence ---"
for var in S3_BUCKET ENCRYPTION_KEY JWT_SECRET DATABASE_URL; do
  grep -q "^${var}=" "$APP_DIR/server/.env" 2>/dev/null && echo "$var: SET" || echo "$var: MISSING"
done
echo "=== end summary ==="
```

> ⚠️ **Review the output before sharing.** Remove any secret, token, password, connection string, patient name, phone number, email, clinical data, or private object path before pasting back.

---

## Provider-side evidence this runbook cannot produce

No command above can prove Hostinger/VPS-provider-side disk or snapshot encryption — only what is visible inside the guest OS. Where local evidence is `NO_LOCAL_LUKS_EVIDENCE` (the expected result for most VPS providers, since block-level encryption is typically transparent to the guest), the following must come from the provider directly, not be inferred:

- A storage/disk encryption-at-rest statement for the specific plan/data-center in use.
- The physical data-center location (confirms Türkiye residency for KVKK purposes).
- Whether provider-taken snapshots/images (if any exist, separate from the application's own `pg_dump` backups) are encrypted and where they are stored.
- A subprocessor/data-location list if the provider uses any third-party storage backend.
- The provider's physical security certification (ISO 27001 or equivalent) if claimed.
- The provider's data-deletion/decommissioning policy for a terminated VPS instance.

No claim of provider-side encryption should be made anywhere in the follow-up evidence document without one of the above being actually supplied.

---

## Next step

Once Sections B–I are run and sanitized output is pasted back, the follow-up task is to produce `KVKK_INFRASTRUCTURE_STORAGE_BACKUP_EVIDENCE_20260725.md` — classifying each of the 12 required areas (`EVIDENCE_CONFIRMED` / `PARTIALLY_CONFIRMED` / `EVIDENCE_MISSING` / `CONTROL_MISSING` / `NOT_APPLICABLE` / `PROVIDER_CONFIRMATION_REQUIRED`), reconciling it against §0 above, and rendering the conditional application-level-encryption decision required by the task brief.

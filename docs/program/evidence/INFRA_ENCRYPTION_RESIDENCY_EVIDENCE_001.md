# INFRA-ENCRYPTION-RESIDENCY-EVIDENCE-001 — Production Encryption and Data-Residency Evidence Package

**Status: `PARTIALLY_COLLECTED_OPERATOR_EVIDENCE`.** An operator has now run a subset of the §3 read-only production commands and supplied results (recorded per-row below and summarized in §3a). This closes several database-transport and secret-permission rows (§3.5, §3.6, §3.14) and adds a negative OS-level disk-encryption signal (§3.3/§3.4), but it does **not** close provider disk-at-rest encryption or VPS data-residency/datacenter-location — those remain `AWAITING_PROVIDER_EVIDENCE` (§3.1, §3.3's provider-layer question) because no Hostinger hPanel/support evidence has been supplied yet, and a guest-OS check cannot itself prove or disprove hypervisor/storage-backend-level encryption. Every other claim below is either cited from existing repository/evidence-file facts (`VERIFIED_REPOSITORY` / `VERIFIED_PRODUCTION_OBSERVED`, already recorded in other files) or remains an open evidence request awaiting a read-only operator command result or a provider-console/document screenshot.

Baseline: `origin/main` @ `26c6c339a7cd8db06b1707c059f7f27857f45e61`.
Branch: `audit/infra-encryption-residency-evidence-001`.

This is an **evidence-collection package**, not a remediation or a legal determination. It does not change, restart, migrate, or reconfigure any production system. It does not modify `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `CURRENT_PHASE.md`, or `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` — those remain the authoritative status trackers and are updated, if at all, by a separate task once this evidence is actually supplied and reviewed.

## 0. Why this document exists

`docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4 ("Outstanding production-verification controls") and `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md` §13 ("Explicitly unverified") both independently list the same open items this package targets: VPS disk/volume encryption, PostgreSQL storage/transport encryption, backup encryption and offsite location, TLS/HSTS configuration detail, `server/.env` permissions, and key rotation policy. Nothing in this repository has ever collected that evidence. This package is the read-only collection runbook for it — it does not itself resolve any of those open items; it produces the evidence a later, separate task would need to close them.

## 1. Scope and non-goals

**In scope:** read-only production evidence collection (operator-run shell commands over SSH) plus provider-console/document evidence (Hostinger hPanel, legal/ToS/DPA pages) for the eleven control areas in §3.

**Out of scope / explicitly not done by this document:**

- No production system is modified, restarted, migrated, reconfigured, or has any file written to it by this task.
- No secret, credential, private key, connection string, patient name/phone/email, clinical content, or full configuration-file dump is requested, printed, or stored in this document.
- No legal KVKK/GDPR compliance determination. Data-residency and cross-border-transfer legal conclusions remain Turkish legal counsel's determination, exactly as `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` already states for its own scope.
- No claim that a control is "acceptable," "sufficient," or "compliant." This document records **what is observed**, not whether it satisfies a legal or contractual bar.
- This document is not itself the source of truth for task status (`NORAMEDI_MASTER_TRACKER.md` remains that) — it is a reproducible evidence artifact only, in the same relationship the `evidence/` directory's other files already have to the tracker (see [README.md](README.md)).

## 2. Evidence classification legend

Reuses the existing classifications defined in [README.md](README.md), plus two collection-status values specific to open evidence requests:

| Classification | Meaning |
|---|---|
| `VERIFIED_REPOSITORY` | Confirmed by direct inspection of tracked repository files (as in [README.md](README.md)) |
| `VERIFIED_PRODUCTION_OBSERVED` | Already confirmed by a prior read-only production evidence pass (cited by file/section) |
| `AWAITING_OPERATOR_EVIDENCE` | Requires a read-only command run by a human operator with production SSH access; not yet supplied |
| `AWAITING_PROVIDER_EVIDENCE` | Requires a Hostinger console screenshot, invoice/account detail, or public legal document (ToS/DPA/Privacy Policy); not yet supplied |
| `NOT_APPLICABLE` | The control does not apply given the confirmed topology |

Task status values (`AWAITING_OPERATOR_AND_PROVIDER_EVIDENCE` at the top of this file) are a document-level state, not a per-row evidence classification — do not conflate the two, per the same rule [README.md](README.md) states for the tracker's status values.

## 3. Required evidence matrix

Confirmed topology this package assumes (cited, not re-derived — see [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) and [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md)): bare VPS (hostname `disklinik-prod-01`, provider Hostinger per `docs/22-hostinger-vps-postgres-deploy-plan.md`), PM2 processes `noramedi-api`/`noramedi-worker`, host Nginx `1.24.0`, PostgreSQL `16.14` database `noramedi_crm`, app directory `/var/www/noramedi`, backup directory `/root/noramedi-backups`. **No Docker/Traefik component exists in production** — `docs/35-docker-deploy-runbook.md` is confirmed stale documentation (F0-006 drift-table row 2); every command below targets the bare-VPS + PM2 + Nginx topology only.

Each row: **Claim** → **Current status** → **Source of evidence** → **Command / provider document** → **Expected output** → **Redaction rule** → **Remediation if absent**.

---

### 3.0 Operator-supplied production evidence — 2026-07-28 pass

The following facts were supplied directly by the operator from a production SSH session on `disklinik-prod-01` on 2026-07-28. They are recorded verbatim here as the source facts; the individual §3.x rows below cite this pass and update their own `Current status` accordingly. This pass did **not** cover every row in §3 — rows not listed here remain in their prior status.

| Observed fact | Value |
|---|---|
| PostgreSQL `listen_addresses` | `localhost` |
| PostgreSQL `port` | `5432` |
| PostgreSQL `SHOW ssl` | `on` |
| Current operator connection | `127.0.0.1`, `ssl=true` |
| All observed application (`noramedi-api`/`noramedi-worker`) connections | `127.0.0.1` only — no non-loopback source observed |
| `server/.env` permissions | `600 root:root` |
| Guest-OS LUKS/dm-crypt evidence (`lsblk -f`, `cryptsetup status`, `findmnt`) | none found — no `crypto_LUKS`/`crypt` device-mapper entry visible from inside the guest OS |
| Provider (Hostinger) disk-at-rest encryption and VPS datacenter/residency | **still unknown** — no hPanel/provider evidence supplied in this pass; a guest-OS-only check cannot confirm or rule out hypervisor/storage-backend-level encryption, so this is recorded as a negative *guest-visible* signal only, not a confirmed absence of encryption |
| TLS certificate SAN coverage | confirmed to cover `api.noramedi.com` (consistent with the existing Let's Encrypt cert already recorded in [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md)) |

**What this pass does not establish:** provider-side disk/volume encryption-at-rest (§3.3's provider-layer question), VPS country/datacenter region (§3.1), backup encryption (§3.9), off-host backup existence (§3.11 — already separately confirmed absent), SSH hardening (§3.13), secrets-manager usage (§3.15), or log storage/retention (§3.16). Those rows remain `AWAITING_OPERATOR_EVIDENCE` / `AWAITING_PROVIDER_EVIDENCE` exactly as before this pass.

---

### 3.1 VPS country and datacenter region

- **Claim:** the production VPS is physically located in a specific country/datacenter region operated by Hostinger.
- **Current status:** `AWAITING_PROVIDER_EVIDENCE` — no repository or prior evidence file records this. `docs/22-hostinger-vps-postgres-deploy-plan.md` names the provider but not a location. **Not closed by the §3.0 2026-07-28 operator pass** — that pass was a guest-OS/database check only and did not include Hostinger hPanel or support-ticket evidence; VPS country/datacenter residency remains explicitly open.
- **Source of evidence:** Hostinger hPanel (authoritative) plus VPS-side supplementary signals (non-authoritative, corroborating only).
- **Command / provider document:**
  - **Authoritative:** Hostinger hPanel → VPS → server overview/details panel — records the datacenter location field (e.g. city/country) as Hostinger itself designates it. Screenshot or copy the location field text only.
  - **Supplementary, operator-run, non-authoritative** (do not treat as proof of legal jurisdiction — only as a corroborating signal):
    ```bash
    date -Is
    timedatectl 2>/dev/null | grep -i "time zone"
    cat /etc/timezone 2>/dev/null
    # Optional, discloses the VPS's public IP to a third-party geo-IP service —
    # only run this if the operator accepts that disclosure. Country-level only.
    curl -s --max-time 5 https://ipinfo.io/country 2>/dev/null || echo "geo-IP lookup skipped/unavailable"
    ```
- **Expected output:** a named country (and ideally city/datacenter code) from the hPanel field; timezone/geo-IP output that is consistent with (not contradicting) it.
- **Sensitive-output redaction rule:** never paste the full `ipinfo.io` JSON response if run with more detail than country-level; never paste Hostinger account number, billing contact, or payment details from the hPanel screenshot — crop to the location field only.
- **Remediation if absent:** if hPanel does not expose a location field, open a Hostinger support ticket asking for the datacenter country/region for this specific VPS instance; do not infer it solely from the geo-IP supplementary check.

---

### 3.2 Provider legal entity and subprocessors

- **Claim:** Hostinger's contracting legal entity and any subprocessors it uses are identified, for the future international-transfer/processor-agreement legal work already tracked in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §3.
- **Current status:** `AWAITING_PROVIDER_EVIDENCE` — not previously collected anywhere in this repository.
- **Source of evidence:** Hostinger account billing page and Hostinger's own published legal documents.
- **Command / provider document:** not a shell command — provider-console/document evidence only:
  - Hostinger hPanel → Billing → most recent invoice → contracting/billing legal entity name and registered address.
  - Hostinger's publicly published Terms of Service, Privacy Policy, and Data Processing Agreement (DPA) — locate via the operator's own Hostinger account (Legal/Privacy section) or Hostinger's official site navigation; this document does not assert a specific URL. If a subprocessor list is published, capture its date/version, not just a snapshot with no version marker.
- **Expected output:** legal entity name + registered address (from the invoice), and the DPA/ToS document title + version/date + subprocessor-list section (if one exists).
- **Sensitive-output redaction rule:** redact the invoice number, payment method/last-4 digits, and any billing contact personal data before storing or sharing a copy; keep only the legal-entity-name/address fields and the document title/version.
- **Remediation if absent:** if no DPA or subprocessor list is publicly available, request one directly from Hostinger support in writing (this becomes evidence itself — retain the correspondence) before any counsel review of the international-transfer question.

---

### 3.3 Host disk encryption

- **Claim:** the VPS's underlying disk/volume is encrypted at rest by the hosting provider or at the OS/LUKS level.
- **Current status:** `AWAITING_PROVIDER_EVIDENCE` (guest-OS portion partially checked, provider-layer portion still open). The §3.0 2026-07-28 operator pass ran the guest-OS checks below and found no `crypto_LUKS`/`crypt` device-mapper evidence visible from inside the guest — recorded as a **negative guest-visible signal only**. This does **not** close the claim: hypervisor/storage-backend-level encryption-at-rest (the layer Hostinger itself may apply) is invisible from inside the guest OS by design and can only be confirmed or ruled out by Hostinger hPanel evidence or a direct support-ticket answer, neither of which has been supplied yet. Was previously listed as an open item in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4 ("VPS disk/volume encryption status", "VPS provider (Hostinger) snapshot encryption settings").
- **Source of evidence:** operator shell session on the VPS, plus Hostinger hPanel if the provider documents host-level encryption-at-rest for its VPS product tier.
- **Command / provider document:**
  ```bash
  lsblk -f
  # LUKS-encrypted block devices show TYPE=crypt / crypto_LUKS in the output above.
  cryptsetup status "$(lsblk -no NAME,TYPE | awk '$2=="crypt"{print $1; exit}')" 2>/dev/null \
    || echo "no active dm-crypt/LUKS mapping found by this heuristic"
  # Confirms whether the root filesystem itself sits on an encrypted mapper device.
  findmnt -no SOURCE /
  ```
  Provider document: Hostinger hPanel → VPS plan/feature description, or a direct support-ticket question: "Is disk-at-rest encryption enabled by default for this VPS plan, and if so, at what layer (hypervisor/storage-backend) is it applied?"
- **Expected output:** either `crypto_LUKS`/`crypt` device-mapper evidence in `lsblk -f`/`findmnt`, or an explicit Hostinger statement of host-level encryption-at-rest (hypervisor/storage-backend level, which is invisible from inside the guest OS and can only be confirmed by asking the provider directly).
- **Sensitive-output redaction rule:** `lsblk`/`findmnt`/`cryptsetup status` output contains only device names/types/sizes — no filesystem content is read; safe to paste in full.
- **Remediation if absent:** if neither OS-level LUKS nor a provider statement of host-level encryption is found, this is a **confirmed gap**, not an inference — flag for a separate remediation task (candidate: LUKS-encrypt a new volume and migrate, or a provider plan upgrade that includes encryption-at-rest) rather than silently assuming Hostinger encrypts by default.

---

### 3.4 Filesystem/LUKS status if visible

- **Claim:** (sub-detail of 3.3) which specific filesystem(s)/mount points are covered by any LUKS mapping found.
- **Current status:** `AWAITING_OPERATOR_EVIDENCE`.
- **Source of evidence:** same operator session as 3.3.
- **Command / provider document:**
  ```bash
  lsblk -f -o NAME,FSTYPE,MOUNTPOINT,SIZE,TYPE
  cat /etc/crypttab 2>/dev/null || echo "/etc/crypttab absent or empty — no boot-time LUKS mapping configured"
  ```
- **Expected output:** a mapping table showing which mount points (`/`, `/var`, a separate data volume, etc.) sit on a `crypt` device vs. a plain block device.
- **Sensitive-output redaction rule:** none needed — device/mount metadata only.
- **Remediation if absent:** if `/var/www/noramedi` and PostgreSQL's data directory are on a plain (non-`crypt`) device while other mounts are encrypted, that is a partial-coverage gap worth recording explicitly rather than treating the VPS as uniformly encrypted or unencrypted.

---

### 3.5 Database local-only bind

- **Claim:** PostgreSQL only accepts connections from `localhost`/loopback, not from the public network interface.
- **Current status:** `VERIFIED_PRODUCTION_OBSERVED` — closed by the §3.0 2026-07-28 operator pass: `listen_addresses=localhost`, `port=5432`, and every observed application (`noramedi-api`/`noramedi-worker`) connection originated from `127.0.0.1` only, with no non-loopback source observed. Previously, repository evidence only established that the application's `DATABASE_URL` targets `localhost` by convention (`server/.env.example`) — it did not prove PostgreSQL itself was bound to loopback only; that gap is now closed.
- **Source of evidence:** operator shell session; `postgresql.conf`'s `listen_addresses`, `pg_hba.conf`'s accepted hosts, and the OS firewall.
- **Command / provider document:**
  ```bash
  sudo -u postgres psql -X -A -t -c "SHOW listen_addresses;"
  sudo -u postgres psql -X -A -t -c "SHOW port;"
  # External reachability check — run against the VPS's OWN public IP, not a
  # third-party target, and only checks TCP reachability, not auth.
  ss -tlnp 2>/dev/null | grep -E ':5432\b' || echo "port 5432 not found in local listen sockets"
  sudo ufw status 2>/dev/null || sudo iptables -L -n 2>/dev/null | grep -i 5432 || echo "no firewall rule reference to 5432 found by this heuristic"
  ```
- **Expected output:** `listen_addresses` of `localhost` (not `*`/`0.0.0.0`); `ss -tlnp` showing `127.0.0.1:5432`/`::1:5432` only, never a public-interface address.
- **Sensitive-output redaction rule:** `ss -tlnp` may show process PIDs/names — safe to include; do not run `-e` extended options that could surface more process environment detail.
- **Remediation if absent:** if `listen_addresses` includes `*` or the public interface IP, this is a critical exposure — restrict to `localhost` and pair with `pg_hba.conf` review immediately (treat as urgent, not routine, if found).

---

### 3.6 PostgreSQL SSL mode and active connections

- **Claim:** whether TLS is enabled/enforced for PostgreSQL connections, and what the application's actual negotiated connection mode is.
- **Current status:** `VERIFIED_PRODUCTION_OBSERVED` — closed by the §3.0 2026-07-28 operator pass: `SHOW ssl` returned `on`, and the operator's own connection at collection time showed `127.0.0.1`, `ssl=true`. This supersedes the prior inference (`server/.env.example`'s `DATABASE_URL` template carries no `sslmode` parameter, and `server/src/db.ts` per F0-006 evidence constructs the Prisma driver adapter directly from `DATABASE_URL` with no separate SSL override) — SSL is confirmed enabled and in use on the loopback connection, not merely assumed off-by-default.
- **Source of evidence:** operator shell session (`SHOW ssl`, `pg_stat_ssl`), repository code (`server/src/db.ts`, `server/.env.example`).
- **Command / provider document:**
  ```bash
  sudo -u postgres psql -X -A -t -c "SHOW ssl;"
  sudo -u postgres psql -d noramedi_crm -X -A -t -c "
    SELECT count(*) AS total_conns,
           count(*) FILTER (WHERE ssl) AS ssl_conns
    FROM pg_stat_ssl s JOIN pg_stat_activity a ON s.pid = a.pid
    WHERE a.datname = 'noramedi_crm';
  "
  grep -oE 'sslmode=[^&"[:space:]]+' "$APP_DIR/server/.env" 2>/dev/null || echo "no sslmode parameter found (Prisma DATABASE_URL query string, presence check only, no other DATABASE_URL content printed)"
  ```
  (`$APP_DIR` — confirm as `/var/www/noramedi` per the same convention as [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) §B; do not guess it.)

  > **Correction (independent review):** the original form of this check, `grep -E "^\s*sslmode="`, produces a false negative against this repository's actual `.env` layout. Prisma's `DATABASE_URL` embeds `sslmode` as a query parameter inside the connection-string URL (e.g. `DATABASE_URL=postgresql://user:pass@host/db?sslmode=require`) — the line begins with `DATABASE_URL=`, not `sslmode=`, so an anchored `^\s*sslmode=` never matches even when `sslmode` is present, silently reporting "no sslmode parameter found" regardless of the true value. The corrected command above uses `grep -oE` (only-matching mode) to extract just the `sslmode=<value>` token from anywhere in the file, stopping at `&`, an unescaped `"`, or whitespace — it never prints the rest of the `DATABASE_URL` line (host, credentials, database name), preserving the same redaction guarantee the original check intended.
- **Expected output:** `SHOW ssl` returns `on`/`off`; the `pg_stat_ssl` join shows `ssl_conns` vs. `total_conns` for the live `noramedi_crm` connections at the moment the query runs (a point-in-time snapshot, not a policy guarantee).
- **Sensitive-output redaction rule:** never print the full `DATABASE_URL` line — the `grep`/`sed` above only reports presence of the `sslmode` token, not its value or any credential in the connection string.
- **Remediation if absent:** since API and database currently run on the same host (loopback connection, confirmed topology), unencrypted local-loopback traffic is a materially lower-risk gap than an unencrypted network hop — but if this host ever splits into separate DB/app hosts, `sslmode=require` (or stricter) must be added to `DATABASE_URL` and `ssl=on` enabled in `postgresql.conf` before that split, not after.

---

### 3.7 Nginx TLS versions/ciphers/certificates

- **Claim:** which TLS protocol versions and cipher suites the host Nginx negotiates publicly, and the active certificate's issuer/expiry.
- **Current status:** partially `VERIFIED_PRODUCTION_OBSERVED` (certificate expiry and SAN coverage — `2026-09-26`, Let's Encrypt, SAN covers all 4 hostnames including `api.noramedi.com`, per [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md), [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §5, and re-confirmed for `api.noramedi.com` specifically by the §3.0 2026-07-28 operator pass). TLS protocol versions and cipher suite are still `AWAITING_OPERATOR_EVIDENCE` — the `ssl_protocols`/`ssl_ciphers`/`openssl s_client` negotiation checks in this row were not part of the §3.0 pass; prior evidence passes also deliberately did not request full Nginx config content (F0-006 evidence §4).
- **Source of evidence:** operator shell session (`nginx -T` grep'd narrowly) and an external TLS negotiation probe.
- **Command / provider document:**
  ```bash
  : "${PUBLIC_HOST:?Set PUBLIC_HOST to a confirmed hostname first, e.g. PUBLIC_HOST=api.noramedi.com}"

  # Narrow directive grep only — never the full config, never proxy_pass/upstream lines.
  sudo nginx -T 2>/dev/null | grep -E '^\s*(ssl_protocols|ssl_ciphers|ssl_prefer_server_ciphers|ssl_certificate\b|ssl_certificate_key)\b'

  # Negotiated protocol/cipher from an external client's perspective (read-only, no state change).
  echo | openssl s_client -connect "$PUBLIC_HOST:443" -servername "$PUBLIC_HOST" 2>/dev/null \
    | grep -E "Protocol|Cipher"
  echo | openssl s_client -connect "$PUBLIC_HOST:443" -servername "$PUBLIC_HOST" 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates
  ```
- **Expected output:** `ssl_protocols` limited to `TLSv1.2 TLSv1.3` (no `TLSv1`/`TLSv1.1`); a modern `ssl_ciphers` list; `ssl_certificate`/`ssl_certificate_key` **file paths only**; the `openssl s_client` negotiation confirming `TLSv1.3` (or `TLSv1.2` minimum) and a strong cipher; issuer/subject/dates consistent with the already-confirmed Let's Encrypt cert expiring `2026-09-26`.
- **Sensitive-output redaction rule:** report `ssl_certificate_key`'s **path only** — never its content, never attempt to read the file. Do not include any other `nginx -T` output beyond the five directive names grepped above (no `server_name`, `proxy_pass`, `upstream`, or `location` blocks — per the existing redaction rule already applied in [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) §J).
- **Remediation if absent:** if `TLSv1`/`TLSv1.1` are still permitted, remove them from `ssl_protocols` and reload Nginx (`nginx -t && systemctl reload nginx`) in a dedicated, separately-approved change — not as part of this evidence-only task.

---

### 3.8 API-to-database transport

- **Claim:** synthesis of 3.5/3.6 — characterizes the actual network path between `noramedi-api`/`noramedi-worker` and PostgreSQL.
- **Current status:** `VERIFIED_REPOSITORY` (mechanism) — both processes construct `DATABASE_URL`-based connections from the same host (F0-006 evidence §6); the actual loopback-vs-network path and SSL negotiation are `AWAITING_OPERATOR_EVIDENCE` per 3.5/3.6 above.
- **Source of evidence:** 3.5 + 3.6 combined; no separate command beyond those two.
- **Command / provider document:** none additional — this row is a synthesis row, not a new collection point.
- **Expected output:** confirmation that all API↔DB traffic stays on loopback (`127.0.0.1`/`::1`), never traverses the VPS's public interface, consistent with the single-host topology already confirmed in [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md).
- **Sensitive-output redaction rule:** n/a (synthesis row).
- **Remediation if absent:** if this host ever splits into separate application/database hosts (a change [RISK_REGISTER.md](../RISK_REGISTER.md) and [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) do not currently describe as planned), this row must be re-collected — loopback-only reasoning would no longer apply.

---

### 3.9 Backup encryption at rest

- **Claim:** whether the PostgreSQL `.dump` files in `/root/noramedi-backups` are encrypted at rest (independent of any disk-level encryption from 3.3).
- **Current status:** `AWAITING_OPERATOR_EVIDENCE`. Already flagged as an open, unverified item in [F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §9/§13 and `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4. The backup script itself (`/usr/local/sbin/noramedi-db-backup.sh`) is **not part of this repository** — only its client/trigger side (`server/src/services/backupService.ts`) is, so its actual encryption behavior cannot be determined by repository inspection alone.
- **Source of evidence:** operator shell session — inspect the backup script's contents (read-only `cat`, not execution) and a sample file's type.
- **Command / provider document:**
  ```bash
  BACKUP_SCRIPT="/usr/local/sbin/noramedi-db-backup.sh"
  test -r "$BACKUP_SCRIPT" && echo "backup script readable" || echo "backup script missing or unreadable"
  # Read-only: check for encryption tooling referenced in the script (gpg/openssl/age),
  # without printing the full script if it might embed a passphrase or key path.
  grep -Eo '\b(gpg|openssl enc|age)\b' "$BACKUP_SCRIPT" 2>/dev/null || echo "no gpg/openssl-enc/age reference found in backup script"

  # File-type probe on the newest matching backup — confirms plain vs. encrypted
  # container format without reading dump contents.
  BACKUP_DIR="/root/noramedi-backups"
  BACKUP_PATTERN='noramedi_crm-????????-??????.dump'
  LATEST_BACKUP=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$BACKUP_PATTERN" -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
  if [ -n "$LATEST_BACKUP" ]; then
    file "$LATEST_BACKUP"
  else
    echo "no matching backup file found"
  fi
  ```
- **Expected output:** either a `gpg`/`openssl enc`/`age` reference in the backup script (encryption present) and `file` reporting a non-plaintext/encrypted-container type, or no such reference and `file` reporting a plain PostgreSQL custom-format dump (`file`'s own description, e.g. "PostgreSQL custom database dump" — unencrypted).
- **Sensitive-output redaction rule:** do **not** print the full backup script if it contains any embedded passphrase, key path, or remote credential — the `grep -Eo` above extracts only the three tool-name tokens, never surrounding lines. Do not print the backup filename beyond what's needed to run `file` on it in the same command (do not separately list/echo filenames per the existing repository-wide backup-filename redaction rule).
- **Remediation if absent:** if no encryption tooling is referenced and `file` confirms a plain dump, this is a **confirmed gap** — a future task should add `gpg`/`age` encryption to the backup script before the dump is written to disk, with the decryption key stored outside the VPS itself (see 3.11).

---

### 3.10 Backup transfer encryption

- **Claim:** whether any backup transfer (VPS → offsite destination, if one exists) is itself encrypted in transit.
- **Current status:** `NOT_APPLICABLE` pending 3.11 — [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6 and [F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §9 already confirm **no offsite backup copy exists today** — `/root/noramedi-backups` is same-host only. There is currently no transfer to characterize.
- **Source of evidence:** same as 3.11 (an offsite destination must first be confirmed to exist before a transfer path can be evaluated).
- **Command / provider document:** run 3.11 first; if it produces evidence of an offsite copy mechanism (cron `rsync`/`scp`/`rclone`/S3-CLI job), re-open this row and inspect that mechanism's transport (e.g. `rsync -e ssh`, `aws s3 cp` over TLS, `rclone` config's `endpoint`/`use_ssl` field — read-only inspection only, no credential printed).
- **Expected output:** n/a until 3.11 changes status.
- **Sensitive-output redaction rule:** n/a until 3.11 changes status; if re-opened, apply the same "no credential, no key, no full config" rule as every other row here.
- **Remediation if absent:** this row's real remediation is 3.11's — implementing an offsite backup copy is the prerequisite; only then does a transfer-encryption question exist to answer.

---

### 3.11 Off-host backup location / disaster-recovery copy location

- **Claim:** whether any backup or disaster-recovery copy of the database (or of `server/uploads/`) exists outside the production VPS.
- **Current status:** `VERIFIED_PRODUCTION_OBSERVED` (absence) — already confirmed absent by [F0-002_PRODUCTION_BASELINE_EVIDENCE.md](F0-002_PRODUCTION_BASELINE_EVIDENCE.md) and restated in [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6/§9 and [RISK_REGISTER.md](../RISK_REGISTER.md) (F0-006 drift-table row 9). This package re-confirms rather than re-discovers, and adds an uploads-specific check not previously run.
- **Source of evidence:** operator shell session — a fresh re-check plus an uploads-specific pass, since prior evidence covered the database backup only.
- **Command / provider document:**
  ```bash
  # Re-confirm no offsite database-backup mechanism exists (cron/systemd only —
  # does not read job content, only names/paths for anything referencing noramedi/backup).
  grep -l -i "backup\|rsync\|s3\|rclone\|offsite" /etc/cron.d/* 2>/dev/null
  systemctl list-timers 2>/dev/null | grep -i -E "backup|sync|offsite"
  crontab -l 2>/dev/null | grep -i -E "backup|rsync|s3|rclone" || echo "no matching root crontab entries found"

  # Uploads directory — is it included in ANY off-host copy mechanism? (presence/absence only)
  test -d /var/www/noramedi/server/uploads && du -sh /var/www/noramedi/server/uploads 2>/dev/null
  ```
- **Expected output:** either continued absence (no matching cron/systemd/crontab entry, consistent with prior findings), or a newly-discovered offsite job — in which case 3.10 must be re-opened for that job's transport.
- **Sensitive-output redaction rule:** report only job **names/schedules found**, never a job's full command line if it embeds a credential, bucket name with an implied account, or destination hostname beyond what's needed to identify "an offsite copy exists" as a yes/no fact.
- **Remediation if absent:** implement an offsite/object-storage backup copy for both the database dump and `server/uploads/` — this is already tracked as a `HIGH` risk in [RISK_REGISTER.md](../RISK_REGISTER.md) (F0-006 drift-table rows 5/9) and as F0-011 (Object Storage and Backup Migration Design); this package does not duplicate that design work, only re-confirms the gap it addresses.

---

### 3.12 Object-storage region/encryption

- **Claim:** if/when S3-compatible object storage is enabled (`S3_BUCKET` set), its region and server-side-encryption configuration.
- **Current status:** `NOT_APPLICABLE` today — production confirmed running `LOCAL_VPS_STORAGE` with `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` all `MISSING` (F0-002 Stage B, restated [PRODUCTION_TOPOLOGY.md](../PRODUCTION_TOPOLOGY.md) §6). No object storage exists to evaluate.
- **Source of evidence:** re-confirm presence/absence only (reuses the existing `check_var` pattern from [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) §G).
- **Command / provider document:**
  ```bash
  ENV_FILE="/var/www/noramedi/server/.env"
  for var in S3_BUCKET S3_REGION S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    grep -qE "^${var}=" "$ENV_FILE" 2>/dev/null && echo "$var: SET" || echo "$var: MISSING"
  done
  ```
- **Expected output:** all `MISSING`, consistent with prior evidence — if any report `SET`, this row must be escalated into a full evidence row (bucket region, default encryption setting, via the storage provider's own console) rather than left `NOT_APPLICABLE`.
- **Sensitive-output redaction rule:** presence/absence only, never the value — identical rule to [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) §G.
- **Remediation if absent:** none needed while `NOT_APPLICABLE`; this row becomes active only once F0-011's object-storage migration actually ships.

---

### 3.13 SSH and administrative access

- **Claim:** how administrative (SSH) access to the VPS is controlled — authentication method, root-login policy, and who currently has access.
- **Current status:** `AWAITING_OPERATOR_EVIDENCE`. Not previously collected in any evidence file; [F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §10 already confirms both PM2 processes run as `root`, which raises the stakes of this row without previously checking it directly.
- **Source of evidence:** operator shell session — `sshd_config` policy directives and a **count only** of authorized keys/accounts.
- **Command / provider document:**
  ```bash
  grep -E '^\s*(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port|MaxAuthTries)\b' /etc/ssh/sshd_config 2>/dev/null

  # Counts only — never key material, comments, or usernames tied to a specific person beyond the account name itself.
  for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [ -f "$f" ] && echo "$f: $(grep -c '^ssh-' "$f") key(s)"
  done 2>/dev/null

  # System accounts that can actually log in (login shell not nologin/false) — names only.
  awk -F: '$7 !~ /nologin|false/ {print $1}' /etc/passwd

  # fail2ban / brute-force mitigation presence
  systemctl is-active fail2ban 2>/dev/null || echo "fail2ban not active or not installed"
  ```
- **Expected output:** `PermitRootLogin no` (or `prohibit-password`), `PasswordAuthentication no`, `PubkeyAuthentication yes`; a small, known count of authorized keys per account; `fail2ban` (or equivalent) active.
- **Sensitive-output redaction rule:** never print actual key material (only the `-c` count), never print a non-standard SSH `Port` value if the operator considers it sensitive obscurity (report `SET`/present vs. default `22`, similar to other presence-only rows, if the operator prefers not to disclose the exact port), never print `/etc/passwd` fields beyond the username column.
- **Remediation if absent:** if `PermitRootLogin`/`PasswordAuthentication` allow password-based root login, this is a **critical finding** — harden `sshd_config` and restart `sshd` in a dedicated, separately-approved change, not as part of this evidence task. Combined with 3.3/§10's confirmed root-owned PM2 processes, weak SSH hardening plus root-owned application processes compounds into a single-point-of-failure risk worth flagging together.

---

### 3.14 Secret-file permissions

- **Claim:** filesystem permissions on `server/.env` (and any other secret-bearing file) restrict read access to the owning user/process only.
- **Current status:** `VERIFIED_PRODUCTION_OBSERVED` — closed by the §3.0 2026-07-28 operator pass: `server/.env` is mode `600`, owned `root:root`, consistent with the already-confirmed root-owned PM2 processes (F0-006 evidence §10). Previously listed as an open item in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4 ("`server/.env` file permissions... and production `ENCRYPTION_KEY` fail-closed behavior") and [F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md](F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md) §10/§13; that gap is now closed for the permission question (fail-closed `ENCRYPTION_KEY` behavior itself was already `VERIFIED_REPOSITORY` separately). `ENCRYPTION_KEY`'s fail-closed startup behavior itself is already `VERIFIED_REPOSITORY` (`server/src/index.ts:75-89`, per F0-006 evidence §5) — only the filesystem-permission question is open here.
- **Source of evidence:** operator shell session.
- **Command / provider document:**
  ```bash
  APP_DIR="/var/www/noramedi"
  stat -c '%a %U:%G' "$APP_DIR/server/.env" 2>/dev/null || echo "server/.env not found at expected path"
  # Also check the directory itself is not world-readable/traversable in a way that exposes the file.
  stat -c '%a %U:%G' "$APP_DIR/server" 2>/dev/null
  stat -c '%a %U:%G' "$APP_DIR" 2>/dev/null
  ```
- **Expected output:** `.env` mode `600` (or `640` at most) owned by the account PM2 runs as (confirmed `root` per prior evidence — so `600 root:root` is the expected-tightest finding given the already-confirmed root-owned processes); parent directories not world-writable.
- **Sensitive-output redaction rule:** `stat` output here is metadata only (mode/owner) — safe to paste in full; never `cat`/open the file itself as part of this check.
- **Remediation if absent:** if `.env` is group/world-readable (e.g. `644`+), tighten to `600` immediately — this is a low-effort, high-value fix independent of any larger secrets-management change (see 3.15's remediation, which is a larger, separate undertaking).

---

### 3.15 Secret storage (beyond file permissions) and key rotation policy

- **Claim:** how application secrets (`JWT_SECRET`, `PLATFORM_JWT_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `SECURITY_SIGNAL_IP_HASH_SECRET`, webhook secrets, etc.) are stored and whether any rotation policy/schedule exists.
- **Current status:** `AWAITING_OPERATOR_EVIDENCE` for the deployed reality; `VERIFIED_REPOSITORY` for the mechanism — all such secrets are plain environment variables in `server/.env` (per `server/.env.example`'s structure and every secret-consuming module's `process.env.*` reads); **no secrets-manager integration (Vault, AWS/GCP Secrets Manager, SOPS, etc.) exists anywhere in the repository**, and **no key-rotation mechanism, schedule, or documentation exists in the repository** — `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4 already lists "Key rotation policy" as an outstanding item with no further detail.
- **Source of evidence:** repository-wide check for any secrets-manager dependency (already effectively confirmed absent by the absence of any such package in `server/package.json`, not re-verified with a new command here) plus an operator confirmation that production has not layered on an out-of-repository secrets manager.
- **Command / provider document:**
  ```bash
  # Confirms production hasn't wired in a secrets manager the repository doesn't know about.
  systemctl list-units 2>/dev/null | grep -i -E "vault|secrets-manager" || echo "no vault/secrets-manager systemd unit found"
  which vault 2>/dev/null || echo "no 'vault' binary on PATH"
  ```
- **Expected output:** no secrets-manager unit or binary found, confirming the plain-`.env` model is the actual production reality (matching repository evidence) rather than an undocumented layer this repository doesn't reflect.
- **Sensitive-output redaction rule:** none needed — presence/absence of a tool, not a value.
- **Remediation if absent:** this is a **known, already-tracked architectural gap**, not something this evidence task can remediate. A future dedicated task should: (a) define a rotation cadence for each secret class, (b) evaluate a secrets-manager migration (or, at minimum, a documented manual-rotation runbook with `pm2 reload --update-env` as the activation step, consistent with the existing deploy script's pattern), and (c) confirm rotation doesn't invalidate data encrypted under the current `ENCRYPTION_KEY` without a migration path (per `server/src/index.ts`'s fail-closed check, an `ENCRYPTION_KEY` rotation is not currently a supported operation — this would need its own design, not an ad-hoc rotation).

---

### 3.16 Log storage and access

- **Claim:** where PM2/Nginx/PostgreSQL logs are stored, their retention/rotation policy, and who/what can read them; whether any patient data reaches them.
- **Current status:** `AWAITING_OPERATOR_EVIDENCE` — never previously collected.
- **Source of evidence:** operator shell session; repository evidence on what the application itself logs (out of scope to re-derive here beyond noting the security-signal sanitization rules already documented in `docs/compliance/55-kvkk-security-incident-response-foundation.md` §6, which govern the *security-incident* log path specifically, not general PM2/Nginx access logs).
- **Command / provider document:**
  ```bash
  pm2 conf 2>/dev/null | grep -iE "log" ; ls -la ~/.pm2/logs 2>/dev/null | head -20
  test -d /var/log/nginx && ls -la /var/log/nginx | head -20
  # Rotation policy presence
  test -f /etc/logrotate.d/nginx && echo "nginx logrotate config present"
  find /etc/logrotate.d -iname "*pm2*" -o -iname "*noramedi*" 2>/dev/null
  # Permissions on the log directories themselves (not file contents)
  stat -c '%a %U:%G' ~/.pm2/logs 2>/dev/null
  stat -c '%a %U:%G' /var/log/nginx 2>/dev/null
  ```
- **Expected output:** log directory listings (filenames/sizes/dates only, not content), confirmation of a `logrotate` policy for both PM2 and Nginx logs, and permission modes restricting read access to the appropriate account (not world-readable).
- **Sensitive-output redaction rule:** list **filenames and sizes only** — do not `cat`/`tail` any log file's content as part of this evidence pass (a log line could contain an IP, a stack trace, or — if a bug exists — inadvertent request data). If log content review is needed later, that is a separate, more carefully-scoped task with its own redaction plan.
- **Remediation if absent:** if no `logrotate` policy exists, logs grow unbounded — add one. If log directories are world-readable, tighten permissions. If a later, separate content-review task finds patient data leaking into general access logs, that becomes its own KVKK-tracked finding, not something to fix inside this evidence package.

---

## 4. Consolidated operator command bundle

Run Sections 3.1–3.16's commands in one interactive SSH session, in the order above (top to bottom) — later sections don't depend on earlier ones the way [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md)'s sections do, except that 3.7's `PUBLIC_HOST` must be set before its own commands run:

```bash
: "${APP_DIR:=/var/www/noramedi}"
export APP_DIR
test -d "$APP_DIR" && echo "APP_DIR confirmed: $APP_DIR" || echo "STOP — $APP_DIR not found, confirm the real path before continuing"

: "${PUBLIC_HOST:?Set PUBLIC_HOST to a confirmed public hostname before running §3.7, e.g. PUBLIC_HOST=api.noramedi.com}"
export PUBLIC_HOST
```

Then run each subsection's command block in turn, reviewing output against that subsection's redaction rule **before** pasting anything back into this conversation or into any other tool (ChatGPT, a ticket, a shared doc).

> ⚠️ **Review every block's output before sharing**, exactly as [F0-002_PRODUCTION_EVIDENCE_REQUEST.md](F0-002_PRODUCTION_EVIDENCE_REQUEST.md) already warns: remove any secret, token, password, connection string, private key, patient name, phone number, email address, clinical data, or private object/file path before returning results.

## 5. Ordered evidence-collection sequence (operator-facing summary)

1. **Provider console first** (§3.1, §3.2): capture Hostinger datacenter/location field and billing legal-entity name; locate the DPA/ToS/subprocessor document.
2. **SSH in once**, set `APP_DIR` and `PUBLIC_HOST` (§4 preamble).
3. **Disk/filesystem** (§3.3, §3.4): `lsblk -f`, `cryptsetup status`, `findmnt`, `/etc/crypttab`.
4. **Database network exposure and transport** (§3.5, §3.6, §3.8): `listen_addresses`, `ss -tlnp`, firewall rule check, `SHOW ssl`, `pg_stat_ssl` join, `sslmode` presence check.
5. **Public TLS** (§3.7): `nginx -T` narrow grep, `openssl s_client` protocol/cipher/cert probe.
6. **Backup encryption and location** (§3.9, §3.10, §3.11): backup-script tooling grep, `file` on the latest dump, offsite-copy re-check, uploads-directory check.
7. **Object storage** (§3.12): `S3_*` presence-only check (expected all `MISSING` today).
8. **Administrative access** (§3.13): `sshd_config` policy grep, key counts, login-capable accounts, `fail2ban` status.
9. **Secret storage** (§3.14, §3.15): `.env`/directory permission `stat`, secrets-manager unit/binary absence check.
10. **Logs** (§3.16): PM2/Nginx log directory listings, `logrotate` presence, directory permissions.
11. **Review all output** against each subsection's redaction rule, then return it for this evidence file to be updated from `AWAITING_OPERATOR_AND_PROVIDER_EVIDENCE` to a per-row-classified state.

## 6. What this document does not establish

- Whether any observed gap is legally acceptable under KVKK/GDPR — that determination remains Turkish legal counsel's, exactly as `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`'s own disclaimer states.
- Whether Hostinger's contractual terms satisfy an Art. 9 international-transfer mechanism — that is the separate, already-tracked "International transfer mechanism selection" legal dependency (§3 of the compliance tracker), not resolved by collecting a datacenter-location fact.
- A remediation timeline or priority ranking across the gaps this package may surface — that belongs in `docs/program/RISK_REGISTER.md`, updated by a separate task once this evidence exists to risk-rank.
- Production system changes of any kind — every command above is read-only; none restarts a service, alters a file, rotates a secret, or migrates data.

## 7. Files touched by this delivery

Only this file (`docs/program/evidence/INFRA_ENCRYPTION_RESIDENCY_EVIDENCE_001.md`) was created. No application source, schema, migration, package manifest, lockfile, test, CI workflow, deployment script, Nginx file, environment file, or runtime configuration was modified. No central tracker (`NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `CURRENT_PHASE.md`, `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md`) was modified by this task. No production system was accessed by this agent — all commands above are provided for a human operator to run themselves.

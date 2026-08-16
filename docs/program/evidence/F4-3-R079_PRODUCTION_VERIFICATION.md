# F4-3-R079 — Production verification and closure of `R-079`

**Task:** `F4-3-R079-CLOSE` · **Phase:** F4 / F4-3 · **Date:** 2026-08-16
**Type:** documentation-only closure record. No runtime file, schema, migration,
test, CI or deployment script was changed by this task.

This document records the production verification that transitions **`R-079`
only** from `CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT` to **`CLOSED`**.
**Record status: this document is carried by PR #432, which is `DRAFT` and
`NOT MERGED` — it is a proposed record awaiting merge into authoritative
`main`.** That is a separate fact from the status of the underlying `R-079`
implementation (PR #431), which *is* merged, deployed and production-verified;
see §4 for the two lifecycles stated separately.
It closes nothing else. `R-080` stays `OPEN`; `R-030` / `R-030-DB` /
`R-030-FILES` stay `OPEN`; `FIRST_CUSTOMER_RECOVERY_GATE` is unchanged
(`NOT_SATISFIED`, blocked by `R-030-DB`); the `F4` phase is **not** complete.

## 1. Release and migration

| Item | Value |
|---|---|
| Production host | `disklinik-prod-01` |
| Production release SHA | `b370b0181fa2f84e24f0f80560425da81f60dcb2` (merge commit of PR #431) |
| Prior merged implementation | PR #430 (storage-deletion evidence), PR #431 (`LabOrderAttachment` legal hold, `R-079`) |
| Migration | `20260816130000_add_lab_order_attachment_legal_hold` |
| Prisma migration state | **75 migrations found; database schema is up to date** |

**Production schema verification:**

- `LabOrderAttachment.legalHold` — type `boolean`, nullable `NO`, default `false`
- `LabOrderAttachment.legalHoldReason` — type `text`, nullable `YES`
- Index `LabOrderAttachment_clinicId_legalHold_idx` — `CREATE INDEX` on `("clinicId", "legalHold")`

**Deployment evidence:**

- Prisma Client generated with **v7.9.1**
- `noramedi-api` reloaded; `noramedi-worker` reloaded; both processes online
- Both `RELEASE_SHA` values matched `b370b0181fa2f84e24f0f80560425da81f60dcb2`

**Health:**

- local `/api/health` → HTTP `200` `{"status":"ok"}`
- local `/api/readyz` → HTTP `200`; `database: ok`; `redis: ok`
- external `https://api.noramedi.com/api/health` → HTTP `200`

## 2. Verification subject (tenant, actor, records)

| Item | Value |
|---|---|
| Clinic slug | `gebzedisdunyasi` |
| Clinic id | `5211acf4-6a1c-49ec-a23b-a677b89133ea` |
| Tenant nature | **Demo clinic — no real customer is live.** No real customer data was used. |
| Actor user id | `0a711de6-d860-4198-be2c-ffbe8195d581` |
| Stored role | `admin`, `canAccessAllClinics: true` |
| Canonical role | Per central role normalization, legacy `admin` + `canAccessAllClinics=true` ⇒ canonical **`OWNER`** |
| Lab work order | `ebd3ca0c-5502-4464-b34b-735ecedf2b5d` |
| Lab attachment | `d2394a45-6d03-48db-a736-d1ac5179d7d5` |
| Initial state | `legalHold=false` |

Production storage mode during verification: **`remoteStorageEnabled=false`**
(local storage mode). This verification therefore says nothing about remote
object storage and must **not** be read as F4-1 / F4-2 progress.

## 3. Verification steps and results

### 3.1 Legal hold set — **PASS**

`PATCH /api/lab-orders/:workOrderId/attachments/:attachmentId/legal-hold`
Request: `legalHold=true`, `reason="F4-3 R-079 production verification"`
Response: HTTP `200`, `legalHold=true`
DB after PATCH: `legalHold=true`, `legalHoldReason="F4-3 R-079 production verification"`

### 3.2 Delete blocked — **PASS**

`DELETE /api/lab-orders/ebd3ca0c-5502-4464-b34b-735ecedf2b5d/attachments/d2394a45-6d03-48db-a736-d1ac5179d7d5`
Response: HTTP `409`
Body: `{"error": "ATTACHMENT_LEGAL_HOLD", "message": "This attachment is under legal hold and cannot be deleted."}`

### 3.3 DB preservation — **PASS**

After the blocked DELETE the attachment row still existed; `legalHold=true`;
`legalHoldReason` remained persisted.

### 3.4 Audit evidence — **PASS**

`AuditLog` entries observed:

- `lab_order_attachment_legal_hold_set` — `actorUserId: 0a711de6-d860-4198-be2c-ffbe8195d581`,
  `actorRole: admin`, metadata `newLegalHold=true`, `previousLegalHold=false`,
  `labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`
- `lab_order_attachment_delete_blocked_legal_hold` — same actor, metadata
  `labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`

### 3.5 Physical storage preservation — **PASS**

Persisted `filePath`: `5211acf4-6a1c-49ec-a23b-a677b89133ea/1783356895177-5rowfgf37dr.png`
Production storage mode during verification: `remoteStorageEnabled=false`
Application storage-abstraction verification: `fileExists=true`, `fileSize=525254`, `exit_code=0`

This proves the blocked DELETE preserved the physical object.

### 3.6 Legal hold release / cleanup — **PASS**

`PATCH .../legal-hold` with `legalHold=false`,
`reason="F4-3 R-079 production verification cleanup"`
Response: HTTP `200`, `legalHold=false`
Final DB: `legalHold=false`

Release audit: `lab_order_attachment_legal_hold_released` —
`actorUserId: 0a711de6-d860-4198-be2c-ffbe8195d581`, `actorRole: admin`,
metadata `newLegalHold=false`, `previousLegalHold=true`,
`labWorkOrderId=ebd3ca0c-5502-4464-b34b-735ecedf2b5d`

Final physical object state: `fileExists=true`, `fileSize=525254`, `exit_code=0`

### Recorded nuance — `legalHoldReason` is not nulled on release

Releasing the hold **did not null** `legalHoldReason`. The final DB value is
`"F4-3 R-079 production verification cleanup"` — the *release* reason. This is
the accepted current behaviour for this closure and is **not** an `R-079`
failure: the field records the reason for the last legal-hold transition in
either direction, and both directions are separately audited. No statement
anywhere in this repository may claim the field was cleared or set to `null`.

## 4. Lifecycle — two of them, kept separate

These are **two different lifecycles** and must never be collapsed into one
list. The first belongs to the *fix*; the second belongs to *this document*.

### 4.1 IMPLEMENTATION LIFECYCLE — PR #431

- agent completed: **YES**
- tests passed: **YES**
- PR opened: **YES**
- merged: **YES**
- deployed: **YES**
- production verified: **YES**
- → **the `R-079` closure criteria are satisfied**

### 4.2 CLOSURE-RECORD LIFECYCLE — `F4-3-R079-CLOSE` / PR #432

- agent completed: **YES**
- docs validation: **PASS**
- PR opened: **YES**
- PR state: **DRAFT**
- merged: **NO**
- deployment: **N/A (documentation-only)**
- production mutation: **NONE**

`R-079` is represented as **`CLOSED`** in this proposed documentation because
its underlying implementation has already been merged, deployed and
production-verified (§4.1). **PR #432 is the documentation record itself, and
it is still awaiting merge into authoritative `main`.** Nothing in this
document may be read as a claim that the closure *record* is merged or
deployed.

## 5. What this record does NOT establish

- **`R-080` remains `OPEN`** — durable deletion intent, automatic retry and
  reverse-orphan detection are untouched and unverified.
- **No provider object-lock / immutability** is enabled or claimed.
- **No hard-delete / durable delete queue / auto retry / reverse orphan scan**
  is claimed to exist.
- **No backup implication.** §16A stands unchanged: primary object deletion is
  not backup deletion, and a legal hold on a primary row says nothing about
  pgBackRest repositories or `pg_dump` artifacts.
- **No remote object-storage progress.** Verification ran with
  `remoteStorageEnabled=false`; F4-1 / F4-2 objectives are unaffected.
- **No UI.** The hold is still placed and released through the API only.
- **`F4` is not complete**, `R-030`/`R-030-DB`/`R-030-FILES` stay `OPEN`, and
  `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` with `R-030-DB` as the
  recovery blocker.

## 6. Rollback

Documentation-only change — revert the commit. Runtime rollback for the
underlying implementation remains **application-first**: the migration is
additive (`ADD COLUMN` ×2, `CREATE INDEX` ×1) and the columns are inert to any
build that never reads them. Dropping columns in production is **not** the
immediate rollback path.

## 7. Related records

- [../RISK_REGISTER.md](../RISK_REGISTER.md) — `R-079` row (`CLOSED`), `R-080` row (`OPEN`)
- [../NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) — §12 item 30, §13
- [../phases/F4_STORAGE_AND_BACKUP.md](../phases/F4_STORAGE_AND_BACKUP.md) — F4-3-R2 section
- [../../compliance/53-kvkk-attachment-imaging-lifecycle.md](../../compliance/53-kvkk-attachment-imaging-lifecycle.md) — §16B

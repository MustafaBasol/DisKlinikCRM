# Sprint 23 — Instagram DM Integration

## Overview

This sprint adds Instagram Direct Messages as a second messaging channel alongside WhatsApp. Clinic staff can now receive, view, reply to, and convert Instagram DM appointment requests directly from the CRM panel.

---

## Architecture Decision: Option B (Dedicated Models)

Instagram uses **separate, dedicated database models** rather than extending the existing WhatsApp models. This was chosen to:

- Avoid any risk of disrupting the existing WhatsApp channel (which is production-ready).
- Allow each channel's schema to evolve independently.
- Keep provider-specific configuration fields cleanly separated.

---

## Meta / Instagram Prerequisites

Before using this feature, the clinic must:

1. Have a **Professional (Business or Creator) Instagram account**.
2. **Connect the Instagram account to a Facebook Page** (required for Messaging API access).
3. Create a **Meta App** at [developers.facebook.com](https://developers.facebook.com/) with:
   - `instagram_manage_messages` permission
   - `pages_messaging` permission
4. Generate a **Page Access Token** with the above permissions.
5. Configure the webhook in the Meta App:
   - **Callback URL**: `https://your-domain.com/api/public/instagram/webhook`
   - **Verify Token**: The token shown in the CRM connection card
   - **Subscribed Fields**: `messages`

> **Note**: External Meta App approval (`instagram_manage_messages`) requires Meta's business verification for production use. In sandbox/development mode, only testers added to the Meta App can send messages.

---

## Database Models Added

### `InstagramConnection`
Stores organization-level Instagram channel credentials.

| Field | Type | Description |
|---|---|---|
| `instagramAccountId` | String | Numeric Instagram account ID (IGSID) |
| `instagramUsername` | String? | Handle (without @) for display |
| `facebookPageId` | String? | Connected Facebook Page ID |
| `accessTokenEncrypted` | String? | AES-256-GCM encrypted Page Access Token |
| `webhookVerifyToken` | String? | Random token for Meta webhook verification |
| `webhookSecret` | String? | Encrypted App Secret for X-Hub-Signature-256 validation |
| `tokenStatus` | String? | `valid`, `expired`, `unknown` |
| `status` | String | `connected` / `disconnected` / `connecting` / `error` |
| `isActive` | Boolean | Master on/off switch |

### `ClinicInstagramConnection`
Many-to-many junction: links an `InstagramConnection` to one or more `Clinic` branches.

### `InstagramInboxEntry`
One record per unique sender (conversation thread).

| Field | Type | Description |
|---|---|---|
| `externalSenderId` | String | Instagram sender's IGSID |
| `senderUsername` | String? | Instagram handle if resolvable |
| `lastMessageText` | String? | Preview of last message |
| `messageCount` | Int | Total messages received |
| `needsClinicResolution` | Boolean | True when multiple clinics = manual assignment needed |
| `status` | String | `open` / `resolved` / `ignored` |
| `clinicId` | String? | Assigned clinic |
| `patientId` | String? | Linked patient record |

---

## Backend Endpoints Added

### Organization Instagram Connections (`/api/organization/instagram-connections`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/organization/instagram-connections` | OWNER, ORG_ADMIN | List all connections (tokens stripped) |
| POST | `/api/organization/instagram-connections` | OWNER, ORG_ADMIN | Create new connection |
| GET | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Get single connection |
| PUT | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Update (empty token = preserve existing) |
| POST | `/api/organization/instagram-connections/:id/test` | OWNER, ORG_ADMIN | Test Meta API connection |
| POST | `/api/organization/instagram-connections/:id/disconnect` | OWNER, ORG_ADMIN | Mark disconnected |
| PATCH | `/api/organization/instagram-connections/:id/status` | OWNER, ORG_ADMIN | Toggle isActive |
| DELETE | `/api/organization/instagram-connections/:id` | OWNER, ORG_ADMIN | Delete connection |

### Clinic Instagram Assignment (`/api/clinics/:clinicId/instagram`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/clinics/:clinicId/instagram` | List connections for clinic |
| PUT | `/api/clinics/:clinicId/instagram` | Set assigned connections |
| DELETE | `/api/clinics/:clinicId/instagram/:connectionId` | Unassign connection |

### Instagram Inbox (`/api/instagram/inbox`)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/instagram/inbox/unassigned` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Entries needing manual clinic assignment |
| GET | `/api/instagram/inbox/conversations` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | All conversations (filterable by status/clinic) |
| POST | `/api/instagram/inbox/:id/resolve` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Assign clinic + link patient |
| POST | `/api/instagram/inbox/:id/link-patient` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Link patient to existing entry |
| POST | `/api/instagram/inbox/:id/assign-clinic` | OWNER, ORG_ADMIN, CLINIC_MANAGER | Assign/change clinic |
| POST | `/api/instagram/conversations/:id/reply` | OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST | Send reply via Meta API |

### Public Webhook (`/api/public/instagram/...`)

No authentication — called by Meta's servers.

| Method | Path | Description |
|---|---|---|
| GET | `/api/public/instagram/webhook` | Global webhook verification challenge |
| POST | `/api/public/instagram/webhook` | Global incoming DM receiver |
| GET | `/api/public/instagram/:connectionId/webhook` | Per-connection webhook verification |
| POST | `/api/public/instagram/:connectionId/webhook` | Per-connection incoming DM receiver |

Webhooks always respond `200 OK` immediately (Meta retries on non-2xx).

---

## Permission Matrix

| Permission | OWNER | ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST | BILLING | DOCTOR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Manage connections | ✓ | ✓ | — | — | — | — |
| Assign to clinic | ✓ | ✓ | ✓ | — | — | — |
| View connection status | ✓ | ✓ | ✓ | — | — | — |
| View inbox | ✓ | ✓ | ✓ | ✓ | — | — |
| Reply messages | ✓ | ✓ | ✓ | ✓ | — | — |
| Resolve conversations | ✓ | ✓ | ✓ | — | — | — |

---

## Frontend Pages Added

### `src/pages/InstagramConnections.tsx`
- Route: `/organization/instagram`
- Lists all Instagram connections with status badges
- Add / Edit modal with: name, account ID, username, Facebook Page ID, access token (write-only), verify token, webhook secret, Meta App ID, clinic assignment checkboxes
- Actions: Test connection, Toggle active, Disconnect, Delete
- Expandable detail panel: webhook URL + verify token (copy buttons), last connection time, assigned clinics
- Setup guide banner with Meta docs link

### `src/pages/InstagramInbox.tsx`
- Route: `/instagram-inbox`
- Two tabs: **Atanmamış** (unassigned, requires manual clinic assignment) / **Tüm Konuşmalar** (all, filterable)
- Conversation cards: sender @handle, last message preview, message count, status badge, assigned clinic/patient
- Actions: **Yanıtla** (reply modal with 1000-char limit), **Şube Ata** (assign clinic), **Hasta Bağla** (link patient)
- Resolve modal: clinic selector + patient search (name/phone)

---

## Sidebar Navigation

Added to **İletişim** nav group (after WhatsApp items):
- **Instagram Gelen Kutusu** — visible to OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST
- **Instagram Bağlantıları** — visible to OWNER, ORG_ADMIN, CLINIC_MANAGER

---

## Tests

File: `server/src/tests/instagramProvider.test.ts`  
Run: `npm run test:instagram` (from `server/` directory)

**30 tests, all passing:**
- Encryption round-trip
- `parseWebhook`: text message, echo, non-instagram object, null input, empty messaging
- `testConnection`: missing token, inactive connection
- `sendMessage`: empty text, missing account ID, truncation behavior
- Permission helpers: all 6 functions across OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/BILLING
- HMAC signature validation

---

## Clinic Auto-Assignment Logic

When a webhook arrives:
1. Look up which `InstagramConnection` it belongs to (by `connectionId` in URL, or by matching `recipientId` in payload).
2. Find all clinics linked to that connection (`ClinicInstagramConnection`).
3. If **exactly one clinic** → auto-assign `clinicId`, `needsClinicResolution = false`.
4. If **zero or multiple clinics** → create entry with `needsClinicResolution = true` → appears in unassigned inbox tab.
5. Create/update `InstagramInboxEntry` (upsert on `externalSenderId + instagramConnectionId`).

---

## Security Notes

- Access tokens and webhook secrets are **AES-256-GCM encrypted at rest** (same `encryptSecret` / `decryptSecret` as WhatsApp).
- Tokens are **never returned to the client** — all GET endpoints sanitize the response.
- Cross-organization access is blocked on every route (all DB queries include `organizationId` filter).
- Webhook signature is validated via HMAC SHA-256 (`X-Hub-Signature-256` header) when `webhookSecret` is set.
- No sensitive health data is sent via Instagram DM replies.

---

## Known Limitations (MVP)

- **Text messages only** — media (images, audio, stickers, video) are ingested as `unsupported` event type (not displayed to staff, not blocked).
- **No AI parsing** of appointment intent — staff must manually identify appointment requests.
- **No appointment conversion button** yet — staff can link to a patient, then create the appointment separately.
- **No read receipts** — the CRM does not send `seen` events back to Meta.
- **External Meta approval required** — `instagram_manage_messages` requires Meta business verification for non-sandbox use.
- **Token refresh** — long-lived tokens should be refreshed before expiry; no automated refresh in this sprint.

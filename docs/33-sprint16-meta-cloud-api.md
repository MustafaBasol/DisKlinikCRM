# Sprint 16 — Meta Cloud API: Embedded Signup & Official WhatsApp Provider

## Overview

Sprint 16 completes the Meta Cloud API WhatsApp provider integration.
The system now supports two official providers:

| Provider | Connection method | QR code |
|---|---|---|
| `evolution_api` | Instance URL + API key | Yes |
| `meta_cloud_api` | Embedded Signup OAuth flow or manual token | No |

---

## Meta Prerequisites

1. **Meta Business Account** — verified business in Meta Business Manager.
2. **WhatsApp Business Account (WABA)** — linked to the business.
3. **Phone Number** — verified, not shared with another WABA.
4. **Meta App** — type "Business", with WhatsApp product added.
5. **Permissions** — `whatsapp_business_management`, `whatsapp_business_messaging`.

---

## Required Environment Variables

### Backend (`server/.env`)

```env
# Meta Cloud API
META_APP_ID=123456789
META_APP_SECRET=abc123...
META_GRAPH_API_VERSION=v23.0
META_EMBEDDED_SIGNUP_CONFIG_ID=   # optional — your Meta Embedded Signup config ID
META_REDIRECT_URI=https://yourapp.com/api/organization/whatsapp-connections/meta/callback
META_WEBHOOK_VERIFY_TOKEN=your-random-verify-token-here

# AES-256-GCM key for encrypting access tokens (generate: openssl rand -hex 32)
ENCRYPTION_KEY=64hexchars...
```

### Frontend (`frontend/.env` or Vite)

```env
VITE_META_APP_ID=123456789
VITE_META_EMBEDDED_SIGNUP_CONFIG_ID=  # optional
VITE_META_GRAPH_API_VERSION=v23.0
VITE_META_REDIRECT_URI=https://yourapp.com/api/organization/whatsapp-connections/meta/callback
```

If `VITE_META_APP_ID` is not set, the Embedded Signup button is disabled and users see an informational message pointing them to manual configuration.

---

## Meta App Setup Checklist

1. Go to [developers.facebook.com](https://developers.facebook.com).
2. Create app → Business type.
3. Add product: WhatsApp.
4. Under **WhatsApp > API Setup**, note your Phone Number ID and WABA ID.
5. Under **WhatsApp > Configuration**, set:
   - Callback URL: `https://yourapp.com/api/public/whatsapp/meta/webhook`
   - Verify Token: same value as `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to: `messages`
6. Generate a long-lived System User token with `whatsapp_business_messaging` and `whatsapp_business_management`.

---
## Token Exchange Security Note

The OAuth code-to-token exchange uses **HTTP POST with a URL-encoded body** (not a GET URL with query parameters). This keeps `client_secret` out of server access logs and proxy logs.

```http
POST https://graph.facebook.com/{version}/oauth/access_token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&code=...&redirect_uri=...
```

Access tokens are immediately encrypted with AES-256-GCM before storage. They are never returned in API responses.

---
## Webhook URL Patterns

| Type | URL |
|---|---|
| Global verification / incoming | `GET/POST /api/public/whatsapp/meta/webhook` |
| Per-connection verification / incoming | `GET/POST /api/public/whatsapp/meta/:connectionId/webhook` |

Use the global URL when configuring a single webhook on Meta App level.
Use per-connection URLs when different clinics have separate Meta Apps.

Signature validation (X-Hub-Signature-256) is enforced automatically if `metaWebhookSecret` or `webhookSecret` is stored on the connection.

---

## Embedded Signup Flow

1. User clicks **"Meta ile Bağlan"** button on the WhatsApp Connections page.
2. A Facebook OAuth popup opens (requires `VITE_META_APP_ID`).
3. User logs in, selects/creates WABA and phone number.
4. On completion, the popup page posts a `message` event with type `meta_signup_callback` to the opener window, carrying the OAuth `code` and optional WABA / phone fields.
5. Frontend calls `POST /api/organization/whatsapp-connections/meta/callback`.
6. Backend exchanges the code for an access token via `GET /graph.facebook.com/{version}/oauth/access_token`.
7. Access token is encrypted with AES-256-GCM and stored in `metaAccessTokenEncrypted`.
8. A `WhatsAppConnection` record is created (or updated if a connection for the same `organizationId + metaPhoneNumberId` already exists).
9. Clinics listed in `linkedClinicIds` are linked to the connection.

### Callback popup page

The redirect URI must serve a small HTML page that reads the OAuth `code` from the query string and calls `window.opener.postMessage({ type: 'meta_signup_callback', code }, origin)`.

Example:
```html
<!DOCTYPE html>
<html>
<script>
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (window.opener && code) {
    window.opener.postMessage({ type: 'meta_signup_callback', code }, window.location.origin);
  }
  window.close();
</script>
</html>
```

---

## Manual Configuration Flow

If Embedded Signup is not configured (or for advanced use), users can configure Meta connections manually:

1. In the modal select **Meta Cloud API** as provider.
2. Fill in: Business ID, WABA ID, Phone Number ID, App ID, Webhook Verify Token, Webhook Secret, Access Token.
3. Save — the access token is encrypted on the server.

---

## Sending Messages

`MetaCloudWhatsAppProvider.sendMessage()` calls:

```
POST https://graph.facebook.com/{version}/{phoneNumberId}/messages
Authorization: Bearer {accessToken}
Content-Type: application/json
{
  "messaging_product": "whatsapp",
  "to": "{phone}",
  "type": "text",
  "text": { "body": "{message}" }
}
```

Only **text messages** are supported in this MVP. Template messages are not implemented.

---

## Known Limitations

- Template message sending is not implemented (MVP — only free-form text).
- `disconnect()` is a database-only operation — it does not revoke tokens via the Meta API.
- Popup blockers may cause the Embedded Signup to fall back to same-tab redirect.
- Long-lived token renewal is not automated — tokens expire after ~60 days unless refreshed.
- **Production Meta app approval and business verification are required** before real WhatsApp Business API usage. Test mode works without approval.
- Live testing requires real Meta app credentials (App ID, App Secret, verified WABA).

---

---

## Files Changed in Sprint 16

| File | Change |
|---|---|
| `server/src/services/whatsapp/MetaCloudWhatsAppProvider.ts` | Full rewrite — sendMessage, testConnection, parseWebhook, extractPhoneNumberIdFromPayload |
| `server/src/routes/organizationWhatsApp.ts` | Added `POST /api/organization/whatsapp-connections/meta/callback` |
| `server/src/routes/metaWhatsAppWebhook.ts` | New file — 4 webhook routes (global + per-connection) |
| `server/src/index.ts` | Registered metaWhatsAppWebhookRoutes under `/api/public` |
| `src/services/api.ts` | Added `whatsappConnectionService.metaCallback()` |
| `src/pages/WhatsAppConnections.tsx` | Meta Embedded Signup button, updated provider info, meta fields in card/modal |
| `.env.example` | Added `VITE_META_*` vars |
| `server/.env.example` | Added `META_*` backend vars |

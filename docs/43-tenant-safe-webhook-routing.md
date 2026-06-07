# Tenant-Safe WhatsApp and Instagram Webhook Routing

This CRM uses global provider callback URLs and resolves clinics from provider
identifiers in the incoming payload. Clinic IDs are not expected in Meta webhook
verification requests.

## Callback URLs

- Instagram global callback: `/api/public/instagram/webhook`
- WhatsApp Meta Cloud global callback: `/api/public/whatsapp/meta/webhook`
- Optional per-connection callbacks can exist for advanced setups, but incoming
  messages must still match the stored provider identifiers for that connection.

## Verification

- Instagram GET verification uses `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
- WhatsApp Meta GET verification uses `META_WEBHOOK_VERIFY_TOKEN`.
- Token comparison trims surrounding whitespace.
- A valid request with `hub.mode=subscribe` returns HTTP 200 with the raw
  `hub.challenge` value.
- Invalid verification returns HTTP 403. Verification failures are logged without
  logging full secret tokens.

## Incoming Routing

- Instagram POST routing uses `messaging[].recipient.id` and `entry.id` to match
  `InstagramConnection.instagramAccountId` or `InstagramConnection.facebookPageId`.
- WhatsApp Meta POST routing uses `metadata.phone_number_id` to match
  `WhatsAppConnection.metaPhoneNumberId`.
- WhatsApp Evolution POST routing uses `evolutionInstanceName`.
- Provider identifiers must match exactly one active connection. Zero or multiple
  matches are acknowledged but not processed.
- Clinic routing then uses `ClinicInstagramConnection` or
  `ClinicWhatsAppConnection`.
- The server never defaults an incoming webhook to the first clinic.
- If a shared connection cannot be resolved to one clinic, it is stored only as
  `needsClinicResolution=true` for staff resolution and must not be used by
  clinic-facing flows until resolved.

## Required Production Env

```env
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=<long-random-token>
META_WEBHOOK_VERIFY_TOKEN=<long-random-token>
ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false
```

`ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK` defaults to false in production. Keep it
false for tenant-safe incoming webhook routing.

## Duplicate Provider Identifier Diagnostics

Run these queries before applying the provider uniqueness migration if migration
fails:

```sql
SELECT "metaPhoneNumberId", COUNT(*)
FROM "WhatsAppConnection"
WHERE "metaPhoneNumberId" IS NOT NULL
GROUP BY "metaPhoneNumberId"
HAVING COUNT(*) > 1;

SELECT "evolutionInstanceName", COUNT(*)
FROM "WhatsAppConnection"
WHERE "evolutionInstanceName" IS NOT NULL
GROUP BY "evolutionInstanceName"
HAVING COUNT(*) > 1;

SELECT "instagramAccountId", COUNT(*)
FROM "InstagramConnection"
WHERE "instagramAccountId" IS NOT NULL
GROUP BY "instagramAccountId"
HAVING COUNT(*) > 1;
```
